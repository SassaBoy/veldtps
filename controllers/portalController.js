/**
 * controllers/portalController.js – Veldt Payroll Employee Portal
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles employee self-service portal:
 * - Login / logout / email verification
 * - Dashboard (leave balances + payslip history)
 * - Payslip PDF download (theme-aware)
 * - PAYE5 / ITA5 annual tax certificate download
 * - Forgot password + reset password (fully integrated)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { validationResult } = require('express-validator');
const Employee   = require('../models/Employee');
const PayrollRun = require('../models/PayrollRun');
const User       = require('../models/User');
const Settings   = require('../models/Settings');
const moment     = require('moment-timezone');

const nodemailer = require('nodemailer');
const crypto     = require('crypto');

const { generatePayslipPDF }       = require('../utils/pdfGenerator');
const { generatePAYE5Certificate } = require('../utils/Paye5generator');

// ─────────────────────────────────────────────
// CONFIG & CONSTANTS
// ─────────────────────────────────────────────
const baseUrl = process.env.BASE_URL || 'https://veldtpayroll.com';

// ─────────────────────────────────────────────
// Nodemailer transporter (same as main auth)
// ─────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ─────────────────────────────────────────────
// HELPER: Send email with a timeout (non-blocking)
// ─────────────────────────────────────────────
function sendMailWithTimeout(mailOptions, timeoutMs = 8000) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Email send timeout')), timeoutMs)
  );
  return Promise.race([transporter.sendMail(mailOptions), timeoutPromise])
    .catch(err => console.error('Background email error:', err.message));
}

// ─────────────────────────────────────────────
// SHARED EMAIL STYLES
// ─────────────────────────────────────────────
const emailStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=DM+Sans:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background-color: #06111c; font-family: 'DM Sans', Arial, sans-serif; color: rgba(255,255,255,0.82); -webkit-font-smoothing: antialiased; }
  .wrapper { max-width: 620px; margin: 40px auto; background: #0d1b2a; border: 1px solid rgba(255,255,255,0.07); border-radius: 18px; overflow: hidden; }
  .header { background: linear-gradient(135deg, #112235 0%, #0d1b2a 100%); border-bottom: 1px solid rgba(245,166,35,0.18); padding: 32px 40px 28px; display: flex; align-items: center; gap: 14px; }
  .header-logo-wrap { width: 44px; height: 44px; background: #f5a623; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 22px; color: #1a0e00; }
  .header-brand { font-family: 'Sora', Arial, sans-serif; font-size: 1.25rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
  .header-tagline { font-size: 0.75rem; color: rgba(255,255,255,0.35); margin-top: 2px; letter-spacing: 0.04em; text-transform: uppercase; }
  .body { padding: 36px 40px 32px; }
  .greeting { font-family: 'Sora', Arial, sans-serif; font-size: 1.3rem; font-weight: 700; color: #fff; margin-bottom: 12px; letter-spacing: -0.02em; }
  .body p { font-size: 0.95rem; line-height: 1.7; color: rgba(255,255,255,0.6); margin-bottom: 14px; }
  .cta-wrap { margin: 28px 0; }
  .cta-btn { display: inline-block; background: #f5a623; color: #1a0e00 !important; font-family: 'Sora', Arial, sans-serif; font-size: 0.9rem; font-weight: 700; padding: 14px 32px; border-radius: 10px; text-decoration: none; letter-spacing: 0.01em; }
  .divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 24px 0; }
  .url-fallback { font-size: 0.75rem; color: rgba(255,255,255,0.25); word-break: break-all; margin-top: 10px; }
  .url-fallback a { color: rgba(245,166,35,0.6); text-decoration: none; }
  .footer { background: #071421; border-top: 1px solid rgba(255,255,255,0.06); padding: 32px 40px; text-align: center; }
  .footer p { font-size: 0.75rem; color: rgba(255,255,255,0.25); line-height: 1.8; }
  .footer a { color: rgba(245,166,35,0.6); text-decoration: none; margin: 0 8px; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION: LOGIN & LOGOUT
// ─────────────────────────────────────────────────────────────────────────────

exports.getLogin = (req, res) => {
  res.render('portal/login', {
    title:    'Employee Portal – Veldt Payroll',
    errors:    [],
    success:   req.flash('success'),
    error:     req.flash('error'),
    formData: {}
  });
};

exports.postLogin = async (req, res) => {
  const valErrors = validationResult(req);
  if (!valErrors.isEmpty()) {
    return res.render('portal/login', {
      title:    'Employee Portal – Veldt Payroll',
      errors:    valErrors.array(),
      success:   [],
      error:     [],
      formData: req.body
    });
  }

  try {
    const { email, password } = req.body;

    const employee = await Employee.findOne({
      email:         email.toLowerCase().trim(),
      isActive:      true,
      portalEnabled: true
    });

    if (!employee || !(await employee.comparePortalPassword(password))) {
      return res.render('portal/login', {
        title:    'Employee Portal – Veldt Payroll',
        errors:   [{ msg: 'Invalid email or password, or portal access is disabled.' }],
        success:  [],
        error:    [],
        formData: req.body
      });
    }

    // Email verification guard with Resend Link capability
    if (!employee.emailVerified) {
      return res.render('portal/login', {
        title:    'Employee Portal – Veldt Payroll',
        errors:   [{ 
          msg: 'Your email is not verified.', 
          resendEmail: employee.email 
        }],
        success:  [],
        error:    [],
        formData: req.body
      });
    }

    const company = await User.findById(employee.company).lean();

    req.session.employee = {
      _id:         employee._id.toString(),
      companyId:   employee.company.toString(),
      fullName:    employee.fullName,
      email:       employee.email,
      companyName: company?.companyName || ''
    };

    req.flash('success', `Welcome back, ${employee.fullName.split(' ')[0]}!`);
    res.redirect('/portal/dashboard');

  } catch (err) {
    console.error('Portal login error:', err);
    res.render('portal/login', {
      title:    'Employee Portal – Veldt Payroll',
      errors:   [{ msg: 'Login failed. Please try again.' }],
      success:  [],
      error:    [],
      formData: req.body
    });
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/portal/login'));
};

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL VERIFICATION LOGIC
// ─────────────────────────────────────────────────────────────────────────────

exports.getVerifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      req.flash('error', 'Invalid verification link.');
      return res.redirect('/portal/login');
    }

    const employee = await Employee.findOne({ verificationToken: token });

    if (!employee) {
      req.flash('error', 'Verification link is invalid or has already been used.');
      return res.redirect('/portal/login');
    }

    employee.emailVerified     = true;
    employee.verificationToken = undefined;
    await employee.save();

    req.flash('success', 'Email verified successfully! You can now access your employee portal.');
    res.redirect('/portal/login');

  } catch (err) {
    console.error('Email verification error:', err);
    req.flash('error', 'An error occurred during verification.');
    res.redirect('/portal/login');
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.redirect('/portal/login');

    const employee = await Employee.findOne({ email: email.toLowerCase().trim(), isActive: true });

    if (!employee) {
      req.flash('error', 'Account not found.');
      return res.redirect('/portal/login');
    }

    if (employee.emailVerified) {
      req.flash('success', 'Your email is already verified. Please log in.');
      return res.redirect('/portal/login');
    }

    // Generate token if not present
    if (!employee.verificationToken) {
      employee.verificationToken = crypto.randomBytes(20).toString('hex');
      await employee.save();
    }

    const verificationUrl = `${req.protocol}://${req.get('host')}/portal/verify-email?token=${employee.verificationToken}`;

    sendMailWithTimeout(buildPortalVerificationEmail({
      to: employee.email,
      fullName: employee.fullName,
      verificationUrl
    }));

    req.flash('success', `A new verification link has been sent to <strong>${employee.email}</strong>.`);
    res.redirect('/portal/login');

  } catch (err) {
    console.error('Resend error:', err);
    req.flash('error', 'Failed to resend verification email.');
    res.redirect('/portal/login');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD & DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
  try {
    const empSession = req.session.employee;
    const employee = await Employee.findById(empSession._id).lean();
    
    if (!employee) {
      req.session.destroy(() => res.redirect('/portal/login'));
      return;
    }

    employee.companyName = empSession.companyName || '';

    const payrollRuns = await PayrollRun.find({
      company: employee.company,
      status: 'finalised',
      'payslips.employee': employee._id
    }).sort({ year: -1, month: -1 }).lean();

    const myPayslips = payrollRuns.map(run => {
      const ps = run.payslips.find(p => p.employee?.toString() === employee._id.toString());
      return ps ? {
        runId: run._id.toString(),
        payslipId: ps._id.toString(),
        month: run.month,
        year: run.year,
        grossPay: ps.grossPay || 0,
        paye: ps.paye || 0,
        sscEmployee: ps.sscEmployee || 0,
        netPay: ps.netPay || 0
      } : null;
    }).filter(p => p !== null);

    res.render('portal/dashboard', {
      title: 'My Portal – Veldt Payroll',
      employee,
      myPayslips,
      success: req.flash('success'),
      moment
    });
  } catch (err) {
    console.error('Portal dashboard error:', err);
    req.flash('error', 'Could not load dashboard.');
    res.redirect('/portal/login');
  }
};

exports.downloadPayslipPDF = async (req, res) => {
  try {
    const empSession = req.session.employee;
    const payrollRun = await PayrollRun.findOne({ _id: req.params.runId, company: empSession.companyId, status: 'finalised' });
    if (!payrollRun) return res.status(404).send('Not found');

    const payslip = payrollRun.payslips.find(p => p._id.toString() === req.params.payslipId && p.employee?.toString() === empSession._id);
    if (!payslip) return res.status(403).send('Access denied');

    const companyUser = await User.findById(empSession.companyId).lean();
    const settings = await Settings.findOne({ company: empSession.companyId }).lean();
    const theme = settings?.payslipTheme || {};

    const safeName = (payslip.employeeSnapshot?.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
    const period = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2,'0')}-01`).format('MMMM_YYYY');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip_${safeName}_${period}.pdf"`);
    generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, res, theme);
  } catch (err) {
    res.status(500).send('Generation failed');
  }
};

exports.downloadPAYE5 = async (req, res) => {
  try {
    const empSession = req.session.employee;
    const taxYear = parseInt(req.params.taxYear);
    const allRuns = await PayrollRun.find({
      company: empSession.companyId,
      status: 'finalised',
      $or: [{ year: taxYear, month: { $gte: 3 } }, { year: taxYear + 1, month: { $lte: 2 } }]
    }).lean();

    const employee = await Employee.findById(empSession._id).lean();
    const companyUser = await User.findById(empSession.companyId).lean();

    const annualData = { annualSalary: 0, annualOTPay: 0, annualTaxAllow: 0, annualNonTaxAllow: 0, annualGross: 0, annualTaxGross: 0, annualPAYE: 0, annualSSCEmployee: 0 };
    let hasData = false;

    for (const run of allRuns) {
      const ps = run.payslips.find(p => p.employee?.toString() === empSession._id);
      if (ps) {
        hasData = true;
        annualData.annualSalary += ps.basicSalary || 0;
        annualData.annualOTPay += ps.overtimePay || 0;
        annualData.annualTaxAllow += ps.taxableAllowances || 0;
        annualData.annualNonTaxAllow += ps.nonTaxableAllowances || 0;
        annualData.annualGross += ps.grossPay || 0;
        annualData.annualTaxGross += ps.taxableGross || 0;
        annualData.annualPAYE += ps.paye || 0;
        annualData.annualSSCEmployee += ps.sscEmployee || 0;
      }
    }

    if (!hasData) return res.status(404).send('No records found');

    const pensionAnn = (employee.pensionContribution || 0) * 12;
    const medicalAnn = (employee.medicalAidContribution || 0) * 12;
    annualData.annualDeductions = pensionAnn + medicalAnn + annualData.annualSSCEmployee;
    annualData.taxableIncome = Math.max(0, annualData.annualTaxGross - pensionAnn - medicalAnn);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ITA5_${employee.fullName.replace(/[^a-z0-9]/gi, '_')}_${taxYear}.pdf"`);
    generatePAYE5Certificate(annualData, employee, companyUser, taxYear, res);
  } catch (err) {
    res.status(500).send('Error');
  }
};

// ─────────────────────────────────────────────
// PASSWORD RESET (UPDATED)
// ─────────────────────────────────────────────

exports.getForgotPassword = (req, res) => {
  res.render('portal/forgot-password', { 
    title: 'Forgot Portal Password', 
    success: req.flash('success'), 
    error: req.flash('error') 
  });
};

exports.postForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const employee = await Employee.findOne({ email: email.toLowerCase().trim() });
    if (!employee) {
      return res.render('portal/forgot-password', { 
        title: 'Forgot Portal Password', 
        error: ['Account not found.'], 
        success: [], 
        formData: { email } 
      });
    }
    const token = crypto.randomBytes(20).toString('hex');
    employee.resetPasswordToken = token;
    employee.resetPasswordExpires = Date.now() + 3600000;
    await employee.save({ validateBeforeSave: false });

    const resetUrl = `${req.protocol}://${req.get('host')}/portal/reset-password/${token}`;
    sendMailWithTimeout(buildPortalPasswordResetEmail({ to: employee.email, fullName: employee.fullName, resetUrl }));
    
    req.flash('success', `A reset link has been sent to ${email}`);
    res.redirect('/portal/forgot-password');
  } catch (err) {
    console.error('Forgot password error:', err);
    res.redirect('/portal/forgot-password');
  }
};

exports.getResetPassword = async (req, res) => {
  const employee = await Employee.findOne({ 
    resetPasswordToken: req.params.token, 
    resetPasswordExpires: { $gt: Date.now() } 
  });
  if (!employee) {
    return res.render('portal/forgot-password', {
      title: 'Forgot Portal Password',
      error: ['Invalid or expired reset link.'],
      success: []
    });
  }
  res.render('portal/reset-password', { 
    title: 'Reset Password', 
    token: req.params.token, 
    success: req.flash('success'), 
    error: req.flash('error') 
  });
};

// UPDATED: Render success directly on login page instead of flash + redirect
exports.postResetPassword = async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;   // Note: using confirmPassword to match form

    const employee = await Employee.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!employee) {
      return res.render('portal/reset-password', {
        title: 'Reset Password',
        token: req.params.token,
        success: [],
        error: ['Invalid or expired reset link.']
      });
    }

    // Validate password
    if (!password || password.length < 6) {
      return res.render('portal/reset-password', {
        title: 'Reset Password',
        token: req.params.token,
        success: [],
        error: ['Password must be at least 6 characters.']
      });
    }

    if (password !== confirmPassword) {
      return res.render('portal/reset-password', {
        title: 'Reset Password',
        token: req.params.token,
        success: [],
        error: ['Passwords do not match.']
      });
    }

    // Update password
    employee.portalPassword = password;
    employee.resetPasswordToken = undefined;
    employee.resetPasswordExpires = undefined;
    await employee.save();

    // ✅ SUCCESS: Render login page directly with success message
    res.render('portal/login', {
      title: 'Employee Portal – Veldt Payroll',
      success: ['Password updated successfully! You can now log in with your new password.'],
      error: [],
      formData: {}
    });

  } catch (err) {
    console.error('Reset password error:', err);
    res.render('portal/reset-password', {
      title: 'Reset Password',
      token: req.params.token,
      success: [],
      error: ['An unexpected error occurred. Please try again.']
    });
  }
};

// ─────────────────────────────────────────────
// EMAIL BUILDERS
// ─────────────────────────────────────────────

function buildPortalVerificationEmail({ to, fullName, verificationUrl }) {
  const logoCoin = `<div class="header-logo-wrap">©</div>`;
  return {
    from: `"Veldt Payroll" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Verify your account – Veldt Payroll`,
    html: `<!DOCTYPE html><html><head><style>${emailStyles}</style></head><body>
      <div class="wrapper">
        <div class="header">
          ${logoCoin}
          <div><div class="header-brand">Veldt Payroll</div><div class="header-tagline">Employee Portal</div></div>
        </div>
        <div class="body">
          <h2 class="greeting">Welcome, ${fullName.split(' ')[0]} 👋</h2>
          <p>Your employee portal account is ready. Please verify your email to access your payslips and tax documents.</p>
          <div class="cta-wrap"><a href="${verificationUrl}" class="cta-btn">✅ &nbsp;Verify My Account</a></div>
          <hr class="divider" />
          <p>Link not working? Copy this:</p>
          <p class="url-fallback"><a href="${verificationUrl}">${verificationUrl}</a></p>
        </div>
        <div class="footer">
          <p>
            <a href="${baseUrl}/privacy">Privacy</a> • <a href="${baseUrl}/terms">Terms</a> • <a href="${baseUrl}/support">Support</a>
          </p>
          <p>© ${new Date().getFullYear()} Veldt Payroll. All rights reserved.</p>
        </div>
      </div>
    </body></html>`
  };
}

function buildPortalPasswordResetEmail({ to, fullName, resetUrl }) {
  const logoCoin = `<div class="header-logo-wrap">©</div>`;
  return {
    from: `"Veldt Payroll" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Reset your portal password`,
    html: `<!DOCTYPE html><html><head><style>${emailStyles}</style></head><body>
      <div class="wrapper">
        <div class="header">
          ${logoCoin}
          <div><div class="header-brand">Veldt Payroll</div><div class="header-tagline">Security</div></div>
        </div>
        <div class="body">
          <h2 class="greeting">Hi ${fullName.split(' ')[0]} 👋</h2>
          <p>Reset your portal password by clicking the button below.</p>
          <div class="cta-wrap"><a href="${resetUrl}" class="cta-btn">🔐 &nbsp;Reset Password</a></div>
          <hr class="divider" />
          <p class="url-fallback"><a href="${resetUrl}">${resetUrl}</a></p>
        </div>
        <div class="footer">
          <p>
            <a href="${baseUrl}/privacy">Privacy</a> • <a href="${baseUrl}/terms">Terms</a> • <a href="${baseUrl}/support">Support</a>
          </p>
          <p>© ${new Date().getFullYear()} Veldt Payroll. All rights reserved.</p>
        </div>
      </div>
    </body></html>`
  };
}

