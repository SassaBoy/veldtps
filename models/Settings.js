/**
 * models/Settings.js
 * Per-company payroll configuration + payslip design + custom pay items.
 */

const mongoose = require('mongoose');

// ── Tax bracket sub-doc ───────────────────────────────────────────────────────
const taxBracketSchema = new mongoose.Schema({
  min:         { type: Number, required: true },
  max:         { type: Number, default: null },
  baseAmount:  { type: Number, required: true },
  rate:        { type: Number, required: true },
  description: { type: String }
}, { _id: false });

// ── Payslip theme sub-doc ─────────────────────────────────────────────────────
const payslipThemeSchema = new mongoose.Schema({
  accentColor:               { type: String,  default: '#000000' },
  showEmployerContributions: { type: Boolean, default: true },
  showLeaveBalances:         { type: Boolean, default: true },
  showRefNumber:             { type: Boolean, default: true },
  footerNote:                { type: String,  default: '', maxlength: 300 }
}, { _id: false });

// ── Custom pay item sub-doc ───────────────────────────────────────────────────
const customPayItemSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true, maxlength: 60 },
  type: {
    type: String,
    required: true,
    enum: ['earning_taxable', 'earning_nontaxable', 'deduction']
  },
  // NEW: This tells us exactly where it goes in ETX and on payslip
  category: {
    type: String,
    enum: [
      'normal',                     // Regular salary / normal earning
      'other_allowance',            // Other Allowance (Specify)
      'other_income',               // Other Income (Specify)
      'fringe_benefit',             // Other fringe benefits
      'entertainment_allowance',    // Entertainment Allowance
      'vehicle_running_allowance',  // Vehicle running expense allowance
      'vehicle_purchase_allowance', // Vehicle purchase allowance
      'subsistence_travel'          // Subsistence and Travel Expense Allowance
    ],
    default: 'normal'
  },
  inputMode:    { type: String, enum: ['variable', 'fixed'], default: 'variable' },
  defaultAmount:{ type: Number, default: 0, min: 0 },
  description:  { type: String, trim: true, maxlength: 120, default: '' },
  isActive:     { type: Boolean, default: true }
}, { _id: true, timestamps: false });

// ── Main Settings schema ──────────────────────────────────────────────────────
const settingsSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  ecfRate:             { type: Number, default: 0.04,  min: 0, max: 1 },
  sscRate:             { type: Number, default: 0.009, min: 0, max: 1 },
  sscMonthlyCap:       { type: Number, default: 11000 },
  sscMaxContribution:  { type: Number, default: 99 },

  taxBrackets: {
    type: [taxBracketSchema],
    default: [
      { min: 0,       max: 100000,  baseAmount: 0,      rate: 0,    description: '0 – 100,000: 0%'           },
      { min: 100001,  max: 150000,  baseAmount: 0,      rate: 0.18, description: '100,001 – 150,000: 18%'    },
      { min: 150001,  max: 350000,  baseAmount: 9000,   rate: 0.25, description: '150,001 – 350,000: 25%'    },
      { min: 350001,  max: 550000,  baseAmount: 59000,  rate: 0.28, description: '350,001 – 550,000: 28%'    },
      { min: 550001,  max: 850000,  baseAmount: 115000, rate: 0.30, description: '550,001 – 850,000: 30%'    },
      { min: 850001,  max: 1550000, baseAmount: 205000, rate: 0.32, description: '850,001 – 1,550,000: 32%'  },
      { min: 1550001, max: null,    baseAmount: 429000, rate: 0.37, description: 'Above 1,550,000: 37%'      }
    ]
  },

  // ── UPDATED: Separated normal and public holiday overtime rates ──────────────
  normalOvertimeMultiplier:     { type: Number, default: 1.5, min: 1 },
  publicHolidayOvertimeMultiplier: { type: Number, default: 2.0, min: 1 },
  
  workingDaysInMonth: { type: Number, default: 22,  min: 1 },
  hoursPerDay: { type: Number, default: 8, min: 1, max: 24 },

  payslipTheme: { type: payslipThemeSchema, default: () => ({}) },

  /** Company-defined custom earnings and deductions */
  customPayItems: { type: [customPayItemSchema], default: [] },

  // ── Fringe Benefits Configuration (User can customize rates) ───────────────
  fringeBenefits: {
    housing: {
      freeRate:       { type: Number, default: 0.10, min: 0 },     // 10% of basic salary for free housing
      subsidisedRate: { type: Number, default: 0.05, min: 0 }      // 5% of basic salary for subsidised housing
    },
    vehicle: {
      monthlyDeterminedValue: { type: Number, default: 1500, min: 0 }   // Default N$1,500 per month
    }
  }

}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);