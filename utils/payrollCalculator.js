/**
 * payrollCalculator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Core Namibian payroll calculation engine.
 *
 * DISCLAIMER: Payroll calculations are for guidance only.
 * Always verify with NamRA and Social Security before final submission.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Calculate annual PAYE using Namibia 2026 tax brackets.
 * Brackets are stored in the Settings document so they can be updated by admin.
 *
 * @param {number} annualIncome  - Annual gross income (NAD)
 * @param {Array}  taxBrackets   - Array of bracket objects from Settings
 * @returns {number} Annual PAYE amount (NAD), rounded to 2 decimal places
 */
function calculateAnnualPAYE(annualIncome, taxBrackets) {
  if (annualIncome <= 0) return 0;

  // Sort brackets ascending by min just to be safe
  const sorted = [...taxBrackets].sort((a, b) => a.min - b.min);

  for (const bracket of sorted) {
    const upperBound = bracket.max === null ? Infinity : bracket.max;
    if (annualIncome <= upperBound) {
      // Tax = baseAmount + rate * (income - bracket.min)
      // Note: bracket.min is the lower bound of THIS bracket (excess starts above min)
      const excess = Math.max(0, annualIncome - (bracket.min - 1));
      const tax = bracket.baseAmount + (excess * bracket.rate);
      return Math.round(tax * 100) / 100;
    }
  }

  // Fallback: use the highest bracket
  const top = sorted[sorted.length - 1];
  const excess = Math.max(0, annualIncome - (top.min - 1));
  return Math.round((top.baseAmount + excess * top.rate) * 100) / 100;
}

/**
 * Calculate monthly PAYE by annualizing the monthly gross.
 *
 * @param {number} monthlyGross - Gross pay for the month
 * @param {Array}  taxBrackets  - Brackets from Settings
 * @returns {{ monthlyPAYE: number, annualizedGross: number, annualTax: number }}
 */
function calculateMonthlyPAYE(monthlyGross, taxBrackets) {
  const annualizedGross = monthlyGross * 12;
  const annualTax = calculateAnnualPAYE(annualizedGross, taxBrackets);
  const monthlyPAYE = Math.round((annualTax / 12) * 100) / 100;
  return { monthlyPAYE, annualizedGross, annualTax };
}

/**
 * Calculate Social Security Contributions (SSC).
 * Both employee and employer pay 0.9% of basic salary,
 * capped at N$99 each (based on a max monthly salary of N$11,000).
 *
 * @param {number} basicSalary     - Employee's basic monthly salary
 * @param {number} sscRate         - SSC rate as decimal (default 0.009)
 * @param {number} sscMonthlyCap   - Max salary for SSC calculation (default 11000)
 * @param {number} sscMaxContrib   - Max contribution per party (default 99)
 * @returns {{ sscEmployee: number, sscEmployer: number }}
 */
function calculateSSC(basicSalary, sscRate = 0.009, sscMonthlyCap = 11000, sscMaxContrib = 99) {
  // Use the lesser of actual salary or the cap
  const assessableSalary = Math.min(basicSalary, sscMonthlyCap);
  const rawSSC = assessableSalary * sscRate;
  const cappedSSC = Math.min(rawSSC, sscMaxContrib);
  const rounded = Math.round(cappedSSC * 100) / 100;
  return {
    sscEmployee: rounded,
    sscEmployer: rounded
  };
}

/**
 * Calculate Employer Compensation Fund (ECF).
 * Employer only. Default 4% of basic salary.
 *
 * @param {number} basicSalary - Basic monthly salary
 * @param {number} ecfRate     - ECF rate as decimal (default 0.04)
 * @returns {number} ECF amount
 */
function calculateECF(basicSalary, ecfRate = 0.04) {
  return Math.round(basicSalary * ecfRate * 100) / 100;
}

/**
 * Calculate overtime pay.
 * Formula: (basicSalary / workingDays / 8 hours) * overtimeHours * multiplier
 *
 * @param {number} basicSalary        - Basic monthly salary
 * @param {number} overtimeHours      - Overtime hours worked this month
 * @param {number} workingDaysPerMonth - Standard working days (default 22)
 * @param {number} overtimeMultiplier  - Overtime rate multiplier (default 1.5)
 * @returns {number} Overtime pay amount
 */
function calculateOvertimePay(basicSalary, overtimeHours, workingDaysPerMonth = 22, overtimeMultiplier = 1.5) {
  if (!overtimeHours || overtimeHours <= 0) return 0;
  const hourlyRate = basicSalary / (workingDaysPerMonth * 8);
  const overtimePay = hourlyRate * overtimeHours * overtimeMultiplier;
  return Math.round(overtimePay * 100) / 100;
}

