"use strict";
var Notification = require("../models/Notification");

// فقط ردیف‌هایی را برمی‌گرداند که "جدید" هستند یا cooldown‌شان تمام شده
async function filterFreshRows(rows, cooldownHours, ownerId, huntRowKeyFn) {
  var now = new Date();
  var cooldownMs = cooldownHours * 3600 * 1000;
  var fresh = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var key = huntRowKeyFn(row);
    var existing = await Notification.findOne({ ownerId: ownerId, key: key });
    var isNew = !existing || (now - existing.lastNotifiedAt) > cooldownMs;
    if (isNew) {
      fresh.push(row);
      await Notification.findOneAndUpdate(
        { ownerId: ownerId, key: key },
        { lastNotifiedAt: now },
        { upsert: true }
      );
    }
  }
  return fresh;
}

module.exports = { filterFreshRows: filterFreshRows };