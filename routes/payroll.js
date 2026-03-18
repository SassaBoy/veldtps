const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const payrollController = require('../controllers/payrollController');

// Payroll history list
router.get('/', requireAdmin, payrollController.getPayrollHistory);

// Run payroll form (select month/year + enter employee data)
router.get('/run', requireAdmin, payrollController.getRunPayroll);

// Process / save payroll
router.post('/run', requireAdmin, payrollController.postRunPayroll);

// View a specific payroll run
router.get('/:id', requireAdmin, payrollController.getPayrollRun);

// Delete a payroll run
router.delete('/:id', requireAdmin, payrollController.deletePayrollRun);

// ─── Download routes ──────────────────────────────────────────────────────────

// Download single payslip PDF
router.get('/:id/payslip/:payslipId/pdf', requireAdmin, payrollController.downloadPayslipPDF);

// Download all payslips as ZIP
router.get('/:id/zip', requireAdmin, payrollController.downloadAllPayslipsZip);

// Download bank transfer CSV
router.get('/:id/bank-csv', requireAdmin, payrollController.downloadBankCSV);

// Download compliance CSV
router.get('/:id/compliance-csv', requireAdmin, payrollController.downloadComplianceCSV);

// Download compliance PDF
router.get('/:id/compliance-pdf', requireAdmin, payrollController.downloadCompliancePDF);

module.exports = router;
