/**
 * controllers/subscriptionController.js – VeldtPayroll
 */

const Subscription = require('../models/Subscription');
const User = require('../models/User');
const { PLANS, TRIAL_LIMIT } = require('../middleware/subscriptionMiddleware');
const moment = require('moment-timezone');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendMailWithTimeout } = require('../config/mailer');

// ── Shared Professional Email Styles ──────────────────────────────────────────
const emailStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=DM+Sans:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background-color: #06111c; font-family: 'DM Sans', Arial, sans-serif; color: rgba(255,255,255,0.82); -webkit-font-smoothing: antialiased; }
  .wrapper { max-width: 620px; margin: 40px auto; background: #0d1b2a; border: 1px solid rgba(255,255,255,0.07); border-radius: 18px; overflow: hidden; }
  .header { background: linear-gradient(135deg, #112235 0%, #0d1b2a 100%); border-bottom: 1px solid rgba(245,166,35,0.18); padding: 32px 40px 28px; }
  .header-logo-wrap { width: 46px; height: 46px; background: linear-gradient(135deg, #f5a623, #d4880a); border-radius: 12px; display: inline-block; text-align: center; line-height: 46px; margin-right: 14px; box-shadow: 0 4px 16px rgba(245,166,35,0.35); color: #fff; font-size: 24px; font-weight: bold; }
  .header-brand { font-family: 'Sora', sans-serif; font-size: 1.28rem; font-weight: 700; color: #fff; vertical-align: middle; }
  .header-highlight { color: #f5a623; }
  .body { padding: 36px 40px 32px; }
  .greeting { font-family: 'Sora', sans-serif; font-size: 1.3rem; font-weight: 700; color: #fff; margin-bottom: 12px; }
  .body p { font-size: 0.9rem; line-height: 1.7; color: rgba(255,255,255,0.6); margin-bottom: 14px; }
  .cta-btn { display: inline-block; background: #f5a623; color: #1a0e00 !important; font-family: 'Sora', sans-serif; font-size: 0.9rem; font-weight: 700; padding: 14px 32px; border-radius: 10px; text-decoration: none; margin-top: 20px; }
  .info-card { background: #112235; border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 16px 20px; margin: 20px 0; }
  .info-label { font-size: 0.75rem; color: rgba(255,255,255,0.35); text-transform: uppercase; width: 110px; display: inline-block; }
  .info-value { font-size: 0.875rem; color: rgba(255,255,255,0.82); font-weight: 500; }
  .expiry-badge { display: inline-block; background: rgba(245,166,35,0.08); border: 1px solid rgba(245,166,35,0.2); color: #f5a623; font-size: 0.75rem; font-weight: 600; padding: 5px 12px; border-radius: 20px; margin-bottom: 20px; }
  .footer { background: #071421; padding: 22px 40px; text-align: center; color: rgba(255,255,255,0.2); font-size: 0.75rem; }
`;

function buildBaseEmailHtml(content) {
  return `
    <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>${emailStyles}</style></head>
    <body>
      <div class="wrapper">
        <div class="header">
          <div class="header-logo-wrap">V</div>
          <div style="display:inline-block; vertical-align:middle;">
            <div class="header-brand"><span class="header-highlight">Veldt</span>Payroll</div>
          </div>
        </div>
        <div class="body">
          <h2 class="greeting">${content.greeting}</h2>
          ${content.badge ? `<div class="expiry-badge">${content.badge}</div>` : ''}
          <p>${content.message}</p>
          <div class="info-card">
            ${content.details.map(d => `<div style="padding:6px 0;"><span class="info-label">${d.label}</span><span class="info-value">${d.val}</span></div>`).join('')}
          </div>
          <div style="margin-top:28px;">
            <a href="${content.ctaUrl}" class="cta-btn">${content.ctaText}</a>
          </div>
        </div>
        <div class="footer">© ${new Date().getFullYear()} Veldt Payroll · Windhoek, Namibia</div>
      </div>
    </body></html>`;
}

// ── Proof of payment upload ───────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'payment-proofs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `proof-${req.session.user._id}-${Date.now()}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only JPG, PNG, or PDF files are accepted.'));
  }
});
exports.uploadProof = upload.single('proofFile');

// ── GET /subscribe ────────────────────────────────────────────────────────────
exports.getSubscribePage = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    let sub = await Subscription.findOne({ company: companyId });
    if (!sub) sub = await Subscription.create({ company: companyId });

    res.render('subscription/pricing', {
      title: 'Upgrade Your Plan – VeldtPayroll',
      subscription: sub,
      plans: PLANS,
      trialLimit: TRIAL_LIMIT,
      bankDetails: {
        bankName:      process.env.BANK_NAME      || 'Bank Windhoek Ltd.',
        accountName:   process.env.BANK_ACC_NAME   || 'Kefas Ugulu',
        accountNumber: process.env.BANK_ACC_NUM    || '8021194521',
        branchCode:    process.env.BANK_BRANCH     || '486-372',
        reference:     `NP-${String(companyId).slice(-6).toUpperCase()}`
      }
    });
  } catch (err) {
    console.error('Subscribe page error:', err);
    req.flash('error', 'Could not load subscription page.');
    res.redirect('/dashboard');
  }
};

// ── POST /subscribe/request ───────────────────────────────────────────────────
exports.postSubscribeRequest = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const { plan, reference } = req.body;

    if (!['monthly', 'annual'].includes(plan)) {
      req.flash('error', 'Invalid plan selected.');
      return res.redirect('/subscribe');
    }

    const proofUrl = req.file ? `/uploads/payment-proofs/${req.file.filename}` : null;
    const amount   = PLANS[plan].price;

    await Subscription.findOneAndUpdate(
      { company: companyId },
      {
        $set: {
          status: 'pending_payment',
          pendingRequest: {
            plan,
            amount,
            proofUrl,
            reference: reference?.trim() || '',
            submittedAt: new Date()
          }
        }
      },
      { upsert: true, new: true }
    );

    req.flash('success', `Your ${PLANS[plan].label} plan request has been submitted.`);
    res.redirect('/subscribe');
  } catch (err) {
    console.error('Subscribe request error:', err);
    req.flash('error', 'Failed to submit request.');
    res.redirect('/subscribe');
  }
};

// ── GET /admin/subscriptions ──────────────────────────────────────────────────
exports.getAdminSubscriptions = async (req, res) => {
  try {
    const pending = await Subscription.find({ status: 'pending_payment' }).populate('company').sort({ updatedAt: -1 }).lean();
    const all = await Subscription.find({}).populate('company').sort({ updatedAt: -1 }).lean();
    res.render('subscription/admin', {
      title: 'Subscription Management',
      pending,
      all,
      plans: PLANS,
      moment
    });
  } catch (err) {
    res.redirect('/dashboard');
  }
};

exports.approveSubscription = async (req, res) => {
  try {
    const sub = await Subscription.findById(req.params.id).populate('company');
    if (!sub || !sub.pendingRequest) {
      req.flash('error', 'No pending request found.');
      return res.redirect('/admin/subscriptions');
    }

    const { plan, amount, reference, proofUrl } = sub.pendingRequest;

    sub.payments.push({
      amount: amount || 0,
      method: 'Bank Transfer',
      reference: reference || 'N/A',
      proofUrl: proofUrl,
      status: 'verified',
      verifiedAt: new Date()
    });

    sub.startNewCycle(plan, amount);
    sub.pendingRequest = undefined;
    await sub.save();

    const emailHtml = buildBaseEmailHtml({
      greeting: "Plan Activated! 🚀",
      message: `Your ${plan.toUpperCase()} plan is now active. Thank you for choosing Veldt Payroll.`,
      details: [
        { label: "Plan Type", val: plan.toUpperCase() },
        { label: "Valid Until", val: moment(sub.currentPeriodEnd).format('DD MMMM YYYY') }
      ],
      ctaText: "Go to Dashboard",
      ctaUrl: `https://veldtps.onrender.com/dashboard`
    });

    sendMailWithTimeout({
      from: 'Veldt Payroll <onboarding@resend.dev>',
      to: sub.company.email,
      subject: `✓ ${plan.toUpperCase()} Plan Activated`,
      html: emailHtml
    });

    req.flash('success', `Plan approved. Valid until ${moment(sub.currentPeriodEnd).format('LL')}`);
    res.redirect('/admin/subscriptions');
  } catch (err) {
    console.error('Approval Error:', err);
    res.redirect('/admin/subscriptions');
  }
};

exports.sendRenewalReminders = async (req, res) => {
  try {
    const items = await Subscription.findSubscriptionsNeedingReminders();
    let sentCount = 0;

    for (const { sub, reminderType } of items) {
      if (!sub.company?.email) continue;

      const emailHtml = buildBaseEmailHtml({
        greeting: "Subscription Renewal",
        badge: "EXPIRING SOON",
        message: "Your Veldt Payroll subscription is ending in 3 days. Renew now to avoid any interruption in your payroll processing.",
        details: [
          { label: "Current Plan", val: sub.plan.toUpperCase() },
          { label: "Expiry Date", val: moment(sub.currentPeriodEnd).format('DD MMM YYYY') }
        ],
        ctaText: "Renew Subscription",
        ctaUrl: `https://veldtps.onrender.com/subscribe`
      });

      await sendMailWithTimeout({
        from: 'Veldt Payroll <onboarding@resend.dev>',
        to: sub.company.email,
        subject: "⚠️ Subscription Renewal Notice",
        html: emailHtml
      });

      sub.markReminderSent(reminderType);
      await sub.save({ validateBeforeSave: false });
      sentCount++;
    }

    res.json({ success: true, sent: sentCount });
  } catch (err) {
    console.error('Reminder logic error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── POST /admin/subscriptions/:id/reject ──────────────────────────────────────
exports.rejectSubscription = async (req, res) => {
  try {
    const { note } = req.body;
    const sub = await Subscription.findById(req.params.id).populate('company');
    if (!sub) return res.redirect('/admin/subscriptions');

    if (sub.pendingRequest) {
      sub.payments.push({
        amount: sub.pendingRequest.amount,
        status: 'rejected',
        note: note || 'Verification failed.',
        verifiedBy: req.session?.user?.email || 'admin'
      });
    }

    sub.status = 'expired';
    sub.pendingRequest = undefined;
    await sub.save({ validateBeforeSave: false });

    const emailHtml = buildBaseEmailHtml({
      greeting: "Verification Failed",
      message: `We could not verify your payment proof. Reason: ${note || 'Invalid document.'}`,
      details: [{ label: "Status", val: "Rejected" }],
      ctaText: "Try Again",
      ctaUrl: `https://veldtps.onrender.com/subscribe`
    });

    sendMailWithTimeout({
      from: 'Veldt Payroll <onboarding@resend.dev>',
      to: sub.company.email,
      subject: 'Payment Verification Failed',
      html: emailHtml
    });

    res.redirect('/admin/subscriptions');
  } catch (err) {
    res.redirect('/admin/subscriptions');
  }
};

module.exports = exports;