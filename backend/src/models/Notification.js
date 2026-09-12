"use strict";
var mongoose = require("mongoose");

var NotificationSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", index: true },
  key: { type: String, required: true },
  lastNotifiedAt: { type: Date, default: Date.now },
  messageId: { type: Number, default: null }
});

NotificationSchema.index({ ownerId: 1, key: 1 }, { unique: true });
// بعد از ۱۴ روز خودکار پاک می‌شود (نیازی به پاک‌سازی دستی نیست)
NotificationSchema.index({ lastNotifiedAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });

module.exports = mongoose.model("Notification", NotificationSchema);