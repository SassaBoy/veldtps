/**
 * config/mailer.js – VeldtPayroll
 * Resend API transport — works on Render free tier (HTTPS only, no SMTP)
 */

const { Resend } = require('resend');

if (!process.env.RESEND_API_KEY) {
  console.error('[mailer] WARNING: RESEND_API_KEY is not set. Emails will not send.');
}

const resend = new Resend(process.env.RESEND_API_KEY);

console.log('[mailer] ✅ Resend mailer initialised');

function sendMailWithTimeout(mailOptions, timeoutMs = 8000) {
  const from = mailOptions.from || process.env.EMAIL_FROM || 'Veldt Payroll <onboarding@resend.dev>';

  const sendPromise = resend.emails.send({
    from,
    to:      mailOptions.to,
    subject: mailOptions.subject,
    html:    mailOptions.html,
  });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Email timeout after ${timeoutMs}ms`)), timeoutMs)
  );

  return Promise.race([sendPromise, timeoutPromise])
    .then(({ data, error }) => {
      if (error) throw error;
      console.log(`[mailer] ✅ Sent: "${mailOptions.subject}" → ${mailOptions.to} (id: ${data?.id})`);
      return data;
    })
    .catch(err => {
      console.error(`[mailer] ❌ Failed: "${mailOptions.subject}" → ${mailOptions.to} — ${err.message}`);
    });
}

module.exports = { sendMailWithTimeout };