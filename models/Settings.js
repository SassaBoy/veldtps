/**
 * Settings Model
 * Stores per-company payroll configuration (ECF rate, SSC cap, tax brackets).
 * One document per company. Tax brackets stored here so admin can update them.
 */

const mongoose = require('mongoose');

const taxBracketSchema = new mongoose.Schema({
  min: { type: Number, required: true },       // Lower bound (NAD annual)
  max: { type: Number, default: null },         // Upper bound (null = no limit)
  baseAmount: { type: Number, required: true }, // Fixed tax on amounts up to min
  rate: { type: Number, required: true },       // Marginal rate (as decimal, e.g. 0.25)
  description: { type: String }                 // Human-readable label
}, { _id: false });

const settingsSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // ─── Employer Compensation Fund ───────────────────────────────────────────
  ecfRate: {
    type: Number,
    default: 0.04, // 4% (stored as decimal)
    min: 0,
    max: 1
  },

  // ─── Social Security Contributions ───────────────────────────────────────
  sscRate: {
    type: Number,
    default: 0.009, // 0.9% (stored as decimal)
    min: 0,
    max: 1
  },
  sscMonthlyCap: {
    type: Number,
    default: 11000 // N$11,000/month max salary used for SSC calculation
  },
  sscMaxContribution: {
    type: Number,
    default: 99 // Max N$99 per month each side
  },

  // ─── Namibia PAYE Tax Brackets (2026) ────────────────────────────────────
  // Annual taxable income brackets
  taxBrackets: {
    type: [taxBracketSchema],
    default: [
      { min: 0,         max: 100000,   baseAmount: 0,       rate: 0,    description: '0 – 100,000: 0%' },
      { min: 100001,    max: 150000,   baseAmount: 0,       rate: 0.18, description: '100,001 – 150,000: 18% on excess over 100,000' },
      { min: 150001,    max: 350000,   baseAmount: 9000,    rate: 0.25, description: '150,001 – 350,000: N$9,000 + 25% above 150,000' },
      { min: 350001,    max: 550000,   baseAmount: 59000,   rate: 0.28, description: '350,001 – 550,000: N$59,000 + 28% above 350,000' },
      { min: 550001,    max: 850000,   baseAmount: 115000,  rate: 0.30, description: '550,001 – 850,000: N$115,000 + 30% above 550,000' },
      { min: 850001,    max: 1550000,  baseAmount: 205000,  rate: 0.32, description: '850,001 – 1,550,000: N$205,000 + 32% above 850,000' },
      { min: 1550001,   max: null,     baseAmount: 429000,  rate: 0.37, description: 'Above 1,550,000: N$429,000 + 37% above 1,550,000' }
    ]
  },

  // Overtime multiplier (default 1.5x for overtime hours)
  overtimeMultiplier: {
    type: Number,
    default: 1.5,
    min: 1
  },

  // Standard working days per month (used for daily rate calculation)
  workingDaysPerMonth: {
    type: Number,
    default: 22,
    min: 1
  }

}, {
  timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);
