/**
 * controllers/settingsController.js – VeldtPayroll (UPDATED)
 */

const Settings = require('../models/Settings');

// ── GET /settings ─────────────────────────────────────────────────────────────
exports.getSettings = async (req, res) => {
  try {
    let settings = await Settings.findOne({ company: req.session.user._id });

    if (!settings) {
      settings = await Settings.create({ 
        company: req.session.user._id,
        hoursPerDay: 8
      });
    }

    res.render('settings/index', {
      title: 'Settings – VeldtPayroll',
      settings: settings.toObject()
    });
  } catch (err) {
    console.error('Get settings error:', err);
    req.flash('error', 'Could not load settings.');
    res.redirect('/dashboard');
  }
};

// ── POST /settings ────────────────────────────────────────────────────────────
exports.updateSettings = async (req, res) => {
  try {
    const {
      ecfRate, sscRate, sscMonthlyCap, sscMaxContribution,
      normalOvertimeMultiplier, publicHolidayOvertimeMultiplier,
      workingDaysInMonth, hoursPerDay,
      themeAccentColor, themeShowEmployerContributions,
      themeShowLeaveBalances, themeShowRefNumber, themeFooterNote,
      housingFreeRate, housingSubsidisedRate, vehicleMonthlyValue
    } = req.body;

    const updates = {};

    if (ecfRate !== undefined) updates.ecfRate = parseFloat(ecfRate) / 100;
    if (sscRate !== undefined) updates.sscRate = parseFloat(sscRate) / 100;
    if (sscMonthlyCap !== undefined) updates.sscMonthlyCap = parseFloat(sscMonthlyCap);
    if (sscMaxContribution !== undefined) updates.sscMaxContribution = parseFloat(sscMaxContribution);
    
    if (normalOvertimeMultiplier !== undefined) 
      updates.normalOvertimeMultiplier = parseFloat(normalOvertimeMultiplier);
    if (publicHolidayOvertimeMultiplier !== undefined) 
      updates.publicHolidayOvertimeMultiplier = parseFloat(publicHolidayOvertimeMultiplier);
    
    if (workingDaysInMonth !== undefined) 
      updates.workingDaysInMonth = parseInt(workingDaysInMonth, 10);

    if (hoursPerDay !== undefined) {
      let hpd = parseFloat(hoursPerDay);
      if (isNaN(hpd) || hpd < 1) hpd = 8;
      if (hpd > 24) hpd = 24;
      updates.hoursPerDay = hpd;
    }

    // Payslip Theme
    const hexOk = /^#[0-9a-fA-F]{6}$/.test(themeAccentColor || '');
    updates['payslipTheme.accentColor'] = hexOk ? themeAccentColor : '#000000';
    updates['payslipTheme.showEmployerContributions'] = themeShowEmployerContributions === 'on';
    updates['payslipTheme.showLeaveBalances'] = themeShowLeaveBalances === 'on';
    updates['payslipTheme.showRefNumber'] = themeShowRefNumber === 'on';
    updates['payslipTheme.footerNote'] = (themeFooterNote || '').trim().slice(0, 300);

    // Fringe Benefits
    updates['fringeBenefits.housing.freeRate'] = housingFreeRate !== undefined 
      ? parseFloat(housingFreeRate) / 100 
      : 0.10;
    updates['fringeBenefits.housing.subsidisedRate'] = housingSubsidisedRate !== undefined 
      ? parseFloat(housingSubsidisedRate) / 100 
      : 0.05;
    updates['fringeBenefits.vehicle.monthlyDeterminedValue'] = parseFloat(vehicleMonthlyValue) || 1500;

    await Settings.findOneAndUpdate(
      { company: req.session.user._id },
      { $set: updates },
      { upsert: true, new: true }
    );

    req.flash('success', 'Settings updated successfully.');
    res.redirect('/settings');

  } catch (err) {
    console.error('Update settings error:', err);
    req.flash('error', 'Could not save settings.');
    res.redirect('/settings');
  }
};

// ── POST /settings/custom-items ───────────────────────────────────────────────
exports.addCustomPayItem = async (req, res) => {
  try {
    const { name, type, inputMode, defaultAmount, description, category = 'normal' } = req.body;

    if (!name || !type) {
      req.flash('error', 'Item name and type are required.');
      return res.redirect('/settings#custom-items');
    }

    const normalizedName = name.trim().toLowerCase();

    // Prevent duplicate/redundant fields with built-in NamRA logic
    const reservedKeywords = ['pension', 'medical aid', 'medicalaid', 'housing', 'vehicle', 'car benefit', 'company vehicle', 'fringe benefit'];

    if (reservedKeywords.some(keyword => normalizedName.includes(keyword))) {
      req.flash('error', `"${name}" cannot be added as a custom item because it is already handled automatically through the Employee profile (Pension, Medical Aid, Housing & Vehicle fields).`);
      return res.redirect('/settings#custom-items');
    }

    const settings = await Settings.findOne({ company: req.session.user._id });
    if (!settings) return res.redirect('/settings#custom-items');

settings.customPayItems.push({
  name: name.trim(),
  type,
  category,                    // ← Add this line
  inputMode: inputMode || 'variable',
  defaultAmount: Math.max(0, parseFloat(defaultAmount) || 0),
  description: (description || '').trim(),
  isActive: true
});

    await settings.save();

    req.flash('success', `"${name.trim()}" added — it will appear as a column on your next payroll run.`);
    res.redirect('/settings#custom-items');

  } catch (err) {
    console.error('Add custom item error:', err);
    req.flash('error', 'Could not add item.');
    res.redirect('/settings#custom-items');
  }
};

// ── POST /settings/custom-items/:itemId/delete ────────────────────────────────
exports.deleteCustomPayItem = async (req, res) => {
  try {
    const settings = await Settings.findOne({ company: req.session.user._id });
    if (!settings) return res.redirect('/settings#custom-items');

    const item = settings.customPayItems.id(req.params.itemId);
    if (item) item.isActive = false;

    await settings.save();

    req.flash('success', 'Item removed from future payroll runs.');
    res.redirect('/settings#custom-items');

  } catch (err) {
    console.error('Delete custom item error:', err);
    req.flash('error', 'Could not remove item.');
    res.redirect('/settings#custom-items');
  }
};

// ── POST /settings/custom-items/:itemId/toggle ────────────────────────────────
exports.toggleCustomPayItem = async (req, res) => {
  try {
    const settings = await Settings.findOne({ company: req.session.user._id });
    if (!settings) return res.redirect('/settings#custom-items');

    const item = settings.customPayItems.id(req.params.itemId);
    if (item) item.isActive = !item.isActive;

    await settings.save();
    res.redirect('/settings#custom-items');

  } catch (err) {
    console.error('Toggle custom item error:', err);
    res.redirect('/settings#custom-items');
  }
};