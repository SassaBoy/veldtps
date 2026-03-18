/**
 * pdfGenerator.js - Enhanced Professional Version
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates premium, internationally-standard payslips and compliance reports.
 * Clean, modern design matching your employee index aesthetic.
 *
 * DISCLAIMER: Payroll calculations are for guidance only.
 * Always verify with NamRA and Social Security before final submission.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PDFDocument = require('pdfkit');
const moment = require('moment-timezone');
const { formatNAD } = require('./payrollCalculator');

const BRAND_COLOR = '#1a5276';      // Deep navy
const ACCENT_COLOR = '#2980b9';     // Professional blue
const ACCENT_LIGHT = '#3498db';
const LIGHT_GRAY = '#f8f9fa';
const MID_GRAY = '#95a5a6';
const TEXT_DARK = '#2c3e50';
const SOFT_GRAY = '#ecf0f1';

const DISCLAIMER = 'DISCLAIMER: Payroll calculations are for guidance only. Always verify with NamRA and Social Security before final submission.';

/**
 * Draw a subtle horizontal rule
 */
function drawRule(doc, y, color = MID_GRAY, width = 495, thickness = 0.8) {
  doc.moveTo(50, y).lineTo(50 + width, y).strokeColor(color).lineWidth(thickness).stroke();
}

/**
 * Draw a clean labeled row (label left, value right aligned)
 */
function drawRow(doc, label, value, y, bold = false, color = TEXT_DARK, size = 9.5) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
  doc.text(label, 60, y, { width: 200 });
  doc.text(value, 380, y, { width: 165, align: 'right' });
}

/**
 * Modern section header with subtle accent bar
 */
function drawSectionHeader(doc, title, y) {
  // Soft accent underline bar
  doc.rect(50, y, 495, 3).fill(ACCENT_COLOR);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_COLOR);
  doc.text(title.toUpperCase(), 52, y + 12, { letterSpacing: 0.5 });
  return y + 28;
}

