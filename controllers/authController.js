const { validationResult } = require('express-validator');
const User = require('../models/User');
const Settings = require('../models/Settings');

// GET /register
exports.getRegister = (req, res) => {
  res.render('auth/register', { title: 'Register – NamPayroll', errors: [], formData: {} });
};

// POST /register
exports.postRegister = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/register', {
      title: 'Register – NamPayroll',
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const { companyName, ownerName, email, phone, password } = req.body;

    // Check if email already exists
    const existing = await User.findOne({ email });
    if (existing) {
      return res.render('auth/register', {
        title: 'Register – NamPayroll',
        errors: [{ msg: 'An account with that email already exists.' }],
        formData: req.body
      });
    }

    // Create user
    const user = await User.create({ companyName, ownerName, email, phone, password });

    // Create default settings for this company
    await Settings.create({ company: user._id });

    // Auto-login after registration
    req.session.user = { _id: user._id, companyName: user.companyName, email: user.email, ownerName: user.ownerName };
    req.flash('success', `Welcome to NamPayroll, ${companyName}! Your account is ready.`);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Register error:', err);
    res.render('auth/register', {
      title: 'Register – NamPayroll',
      errors: [{ msg: 'Registration failed. Please try again.' }],
      formData: req.body
    });
  }
};

// GET /login
exports.getLogin = (req, res) => {
  res.render('auth/login', { title: 'Login – NamPayroll', errors: [], formData: {} });
};

// POST /login
exports.postLogin = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/login', {
      title: 'Login – NamPayroll',
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await user.comparePassword(password))) {
      return res.render('auth/login', {
        title: 'Login – NamPayroll',
        errors: [{ msg: 'Invalid email or password.' }],
        formData: req.body
      });
    }

    req.session.user = { _id: user._id, companyName: user.companyName, email: user.email, ownerName: user.ownerName };
    req.flash('success', `Welcome back, ${user.ownerName}!`);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', {
      title: 'Login – NamPayroll',
      errors: [{ msg: 'Login failed. Please try again.' }],
      formData: req.body
    });
  }
};

// POST /logout
exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
};
