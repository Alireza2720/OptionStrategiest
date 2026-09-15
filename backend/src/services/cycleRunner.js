"use strict";
var Settings = require("../models/Settings");
var BasisOverride = require("../models/BasisOverride");
var CacheSnapshot = require("../models/CacheSnapshot");
var HuntState = require("../models/HuntState");
var DebugTick = require("../models/DebugTick");
var { loadContracts } = require("./dataSource");
var { computeAll, buildSteps, stripInternal } = require("./calcEngine");
var { buildHuntRows, huntRowKey, BUYABLE_CHECK_TYPES } = require("./huntEngine");
var { getFreshRows, markNotified, getNotificationByKey } = require("./notifyGate");
var { sendLongMessage, editTelegramMessage } = require("./telegram");
var { formatRow } = require("./messageFormat");
var { isMarketOpen } = require("./marketHours");

var HUNT_CACHE_CAP = 300;
var FAILURE_ALERT_THRESHOLD = 3;

var HUNT_STATE_CAP = 2000;

function strategyExitEnabled(type, settings) {
  var src = (settings.huntStrategies && settings.huntStrategies[type]) || {};
  return src.telegramExitEnabled !== false;
}

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

function saveDebugTick(settings) {
  if (!settings || !settings.debugCollectEnabled) return Promise.resolve();
  try {
    var basisSnapshot = [];
    var seenBasis = {};
    cache.watch.forEach(function (c) {
      if (!c.basis_name || seenBasis[c.basis_name]) return;
      seenBasis[c.basis_name] = true;
      basisSnapshot.push({
        n: c.basis_name,
        lp: c.basis_last_percent,
        cp: c.basis_close_percent,
        b: c.basis_buyable
      });
    });

    var huntRowsSummary = cache.huntLatest.rows.map(function (r) {
      return {
        t: r.strategy_type,
        n: r.primary_name,
        b: r.basis_name,
        dte: r.dte,
        roi: r.roi_zero,
        rp: r.required_profit,
        bb: r.basis_buyable
      };
    });

    var stratCounts = {};
    Object.keys(cache.strategies).forEach(function (k) {
      stratCounts[k] = (cache.strategies[k] || []).length;
    });

    return DebugTick.create({
      at: new Date(),
      basisSnapshot: basisSnapshot,
      huntRowsSummary: huntRowsSummary,
      counts: {
        watch: cache.watch.length,
        hunt: cache.huntLatest.rows.length,
        strategies: stratCounts
      },
      lastError: cache.lastError
    });
  } catch (e) {
    return Promise.reject(e);
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

    // نقشه‌ی سهم پایه → {درصد آخرین، درصد پایانی}
    var basisPctMap = {};
    allWithOverrides.forEach(function (c) {
      if (!c.basis_name) return;
      if (!basisPctMap[c.basis_name]) {
        basisPctMap[c.basis_name] = {
          last: c.basis_last_percent,
          close: c.basis_close_percent
        };
      }
    });

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

    // ---------- شناسایی ورود/خروج از شکار ----------
    var prevState = await HuntState.findOne({ ownerId: "default" }).lean();
    var prevRows = (prevState && prevState.rows) || [];
    var prevKeyMap = {};
    prevRows.forEach(function (r) { prevKeyMap[huntRowKey(r)] = true; });
    var currKeyMap = {};
    huntRows.forEach(function (r) { currKeyMap[huntRowKey(r)] = true; });

    var enteredKeySet = {};
    huntRows.forEach(function (r) {
      var k = huntRowKey(r);
      if (!prevKeyMap[k]) enteredKeySet[k] = true;
    });

    var exitedRows = prevRows.filter(function (r) {
      if (currKeyMap[huntRowKey(r)]) return false;
      if ((r.dte || 0) <= 1) return false; // قراردادهای منقضی‌شده را نادیده بگیر
      return true;
    });

    // ذخیره‌ی وضعیت جدید (مستقل از notify؛ تا در ری‌استارت‌ها هم درست کار کنه)
    try {
      await HuntState.findOneAndUpdate(
        { ownerId: "default" },
        { rows: huntRows.slice(0, HUNT_STATE_CAP), updatedAt: new Date() },
        { upsert: true }
      );
    } catch (e) {
      console.error("[cycle] خطا در ذخیره‌ی HuntState:", e.message);
    }

    // موفقیت این چرخه => ریست شمارنده‌ی خطاهای پی‌درپی
    consecutiveFailures = 0;
    failureAlertSent = false;

    // ذخیره‌ی نسخه‌ی پشتیبان کش در دیتابیس
    await saveSnapshot();

    // ذخیره‌ی داده‌های دیباگ (اگر فعال باشد)
    saveDebugTick(settings).catch(function (e) {
      console.error("[cycle] خطا در ذخیره دیباگ:", e.message);
    });

    // ---------- اعلان‌های تلگرام ----------
    if (notify && !isMarketOpen(new Date(), settings.manualHolidays)) {
      console.log("[cycle] خارج از ساعات بازار یا تعطیلی دستی است؛ اعلان تلگرام ارسال نشد.");
    } else if (notify) {
      var token = process.env.TELEGRAM_BOT_TOKEN;
      var chatId = process.env.TELEGRAM_CHAT_ID;

      if (token && chatId) {
        var cooldownMs = settings.huntCooldownForever ? Infinity : (settings.huntCooldownMinutes || 720) * 60 * 1000;

        // برای اعلان ورود: استراتژی‌های دارای «اعلان خروج» → edge-triggered (فقط لحظهٔ ورود، بدون cooldown)
        // استراتژی‌های بدون آن → رفتار قبلی (cooldown-based)
        var forNotify = settings.huntOnlyBuyable
          ? huntRows.filter(function (r) { return !BUYABLE_CHECK_TYPES[r.strategy_type] || r.basis_buyable !== false; })
          : huntRows.slice();
        forNotify = forNotify.filter(function (r) { return r.telegram_enabled !== false; });

        var edgeEntryRows = [];
        var cooldownEntryRows = [];
        forNotify.forEach(function (r) {
          if (strategyExitEnabled(r.strategy_type, settings)) {
            if (enteredKeySet[huntRowKey(r)]) edgeEntryRows.push(r);
          } else {
            cooldownEntryRows.push(r);
          }
        });

        var topEdge = settings.huntTopNUnlimited ? edgeEntryRows : edgeEntryRows.slice(0, settings.huntTopN || 30);
        var topCooldown = settings.huntTopNUnlimited ? cooldownEntryRows : cooldownEntryRows.slice(0, settings.huntTopN || 30);
        var freshCooldown = await getFreshRows(topCooldown, cooldownMs, "default", huntRowKey);
        var entryToSend = topEdge.concat(freshCooldown);

        var exitToSend = exitedRows.filter(function (r) {
          return strategyExitEnabled(r.strategy_type, settings);
        });

        // --- ارسال پیام ورود: یک پیام مستقل برای هر موقعیت ---
        if (entryToSend.length > 0) {
          var sentRows = [];
          var messageIds = {};
          for (var i = 0; i < entryToSend.length; i++) {
            var row = entryToSend[i];
            var key = huntRowKey(row);
          try {
            var bp = basisPctMap[row.basis_name] || {};
            var enrichedRow = Object.assign({}, row, {
              basis_last_percent: bp.last != null ? bp.last : null,
              basis_close_percent: bp.close != null ? bp.close : null
            });
            var text = formatRow(enrichedRow, steps);
            var result = await sendLongMessage(token, chatId, text);
              var mid = result && result.result && result.result.message_id;
              if (mid != null) messageIds[key] = mid;
              sentRows.push(row);
            } catch (e) {
              console.error("[cycle] خطا در ارسال تلگرام برای " + key + ": " + e.message);
            }
          }
          if (sentRows.length > 0) {
            await markNotified(sentRows, "default", huntRowKey, messageIds);
            console.log("[cycle] " + sentRows.length + " موقعیت جدید اطلاع‌رسانی شد.");
          }
        }

        // --- ویرایش پیام خروج: همون پیام ورود با استرایک‌ثرو ---
        if (exitToSend.length > 0) {
          var editedCount = 0;
          for (var j = 0; j < exitToSend.length; j++) {
            var er = exitToSend[j];
            var ekey = huntRowKey(er);
            try {
              var existing = await getNotificationByKey(ekey, "default");
              if (existing && existing.messageId) {
                var ebp = basisPctMap[er.basis_name] || {};
                var enrichedEr = Object.assign({}, er, {
                  basis_last_percent: ebp.last != null ? ebp.last : null,
                  basis_close_percent: ebp.close != null ? ebp.close : null
                });
                var elapsedSec = null;
                if (existing.lastNotifiedAt) {
                  elapsedSec = Math.floor((Date.now() - new Date(existing.lastNotifiedAt).getTime()) / 1000);
                }
                var exitText = formatRow(enrichedEr, steps, { isExit: true, elapsedSec: elapsedSec });
                await editTelegramMessage(token, chatId, existing.messageId, exitText);
                editedCount++;
              }
            } catch (e) {
              console.error("[cycle] خطا در ویرایش تلگرام برای " + ekey + ": " + e.message);
            }
          }
          if (editedCount > 0) {
            console.log("[cycle] " + editedCount + " خروج از شکار اطلاع‌رسانی شد.");
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