function generatePayslipPDF(payslip, companyUser, month, year, stream) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(stream);

  const monthName = moment(`${year}-${String(month).padStart(2, '0')}-01`).format('MMMM YYYY');

  // ─── Premium Header ───────────────────────────────────────────────────────
  // Subtle gradient header
  const grad = doc.linearGradient(0, 0, 0, 92);
  grad.stop(0, BRAND_COLOR).stop(1, '#0f3a55');
  doc.rect(0, 0, 595, 92).fill(grad);

  doc.font('Helvetica-Bold').fontSize(28).fillColor('#ffffff');
  doc.text('PAYSLIP', 52, 28, { letterSpacing: -0.8 });

  doc.font('Helvetica').fontSize(11).fillColor('#e0f0ff');
  doc.text(companyUser.companyName.toUpperCase(), 52, 58);

  doc.font('Helvetica').fontSize(10.5).fillColor('#ffffff');
  doc.text(monthName, 395, 32, { width: 160, align: 'right' });

  let y = 120;

  // ─── Employee Details ─────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Employee Details', y);

  const snap = payslip.employeeSnapshot || {};
  const fields = [
    ['Employee Name', snap.fullName || ''],
    ['ID Number',     snap.idNumber || ''],
    ['Position',      snap.position || ''],
    ['Department',    snap.department || ''],
    ['Email',         snap.email || ''],
    ['Phone',         snap.phone || '']
  ];

  fields.forEach(([label, value]) => {
    drawRow(doc, label, value, y);
    y += 17;
  });

  y += 12;
  drawRule(doc, y);
  y += 18;

  // ─── Earnings ─────────────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Earnings', y);

  drawRow(doc, 'Basic Salary', formatNAD(payslip.basicSalary), y, false, TEXT_DARK, 10);
  y += 17;

  if (payslip.overtimePay > 0) {
    drawRow(doc, `Overtime Pay (${payslip.overtimeHours} hrs)`, formatNAD(payslip.overtimePay), y, false, TEXT_DARK, 10);
    y += 17;
  }

  drawRule(doc, y, ACCENT_LIGHT, 495, 1.2);
  y += 9;
  drawRow(doc, 'GROSS PAY', formatNAD(payslip.grossPay), y, true, BRAND_COLOR, 11.5);
  y += 22;

  // ─── Deductions ───────────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Deductions', y);

  drawRow(doc, 'PAYE (Income Tax)', formatNAD(payslip.paye), y, false, TEXT_DARK, 10);
  y += 17;
  drawRow(doc, `SSC – Employee (0.9%)`, formatNAD(payslip.sscEmployee), y, false, TEXT_DARK, 10);
  y += 17;

  drawRule(doc, y, ACCENT_LIGHT, 495, 1.2);
  y += 9;
  drawRow(doc, 'TOTAL DEDUCTIONS', formatNAD(payslip.totalDeductions), y, true, '#c0392b', 11);
  y += 22;

  // ─── Net Pay ──────────────────────────────────────────────────────────────
  // Elegant highlighted box
  doc.rect(50, y, 495, 42).fill(ACCENT_COLOR).strokeColor('#ffffff').lineWidth(1.5).stroke();
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff');
  doc.text('NET PAY', 68, y + 14);
  doc.text(formatNAD(payslip.netPay), 380, y + 14, { width: 155, align: 'right' });
  y += 55;

  // ─── Employer Contributions ───────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Employer Contributions (For Information Only)', y);

  drawRow(doc, 'SSC – Employer (0.9%)', formatNAD(payslip.sscEmployer), y, false, TEXT_DARK, 9.8);
  y += 17;
  drawRow(doc, 'Employer Compensation Fund (ECF)', formatNAD(payslip.ecf), y, false, TEXT_DARK, 9.8);
  y += 17;
  drawRow(doc, 'Total Employer Cost', formatNAD(payslip.totalEmployerCost), y, true, BRAND_COLOR, 10.2);
  y += 26;

  // ─── Leave Summary ────────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Leave Taken This Month', y);

  drawRow(doc, 'Annual Leave Taken', `${payslip.annualLeaveTaken || 0} day(s)`, y);
  y += 17;
  drawRow(doc, 'Sick Leave Taken', `${payslip.sickLeaveTaken || 0} day(s)`, y);
  y += 26;

  // ─── Tax Note ─────────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(8).fillColor('#7f8c8d');
  doc.text(`PAYE calculation: Annualized gross = ${formatNAD(payslip.annualizedGross)} | Annual tax = ${formatNAD(payslip.annualTax)} | Monthly PAYE = Annual tax ÷ 12`, 52, y, { width: 490 });
  y += 18;

  // ─── Disclaimer ───────────────────────────────────────────────────────────
  doc.rect(50, y, 495, 36).fill(SOFT_GRAY).strokeColor(MID_GRAY).lineWidth(0.5).stroke();
  doc.font('Helvetica-Oblique').fontSize(7.8).fillColor('#555');
  doc.text(DISCLAIMER, 58, y + 9, { width: 480, align: 'left' });
  y += 48;

  // ─── Footer ───────────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(8).fillColor(MID_GRAY);
  doc.text(`Generated by NamPayroll • ${moment().tz('Africa/Windhoek').format('DD MMMM YYYY HH:mm')}`, 50, 780, { align: 'center', width: 495 });

  doc.end();
  return doc;
}

