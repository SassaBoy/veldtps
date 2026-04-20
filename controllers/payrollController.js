/**
 * controllers/payrollController.js – Veldt Payroll
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CHANGES FROM PREVIOUS VERSION:
 *
 * 1. CUSTOM ITEMS: now uses classifiedCustomItems (from payrollCalculator)
 *    instead of building the raw customItems array manually.
 *    The classification (payslipSection, etxColumn, etc.) is stored with
 *    each item in the payslip document.
 *
 * 2. PAYSLIP CONSTRUCTION: grossPay now comes from calc.grossPay which
 *    EXCLUDES fringe benefits. taxableGross (PAYE base) is stored separately.
 *
 * 3. ETX FIELDS: etxGrossRemuneration, etxTotalDeductions, etxTaxableIncome
 *    are now saved on each payslip sub-document.
 *
 * 4. SUMMARY: totalTaxableGross and totalETXGross added to run-level summary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const moment          = require('moment-timezone');
const archiver        = require('archiver');
const { PassThrough } = require('stream');

const Employee     = require('../models/Employee');
const PayrollRun   = require('../models/PayrollRun');
const Settings     = require('../models/Settings');
const User         = require('../models/User');
const Subscription = require('../models/Subscription');

const {
  calculateEmployeePayroll,
  calculatePayrollSummary,
  getWorkingDaysInMonth,
  classifyCustomItem,
} = require('../utils/payrollCalculator');

const { generatePayslipPDF, generateCompliancePDF }      = require('../utils/pdfGenerator');
const { generateBankTransferCSV, generateComplianceCSV } = require('../utils/csvGenerator');
const { generateETXBuffer }                              = require('../utils/Etxgenerator');
const { generateSSCForm }                                = require('../utils/Sscformgenerator');
const { generatePAYE5Certificate, appendAllPAYE5ToZip }  = require('../utils/Paye5generator');

const { TRIAL_RUN_LIMIT } = require('../middleware/subscriptionMiddleware');
const MAX_TRIAL_RUNS = TRIAL_RUN_LIMIT || 2;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function getSettings(companyId) {
  let s = await Settings.findOne({ company: companyId });
  if (!s) s = await Settings.create({ company: companyId });
  return s;
}

function monthName(month, year) {
  return moment(`${year}-${String(month).padStart(2, '0')}-01`).format('MMMM YYYY');
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /payroll
// ─────────────────────────────────────────────────────────────────────────────
exports.getPayrollHistory = async (req, res) => {
  try {
    const payrolls = await PayrollRun.find({ company: req.session.user._id })
      .sort({ year: -1, month: -1 })
      .lean();
    res.render('payroll/history', { title: 'Payroll History – VeldtPayroll', payrolls, monthName, moment });
  } catch (err) {
    console.error('Payroll history error:', err);
    req.flash('error', 'Could not load payroll history.');
    res.redirect('/dashboard');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /payroll/run
// ─────────────────────────────────────────────────────────────────────────────
exports.getRunPayroll = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const now       = moment().tz('Africa/Windhoek');
    const selectedMonth = parseInt(req.query.month) || now.month() + 1;
    const selectedYear  = parseInt(req.query.year)  || now.year();

    const [existingRun, employees, settings] = await Promise.all([
      PayrollRun.findOne({ company: companyId, month: selectedMonth, year: selectedYear }).lean(),
      Employee.find({ company: companyId, isActive: true }).sort({ fullName: 1 }).lean(),
      getSettings(companyId),
    ]);

    const customPayItems     = (settings.customPayItems || []).filter(i => i.isActive);
    const workingDaysInMonth = getWorkingDaysInMonth(selectedMonth, selectedYear);

    const years = [];
    for (let y = now.year() - 2; y <= now.year() + 1; y++) years.push(y);

    const runCount = await PayrollRun.countDocuments({ company: companyId, status: 'finalised' });

    res.render('payroll/run', {
      title: 'Run Payroll – VeldtPayroll',
      employees,
      selectedMonth,
      selectedYear,
      existing:         existingRun,
      customPayItems,
      workingDaysInMonth,
      hoursPerDay:      settings.hoursPerDay || 8,
      years,
      months: [
        { value:1,name:'January' },{ value:2,name:'February'  },{ value:3,name:'March'     },
        { value:4,name:'April'   },{ value:5,name:'May'       },{ value:6,name:'June'      },
        { value:7,name:'July'    },{ value:8,name:'August'    },{ value:9,name:'September' },
        { value:10,name:'October'},{ value:11,name:'November' },{ value:12,name:'December' },
      ],
      subscription:    req.subscription || null,
      runCount,
      TRIAL_RUN_LIMIT: MAX_TRIAL_RUNS,
    });
  } catch (err) {
    console.error('Get run payroll error:', err);
    req.flash('error', 'Could not load payroll form.');
    res.redirect('/payroll');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /payroll/run
// ─────────────────────────────────────────────────────────────────────────────
exports.postRunPayroll = async (req, res) => {
  try {
    const companyId     = req.session.user._id;
    const selectedMonth = parseInt(req.body.month);
    const selectedYear  = parseInt(req.body.year);

    if (!selectedMonth || !selectedYear) {
      req.flash('error', 'Invalid month or year.');
      return res.redirect('/payroll/run');
    }

    // ── Subscription check ─────────────────────────────────────────────────
    const subscription = await Subscription.findOne({ company: companyId });
    const plan      = subscription?.plan   || 'trial';
    const subStatus = subscription?.status || 'active';

    if (plan === 'trial') {
      const alreadyRan = await PayrollRun.findOne({ company: companyId, month: selectedMonth, year: selectedYear });
      if (!alreadyRan) {
        const totalRuns = await PayrollRun.countDocuments({ company: companyId, status: 'finalised' });
        if (totalRuns >= MAX_TRIAL_RUNS) {
          req.flash('error', `Free trial limit reached (${MAX_TRIAL_RUNS} payroll runs). Please upgrade.`);
          return res.redirect('/subscribe');
        }
      }
    }
    if (subStatus === 'expired') {
      req.flash('error', 'Your subscription has expired. Please renew.');
      return res.redirect('/subscribe');
    }
    if (subStatus === 'pending_payment') {
      req.flash('error', 'Payment is pending approval.');
      return res.redirect('/subscribe');
    }

    // ── Load company data ──────────────────────────────────────────────────
    const [settings, employees] = await Promise.all([
      getSettings(companyId),
      Employee.find({ company: companyId, isActive: true }),
    ]);

    if (employees.length === 0) {
      req.flash('error', 'No active employees found.');
      return res.redirect('/payroll/run');
    }

    const customPayItems = (settings.customPayItems || []).filter(i => i.isActive);
    const hoursPerDay    = settings.hoursPerDay || 8;

    const settingsForCalc = {
      ecfRate:                         settings.ecfRate,
      sscRate:                         settings.sscRate,
      sscMonthlyCap:                   settings.sscMonthlyCap,
      sscMaxContribution:              settings.sscMaxContribution,
      taxBrackets:                     settings.taxBrackets,
      normalOvertimeMultiplier:        settings.normalOvertimeMultiplier || 1.5,
      publicHolidayOvertimeMultiplier: settings.publicHolidayOvertimeMultiplier || 2.0,
      workingDaysInMonth:              settings.workingDaysInMonth || 22,
      hoursPerDay,
      fringeBenefits:                  settings.fringeBenefits || {},
    };

    // ── Build payslips ─────────────────────────────────────────────────────
    const payslips = [];

    for (const emp of employees) {
      const inputs = req.body.employees?.[emp._id.toString()] || {};

      const annualLeavePaid            = parseFloat(inputs.annualLeavePaid)            || 0;
      const annualLeaveUnpaid          = parseFloat(inputs.annualLeaveUnpaid)          || 0;
      const sickLeavePaid              = parseFloat(inputs.sickLeavePaid)              || 0;
      const sickLeaveUnpaid            = parseFloat(inputs.sickLeaveUnpaid)            || 0;
      const normalOvertimeHours        = parseFloat(inputs.normalOvertimeHours)        || 0;
      const publicHolidayOvertimeHours = parseFloat(inputs.publicHolidayOvertimeHours) || 0;

      // ── Build custom items array for calculator ─────────────────────────
      const customInputs = inputs.custom || {};
      const customItemsForCalc = customPayItems.map(item => {
        const itemIdStr = item._id.toString();
        const rawVal    = customInputs[itemIdStr];
        const amount = (item.inputMode === 'fixed' && (rawVal === undefined || rawVal === ''))
          ? (item.defaultAmount || 0)
          : (parseFloat(rawVal) || 0);
        return {
          itemId:   item._id,
          name:     item.name,
          type:     item.type,
          category: item.category || 'normal',
          amount,
        };
      });

      // ── Legacy allowance fields (when no custom items configured) ───────
      const hasCustomItems      = customPayItems.length > 0;
      const taxableAllowances    = hasCustomItems ? 0 : (parseFloat(inputs.taxableAllowances)    || 0);
      const nonTaxableAllowances = hasCustomItems ? 0 : (parseFloat(inputs.nonTaxableAllowances) || 0);
      const otherDeductions      = hasCustomItems ? 0 : (parseFloat(inputs.otherDeductions)      || 0);

      // ── Run the calculator ──────────────────────────────────────────────
      const calc = calculateEmployeePayroll(
        {
          basicSalary: emp.basicSalary,
          normalOvertimeHours,
          publicHolidayOvertimeHours,
          annualLeavePaid,
          annualLeaveUnpaid,
          sickLeavePaid,
          sickLeaveUnpaid,
          taxableAllowances,
          nonTaxableAllowances,
          otherDeductions,
          customItems: customItemsForCalc,
        },
        emp,
        settingsForCalc,
        selectedMonth,
        selectedYear
      );

      // ── Build payslip document ──────────────────────────────────────────
      payslips.push({
        employee: emp._id,
        employeeSnapshot: {
          fullName:            emp.fullName,
          idNumber:            emp.idNumber,
          tinNumber:           emp.tinNumber            || '',
          sscNumber:           emp.socialSecurityNumber || '',
          position:            emp.position             || '',
          department:          emp.department           || '',
          email:               emp.email,
          phone:               emp.phone               || '',
          bankName:            emp.bankName             || '',
          bankAccountNumber:   emp.bankAccountNumber    || '',
          branchCode:          emp.bankBranchCode       || '',
          accountType:         emp.accountType          || '',
          pensionFundName:     emp.pensionFundName      || '',
          pensionFundRegNo:    emp.pensionFundRegNo     || '',
          providentFundName:   emp.providentFundName    || '',
          providentFundRegNo:  emp.providentFundRegNo   || '',
          retirementFundName:  emp.retirementFundName   || '',
          retirementFundRegNo: emp.retirementFundRegNo  || '',
          studyPolicyName:     emp.studyPolicyName      || '',
          studyPolicyRegNo:    emp.studyPolicyRegNo     || '',
          medicalAidFundName:  emp.medicalAidFundName   || '',
          medicalAidMemberNo:  emp.medicalAidMemberNo   || '',
          housingType:         emp.housingType          || 'none',
          hasCompanyVehicle:   emp.hasCompanyVehicle    || false,
        },

        workingDaysInMonth:          calc.workingDaysInMonth,
        hoursPerDay:                 calc.hoursPerDay,
        dailyRate:                   calc.dailyRate,
        hourlyRate:                  calc.hourlyRate,

        annualLeavePaid,
        annualLeaveUnpaid,
        sickLeavePaid,
        sickLeaveUnpaid,
        unpaidLeaveDeduction:        calc.unpaidLeaveDeduction,

        normalOvertimeHours,
        publicHolidayOvertimeHours,
        overtimePay:                 calc.overtimePay,

        taxableAllowances,
        nonTaxableAllowances,
        otherDeductions,

        // Classified custom items (includes classification metadata)
        classifiedCustomItems:       calc.classifiedCustomItems || [],

        housingFringeBenefit:        calc.housingFringeBenefit,
        vehicleFringeBenefit:        calc.vehicleFringeBenefit,
        totalFringeBenefits:         calc.totalFringeBenefits,

        pensionMonthly:              calc.pensionMonthly,
        providentMonthly:            calc.providentMonthly,
        retirementMonthly:           calc.retirementMonthly,
        studyMonthly:                calc.studyMonthly,
        medicalMonthly:              calc.medicalMonthly,

        basicSalary:                 calc.basicSalary,
        effectiveBasic:              calc.effectiveBasic,
        taxableGross:                calc.taxableGross,    // PAYE base (incl. fringe)
        grossPay:                    calc.grossPay,        // CASH ONLY (excl. fringe)
        annualizedGross:             calc.annualizedGross,
        annualTaxableIncome:         calc.annualTaxableIncome,
        annualTax:                   calc.annualTax,

        paye:                        calc.paye,
        sscEmployee:                 calc.sscEmployee,
        sscEmployer:                 calc.sscEmployer,
        ecf:                         calc.ecf,
        totalDeductions:             calc.totalDeductions,
        netPay:                      calc.netPay,
        totalEmployerCost:           calc.totalEmployerCost,

        // ETX pre-calculated fields
        etxGrossRemuneration:        calc.etxGrossRemuneration,
        etxTotalDeductions:          calc.etxTotalDeductions,
        etxTaxableIncome:            calc.etxTaxableIncome,
      });

      // ── Update employee leave balances and YTD ──────────────────────────
      emp.annualLeaveBalance  = Math.max(0, (emp.annualLeaveBalance || 0) - (annualLeavePaid + annualLeaveUnpaid));
      emp.sickLeaveBalance    = Math.max(0, (emp.sickLeaveBalance   || 0) - (sickLeavePaid + sickLeaveUnpaid));
      emp.annualLeavePaidYTD   = (emp.annualLeavePaidYTD   || 0) + annualLeavePaid;
      emp.annualLeaveUnpaidYTD = (emp.annualLeaveUnpaidYTD || 0) + annualLeaveUnpaid;
      emp.sickLeavePaidYTD     = (emp.sickLeavePaidYTD     || 0) + sickLeavePaid;
      emp.sickLeaveUnpaidYTD   = (emp.sickLeaveUnpaidYTD   || 0) + sickLeaveUnpaid;
      await emp.save();
    }

    // ── Summary ────────────────────────────────────────────────────────────
    const summary = calculatePayrollSummary(payslips);

    // ── Save / upsert ──────────────────────────────────────────────────────
    const payrollRun = await PayrollRun.findOneAndUpdate(
      { company: companyId, month: selectedMonth, year: selectedYear },
      {
        company:  companyId,
        month:    selectedMonth,
        year:     selectedYear,
        status:   'finalised',
        payslips,
        ...summary,
        settingsSnapshot: {
          ecfRate:                         settings.ecfRate,
          sscRate:                         settings.sscRate,
          sscCap:                          settings.sscMonthlyCap,
          taxBrackets:                     settings.taxBrackets,
          hoursPerDay,
          normalOvertimeMultiplier:        settings.normalOvertimeMultiplier || 1.5,
          publicHolidayOvertimeMultiplier: settings.publicHolidayOvertimeMultiplier || 2.0,
          fringeBenefits:                  settings.fringeBenefits || {},
        },
        processedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    req.flash('success', `Payroll for ${monthName(selectedMonth, selectedYear)} processed for ${employees.length} employee(s).`);
    res.redirect(`/payroll/${payrollRun._id}`);

  } catch (err) {
    console.error('Post payroll run error:', err);
    req.flash('error', 'Failed to process payroll: ' + err.message);
    res.redirect('/payroll/run');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /payroll/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.getPayrollRun = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id, company: req.session.user._id,
    }).lean();
    if (!payrollRun) {
      req.flash('error', 'Payroll run not found.');
      return res.redirect('/payroll');
    }
    res.render('payroll/index', {
      title: `${monthName(payrollRun.month, payrollRun.year)} Payroll – VeldtPayroll`,
      payrollRun, monthName, moment,
    });
  } catch (err) {
    console.error('Get payroll run error:', err);
    req.flash('error', 'Could not load payroll run.');
    res.redirect('/payroll');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /payroll/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.deletePayrollRun = async (req, res) => {
  try {
    await PayrollRun.findOneAndDelete({ _id: req.params.id, company: req.session.user._id });
    req.flash('success', 'Payroll run deleted.');
    res.redirect('/payroll');
  } catch (err) {
    console.error('Delete payroll run error:', err);
    req.flash('error', 'Could not delete payroll run.');
    res.redirect('/payroll');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PAYSLIP DOWNLOADS
// ─────────────────────────────────────────────────────────────────────────────

exports.downloadPayslipPDF = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!payrollRun) return res.status(404).send('Not found');
    const payslip = payrollRun.payslips.id(req.params.payslipId);
    if (!payslip) return res.status(404).send('Payslip not found');
    const [companyUser, settings] = await Promise.all([
      User.findById(req.session.user._id).lean(),
      Settings.findOne({ company: req.session.user._id }).lean(),
    ]);
    const theme    = settings?.payslipTheme || {};
    const safeName = (payslip.employeeSnapshot?.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
    const fileName = `payslip_${safeName}_${monthName(payrollRun.month, payrollRun.year).replace(' ', '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, res, theme);
  } catch (err) {
    console.error('Download payslip PDF error:', err);
    res.status(500).send('Could not generate PDF');
  }
};

exports.downloadAllPayslipsZip = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!payrollRun) return res.status(404).send('Not found');
    const [companyUser, settings] = await Promise.all([
      User.findById(req.session.user._id).lean(),
      Settings.findOne({ company: req.session.user._id }).lean(),
    ]);
    const theme  = settings?.payslipTheme || {};
    const period = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="payslips_${period}.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    for (const payslip of payrollRun.payslips) {
      const safeName  = (payslip.employeeSnapshot?.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
      const pdfStream = new PassThrough();
      generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, pdfStream, theme);
      archive.append(pdfStream, { name: `payslip_${safeName}.pdf` });
    }
    await archive.finalize();
  } catch (err) {
    console.error('Download ZIP error:', err);
    res.status(500).send('Could not generate ZIP');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CSV DOWNLOADS
// ─────────────────────────────────────────────────────────────────────────────

exports.downloadBankCSV = async (req, res) => {
  try {
    const payrollRun  = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id }).lean();
    if (!payrollRun) return res.status(404).send('Not found');
    const companyUser = await User.findById(req.session.user._id).lean();
    const csv         = await generateBankTransferCSV(payrollRun, companyUser);
    const period      = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bank_transfer_${period}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Download bank CSV error:', err);
    res.status(500).send('Could not generate CSV');
  }
};

exports.downloadComplianceCSV = async (req, res) => {
  try {
    const payrollRun  = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id }).lean();
    if (!payrollRun) return res.status(404).send('Not found');
    const companyUser = await User.findById(req.session.user._id).lean();
    const csv         = await generateComplianceCSV(payrollRun, companyUser);
    const period      = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="compliance_${period}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Download compliance CSV error:', err);
    res.status(500).send('Could not generate CSV');
  }
};

exports.downloadCompliancePDF = async (req, res) => {
  try {
    const payrollRun  = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!payrollRun) return res.status(404).send('Not found');
    const companyUser = await User.findById(req.session.user._id).lean();
    const period      = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="compliance_summary_${period}.pdf"`);
    generateCompliancePDF(payrollRun, companyUser, res);
  } catch (err) {
    console.error('Download compliance PDF error:', err);
    res.status(500).send('Could not generate PDF');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// NAMIBIAN STATUTORY DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

exports.downloadETX = async (req, res) => {
  try {
    const companyId  = req.session.user._id;
    const payrollRun = await PayrollRun.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!payrollRun) return res.status(404).send('Not found');

    const taxYear = payrollRun.month >= 3 ? payrollRun.year : payrollRun.year - 1;
    const [allRuns, employees] = await Promise.all([
      PayrollRun.find({
        company: companyId, status: 'finalised',
        $or: [
          { year: taxYear,     month: { $gte: 3 } },
          { year: taxYear + 1, month: { $lte: 2 } },
        ],
      }).lean(),
      Employee.find({ company: companyId }).lean(),
    ]);

    const buffer = await generateETXBuffer(allRuns, employees, taxYear);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ETX_PAYE4_${taxYear}_${taxYear+1}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('ETX download error:', err);
    res.status(500).send('Could not generate ETX file');
  }
};

exports.downloadSSCForm = async (req, res) => {
  try {
    const payrollRun  = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!payrollRun) return res.status(404).send('Not found');
    const companyUser = await User.findById(req.session.user._id).lean();
    const period      = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="SSC_Form10a_${period}.pdf"`);
    generateSSCForm(payrollRun, companyUser, res);
  } catch (err) {
    console.error('SSC form download error:', err);
    res.status(500).send('Could not generate SSC form');
  }
};

exports.downloadPAYE5Single = async (req, res) => {
  try {
    const companyId  = req.session.user._id;
    const payrollRun = await PayrollRun.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!payrollRun) return res.status(404).send('Not found');

    const taxYear = payrollRun.month >= 3 ? payrollRun.year : payrollRun.year - 1;
    const [allRuns, employee, companyUser] = await Promise.all([
      PayrollRun.find({
        company: companyId, status: 'finalised',
        $or: [
          { year: taxYear,     month: { $gte: 3 } },
          { year: taxYear + 1, month: { $lte: 2 } },
        ],
      }).lean(),
      Employee.findOne({ _id: req.params.employeeId, company: companyId }).lean(),
      User.findById(companyId).lean(),
    ]);
    if (!employee) return res.status(404).send('Employee not found');

    const empIdStr = req.params.employeeId;
    const annualData = {
      annualSalary: 0, annualOTPay: 0,
      annualGross: 0,  annualTaxGross: 0, annualPAYE: 0, annualSSCEmployee: 0,
    };

    for (const run of allRuns) {
      for (const ps of run.payslips) {
        if (ps.employee?.toString() !== empIdStr) continue;
        annualData.annualSalary      += ps.basicSalary    || 0;
        annualData.annualOTPay       += ps.overtimePay    || 0;
        annualData.annualGross       += ps.grossPay       || 0;
        annualData.annualTaxGross    += ps.taxableGross   || ps.grossPay || 0;
        annualData.annualPAYE        += ps.paye           || 0;
        annualData.annualSSCEmployee += ps.sscEmployee    || 0;
      }
    }

    annualData.annualDeductions = (employee.pensionContribution    || 0) * 12
                                + (employee.medicalAidContribution || 0) * 12
                                + annualData.annualSSCEmployee;
    annualData.taxableIncome    = Math.max(0, annualData.annualTaxGross
                                - (employee.pensionContribution    || 0) * 12
                                - (employee.medicalAidContribution || 0) * 12);

    const safeName = (employee.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="PAYE5_${safeName}_${taxYear}.pdf"`);
    generatePAYE5Certificate(annualData, employee, companyUser, taxYear, res);
  } catch (err) {
    console.error('PAYE5 download error:', err);
    res.status(500).send('Could not generate PAYE5');
  }
};

exports.downloadPAYE5All = async (req, res) => {
  try {
    const companyId  = req.session.user._id;
    const payrollRun = await PayrollRun.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!payrollRun) return res.status(404).send('Not found');

    const taxYear = payrollRun.month >= 3 ? payrollRun.year : payrollRun.year - 1;
    const [allRuns, employees, companyUser] = await Promise.all([
      PayrollRun.find({
        company: companyId, status: 'finalised',
        $or: [
          { year: taxYear,     month: { $gte: 3 } },
          { year: taxYear + 1, month: { $lte: 2 } },
        ],
      }).lean(),
      Employee.find({ company: companyId }).lean(),
      User.findById(companyId).lean(),
    ]);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="PAYE5_All_${taxYear}_${taxYear+1}.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    appendAllPAYE5ToZip(allRuns, employees, companyUser, taxYear, archive);
    await archive.finalize();
  } catch (err) {
    console.error('PAYE5 all download error:', err);
    res.status(500).send('Could not generate PAYE5 ZIP');
  }
};