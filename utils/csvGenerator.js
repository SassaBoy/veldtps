/**
 * csvGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates bank transfer CSV files and compliance CSV exports.
 * Format compatible with FNB and Standard Bank Namibia bulk payment uploads.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { stringify } = require('csv-stringify');
const moment = require('moment-timezone');

/**
 * Generate a bank transfer CSV for net pay disbursement.
 * Uses a generic format compatible with FNB/Standard Bank bulk payments.
 *
 * @param {Object} payrollRun  - PayrollRun document
 * @param {Object} companyUser - Company user document
 * @returns {Promise<string>}  - CSV string
 */
function generateBankTransferCSV(payrollRun, companyUser) {
  return new Promise((resolve, reject) => {
    const monthName = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2, '0')}-01`).format('MMM YYYY');
    const paymentDate = moment().tz('Africa/Windhoek').format('DD/MM/YYYY');

    const rows = payrollRun.payslips.map(ps => ({
      'Beneficiary Name': ps.employeeSnapshot?.fullName || '',
      'Reference': `Salary ${monthName}`,
      'Amount (NAD)': ps.netPay.toFixed(2),
      'Notification Email': ps.employeeSnapshot?.email || '',
      'Notification Phone': ps.employeeSnapshot?.phone || '',
      'Payment Date': paymentDate
    }));

    stringify(rows, { header: true }, (err, output) => {
      if (err) return reject(err);
      resolve(output);
    });
  });
}

/**
 * Generate a compliance summary CSV (PAYE + SSC for each employee).
 *
 * @param {Object} payrollRun  - PayrollRun document
 * @param {Object} companyUser - Company user document
 * @returns {Promise<string>}  - CSV string
 */
function generateComplianceCSV(payrollRun, companyUser) {
  return new Promise((resolve, reject) => {
    const monthName = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2, '0')}-01`).format('MMMM YYYY');

    const rows = payrollRun.payslips.map(ps => ({
      'Company': companyUser.companyName,
      'Period': monthName,
      'Employee Name': ps.employeeSnapshot?.fullName || '',
      'ID Number': ps.employeeSnapshot?.idNumber || '',
      'Basic Salary (NAD)': ps.basicSalary.toFixed(2),
      'Gross Pay (NAD)': ps.grossPay.toFixed(2),
      'PAYE (NAD)': ps.paye.toFixed(2),
      'SSC Employee (NAD)': ps.sscEmployee.toFixed(2),
      'SSC Employer (NAD)': ps.sscEmployer.toFixed(2),
      'ECF (NAD)': ps.ecf.toFixed(2),
      'Net Pay (NAD)': ps.netPay.toFixed(2),
      'Total Employer Cost (NAD)': ps.totalEmployerCost.toFixed(2)
    }));

    // Add totals row
    rows.push({
      'Company': '',
      'Period': 'TOTALS',
      'Employee Name': `${payrollRun.employeeCount} employees`,
      'ID Number': '',
      'Basic Salary (NAD)': '',
      'Gross Pay (NAD)': payrollRun.totalGrossPay.toFixed(2),
      'PAYE (NAD)': payrollRun.totalPAYE.toFixed(2),
      'SSC Employee (NAD)': payrollRun.totalSSCEmployee.toFixed(2),
      'SSC Employer (NAD)': payrollRun.totalSSCEmployer.toFixed(2),
      'ECF (NAD)': payrollRun.totalECF.toFixed(2),
      'Net Pay (NAD)': payrollRun.totalNetPay.toFixed(2),
      'Total Employer Cost (NAD)': payrollRun.totalEmployerCost.toFixed(2)
    });

    stringify(rows, { header: true }, (err, output) => {
      if (err) return reject(err);
      resolve(output);
    });
  });
}

module.exports = { generateBankTransferCSV, generateComplianceCSV };
