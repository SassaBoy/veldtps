/**
 * payrollController.js
 * Handles all payroll run logic: creating, viewing, and downloading outputs.
 *
 * DISCLAIMER: Payroll calculations are for guidance only.
 * Always verify with NamRA and Social Security before final submission.
 */

const moment = require('moment-timezone');
const archiver = require('archiver');
const { PassThrough } = require('stream');

const Employee = require('../models/Employee');
const PayrollRun = require('../models/PayrollRun');
const Settings = require('../models/Settings');
const User = require('../models/User');

const {
  calculateEmployeePayroll,
  calculatePayrollSummary
} = require('../utils/payrollCalculator');

const { generatePayslipPDF, generateCompliancePDF } = require('../utils/pdfGenerator');
const { generateBankTransferCSV, generateComplianceCSV } = require('../utils/csvGenerator');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get or create settings for the company */
async function getSettings(companyId) {
  let settings = await Settings.findOne({ company: companyId });
  if (!settings) {
    settings = await Settings.create({ company: companyId });
  }
  return settings;
}

/** Month name from number */
function monthName(m, y) {
  return moment(`${y}-${String(m).padStart(2, '0')}-01`).format('MMMM YYYY');
}

// ─── GET /payroll ─────────────────────────────────────────────────────────────
exports.getPayrollHistory = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const payrolls = await PayrollRun.find({ company: companyId })
      .sort({ year: -1, month: -1 })
      .lean();

    res.render('payroll/history', {
      title: 'Payroll History – NamPayroll',
      payrolls,
      monthName,
      moment
    });
  } catch (err) {
    console.error('Payroll history error:', err);
    req.flash('error', 'Could not load payroll history.');
    res.redirect('/dashboard');
  }
};

// ─── GET /payroll/run ──────────────────────────────────────────────────────────
exports.getRunPayroll = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const now = moment().tz('Africa/Windhoek');

    // Default to current month/year, allow query override
    const selectedMonth = parseInt(req.query.month) || now.month() + 1;
    const selectedYear = parseInt(req.query.year) || now.year();

    // Check if payroll already run for this period
    const existing = await PayrollRun.findOne({
      company: companyId,
      month: selectedMonth,
      year: selectedYear
    });

    // Get active employees
    const employees = await Employee.find({ company: companyId, isActive: true })
      .sort({ fullName: 1 })
      .lean();

    // Build year options (current year ± 2)
    const years = [];
    for (let y = now.year() - 2; y <= now.year() + 1; y++) years.push(y);

    res.render('payroll/run', {
      title: 'Run Payroll – NamPayroll',
      employees,
      selectedMonth,
      selectedYear,
      existing,
      years,
      months: [
        { value: 1, name: 'January' }, { value: 2, name: 'February' },
        { value: 3, name: 'March' }, { value: 4, name: 'April' },
        { value: 5, name: 'May' }, { value: 6, name: 'June' },
        { value: 7, name: 'July' }, { value: 8, name: 'August' },
        { value: 9, name: 'September' }, { value: 10, name: 'October' },
        { value: 11, name: 'November' }, { value: 12, name: 'December' }
      ]
    });
  } catch (err) {
    console.error('Get run payroll error:', err);
    req.flash('error', 'Could not load payroll form.');
    res.redirect('/payroll');
  }
};

// ─── POST /payroll/run ────────────────────────────────────────────────────────
exports.postRunPayroll = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const { month, year } = req.body;
    const selectedMonth = parseInt(month);
    const selectedYear = parseInt(year);

    if (!selectedMonth || !selectedYear) {
      req.flash('error', 'Invalid month or year.');
      return res.redirect('/payroll/run');
    }

    // Load settings
    const settings = await getSettings(companyId);

    // Load active employees
    const employees = await Employee.find({ company: companyId, isActive: true });

    if (employees.length === 0) {
      req.flash('error', 'No active employees found. Please add employees first.');
      return res.redirect('/payroll/run');
    }

    // ─── Build payslips ───────────────────────────────────────────────────
    const payslips = [];

    for (const emp of employees) {
      // Input fields are named: employees[empId][field]
      const empInputs = req.body.employees?.[emp._id.toString()] || {};

      const inputs = {
        daysWorked: parseFloat(empInputs.daysWorked) || 0,
        hoursWorked: parseFloat(empInputs.hoursWorked) || 0,
        overtimeHours: parseFloat(empInputs.overtimeHours) || 0,
        annualLeaveTaken: parseFloat(empInputs.annualLeaveTaken) || 0,
        sickLeaveTaken: parseFloat(empInputs.sickLeaveTaken) || 0
      };

      const calc = calculateEmployeePayroll(emp, inputs, {
        ecfRate: settings.ecfRate,
        sscRate: settings.sscRate,
        sscMonthlyCap: settings.sscMonthlyCap,
        sscMaxContribution: settings.sscMaxContribution,
        taxBrackets: settings.taxBrackets,
        overtimeMultiplier: settings.overtimeMultiplier,
        workingDaysPerMonth: settings.workingDaysPerMonth
      });

      payslips.push({
        employee: emp._id,
        employeeSnapshot: {
          fullName: emp.fullName,
          idNumber: emp.idNumber,
          position: emp.position || '',
          department: emp.department || '',
          email: emp.email,
          phone: emp.phone || ''
        },
        ...calc
      });

      // ── Update leave balances on the employee ──────────────────────────
      if (inputs.annualLeaveTaken > 0) {
        emp.annualLeaveBalance = Math.max(0, emp.annualLeaveBalance - inputs.annualLeaveTaken);
      }
      if (inputs.sickLeaveTaken > 0) {
        emp.sickLeaveBalance = Math.max(0, emp.sickLeaveBalance - inputs.sickLeaveTaken);
      }
      await emp.save();
    }

    // ─── Calculate summary totals ─────────────────────────────────────────
    const summary = calculatePayrollSummary(payslips);

    // ─── Upsert PayrollRun ────────────────────────────────────────────────
    // If one already exists for this period, overwrite it
    const payrollRun = await PayrollRun.findOneAndUpdate(
      { company: companyId, month: selectedMonth, year: selectedYear },
      {
        company: companyId,
        month: selectedMonth,
        year: selectedYear,
        status: 'finalised',
        payslips,
        ...summary,
        settingsSnapshot: {
          ecfRate: settings.ecfRate,
          sscRate: settings.sscRate,
          sscCap: settings.sscMonthlyCap,
          taxBrackets: settings.taxBrackets
        },
        processedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    req.flash('success', `Payroll for ${monthName(selectedMonth, selectedYear)} has been processed for ${employees.length} employee(s).`);
    res.redirect(`/payroll/${payrollRun._id}`);
  } catch (err) {
    console.error('Run payroll error:', err);
    req.flash('error', 'Payroll processing failed: ' + err.message);
    res.redirect('/payroll/run');
  }
};

