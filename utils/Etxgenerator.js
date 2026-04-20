/**
 * utils/etxGenerator.js – Veldt Payroll
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ██████████████████████████████████████████████████████████████████████████
 * ETX MAPPING FIXES IN THIS VERSION
 * ██████████████████████████████████████████████████████████████████████████
 *
 * VERIFIED AGAINST: ETX_Template_Version_2.xlsx (NamRA PAYE4 form)
 *
 * KEY CORRECTIONS:
 *
 * Col 5  — Salaries, Wages, Pension
 *           = basicSalary + overtimePay + any custom items categorised as
 *             'normal' (i.e. not a named allowance or fringe benefit)
 *           PREVIOUS BUG: included fringe benefits in this column
 *
 * Col 9  — Tax Values (housing fringe benefit tax value)
 *           = housingFringeBenefit (the N$ amount that is taxable)
 *           PREVIOUS BUG: was being omitted
 *
 * Col 10 — Exempt on Tax Value
 *           = 0 in most cases (free housing is fully taxable in Namibia)
 *
 * Col 11 — Taxable portion (of housing benefit)
 *           = col9 − col10
 *
 * Col 13 — Tax Value of Company Vehicle(s)
 *           = vehicleFringeBenefit (the monthly determined value)
 *           CORRECT in previous version
 *
 * Col 14 — Other fringe benefits
 *           = custom items categorised as 'fringe_benefit'
 *           CORRECT in previous version
 *
 * Col 24 — Gross Remuneration
 *           NamRA definition: ALL remuneration including fringe benefit
 *           tax values but EXCLUDING tax-free allowances.
 *           = col5 + col6 + col9 + col13 + col14 + col15 + col16
 *             + col17 + col18 + col19 + col21 + col23
 *           We compute this directly from etxGrossRemuneration in the calc.
 *           PREVIOUS BUG: was using grossPay (cash only) which excluded
 *           fringe benefits — understating Gross Remuneration.
 *
 * Col 37 — Total Deductions
 *           NamRA ONLY allows 4 funds as deductions here:
 *           pension + provident + retirement + study
 *           Medical aid and SSC are NOT in col37.
 *           PREVIOUS BUG: included medical aid in col37
 *
 * Col 38 — Taxable Income
 *           = col24 − col37 (Gross Remuneration minus fund deductions)
 *           PREVIOUS BUG: was being calculated without col17/col18 amounts
 *
 * Col 39/40 — Tax Liability / Tax Deducted
 *           = annual PAYE (same figure — tax liability = tax deducted
 *             for employees on regular employment with no directive)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const ExcelJS = require('exceljs');

// ── Housing type → ETX display string ────────────────────────────────────────
const HOUSING_MAP = {
  free:       'Free Housing',
  subsidised: 'Subsidised Housing',
  none:       '',
};

// ── All 81 ETX column headers (exact NamRA order) ────────────────────────────
const ETX_COLUMNS = [
  /* 1  */ 'NO.',
  /* 2  */ "Employee's TIN",
  /* 3  */ 'Identification Number',
  /* 4  */ "Employee's Name",
  /* 5  */ 'Salaries, Wages, Pension',
  /* 6  */ 'Commission',
  /* 7  */ 'Housing Type',
  /* 8  */ 'Reference No.',
  /* 9  */ 'Tax Values',
  /* 10 */ 'Exempt on Tax Value',
  /* 11 */ 'Taxable portion',
  /* 12 */ 'Tax Value of Subsidised Loans (Specify)',
  /* 13 */ 'Tax Value of Company Vehicle(s)',
  /* 14 */ 'Other fringe benefits',
  /* 15 */ 'Entertainment Allowance',
  /* 16 */ 'Vehicle running expense allowance ',
  /* 17 */ 'Vehicle purchase allowance ',
  /* 18 */ 'Subsistance and Travel Expense Allowance',
  /* 19 */ 'Other Allowance (Specify)',
  /* 20 */ 'Other Allowance Type',
  /* 21 */ 'Other Income (Specify)',
  /* 22 */ 'Other Income Type',
  /* 23 */ 'Annuity Income',
  /* 24 */ 'Gross Remuneration',
  /* 25 */ 'Pension Fund Name',
  /* 26 */ 'Registration No. of Fund',
  /* 27 */ 'Contribution for Fund',
  /* 28 */ 'Provident Fund Name',
  /* 29 */ 'Registration No. of Fund',
  /* 30 */ 'Contribution for Fund',
  /* 31 */ 'Retirement Fund Name',
  /* 32 */ 'Registration No. of Fund',
  /* 33 */ 'Contribution for Fund',
  /* 34 */ 'Study Policy Name',
  /* 35 */ 'Registration No. of Study Policy',
  /* 36 */ 'Contribution for Study Policy',
  /* 37 */ 'Total Deductions',
  /* 38 */ 'TAXABLE INCOME',
  /* 39 */ 'TAX LIABILITY',
  /* 40 */ 'Tax Deducted',
  /* 41–80: Five tax directive sets (8 columns each) */
  'Tax Directive Number_1','Tax Directive Type_1','Date of termination of service/Accrual Date_1','Reason_1','Gross Amount_1','Tax Free Amount_1','Taxable Amount_1','Tax Deducted_1',
  'Tax Directive Number_2','Tax Directive Type_2','Date of termination of service/Accrual Date_2','Reason_2','Gross Amount_2','Tax Free Amount_2','Taxable Amount_2','Tax Deducted_2',
  'Tax Directive Number_3','Tax Directive Type_3','Date of termination of service/Accrual Date_3','Reason_3','Gross Amount_3','Tax Free Amount_3','Taxable Amount_3','Tax Deducted_3',
  'Tax Directive Number_4','Tax Directive Type_4','Date of termination of service/Accrual Date_4','Reason_4','Gross Amount_4','Tax Free Amount_4','Taxable Amount_4','Tax Deducted_4',
  'Tax Directive Number_5','Tax Directive Type_5','Date of termination of service/Accrual Date_5','Reason_5','Gross Amount_5','Tax Free Amount_5','Taxable Amount_5','Tax Deducted_5',
  /* 81 */ 'Totals',
];

