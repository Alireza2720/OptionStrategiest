"use strict";
var Notification = require("../models/Notification");

// cooldownMs می‌تواند Infinity باشد (یعنی هر موقعیت فقط یک‌بار برای همیشه اطلاع داده شود)
async function filterFreshRows(rows, cooldownMs, ownerId, huntRowKeyFn) {
  if (!rows || rows.length === 0) return [];
  var now = new Date();
  var keys = rows.map(huntRowKeyFn);

  var existingDocs = await Notification.find({ ownerId: ownerId, key: { $in: keys } }).lean();
  var lastMap = {};
  existingDocs.forEach(function (d) { lastMap[d.key] = d.lastNotifiedAt; });

  var fresh = [];
  var upsertKeys = [];
  rows.forEach(function (row, i) {
    var key = keys[i];
    var last = lastMap[key];
    var isFresh = !last || (now - last) > cooldownMs;
    if (isFresh) {
      fresh.push(row);
      upsertKeys.push(key);
    }
  });

  if (upsertKeys.length > 0) {
    var ops = upsertKeys.map(function (key) {
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
  return fresh;
}

module.exports = { filterFreshRows: filterFreshRows };