const { validationResult } = require('express-validator');
const Employee = require('../models/Employee');

// GET /employees
exports.getEmployees = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const search = req.query.search || '';
    const query = { company: companyId, isActive: true };

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { position: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const employees = await Employee.find(query).sort({ fullName: 1 }).lean();

    res.render('employees/index', {
      title: 'Employees – NamPayroll',
      employees,
      search
    });
  } catch (err) {
    console.error('Get employees error:', err);
    req.flash('error', 'Could not load employees.');
    res.redirect('/dashboard');
  }
};

// GET /employees/new
exports.getNewEmployee = (req, res) => {
  res.render('employees/new', {
    title: 'Add Employee – NamPayroll',
    errors: [],
    formData: {}
  });
};

// POST /employees
exports.createEmployee = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('employees/new', {
      title: 'Add Employee – NamPayroll',
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const companyId = req.session.user._id;
    const {
      fullName, idNumber, phone, email, position, department,
      basicSalary, dateJoined, annualLeaveBalance, sickLeaveBalance,
      portalPassword
    } = req.body;

    // Check email uniqueness per company
    const existing = await Employee.findOne({ company: companyId, email });
    if (existing) {
      return res.render('employees/new', {
        title: 'Add Employee – NamPayroll',
        errors: [{ msg: 'An employee with that email already exists in your company.' }],
        formData: req.body
      });
    }

    const employeeData = {
      company: companyId,
      fullName: fullName.trim(),
      idNumber: idNumber.trim(),
      phone: phone?.trim() || '',
      email,
      position: position?.trim() || '',
      department: department?.trim() || '',
      basicSalary: parseFloat(basicSalary),
      dateJoined: new Date(dateJoined),
      annualLeaveBalance: annualLeaveBalance ? parseInt(annualLeaveBalance) : 24,
      sickLeaveBalance: sickLeaveBalance ? parseInt(sickLeaveBalance) : 30
    };

    // Set portal password if provided
    if (portalPassword && portalPassword.length >= 6) {
      employeeData.portalPassword = portalPassword;
      employeeData.portalEnabled = true;
    }

    await Employee.create(employeeData);
    req.flash('success', `${fullName} has been added successfully.`);
    res.redirect('/employees');
  } catch (err) {
    console.error('Create employee error:', err);
    res.render('employees/new', {
      title: 'Add Employee – NamPayroll',
      errors: [{ msg: 'Failed to create employee. Please try again.' }],
      formData: req.body
    });
  }
};

// GET /employees/:id/edit
exports.getEditEmployee = async (req, res) => {
  try {
    const employee = await Employee.findOne({
      _id: req.params.id,
      company: req.session.user._id
    }).lean();

    if (!employee) {
      req.flash('error', 'Employee not found.');
      return res.redirect('/employees');
    }

    res.render('employees/edit', {
      title: 'Edit Employee – NamPayroll',
      employee,
      errors: [],
      formData: employee
    });
  } catch (err) {
    console.error('Get edit employee error:', err);
    req.flash('error', 'Could not load employee.');
    res.redirect('/employees');
  }
};

// PUT /employees/:id
exports.updateEmployee = async (req, res) => {
  const errors = validationResult(req);
  const employee = await Employee.findOne({ _id: req.params.id, company: req.session.user._id });

  if (!employee) {
    req.flash('error', 'Employee not found.');
    return res.redirect('/employees');
  }

  if (!errors.isEmpty()) {
    return res.render('employees/edit', {
      title: 'Edit Employee – NamPayroll',
      employee: employee.toObject(),
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const {
      fullName, idNumber, phone, email, position, department,
      basicSalary, dateJoined, annualLeaveBalance, sickLeaveBalance,
      portalPassword, portalEnabled
    } = req.body;

    employee.fullName = fullName.trim();
    employee.idNumber = idNumber.trim();
    employee.phone = phone?.trim() || '';
    employee.email = email;
    employee.position = position?.trim() || '';
    employee.department = department?.trim() || '';
    employee.basicSalary = parseFloat(basicSalary);
    employee.dateJoined = new Date(dateJoined);
    employee.annualLeaveBalance = parseInt(annualLeaveBalance) || 24;
    employee.sickLeaveBalance = parseInt(sickLeaveBalance) || 30;
    employee.portalEnabled = portalEnabled === 'on';

    // Only update password if a new one is provided
    if (portalPassword && portalPassword.length >= 6) {
      employee.portalPassword = portalPassword;
    }

    await employee.save();
    req.flash('success', `${fullName} has been updated.`);
    res.redirect('/employees');
  } catch (err) {
    console.error('Update employee error:', err);
    res.render('employees/edit', {
      title: 'Edit Employee – NamPayroll',
      employee: employee.toObject(),
      errors: [{ msg: 'Failed to update employee.' }],
      formData: req.body
    });
  }
};

// DELETE /employees/:id
exports.deleteEmployee = async (req, res) => {
  try {
    const employee = await Employee.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!employee) {
      req.flash('error', 'Employee not found.');
      return res.redirect('/employees');
    }
    // Soft delete
    employee.isActive = false;
    await employee.save();
    req.flash('success', `${employee.fullName} has been removed.`);
    res.redirect('/employees');
  } catch (err) {
    console.error('Delete employee error:', err);
    req.flash('error', 'Could not remove employee.');
    res.redirect('/employees');
  }
};
