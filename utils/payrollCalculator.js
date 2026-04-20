/**
 * utils/payrollCalculator.js – Veldt Payroll
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ██████████████████████████████████████████████████████████████████████████
 * KEY FIXES IN THIS VERSION
 * ██████████████████████████████████████████████████████████████████████████
 *
 * FIX 1 — GROSS PAY NO LONGER INCLUDES FRINGE BENEFITS
 *   WHY IT WAS WRONG: fringe benefits (housing, vehicle) are NON-CASH.
 *   They increase taxable income for PAYE purposes but they are never
 *   physically paid to the employee. Including them in grossPay was causing
 *   bank transfer CSVs and payslip net-pay figures to be overstated.
 *
 *   BEFORE: grossPay = effectiveBasic + overtimePay + taxableAllowances
 *                      + nonTaxableAllowances + fringeBenefits   ← WRONG
 *   AFTER:  grossPay = effectiveBasic + overtimePay + taxableAllowances
 *                      + nonTaxableAllowances                    ← CORRECT
 *
 *   fringeBenefits are now tracked in taxableGross ONLY for PAYE calculation.
 *
 * FIX 2 — ETX GROSS REMUNERATION (Col 24) DEFINITION
 *   NamRA defines "Gross Remuneration" for ETX as:
 *     cash salary + cash allowances + fringe benefit tax values
 *   = col5 (salary+OT) + col15-col21 (allowances/other income)
 *     + col9 (housing tax value) + col13 (vehicle) + col14 (other fringe)
 *   This is stored separately as `etxGrossRemuneration`.
 *
 * FIX 3 — ETX TOTAL DEDUCTIONS (Col 37) DEFINITION
 *   NamRA col37 = pension + provident + retirement + study
 *   (the four tax-deductible funds ONLY — medical and SSC are NOT here)
 *
 * FIX 4 — ETX TAXABLE INCOME (Col 38) DEFINITION
 *   Taxable Income = Gross Remuneration − Col37 (fund deductions only)
 *   Medical aid is NOT tax-deductible per Namibia Income Tax Act s17.
 *
 * CALCULATION ORDER (per Income Tax Act 1981 & Social Security Act 34/1994):
 *  1.  Working days (calendar-actual or settings override)
 *  2.  Daily rate  = basicSalary ÷ workingDays
 *  3.  Hourly rate = basicSalary ÷ (workingDays × hoursPerDay)
 *  4.  Unpaid leave deduction = dailyRate × unpaid days
 *  5.  effectiveBasic = basicSalary − unpaidLeaveDeduction
 *  6.  Fringe benefits (housing & vehicle) → taxable add-on, NON-CASH
 *  7.  Overtime pay  = hourlyRate × (normalOT × 1.5 + pubHolOT × 2.0)
 *  8.  taxableGross  = effectiveBasic + overtimePay + taxableAllowances
 *                      + fringeBenefits   ← tax base (includes non-cash)
 *  9.  PAYE via annualisation of taxableGross, deducting 4 funds
 *  10. SSC = 0.9% of taxableGross (capped N$99/month)
 *  11. ECF = basicSalary × ecfRate (employer-only)
 *  12. grossPay (CASH) = effectiveBasic + overtimePay + taxableAllowances
 *                        + nonTaxableAllowances  ← NO fringe benefits
 *  13. totalDeductions = PAYE + SSC(employee) + 4 funds + medical + other
 *  14. netPay = grossPay − totalDeductions
 *  15. totalEmployerCost = grossPay + SSC(employer) + ECF
 *  16. etxGrossRemuneration = grossPay(excl nonTax) + fringeBenefits
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// PRECISION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function roundTo4(v) { return Math.round((v || 0) * 10000) / 10000; }
function roundTo2(v) { return Math.round((v || 0) * 100)   / 100;   }

// ─────────────────────────────────────────────────────────────────────────────
// WORKING-DAYS HELPER
// ─────────────────────────────────────────────────────────────────────────────

exports.getWorkingDaysInMonth = function(month, year, overrideWorkingDays = null) {
  if (overrideWorkingDays && overrideWorkingDays > 0) return Math.round(overrideWorkingDays);
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
};

// ─────────────────────────────────────────────────────────────────────────────
// TAX CALCULATION (NamRA PAYE — Income Tax Act 1981)
// ─────────────────────────────────────────────────────────────────────────────

exports.calculateAnnualPAYE = function(annualIncome, taxBrackets) {
  annualIncome = roundTo4(annualIncome);
  if (!annualIncome || annualIncome <= 100000) return 0;

  const sorted = [...taxBrackets].sort((a, b) => a.min - b.min);

  for (const bracket of sorted) {
    const upper = bracket.max === null || bracket.max === undefined ? Infinity : bracket.max;
    if (annualIncome <= upper) {
      const excess = roundTo4(Math.max(0, annualIncome - (bracket.min - 1)));
      return roundTo2(roundTo4((bracket.baseAmount || 0) + roundTo4(excess * (bracket.rate || 0))));
    }
  }

  const top = sorted[sorted.length - 1];
  const excess = roundTo4(Math.max(0, annualIncome - (top.min - 1)));
  return roundTo2(roundTo4((top.baseAmount || 0) + roundTo4(excess * (top.rate || 0))));
};

/**
 * Monthly PAYE via annualisation.
 *
 * Tax-deductible funds (reduce taxable income for PAYE):
 *   pension, provident, retirement, study
 *
 * NOT tax-deductible:
 *   medical aid (deducted from net pay as voluntary contribution only)
 */
