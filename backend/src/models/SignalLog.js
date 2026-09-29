"use strict";
var mongoose = require("mongoose");

var SignalLogSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", index: true },
  key: { type: String, required: true, index: true },
  strategy_type: String,
  primary_name: String,
  basis_name: String,
  expiry: String,
  dte: Number,
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  sentAt: { type: Date, default: Date.now },
  telegramMessageId: { type: Number, default: null }
}, { timestamps: true });

// ایندکس TTL: خودکار بعد از 7 روز پاک می‌شود
SignalLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
SignalLogSchema.index({ ownerId: 1, sentAt: -1 });
SignalLogSchema.index({ ownerId: 1, key: 1, sentAt: -1 });

module.exports = mongoose.model("SignalLog", SignalLogSchema);