const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const settingsController = require('../controllers/settingsController');

router.get('/', requireAdmin, settingsController.getSettings);
router.post('/', requireAdmin, settingsController.updateSettings);

module.exports = router;
