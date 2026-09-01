"use strict";
var Settings = require("../models/Settings");
var BasisOverride = require("../models/BasisOverride");
var { loadContracts } = require("./dataSource");
var { computeAll, buildSteps, stripInternal } = require("./calcEngine");
var { buildHuntRows, huntRowKey } = require("./huntEngine");
var { filterFreshRows } = require("./notifyGate");
var { sendLongMessage } = require("./telegram");
var { formatBatch } = require("./messageFormat");

var HUNT_CACHE_CAP = 300;

var cache = {
  updatedAt: null,
  watch: [],
  strategies: {},
  steps: [],
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

function huntNotifyMapOf(settings) {
  var raw = settings.huntNotifyEnabled;
  if (!raw) return {};
  if (typeof raw.toObject === "function") return raw.toObject();
  return raw;
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
    var allWithOverrides = applyOverrides(data.all, overrides);

    var steps = buildSteps(settings.scenStep);
    var computed = computeAll(calls, puts, steps);

    cache.watch = allWithOverrides;

    var cleanStrategies = {};
    Object.keys(computed).forEach(function (k) {
      cleanStrategies[k] = computed[k].map(stripInternal);
    });
    cache.strategies = cleanStrategies;
    cache.steps = steps;
    cache.updatedAt = new Date();
    cache.lastError = null;

    // شکار موقعیت: لیست کامل (بدون فیلتر قابل‌خرید در صورت غیرفعال بودن آن) برای نمایش در فرانت
    var huntRows = buildHuntRows(computed, settings, steps);
    cache.huntLatest = { at: new Date(), rows: huntRows.slice(0, HUNT_CACHE_CAP) };

    if (notify) {
      var notifyMap = huntNotifyMapOf(settings);
      var forNotify = huntRows.filter(function (r) {
        if (settings.huntOnlyBuyable && r.basis_buyable === false) return false;
        if (notifyMap[r.strategy_type] === false) return false;
        return true;
      });
      var top = settings.huntTopNUnlimited ? forNotify : forNotify.slice(0, settings.huntTopN || 30);

      if (top.length > 0) {
        var fresh = await filterFreshRows(top, {
          cooldownForever: !!settings.huntCooldownForever,
          cooldownHours: settings.huntCooldownHours
        }, "default", huntRowKey);
        if (fresh.length > 0) {
          var token = process.env.TELEGRAM_BOT_TOKEN;
          var chatId = process.env.TELEGRAM_CHAT_ID;
          if (token && chatId) {
            try {
              await sendLongMessage(token, chatId, formatBatch(fresh, steps));
              console.log("[cycle] " + fresh.length + " موقعیت جدید اطلاع‌رسانی شد.");
            } catch (e) {
              console.error("[cycle] خطا در ارسال تلگرام:", e.message);
            }
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
