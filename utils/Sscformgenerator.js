'use strict';

const PDFDocument = require('pdfkit');
const moment = require('moment-timezone');

// ── Page geometry (A4) ────────────────────────────────────────────────────────
const PAGE_W = 595;
const PAGE_H = 842;
const ML = 40;
const MR = 40;
const INNER = PAGE_W - ML - MR; // 515

// ── Palette — strict black & white ───────────────────────────────────────────
const BLACK = '#000000';
const WHITE = '#ffffff';
const GRAY = '#aaaaaa'; // footer note only

// ── Dot leader ────────────────────────────────────────────────────────────────
const DOTS = '....................................................................';
const DOTS_SHORT = '........................';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hRule(doc, y, x1, x2, thickness = 0.5) {
  doc.save()
    .moveTo(x1, y)
    .lineTo(x2, y)
    .strokeColor(BLACK)
    .lineWidth(thickness)
    .stroke()
    .restore();
}

/** Draws a rectangle border (no fill) */
function rect(doc, x, y, w, h, thickness = 0.5) {
  doc.save()
    .rect(x, y, w, h)
    .strokeColor(BLACK)
    .lineWidth(thickness)
    .stroke()
    .restore();
}

/** Cell with white fill + border */
function cell(doc, x, y, w, h, thickness = 0.4) {
  doc.save()
    .rect(x, y, w, h)
    .fill(WHITE)
    .restore();
  doc.save()
    .rect(x, y, w, h)
    .strokeColor(BLACK)
    .lineWidth(thickness)
    .stroke()
    .restore();
}

/** Text centred vertically inside a cell */
function cellText(doc, text, x, y, w, h, opts = {}) {
  const {
    font = 'Helvetica',
    size = 8,
    align = 'left',
    bold = false,
    pad = 4,
  } = opts;
  const lineH = size * 1.2;
  const textY = y + (h - lineH) / 2;
  doc.font(bold ? 'Helvetica-Bold' : font)
    .fontSize(size)
    .fillColor(BLACK)
    .text(String(text || '').toUpperCase(), x + pad, textY, {
      width: w - pad * 2,
      height: h,
      lineBreak: false,
      ellipsis: true,
      align,
    });
}

