"use strict";
var Settings = require("../models/Settings");
var BasisOverride = require("../models/BasisOverride");
var { loadContracts } = require("./dataSource");
var { computeAll, buildSteps, stripInternal } = require("./calcEngine");
var { buildHuntRows, huntRowKey } = require("./huntEngine");
var { filterFreshRows } = require("./notifyGate");
var { sendLongMessage } = require("./telegram");
var { formatBatch } = require("./messageFormat");

var cache = {
  updatedAt: null,
  watch: [],
  strategies: {},
  huntLatest: { at: null, rows: [] },
  lastError: null,
  isRunning: false
};

function getCache() { return cache; }

function applyOverrides(contracts, overrides) {
  if (!overrides || overrides.length === 0) return contracts;
  var active = {};
  overrides.forEach(function (o) {
    if (o.enabled && o.price > 0) active[o.name] = o.price;
  });
  if (Object.keys(active).length === 0) return contracts;
  return contracts.map(function (c) {
    if (Object.prototype.hasOwnProperty.call(active, c.basis_name)) {
      return Object.assign({}, c, { spot: active[c.basis_name], spot_overridden: true, spot_original: c.spot });
    }
    return c;
  });
}

async function runCycle(opts) {
  opts = opts || {};
  var notify = opts.notify !== false;
  if (cache.isRunning) {
    console.log("[cycle] یک اجرا در حال انجام است، این درخواست نادیده گرفته شد.");
    return cache;
  }
  cache.isRunning = true;
  try {
    var settings = await Settings.findOne({ ownerId: "default" });
    if (!settings) settings = await Settings.create({ ownerId: "default" });

    var overrides = await BasisOverride.find({ ownerId: "default" });

    var data = await loadContracts();
    var calls = applyOverrides(data.calls, overrides);
    var puts = applyOverrides(data.puts, overrides);

    var steps = buildSteps(settings.scenStep);
    var computed = computeAll(calls, puts, steps);

    // دیده‌بان: تمام قراردادهای خام (call+put) برای نمایش فرانت
    cache.watch = data.all;

    // استراتژی‌ها: نسخه‌ی تمیزشده (بدون _payoff) برای API
    var cleanStrategies = {};
    Object.keys(computed).forEach(function (k) {
      cleanStrategies[k] = computed[k].map(stripInternal);
    });
    cache.strategies = cleanStrategies;
    cache.steps = steps;
    cache.updatedAt = new Date();
    cache.lastError = null;

    // شکار موقعیت
    var huntRows = buildHuntRows(computed, settings);
    var topN = settings.huntTopN || 30;
    var top = huntRows.slice(0, topN);
    cache.huntLatest = { at: new Date(), rows: top };

    if (notify && top.length > 0) {
      var fresh = await filterFreshRows(top, settings.huntCooldownHours, "default", huntRowKey);
      if (fresh.length > 0) {
        var token = process.env.TELEGRAM_BOT_TOKEN;
        var chatId = process.env.TELEGRAM_CHAT_ID;
        if (token && chatId) {
          try {
            await sendLongMessage(token, chatId, formatBatch(fresh));
            console.log("[cycle] " + fresh.length + " موقعیت جدید اطلاع‌رسانی شد.");
          } catch (e) {
            console.error("[cycle] خطا در ارسال تلگرام:", e.message);
          }
        }
      }
    }

    console.log("[cycle] اجرا کامل شد در " + cache.updatedAt.toLocaleString());
    return cache;
  } catch (err) {
    cache.lastError = err.message;
    console.error("[cycle] خطا:", err.message);
    throw err;
  } finally {
    cache.isRunning = false;
  }
}

module.exports = { runCycle: runCycle, getCache: getCache };