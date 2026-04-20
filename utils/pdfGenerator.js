/**
 * utils/pdfGenerator.js – Veldt Payroll
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ██████████████████████████████████████████████████████████████████████████
 * PAYSLIP REDESIGN & FIXES IN THIS VERSION
 * ██████████████████████████████████████████████████████████████████████████
 *
 * FIX 1 — FRINGE BENEFITS NOW IN SEPARATE "NON-CASH BENEFITS" SECTION
 *   Fringe benefits (housing, vehicle, custom fringe items) are clearly
 *   separated from cash earnings. They display the note "(Non-cash · Tax only)"
 *   so employees understand they increase taxable income but are not paid out.
 *
 * FIX 2 — GROSS PAY LABEL IS NOW "GROSS CASH PAY"
 *   Renamed to avoid confusion: the N$ figure shown is cash-only gross.
 *   A separate "Taxable Gross (incl. Benefits)" line shows the PAYE base.
 *
 * REDESIGN IMPROVEMENTS:
 *   - Clear section hierarchy: Header → Employee Info → Earnings →
 *     Non-Cash Benefits → Deductions → Net Pay → Employer Info + Leave
 *   - Two-column info layout for better space use
 *   - Statutory vs voluntary deductions grouped and labelled
 *   - Consistent 8pt Helvetica body, bold labels
 *   - Accent-coloured left border on section headers
 *   - PAYE note shows taxable base, not just gross pay
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const PDFDocument   = require('pdfkit');
const moment        = require('moment-timezone');
const path          = require('path');
const fs            = require('fs');
const { formatNAD } = require('./payrollCalculator');

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  pageBg:       '#ffffff',
  black:        '#000000',
  darkGray:     '#111827',
  bodyText:     '#374151',
  medGray:      '#6b7280',
  lightGray:    '#9ca3af',
  border:       '#e5e7eb',
  borderDark:   '#d1d5db',
  rowAlt:       '#f9fafb',
  sectionBg:    '#f3f4f6',
  accentBg:     '#f8fafc',
  headerText:   '#111827',
  green:        '#15803d',
  greenBg:      '#f0fdf4',
  red:          '#b91c1c',
  orange:       '#c2410c',
  blue:         '#1d4ed8',
  fringeBg:     '#fffbeb',   // amber tint for non-cash section
  fringeText:   '#92400e',
  fringeBorder: '#f59e0b',
  deductBg:     '#fef2f2',
  deductBorder: '#fca5a5',
  netBg:        '#111827',   // overridden by accent colour
  voluntaryBg:  '#f0f9ff',
};

const PAGE_W = 595;
const PAGE_H = 842;
const ML     = 36;
const MR     = 36;
const INNER  = PAGE_W - ML - MR;

// ─────────────────────────────────────────────────────────────────────────────
// DRAWING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function tryLogo(doc, logoPath, x, y, maxW = 90, maxH = 30) {
  if (!logoPath) return false;
  try {
    const fullPath = path.join(__dirname, '..', 'public', logoPath);
    if (fs.existsSync(fullPath)) { doc.image(fullPath, x, y, { fit: [maxW, maxH] }); return true; }
  } catch (_) {}
  return false;
}

function hLine(doc, y, color = C.border, thick = 0.5) {
  doc.save().moveTo(ML, y).lineTo(ML + INNER, y).strokeColor(color).lineWidth(thick).stroke().restore();
}

function fullLine(doc, y, color = C.border, thick = 0.5) {
  doc.save().moveTo(0, y).lineTo(PAGE_W, y).strokeColor(color).lineWidth(thick).stroke().restore();
}

/**
 * Section header: coloured left accent bar + label bar
 */
function sectionHeader(doc, title, y, accentColor) {
  const H = 17;
  // Background bar
  doc.rect(ML, y, INNER, H).fill(C.sectionBg);
  // Left accent
  doc.rect(ML, y, 3, H).fill(accentColor);
  // Label
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.headerText)
     .text(title.toUpperCase(), ML + 10, y + 5, { characterSpacing: 0.7, lineBreak: false });
  return y + H + 5;
}

/**
 * Single info field: label | value in two-column layout
 */
