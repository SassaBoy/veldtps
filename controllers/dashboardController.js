const Employee = require('../models/Employee');
const PayrollRun = require('../models/PayrollRun');
const moment = require('moment-timezone');

exports.getDashboard = async (req, res) => {
  try {
    // Use req.session.user._id to ensure we are filtering by the logged-in company
    const companyId = req.session.user._id;
    const now = moment().tz('Africa/Windhoek');
    const currentMonth = now.month() + 1; 
    const currentYear = now.year();

    // ─── THE FIX ──────────────────────────────────────────────────────────
    // We count all documents belonging to this company. 
    // If you use "Soft Deletes" (keeping the user but setting isActive to false), 
    // keep { isActive: true }. If you fully delete them from the DB, 
    // just use { company: companyId }.
    const employeeCount = await Employee.countDocuments({ 
      company: companyId,
      isActive: true // Ensure this matches the field name in your Employee Model
    });
    // ──────────────────────────────────────────────────────────────────────

    const currentPayroll = await PayrollRun.findOne({
      company: companyId,
      month: currentMonth,
      year: currentYear
    });

    const recentPayrolls = await PayrollRun.find({ company: companyId })
      .sort({ year: -1, month: -1 })
      .limit(6)
      .lean();

    res.render('dashboard/index', {
      title: 'Dashboard – NamPayroll',
      employeeCount, // This is now the live count
      currentMonth: now.format('MMMM YYYY'),
      currentPayroll,
      recentPayrolls,
      moment,
      user: req.session.user // Ensure user object is passed for the header/subtitle
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    req.flash('error', 'Could not load dashboard.');
    res.redirect('/login');
  }
};