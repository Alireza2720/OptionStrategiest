"use strict";
var express = require("express");
var mongoose = require("mongoose");
var rateLimit = require("express-rate-limit");
var router = express.Router();
var Settings = require("../models/Settings");
var BasisOverride = require("../models/BasisOverride");
var DebugTick = require("../models/DebugTick");
var { runCycle, getCache, getHealth } = require("../services/cycleRunner");
var { isMarketOpen, todayKeyTehran, pruneOldHolidays } = require("../services/marketHours");

function requireApiKey(req, res, next) {
  var key = process.env.API_KEY;
  if (!key) return next(); // اگر تعریف نشده، محدودیتی اعمال نمی‌شود (فقط برای توسعه‌ی محلی)
  if (req.headers["x-api-key"] !== key) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

// محدودیت نرخ برای مسیرهای پرهزینه (فراخوانی دیتاسورس خارجی + احتمالاً تلگرام)
var heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "too many requests, please slow down" }
});

// ---------- سلامت سرویس (برای مانیتورینگ) ----------
router.get("/health", function (req, res) {
  var h = getHealth();
  res.json(Object.assign({}, h, { mongoConnected: mongoose.connection.readyState === 1 }));
});

// ---------- وضعیت کلی ----------
router.get("/status", function (req, res) {
  var c = getCache();
  res.json({
    ok: true,
    updatedAt: c.updatedAt,
    lastError: c.lastError,
    watchCount: c.watch.length,
    huntCount: c.huntLatest.rows.length,
    isSnapshot: !!c.isSnapshot
  });
});

// ---------- دیده‌بان ----------
router.get("/watch", function (req, res) {
  var c = getCache();
  res.json({ updatedAt: c.updatedAt, rows: c.watch });
});

// ---------- هر استراتژی ----------
var VALID_KINDS = ["cc", "mp", "co", "cv", "strangle", "strangleSell",
  "callspread", "callspreadbear", "putspread", "putspreadbull", "box"];

router.get("/strategy/:kind", function (req, res) {
  var kind = req.params.kind;
  if (VALID_KINDS.indexOf(kind) === -1) {
    return res.status(400).json({ ok: false, error: "invalid kind" });
  }
  var c = getCache();
  res.json({ updatedAt: c.updatedAt, steps: c.steps || [], rows: c.strategies[kind] || [] });
});

// ---------- شکار موقعیت ----------
router.get("/hunt/latest", function (req, res) {
  var c = getCache();
  res.json({ at: c.huntLatest.at, steps: c.steps || [], rows: c.huntLatest.rows });
});

// اجرای فوری چرخه (با اعلان تلگرام)
router.post("/hunt/run", heavyLimiter, requireApiKey, function (req, res) {
  runCycle({ notify: true }).then(function () {
    res.json({ ok: true });
  }).catch(function (err) {
    res.status(500).json({ ok: false, error: err.message });
  });
});

// اجرای فوری بدون ارسال تلگرام (برای اعمال آنی تنظیمات/Override از فرانت)
router.post("/refresh", heavyLimiter, requireApiKey, function (req, res) {
  runCycle({ notify: false }).then(function () {
    res.json({ ok: true });
  }).catch(function (err) {
    res.status(500).json({ ok: false, error: err.message });
  });
});

// ---------- تنظیمات ----------
router.get("/settings", async function (req, res) {
  var settings = await Settings.findOne({ ownerId: "default" });
  if (!settings) settings = await Settings.create({ ownerId: "default" });
  res.json(settings);
});

router.post("/settings", requireApiKey, async function (req, res) {
  var body = req.body || {};
  var allowed = ["scenStep", "dteFilterMin", "dteFilterMax", "checkIntervalSec",
    "huntOnlyBuyable", "huntTopN", "huntTopNUnlimited",
    "huntCooldownMinutes", "huntCooldownForever", "huntStrategies"];
  var update = {};
  allowed.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(body, k)) update[k] = body[k];
  });
  var settings = await Settings.findOneAndUpdate(
    { ownerId: "default" }, update, { new: true, upsert: true }
  );
  res.json(settings);
});

