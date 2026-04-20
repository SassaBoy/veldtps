'use strict';
const mongoose = require('mongoose');
const moment = require('moment-timezone');

const subscriptionSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  plan: { type: String, enum: ['trial', 'monthly', 'annual'], default: 'trial' },
  status: { type: String, enum: ['active', 'expired', 'cancelled', 'pending_payment'], default: 'active' },
  currentPeriodStart: { type: Date },
  currentPeriodEnd: { type: Date },
  
  pendingRequest: {
    plan: String,
    amount: Number,
    proofUrl: String,
    reference: String,
    submittedAt: Date
  },

  cycleHistory: {
    type: [{
      cycleNumber: Number,
      startDate: Date,
      endDate: Date,
      status: { type: String, default: 'active' },
      remindersSent: { 
        threeDayNotice: { type: Boolean, default: false } // Renamed for production clarity
      }
    }],
    default: []
  },
  
  payments: {
    type: [{
      amount: Number,
      method: String,
      reference: String,
      proofUrl: String,
      status: String,
      verifiedAt: Date
    }],
    default: []
  }
}, { timestamps: true });

subscriptionSchema.methods.getCurrentCycle = function() {
  if (!this.cycleHistory || this.cycleHistory.length === 0) return null;
  return this.cycleHistory[this.cycleHistory.length - 1];
};

subscriptionSchema.methods.startNewCycle = function(plan, amount) {
  const now = new Date();
  let endDate;

  // PRODUCTION LOGIC: Monthly = 30 days, Annual = 365 days
  if (plan === 'annual') {
    endDate = moment(now).add(365, 'days').toDate();
  } else {
    endDate = moment(now).add(30, 'days').toDate();
  }

  this.cycleHistory.push({
    cycleNumber: (this.cycleHistory ? this.cycleHistory.length : 0) + 1,
    startDate: now,
    endDate: endDate,
    remindersSent: { threeDayNotice: false }
  });

  this.currentPeriodStart = now;
  this.currentPeriodEnd = endDate;
  this.plan = plan;
  this.status = 'active';
  return this;
};

subscriptionSchema.methods.getReminderStatus = function() {
  const cycle = this.getCurrentCycle();
  if (!cycle || this.status !== 'active' || cycle.remindersSent.threeDayNotice) return null;

  const diffInDays = moment(this.currentPeriodEnd).diff(moment(), 'days');
  
  // Send reminder when there are 3 days or fewer remaining
  if (diffInDays <= 3 && diffInDays >= 0) {
    return '3_day_warning';
  }
  return null;
};

subscriptionSchema.methods.markReminderSent = function(type) {
  const cycle = this.getCurrentCycle();
  if (cycle && type === '3_day_warning') {
    cycle.remindersSent.threeDayNotice = true;
    this.markModified('cycleHistory');
  }
};

subscriptionSchema.statics.findSubscriptionsNeedingReminders = async function() {
  const subs = await this.find({ status: 'active' }).populate('company');
  return subs
    .filter(s => s.getReminderStatus() === '3_day_warning')
    .map(s => ({ sub: s, reminderType: '3_day_warning' }));
};

module.exports = mongoose.model('Subscription', subscriptionSchema);