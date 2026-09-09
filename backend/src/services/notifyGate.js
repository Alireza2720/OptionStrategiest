"use strict";
var Notification = require("../models/Notification");

// فقط بررسی می‌کند کدام ردیف‌ها "تازه" هستند؛ چیزی در دیتابیس ثبت نمی‌کند
async function getFreshRows(rows, cooldownMs, ownerId, huntRowKeyFn) {
  if (!rows || rows.length === 0) return [];
  var now = new Date();
  var keys = rows.map(huntRowKeyFn);

  var existingDocs = await Notification.find({ ownerId: ownerId, key: { $in: keys } }).lean();
  var lastMap = {};
  existingDocs.forEach(function (d) { lastMap[d.key] = d.lastNotifiedAt; });

  var fresh = [];
  rows.forEach(function (row, i) {
    var key = keys[i];
    var last = lastMap[key];
    var isFresh = !last || (now - last) > cooldownMs;
    if (isFresh) fresh.push(row);
  });
  return fresh;
}

// فقط بعد از ارسال موفق پیام تلگرام باید صدا زده شود
async function markNotified(rows, ownerId, huntRowKeyFn) {
  if (!rows || rows.length === 0) return;
  var now = new Date();
  var ops = rows.map(function (row) {
    var key = huntRowKeyFn(row);
    return {
      updateOne: {
        filter: { ownerId: ownerId, key: key },
        update: { $set: { lastNotifiedAt: now } },
        upsert: true
      }
    };
  });
  await Notification.bulkWrite(ops);
}

module.exports = { getFreshRows: getFreshRows, markNotified: markNotified };