// ---------- قیمت دلخواه سهم پایه (Override) ----------
router.get("/overrides", async function (req, res) {
  var list = await BasisOverride.find({ ownerId: "default" });
  res.json(list);
});

router.post("/overrides", requireApiKey, async function (req, res) {
  var body = req.body || {};
  if (!body.name || !(body.price > 0)) {
    return res.status(400).json({ ok: false, error: "نام و قیمت معتبر لازم است" });
  }
  var doc = await BasisOverride.findOneAndUpdate(
    { ownerId: "default", name: body.name },
    { price: body.price, enabled: body.enabled !== false },
    { new: true, upsert: true }
  );
  res.json(doc);
});

router.delete("/overrides/:name", requireApiKey, async function (req, res) {
  await BasisOverride.deleteOne({ ownerId: "default", name: req.params.name });
  res.json({ ok: true });
});

// ---------- وضعیت بازار امروز (ساعت + تعطیلی دستی) ----------
router.get("/market/today", async function (req, res) {
  var settings = await Settings.findOne({ ownerId: "default" });
  var holidays = (settings && settings.manualHolidays) || [];
  var todayKey = todayKeyTehran();
  res.json({
    ok: true,
    todayKey: todayKey,
    isHoliday: holidays.indexOf(todayKey) !== -1,
    isMarketOpenNow: isMarketOpen(new Date(), holidays)
  });
});

router.post("/market/today/toggle-holiday", requireApiKey, async function (req, res) {
  var settings = await Settings.findOne({ ownerId: "default" });
  if (!settings) settings = await Settings.create({ ownerId: "default" });
  var todayKey = todayKeyTehran();
  var list = pruneOldHolidays(settings.manualHolidays || []);
  var idx = list.indexOf(todayKey);
  var willBeHoliday;
  if (idx === -1) { list.push(todayKey); willBeHoliday = true; }
  else { list.splice(idx, 1); willBeHoliday = false; }
  settings.manualHolidays = list;
  await settings.save();
  res.json({ ok: true, todayKey: todayKey, isHoliday: willBeHoliday, settings: settings });
});

// ---------- API خام هر قرارداد (برای مشاهده در Watch) ----------
router.get("/raw-contract/:name/:expiry", function (req, res) {
  var c = getCache();
  var target = c.watch.find(function (r) {
    return r.name === req.params.name && r.expiry === req.params.expiry;
  });
  if (!target) return res.status(404).json({ ok: false, error: "contract not found" });
  res.json({ ok: true, raw: target._raw || null, parsed: target });
});

// ---------- دیباگ: مشاهده و حذف tickها ----------
router.get("/debug/ticks", async function (req, res) {
  var from = req.query.from ? new Date(req.query.from) : null;
  var to = req.query.to ? new Date(req.query.to) : null;
  var limit = Math.min(parseInt(req.query.limit, 10) || 200, 2000);
  var q = {};
  if (from || to) {
    q.at = {};
    if (from) q.at.$gte = from;
    if (to) q.at.$lte = to;
  }
  var list = await DebugTick.find(q).sort({ at: -1 }).limit(limit).lean();
  var total = await DebugTick.countDocuments(q);
  res.json({ ok: true, total: total, returned: list.length, ticks: list });
});

router.delete("/debug/ticks", requireApiKey, async function (req, res) {
  var from = req.query.from ? new Date(req.query.from) : null;
  var to = req.query.to ? new Date(req.query.to) : null;
  var q = {};
  if (from || to) {
    q.at = {};
    if (from) q.at.$gte = from;
    if (to) q.at.$lte = to;
  }
  var result = await DebugTick.deleteMany(q);
  res.json({ ok: true, deleted: result.deletedCount });
});

module.exports = router;