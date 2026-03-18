const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { requireEmployee, redirectIfEmployee } = require('../middleware/auth');
const portalController = require('../controllers/portalController');

router.get('/', (req, res) => res.redirect('/portal/login'));
router.get('/login', redirectIfEmployee, portalController.getLogin);
router.post('/login', redirectIfEmployee, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
], portalController.postLogin);

router.post('/logout', portalController.logout);
router.get('/dashboard', requireEmployee, portalController.getDashboard);
router.get('/payslip/:runId/:payslipId/pdf', requireEmployee, portalController.downloadPayslipPDF);

module.exports = router;
