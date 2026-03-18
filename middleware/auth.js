/**
 * Authentication Middleware
 */

// ─── Require admin login ──────────────────────────────────────────────────────
exports.requireAdmin = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  req.flash('error', 'Please log in to access this page.');
  res.redirect('/login');
};

// ─── Require employee portal login ───────────────────────────────────────────
exports.requireEmployee = (req, res, next) => {
  if (req.session && req.session.employee) {
    return next();
  }
  req.flash('error', 'Please log in to access the employee portal.');
  res.redirect('/portal/login');
};

// ─── Redirect if already logged in (admin) ───────────────────────────────────
exports.redirectIfAdmin = (req, res, next) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  next();
};

// ─── Redirect if already logged in (employee) ────────────────────────────────
exports.redirectIfEmployee = (req, res, next) => {
  if (req.session && req.session.employee) {
    return res.redirect('/portal/dashboard');
  }
  next();
};