/** Calculate SSC contribution per Namibian rules */
function calculateSSC(monthlyRemuneration) {
  if (!monthlyRemuneration || monthlyRemuneration <= 0) return 0;
  const contribution = monthlyRemuneration * 0.009; // 0.9%
  const min = 4.5;
  const max = 99.0;
  if (contribution < min) return min;
  if (contribution > max) return max;
  return Math.round(contribution * 100) / 100;
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

function generateSSCForm(payrollRun, companyUser, stream) {
  const doc = new PDFDocument({ margin: 0, size: 'A4', info: { Title: 'SSC Form 10(a) – NamPayroll' } });
  doc.pipe(stream);

  // Extract data
  const companyName = (companyUser?.companyName || 'COMPANY').toUpperCase();
  const sscNumber = companyUser?.sscNumber || '';
  const postalAddress = (companyUser?.postalAddress || companyUser?.address || '').toUpperCase();
  const email = companyUser?.email || '';

  const monthDate = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2, '0')}-01`);
  const dateFrom = monthDate.clone().startOf('month').format('DD/MM/YYYY');
  const dateTo = monthDate.clone().endOf('month').format('DD/MM/YYYY');

  // Prepare employee data
  const employees = (payrollRun.payslips || []).map((ps) => {
    const snap = ps.employeeSnapshot || {};
    const parts = (snap.fullName || '').trim().split(/\s+/);
    const surname = parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || '';
    const initials = parts[0] ? parts[0][0].toUpperCase() : '';
    const monthlyRemuneration = Number(ps.basicSalary || 0);
    const sscEmployee = calculateSSC(monthlyRemuneration);

    return {
      surname: surname.toUpperCase(),
      initials: initials,
      sscNumber: snap.sscNumber || '',
      monthlyRemuneration,
      sscEmployee,
      sscEmployer: sscEmployee, // 1:1 match
    };
  });

  const totalRemuneration = employees.reduce((sum, e) => sum + e.monthlyRemuneration, 0);
  const totalEmployeeDeductions = employees.reduce((sum, e) => sum + e.sscEmployee, 0);
  const totalEmployerContribution = employees.reduce((sum, e) => sum + e.sscEmployer, 0);
  const totalPaidOver = totalEmployeeDeductions + totalEmployerContribution;

  // Pagination parameters
  const ROWS_PER_PAGE = 16; // Employee rows per page (leave room for headers/footer)
  const ROW_H = 18;
  let pageNum = 0;
  let employeeIndex = 0;

  // Render pages
  while (employeeIndex < employees.length || pageNum === 0) {
    if (pageNum > 0) {
      doc.addPage();
    }

    // White background
    doc.rect(0, 0, PAGE_W, PAGE_H).fill(WHITE);

    let y = 20;

    // ══════════════════════════════════════════════════════════════════════════
    // HEADER
    // ══════════════════════════════════════════════════════════════════════════

    // Form number top right
    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BLACK)
      .text('Form 10(a)', ML, y, { width: INNER, align: 'right', lineBreak: false });

    // Title
    doc.font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(BLACK)
      .text('REPUBLIC OF NAMIBIA', ML, y, { width: INNER, align: 'center' });
    y += 15;

    doc.font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(BLACK)
      .text('SOCIAL SECURITY COMMISSION', ML, y, { width: INNER, align: 'center' });
    y += 13;

    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BLACK)
      .text('Social Security Act, 1994', ML, y, { width: INNER, align: 'center' });
    y += 11;

    doc.font('Helvetica')
      .fontSize(8)
      .fillColor(BLACK)
      .text('Cnr. A Klopper & J. Haupt Streets—Khomasdal', ML, y, { width: INNER, align: 'center' });
    y += 18;

    // Addressee block (left side)
    const addressLines = [
      { font: 'Helvetica-Bold', text: 'The Executive Officer' },
      { font: 'Helvetica-Bold', text: 'Social Security Commission' },
      { font: 'Helvetica', text: 'Private Bag 13223' },
      { font: 'Helvetica', text: 'Windhoek' },
      { font: 'Helvetica', text: 'Namibia' },
    ];
    addressLines.forEach((line, i) => {
      doc.font(line.font)
        .fontSize(9)
        .fillColor(BLACK)
        .text(line.text, ML, y + i * 11, { lineBreak: false });
    });
    y += addressLines.length * 11 + 12;

    // ══════════════════════════════════════════════════════════════════════════
    // PERIOD & INSTRUCTIONS
    // ══════════════════════════════════════════════════════════════════════════

    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BLACK)
      .text('RETURN ACCOMPANYING PAYMENT OF CONTRIBUTIONS FOR THE PERIOD', ML, y, {
        width: INNER,
        align: 'center',
      });
    y += 14;

    // Dates
    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(BLACK)
      .text(DOTS_SHORT + '  ' + dateFrom + '  TO  ' + dateTo + '  ' + DOTS_SHORT, ML, y, {
        width: INNER,
        align: 'center',
      });
    y += 12;

    doc.font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor(BLACK)
      .text('(Section 22/Regulation 5)', ML, y, { width: INNER, align: 'center' });
    y += 11;

    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BLACK)
      .text('TO BE COMPLETED IN BLOCK LETTERS', ML, y, { width: INNER, align: 'center' });
    y += 18;

    // ══════════════════════════════════════════════════════════════════════════
    // EMPLOYER DETAILS (Fields 1-4)
    // ══════════════════════════════════════════════════════════════════════════

    // Field 1: Company Name
    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(BLACK)
      .text('1. Name of Employer:  ', ML, y, { lineBreak: false });
    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BLACK)
      .text(companyName, ML + 110, y, { width: INNER - 110, lineBreak: false });
    y += 14;

    // Field 2: SSC Number
    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(BLACK)
      .text('2. Social Security Registration Number:  ', ML, y, { lineBreak: false });
    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BLACK)
      .text(sscNumber, ML + 170, y, { width: INNER - 170, lineBreak: false });
    y += 14;

    // Field 3: Postal Address
    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(BLACK)
      .text('3. Postal Address:  ', ML, y, { lineBreak: false });
    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BLACK)
      .text(postalAddress, ML + 95, y, { width: INNER - 95, lineBreak: false });
    y += 14;

    // Field 4: Email
    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(BLACK)
      .text('4. Email Address:  ', ML, y, { lineBreak: false });
    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BLACK)
      .text(email, ML + 95, y, { width: INNER - 95, lineBreak: false });
    y += 18;

    // ══════════════════════════════════════════════════════════════════════════
    // PARTICULARS TABLE
    // ══════════════════════════════════════════════════════════════════════════

    const TABLE_TOP = y;

    // Title bar
    const TITLE_H = 16;
    rect(doc, ML, y, INNER, TITLE_H, 0.7);
    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BLACK)
      .text('* PARTICULARS OF EMPLOYEES *', ML, y + 4, { width: INNER, align: 'center' });
    y += TITLE_H;

    // Column definitions (kept as in your latest version)
    const COL_SURNAME = { x: ML, w: 90 };
    const COL_INITIALS = { x: ML + 90, w: 45 };
    const COL_SSCNO = { x: ML + 135, w: 90 };
    const COL_MON1 = { x: ML + 225, w: 50 };
    const COL_MON2 = { x: ML + 275, w: 50 };
    const COL_DED1 = { x: ML + 325, w: 50 };
    const COL_DED2 = { x: ML + 375, w: 140 };

    const HDR_H = 28;
    const monSpanW = COL_MON1.w + COL_MON2.w;
    const dedSpanW = COL_DED1.w + COL_DED2.w;

    // FIXED HEADER DRAWING - Clean spanning columns (exactly as requested)
    // 1. Draw the full spanning header cells for the two wide columns
    cell(doc, COL_SURNAME.x, y, COL_SURNAME.w, HDR_H, 0.4);
    cell(doc, COL_INITIALS.x, y, COL_INITIALS.w, HDR_H, 0.4);
    cell(doc, COL_SSCNO.x, y, COL_SSCNO.w, HDR_H, 0.4);
    cell(doc, COL_MON1.x, y, monSpanW, HDR_H, 0.4);   // Single cell for "Monthly Remuneration"
    cell(doc, COL_DED1.x, y, dedSpanW, HDR_H, 0.4);   // Single cell for "Contributions Deducted"

    // 2. Horizontal divider under the main labels (only in the bottom half)
    const dividerY = y + 13;
    hRule(doc, dividerY, COL_MON1.x, COL_MON1.x + monSpanW, 0.4);
    hRule(doc, dividerY, COL_DED1.x, COL_DED1.x + dedSpanW, 0.4);

    // 3. Vertical separators — ONLY in the bottom half (below the divider)
    // This prevents the vertical line from going all the way to the top of the header
    doc.save()
      .moveTo(COL_MON2.x, dividerY)
      .lineTo(COL_MON2.x, y + HDR_H)
      .moveTo(COL_DED2.x, dividerY)
      .lineTo(COL_DED2.x, y + HDR_H)
      .strokeColor(BLACK)
      .lineWidth(0.4)
      .stroke()
      .restore();

    // 4. Spanning Text Labels (centered in the full wide columns)
    doc.font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(BLACK)
      .text('Monthly Remuneration', COL_MON1.x, y + 4, { width: monSpanW, align: 'center' });

    doc.font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(BLACK)
      .text('Contributions Deducted', COL_DED1.x, y + 4, { width: dedSpanW, align: 'center' });

    // 5. Single Column Labels (Surname, Initials, SSC No) — placed in the bottom half
    const labels = [
      { col: COL_SURNAME, label: 'Surname' },
      { col: COL_INITIALS, label: 'Initials' },
      { col: COL_SSCNO, label: 'Social Security\nRegistration No' },
    ];
    labels.forEach((l) => {
      doc.font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(BLACK)
        .text(l.label, l.col.x + 2, y + 14, { width: l.col.w - 4, align: 'center' });
    });

    y += HDR_H;

    // ── DATA ROWS ──────────────────────────────────────────────────────────────
    const rowsOnThisPage = Math.min(ROWS_PER_PAGE, employees.length - employeeIndex);
    const cols = [COL_SURNAME, COL_INITIALS, COL_SSCNO, COL_MON1, COL_MON2, COL_DED1, COL_DED2];

    for (let i = 0; i < rowsOnThisPage; i++) {
      const emp = employees[employeeIndex + i];
      cols.forEach((col) => cell(doc, col.x, y, col.w, ROW_H, 0.4));

      cellText(doc, emp.surname, COL_SURNAME.x, y, COL_SURNAME.w, ROW_H, { align: 'left' });
      cellText(doc, emp.initials, COL_INITIALS.x, y, COL_INITIALS.w, ROW_H, { align: 'center' });
      cellText(doc, emp.sscNumber, COL_SSCNO.x, y, COL_SSCNO.w, ROW_H, { align: 'left' });
      cellText(doc, emp.monthlyRemuneration.toFixed(2), COL_MON1.x, y, COL_MON1.w, ROW_H, { align: 'right' });
      cellText(doc, '', COL_MON2.x, y, COL_MON2.w, ROW_H);
      cellText(doc, emp.sscEmployee.toFixed(2), COL_DED1.x, y, COL_DED1.w, ROW_H, { align: 'right' });
      cellText(doc, emp.sscEmployer.toFixed(2), COL_DED2.x, y, COL_DED2.w, ROW_H, { align: 'right' });

      y += ROW_H;
    }

    const emptyRows = Math.max(0, ROWS_PER_PAGE - rowsOnThisPage);
    for (let i = 0; i < emptyRows; i++) {
      cols.forEach((col) => cell(doc, col.x, y, col.w, ROW_H, 0.4));
      y += ROW_H;
    }

    // ── SUMMARY ROWS ───────────────────────────────────────────────────────────
    const SUM_H = 16;
    const labelW = COL_SSCNO.x + COL_SSCNO.w - ML;

    if (employeeIndex + rowsOnThisPage >= employees.length) {
      cell(doc, ML, y, labelW, SUM_H);
      cols.slice(3).forEach((col) => cell(doc, col.x, y, col.w, SUM_H));
      doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK).text('Total Amount Deducted', ML + 4, y + 4, { lineBreak: false });
      cellText(doc, totalEmployeeDeductions.toFixed(2), COL_DED1.x, y, COL_DED1.w, SUM_H, { align: 'right' });
      y += SUM_H;

      cell(doc, ML, y, labelW, SUM_H);
      cols.slice(3).forEach((col) => cell(doc, col.x, y, col.w, SUM_H));
      doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK).text("Employer's Contribution", ML + 4, y + 4, { lineBreak: false });
      cellText(doc, totalEmployerContribution.toFixed(2), COL_DED2.x, y, COL_DED2.w, SUM_H, { align: 'right' });
      y += SUM_H;

      cell(doc, ML, y, labelW, SUM_H);
      cols.slice(3).forEach((col) => cell(doc, col.x, y, col.w, SUM_H));
      doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK).text('Total Amount Paid Over', ML + 4, y + 4, { lineBreak: false });
      cellText(doc, totalPaidOver.toFixed(2), COL_DED2.x, y, COL_DED2.w, SUM_H, { align: 'right' });
      y += SUM_H;

      rect(doc, ML, TABLE_TOP, INNER, y - TABLE_TOP, 0.8);
    } else {
      rect(doc, ML, TABLE_TOP, INNER, y - TABLE_TOP, 0.8);
    }

    y += 16;

    // ══════════════════════════════════════════════════════════════════════════
    // DECLARATION
    // ══════════════════════════════════════════════════════════════════════════

    if (employeeIndex + rowsOnThisPage >= employees.length) {
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text('Declaration', ML, y);
      y += 12;
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text('I, ' + DOTS_SHORT + '.........................(Full Names and Capacity)', ML, y, { width: INNER });
      y += 12;
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text('certify that the above particulars are true and correct.', ML, y);
      y += 26;

      const sigW = (INNER - 24) / 3;
      const sigLabels = ['EMPLOYER', 'OFFICIAL STAMP', 'DATE'];
      sigLabels.forEach((lbl, i) => {
        const sx = ML + i * (sigW + 12);
        doc.font('Helvetica').fontSize(8).fillColor(BLACK).text(DOTS_SHORT, sx, y, { width: sigW, align: 'center', lineBreak: false });
      });
      y += 10;
      sigLabels.forEach((lbl, i) => {
        const sx = ML + i * (sigW + 12);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK).text(lbl, sx, y, { width: sigW, align: 'center', lineBreak: false });
      });

      y += 16;
      const offH = 70;
      rect(doc, ML, y, INNER, offH, 0.8);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK).text('FOR OFFICE USE ONLY', ML, y + 6, { width: INNER, align: 'center' });
      y += 18;
      hRule(doc, y, ML, ML + INNER, 0.4);
      y += 6;
      doc.font('Helvetica').fontSize(8).fillColor(BLACK).text('Checked By: ' + DOTS_SHORT, ML + 4, y, { lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor(BLACK).text('Date: ' + DOTS_SHORT, ML + 190, y, { lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor(BLACK).text('Time: ' + DOTS_SHORT, ML + 360, y, { lineBreak: false });
      y += 12;
      doc.font('Helvetica').fontSize(8).fillColor(BLACK).text('Receipt Number: ' + DOTS_SHORT, ML + 4, y, { lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor(BLACK).text('Fee Paid: N$' + DOTS_SHORT, ML + 240, y, { lineBreak: false });
      y += 12;
      doc.font('Helvetica').fontSize(8).fillColor(BLACK).text('Remarks: ' + DOTS, ML + 4, y, { width: INNER - 8, lineBreak: false });
      y += 10;
      doc.font('Helvetica').fontSize(8).fillColor(BLACK).text(DOTS, ML + 4, y, { width: INNER - 8, lineBreak: false });

      const footY = PAGE_H - 12;
      hRule(doc, footY - 4, ML, ML + INNER, 0.3);
      doc.font('Helvetica').fontSize(5.5).fillColor(GRAY).text('Generated by NamPayroll · Verify all values before submission to the Social Security Commission.', ML, footY, { width: INNER * 0.7 });
      doc.font('Helvetica').fontSize(5.5).fillColor(GRAY).text(moment().format('DD MMMM YYYY, HH:mm'), ML, footY, { width: INNER, align: 'right' });
    }

    pageNum++;
    employeeIndex += rowsOnThisPage;
  }

  doc.end();
}

module.exports = { generateSSCForm };