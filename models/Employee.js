/**
 * models/Employee.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Namibia-compliant employee model.
 *
 * KEY UPDATES:
 *  1. Added Provident Fund, Retirement Fund, and Study Policy fields
 *  2. Four YTD (year-to-date) leave accumulation fields for portal reporting
 *  3. All fields backward-compatible with existing data
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const employeeSchema = new mongoose.Schema({

  // ─── Link to company ──────────────────────────────────────────────────────
  company: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },

  // ─── Personal Details ─────────────────────────────────────────────────────
  fullName: {
    type:      String,
    required:  [true, 'Full name is required'],
    trim:      true,
    maxlength: [100, 'Name cannot exceed 100 characters'],
  },

  /**
   * Namibian ID — 11 digits, format: YYMMDDSSSSQ
   */
  idNumber: {
    type:     String,
    required: [true, 'Namibian ID number is required'],
    trim:     true,
    match:    [/^\d{11}$/, 'Namibian ID number must be exactly 11 digits'],
  },

  /**
   * NamRA Taxpayer Identification Number (TIN) — 10 digits.
   */
  tinNumber: {
    type:  String,
    trim:  true,
    match: [/^\d{10}$/, 'TIN must be exactly 10 digits'],
  },

  /**
   * Social Security Commission registration number.
   */
  socialSecurityNumber: {
    type:      String,
    trim:      true,
    maxlength: [20, 'SSC number cannot exceed 20 characters'],
  },

  email: {
    type:      String,
    required:  [true, 'Email is required'],
    lowercase: true,
    trim:      true,
    match:     [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
  },

  phone: {
    type:      String,
    trim:      true,
    maxlength: [20, 'Phone cannot exceed 20 characters'],
  },

  // ─── Employment Details ───────────────────────────────────────────────────
  position: {
    type:      String,
    trim:      true,
    maxlength: [100, 'Position cannot exceed 100 characters'],
  },
  department: {
    type:      String,
    trim:      true,
    maxlength: [100, 'Department cannot exceed 100 characters'],
  },
  basicSalary: {
    type:     Number,
    required: [true, 'Basic monthly salary is required'],
    min:      [0, 'Salary cannot be negative'],
  },
  dateJoined: {
    type:     Date,
    required: [true, 'Date joined is required'],
  },

  // ─── Pension (affects PAYE — tax-deductible) ─────────────────────────────
  pensionFundName: {
    type:      String,
    trim:      true,
    maxlength: [100, 'Pension fund name cannot exceed 100 characters'],
  },
  pensionFundRegNo: {
    type:      String,
    trim:      true,
    maxlength: [50, 'Fund registration number cannot exceed 50 characters'],
  },
  /** Monthly pension contribution (NAD) — reduces taxable income before PAYE */
  pensionContribution: {
    type:    Number,
    default: 0,
    min:     0,
  },

  // ─── Provident Fund (NEW — affects PAYE — tax-deductible) ───────────────
  providentFundName: {
    type:      String,
    trim:      true,
    maxlength: [100, 'Provident fund name cannot exceed 100 characters'],
  },
  providentFundRegNo: {
    type:      String,
    trim:      true,
    maxlength: [50, 'Fund registration number cannot exceed 50 characters'],
  },
  /** Monthly provident fund contribution (NAD) — reduces taxable income before PAYE */
  providentFundContribution: {
    type:    Number,
    default: 0,
    min:     0,
  },

  // ─── Retirement Fund (NEW — affects PAYE — tax-deductible) ───────────────
  retirementFundName: {
    type:      String,
    trim:      true,
    maxlength: [100, 'Retirement fund name cannot exceed 100 characters'],
  },
  retirementFundRegNo: {
    type:      String,
    trim:      true,
    maxlength: [50, 'Fund registration number cannot exceed 50 characters'],
  },
  /** Monthly retirement fund contribution (NAD) — reduces taxable income before PAYE */
  retirementFundContribution: {
    type:    Number,
    default: 0,
    min:     0,
  },

  // ─── Study Policy (NEW — affects PAYE — tax-deductible) ──────────────────
  studyPolicyName: {
    type:      String,
    trim:      true,
    maxlength: [100, 'Study policy name cannot exceed 100 characters'],
  },
  studyPolicyRegNo: {
    type:      String,
    trim:      true,
    maxlength: [50, 'Study policy registration number cannot exceed 50 characters'],
  },
  /** Monthly study policy contribution (NAD) — reduces taxable income before PAYE */
  studyPolicyContribution: {
    type:    Number,
    default: 0,
    min:     0,
  },

  // ─── Medical Aid (affects PAYE — tax-deductible) ─────────────────────────
  medicalAidFundName: {
    type:      String,
    trim:      true,
    maxlength: [100, 'Medical aid fund name cannot exceed 100 characters'],
  },
  medicalAidMemberNo: {
    type:      String,
    trim:      true,
    maxlength: [50, 'Medical aid number cannot exceed 50 characters'],
  },
  /** Monthly medical aid contribution (NAD) — reduces taxable income before PAYE */
  medicalAidContribution: {
    type:    Number,
    default: 0,
    min:     0,
  },

  // ─── Fringe Benefits (affect taxable gross — increase PAYE) ──────────────
  /**
   * hasCompanyVehicle — if true, a notional monthly vehicle benefit
   * (N$1 500 by default) is added to the employee's taxable gross.
   */
  hasCompanyVehicle: {
    type:    Boolean,
    default: false,
  },

  /**
   * housingType — determines housing fringe benefit:
   *   'none'       → no benefit
   *   'free'       → 10% of basic salary added to taxable gross
   *   'subsidised' → 5% of basic salary added to taxable gross
   */
  housingType: {
    type:    String,
    enum:    ['none', 'free', 'subsidised'],
    default: 'none',
  },

  // ─── Leave Balances (remaining entitlement) ───────────────────────────────
  annualLeaveBalance: {
    type:    Number,
    default: 24,
    min:     0,
  },
  sickLeaveBalance: {
    type:    Number,
    default: 30,
    min:     0,
  },

  // ─── YTD Leave Taken (accumulated by payroll runs) ───────────────────────
  // These accumulate throughout the year and are displayed on the Employee Portal.
  // They are reset manually (or via a year-end process) at the start of each tax year.
  annualLeavePaidYTD: {
    type:    Number,
    default: 0,
    min:     0,
  },
  annualLeaveUnpaidYTD: {
    type:    Number,
    default: 0,
    min:     0,
  },
  sickLeavePaidYTD: {
    type:    Number,
    default: 0,
    min:     0,
  },
  sickLeaveUnpaidYTD: {
    type:    Number,
    default: 0,
    min:     0,
  },

  // ─── Banking Details ──────────────────────────────────────────────────────
  bankName: {
    type:      String,
    trim:      true,
    maxlength: [80, 'Bank name cannot exceed 80 characters'],
  },
  bankAccountNumber: {
    type:      String,
    trim:      true,
    maxlength: [30, 'Account number cannot exceed 30 characters'],
  },
  bankBranchCode: {
    type:      String,
    trim:      true,
    maxlength: [10, 'Branch code cannot exceed 10 characters'],
  },
  accountType: {
    type:    String,
    enum:    ['cheque', 'savings', 'transmission', ''],
    default: '',
  },

  // ─── Portal Access & Verification ─────────────────────────────────────────
  portalPassword:       { type: String },
  portalEnabled:        { type: Boolean, default: false },
  emailVerified:        { type: Boolean, default: false },
  verificationToken:    String,
  resetPasswordToken:   String,
  resetPasswordExpires: Date,

  // ─── Status ───────────────────────────────────────────────────────────────
  isActive: {
    type:    Boolean,
    default: true,
  },

}, { timestamps: true });

// ─── Indexes ──────────────────────────────────────────────────────────────────
employeeSchema.index({ company: 1, email: 1    }, { unique: true });
employeeSchema.index({ company: 1, idNumber: 1 }, { unique: true });

// ─── Hash portal password on change ──────────────────────────────────────────
employeeSchema.pre('save', async function (next) {
  if (!this.isModified('portalPassword') || !this.portalPassword) return next();
  try {
    const salt         = await bcrypt.genSalt(12);
    this.portalPassword = await bcrypt.hash(this.portalPassword, salt);
    next();
  } catch (err) {
    next(err);
  }
});

employeeSchema.methods.comparePortalPassword = async function (candidate) {
  if (!this.portalPassword) return false;
  return bcrypt.compare(candidate, this.portalPassword);
};

module.exports = mongoose.model('Employee', employeeSchema);