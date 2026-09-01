"use strict";
var Notification = require("../models/Notification");

/*
  نسخه‌ی بهینه‌شده (بدون N+1 کوئری): به‌جای یک کوئری جدا برای هر ردیف، یک کوئری دسته‌ای
  با $in روی همه‌ی کلیدها می‌زنیم و در پایان با bulkWrite یک‌جا آپدیت می‌کنیم.

  opts.cooldownForever=true یعنی «فقط یک‌بار برای همیشه اطلاع بده»: اگر برای یک کلید قبلاً
  ولو فقط یک‌بار در گذشته اطلاع داده شده باشد، دیگر هیچ‌وقت دوباره اطلاع داده نمی‌شود
  (فارغ از گذشت زمان). رکوردهای مربوط به این حالت با permanent:true ذخیره می‌شوند تا از
  پاک‌سازی خودکار ۱۴روزه‌ی TTL مستثنا بمانند.
*/
async function filterFreshRows(rows, opts, ownerId, huntRowKeyFn) {
  opts = opts || {};
  var cooldownForever = !!opts.cooldownForever;
  var cooldownHours = opts.cooldownHours;
  var now = new Date();
  var cooldownMs = (parseFloat(cooldownHours) || 12) * 3600 * 1000;

  var keys = rows.map(huntRowKeyFn);
  var existingDocs = await Notification.find({ ownerId: ownerId, key: { $in: keys } }).lean();
  var existingMap = {};
  existingDocs.forEach(function (d) { existingMap[d.key] = d; });

  var fresh = [];
  var bulkOps = [];

  rows.forEach(function (row) {
    var key = huntRowKeyFn(row);
    var existing = existingMap[key];
    var isNew;
    if (!existing) isNew = true;
    else if (cooldownForever) isNew = false;
    else isNew = (now - new Date(existing.lastNotifiedAt)) > cooldownMs;

    if (isNew) {
      fresh.push(row);
      bulkOps.push({
        updateOne: {
          filter: { ownerId: ownerId, key: key },
          update: { $set: { lastNotifiedAt: now, permanent: cooldownForever } },
          upsert: true
        }
      });
    }
  });

  if (bulkOps.length > 0) await Notification.bulkWrite(bulkOps);
  return fresh;
}

module.exports = { filterFreshRows: filterFreshRows };