exports.calculateMonthlyPAYE = function(
  taxableMonthlyGross,
  pensionMonthly,
  providentMonthly,
  retirementMonthly,
  studyMonthly,
  taxBrackets
) {
  const annualizedGross    = roundTo4((taxableMonthlyGross || 0) * 12);
  const annualFundDeductions = roundTo4(
    ((pensionMonthly || 0) + (providentMonthly || 0) +
     (retirementMonthly || 0) + (studyMonthly || 0)) * 12
  );
  const annualTaxableIncome = roundTo4(Math.max(0, annualizedGross - annualFundDeductions));
  const annualTax           = exports.calculateAnnualPAYE(annualTaxableIncome, taxBrackets || []);
  const monthlyPAYE         = roundTo2(annualTax / 12);

  return {
    monthlyPAYE,
    annualizedGross:     roundTo2(annualizedGross),
    annualTaxableIncome: roundTo2(annualTaxableIncome),
    annualTax,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// SSC (Social Security Act 34 of 1994)
// ─────────────────────────────────────────────────────────────────────────────

exports.calculateSSC = function(
  taxableGross,
  sscRate       = 0.009,
  sscMonthlyCap = 11000,
  sscMaxContrib = 99
) {
  const assessable   = roundTo4(Math.min(taxableGross || 0, sscMonthlyCap));
  const contribution = roundTo2(Math.min(roundTo4(assessable * sscRate), sscMaxContrib));
  return { sscEmployee: contribution, sscEmployer: contribution };
};

// ─────────────────────────────────────────────────────────────────────────────
// ECF (Employees' Compensation Fund) — EMPLOYER ONLY
// ─────────────────────────────────────────────────────────────────────────────

exports.calculateECF = function(basicSalary, ecfRate = 0) {
  return roundTo2(roundTo4((basicSalary || 0) * (ecfRate || 0)));
};

// ─────────────────────────────────────────────────────────────────────────────
// RATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

exports.calculateDailyRate = function(basicSalary, workingDaysInMonth) {
  if (!workingDaysInMonth || workingDaysInMonth <= 0) return 0;
  return roundTo2(roundTo4((basicSalary || 0) / workingDaysInMonth));
};

exports.calculateHourlyRate = function(basicSalary, workingDaysInMonth, hoursPerDay) {
  if (!workingDaysInMonth || !hoursPerDay || workingDaysInMonth <= 0 || hoursPerDay <= 0) return 0;
  return roundTo2(roundTo4((basicSalary || 0) / (workingDaysInMonth * hoursPerDay)));
};

// ─────────────────────────────────────────────────────────────────────────────
// FRINGE BENEFITS (non-cash — taxable income only, NOT gross pay cash)
// ─────────────────────────────────────────────────────────────────────────────

exports.calculateHousingFringeBenefit = function(housingType, basicSalary, settings) {
  if (!housingType || housingType === 'none') return 0;
  const rates = settings?.fringeBenefits?.housing || {};
  const rate  = housingType === 'free'
    ? (rates.freeRate || 0.10)
    : (rates.subsidisedRate || 0.05);
  return roundTo2(roundTo4((basicSalary || 0) * rate));
};

exports.calculateVehicleFringeBenefit = function(hasCompanyVehicle, settings) {
  if (!hasCompanyVehicle) return 0;
  return roundTo2(settings?.fringeBenefits?.vehicle?.monthlyDeterminedValue || 1500);
};

// ─────────────────────────────────────────────────────────────────────────────
// OVERTIME PAY
// ─────────────────────────────────────────────────────────────────────────────

exports.calculateOvertimePay = function(
  basicSalary,
  normalOvertimeHours       = 0,
  publicHolidayOvertimeHours = 0,
  workingDaysInMonth,
  hoursPerDay,
  normalMultiplier          = 1.5,
  publicHolidayMultiplier   = 2.0
) {
  if (!workingDaysInMonth || !hoursPerDay || workingDaysInMonth <= 0 || hoursPerDay <= 0) return 0;
  const hourlyRate = roundTo4((basicSalary || 0) / (workingDaysInMonth * hoursPerDay));
  const normalOT   = roundTo4((normalOvertimeHours       || 0) * hourlyRate * (normalMultiplier       || 1.5));
  const pubHolOT   = roundTo4((publicHolidayOvertimeHours || 0) * hourlyRate * (publicHolidayMultiplier || 2.0));
  return roundTo2(normalOT + pubHolOT);
};

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM ITEM CLASSIFICATION
// Maps a custom pay item to its payslip section and ETX column
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns metadata for a custom pay item:
 *   payslipSection: 'earnings_cash' | 'earnings_noncash' | 'deductions'
 *   etxColumn:      which ETX column this maps to (string label)
 *   affectsGrossPay: whether it adds to cash gross pay
 *   affectsTaxableGross: whether it adds to taxable gross (PAYE base)
 *
 * CLASSIFICATION TABLE:
 * ┌─────────────────────────────────┬──────────────────┬─────────────┬─────────────┬─────────────────────────────┐
 * │ category                        │ payslipSection   │ grossPay    │ taxableGross│ ETX column                  │
 * ├─────────────────────────────────┼──────────────────┼─────────────┼─────────────┼─────────────────────────────┤
 * │ normal (earning_taxable)        │ earnings_cash    │ YES         │ YES         │ col5 (Salaries/Wages)       │
 * │ normal (earning_nontaxable)     │ earnings_cash    │ YES         │ NO          │ col21 (Other Income)        │
 * │ other_allowance (taxable)       │ earnings_cash    │ YES         │ YES         │ col19 (Other Allowance)     │
 * │ other_income (nontaxable)       │ earnings_cash    │ YES         │ NO          │ col21 (Other Income)        │
 * │ fringe_benefit                  │ earnings_noncash │ NO          │ YES         │ col14 (Other fringe)        │
 * │ entertainment_allowance         │ earnings_cash    │ YES         │ YES         │ col15                       │
 * │ vehicle_running_allowance       │ earnings_cash    │ YES         │ YES         │ col16                       │
 * │ vehicle_purchase_allowance      │ earnings_cash    │ YES         │ NO*         │ col17 (*NamRA partial)       │
 * │ subsistence_travel              │ earnings_cash    │ YES         │ NO*         │ col18 (*if reasonable)      │
 * │ deduction                       │ deductions       │ NO          │ NO          │ n/a (post-tax)              │
 * └─────────────────────────────────┴──────────────────┴─────────────┴─────────────┴─────────────────────────────┘
 */
exports.classifyCustomItem = function(item) {
  const cat  = item.category  || 'normal';
  const type = item.type      || 'earning_taxable';

  if (type === 'deduction') {
    return {
      payslipSection:      'deductions',
      etxColumn:           null,
      affectsGrossPay:     false,
      affectsTaxableGross: false,
      isCash:              false,
    };
  }

  switch (cat) {
    case 'fringe_benefit':
      return {
        payslipSection:      'earnings_noncash',
        etxColumn:           'col14_otherFringe',
        affectsGrossPay:     false,   // NON-CASH — critical fix
        affectsTaxableGross: true,
        isCash:              false,
      };

    case 'entertainment_allowance':
      return {
        payslipSection:      'earnings_cash',
        etxColumn:           'col15_entertainment',
        affectsGrossPay:     true,
        affectsTaxableGross: true,
        isCash:              true,
      };

    case 'vehicle_running_allowance':
      return {
        payslipSection:      'earnings_cash',
        etxColumn:           'col16_vehicleRunning',
        affectsGrossPay:     true,
        affectsTaxableGross: true,
        isCash:              true,
      };

    case 'vehicle_purchase_allowance':
      return {
        payslipSection:      'earnings_cash',
        etxColumn:           'col17_vehiclePurchase',
        affectsGrossPay:     true,
        affectsTaxableGross: false, // Typically non-taxable per NamRA
        isCash:              true,
      };

    case 'subsistence_travel':
      return {
        payslipSection:      'earnings_cash',
        etxColumn:           'col18_subsistence',
        affectsGrossPay:     true,
        affectsTaxableGross: false, // Reasonable subsistence is non-taxable
        isCash:              true,
      };

    case 'other_allowance':
      return {
        payslipSection:      'earnings_cash',
        etxColumn:           'col19_otherAllowance',
        affectsGrossPay:     true,
        affectsTaxableGross: type === 'earning_taxable',
        isCash:              true,
      };

    case 'other_income':
      return {
        payslipSection:      'earnings_cash',
        etxColumn:           'col21_otherIncome',
        affectsGrossPay:     true,
        affectsTaxableGross: type === 'earning_taxable',
        isCash:              true,
      };

    case 'normal':
    default:
      if (type === 'earning_taxable') {
        return {
          payslipSection:      'earnings_cash',
          etxColumn:           'col5_salaries',   // rolled into main salary column
          affectsGrossPay:     true,
          affectsTaxableGross: true,
          isCash:              true,
        };
      }
      // earning_nontaxable
      return {
        payslipSection:      'earnings_cash',
        etxColumn:           'col21_otherIncome',
        affectsGrossPay:     true,
        affectsTaxableGross: false,
        isCash:              true,
      };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAYROLL CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculateEmployeePayroll
 *
 * @param {Object} payslipInputs  – form inputs (basicSalary, leave, OT, etc.)
 * @param {Object} employee       – employee document (fund names, housing, etc.)
 * @param {Object} settings       – company settings (rates, brackets, fringe rates)
 * @param {number} month          – 1–12
 * @param {number} year
 *
 * @returns {Object} Complete payslip calculation result
 */
exports.calculateEmployeePayroll = function(payslipInputs, employee, settings, month, year) {
  const basicSalary        = roundTo4(payslipInputs.basicSalary || 0);
  const workingDaysInMonth = settings?.workingDaysInMonth || 22;
  const hoursPerDay        = settings?.hoursPerDay || 8;

  const { sscRate, sscMonthlyCap, sscMaxContribution, ecfRate, taxBrackets } = settings || {};

  // ── 1. Rates ───────────────────────────────────────────────────────────────
  const dailyRate  = exports.calculateDailyRate(basicSalary, workingDaysInMonth);
  const hourlyRate = exports.calculateHourlyRate(basicSalary, workingDaysInMonth, hoursPerDay);

  // ── 2. Unpaid leave deduction ──────────────────────────────────────────────
  const annualLeavePaid    = payslipInputs.annualLeavePaid    || 0;
  const annualLeaveUnpaid  = payslipInputs.annualLeaveUnpaid  || 0;
  const sickLeavePaid      = payslipInputs.sickLeavePaid      || 0;
  const sickLeaveUnpaid    = payslipInputs.sickLeaveUnpaid    || 0;
  const totalUnpaidDays    = roundTo4(annualLeaveUnpaid + sickLeaveUnpaid);
  const unpaidLeaveDeduction = totalUnpaidDays > 0
    ? roundTo2(roundTo4(dailyRate * totalUnpaidDays))
    : 0;
  const effectiveBasic = roundTo2(Math.max(0, roundTo4(basicSalary - unpaidLeaveDeduction)));

  // ── 3. Fringe benefits (NON-CASH — do NOT add to grossPay) ────────────────
  const housingFringeBenefit = exports.calculateHousingFringeBenefit(
    employee.housingType, basicSalary, settings
  );
  const vehicleFringeBenefit = exports.calculateVehicleFringeBenefit(
    employee.hasCompanyVehicle, settings
  );
  const totalFringeBenefits = roundTo2(roundTo4(housingFringeBenefit + vehicleFringeBenefit));

  // ── 4. Overtime ────────────────────────────────────────────────────────────
  const normalOvertimeHours        = payslipInputs.normalOvertimeHours        || 0;
  const publicHolidayOvertimeHours = payslipInputs.publicHolidayOvertimeHours || 0;
  const overtimePay = exports.calculateOvertimePay(
    basicSalary,
    normalOvertimeHours,
    publicHolidayOvertimeHours,
    workingDaysInMonth,
    hoursPerDay,
    settings?.normalOvertimeMultiplier     || 1.5,
    settings?.publicHolidayOvertimeMultiplier || 2.0
  );

  // ── 5. Custom items — classified then split ────────────────────────────────
  const customItemsRaw = payslipInputs.customItems || []; // [{name, type, category, amount}]

  // Accumulators for custom items
  let customCashTaxable    = 0;   // goes to grossPay AND taxableGross
  let customCashNonTaxable = 0;   // goes to grossPay ONLY
  let customNonCashTaxable = 0;   // goes to taxableGross ONLY (fringe)
  let customDeductions     = 0;   // post-tax deduction

  // Per-ETX-column accumulators for custom items
  const etxCustom = {
    col14_otherFringe:    { amount: 0, names: [] },
    col15_entertainment:  { amount: 0, names: [] },
    col16_vehicleRunning: { amount: 0, names: [] },
    col17_vehiclePurchase:{ amount: 0, names: [] },
    col18_subsistence:    { amount: 0, names: [] },
    col19_otherAllowance: { amount: 0, names: [] },
    col21_otherIncome:    { amount: 0, names: [] },
    col5_salaries:        { amount: 0, names: [] },
  };

  const classifiedCustomItems = customItemsRaw.map(item => {
    const classification = exports.classifyCustomItem(item);
    const amt = item.amount || 0;
    if (amt <= 0) return { ...item, classification };

    if (classification.payslipSection === 'deductions') {
      customDeductions += amt;
    } else if (classification.payslipSection === 'earnings_noncash') {
      customNonCashTaxable += amt;
    } else {
      // earnings_cash
      if (classification.affectsTaxableGross) {
        customCashTaxable += amt;
      } else {
        customCashNonTaxable += amt;
      }
    }

    // Accumulate into ETX columns
    const etxCol = classification.etxColumn;
    if (etxCol && etxCustom[etxCol]) {
      etxCustom[etxCol].amount += amt;
      if (item.name) etxCustom[etxCol].names.push(item.name);
    }

    return { ...item, classification };
  });

  // ── 6. Taxable gross (PAYE base — INCLUDES fringe benefits as non-cash) ────
  //
  // taxableGross = effectiveBasic + overtimePay
  //               + explicit taxableAllowances (legacy field)
  //               + customCashTaxable
  //               + customNonCashTaxable (fringe custom items)
  //               + totalFringeBenefits (housing + vehicle)
  //
  const legacyTaxableAllowances    = payslipInputs.taxableAllowances    || 0;
  const legacyNonTaxableAllowances = payslipInputs.nonTaxableAllowances || 0;

  const taxableGross = roundTo2(roundTo4(
    effectiveBasic +
    overtimePay +
    legacyTaxableAllowances +
    customCashTaxable +
    customNonCashTaxable +   // custom fringe items
    totalFringeBenefits      // housing + vehicle fringe
  ));

  // ── 7. PAYE ────────────────────────────────────────────────────────────────
  const pensionMonthly    = roundTo4(employee.pensionContribution         || 0);
  const providentMonthly  = roundTo4(employee.providentFundContribution   || 0);
  const retirementMonthly = roundTo4(employee.retirementFundContribution  || 0);
  const studyMonthly      = roundTo4(employee.studyPolicyContribution     || 0);
  const medicalMonthly    = roundTo4(employee.medicalAidContribution      || 0);

  const {
    monthlyPAYE,
    annualizedGross,
    annualTaxableIncome,
    annualTax,
  } = exports.calculateMonthlyPAYE(
    taxableGross,
    pensionMonthly,
    providentMonthly,
    retirementMonthly,
    studyMonthly,
    taxBrackets
  );

  // ── 8. SSC ─────────────────────────────────────────────────────────────────
  const { sscEmployee, sscEmployer } = exports.calculateSSC(
    taxableGross,
    sscRate,
    sscMonthlyCap,
    sscMaxContribution
  );

  // ── 9. ECF (employer-only) ─────────────────────────────────────────────────
  const ecf = exports.calculateECF(basicSalary, ecfRate);

  // ── 10. GROSS PAY (CASH ONLY — fringe benefits EXCLUDED) ──────────────────
  //
  // grossPay = effectiveBasic + overtimePay
  //          + legacyTaxableAllowances + legacyNonTaxableAllowances
  //          + customCashTaxable + customCashNonTaxable
  //
  // NOTE: fringe benefits (housing, vehicle, custom non-cash) are NOT here.
  //
  const grossPay = roundTo2(roundTo4(
    effectiveBasic +
    overtimePay +
    legacyTaxableAllowances +
    legacyNonTaxableAllowances +
    customCashTaxable +
    customCashNonTaxable
  ));

  // ── 11. Total deductions (from employee's cash pay) ───────────────────────
  const otherDeductions = roundTo4(payslipInputs.otherDeductions || 0) + roundTo4(customDeductions);
  const totalDeductions = roundTo2(roundTo4(
    monthlyPAYE +
    sscEmployee +
    pensionMonthly +
    providentMonthly +
    retirementMonthly +
    studyMonthly +
    medicalMonthly +
    otherDeductions
  ));

  // ── 12. Net pay ────────────────────────────────────────────────────────────
  const netPay = roundTo2(roundTo4(grossPay - totalDeductions));

  // ── 13. Total employer cost ────────────────────────────────────────────────
  const totalEmployerCost = roundTo2(roundTo4(grossPay + sscEmployer + ecf));

  // ── 14. ETX Gross Remuneration (NamRA Col 24) ─────────────────────────────
  // = col5 (salary+OT) + col15-col19 (cash allowances) + col21 (other income)
  //   + col9 (housing fringe tax value) + col13 (vehicle fringe) + col14 (other fringe)
  // Equivalent to: taxableGross + legacyNonTaxableAllowances + customCashNonTaxable
  //              (the non-taxable cash items ARE part of gross remuneration for ETX)
  const etxGrossRemuneration = roundTo2(roundTo4(taxableGross + legacyNonTaxableAllowances + customCashNonTaxable));

  // ── 15. ETX Total Deductions (NamRA Col 37 — fund deductions only) ────────
  // Col37 = pension + provident + retirement + study (NOT medical, NOT SSC)
  const etxTotalDeductions = roundTo2(roundTo4(
    pensionMonthly + providentMonthly + retirementMonthly + studyMonthly
  ));

  // ── 16. ETX Taxable Income (NamRA Col 38) ─────────────────────────────────
  // = Gross Remuneration − Col37
  const etxTaxableIncome = roundTo2(Math.max(0, roundTo4(etxGrossRemuneration - etxTotalDeductions)));

  return {
    // ── Rates & working time
    workingDaysInMonth,
    hoursPerDay,
    basicSalary:       roundTo2(basicSalary),
    effectiveBasic,
    dailyRate,
    hourlyRate,

    // ── Leave
    annualLeavePaid,
    annualLeaveUnpaid,
    sickLeavePaid,
    sickLeaveUnpaid,
    totalUnpaidDays:   roundTo2(totalUnpaidDays),
    unpaidLeaveDeduction,

    // ── Overtime
    normalOvertimeHours,
    publicHolidayOvertimeHours,
    overtimePay,

    // ── Fringe benefits (NON-CASH — for payslip display and ETX only)
    housingFringeBenefit,
    vehicleFringeBenefit,
    totalFringeBenefits,

    // ── Custom items (classified)
    classifiedCustomItems,
    customCashTaxable:    roundTo2(customCashTaxable),
    customCashNonTaxable: roundTo2(customCashNonTaxable),
    customNonCashTaxable: roundTo2(customNonCashTaxable),
    customDeductions:     roundTo2(customDeductions),
    etxCustom,            // per-column ETX accumulators

    // ── Legacy allowances (kept for backward compat)
    taxableAllowances:    roundTo2(legacyTaxableAllowances),
    nonTaxableAllowances: roundTo2(legacyNonTaxableAllowances),
    otherDeductions:      roundTo2(payslipInputs.otherDeductions || 0),

    // ── Tax base
    taxableGross,  // includes fringe — PAYE base

    // ── Gross pay (CASH — does NOT include fringe benefits)
    grossPay,      // what the employee actually receives in cash

    // ── PAYE intermediates
    annualizedGross,
    annualTaxableIncome,
    annualTax,

    // ── Deductions
    pensionMonthly:    roundTo2(pensionMonthly),
    providentMonthly:  roundTo2(providentMonthly),
    retirementMonthly: roundTo2(retirementMonthly),
    studyMonthly:      roundTo2(studyMonthly),
    medicalMonthly:    roundTo2(medicalMonthly),
    paye:              monthlyPAYE,
    sscEmployee,
    sscEmployer,
    ecf,
    totalDeductions,
    netPay,
    totalEmployerCost,

    // ── ETX-specific fields
    etxGrossRemuneration,   // Col 24
    etxTotalDeductions,     // Col 37 (fund deductions only)
    etxTaxableIncome,       // Col 38

    // ── Employee profile fields for payslip display
    bankName:            employee.bankName             || '',
    bankAccountNumber:   employee.bankAccountNumber    || '',
    bankBranchCode:      employee.bankBranchCode       || '',
    accountType:         employee.accountType          || '',
    pensionFundName:     employee.pensionFundName      || '',
    providentFundName:   employee.providentFundName    || '',
    retirementFundName:  employee.retirementFundName   || '',
    studyPolicyName:     employee.studyPolicyName      || '',
    medicalAidFundName:  employee.medicalAidFundName   || '',
    housingType:         employee.housingType          || 'none',
    hasCompanyVehicle:   employee.hasCompanyVehicle    || false,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

exports.calculatePayrollSummary = function(payslips) {
  const totals = payslips.reduce((acc, p) => {
    acc.totalGrossPay          += p.grossPay              || 0;
    acc.totalNetPay            += p.netPay                || 0;
    acc.totalPAYE              += p.paye                  || 0;
    acc.totalSSCEmployee       += p.sscEmployee           || 0;
    acc.totalSSCEmployer       += p.sscEmployer           || 0;
    acc.totalECF               += p.ecf                   || 0;
    acc.totalOtherDeductions   += p.otherDeductions       || 0;
    acc.totalEmployerCost      += p.totalEmployerCost     || 0;
    acc.totalUnpaidLeave       += p.unpaidLeaveDeduction  || 0;
    acc.totalPension           += p.pensionMonthly        || 0;
    acc.totalProvident         += p.providentMonthly      || 0;
    acc.totalRetirement        += p.retirementMonthly     || 0;
    acc.totalStudy             += p.studyMonthly          || 0;
    acc.totalMedical           += p.medicalMonthly        || 0;
    acc.totalFringeBenefits    += p.totalFringeBenefits   || 0;
    acc.totalTaxableGross      += p.taxableGross          || 0;
    acc.totalETXGross          += p.etxGrossRemuneration  || 0;
    return acc;
  }, {
    totalGrossPay:        0,
    totalNetPay:          0,
    totalPAYE:            0,
    totalSSCEmployee:     0,
    totalSSCEmployer:     0,
    totalECF:             0,
    totalOtherDeductions: 0,
    totalEmployerCost:    0,
    totalUnpaidLeave:     0,
    totalPension:         0,
    totalProvident:       0,
    totalRetirement:      0,
    totalStudy:           0,
    totalMedical:         0,
    totalFringeBenefits:  0,
    totalTaxableGross:    0,
    totalETXGross:        0,
    employeeCount:        payslips.length,
  });

  Object.keys(totals).forEach(k => {
    if (typeof totals[k] === 'number') totals[k] = roundTo2(totals[k]);
  });

  return totals;
};

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTING
// ─────────────────────────────────────────────────────────────────────────────

exports.formatNAD = function(amount) {
  if (isNaN(amount) || amount == null) return 'N$ 0.00';
  return 'N$ ' + Number(amount).toLocaleString('en-NA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};