/**
 * VeldtPayroll - Namibian Payroll SaaS
 * Main application server
 */
require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const MongoStore   = require('connect-mongo');
const flash        = require('connect-flash');
const methodOverride = require('method-override');
const path         = require('path');
const connectDB    = require('./config/db');
const moment       = require('moment-timezone');
const cron         = require('node-cron');
const axios        = require('axios');

const { attachSubscription } = require('./middleware/subscriptionMiddleware');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database ──────────────────────────────────────────────────────────────────
connectDB();

// ── View Engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Core Middleware ───────────────────────────────────────────────────────────
// ✅ FIXED: Increased parameterLimit (for many form fields) and limit (for large payloads)
app.use(express.urlencoded({ 
  extended: true,
  parameterLimit: 100000,  // Supports large payroll forms with many employees
  limit: '100mb'           // Supports file uploads and bulk data
}));
app.use(express.json({ 
  limit: '100mb'           // JSON payload size limit
}));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_in_production',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    touchAfter: 60 * 60 // ✅ 1 hour (in seconds)
  }),
  cookie: {
    maxAge: 1000 * 60 * 60, // ✅ 1 hour (in milliseconds)
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

// ── Flash ─────────────────────────────────────────────────────────────────────
app.use(flash());

// ── Global Template Variables ─────────────────────────────────────────────────
// Runs on every request — makes user, flash messages, moment, and subscription
// available in every EJS template without needing to pass them manually.
app.use((req, res, next) => {
  res.locals.user       = req.session.user     || null;
  res.locals.employee   = req.session.employee || null;
  res.locals.success    = req.flash('success');
  res.locals.error      = req.flash('error');
  res.locals.formData   = req.body || {};
  res.locals.moment     = moment; // used in payroll views for date formatting
  res.locals.sessionMaxAge = req.session?.cookie?.maxAge || 0;
  next();
});

// ── Subscription Attachment ───────────────────────────────────────────────────
// Attaches req.subscription and res.locals.subscription to every authenticated
// request so all views can read plan/trial status for banners, nav badges, etc.
// This never blocks — it only reads. Blocking happens inside requireSubscription
// which is applied per-route in the payroll router.
app.use((req, res, next) => {
  if (req.session.user) return attachSubscription(req, res, next);
  next();
});

// ── Application Routes ────────────────────────────────────────────────────────
app.use('/',          require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/employees', require('./routes/employees'));
app.use('/payroll',   require('./routes/payroll'));
app.use('/portal',    require('./routes/portal'));
app.use('/settings',  require('./routes/settings'));

// ── Subscription Routes (/subscribe, /admin/subscriptions) ────────────────────
app.use('/', require('./routes/subscriptionRoutes'));

// ── Static Legal & Support Pages ─────────────────────────────────────────────
app.get('/terms',   (req, res) => res.render('terms',   { title: 'Terms of Service – VeldtPayroll' }));
app.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy Policy – VeldtPayroll' }));
app.get('/support', (req, res) => res.render('support', { title: 'Support – VeldtPayroll' }));

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', { title: '404 – Page Not Found' });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
// ✅ ENHANCED: Catches PayloadTooLargeError and other errors gracefully
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  
  // Handle specific error types
  if (err.type === 'entity.too.large') {
    return res.status(413).render('500', {
      title: 'Payload Too Large',
      error: { message: 'Request payload is too large. Please reduce the amount of data and try again.' }
    });
  }
  
  if (err.message && err.message.includes('too many parameters')) {
    return res.status(413).render('500', {
      title: 'Too Many Parameters',
      error: { message: 'Form submission contains too many fields. Please try with fewer items or split into multiple submissions.' }
    });
  }
  
  if (err.status === 413) {
    return res.status(413).render('500', {
      title: 'Payload Too Large',
      error: { message: 'The request is too large. Maximum allowed size is 100MB.' }
    });
  }
  
  // Default error handler
  res.status(err.status || 500).render('500', {
    title: 'Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// ── Start Server ──────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n✅ VeldtPayroll running at http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Max Form Parameters: 100,000`);
  console.log(`   Max Payload Size: 100MB\n`);
});

// ── Renewal Reminder Cron Job ─────────────────────────────────────────────────
// Runs every 6 hours to send subscription renewal reminder emails.
// Uses an internal HTTP call so the route's session/auth logic still applies.
// Requires: npm install node-cron axios
cron.schedule('0 */6 * * *', async () => {
  try {
    const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
    await axios.post(`${appUrl}/admin/send-reminders`, {}, {
      headers: { 'x-admin-key': process.env.ADMIN_CRON_KEY || '' }
    });
    console.log(`✓ [${new Date().toISOString()}] Renewal reminders sent`);
  } catch (err) {
    console.error(`✗ [${new Date().toISOString()}] Reminder cron failed:`, err.message);
  }
});

module.exports = app;