function generateCompliancePDF(payrollRun, companyUser, stream) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(stream);

  const monthName = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2, '0')}-01`).format('MMMM YYYY');

  // ─── Premium Header ───────────────────────────────────────────────────────
  const grad = doc.linearGradient(0, 0, 0, 92);
  grad.stop(0, BRAND_COLOR).stop(1, '#0f3a55');
  doc.rect(0, 0, 595, 92).fill(grad);

  doc.font('Helvetica-Bold').fontSize(21).fillColor('#ffffff');
  doc.text('MONTHLY PAYROLL COMPLIANCE SUMMARY', 52, 24, { width: 480 });

  doc.font('Helvetica').fontSize(11).fillColor('#e0f0ff');
  doc.text(companyUser.companyName.toUpperCase(), 52, 55);
  doc.text(monthName, 395, 55, { width: 160, align: 'right' });

  let y = 120;

  // ─── Company Info ─────────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Company Details', y);

  drawRow(doc, 'Company Name', companyUser.companyName, y);
  y += 17;
  drawRow(doc, 'Contact Email', companyUser.email, y);
  y += 17;
  drawRow(doc, 'Period', monthName, y);
  y += 17;
  drawRow(doc, 'Employees Processed', String(payrollRun.employeeCount), y, true);
  y += 26;

  // ─── PAYE Summary ─────────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'PAYE (Income Tax) – For Submission to NamRA', y);

  drawRow(doc, 'Total Gross Pay', formatNAD(payrollRun.totalGrossPay), y);
  y += 17;
  drawRow(doc, 'Total PAYE Withheld', formatNAD(payrollRun.totalPAYE), y, true, BRAND_COLOR, 11);
  y += 26;

  // ─── SSC Summary ──────────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Social Security Contributions (SSC)', y);

  drawRow(doc, 'Total Employee SSC (0.9%)', formatNAD(payrollRun.totalSSCEmployee), y);
  y += 17;
  drawRow(doc, 'Total Employer SSC (0.9%)', formatNAD(payrollRun.totalSSCEmployer), y);
  y += 17;
  drawRow(doc, 'Total SSC (Employee + Employer)', formatNAD(payrollRun.totalSSCEmployee + payrollRun.totalSSCEmployer), y, true);
  y += 26;

  // ─── ECF Summary ──────────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Employer Compensation Fund (ECF)', y);

  drawRow(doc, 'Total ECF Contribution', formatNAD(payrollRun.totalECF), y, true);
  y += 26;

  // ─── Payroll Summary ──────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Payroll Summary', y);

  drawRow(doc, 'Total Gross Pay', formatNAD(payrollRun.totalGrossPay), y);
  y += 17;
  drawRow(doc, 'Total Net Pay (to employees)', formatNAD(payrollRun.totalNetPay), y);
  y += 17;
  drawRow(doc, 'Total Employer Cost (Gross + SSC + ECF)', formatNAD(payrollRun.totalEmployerCost), y, true, BRAND_COLOR, 11);
  y += 26;

  // ─── Employee Breakdown Table ─────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Employee Breakdown', y);

  // Table header (modern, subtle background)
  doc.rect(50, y, 495, 19).fill('#f1f4f7');
  doc.font('Helvetica-Bold').fontSize(8.2).fillColor(TEXT_DARK);
  doc.text('Employee', 56, y + 6);
  doc.text('Gross Pay', 255, y + 6, { width: 80, align: 'right' });
  doc.text('PAYE', 335, y + 6, { width: 65, align: 'right' });
  doc.text('SSC (Emp)', 400, y + 6, { width: 55, align: 'right' });
  doc.text('Net Pay', 455, y + 6, { width: 85, align: 'right' });
  y += 24;

  payrollRun.payslips.forEach((ps, i) => {
    if (i % 2 === 0) {
      doc.rect(50, y - 2, 495, 15).fill('#fafbfc');
    }
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK);
    doc.text(ps.employeeSnapshot?.fullName || 'Unknown', 56, y + 2, { width: 190 });
    doc.text(formatNAD(ps.grossPay), 255, y + 2, { width: 80, align: 'right' });
    doc.text(formatNAD(ps.paye), 335, y + 2, { width: 65, align: 'right' });
    doc.text(formatNAD(ps.sscEmployee), 400, y + 2, { width: 55, align: 'right' });
    doc.text(formatNAD(ps.netPay), 455, y + 2, { width: 85, align: 'right' });
    y += 15.5;
  });

  y += 12;

  // ─── Disclaimer ───────────────────────────────────────────────────────────
  doc.rect(50, y, 495, 38).fill(SOFT_GRAY).strokeColor(MID_GRAY).lineWidth(0.5).stroke();
  doc.font('Helvetica-Oblique').fontSize(7.8).fillColor('#555');
  doc.text(DISCLAIMER, 58, y + 10, { width: 480 });

  // ─── Footer ───────────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(8).fillColor(MID_GRAY);
  doc.text(`Generated by NamPayroll • ${moment().tz('Africa/Windhoek').format('DD MMMM YYYY HH:mm')}`, 50, 780, { align: 'center', width: 495 });

  doc.end();
  return doc;
}

module.exports = { generatePayslipPDF, generateCompliancePDF };