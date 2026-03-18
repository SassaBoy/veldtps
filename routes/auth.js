const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { redirectIfAdmin } = require('../middleware/auth');

// Root redirect
router.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

// Register
router.get('/register', redirectIfAdmin, authController.getRegister);
router.post('/register', redirectIfAdmin, [
  body('companyName').trim().notEmpty().withMessage('Company name is required'),
  body('ownerName').trim().notEmpty().withMessage('Owner name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  })
], authController.postRegister);

// Login
router.get('/login', redirectIfAdmin, authController.getLogin);
router.post('/login', redirectIfAdmin, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password is required')
], authController.postLogin);

// Logout
router.post('/logout', authController.logout);

module.exports = router;
