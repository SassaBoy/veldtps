/**
 * PayrollRun Model
 * Stores the result of a monthly payroll run for a company
 */

const mongoose = require('mongoose');

// ─── Sub-document: individual employee payslip data ──────────────────────────
const payslipSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  // Snapshot of employee details at time of payroll (in case they change later)
  employeeSnapshot: {
    fullName: String,
    idNumber: String,
    position: String,
    department: String,
    email: String,
    phone: String
  },

  // ─── Inputs ───────────────────────────────────────────────────────────────
  daysWorked: { type: Number, default: 0, min: 0 },
  hoursWorked: { type: Number, default: 0, min: 0 },
  overtimeHours: { type: Number, default: 0, min: 0 },
  annualLeaveTaken: { type: Number, default: 0, min: 0 },
  sickLeaveTaken: { type: Number, default: 0, min: 0 },

  // ─── Calculated Values ────────────────────────────────────────────────────
  basicSalary: { type: Number, required: true, min: 0 },
  overtimePay: { type: Number, default: 0, min: 0 },
  grossPay: { type: Number, required: true, min: 0 },

  // Tax & deductions
  annualizedGross: { type: Number, default: 0 },  // grossPay × 12
  annualTax: { type: Number, default: 0 },          // full-year PAYE
  paye: { type: Number, default: 0, min: 0 },       // monthly PAYE (annualTax / 12)

  // Social Security Contributions
  sscEmployee: { type: Number, default: 0, min: 0 }, // 0.9% employee portion
  sscEmployer: { type: Number, default: 0, min: 0 }, // 0.9% employer portion

  // Employer Compensation Fund (employer only)
  ecf: { type: Number, default: 0, min: 0 },

  // ─── Totals ───────────────────────────────────────────────────────────────
  totalDeductions: { type: Number, default: 0, min: 0 }, // PAYE + sscEmployee
  netPay: { type: Number, required: true, min: 0 },

  // Total employer cost = grossPay + sscEmployer + ecf
  totalEmployerCost: { type: Number, default: 0, min: 0 }
}, { _id: true });

// ─── Main PayrollRun document ─────────────────────────────────────────────────
const payrollRunSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  year: {
    type: Number,
    required: true,
    min: 2020
  },
  status: {
    type: String,
    enum: ['draft', 'finalised'],
    default: 'finalised'
  },

  // ─── Summary totals ───────────────────────────────────────────────────────
  totalGrossPay: { type: Number, default: 0 },
  totalNetPay: { type: Number, default: 0 },
  totalPAYE: { type: Number, default: 0 },
  totalSSCEmployee: { type: Number, default: 0 },
  totalSSCEmployer: { type: Number, default: 0 },
  totalECF: { type: Number, default: 0 },
  totalEmployerCost: { type: Number, default: 0 },
  employeeCount: { type: Number, default: 0 },

  // ─── Individual payslips ──────────────────────────────────────────────────
  payslips: [payslipSchema],

  // Settings snapshot at time of run
  settingsSnapshot: {
    ecfRate: Number,
    sscRate: Number,
    sscCap: Number,
    taxBrackets: mongoose.Schema.Types.Mixed
  },

  processedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// ─── Compound unique index: one payroll run per company per month/year ────────
payrollRunSchema.index({ company: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('PayrollRun', payrollRunSchema);
