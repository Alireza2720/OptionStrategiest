"use strict";
var mongoose = require("mongoose");

var NotificationSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", index: true },
  key: { type: String, required: true },
  lastNotifiedAt: { type: Date, default: Date.now },
  // اگر cooldown روی «همیشگی» تنظیم شده باشد این فیلد اصلاً ست نمی‌شود تا رکورد
  // هرگز پاک نشود (یعنی آن موقعیت دیگر هیچ‌وقت دوباره اعلان داده نمی‌شود).
  // در حالت عادی، فقط برای نظافت دیتابیس بعد از مدتی طولانی پاک می‌شود.
  expireAt: { type: Date }
});

NotificationSchema.index({ ownerId: 1, key: 1 }, { unique: true });
NotificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Notification", NotificationSchema);
