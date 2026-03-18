const Settings = require('../models/Settings');

// GET /settings
exports.getSettings = async (req, res) => {
  try {
    let settings = await Settings.findOne({ company: req.session.user._id });
    if (!settings) {
      settings = await Settings.create({ company: req.session.user._id });
    }

    res.render('settings/index', {
      title: 'Settings – NamPayroll',
      settings: settings.toObject()
    });
  } catch (err) {
    console.error('Get settings error:', err);
    req.flash('error', 'Could not load settings.');
    res.redirect('/dashboard');
  }
};

// POST /settings
exports.updateSettings = async (req, res) => {
  try {
    const {
      ecfRate, sscRate, sscMonthlyCap, sscMaxContribution,
      overtimeMultiplier, workingDaysPerMonth
    } = req.body;

    const updates = {};
    if (ecfRate !== undefined)           updates.ecfRate            = parseFloat(ecfRate) / 100;     // Input as % e.g. "4"
    if (sscRate !== undefined)           updates.sscRate            = parseFloat(sscRate) / 100;     // Input as % e.g. "0.9"
    if (sscMonthlyCap !== undefined)     updates.sscMonthlyCap      = parseFloat(sscMonthlyCap);
    if (sscMaxContribution !== undefined)updates.sscMaxContribution = parseFloat(sscMaxContribution);
    if (overtimeMultiplier !== undefined)updates.overtimeMultiplier  = parseFloat(overtimeMultiplier);
    if (workingDaysPerMonth !== undefined)updates.workingDaysPerMonth = parseInt(workingDaysPerMonth);

    await Settings.findOneAndUpdate(
      { company: req.session.user._id },
      { $set: updates },
      { upsert: true }
    );

    req.flash('success', 'Settings updated successfully.');
    res.redirect('/settings');
  } catch (err) {
    console.error('Update settings error:', err);
    req.flash('error', 'Could not save settings.');
    res.redirect('/settings');
  }
};