function infoKV(doc, label, value, lx, vy, labelW = 70) {
  doc.font('Helvetica').fontSize(6).fillColor(C.lightGray)
     .text(label, lx, vy, { width: labelW, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.darkGray)
     .text(String(value || '—'), lx + labelW, vy, { width: 130, lineBreak: false, ellipsis: true });
}

/**
 * Standard line-item row (earnings / deductions)
 * @param {Object} opts
 *   bold, shade, color, note, tag, rowH
 * Returns new y position
 */
function lineItem(doc, description, amountStr, y, opts = {}) {
  const {
    color    = C.bodyText,
    bold     = false,
    shade    = false,
    note     = null,
    bgColor  = null,
    rowH     = note ? 22 : 16,
  } = opts;

  if (shade || bgColor) {
    doc.rect(ML, y - 1, INNER, rowH + 2).fill(bgColor || C.rowAlt);
  }

  const font = bold ? 'Helvetica-Bold' : 'Helvetica';
  doc.font(font).fontSize(8).fillColor(color)
     .text(description, ML + 10, y, { width: INNER * 0.62, lineBreak: false });

  if (note) {
    doc.font('Helvetica').fontSize(5.5).fillColor(C.lightGray)
       .text(note, ML + 10, y + 9, { width: INNER * 0.62, lineBreak: false });
  }

  doc.font(font).fontSize(8).fillColor(color)
     .text(amountStr || 'N$ 0.00', ML, y, { width: INNER - 10, align: 'right', lineBreak: false });

  return y + rowH;
}

/**
 * Summary row (totals): slightly larger, coloured bg
 */
function summaryLine(doc, label, amountStr, y, opts = {}) {
  const { color = C.darkGray, bgColor = C.sectionBg, height = 20 } = opts;
  doc.rect(ML, y - 1, INNER, height + 2).fill(bgColor);
  hLine(doc, y - 1, C.borderDark, 0.4);
  hLine(doc, y + height + 1, C.borderDark, 0.4);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.headerText)
     .text(label, ML + 10, y + 5, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(color)
     .text(amountStr, ML, y + 5, { width: INNER - 10, align: 'right', lineBreak: false });
  return y + height;
}

/**
 * Fringe benefit row — amber-tinted with non-cash indicator
 */
function fringeLineItem(doc, description, amountStr, y, note = null) {
  const rowH = note ? 22 : 16;
  doc.rect(ML, y - 1, INNER, rowH + 2).fill(C.fringeBg);
  // Left accent
  doc.rect(ML, y - 1, 2, rowH + 2).fill(C.fringeBorder);

  doc.font('Helvetica').fontSize(8).fillColor(C.fringeText)
     .text(description, ML + 10, y, { width: INNER * 0.5, lineBreak: false });
  // Tag
  doc.font('Helvetica').fontSize(5.5).fillColor(C.fringeText)
     .text('NON-CASH · TAX ONLY', ML + 10 + doc.widthOfString(description, { font: 'Helvetica', fontSize: 8 }) + 6, y + 1, { lineBreak: false });

  if (note) {
    doc.font('Helvetica').fontSize(5.5).fillColor(C.lightGray)
       .text(note, ML + 10, y + 9, { width: INNER * 0.55, lineBreak: false });
  }

  doc.font('Helvetica').fontSize(8).fillColor(C.fringeText)
     .text(amountStr, ML, y, { width: INNER - 10, align: 'right', lineBreak: false });

  return y + rowH;
}

/**
 * Footer
 */
function footer(doc, theme, accent) {
  const fy = PAGE_H - 30;
  hLine(doc, fy, C.borderDark, 0.5);
  const note = theme?.footerNote || 'This payslip is a private document. Please retain for your records.';
  doc.font('Helvetica').fontSize(5).fillColor(C.lightGray)
     .text(note, ML, fy + 6, { width: INNER * 0.65, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(5).fillColor(C.lightGray)
     .text('Veldt Payroll', ML, fy + 6, { width: INNER - 4, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(4.5).fillColor(C.lightGray)
     .text(`Generated: ${moment().tz('Africa/Windhoek').format('DD MMM YYYY HH:mm')} WAT`,
       ML, fy + 12, { width: INNER - 4, align: 'right', lineBreak: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYSLIP PDF
// ─────────────────────────────────────────────────────────────────────────────

function generatePayslipPDF(payslip, companyUser, month, year, stream, theme = {}) {
  const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
  doc.pipe(stream);

  const accent     = /^#[0-9a-fA-F]{6}$/.test(theme.accentColor || '') ? theme.accentColor : '#1e3a5f';
  const monthLabel = moment(`${year}-${String(month).padStart(2, '0')}-01`).format('MMMM YYYY');
  const snap       = payslip?.employeeSnapshot || {};

  // ── Background ─────────────────────────────────────────────────────────────
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(C.pageBg);

  // ── Top accent band ─────────────────────────────────────────────────────────
  doc.rect(0, 0, PAGE_W, 5).fill(accent);

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION A: HEADER
  // ─────────────────────────────────────────────────────────────────────────
  let y = 16;
  const hasLogo = tryLogo(doc, companyUser?.companyLogo, ML, y, 85, 28);
  if (!hasLogo) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.black)
       .text((companyUser?.companyName || 'COMPANY').toUpperCase(), ML, y + 6, { lineBreak: false });
  }

  // Payslip title block (top right)
  doc.font('Helvetica-Bold').fontSize(20).fillColor(accent)
     .text('PAYSLIP', ML, y + 4, { width: INNER, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(C.medGray)
     .text(monthLabel.toUpperCase(), ML, y + 22, { width: INNER, align: 'right', lineBreak: false });

  if (theme.showRefNumber !== false) {
    const idSuffix = String(snap.idNumber || '').slice(-4) || '0000';
    doc.font('Helvetica').fontSize(6).fillColor(C.lightGray)
       .text(`Ref: ${year}${String(month).padStart(2,'0')}-${idSuffix}`,
         ML, y + 32, { width: INNER, align: 'right', lineBreak: false });
  }

  y = 52;
  fullLine(doc, y, C.borderDark, 0.8);

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION B: EMPLOYEE INFO (two-column grid)
  // ─────────────────────────────────────────────────────────────────────────
  const infoH = 78;
  doc.rect(0, y, PAGE_W, infoH).fill('#f8fafc');
  fullLine(doc, y + infoH, C.borderDark, 0.6);

  // Left column
  const lc = ML + 8;
  const rc = ML + INNER / 2 + 8;
  let iy = y + 9;

  infoKV(doc, 'Employee',   snap.fullName,   lc, iy, 60); infoKV(doc, 'TIN Number',   snap.tinNumber,        rc, iy, 70); iy += 14;
  infoKV(doc, 'ID Number',  snap.idNumber,   lc, iy, 60); infoKV(doc, 'SSC Number',   snap.sscNumber || snap.socialSecurityNumber, rc, iy, 70); iy += 14;
  infoKV(doc, 'Position',   snap.position,   lc, iy, 60); infoKV(doc, 'Department',   snap.department,       rc, iy, 70); iy += 14;
  infoKV(doc, 'Bank',       snap.bankName,   lc, iy, 60); infoKV(doc, 'Account No.',  snap.bankAccountNumber, rc, iy, 70); iy += 14;

  // Vertical separator
  doc.moveTo(ML + INNER / 2, y + 7).lineTo(ML + INNER / 2, y + infoH - 7)
     .strokeColor(C.borderDark).lineWidth(0.5).stroke();

  y += infoH + 10;

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION C: EARNINGS (CASH)
  // ─────────────────────────────────────────────────────────────────────────
  y = sectionHeader(doc, 'Earnings', y, accent);

  // Basic Salary
  y = lineItem(doc, 'Monthly Basic Salary', formatNAD(payslip.basicSalary), y, {
    note: `${payslip.workingDaysInMonth || 0} working days  ·  Daily rate: ${formatNAD(payslip.dailyRate)}  ·  Hourly rate: ${formatNAD(payslip.hourlyRate)}`,
  });

  // Unpaid leave deduction
  if ((payslip.unpaidLeaveDeduction || 0) > 0) {
    y = lineItem(doc, 'Less: Unpaid Leave Deduction', `− ${formatNAD(payslip.unpaidLeaveDeduction)}`, y, {
      color: C.red,
      shade: true,
      note:  `${payslip.totalUnpaidDays || 0} day(s) unpaid  ·  Effective basic: ${formatNAD(payslip.effectiveBasic)}`,
    });
  }

  // Overtime
  if ((payslip.overtimePay || 0) > 0) {
    y = lineItem(doc, 'Overtime Pay', formatNAD(payslip.overtimePay), y, {
      color: C.green,
      note:  `Normal OT: ${payslip.normalOvertimeHours || 0} hrs @ 1.5×  ·  Public Holiday OT: ${payslip.publicHolidayOvertimeHours || 0} hrs @ 2.0×`,
    });
  }

  // Custom cash earnings (taxable)
  const cashTaxableItems  = (payslip.classifiedCustomItems || [])
    .filter(i => i.classification?.payslipSection === 'earnings_cash' && i.classification?.affectsTaxableGross && (i.amount || 0) > 0);
  const cashNonTaxableItems = (payslip.classifiedCustomItems || [])
    .filter(i => i.classification?.payslipSection === 'earnings_cash' && !i.classification?.affectsTaxableGross && (i.amount || 0) > 0);

  if (cashTaxableItems.length > 0) {
    y += 4;
    doc.font('Helvetica').fontSize(6).fillColor(C.lightGray).text('TAXABLE ALLOWANCES & INCOME', ML + 10, y); y += 9;
    cashTaxableItems.forEach((item, idx) => {
      y = lineItem(doc, item.name || 'Allowance', formatNAD(item.amount), y, {
        shade: idx % 2 === 1,
        color: C.bodyText,
      });
    });
  }

  if (cashNonTaxableItems.length > 0) {
    y += 4;
    doc.font('Helvetica').fontSize(6).fillColor(C.lightGray).text('NON-TAXABLE ALLOWANCES & INCOME', ML + 10, y); y += 9;
    cashNonTaxableItems.forEach((item, idx) => {
      y = lineItem(doc, item.name || 'Allowance', formatNAD(item.amount), y, {
        shade: idx % 2 === 1,
        color: C.blue,
      });
    });
  }

  // Legacy taxable / non-taxable allowances (fallback for old payslips)
  if (!payslip.classifiedCustomItems && (payslip.taxableAllowances || 0) > 0) {
    y = lineItem(doc, 'Taxable Allowances', formatNAD(payslip.taxableAllowances), y, { color: C.bodyText });
  }
  if (!payslip.classifiedCustomItems && (payslip.nonTaxableAllowances || 0) > 0) {
    y = lineItem(doc, 'Non-Taxable Allowances', formatNAD(payslip.nonTaxableAllowances), y, { color: C.blue });
  }

  y += 4;
  y = summaryLine(doc, 'GROSS CASH PAY', formatNAD(payslip.grossPay), y, {
    color: accent, bgColor: '#eef2ff',
  });
  y += 12;

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION D: NON-CASH BENEFITS (Fringe) — new section, clearly separated
  // ─────────────────────────────────────────────────────────────────────────
  const hasFringe = (payslip.housingFringeBenefit || 0) > 0 ||
                    (payslip.vehicleFringeBenefit  || 0) > 0 ||
                    (payslip.classifiedCustomItems || []).some(
                      i => i.classification?.payslipSection === 'earnings_noncash' && (i.amount || 0) > 0
                    );

  if (hasFringe) {
    y = sectionHeader(doc, 'Non-Cash Benefits (Fringe) — Increase Taxable Income Only', y, C.fringeBorder);

    if ((payslip.housingFringeBenefit || 0) > 0) {
      const housingLabel = {
        free:       'Free Housing Benefit',
        subsidised: 'Subsidised Housing Benefit',
      }[payslip.employeeSnapshot?.housingType] || 'Housing Fringe Benefit';
      y = fringeLineItem(doc, housingLabel, formatNAD(payslip.housingFringeBenefit), y,
        'Tax value added to taxable income for PAYE. Not paid in cash.');
    }

    if ((payslip.vehicleFringeBenefit || 0) > 0) {
      y = fringeLineItem(doc, 'Company Vehicle Benefit', formatNAD(payslip.vehicleFringeBenefit), y,
        'Monthly determined value. Not paid in cash.');
    }

    const fringeCustom = (payslip.classifiedCustomItems || [])
      .filter(i => i.classification?.payslipSection === 'earnings_noncash' && (i.amount || 0) > 0);
    fringeCustom.forEach(item => {
      y = fringeLineItem(doc, item.name || 'Fringe Benefit', formatNAD(item.amount), y);
    });

    y += 4;
    // Taxable gross info line (shows PAYE is calculated on a higher base)
    doc.rect(ML, y, INNER, 14).fill(C.fringeBg);
    doc.rect(ML, y, 2, 14).fill(C.fringeBorder);
    doc.font('Helvetica').fontSize(6.5).fillColor(C.fringeText)
       .text(`Taxable Gross for PAYE: ${formatNAD(payslip.taxableGross)}  (Gross Cash Pay + Fringe Benefits)`,
         ML + 10, y + 4, { lineBreak: false });
    y += 14 + 10;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION E: DEDUCTIONS
  // ─────────────────────────────────────────────────────────────────────────
  y = sectionHeader(doc, 'Deductions', y, C.red);

  // Statutory deductions
  doc.font('Helvetica').fontSize(6).fillColor(C.lightGray).text('STATUTORY', ML + 10, y); y += 9;

  y = lineItem(doc, 'P.A.Y.E — Income Tax', formatNAD(payslip.paye), y, {
    color: C.red,
    note:  `Taxable income: ${formatNAD(payslip.annualTaxableIncome)} p.a.  ·  Annual tax: ${formatNAD(payslip.annualTax)}`,
  });

  y = lineItem(doc, 'Social Security Contribution (Employee)', formatNAD(payslip.sscEmployee), y, {
    color: C.red,
    shade: true,
    note:  `0.9% of taxable gross — capped at N$ 99.00/month`,
  });

  // Fund contributions (voluntary — affect PAYE as tax-deductible)
  const fundMap = [
    { key: 'pensionMonthly',    label: 'Pension Fund',         fund: 'pensionFundName'    },
    { key: 'providentMonthly',  label: 'Provident Fund',       fund: 'providentFundName'  },
    { key: 'retirementMonthly', label: 'Retirement Annuity',   fund: 'retirementFundName' },
    { key: 'studyMonthly',      label: 'Study Policy',         fund: 'studyPolicyName'    },
  ];
  const hasFunds = fundMap.some(f => (payslip[f.key] || 0) > 0);

  if (hasFunds) {
    y += 6;
    doc.font('Helvetica').fontSize(6).fillColor(C.lightGray).text('TAX-DEDUCTIBLE FUND CONTRIBUTIONS', ML + 10, y); y += 9;
    fundMap.forEach((f, idx) => {
      if ((payslip[f.key] || 0) <= 0) return;
      const fundName = payslip[f.fund] || snap[f.fund] || '';
      y = lineItem(doc, `${f.label}${fundName ? ' — ' + fundName : ''}`, formatNAD(payslip[f.key]), y, {
        color: '#7c3aed',
        shade: idx % 2 === 1,
        bgColor: '#f5f3ff',
      });
    });
  }

  // Medical aid (voluntary — NOT tax-deductible, deducted from net pay)
  if ((payslip.medicalMonthly || 0) > 0) {
    y += 6;
    doc.font('Helvetica').fontSize(6).fillColor(C.lightGray).text('VOLUNTARY DEDUCTIONS (POST-TAX)', ML + 10, y); y += 9;
    const medFundName = payslip.medicalAidFundName || snap.medicalAidFundName || '';
    y = lineItem(doc, `Medical Aid${medFundName ? ' — ' + medFundName : ''}`, formatNAD(payslip.medicalMonthly), y, {
      color: C.orange,
      bgColor: '#fff7ed',
      note: 'Not tax-deductible — deducted from net pay',
    });
  }

  // Other / custom deductions
  const deductionCustom = (payslip.classifiedCustomItems || [])
    .filter(i => i.classification?.payslipSection === 'deductions' && (i.amount || 0) > 0);
  if (deductionCustom.length || (payslip.otherDeductions || 0) > 0) {
    y += 6;
    doc.font('Helvetica').fontSize(6).fillColor(C.lightGray).text('OTHER DEDUCTIONS', ML + 10, y); y += 9;
    deductionCustom.forEach((item, idx) => {
      y = lineItem(doc, item.name || 'Deduction', formatNAD(item.amount), y, {
        color: C.red, shade: idx % 2 === 1,
      });
    });
    if (!payslip.classifiedCustomItems && (payslip.otherDeductions || 0) > 0) {
      y = lineItem(doc, 'Other Deductions', formatNAD(payslip.otherDeductions), y, { color: C.red });
    }
  }

  y += 4;
  y = summaryLine(doc, 'TOTAL DEDUCTIONS', formatNAD(payslip.totalDeductions), y, {
    color: C.red, bgColor: '#fef2f2',
  });
  y += 12;

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION F: NET PAY
  // ─────────────────────────────────────────────────────────────────────────
  const netH = 36;
  doc.rect(ML, y, INNER, netH).fill(accent);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
     .text('NET PAY (AMOUNT TO BE TRANSFERRED TO EMPLOYEE)', ML + 12, y + 10, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(19).fillColor('#ffffff')
     .text(formatNAD(payslip.netPay), ML, y + 8, { width: INNER - 12, align: 'right', lineBreak: false });
  y += netH + 12;

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION G: EMPLOYER CONTRIBUTIONS + LEAVE RECORD (two columns)
  // ─────────────────────────────────────────────────────────────────────────
  const bottomH     = 64;
  const halfW       = (INNER - 10) / 2;
  const leftColX    = ML;
  const rightColX   = ML + halfW + 10;

  // Left: Leave Record
  if (theme.showLeaveBalances !== false) {
    doc.rect(leftColX, y, halfW, bottomH).fill('#f0fdf4');
    doc.rect(leftColX, y, 2, bottomH).fill('#16a34a');
    hLine(doc, y, C.borderDark, 0.4);
    hLine(doc, y + bottomH, C.borderDark, 0.4);

    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.headerText)
       .text('LEAVE RECORD — THIS PERIOD', leftColX + 8, y + 7, { lineBreak: false, characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(5.5).fillColor(C.lightGray)
       .text('(Days this payroll period)', leftColX + 8, y + 15, { lineBreak: false });

    const leaveItems = [
      [`Annual Leave — Paid`,   payslip.annualLeavePaid],
      [`Annual Leave — Unpaid`, payslip.annualLeaveUnpaid],
      [`Sick Leave — Paid`,     payslip.sickLeavePaid],
      [`Sick Leave — Unpaid`,   payslip.sickLeaveUnpaid],
    ];
    let ly = y + 26;
    leaveItems.forEach(([lbl, val]) => {
      const color = lbl.includes('Unpaid') ? C.red : '#15803d';
      doc.font('Helvetica').fontSize(6.5).fillColor(C.bodyText).text(lbl, leftColX + 8, ly, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(color).text(String(val || '0'), leftColX + 8, ly, { width: halfW - 16, align: 'right', lineBreak: false });
      ly += 9;
    });
  }

  // Right: Employer Contributions
  if (theme.showEmployerContributions !== false) {
    doc.rect(rightColX, y, halfW, bottomH).fill('#eff6ff');
    doc.rect(rightColX, y, 2, bottomH).fill(accent);
    hLine(doc, y, C.borderDark, 0.4);
    hLine(doc, y + bottomH, C.borderDark, 0.4);

    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.headerText)
       .text('EMPLOYER CONTRIBUTIONS', rightColX + 8, y + 7, { lineBreak: false, characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(5.5).fillColor(C.lightGray)
       .text('(Not deducted from employee pay)', rightColX + 8, y + 15, { lineBreak: false });

    let ey = y + 26;
    const empItems = [
      ['SSC — Employer Share',       payslip.sscEmployer],
      ["Employees' Compensation Fund", payslip.ecf],
    ];
    empItems.forEach(([lbl, val]) => {
      doc.font('Helvetica').fontSize(6.5).fillColor(C.bodyText).text(lbl, rightColX + 8, ey, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.darkGray).text(formatNAD(val), rightColX + 8, ey, { width: halfW - 16, align: 'right', lineBreak: false });
      ey += 9;
    });

    hLine(doc, ey + 2, C.borderDark, 0.4);
    ey += 6;
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.headerText)
       .text('TOTAL COST TO EMPLOYER', rightColX + 8, ey, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(accent)
       .text(formatNAD(payslip.totalEmployerCost), rightColX + 8, ey, { width: halfW - 16, align: 'right', lineBreak: false });
  }

  y += bottomH + 10;

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION H: DISCLAIMER NOTICE
  // ─────────────────────────────────────────────────────────────────────────
  doc.rect(ML, y, INNER, 12).fill('#fffbeb');
  doc.rect(ML, y, 2, 12).fill('#f59e0b');
  doc.font('Helvetica').fontSize(5.5).fillColor('#78350f')
     .text('DISCLAIMER: Payroll calculations are for guidance only. Always verify with NamRA and the Social Security Commission before final submission.',
       ML + 8, y + 3, { width: INNER - 16, lineBreak: false });

  footer(doc, theme, accent);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE PDF (monthly summary report)
// ─────────────────────────────────────────────────────────────────────────────

function generateCompliancePDF(payrollRun, companyUser, stream) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  doc.pipe(stream);

  doc.rect(0, 0, PAGE_W, PAGE_H).fill(C.pageBg);
  doc.rect(0, 0, PAGE_W, 5).fill(C.darkGray);

  const period = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2,'0')}-01`).format('MMMM YYYY');

  let y = 22;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(C.darkGray).text('MONTHLY COMPLIANCE REPORT', ML, y);
  doc.font('Helvetica').fontSize(9).fillColor(C.medGray)
     .text(`${companyUser?.companyName || 'COMPANY'}  ·  Period: ${period}`, ML, y + 20);
  hLine(doc, y + 35, C.borderDark, 0.8);
  y = 72;

  y = sectionHeader(doc, 'Statutory Remittance Summary', y, C.darkGray);

  const stats = [
    ['Total Gross Cash Pay (all employees)',            formatNAD(payrollRun.totalGrossPay)],
    ['Total Taxable Gross (incl. fringe benefits)',     formatNAD(payrollRun.totalTaxableGross || payrollRun.totalGrossPay)],
    ['Total P.A.Y.E — To be Remitted to NamRA',        formatNAD(payrollRun.totalPAYE)],
    ['Total SSC Employee Contributions',                formatNAD(payrollRun.totalSSCEmployee)],
    ['Total SSC Employer Contributions',                formatNAD(payrollRun.totalSSCEmployer)],
    ["Total Employees' Compensation Fund (ECF)",        formatNAD(payrollRun.totalECF)],
    ['Total Net Salary (Bank Transfers Required)',       formatNAD(payrollRun.totalNetPay)],
    ['Total Employee Count',                            String(payrollRun.employeeCount || 0)],
  ];

  stats.forEach(([label, val], i) => {
    y = lineItem(doc, label, val, y, { shade: i % 2 === 1 });
  });

  y += 8;
  y = summaryLine(doc, 'TOTAL PAYROLL COST TO COMPANY', formatNAD(payrollRun.totalEmployerCost), y, {
    color: C.orange, bgColor: '#fff7ed', height: 22,
  });
  y += 24;

  // Remittance instructions
  doc.rect(ML, y, INNER, 76).fill(C.sectionBg);
  hLine(doc, y, C.borderDark, 0.5);
  hLine(doc, y + 76, C.borderDark, 0.5);
  doc.rect(ML, y, 3, 76).fill(C.darkGray);

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.headerText)
     .text('OFFICIAL REMITTANCE INSTRUCTIONS', ML + 12, y + 10, { characterSpacing: 0.5, lineBreak: false });

  doc.font('Helvetica').fontSize(6.5).fillColor(C.bodyText)
     .text(
       '1.  P.A.Y.E: Submit via NamRA ITAS Portal (www.namra.org.na) by the 20th of the following month.\n\n' +
       '2.  SSC & ECF: Remit to the Social Security Commission using Form 10. Both employer and employee shares.\n\n' +
       '3.  Net Salaries: Process the Bank Transfer CSV via your banking platform bulk payment system.',
       ML + 12, y + 24, { width: INNER - 24, lineGap: 3 }
     );

  footer(doc, {}, C.darkGray);
  doc.end();
}

module.exports = { generatePayslipPDF, generateCompliancePDF };