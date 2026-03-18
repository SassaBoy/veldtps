const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const dashboardController = require('../controllers/dashboardController');

router.get('/', requireAdmin, dashboardController.getDashboard);

module.exports = router;
