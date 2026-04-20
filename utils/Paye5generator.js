/**
 * utils/paye5Generator.js – Veldt Payroll
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates the official Namibian P.A.Y.E.5 Employee's Tax Certificate.
 *
 * WHAT IS THE PAYE5?
 *   The PAYE5 (also called the "Employee's Tax Certificate") is issued by
 *   every employer to every employee at the end of each tax year
 *   (1 March – 28/29 February). The employee uses it to file their annual
 *   income tax return (ITX300) with NamRA.
 *
 * NamRA REQUIREMENTS:
 *   - Must show the employer's PAYE File Number and TIN.
 *   - Must show the employee's TIN and ID number.
 *   - Must show gross remuneration broken down by income code.
 *   - Must show all tax-deductible contributions (pension, provident, retirement,
 *     study policy, medical aid, SSC).
 *   - Must show annual taxable income and annual PAYE deducted.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const PDFDocument = require('pdfkit');
const moment      = require('moment-timezone');

// ── Page geometry (A4) ────────────────────────────────────────────────────────
const PAGE_W = 595;
const PAGE_H = 842;
const ML     = 40;
const MR     = 40;
const INNER  = PAGE_W - ML - MR;

// ── Palette — pure black & white per NamRA official document standard ─────────
const BLACK  = '#000000';
const WHITE  = '#ffffff';
const LGRAY  = '#999999';   // footnotes and secondary labels only

// ── Dot leader for blank fields ───────────────────────────────────────────────
const DOTS = '……………………………………………………………………………………………………………………………………………………';

// ─── Drawing helpers ──────────────────────────────────────────────────────────

function hRule(doc, y, x1 = ML, x2 = ML + INNER, t = 0.5) {
  doc.save().moveTo(x1, y).lineTo(x2, y)
     .strokeColor(BLACK).lineWidth(t).stroke().restore();
}

function vRule(doc, x, y1, y2, t = 0.5) {
  doc.save().moveTo(x, y1).lineTo(x, y2)
     .strokeColor(BLACK).lineWidth(t).stroke().restore();
}

function borderRect(doc, x, y, w, h, t = 0.6) {
  doc.save().rect(x, y, w, h).strokeColor(BLACK).lineWidth(t).stroke().restore();
}

function sectionHeader(doc, title, y, extraRight = '') {
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(title, ML + 3, y, { lineBreak: false });
  if (extraRight) {
    doc.font('Helvetica').fontSize(8).fillColor(BLACK)
       .text(extraRight, ML, y, { width: INNER - 3, align: 'right', lineBreak: false });
  }
  const lineY = y + 13;
  hRule(doc, lineY, ML, ML + INNER, 0.6);
  return lineY + 4;
}

function labelRow(doc, label, value, y, rowH = 16, code = '', labelW = 200) {
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text(label, ML + 3, y + 3, { width: labelW - 6, lineBreak: false });

  const valX = ML + labelW;
  const valW = INNER - labelW - (code ? 32 : 3);

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text(DOTS, valX, y + 3, { width: valW, lineBreak: false });

  if (value && String(value).trim() && String(value).trim() !== '—') {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
       .text(String(value).trim(), valX + 2, y + 3,
         { width: valW - 4, lineBreak: false, ellipsis: true });
  }

  if (code) {
    doc.font('Helvetica').fontSize(7).fillColor(LGRAY)
       .text(code, ML + INNER - 30, y + 4, { width: 30, align: 'right', lineBreak: false });
  }

  hRule(doc, y + rowH - 1, ML, ML + INNER, 0.3);
  return y + rowH;
}

function amountRow(doc, description, code, amount, y, rowH = 16) {
  const amt    = parseFloat(amount) || 0;
  const fmtAmt = amt === 0 ? '' : fmtNAD(amt);

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text(description, ML + 3, y + 4, { width: INNER * 0.58, lineBreak: false });

  if (code) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(LGRAY)
       .text(code, ML + INNER * 0.60, y + 4, { width: 45, lineBreak: false });
  }

  if (fmtAmt) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
       .text(fmtAmt, ML, y + 4, { width: INNER - 3, align: 'right', lineBreak: false });
  }

  hRule(doc, y + rowH - 1, ML, ML + INNER, 0.25);
  return y + rowH;
}

function totalRow(doc, label, amount, y) {
  const H = 18;
  hRule(doc, y,     ML, ML + INNER, 0.8);
  hRule(doc, y + H, ML, ML + INNER, 0.8);

  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text(label, ML + 3, y + 5, { width: INNER * 0.6, lineBreak: false });

  if (amount !== null && amount !== undefined) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
       .text(fmtNAD(amount), ML, y + 5, { width: INNER - 3, align: 'right', lineBreak: false });
  }

  return y + H + 2;
}

function fmtNAD(n) {
  const v = parseFloat(n) || 0;
  return 'N$ ' + v.toLocaleString('en-NA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: Generate a single PAYE5 certificate
// ─────────────────────────────────────────────────────────────────────────────

function generatePAYE5Certificate(annualData, employee, companyUser, taxYear, stream) {

  const doc = new PDFDocument({
    margin: 0,
    size: 'A4',
    info: { Title: `PAYE5 Tax Certificate ${taxYear}/${taxYear + 1}` }
  });
  doc.pipe(stream);

  doc.rect(0, 0, PAGE_W, PAGE_H).fill(WHITE);

  const certNo     = `PAYE5-${taxYear}-${String(employee.idNumber || '').replace(/\D/g,'').slice(-6)}`;
  const taxYearStr = `${taxYear}/${taxYear + 1}`;

  let y = 28;

  // ── TOP IDENTIFIER ────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(16).fillColor(BLACK)
     .text('P.A.Y.E.5', ML, y, { lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor(LGRAY)
     .text(`Cert No: ${certNo}`, ML, y + 4, { width: INNER, align: 'right', lineBreak: false });

  y += 22;

  // ── OFFICIAL HEADING ──────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BLACK)
     .text('REPUBLIC OF NAMIBIA', ML, y, { width: INNER, align: 'center' });
  y += 14;

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BLACK)
     .text('NAMIBIA REVENUE AGENCY (NamRA)', ML, y, { width: INNER, align: 'center' });
  y += 13;

  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BLACK)
     .text("EMPLOYEE'S TAX CERTIFICATE", ML, y, { width: INNER, align: 'center' });
  y += 13;

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BLACK)
     .text(`YEAR OF ASSESSMENT  ${taxYearStr}`, ML, y, { width: INNER, align: 'center' });
  y += 13;

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text(`(1 March ${taxYear} to 28/29 February ${taxYear + 1})`, ML, y, { width: INNER, align: 'center' });
  y += 6;

  hRule(doc, y, ML, ML + INNER, 1.2);
  y += 12;

  // ── SECTION A: EMPLOYER DETAILS ───────────────────────────────────────────
  y = sectionHeader(doc, 'A — EMPLOYER DETAILS', y);

  y = labelRow(doc, 'PAYE File Number / Employer Registration No.',
    companyUser.payeRegNo || companyUser.companyRegistrationNumber || '', y, 16, '', 215);
  y = labelRow(doc, 'Employer TIN (Tax Identification Number)',
    companyUser.tinNumber || '', y, 16, '', 215);
  y = labelRow(doc, 'Registered Name of Employer',
    companyUser.companyName || '', y, 16, '', 215);
  y = labelRow(doc, 'Postal Address',
    companyUser.postalAddress || companyUser.address || '', y, 16, '', 215);
  y = labelRow(doc, 'Email Address',
    companyUser.email || '', y, 16, '', 215);
  y = labelRow(doc, 'Telephone Number',
    companyUser.companyPhone || companyUser.phone || '', y, 16, '', 215);
  y += 8;

  hRule(doc, y, ML, ML + INNER, 0.6);
  y += 12;

  // ── SECTION B: EMPLOYEE DETAILS ───────────────────────────────────────────
  y = sectionHeader(doc, 'B — EMPLOYEE DETAILS', y);

  const col2X = ML + INNER / 2 + 5;
  const colW  = INNER / 2 - 5;

  doc.font('Helvetica').fontSize(7.5).fillColor(BLACK)
     .text('INCOME TAX FILE / TIN NUMBER', ML + 3, y + 3);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text(employee.tinNumber || '—', ML + 3, y + 13);

  doc.font('Helvetica').fontSize(7.5).fillColor(BLACK)
     .text('NAMIBIAN ID NUMBER', col2X + 3, y + 3);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text(employee.idNumber || '—', col2X + 3, y + 13);

  vRule(doc, col2X - 3, y, y + 30, 0.4);
  hRule(doc, y + 30, ML, ML + INNER, 0.4);
  y += 34;

  const nameParts = (employee.fullName || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const surname   = nameParts.slice(1).join(' ') || '';
  const initials  = firstName ? firstName[0].toUpperCase() + '.' : '';

  doc.font('Helvetica').fontSize(7.5).fillColor(BLACK)
     .text('INITIALS AND SURNAME', ML + 3, y + 3);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text(`${initials} ${surname}`.trim() || '—', ML + 3, y + 13);

  doc.font('Helvetica').fontSize(7.5).fillColor(BLACK)
     .text('FIRST NAMES IN FULL', col2X + 3, y + 3);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text(employee.fullName || '—', col2X + 3, y + 13);

  vRule(doc, col2X - 3, y, y + 30, 0.4);
  hRule(doc, y + 30, ML, ML + INNER, 0.4);
  y += 34;

  doc.font('Helvetica').fontSize(7.5).fillColor(BLACK)
     .text('POSITION / DESIGNATION', ML + 3, y + 3);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(employee.position || '—', ML + 3, y + 13);

  doc.font('Helvetica').fontSize(7.5).fillColor(BLACK)
     .text('DEPARTMENT', col2X + 3, y + 3);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(employee.department || '—', col2X + 3, y + 13);

  vRule(doc, col2X - 3, y, y + 30, 0.4);
  hRule(doc, y + 30, ML, ML + INNER, 0.4);
  y += 34;

  const dateJoined = employee.dateJoined
    ? moment(employee.dateJoined).format('DD/MM/YYYY')
    : '—';
  const periodFrom = `01/03/${taxYear}`;
  const periodTo   = `28/02/${taxYear + 1}`;

  doc.font('Helvetica').fontSize(7.5).fillColor(BLACK)
     .text('DATE EMPLOYED (Date Joined)', ML + 3, y + 3);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(dateJoined, ML + 3, y + 13);

  doc.font('Helvetica').fontSize(7.5).fillColor(BLACK)
     .text('PERIOD OF THIS ASSESSMENT', col2X + 3, y + 3);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(`${periodFrom}  TO  ${periodTo}`, col2X + 3, y + 13);

  vRule(doc, col2X - 3, y, y + 30, 0.4);
  hRule(doc, y + 30, ML, ML + INNER, 0.6);
  y += 38;

  // ── SECTION C: REMUNERATION (INCOME) ──────────────────────────────────────
  y = sectionHeader(doc, 'C — REMUNERATION RECEIVED', y, 'NamRA Code');

  y = amountRow(doc, 'Salaries, Wages & Pension (basic salary + adjusted for unpaid leave)',
    '3601', annualData.annualSalary || 0, y);

  y = amountRow(doc, 'Overtime Income (overtime hours × overtime rate)',
    '3602', annualData.annualOTPay || 0, y);

  y = amountRow(doc, 'Taxable Allowances (custom taxable pay items)',
    '3605', annualData.annualTaxAllow || 0, y);

  y = amountRow(doc, 'Non-Taxable / Exempt Allowances (e.g. travel reimbursements)',
    '3713', annualData.annualNonTaxAllow || 0, y);

  y = amountRow(doc,
    `Housing Fringe Benefit (${employee.housingType === 'free' ? 'Free Housing' : employee.housingType === 'subsidised' ? 'Subsidised Housing' : 'None'})`,
    '3701', annualData.annualHousingFringe || 0, y);

  y = amountRow(doc,
    `Company Vehicle Fringe Benefit (${employee.hasCompanyVehicle ? 'Company Vehicle Provided' : 'None'})`,
    '3802', annualData.annualVehicleFringe || 0, y);

  y = amountRow(doc, 'Other Income (commission, bonuses, etc.)', '3699', 0, y);

  y += 4;
  y = totalRow(doc, 'GROSS REMUNERATION (total before any deductions)', annualData.annualGross || 0, y);
  y += 10;

  // ── SECTION D: DEDUCTIONS ─────────────────────────────────────────────────
  y = sectionHeader(doc, 'D — DEDUCTIONS / CONTRIBUTIONS', y, 'NamRA Code');

  const annualPension = annualData.annualPension || ((employee.pensionContribution || 0) * 12);
  y = amountRow(doc,
    `Pension Fund — ${employee.pensionFundName || 'N/A'} (Reg: ${employee.pensionFundRegNo || '—'})`,
    '4001', annualPension, y);

  // UPDATED: New fund deductions with correct NamRA codes
  if (annualData.annualProvident > 0) {
    y = amountRow(doc,
      `Provident Fund — ${employee.providentFundName || 'N/A'} (Reg: ${employee.providentFundRegNo || '—'})`,
      '4002', annualData.annualProvident, y);
  }

  if (annualData.annualRetirement > 0) {
    y = amountRow(doc,
      `Retirement Fund — ${employee.retirementFundName || 'N/A'} (Reg: ${employee.retirementFundRegNo || '—'})`,
      '4003', annualData.annualRetirement, y);
  }

  if (annualData.annualStudy > 0) {
    y = amountRow(doc,
      `Study Policy — ${employee.studyPolicyName || 'N/A'} (Reg: ${employee.studyPolicyRegNo || '—'})`,
      '4004', annualData.annualStudy, y);
  }

  const annualMedical = annualData.annualMedical || ((employee.medicalAidContribution || 0) * 12);
  y = amountRow(doc,
    `Medical Aid — ${employee.medicalAidFundName || 'N/A'} (Member No: ${employee.medicalAidMemberNo || '—'})`,
    '4025', annualMedical, y);

  y = amountRow(doc,
    'Social Security Contribution (SSC) — Employee Share (0.9% of taxable gross, max N$99/month)',
    '4115', annualData.annualSSCEmployee || 0, y);

  y += 4;
  y = totalRow(doc, 'TOTAL DEDUCTIONS (pension + provident + retirement + study + medical + SSC)', 
               annualData.annualDeductions || 0, y);
  y += 10;

  // ── SECTION E: TAX COMPUTATION ────────────────────────────────────────────
  y = sectionHeader(doc, 'E — TAX COMPUTATION', y, 'NamRA Code');

  y = amountRow(doc,
    'Taxable Income (Gross Remuneration − Deductions)',
    '3697', annualData.taxableIncome || 0, y);

  y = amountRow(doc,
    'Tax Payable (per NamRA progressive tax table)',
    '3698', annualData.annualPAYE || 0, y);

  y += 6;

  const pAYEH = 26;
  doc.rect(ML, y, INNER, pAYEH).fill(BLACK);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(WHITE)
     .text("TOTAL EMPLOYEES' TAX (P.A.Y.E) DEDUCTED FOR THE YEAR", ML + 8, y + 8);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(WHITE)
     .text(fmtNAD(annualData.annualPAYE || 0), ML, y + 7, { width: INNER - 8, align: 'right' });
  y += pAYEH + 14;

  // ── SECTION F: DECLARATION ────────────────────────────────────────────────
  hRule(doc, y, ML, ML + INNER, 0.6);
  y += 10;

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text('F — DECLARATION BY EMPLOYER', ML + 3, y);
  y += 16;

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text(
       'I hereby certify that the particulars given in this certificate are correct and complete ' +
       'in every respect, and that the amounts shown represent the remuneration paid and the ' +
       'employees\' tax deducted during the above-mentioned year of assessment.',
       ML + 3, y, { width: INNER - 6, lineBreak: true }
     );
  y += 30;

  const sigW = (INNER - 30) / 3;
  const sigY = y;

  ['AUTHORISED SIGNATORY', "EMPLOYER'S STAMP", `DATE: ${moment().format('DD / MM / YYYY')}`].forEach((lbl, i) => {
    const sx = ML + i * (sigW + 15);
    hRule(doc, sigY + 22, sx, sx + sigW, 0.6);
    doc.font(i === 2 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(BLACK)
       .text(lbl, sx, sigY + 26, { width: sigW, align: 'center' });
  });

  y += 54;

  hRule(doc, y, ML, ML + INNER, 0.4);
  y += 8;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(BLACK)
     .text('IMPORTANT NOTICE TO EMPLOYEE:', ML + 3, y);
  y += 10;
  doc.font('Helvetica').fontSize(7.2).fillColor(BLACK)
     .text(
       'This certificate is issued in terms of Section 83 of the Income Tax Act, 1981. ' +
       'You MUST attach this original certificate to your annual individual income tax return (ITX300) ' +
       'when submitting to NamRA. Failure to do so may result in your return being rejected. ' +
       'Please retain a photocopy for your own records. If you believe any amount on this ' +
       'certificate is incorrect, contact your employer immediately.',
       ML + 3, y, { width: INNER - 6, lineBreak: true }
     );

  const footY = PAGE_H - 20;
  hRule(doc, footY - 8, ML, ML + INNER, 0.3);
  doc.font('Helvetica').fontSize(6.5).fillColor(LGRAY)
     .text('Generated by Veldt Payroll  ·  Income Tax Act, 1981 (as amended)  ·  Social Security Act 34 of 1994',
       ML, footY);
  doc.font('Helvetica').fontSize(6.5).fillColor(LGRAY)
     .text(moment().format('DD MMMM YYYY, HH:mm'), ML, footY, { width: INNER, align: 'right' });

  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK: Generate PAYE5 certificates for all employees in a zip archive
// ─────────────────────────────────────────────────────────────────────────────

function appendAllPAYE5ToZip(payrollRuns, employees, companyUser, taxYear, archive) {
  const { PassThrough } = require('stream');

  const empMap = {};
  employees.forEach(emp => { empMap[emp._id.toString()] = emp; });

  const annualMap = {};

  for (const run of payrollRuns) {
    for (const ps of run.payslips || []) {
      const empId = ps.employee?.toString();
      if (!empId) continue;

      if (!annualMap[empId]) {
        annualMap[empId] = {
          annualSalary:        0,
          annualOTPay:         0,
          annualTaxAllow:      0,
          annualNonTaxAllow:   0,
          annualHousingFringe: 0,
          annualVehicleFringe: 0,
          annualGross:         0,
          annualTaxGross:      0,
          annualPAYE:          0,
          annualSSCEmployee:   0,
          annualPension:       0,
          annualProvident:     0,      // NEW
          annualRetirement:    0,      // NEW
          annualStudy:         0,      // NEW
          annualMedical:       0,
        };
      }

      const a = annualMap[empId];
      a.annualSalary        += ps.basicSalary              || 0;
      a.annualOTPay         += ps.overtimePay               || 0;
      a.annualTaxAllow      += ps.taxableAllowances         || 0;
      a.annualNonTaxAllow   += ps.nonTaxableAllowances      || 0;
      a.annualHousingFringe += ps.housingFringeBenefit      || 0;
      a.annualVehicleFringe += ps.vehicleFringeBenefit      || 0;
      a.annualGross         += ps.grossPay                  || 0;
      a.annualTaxGross      += ps.taxableGross              || 0;
      a.annualPAYE          += ps.paye                      || 0;
      a.annualSSCEmployee   += ps.sscEmployee               || 0;
      a.annualPension       += ps.pensionMonthly            || 0;
      a.annualProvident     += ps.providentMonthly          || 0;   // NEW
      a.annualRetirement    += ps.retirementMonthly         || 0;   // NEW
      a.annualStudy         += ps.studyMonthly              || 0;   // NEW
      a.annualMedical       += ps.medicalMonthly            || 0;
    }
  }

  for (const [empId, a] of Object.entries(annualMap)) {
    const emp = empMap[empId] || {};

    a.annualDeductions = Math.round(
      (a.annualPension + a.annualProvident + a.annualRetirement + a.annualStudy + 
       a.annualMedical + a.annualSSCEmployee) * 100
    ) / 100;

    a.taxableIncome = Math.max(
      0,
      Math.round((a.annualTaxGross - a.annualPension - a.annualProvident - 
                  a.annualRetirement - a.annualStudy - a.annualMedical) * 100) / 100
    );

    for (const key of Object.keys(a)) {
      if (typeof a[key] === 'number') a[key] = Math.round(a[key] * 100) / 100;
    }
  }

  for (const [empId, annualData] of Object.entries(annualMap)) {
    const emp = empMap[empId];
    if (!emp) continue;

    const safeName = (emp.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
    const pdfStream = new PassThrough();

    generatePAYE5Certificate(annualData, emp, companyUser, taxYear, pdfStream);
    archive.append(pdfStream, { name: `PAYE5_${safeName}_${taxYear}.pdf` });
  }
}

module.exports = { generatePAYE5Certificate, appendAllPAYE5ToZip };