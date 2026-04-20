const { validationResult } = require('express-validator');
const Employee = require('../models/Employee');
const crypto = require('crypto');
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const { sendMailWithTimeout } = require('../config/mailer');

// ─── Shared email styles ──────────────────────────────────────────────────────
const emailStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=DM+Sans:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background-color: #06111c; font-family: 'DM Sans', Arial, sans-serif; color: rgba(255,255,255,0.82); -webkit-font-smoothing: antialiased; }
  .wrapper { max-width: 620px; margin: 40px auto; background: #0d1b2a; border: 1px solid rgba(255,255,255,0.07); border-radius: 18px; overflow: hidden; }
  .header { background: linear-gradient(135deg, #112235 0%, #0d1b2a 100%); border-bottom: 1px solid rgba(245,166,35,0.18); padding: 32px 40px 28px; display: flex; align-items: center; }
  .header-logo-wrap { width: 46px; height: 46px; background: linear-gradient(135deg, #f5a623, #d4880a); border-radius: 12px; display: inline-block; text-align: center; line-height: 46px; margin-right: 14px; box-shadow: 0 4px 16px rgba(245,166,35,0.35); }
  .header-logo-wrap .coin-icon { color: #fff; font-size: 24px; font-weight: bold; display: inline-block; }
  .header-brand { font-family: 'Sora', Arial, sans-serif; font-size: 1.28rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; display: inline-block; vertical-align: middle; }
  .header-highlight { color: #f5a623; }
  .header-tagline { font-size: 0.73rem; color: rgba(255,255,255,0.38); margin-top: 2px; letter-spacing: 0.04em; text-transform: uppercase; }
  .body { padding: 36px 40px 32px; }
  .greeting { font-family: 'Sora', Arial, sans-serif; font-size: 1.3rem; font-weight: 700; color: #fff; margin-bottom: 12px; letter-spacing: -0.02em; }
  .body p { font-size: 0.9rem; line-height: 1.7; color: rgba(255,255,255,0.6); margin-bottom: 14px; }
  .cta-wrap { margin: 28px 0; }
  .cta-btn { display: inline-block; background: #f5a623; color: #1a0e00 !important; font-family: 'Sora', Arial, sans-serif; font-size: 0.9rem; font-weight: 700; padding: 14px 32px; border-radius: 10px; text-decoration: none; }
  .info-card { background: #112235; border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 16px 20px; margin: 20px 0; }
  .info-card-row { display: block; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .info-card-row:last-child { border-bottom: none; }
  .info-label { font-size: 0.75rem; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.04em; width: 120px; display: inline-block; }
  .info-value { font-size: 0.875rem; color: rgba(255,255,255,0.82); font-weight: 500; }
  .divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 24px 0; }
  .url-fallback { font-size: 0.75rem; color: rgba(255,255,255,0.25); word-break: break-all; }
  .url-fallback a { color: rgba(245,166,35,0.6); text-decoration: none; }
  .notice-badge { display: inline-block; background: rgba(245,166,35,0.08); border: 1px solid rgba(245,166,35,0.2); color: #f5a623; font-size: 0.75rem; font-weight: 600; padding: 5px 12px; border-radius: 20px; margin-bottom: 20px; }
  .footer { background: #071421; border-top: 1px solid rgba(255,255,255,0.06); padding: 22px 40px; text-align: center; }
  .footer p { font-size: 0.75rem; color: rgba(255,255,255,0.2); line-height: 1.6; }
  .footer a { color: rgba(245,166,35,0.5); text-decoration: none; }
  .separator { display: inline-block; margin: 0 8px; color: rgba(255,255,255,0.1); }
`;

function buildEmployeeWelcomeEmail({ to, fullName, companyName, email, verifyUrl, portalUrl, baseUrl }) {
  return {
    from: 'Veldt Payroll <onboarding@resend.dev>',
    to,
    subject: `You've been added to ${companyName} on Veldt Payroll`,
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <style>${emailStyles}</style></head><body>
    <div class="wrapper">
      <div class="header">
        <div class="header-logo-wrap"><span class="coin-icon">©</span></div>
        <div style="display:inline-block; vertical-align:middle;">
          <div class="header-brand"><span class="header-highlight">Veldt</span>Payroll</div>
          <div class="header-tagline">Employee Portal Invitation</div>
        </div>
      </div>
      <div class="body">
        <h2 class="greeting">Hello, ${fullName}! 👋</h2>
        <p><strong style="color:#fff;">${companyName}</strong> has created an employee portal account for you on Veldt Payroll.</p>
        <div class="notice-badge">📋 Action Required — Verify email to activate</div>
        <div class="info-card">
          <div class="info-card-row"><span class="info-label">Company</span><span class="info-value">${companyName}</span></div>
          <div class="info-card-row"><span class="info-label">Username</span><span class="info-value">${email}</span></div>
          <div class="info-card-row"><span class="info-label">Portal URL</span><span class="info-value"><a href="${portalUrl}" style="color:#f5a623;">${portalUrl}</a></span></div>
        </div>
        <p>Click below to verify your email and activate your account:</p>
        <div class="cta-wrap"><a href="${verifyUrl}" class="cta-btn">✓ Verify Email & Activate Account</a></div>
        <hr class="divider"/>
        <p class="url-fallback"><a href="${verifyUrl}">${verifyUrl}</a></p>
        <hr class="divider"/>
        <p style="font-size:0.8rem;color:rgba(255,255,255,0.3);">If you were not expecting this, you can safely ignore this email.</p>
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} Veldt Payroll · All rights reserved</p>
        <p style="margin-top:6px;">
          <a href="${baseUrl}/privacy">Privacy Policy</a><span class="separator">·</span>
          <a href="${baseUrl}/terms">Terms of Service</a><span class="separator">·</span>
          <a href="${baseUrl}/support">Support</a>
        </p>
      </div>
    </div></body></html>`
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalisePhone(raw) {
  if (!raw) return '';
  let p = raw.toString().trim().replace(/[\s\-()]/g, '');
  if (p.startsWith('+264')) return p;
  if (p.startsWith('264')) return '+' + p;
  if (p.startsWith('0')) return '+264' + p.slice(1);
  return '+264' + p;
}

function getFieldValue(row, possibleNames) {
  const keys = Object.keys(row);
  const normalisedKeys = {};
  keys.forEach(k => {
    const normalised = k.toLowerCase().trim().replace(/[\s_\-\.]/g, '');
    normalisedKeys[normalised] = k;
  });
  const normalisedPossibleNames = possibleNames.map(p => 
    p.toLowerCase().trim().replace(/[\s_\-\.]/g, '')
  );
  for (const normPossible of normalisedPossibleNames) {
    if (normalisedKeys[normPossible]) {
      const actualKey = normalisedKeys[normPossible];
      const value = row[actualKey];
      return (value === '' || value === undefined || value?.toString().toLowerCase() === 'none') 
        ? null 
        : value;
    }
  }
  return null;
}

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const str = dateStr.toString().trim();
  if (str.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(str);
  if (str.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
    const [day, month, year] = str.split('/').map(Number);
    return new Date(year, month - 1, day);
  }
  if (str.match(/^\d{2}\/\d{2}\/\d{4}/)) {
    const [month, day, year] = str.split('/').map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

// ─── GET /employees ───────────────────────────────────────────────────────────
exports.getEmployees = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const search = req.query.search || '';
    const query = { company: companyId, isActive: true };

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { position: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const employees = await Employee.find(query).sort({ fullName: 1 }).lean();
    res.render('employees/index', { title: 'Employees – Veldt Payroll', employees, search });
  } catch (err) {
    console.error('Get employees error:', err);
    req.flash('error', 'Could not load employees.');
    res.redirect('/dashboard');
  }
};

// ─── GET /employees/new ───────────────────────────────────────────────────────
exports.getNewEmployee = async (req, res) => {
  try {
    const employees = await Employee.find(
      { company: req.session.user._id, isActive: true },
      'idNumber'
    ).lean();

    res.render('employees/new', {
      title: 'Add Employee – Veldt Payroll',
      employees,
      errors: [],
      formData: {}
    });
  } catch (err) {
    console.error('Get new employee form error:', err);
    res.redirect('/employees');
  }
};

// ─── POST /employees ──────────────────────────────────────────────────────────
exports.createEmployee = async (req, res) => {
  const companyId = req.session.user._id;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const employees = await Employee.find({ company: companyId, isActive: true }, 'idNumber').lean();

  const valErrors = validationResult(req);
  if (!valErrors.isEmpty()) {
    return res.render('employees/new', {
      title: 'Add Employee – Veldt Payroll',
      employees,
      errors: valErrors.array(),
      formData: req.body
    });
  }

  try {
    const companyName = req.session.user.companyName || 'Veldt Payroll Client';

    const Subscription = require('../models/Subscription');
    const subscription = await Subscription.findOne({ company: companyId });
    if ((subscription?.plan ?? 'trial') === 'trial') {
      const count = await Employee.countDocuments({ company: companyId, isActive: true });
      if (count >= 3) {
        req.flash('error', 'Free trial is limited to 3 employees. Please upgrade to add more.');
        return res.redirect('/subscribe');
      }
    }

    const {
      fullName, idNumber, tinNumber, socialSecurityNumber,
      phone, email,
      position, department, basicSalary, dateJoined,
      annualLeaveBalance, sickLeaveBalance,
      pensionFundName, pensionFundRegNo, pensionContribution,
      providentFundName, providentFundRegNo, providentFundContribution,
      retirementFundName, retirementFundRegNo, retirementFundContribution,
      studyPolicyName, studyPolicyRegNo, studyPolicyContribution,
      medicalAidFundName, medicalAidMemberNo, medicalAidContribution,
      hasCompanyVehicle, housingType,
      bankName, bankAccountNumber, bankBranchCode, accountType,
      portalPassword
    } = req.body;

    const dupId = await Employee.findOne({ company: companyId, idNumber: idNumber.trim(), isActive: true });
    if (dupId) {
      return res.render('employees/new', {
        title: 'Add Employee – Veldt Payroll',
        employees,
        errors: [{ msg: 'An employee with this Namibian ID number already exists.' }],
        formData: req.body
      });
    }

    const dupEmail = await Employee.findOne({ company: companyId, email: email.toLowerCase().trim(), isActive: true });
    if (dupEmail) {
      return res.render('employees/new', {
        title: 'Add Employee – Veldt Payroll',
        employees,
        errors: [{ msg: 'An employee with that email already exists.' }],
        formData: req.body
      });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const employeeData = {
      company: companyId,
      fullName: fullName.trim(),
      idNumber: idNumber.trim(),
      tinNumber: tinNumber?.trim() || undefined,
      socialSecurityNumber: socialSecurityNumber?.trim() || undefined,
      phone: normalisePhone(phone),
      email: email.toLowerCase().trim(),
      position: position?.trim() || '',
      department: department?.trim() || '',
      basicSalary: parseFloat(basicSalary) || 0,
      dateJoined: new Date(dateJoined),
      annualLeaveBalance: parseInt(annualLeaveBalance) || 24,
      sickLeaveBalance: parseInt(sickLeaveBalance) || 30,
      pensionFundName: pensionFundName?.trim() || '',
      pensionFundRegNo: pensionFundRegNo?.trim() || '',
      pensionContribution: parseFloat(pensionContribution) || 0,
      providentFundName: providentFundName?.trim() || '',
      providentFundRegNo: providentFundRegNo?.trim() || '',
      providentFundContribution: parseFloat(providentFundContribution) || 0,
      retirementFundName: retirementFundName?.trim() || '',
      retirementFundRegNo: retirementFundRegNo?.trim() || '',
      retirementFundContribution: parseFloat(retirementFundContribution) || 0,
      studyPolicyName: studyPolicyName?.trim() || '',
      studyPolicyRegNo: studyPolicyRegNo?.trim() || '',
      studyPolicyContribution: parseFloat(studyPolicyContribution) || 0,
      medicalAidFundName: medicalAidFundName?.trim() || '',
      medicalAidMemberNo: medicalAidMemberNo?.trim() || '',
      medicalAidContribution: parseFloat(medicalAidContribution) || 0,
      hasCompanyVehicle: hasCompanyVehicle === 'on' || hasCompanyVehicle === true || hasCompanyVehicle === 'true',
      housingType: ['none', 'free', 'subsidised'].includes(housingType) ? housingType : 'none',
      bankName: bankName?.trim() || '',
      bankAccountNumber: bankAccountNumber?.trim() || '',
      bankBranchCode: bankBranchCode?.trim() || '',
      accountType: accountType?.trim() || '',
      verificationToken,
      emailVerified: false
    };

    const newEmployee = await Employee.create(employeeData);

    const verifyUrl = `${baseUrl}/portal/verify-email?token=${verificationToken}`;
    const portalUrl = `${baseUrl}/portal/login`;

    sendMailWithTimeout(buildEmployeeWelcomeEmail({
      to: newEmployee.email,
      fullName,
      companyName,
      email: newEmployee.email,
      verifyUrl,
      portalUrl,
      baseUrl
    }));

    req.flash('success', `${fullName} has been added successfully.`);
    res.redirect('/employees');

  } catch (err) {
    console.error('Create employee error:', err);
    res.render('employees/new', {
      title: 'Add Employee – Veldt Payroll',
      employees,
      errors: [{ msg: 'Failed to add employee.' }],
      formData: req.body
    });
  }
};

// ─── Import Employees (CSV & XLSX) ───────────────────────────────────────────
exports.importEmployees = async (req, res) => {
  if (!req.file) {
    req.flash('error', 'Please upload a CSV or Excel file.');
    return res.redirect('/employees');
  }

  const companyId = req.session.user._id;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const companyName = req.session.user.companyName || 'Veldt Payroll Client';
  const filePath = req.file.path;
  let results = [];

  try {
    if (req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')) {
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (data) => results.push(data))
          .on('end', resolve)
          .on('error', reject);
      });
    } else {
      const workbook = XLSX.readFile(filePath, { cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      results = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
    }

    let successCount = 0;
    let skipCount = 0;
    let errors = [];

    const Subscription = require('../models/Subscription');
    const subscription = await Subscription.findOne({ company: companyId });
    const plan = subscription?.plan ?? 'trial';

    let currentCount = await Employee.countDocuments({ company: companyId, isActive: true });

    for (const row of results) {
      try {
        if (plan === 'trial' && currentCount >= 3) { skipCount++; continue; }

        const rawEmail = getFieldValue(row, ['email', 'emailaddress', 'e-mail', 'email address']);
        const email = rawEmail?.toString().toLowerCase().trim();
        const rawId = getFieldValue(row, ['idnumber', 'id', 'identity number', 'namibianid', 'id number']);
        const idNumber = rawId?.toString().trim();

        if (!email || !idNumber) { skipCount++; continue; }

        const existing = await Employee.findOne({ 
          company: companyId, 
          $or: [{ email }, { idNumber }], 
          isActive: true 
        });
        if (existing) { skipCount++; continue; }

        const verificationToken = crypto.randomBytes(32).toString('hex');

        const employeeData = {
          company: companyId,
          fullName: (getFieldValue(row, ['fullname', 'full name', 'name', 'employeename', 'employee name']) || '').toString().trim(),
          idNumber,
          tinNumber: getFieldValue(row, ['tinnumber', 'tin', 'tax number', 'taxpayerid', 'taxid'])?.toString().trim() || undefined,
          socialSecurityNumber: getFieldValue(row, ['socialsecuritynumber', 'ssc', 'sscnumber', 'ssn', 'social security'])?.toString().trim() || undefined,
          phone: normalisePhone(getFieldValue(row, ['phone', 'phonenumber', 'mobile', 'cell', 'cellphone'])),
          email,
          position: (getFieldValue(row, ['position', 'jobtitle', 'job title', 'designation', 'title']) || '').toString().trim(),
          department: (getFieldValue(row, ['department', 'dept', 'division']) || '').toString().trim(),
          basicSalary: parseFloat(getFieldValue(row, ['basicsalary', 'basic salary', 'salary', 'monthlysalary', 'monthly salary'])) || 0,
          dateJoined: parseDate(getFieldValue(row, ['datejoined', 'date joined', 'joiningdate', 'hiring date', 'hiringdate', 'startdate', 'start date'])),
          annualLeaveBalance: parseInt(getFieldValue(row, ['annualleaveebalance', 'annualleavbalance', 'annual leave', 'annualleave', 'annual leave balance'])) || 24,
          sickLeaveBalance: parseInt(getFieldValue(row, ['sickleavbalance', 'sickleavebalance', 'sick leave', 'sickleave', 'sick leave balance'])) || 30,
          pensionFundName: (getFieldValue(row, ['pensionfundname', 'pension fund name', 'pension fund', 'pensionfund']) || '').toString().trim(),
          pensionFundRegNo: (getFieldValue(row, ['pensionfundregno', 'pension fund reg no', 'pension reg no', 'pension registration', 'pensionfundregistration']) || '').toString().trim(),
          pensionContribution: parseFloat(getFieldValue(row, ['pensioncontribution', 'pension contribution', 'pension amount', 'monthlypension', 'monthly pension', 'pension contrib', 'pension cont'])) || 0,
          providentFundName: (getFieldValue(row, ['providentfundname', 'provident fund name', 'provident fund', 'providentfund']) || '').toString().trim(),
          providentFundRegNo: (getFieldValue(row, ['providentfundregno', 'provident fund reg no', 'provident reg no', 'providentregistration']) || '').toString().trim(),
          providentFundContribution: parseFloat(getFieldValue(row, ['providentfundcontribution', 'provident contribution', 'provident amount', 'monthlyprovident', 'provident contrib', 'provident cont'])) || 0,
          retirementFundName: (getFieldValue(row, ['retirementfundname', 'retirement fund name', 'retirement fund', 'retirementfund', 'raname', 'ra fund']) || '').toString().trim(),
          retirementFundRegNo: (getFieldValue(row, ['retirementfundregno', 'retirement fund reg no', 'retirement reg no', 'retirementregistration']) || '').toString().trim(),
          retirementFundContribution: parseFloat(getFieldValue(row, ['retirementfundcontribution', 'retirement contribution', 'retirement amount', 'monthlyretirement', 'retirement contrib', 'retirement cont'])) || 0,
          studyPolicyName: (getFieldValue(row, ['studypolicyname', 'study policy name', 'study policy', 'studypolicy', 'burssaryscheme', 'bursary']) || '').toString().trim(),
          studyPolicyRegNo: (getFieldValue(row, ['studypolicyregno', 'study policy reg no', 'study reg no', 'studyregistration']) || '').toString().trim(),
          studyPolicyContribution: parseFloat(getFieldValue(row, ['studypolicycontribution', 'study contribution', 'study amount', 'studyamount', 'study contrib', 'study cont'])) || 0,
          medicalAidFundName: (getFieldValue(row, ['medicalaidfundname', 'medical aid fund name', 'medical aid fund', 'medicalaidfund', 'medical aid', 'medicalaid']) || '').toString().trim(),
          medicalAidMemberNo: (getFieldValue(row, ['medicalaidmemberno', 'medical aid member no', 'member no', 'membernumber', 'policyno', 'policy no']) || '').toString().trim(),
          medicalAidContribution: parseFloat(getFieldValue(row, ['medicalaidcontribution', 'medical aid contribution', 'medical amount', 'medicalamount', 'medical contrib', 'medical cont'])) || 0,
          hasCompanyVehicle: (() => {
            const val = getFieldValue(row, ['hascompanyvehicle', 'company vehicle', 'companyvehicle', 'vehicle', 'has vehicle']);
            if (!val) return false;
            return ['true', 'yes', 'y', '1', 'on'].includes(val.toString().toLowerCase().trim());
          })(),
          housingType: (() => {
            const val = getFieldValue(row, ['housingtype', 'housing type', 'housing']);
            if (!val) return 'none';
            const normalised = val.toString().toLowerCase().trim();
            return ['none', 'free', 'subsidised', 'subsidized'].includes(normalised) 
              ? (normalised === 'subsidized' ? 'subsidised' : normalised)
              : 'none';
          })(),
          bankName: (getFieldValue(row, ['bankname', 'bank name', 'bank']) || '').toString().trim(),
          bankAccountNumber: (getFieldValue(row, ['bankaccountnumber', 'account number', 'accountnumber', 'account no', 'accountno']) || '').toString().trim(),
          bankBranchCode: (getFieldValue(row, ['bankbranchcode', 'branch code', 'branchcode', 'branch']) || '').toString().trim(),
          accountType: (getFieldValue(row, ['accounttype', 'account type']) || '').toString().trim(),
          verificationToken,
          emailVerified: false,
          portalEnabled: false
        };

        const newEmployee = await Employee.create(employeeData);
        currentCount++;

        const verifyUrl = `${baseUrl}/portal/verify-email?token=${verificationToken}`;
        const portalUrl = `${baseUrl}/portal/login`;
        
        sendMailWithTimeout(buildEmployeeWelcomeEmail({
          to: newEmployee.email,
          fullName: newEmployee.fullName,
          companyName,
          email: newEmployee.email,
          verifyUrl,
          portalUrl,
          baseUrl
        }));

        successCount++;
      } catch (err) {
        console.error('Row import error:', err);
        errors.push(`Row error: ${err.message}`);
      }
    }

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    
    req.flash('success', `Import complete. ${successCount} added, ${skipCount} skipped.`);
    if (errors.length > 0) req.flash('error', `Some rows had issues: ${errors.slice(0, 3).join(', ')}`);
    res.redirect('/employees');

  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error('Import process error:', err);
    req.flash('error', 'Failed to process file. Ensure it matches the template format.');
    res.redirect('/employees');
  }
};

// ─── GET /employees/:id/edit ──────────────────────────────────────────────────
exports.getEditEmployee = async (req, res) => {
  try {
    const employee = await Employee.findOne({
      _id: req.params.id,
      company: req.session.user._id
    }).lean();

    if (!employee) {
      req.flash('error', 'Employee not found.');
      return res.redirect('/employees');
    }

    res.render('employees/edit', {
      title: 'Edit Employee – Veldt Payroll',
      employee,
      errors: [],
      formData: employee
    });
  } catch (err) {
    console.error('Get edit employee error:', err);
    req.flash('error', 'Could not load employee.');
    res.redirect('/employees');
  }
};

// ─── PUT /employees/:id ───────────────────────────────────────────────────────
exports.updateEmployee = async (req, res) => {
  const valErrors = validationResult(req);
  const employeeDoc = await Employee.findOne({
    _id: req.params.id,
    company: req.session.user._id
  });

  if (!employeeDoc) {
    req.flash('error', 'Employee not found.');
    return res.redirect('/employees');
  }

  if (!valErrors.isEmpty()) {
    return res.render('employees/edit', {
      title: 'Edit Employee – Veldt Payroll',
      employee: employeeDoc.toObject(),
      errors: valErrors.array(),
      formData: req.body
    });
  }

  try {
    const {
      fullName, idNumber, tinNumber, socialSecurityNumber,
      phone, email,
      position, department, basicSalary, dateJoined,
      annualLeaveBalance, sickLeaveBalance,
      pensionFundName, pensionFundRegNo, pensionContribution,
      providentFundName, providentFundRegNo, providentFundContribution,
      retirementFundName, retirementFundRegNo, retirementFundContribution,
      studyPolicyName, studyPolicyRegNo, studyPolicyContribution,
      medicalAidFundName, medicalAidMemberNo, medicalAidContribution,
      hasCompanyVehicle, housingType,
      bankName, bankAccountNumber, bankBranchCode, accountType,
      portalPassword, portalEnabled
    } = req.body;

    employeeDoc.fullName = fullName?.trim();
    employeeDoc.idNumber = idNumber?.trim();
    employeeDoc.tinNumber = tinNumber?.trim() || undefined;
    employeeDoc.socialSecurityNumber = socialSecurityNumber?.trim() || undefined;
    employeeDoc.email = email?.toLowerCase().trim();
    employeeDoc.phone = normalisePhone(phone);
    employeeDoc.position = position?.trim() || '';
    employeeDoc.department = department?.trim() || '';
    employeeDoc.basicSalary = parseFloat(basicSalary) || employeeDoc.basicSalary;
    if (dateJoined) employeeDoc.dateJoined = new Date(dateJoined);
    if (annualLeaveBalance !== undefined) employeeDoc.annualLeaveBalance = parseInt(annualLeaveBalance);
    if (sickLeaveBalance !== undefined) employeeDoc.sickLeaveBalance = parseInt(sickLeaveBalance);
    employeeDoc.pensionFundName = pensionFundName?.trim() || '';
    employeeDoc.pensionFundRegNo = pensionFundRegNo?.trim() || '';
    employeeDoc.pensionContribution = parseFloat(pensionContribution) || 0;
    employeeDoc.providentFundName = providentFundName?.trim() || '';
    employeeDoc.providentFundRegNo = providentFundRegNo?.trim() || '';
    employeeDoc.providentFundContribution = parseFloat(providentFundContribution) || 0;
    employeeDoc.retirementFundName = retirementFundName?.trim() || '';
    employeeDoc.retirementFundRegNo = retirementFundRegNo?.trim() || '';
    employeeDoc.retirementFundContribution = parseFloat(retirementFundContribution) || 0;
    employeeDoc.studyPolicyName = studyPolicyName?.trim() || '';
    employeeDoc.studyPolicyRegNo = studyPolicyRegNo?.trim() || '';
    employeeDoc.studyPolicyContribution = parseFloat(studyPolicyContribution) || 0;
    employeeDoc.medicalAidFundName = medicalAidFundName?.trim() || '';
    employeeDoc.medicalAidMemberNo = medicalAidMemberNo?.trim() || '';
    employeeDoc.medicalAidContribution = parseFloat(medicalAidContribution) || 0;
    employeeDoc.hasCompanyVehicle = hasCompanyVehicle === 'on' || hasCompanyVehicle === true || hasCompanyVehicle === 'true';
    employeeDoc.housingType = ['none', 'free', 'subsidised'].includes(housingType) ? housingType : employeeDoc.housingType || 'none';
    employeeDoc.bankName = bankName?.trim() || '';
    employeeDoc.bankAccountNumber = bankAccountNumber?.trim() || '';
    employeeDoc.bankBranchCode = bankBranchCode?.trim() || '';
    employeeDoc.accountType = accountType || '';
    employeeDoc.portalEnabled = portalEnabled === 'on' || portalEnabled === true;
    if (portalPassword && portalPassword.length >= 6) {
      employeeDoc.portalPassword = portalPassword;
    }

    await employeeDoc.save();

    req.flash('success', `${fullName || employeeDoc.fullName} has been updated successfully.`);
    res.redirect('/employees');

  } catch (err) {
    console.error('Update employee error:', err);
    if (err.code === 11000) {
      const field = err.keyPattern?.email ? 'email' : 'idNumber';
      req.flash('error', `This ${field === 'email' ? 'email' : 'Namibian ID'} is already used by another employee.`);
    } else {
      req.flash('error', 'Failed to update employee.');
    }
    res.render('employees/edit', {
      title: 'Edit Employee – Veldt Payroll',
      employee: employeeDoc.toObject(),
      errors: [{ msg: 'An error occurred while saving changes.' }],
      formData: req.body
    });
  }
};

// ─── DELETE /employees/:id ────────────────────────────────────────────────────
exports.deleteEmployee = async (req, res) => {
  try {
    const employee = await Employee.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!employee) return res.redirect('/employees');
    employee.isActive = false;
    await employee.save();
    req.flash('success', `${employee.fullName} has been removed.`);
    res.redirect('/employees');
  } catch (err) {
    console.error('Delete employee error:', err);
    res.redirect('/employees');
  }
};