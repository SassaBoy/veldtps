const { validationResult } = require('express-validator');
const User = require('../models/User');
const Settings = require('../models/Settings');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Nodemailer transporter
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
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=DM+Sans:wght@400;500&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background-color: #06111c;
    font-family: 'DM Sans', Arial, sans-serif;
    color: rgba(255,255,255,0.82);
    -webkit-font-smoothing: antialiased;
  }

  .wrapper {
    max-width: 620px;
    margin: 40px auto;
    background: #0d1b2a;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 18px;
    overflow: hidden;
  }

  .header {
    background: linear-gradient(135deg, #112235 0%, #0d1b2a 100%);
    border-bottom: 1px solid rgba(245,166,35,0.18);
    padding: 32px 40px 28px;
    display: flex;
    align-items: center;
  }

  .header-logo-wrap {
    width: 46px;
    height: 46px;
    background: linear-gradient(135deg, #f5a623, #d4880a);
    border-radius: 12px;
    display: inline-block;
    text-align: center;
    line-height: 46px;
    margin-right: 14px;
    box-shadow: 0 4px 16px rgba(245,166,35,0.35);
  }

  /* Styling for the coin icon character to look like bi-coin */
  .header-logo-wrap .coin-icon {
    color: #fff;
    font-size: 24px;
    font-weight: bold;
    display: inline-block;
  }

  .header-brand { 
    font-family: 'Sora', Arial, sans-serif; 
    font-size: 1.28rem; 
    font-weight: 700; 
    color: #fff; 
    letter-spacing: -0.02em; 
    display: inline-block;
    vertical-align: middle;
  }
  .header-highlight { color: #f5a623; }

  .header-tagline { 
    font-size: 0.73rem; 
    color: rgba(255,255,255,0.38); 
    margin-top: 2px; 
    letter-spacing: 0.04em; 
    text-transform: uppercase; 
  }

  .body { padding: 36px 40px 32px; }
  .greeting { font-family: 'Sora', Arial, sans-serif; font-size: 1.3rem; font-weight: 700; color: #fff; margin-bottom: 12px; letter-spacing: -0.02em; }
  .body p { font-size: 0.9rem; line-height: 1.7; color: rgba(255,255,255,0.6); margin-bottom: 14px; }

  .cta-wrap { margin: 28px 0; }
  .cta-btn {
    display: inline-block;
    background: #f5a623;
    color: #1a0e00 !important;
    font-family: 'Sora', Arial, sans-serif;
    font-size: 0.9rem;
    font-weight: 700;
    padding: 14px 32px;
    border-radius: 10px;
    text-decoration: none;
    letter-spacing: 0.01em;
  }

  .info-card {
    background: #112235;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    padding: 16px 20px;
    margin: 20px 0;
  }
  .info-card-row { display: block; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .info-card-row:last-child { border-bottom: none; }
  .info-label { font-size: 0.75rem; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.04em; width: 120px; display: inline-block; }
  .info-value { font-size: 0.875rem; color: rgba(255,255,255,0.82); font-weight: 500; }

  .divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 24px 0; }

  .url-fallback { font-size: 0.75rem; color: rgba(255,255,255,0.25); word-break: break-all; }
  .url-fallback a { color: rgba(245,166,35,0.6); text-decoration: none; }

  .expiry-badge {
    display: inline-block;
    background: rgba(245,166,35,0.08);
    border: 1px solid rgba(245,166,35,0.2);
    color: #f5a623;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 20px;
    margin-bottom: 20px;
  }

  .footer {
    background: #071421;
    border-top: 1px solid rgba(255,255,255,0.06);
    padding: 22px 40px;
    text-align: center;
  }
  .footer p { font-size: 0.75rem; color: rgba(255,255,255,0.2); line-height: 1.6; }
  .footer a { color: rgba(245,166,35,0.5); text-decoration: none; }
  .footer .separator { display: inline-block; margin: 0 8px; color: rgba(255,255,255,0.1); }
`;

// ─────────────────────────────────────────────
// EMAIL BUILDER: Verification Email
// ─────────────────────────────────────────────
function buildVerificationEmail({ to, firstName, companyName, verifyUrl, baseUrl }) {
  return {
    from: `"Veldt Payroll" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Verify your Veldt Payroll account`,
    html: `
      <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
      <style>${emailStyles}</style></head>
      <body>
        <div class="wrapper">
          <div class="header">
            <div class="header-logo-wrap">
               <span class="coin-icon">©</span>
            </div>
            <div style="display:inline-block; vertical-align:middle;">
              <div class="header-brand"><span class="header-highlight">Veldt</span>Payroll</div>
              <div class="header-tagline">Namibian Payroll Platform</div>
            </div>
          </div>

          <div class="body">
            <h2 class="greeting">Welcome, ${firstName}! 👋</h2>
            <p>Your <strong style="color:#fff;">${companyName}</strong> account has been created. To get started, please verify your email address below.</p>
            
            <div class="cta-wrap">
              <a href="${verifyUrl}" class="cta-btn">
                <span style="margin-right:8px;">✔</span> Verify Email Address
              </a>
            </div>

            <div class="info-card">
              <div class="info-card-row"><span class="info-label">Company</span><span class="info-value">${companyName}</span></div>
              <div class="info-card-row"><span class="info-label">Email</span><span class="info-value">${to}</span></div>
            </div>

            <hr class="divider" />
            <p style="font-size:0.8rem; color:rgba(255,255,255,0.35);">Or copy this link into your browser:</p>
            <p class="url-fallback"><a href="${verifyUrl}">${verifyUrl}</a></p>
          </div>

          <div class="footer">
            <p>© ${new Date().getFullYear()} Veldt Payroll · All rights reserved</p>
            <p style="margin-top:6px;">
              <a href="${baseUrl}/privacy">Privacy Policy</a><span class="separator">·</span>
              <a href="${baseUrl}/terms">Terms of Service</a><span class="separator">·</span>
              <a href="${baseUrl}/support">Support</a>
            </p>
          </div>
        </div>
      </body></html>
    `
  };
}

// ─────────────────────────────────────────────
// EMAIL BUILDER: Password Reset Email
// ─────────────────────────────────────────────
function buildPasswordResetEmail({ to, resetUrl, baseUrl }) {
  return {
    from: `"Veldt Payroll Support" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Reset your Veldt Payroll password`,
    html: `
      <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
      <style>${emailStyles}</style></head>
      <body>
        <div class="wrapper">
          <div class="header">
            <div class="header-logo-wrap">
               <span class="coin-icon">©</span>
            </div>
            <div style="display:inline-block; vertical-align:middle;">
              <div class="header-brand"><span class="header-highlight">Veldt</span>Payroll</div>
              <div class="header-tagline">Veldt Payroll Platform</div>
            </div>
          </div>

          <div class="body">
            <h2 class="greeting">Password Reset Request</h2>
            <div class="expiry-badge">⏱ Expires in 1 hour</div>
            <p>We received a request to reset your password. Click the button below to proceed securely.</p>

            <div class="cta-wrap">
              <a href="${resetUrl}" class="cta-btn">
                <span style="margin-right:8px;">🔒</span> Reset My Password
              </a>
            </div>

            <hr class="divider" />
            <p class="url-fallback"><a href="${resetUrl}">${resetUrl}</a></p>
          </div>

          <div class="footer">
            <p>© ${new Date().getFullYear()} Veldt Payroll · All rights reserved</p>
            <p style="margin-top:6px;">
              <a href="${baseUrl}/privacy">Privacy Policy</a><span class="separator">·</span>
              <a href="${baseUrl}/terms">Terms of Service</a><span class="separator">·</span>
              <a href="${baseUrl}/support">Support</a>
            </p>
          </div>
        </div>
      </body></html>
    `
  };
}

// GET /register
exports.getRegister = (req, res) => {
  res.render('auth/register', {
    title: 'Register – VeldtPayroll',
    errors: [],
    formData: {}
  });
};

exports.postRegister = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/register', {
      title: 'Register – VeldtPayroll',
      errors: errors.array(),
      formData: req.body
    });
  }
 
  try {
    const {
      firstName, lastName, companyName, numEmployees, email, phone,
      physicalAddress, postalAddress, tinNumber, payeRegNo, sscNumber,
      bankName, bankAccountNumber, bankBranchCode, password
    } = req.body;
 
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    if (existing) {
      if (!existing.emailVerified) {
        const newToken = crypto.randomBytes(32).toString('hex');
        existing.verificationToken = newToken;
        await existing.save({ validateBeforeSave: false });
 
        const verifyUrl = `${baseUrl}/verify-email?token=${newToken}`;
        sendMailWithTimeout(buildVerificationEmail({
          to: existing.email,
          firstName: existing.ownerName.split(' ')[0],
          companyName: existing.companyName,
          verifyUrl,
          baseUrl
        }));
 
        req.flash('success', `Verification email resent to ${email}.`);
        return res.redirect('/login');
      }
      return res.render('auth/register', {
        title: 'Register – VeldtPayroll',
        errors: [{ msg: 'An account with that email already exists.' }],
        formData: req.body
      });
    }
 
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const user = await User.create({
      ownerName: `${firstName.trim()} ${lastName.trim()}`,
      companyName: companyName.trim(),
      numEmployees,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      physicalAddress: physicalAddress?.trim() || '',
      postalAddress: postalAddress?.trim() || '',
      tinNumber: tinNumber?.trim() || undefined,
      payeRegNo: payeRegNo?.trim() || undefined,
      sscNumber: sscNumber?.trim() || undefined,
      bankName: bankName?.trim() || '',
      bankAccountNumber: bankAccountNumber?.trim() || '',
      bankBranchCode: bankBranchCode?.trim() || '',
      password,
      companyLogo: req.file ? `/uploads/logos/${req.file.filename}` : null,
      verificationToken,
      emailVerified: false
    });
 
    await Settings.create({ company: user._id });
 
    const verifyUrl = `${baseUrl}/verify-email?token=${verificationToken}`;
    sendMailWithTimeout(buildVerificationEmail({ to: email, firstName, companyName, verifyUrl, baseUrl }));
 
    req.flash('success', `Account created! Check ${email} to verify.`);
    res.redirect('/login');
 
  } catch (err) {
    console.error('Register error:', err);
    res.render('auth/register', {
      title: 'Register – VeldtPayroll',
      errors: [{ msg: 'Registration failed.' }],
      formData: req.body
    });
  }
};

// GET /login
exports.getLogin = (req, res) => {
  res.render('auth/login', {
    title: 'Login – VeldtPayroll',
    errors: [],
    formData: {}
  });
};

// POST /login
exports.postLogin = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/login', {
      title: 'Login – VeldtPayroll',
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || !(await user.comparePassword(password))) {
      return res.render('auth/login', {
        title: 'Login – VeldtPayroll',
        errors: [{ msg: 'Invalid email or password.' }],
        formData: req.body
      });
    }

    if (!user.emailVerified) {
      return res.render('auth/login', {
        title: 'Login – VeldtPayroll',
        errors: [{ 
          msg: 'Please verify your email address.', 
          resendEmail: user.email 
        }],
        formData: req.body
      });
    }

    req.session.user = {
      _id: user._id,
      companyName: user.companyName,
      email: user.email,
      ownerName: user.ownerName
    };

    req.flash('success', `Welcome back, ${user.ownerName.split(' ')[0]}!`);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', {
      title: 'Login – VeldtPayroll',
      errors: [{ msg: 'Login failed.' }],
      formData: req.body
    });
  }
};

// GET /verify-email
exports.verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login');
  try {
    const user = await User.findOne({ verificationToken: token });
    if (!user) return res.redirect('/login');
    user.emailVerified = true;
    user.verificationToken = undefined;
    await user.save();
    req.flash('success', 'Email verified successfully!');
    res.redirect('/login');
  } catch (err) { res.redirect('/login'); }
};

// GET /resend-verification
exports.getResendVerification = async (req, res) => {
  const { email } = req.query;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  try {
    const user = await User.findOne({ email: decodeURIComponent(email).toLowerCase().trim() });
    if (!user || user.emailVerified) return res.redirect('/login');
    const newToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = newToken;
    await user.save({ validateBeforeSave: false });
    const verifyUrl = `${baseUrl}/verify-email?token=${newToken}`;
    sendMailWithTimeout(buildVerificationEmail({
      to: user.email,
      firstName: user.ownerName.split(' ')[0],
      companyName: user.companyName,
      verifyUrl,
      baseUrl
    }));
    req.flash('success', 'Verification email sent.');
    res.redirect('/login');
  } catch (err) { res.redirect('/login'); }
};

// POST /logout
exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
};

// GET /forgot-password
exports.getForgotPassword = (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot Password – VeldtPayroll' });
};

// POST /forgot-password
exports.postForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    if (!user) {
      req.flash('error', 'No account with that email exists.');
      return res.redirect('/forgot-password');
    }

    const token = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${baseUrl}/reset-password/${token}`;
    sendMailWithTimeout(buildPasswordResetEmail({ to: user.email, resetUrl, baseUrl }));

    req.flash('success', `Reset link sent to ${user.email}`);
    res.redirect('/forgot-password');
  } catch (err) {
    res.redirect('/forgot-password');
  }
};

// GET /reset-password/:token
exports.getResetPassword = async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() }
  });
  if (!user) return res.redirect('/forgot-password');
  res.render('auth/reset-password', { title: 'Reset Password', token: req.params.token });
};

// POST /reset-password/:token
exports.postResetPassword = async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) return res.redirect('/forgot-password');
    if (req.body.password !== req.body.confirmPassword) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect('back');
    }
    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });
    req.flash('success', 'Password changed successfully.');
    res.redirect('/login');
  } catch (err) { res.redirect('/forgot-password'); }
};