// ── Styles ────────────────────────────────────────────────────────────────────
const THIN   = { style: 'thin',   color: { argb: 'FF333333' } };
const MEDIUM = { style: 'medium', color: { argb: 'FF222222' } };
const THIN_B   = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const MEDIUM_B = { top: MEDIUM, bottom: MEDIUM, left: MEDIUM, right: MEDIUM };

const FILL_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4788' } };
const FILL_ALT    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8FF' } };
const FILL_WHITE  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
const FILL_TOTALS = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EFF8' } };
const FILL_FRINGE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E7' } };  // subtle yellow for fringe cols
const FILL_FUNDS  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FFF0' } };  // subtle green for fund cols

const r2 = n => Math.round((n || 0) * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// ANNUAL AGGREGATION
// Aggregates payslip data across multiple monthly payroll runs for one tax year
// ─────────────────────────────────────────────────────────────────────────────

function buildAnnualMap(payrollRuns, employees) {
  const empMap = {};
  for (const emp of employees) empMap[emp._id.toString()] = emp;

  const annualMap = {};

  for (const run of payrollRuns) {
    for (const ps of (run.payslips || [])) {
      const empId = ps.employee?.toString();
      if (!empId) continue;

      if (!annualMap[empId]) {
        annualMap[empId] = {
          employee: empMap[empId] || null,
          snapshot: ps.employeeSnapshot || {},

          // Col 5: salary + OT + normal taxable custom items
          col5_salariesWages:    0,
          // Col 6: commission (not currently used — placeholder)
          col6_commission:       0,
          // Col 9: housing fringe tax value
          col9_housingTaxValue:  0,
          // Col 13: vehicle fringe
          col13_vehicle:         0,
          // Col 14: other custom fringe benefits
          col14_otherFringe:     0,  col14_names: [],
          // Col 15: entertainment
          col15_entertainment:   0,  col15_names: [],
          // Col 16: vehicle running
          col16_vehicleRunning:  0,  col16_names: [],
          // Col 17: vehicle purchase
          col17_vehiclePurchase: 0,  col17_names: [],
          // Col 18: subsistence/travel
          col18_subsistence:     0,  col18_names: [],
          // Col 19: other allowance (taxable)
          col19_otherAllowance:  0,  col19_names: [],
          // Col 21: other income (non-taxable)
          col21_otherIncome:     0,  col21_names: [],
          // Col 23: annuity income (not currently used)
          col23_annuityIncome:   0,

          // Funds (Cols 25–36)
          pensionContrib:    0,
          providentContrib:  0,
          retirementContrib: 0,
          studyContrib:      0,

          // Totals
          annualPAYE:        0,
          // ETX-specific aggregates (from payrollCalculator)
          etxGrossRemuneration: 0,   // Col 24
          etxTotalDeductions:   0,   // Col 37
          etxTaxableIncome:     0,   // Col 38
        };
      }

      const a = annualMap[empId];

      // ── Col 5: Salaries, Wages, Pension (cash salary + OT + normal taxable items)
      // effectiveBasic (after unpaid leave deduction) + overtimePay
      a.col5_salariesWages += (ps.effectiveBasic || ps.basicSalary || 0) + (ps.overtimePay || 0);

      // Add normal-category custom taxable items into col5
      if (ps.classifiedCustomItems && Array.isArray(ps.classifiedCustomItems)) {
        for (const item of ps.classifiedCustomItems) {
          const etxCol = item.classification?.etxColumn;
          const amt    = item.amount || 0;
          if (amt <= 0) continue;

          switch (etxCol) {
            case 'col5_salaries':        a.col5_salariesWages    += amt; break;
            case 'col14_otherFringe':
              a.col14_otherFringe += amt;
              if (item.name) a.col14_names.push(item.name);
              break;
            case 'col15_entertainment':
              a.col15_entertainment += amt;
              if (item.name) a.col15_names.push(item.name);
              break;
            case 'col16_vehicleRunning':
              a.col16_vehicleRunning += amt;
              if (item.name) a.col16_names.push(item.name);
              break;
            case 'col17_vehiclePurchase':
              a.col17_vehiclePurchase += amt;
              if (item.name) a.col17_names.push(item.name);
              break;
            case 'col18_subsistence':
              a.col18_subsistence += amt;
              if (item.name) a.col18_names.push(item.name);
              break;
            case 'col19_otherAllowance':
              a.col19_otherAllowance += amt;
              if (item.name) a.col19_names.push(item.name);
              break;
            case 'col21_otherIncome':
              a.col21_otherIncome += amt;
              if (item.name) a.col21_names.push(item.name);
              break;
          }
        }
      } else {
        // Fallback: use legacy fields from older payslips (pre-classification)
        // Legacy taxableAllowances → col19
        const legTax    = ps.taxableAllowances    || 0;
        const legNonTax = ps.nonTaxableAllowances || 0;
        if (legTax    > 0) { a.col19_otherAllowance += legTax;    if (!a.col19_names.length) a.col19_names.push('Taxable Allowances'); }
        if (legNonTax > 0) { a.col21_otherIncome    += legNonTax; if (!a.col21_names.length) a.col21_names.push('Non-Taxable Allowances'); }
      }

      // ── Col 9: Housing fringe benefit tax value (the N$ amount added to taxable income)
      a.col9_housingTaxValue += ps.housingFringeBenefit || 0;

      // ── Col 13: Company vehicle fringe benefit tax value
      a.col13_vehicle += ps.vehicleFringeBenefit || 0;

      // ── Funds
      a.pensionContrib    += ps.pensionMonthly    || 0;
      a.providentContrib  += ps.providentMonthly  || 0;
      a.retirementContrib += ps.retirementMonthly || 0;
      a.studyContrib      += ps.studyMonthly      || 0;

      // ── PAYE
      a.annualPAYE += ps.paye || 0;

      // ── ETX pre-calculated fields (if available from new calculator)
      if (ps.etxGrossRemuneration !== undefined) {
        a.etxGrossRemuneration += ps.etxGrossRemuneration;
        a.etxTotalDeductions   += ps.etxTotalDeductions;
        a.etxTaxableIncome     += ps.etxTaxableIncome;
      } else {
        // Fallback: reconstruct for legacy payslips
        a.etxGrossRemuneration += ps.taxableGross || ps.grossPay || 0;
        a.etxTotalDeductions   += (ps.pensionMonthly || 0) + (ps.providentMonthly || 0)
                                + (ps.retirementMonthly || 0) + (ps.studyMonthly || 0);
        a.etxTaxableIncome     += Math.max(0, (ps.taxableGross || ps.grossPay || 0)
                                - (ps.pensionMonthly || 0) - (ps.providentMonthly || 0)
                                - (ps.retirementMonthly || 0) - (ps.studyMonthly || 0));
      }
    }
  }

  return annualMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT: generateETXBuffer
// ─────────────────────────────────────────────────────────────────────────────

async function generateETXBuffer(payrollRuns, employees, taxYear) {
  const annualMap = buildAnnualMap(payrollRuns, employees);

  const wb = new ExcelJS.Workbook();
  wb.creator  = 'Veldt Payroll';
  wb.created  = new Date();

  const ws = wb.addWorksheet('PAYE4', {
    views:      [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultColWidth: 18 },
  });

  // ── Header row ─────────────────────────────────────────────────────────────
  const headerRow = ws.addRow(ETX_COLUMNS);
  headerRow.height = 44;
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    cell.font      = { bold: true, size: 8.5, name: 'Calibri', color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border    = THIN_B;

    // Colour-code column groups for readability
    const col = colNum;
    if (col >= 9  && col <= 14)  cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1A3D6B' } }; // fringe (darker blue)
    else if (col >= 15 && col <= 22) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1F4788' } }; // allowances
    else if (col >= 25 && col <= 36) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1A6B1A' } }; // funds (green)
    else if (col >= 37 && col <= 40) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF6B1A1A' } }; // tax (red)
    else                             cell.fill = FILL_HEADER;
  });

  let rowNum = 1;
  const colTotals = new Array(81).fill(0);

  for (const [, a] of Object.entries(annualMap)) {
    const emp  = a.employee || {};
    const snap = a.snapshot  || {};

    // ── Col 9/10/11: Housing fringe ─────────────────────────────────────────
    const col9_housingTaxValue  = r2(a.col9_housingTaxValue);
    const col10_exemptHousing   = 0;   // Free housing is fully taxable in Namibia
    const col11_taxableHousing  = r2(col9_housingTaxValue - col10_exemptHousing);

    // ── Col 24: Gross Remuneration ───────────────────────────────────────────
    // Use pre-calculated ETX gross remuneration from payrollCalculator.
    // If not available (legacy), reconstruct:
    const col24_grossRemuneration = r2(a.etxGrossRemuneration) || r2(
      a.col5_salariesWages +
      a.col6_commission +
      col9_housingTaxValue +
      a.col13_vehicle +
      a.col14_otherFringe +
      a.col15_entertainment +
      a.col16_vehicleRunning +
      a.col17_vehiclePurchase +
      a.col18_subsistence +
      a.col19_otherAllowance +
      a.col21_otherIncome +
      a.col23_annuityIncome
    );

    // ── Col 37: Total Deductions (4 funds only — NamRA definition) ───────────
    const col37_totalDeductions = r2(a.etxTotalDeductions) || r2(
      a.pensionContrib + a.providentContrib + a.retirementContrib + a.studyContrib
    );

    // ── Col 38: Taxable Income ───────────────────────────────────────────────
    const col38_taxableIncome = r2(a.etxTaxableIncome) || r2(
      Math.max(0, col24_grossRemuneration - col37_totalDeductions)
    );

    // ── Col 39/40: Tax Liability / Tax Deducted ──────────────────────────────
    const col39_taxLiability = r2(a.annualPAYE);
    const col40_taxDeducted  = r2(a.annualPAYE); // same — no directive

    // ── Other Allowance Type (Col 20) ────────────────────────────────────────
    const col20_otherAllowanceType = [...new Set(a.col19_names)].join(' / ') || '';
    const col22_otherIncomeType    = [...new Set(a.col21_names)].join(' / ') || '';

    // ── Reference No. (Col 8) ────────────────────────────────────────────────
    const refNo = `VPR-${taxYear}-${String(rowNum).padStart(4, '0')}`;

    // ── Build the 81-column data array ───────────────────────────────────────
    const rowData = [
      /* 1  */ String(rowNum).padStart(3, '0'),
      /* 2  */ emp.tinNumber  || snap.tinNumber  || '',
      /* 3  */ emp.idNumber   || snap.idNumber   || '',
      /* 4  */ emp.fullName   || snap.fullName   || '',
      /* 5  */ r2(a.col5_salariesWages),
      /* 6  */ r2(a.col6_commission),
      /* 7  */ HOUSING_MAP[emp.housingType] || '',
      /* 8  */ refNo,
      /* 9  */ col9_housingTaxValue,
      /* 10 */ col10_exemptHousing,
      /* 11 */ col11_taxableHousing,
      /* 12 */ 0,   // Subsidised loans — not currently tracked
      /* 13 */ r2(a.col13_vehicle),
      /* 14 */ r2(a.col14_otherFringe),
      /* 15 */ r2(a.col15_entertainment),
      /* 16 */ r2(a.col16_vehicleRunning),
      /* 17 */ r2(a.col17_vehiclePurchase),
      /* 18 */ r2(a.col18_subsistence),
      /* 19 */ r2(a.col19_otherAllowance),
      /* 20 */ col20_otherAllowanceType,
      /* 21 */ r2(a.col21_otherIncome),
      /* 22 */ col22_otherIncomeType,
      /* 23 */ r2(a.col23_annuityIncome),
      /* 24 */ col24_grossRemuneration,
      /* 25 */ emp.pensionFundName   || snap.pensionFundName   || '',
      /* 26 */ emp.pensionFundRegNo  || snap.pensionFundRegNo  || '',
      /* 27 */ r2(a.pensionContrib),
      /* 28 */ emp.providentFundName  || snap.providentFundName  || '',
      /* 29 */ emp.providentFundRegNo || snap.providentFundRegNo || '',
      /* 30 */ r2(a.providentContrib),
      /* 31 */ emp.retirementFundName  || snap.retirementFundName  || '',
      /* 32 */ emp.retirementFundRegNo || snap.retirementFundRegNo || '',
      /* 33 */ r2(a.retirementContrib),
      /* 34 */ emp.studyPolicyName  || snap.studyPolicyName  || '',
      /* 35 */ emp.studyPolicyRegNo || snap.studyPolicyRegNo || '',
      /* 36 */ r2(a.studyContrib),
      /* 37 */ col37_totalDeductions,
      /* 38 */ col38_taxableIncome,
      /* 39 */ col39_taxLiability,
      /* 40 */ col40_taxDeducted,
      /* 41–80: Five directive slots (all blank for regular employment) */
      ...new Array(40).fill(''),
      /* 81 */ col24_grossRemuneration,   // Totals checksum = Gross Remuneration
    ];

    // Accumulate column totals for TOTALS row
    rowData.forEach((val, idx) => {
      if (typeof val === 'number') colTotals[idx] = (colTotals[idx] || 0) + val;
    });

    // ── Write data row ─────────────────────────────────────────────────────
    const dataRow = ws.addRow(rowData);
    const rowFill = rowNum % 2 === 0 ? FILL_ALT : FILL_WHITE;

    dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.border = THIN_B;
      // Override fill for special column groups
      if (colNum >= 9  && colNum <= 14)  cell.fill = FILL_FRINGE;
      else if (colNum >= 25 && colNum <= 36) cell.fill = FILL_FUNDS;
      else cell.fill = rowFill;

      const v = rowData[colNum - 1];
      if (typeof v === 'number') {
        cell.numFmt    = '#,##0.00';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.font      = { size: 8.5, name: 'Calibri', color: { argb: 'FF1F1F1F' } };
      } else {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.font      = { size: 8.5, name: 'Calibri', color: { argb: 'FF333333' } };
      }
    });

    rowNum++;
  }

  // ── TOTALS row ─────────────────────────────────────────────────────────────
  const totalsData = new Array(81).fill('');
  totalsData[0] = 'TOTALS';
  colTotals.forEach((val, idx) => {
    if (val && typeof val === 'number') totalsData[idx] = r2(val);
  });

  const totalsRow = ws.addRow(totalsData);
  totalsRow.height = 20;
  totalsRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    cell.font      = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FF111111' } };
    cell.fill      = FILL_TOTALS;
    cell.border    = MEDIUM_B;
    const v = totalsData[colNum - 1];
    if (typeof v === 'number') {
      cell.numFmt    = '#,##0.00';
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
  });

  // ── Column widths ──────────────────────────────────────────────────────────
  ws.columns.forEach((col, idx) => {
    const i = idx + 1;
    if      (i === 1)              col.width = 7;
    else if (i === 4)              col.width = 28;
    else if (i === 7)              col.width = 18;
    else if (i === 8)              col.width = 20;
    else if (i === 20 || i === 22) col.width = 24;
    else if (i >= 41 && i <= 80)   col.width = 14;
    else                           col.width = 16;
  });

  // ── Tab/sheet colour for easy identification ───────────────────────────────
  ws.state = 'visible';

  return await wb.xlsx.writeBuffer();
}

module.exports = { generateETXBuffer };