// ─── GET /payroll/:id ─────────────────────────────────────────────────────────
exports.getPayrollRun = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    }).lean();

    if (!payrollRun) {
      req.flash('error', 'Payroll run not found.');
      return res.redirect('/payroll');
    }

    res.render('payroll/index', {
      title: `${monthName(payrollRun.month, payrollRun.year)} Payroll – NamPayroll`,
      payrollRun,
      monthName,
      moment
    });
  } catch (err) {
    console.error('Get payroll run error:', err);
    req.flash('error', 'Could not load payroll run.');
    res.redirect('/payroll');
  }
};

// ─── DELETE /payroll/:id ───────────────────────────────────────────────────────
exports.deletePayrollRun = async (req, res) => {
  try {
    await PayrollRun.findOneAndDelete({
      _id: req.params.id,
      company: req.session.user._id
    });
    req.flash('success', 'Payroll run deleted.');
    res.redirect('/payroll');
  } catch (err) {
    console.error('Delete payroll run error:', err);
    req.flash('error', 'Could not delete payroll run.');
    res.redirect('/payroll');
  }
};

// ─── GET /payroll/:id/payslip/:payslipId/pdf ──────────────────────────────────
exports.downloadPayslipPDF = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    });

    if (!payrollRun) return res.status(404).send('Not found');

    const payslip = payrollRun.payslips.id(req.params.payslipId);
    if (!payslip) return res.status(404).send('Payslip not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const safeName = (payslip.employeeSnapshot?.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
    const fileName = `payslip_${safeName}_${monthName(payrollRun.month, payrollRun.year).replace(' ', '_')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, res);
  } catch (err) {
    console.error('Download payslip PDF error:', err);
    res.status(500).send('Could not generate PDF');
  }
};

// ─── GET /payroll/:id/zip ─────────────────────────────────────────────────────
exports.downloadAllPayslipsZip = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    });

    if (!payrollRun) return res.status(404).send('Not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const period = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');
    const zipFileName = `payslips_${period}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    // Add each payslip as a PDF to the ZIP
    for (const payslip of payrollRun.payslips) {
      const safeName = (payslip.employeeSnapshot?.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
      const fileName = `payslip_${safeName}.pdf`;

      // Generate PDF into a PassThrough stream, then append to archive
      const pdfStream = new PassThrough();
      generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, pdfStream);
      archive.append(pdfStream, { name: fileName });
    }

    await archive.finalize();
  } catch (err) {
    console.error('Download zip error:', err);
    res.status(500).send('Could not generate ZIP');
  }
};

// ─── GET /payroll/:id/bank-csv ─────────────────────────────────────────────────
exports.downloadBankCSV = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    }).lean();

    if (!payrollRun) return res.status(404).send('Not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const csv = await generateBankTransferCSV(payrollRun, companyUser);
    const period = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bank_transfer_${period}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Download bank CSV error:', err);
    res.status(500).send('Could not generate CSV');
  }
};

// ─── GET /payroll/:id/compliance-csv ──────────────────────────────────────────
exports.downloadComplianceCSV = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    }).lean();

    if (!payrollRun) return res.status(404).send('Not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const csv = await generateComplianceCSV(payrollRun, companyUser);
    const period = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="compliance_${period}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Download compliance CSV error:', err);
    res.status(500).send('Could not generate CSV');
  }
};

// ─── GET /payroll/:id/compliance-pdf ──────────────────────────────────────────
exports.downloadCompliancePDF = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    });

    if (!payrollRun) return res.status(404).send('Not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const period = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="compliance_summary_${period}.pdf"`);

    generateCompliancePDF(payrollRun, companyUser, res);
  } catch (err) {
    console.error('Download compliance PDF error:', err);
    res.status(500).send('Could not generate PDF');
  }
};
