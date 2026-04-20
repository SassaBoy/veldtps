/**
 * models/PayrollRun.js – Veldt Payroll
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CHANGES FROM PREVIOUS VERSION:
 *
 * 1. classifiedCustomItems — replaces raw customItems array
 *    Each item now carries its `classification` object (payslipSection,
 *    etxColumn, affectsGrossPay, affectsTaxableGross, isCash) so the
 *    payslip PDF, ETX generator, and compliance reports all share one
 *    consistent classification instead of re-deriving it.
 *
 * 2. ETX-specific fields on each payslip sub-document:
 *    - etxGrossRemuneration  (Col 24)
 *    - etxTotalDeductions    (Col 37 — 4 funds only, not medical/SSC)
 *    - etxTaxableIncome      (Col 38)
 *    These are pre-calculated by payrollCalculator and stored here to
 *    ensure the ETX file is always consistent with how payroll was calculated.
 *
 * 3. grossPay semantic change:
 *    grossPay now represents CASH ONLY (excludes fringe benefits).
 *    taxableGross is the PAYE base (includes fringe benefits).
 *    Previously these were conflated.
 *
 * 4. Run-level totals:
 *    - totalTaxableGross  (sum of taxableGross across payslips — for ETX)
 *    - totalETXGross      (sum of etxGrossRemuneration — for Col 24 total)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const mongoose = require('mongoose');

// ── Custom item value sub-document ────────────────────────────────────────────
const customItemValueSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  name:   { type: String, required: true },
  type: {
    type:     String,
    enum:     ['earning_taxable', 'earning_nontaxable', 'deduction'],
    required: true,
  },
  // Category determines ETX column and payslip section
  category: {
    type:    String,
    enum:    [
      'normal', 'other_allowance', 'other_income', 'fringe_benefit',
      'entertainment_allowance', 'vehicle_running_allowance',
      'vehicle_purchase_allowance', 'subsistence_travel',
    ],
    default: 'normal',
  },
  amount: { type: Number, default: 0, min: 0 },
  // Derived classification stored at run-time (from payrollCalculator.classifyCustomItem)
  classification: {
    payslipSection:      String,  // 'earnings_cash' | 'earnings_noncash' | 'deductions'
    etxColumn:           String,  // 'col5_salaries' | 'col14_otherFringe' | etc.
    affectsGrossPay:     Boolean, // does this add to CASH gross pay?
    affectsTaxableGross: Boolean, // does this add to taxable income (PAYE base)?
    isCash:              Boolean, // is this a cash payment?
  },
}, { _id: false });

// ── Payslip sub-document ──────────────────────────────────────────────────────
const payslipSchema = new mongoose.Schema({
  employee: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Employee',
    required: true,
  },

  // ── Employee snapshot (frozen at run time) ────────────────────────────────
  employeeSnapshot: {
    fullName:            { type: String },
    idNumber:            { type: String },
    tinNumber:           { type: String },
    sscNumber:           { type: String },
    position:            { type: String },
    department:          { type: String },
    email:               { type: String },
    phone:               { type: String },
    bankName:            { type: String },
    bankAccountNumber:   { type: String },
    branchCode:          { type: String },
    accountType:         { type: String },
    pensionFundName:     { type: String },
    pensionFundRegNo:    { type: String },
    providentFundName:   { type: String },
    providentFundRegNo:  { type: String },
    retirementFundName:  { type: String },
    retirementFundRegNo: { type: String },
    studyPolicyName:     { type: String },
    studyPolicyRegNo:    { type: String },
    medicalAidFundName:  { type: String },
    medicalAidMemberNo:  { type: String },
    housingType:         { type: String, enum: ['none','free','subsidised'], default: 'none' },
    hasCompanyVehicle:   { type: Boolean, default: false },
  },

  // ── Working time ──────────────────────────────────────────────────────────
  workingDaysInMonth: { type: Number, default: 22 },
  hoursPerDay:        { type: Number, default: 8 },
  dailyRate:          { type: Number, default: 0 },
  hourlyRate:         { type: Number, default: 0 },

  // ── Leave ─────────────────────────────────────────────────────────────────
  annualLeavePaid:      { type: Number, default: 0, min: 0 },
  annualLeaveUnpaid:    { type: Number, default: 0, min: 0 },
  sickLeavePaid:        { type: Number, default: 0, min: 0 },
  sickLeaveUnpaid:      { type: Number, default: 0, min: 0 },
  unpaidLeaveDeduction: { type: Number, default: 0, min: 0 },

  // ── Overtime ──────────────────────────────────────────────────────────────
  normalOvertimeHours:         { type: Number, default: 0, min: 0 },
  publicHolidayOvertimeHours:  { type: Number, default: 0, min: 0 },
  overtimePay:                 { type: Number, default: 0, min: 0 },

  // ── Legacy allowance fields (kept for backward compat) ───────────────────
  taxableAllowances:    { type: Number, default: 0, min: 0 },
  nonTaxableAllowances: { type: Number, default: 0, min: 0 },
  otherDeductions:      { type: Number, default: 0, min: 0 },

  // ── Custom items (with classification stored at run time) ─────────────────
  classifiedCustomItems: { type: [customItemValueSchema], default: [] },

  // ── Earnings ──────────────────────────────────────────────────────────────
  basicSalary:    { type: Number, required: true, min: 0 },
  effectiveBasic: { type: Number, default: 0, min: 0 },

  /**
   * taxableGross = PAYE base
   *   = effectiveBasic + overtimePay + taxable cash items + fringe benefits
   *   INCLUDES housing/vehicle fringe (non-cash) for tax purposes
   */
  taxableGross: { type: Number, default: 0 },

  /**
   * grossPay = CASH ONLY
   *   = effectiveBasic + overtimePay + all cash allowances (taxable + non-taxable)
   *   EXCLUDES fringe benefits (they are non-cash)
   *
   * ⚠ Breaking change from v1: grossPay no longer includes fringe benefits.
   */
  grossPay:       { type: Number, required: true, min: 0 },
  annualizedGross: { type: Number, default: 0 },

  // ── Fringe benefits (non-cash — tracked for tax and ETX) ──────────────────
  housingFringeBenefit: { type: Number, default: 0 },
  vehicleFringeBenefit: { type: Number, default: 0 },
  totalFringeBenefits:  { type: Number, default: 0 },

  // ── Fund contributions ────────────────────────────────────────────────────
  pensionMonthly:    { type: Number, default: 0 },
  providentMonthly:  { type: Number, default: 0 },
  retirementMonthly: { type: Number, default: 0 },
  studyMonthly:      { type: Number, default: 0 },
  medicalMonthly:    { type: Number, default: 0 },

  // ── Tax & statutory ───────────────────────────────────────────────────────
  annualTaxableIncome: { type: Number, default: 0 },
  annualTax:           { type: Number, default: 0 },
  paye:            { type: Number, default: 0, min: 0 },
  sscEmployee:     { type: Number, default: 0, min: 0 },
  sscEmployer:     { type: Number, default: 0, min: 0 },
  ecf:             { type: Number, default: 0, min: 0 },

  totalDeductions: { type: Number, default: 0, min: 0 },
  netPay:          { type: Number, required: true, min: 0 },
  totalEmployerCost: { type: Number, default: 0, min: 0 },

  // ── ETX-specific pre-calculated fields ───────────────────────────────────
  /**
   * etxGrossRemuneration — NamRA ETX Col 24
   * = all remuneration including fringe benefit tax values
   *   (basically taxableGross + non-taxable cash allowances)
   */
  etxGrossRemuneration: { type: Number, default: 0 },

  /**
   * etxTotalDeductions — NamRA ETX Col 37
   * = pension + provident + retirement + study ONLY
   *   (NOT medical aid, NOT SSC — NamRA definition)
   */
  etxTotalDeductions: { type: Number, default: 0 },

  /**
   * etxTaxableIncome — NamRA ETX Col 38
   * = etxGrossRemuneration − etxTotalDeductions
   */
  etxTaxableIncome: { type: Number, default: 0 },

}, { _id: true });