/**
 * Main function: calculate full payroll for a single employee for one month.
 *
 * @param {Object} employee   - Employee document (or plain object)
 * @param {Object} inputs     - { daysWorked, hoursWorked, overtimeHours, annualLeaveTaken, sickLeaveTaken }
 * @param {Object} settings   - Settings document (ecfRate, sscRate, sscMonthlyCap, sscMaxContribution, taxBrackets, overtimeMultiplier, workingDaysPerMonth)
 * @returns {Object} Full payslip calculation result
 */
function calculateEmployeePayroll(employee, inputs, settings) {
  const {
    daysWorked = 0,
    hoursWorked = 0,
    overtimeHours = 0,
    annualLeaveTaken = 0,
    sickLeaveTaken = 0
  } = inputs;

  const {
    ecfRate = 0.04,
    sscRate = 0.009,
    sscMonthlyCap = 11000,
    sscMaxContribution = 99,
    taxBrackets,
    overtimeMultiplier = 1.5,
    workingDaysPerMonth = 22
  } = settings;

  const basicSalary = employee.basicSalary;

  // ─── 1. Overtime Pay ──────────────────────────────────────────────────────
  const overtimePay = calculateOvertimePay(
    basicSalary,
    overtimeHours,
    workingDaysPerMonth,
    overtimeMultiplier
  );

  // ─── 2. Gross Pay ─────────────────────────────────────────────────────────
  const grossPay = Math.round((basicSalary + overtimePay) * 100) / 100;

  // ─── 3. PAYE ──────────────────────────────────────────────────────────────
  const { monthlyPAYE, annualizedGross, annualTax } = calculateMonthlyPAYE(grossPay, taxBrackets);

  // ─── 4. Social Security ───────────────────────────────────────────────────
  const { sscEmployee, sscEmployer } = calculateSSC(
    basicSalary,
    sscRate,
    sscMonthlyCap,
    sscMaxContribution
  );

  // ─── 5. ECF (employer only) ───────────────────────────────────────────────
  const ecf = calculateECF(basicSalary, ecfRate);

  // ─── 6. Net Pay ───────────────────────────────────────────────────────────
  const totalDeductions = Math.round((monthlyPAYE + sscEmployee) * 100) / 100;
  const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

  // ─── 7. Total Employer Cost ───────────────────────────────────────────────
  const totalEmployerCost = Math.round((grossPay + sscEmployer + ecf) * 100) / 100;

  return {
    // Inputs
    daysWorked,
    hoursWorked,
    overtimeHours,
    annualLeaveTaken,
    sickLeaveTaken,

    // Calculated
    basicSalary,
    overtimePay,
    grossPay,
    annualizedGross,
    annualTax,
    paye: monthlyPAYE,
    sscEmployee,
    sscEmployer,
    ecf,
    totalDeductions,
    netPay,
    totalEmployerCost
  };
}

/**
 * Calculate payroll summary totals across all payslips.
 *
 * @param {Array} payslips - Array of calculated payslip objects
 * @returns {Object} Summary totals
 */
function calculatePayrollSummary(payslips) {
  return payslips.reduce((totals, p) => {
    totals.totalGrossPay     += p.grossPay;
    totals.totalNetPay       += p.netPay;
    totals.totalPAYE         += p.paye;
    totals.totalSSCEmployee  += p.sscEmployee;
    totals.totalSSCEmployer  += p.sscEmployer;
    totals.totalECF          += p.ecf;
    totals.totalEmployerCost += p.totalEmployerCost;
    return totals;
  }, {
    totalGrossPay: 0,
    totalNetPay: 0,
    totalPAYE: 0,
    totalSSCEmployee: 0,
    totalSSCEmployer: 0,
    totalECF: 0,
    totalEmployerCost: 0,
    employeeCount: payslips.length
  });
}

/**
 * Format a number as Namibian Dollars string (e.g. "N$ 1,234.56")
 *
 * @param {number} amount
 * @returns {string}
 */
function formatNAD(amount) {
  if (isNaN(amount) || amount === null || amount === undefined) return 'N$ 0.00';
  return 'N$ ' + Number(amount).toLocaleString('en-NA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

module.exports = {
  calculateAnnualPAYE,
  calculateMonthlyPAYE,
  calculateSSC,
  calculateECF,
  calculateOvertimePay,
  calculateEmployeePayroll,
  calculatePayrollSummary,
  formatNAD
};
