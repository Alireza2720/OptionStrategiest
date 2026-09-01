"use strict";
var Notification = require("../models/Notification");

// نگه‌داری حداکثر ۶۰ روزه برای رکوردهای غیردائمی (فقط برای نظافت دیتابیس؛
// منطق واقعی cooldown با مقایسه‌ی lastNotifiedAt در همین فایل انجام می‌شود)
var RETENTION_MS = 60 * 24 * 3600 * 1000;

/* فقط ردیف‌هایی را برمی‌گرداند که "جدید" هستند یا cooldown‌شان تمام شده.
   به‌جای N کوئری جداگانه (یکی برای هر ردیف)، این نسخه با یک کوئری $in همه‌ی
   رکوردهای موجود را یک‌جا می‌خواند و در پایان با یک bulkWrite آن‌ها را به‌روز می‌کند.
   opts: { cooldownMs, forever }
   forever=true یعنی هر موقعیت فقط یک‌بار در طول عمر برنامه اعلان داده می‌شود و
   دیگر هرگز تکرار نمی‌شود (حتی بعد از گذشت زمان زیاد). */
async function filterFreshRows(rows, opts, ownerId, huntRowKeyFn) {
  opts = opts || {};
  var forever = !!opts.forever;
  var cooldownMs = opts.cooldownMs || 0;
  var now = new Date();

  var keys = rows.map(huntRowKeyFn);
  var existingDocs = keys.length > 0
    ? await Notification.find({ ownerId: ownerId, key: { $in: keys } }).lean()
    : [];
  var existingMap = {};
  existingDocs.forEach(function (d) { existingMap[d.key] = d; });

  var fresh = [];
  var freshKeys = [];
  rows.forEach(function (row, i) {
    var key = keys[i];
    var existing = existingMap[key];
    var isFresh;
    if (!existing) isFresh = true;
    else if (forever) isFresh = false; // قبلاً یک‌بار اعلان شده و در حالت همیشگی دیگر تکرار نمی‌شود
    else isFresh = (now - existing.lastNotifiedAt) > cooldownMs;
    if (isFresh) { fresh.push(row); freshKeys.push(key); }
  });

  if (freshKeys.length > 0) {
    var ops = freshKeys.map(function (key) {
      var update = { $set: { lastNotifiedAt: now } };
      if (forever) update.$unset = { expireAt: 1 };
      else update.$set.expireAt = new Date(now.getTime() + RETENTION_MS);
      return { updateOne: { filter: { ownerId: ownerId, key: key }, update: update, upsert: true } };
    });
    await Notification.bulkWrite(ops);
  }
  return fresh;
}

module.exports = { filterFreshRows: filterFreshRows };
