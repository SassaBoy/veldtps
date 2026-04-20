/**
 * subscriptionRoutes.js – VeldtPayroll
 */

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/subscriptionController');
const { requireAdmin } = require('../middleware/auth');

// ── Super admin guard — only YOUR account can access /admin/subscriptions ─────
// Add ADMIN_EMAIL=youremail@gmail.com to your .env file
const requireSuperAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.email === process.env.ADMIN_EMAIL) {
    return next();
  }
  req.flash('error', 'Access denied.');
  return res.redirect('/dashboard');
};

// ── Company-facing (any logged-in company account) ────────────────────────────
router.get('/subscribe',          requireAdmin, ctrl.getSubscribePage);
router.post('/subscribe/request', requireAdmin, ctrl.uploadProof, ctrl.postSubscribeRequest);

// ── Admin-facing (your account only) ─────────────────────────────────────────
router.get('/admin/subscriptions',              requireAdmin, requireSuperAdmin, ctrl.getAdminSubscriptions);
router.post('/admin/subscriptions/:id/approve', requireAdmin, requireSuperAdmin, ctrl.approveSubscription);
router.post('/admin/subscriptions/:id/reject',  requireAdmin, requireSuperAdmin, ctrl.rejectSubscription);

// ── Cron job endpoint — send renewal reminder emails ──────────────────────────
// Called every 6 hours by the scheduler in app.js
router.post('/admin/send-reminders', requireAdmin, requireSuperAdmin, ctrl.sendRenewalReminders);

module.exports = router;