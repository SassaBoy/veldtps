/**
 * NamPayroll – main.js
 * Client-side utilities and enhancements
 */

// ─── Auto-dismiss flash alerts after 5 seconds ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const alerts = document.querySelectorAll('.alert.alert-success, .alert.alert-warning');
  alerts.forEach(alert => {
    setTimeout(() => {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
      if (bsAlert) bsAlert.close();
    }, 5000);
  });

  // ─── Payroll form: highlight overtime cells ────────────────────────────────
  document.querySelectorAll('.nm-payroll-input--ot').forEach(input => {
    input.addEventListener('input', function () {
      this.parentElement.classList.toggle('table-warning', parseFloat(this.value) > 0);
    });
  });

  // ─── Payroll form: warn if leave exceeds balance ───────────────────────────
  document.querySelectorAll('.nm-payroll-input[max]').forEach(input => {
    input.addEventListener('change', function () {
      const max = parseFloat(this.getAttribute('max'));
      const val = parseFloat(this.value);
      if (!isNaN(max) && val > max) {
        this.classList.add('is-invalid');
        let feedback = this.nextElementSibling;
        if (!feedback || !feedback.classList.contains('invalid-feedback')) {
          feedback = document.createElement('div');
          feedback.className = 'invalid-feedback';
          this.insertAdjacentElement('afterend', feedback);
        }
        feedback.textContent = `Exceeds balance of ${max} days`;
      } else {
        this.classList.remove('is-invalid');
        const feedback = this.nextElementSibling;
        if (feedback && feedback.classList.contains('invalid-feedback')) {
          feedback.textContent = '';
        }
      }
    });
  });

  // ─── Confirm dangerous actions ────────────────────────────────────────────
  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', function (e) {
      if (!confirm(this.dataset.confirm)) e.preventDefault();
    });
  });

  // ─── Number formatting: format salary displays ────────────────────────────
  document.querySelectorAll('[data-format-nad]').forEach(el => {
    const val = parseFloat(el.textContent);
    if (!isNaN(val)) {
      el.textContent = 'N$ ' + val.toLocaleString('en-NA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
  });
});
