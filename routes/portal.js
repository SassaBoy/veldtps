/**
 * routes/portal.js – NamPayroll Employee Portal Routes
 */

const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const { requireEmployee, redirectIfEmployee } = require('../middleware/auth');
const portalController = require('../controllers/portalController');

// Redirect bare /portal to login
router.get('/', (req, res) => res.redirect('/portal/login'));

// ── Authentication ────────────────────────────────────────────────────────────
router.get('/login', redirectIfEmployee, portalController.getLogin);

router.post('/login', redirectIfEmployee, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
], portalController.postLogin);

// Email verification link (sent in welcome email)
router.get('/verify-email', portalController.getVerifyEmail);

router.get('/logout', portalController.logout);
router.post('/logout', portalController.logout);

// ── PASSWORD RESET ────────────────────────────────────────────────────────────
router.get('/forgot-password',  redirectIfEmployee, portalController.getForgotPassword);
router.post('/forgot-password', redirectIfEmployee, portalController.postForgotPassword);

router.get('/reset-password/:token',   portalController.getResetPassword);
router.post('/reset-password/:token',  portalController.postResetPassword);

// ── Protected employee routes ─────────────────────────────────────────────────
router.get('/dashboard', requireEmployee, portalController.getDashboard);

// Payslip PDF — employee downloads their own
router.get('/payslip/:runId/:payslipId/pdf', requireEmployee, portalController.downloadPayslipPDF);

// ITA5 / PAYE5 annual tax certificate for a given tax year
router.get('/paye5/:taxYear', requireEmployee, portalController.downloadPAYE5);
router.get('/resend-verification', portalController.resendVerification);

module.exports = router;