"use strict";
var Settings = require("../models/Settings");
var BasisOverride = require("../models/BasisOverride");
var CacheSnapshot = require("../models/CacheSnapshot");
var { loadContracts } = require("./dataSource");
var { computeAll, buildSteps, stripInternal } = require("./calcEngine");
var { buildHuntRows, huntRowKey } = require("./huntEngine");
var { getFreshRows, markNotified } = require("./notifyGate");
var { sendLongMessage } = require("./telegram");
var { formatBatch } = require("./messageFormat");
var { isMarketOpen } = require("./marketHours");

var HUNT_CACHE_CAP = 300;
var FAILURE_ALERT_THRESHOLD = 3;

var cache = {
  updatedAt: null,
  watch: [],
  strategies: {},
  steps: [],
  huntLatest: { at: null, rows: [] },
  lastError: null,
  isRunning: false,
  isSnapshot: false
};

var consecutiveFailures = 0;
var failureAlertSent = false;

function getCache() { return cache; }

function getHealth() {
  return {
    ok: consecutiveFailures === 0,
    lastSuccessAt: cache.updatedAt,
    lastError: cache.lastError,
    consecutiveFailures: consecutiveFailures,
    isRunning: cache.isRunning,
    isSnapshot: !!cache.isSnapshot,
    watchCount: cache.watch.length,
    huntCount: cache.huntLatest.rows.length
  };
}

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

async function saveSnapshot() {
  try {
    await CacheSnapshot.findOneAndUpdate(
      { ownerId: "default" },
      {
        updatedAt: cache.updatedAt,
        watch: cache.watch,
        strategies: cache.strategies,
        steps: cache.steps,
        huntLatest: cache.huntLatest
      },
      { upsert: true }
    );
  } catch (e) {
    console.error("[cycle] خطا در ذخیره‌ی snapshot در دیتابیس:", e.message);
  }
}

async function restoreFromSnapshot() {
  try {
    var doc = await CacheSnapshot.findOne({ ownerId: "default" }).lean();
    if (doc) {
      cache.watch = doc.watch || [];
      cache.strategies = doc.strategies || {};
      cache.steps = doc.steps || [];
      cache.huntLatest = doc.huntLatest || { at: null, rows: [] };
      cache.updatedAt = doc.updatedAt || null;
      cache.isSnapshot = true;
      console.log("[cycle] کش از آخرین snapshot ذخیره‌شده در دیتابیس بازیابی شد (تاریخ: " +
        (cache.updatedAt ? new Date(cache.updatedAt).toLocaleString() : "-") + ").");
    }
  } catch (e) {
    console.error("[cycle] خطا در بازیابی snapshot:", e.message);
  }
}

async function sendFailureAlert(errMessage) {
  var token = process.env.TELEGRAM_BOT_TOKEN;
  var chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    var msg = "⚠️ سرویس آپشن‌هانتر در " + consecutiveFailures + " اجرای پی‌درپی با خطا مواجه شده است.\nآخرین خطا: " + errMessage;
    await sendLongMessage(token, chatId, msg);
  } catch (e) {
    console.error("[cycle] خطا در ارسال هشدار تلگرام:", e.message);
  }
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
    cache.isSnapshot = false;

    // شکار موقعیت: لیست کامل (بدون فیلتر قابل‌خرید) برای نمایش در فرانت
    var huntRows = buildHuntRows(computed, settings, steps);
    cache.huntLatest = { at: new Date(), rows: huntRows.slice(0, HUNT_CACHE_CAP) };

    // موفقیت این چرخه => ریست شمارنده‌ی خطاهای پی‌درپی
    consecutiveFailures = 0;
    failureAlertSent = false;

    // ذخیره‌ی نسخه‌ی پشتیبان کش در دیتابیس (برای بازیابی سریع بعد از ری‌استارت سرویس)
    await saveSnapshot();

    if (notify && !isMarketOpen(new Date(), settings.manualHolidays)) {
      console.log("[cycle] خارج از ساعات بازار یا تعطیلی دستی است؛ اعلان تلگرام ارسال نشد.");
    } else if (notify) {
      var forNotify = settings.huntOnlyBuyable
        ? huntRows.filter(function (r) { return r.basis_buyable !== false; })
        : huntRows.slice();
      forNotify = forNotify.filter(function (r) { return r.telegram_enabled !== false; });

      var top = settings.huntTopNUnlimited ? forNotify : forNotify.slice(0, settings.huntTopN || 30);

      if (top.length > 0) {
        var cooldownMs = settings.huntCooldownForever ? Infinity : (settings.huntCooldownMinutes || 720) * 60 * 1000;
        var fresh = await getFreshRows(top, cooldownMs, "default", huntRowKey);
        if (fresh.length > 0) {
          var token = process.env.TELEGRAM_BOT_TOKEN;
          var chatId = process.env.TELEGRAM_CHAT_ID;
          if (token && chatId) {
            try {
              await sendLongMessage(token, chatId, formatBatch(fresh));
              // فقط بعد از ارسال موفق، به‌عنوان "اطلاع‌رسانی‌شده" ثبت می‌شود
              await markNotified(fresh, "default", huntRowKey);
              console.log("[cycle] " + fresh.length + " موقعیت جدید اطلاع‌رسانی شد.");
            } catch (e) {
              console.error("[cycle] خطا در ارسال تلگرام (ثبت نشد؛ در چرخه‌ی بعدی دوباره تلاش می‌شود):", e.message);
            }
          }
        }
      }
    }

    console.log("[cycle] اجرا کامل شد در " + cache.updatedAt.toLocaleString());
    return cache;
  } catch (err) {
    cache.lastError = err.message;
    consecutiveFailures++;
    console.error("[cycle] خطا (شکست پی‌درپی: " + consecutiveFailures + "):", err.message);
    if (consecutiveFailures >= FAILURE_ALERT_THRESHOLD && !failureAlertSent) {
      failureAlertSent = true;
      await sendFailureAlert(err.message);
    }
    throw err;
  } finally {
    cache.isRunning = false;
  }
}

module.exports = {
  runCycle: runCycle,
  getCache: getCache,
  getHealth: getHealth,
  restoreFromSnapshot: restoreFromSnapshot
};