// ── PayrollRun root document ──────────────────────────────────────────────────
const payrollRunSchema = new mongoose.Schema({
  company: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },
  month:  { type: Number, required: true, min: 1, max: 12 },
  year:   { type: Number, required: true, min: 2020 },
  status: { type: String, enum: ['draft','finalised'], default: 'draft' },

  // ── Summary totals ────────────────────────────────────────────────────────
  totalGrossPay:        { type: Number, default: 0 },  // cash only
  totalTaxableGross:    { type: Number, default: 0 },  // includes fringe (PAYE base)
  totalETXGross:        { type: Number, default: 0 },  // ETX Col 24 total
  totalNetPay:          { type: Number, default: 0 },
  totalPAYE:            { type: Number, default: 0 },
  totalSSCEmployee:     { type: Number, default: 0 },
  totalSSCEmployer:     { type: Number, default: 0 },
  totalECF:             { type: Number, default: 0 },
  totalOtherDeductions: { type: Number, default: 0 },
  totalEmployerCost:    { type: Number, default: 0 },
  totalUnpaidLeaveDeduction: { type: Number, default: 0 },
  totalFringeBenefits:  { type: Number, default: 0 },
  employeeCount:        { type: Number, default: 0 },

  payslips: [payslipSchema],

  settingsSnapshot: {
    ecfRate:                       Number,
    sscRate:                       Number,
    sscCap:                        Number,
    taxBrackets:                   mongoose.Schema.Types.Mixed,
    hoursPerDay:                   Number,
    normalOvertimeMultiplier:      Number,
    publicHolidayOvertimeMultiplier: Number,
    fringeBenefits:                mongoose.Schema.Types.Mixed,
  },

  processedAt: { type: Date, default: Date.now },
}, { timestamps: true });

payrollRunSchema.index({ company: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('PayrollRun', payrollRunSchema);