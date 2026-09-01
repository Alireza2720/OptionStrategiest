"use strict";
var mongoose = require("mongoose");

/*
  permanent=true یعنی این رکورد مربوط به حالت «فقط یک‌بار برای همیشه اطلاع بده» است
  (huntCooldownForever). چنین رکوردهایی از پاک‌سازی خودکار TTL مستثنا می‌شوند تا
  دیگر هرگز دوباره اطلاع داده نشود؛ رکوردهای عادی (cooldown ساعتی) طبق قبل بعد از
  ۱۴ روز به‌صورت خودکار پاک می‌شوند.
*/
var NotificationSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", index: true },
  key: { type: String, required: true },
  lastNotifiedAt: { type: Date, default: Date.now },
  permanent: { type: Boolean, default: false }
});

NotificationSchema.index({ ownerId: 1, key: 1 }, { unique: true });
NotificationSchema.index(
  { lastNotifiedAt: 1 },
  { expireAfterSeconds: 14 * 24 * 3600, partialFilterExpression: { permanent: { $ne: true } } }
);

module.exports = mongoose.model("Notification", NotificationSchema);
