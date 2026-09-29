"use strict";
var express = require("express");
var router = express.Router();
var FollowedSignal = require("../models/FollowedSignal");
var SignalLog = require("../models/SignalLog");
var signalTracker = require("../services/signalTracker");
var { getCache } = require("../services/cycleRunner");

function requireApiKey(req, res, next) {
  var key = process.env.API_KEY;
  if (!key) return next();
  if (req.headers["x-api-key"] !== key) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

// لیست سیگنال‌های ارسال‌شده در N روز اخیر
router.get("/signals/sent", async function (req, res) {
  try {
    var days = Math.min(parseInt(req.query.days, 10) || 7, 30);
    var since = new Date(Date.now() - days * 24 * 3600 * 1000);
    var list = await SignalLog.find({ ownerId: "default", sentAt: { $gte: since } })
      .sort({ sentAt: -1 })
      .limit(300)
      .lean();
    res.json({ ok: true, signals: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// لیست سیگنال‌های پیگیری‌شده
router.get("/signals/followed", async function (req, res) {
  try {
    var status = req.query.status || "active";
    var q = { ownerId: "default" };
    if (status !== "all") q.status = status;
    var list = await FollowedSignal.find(q).sort({ followedAt: -1, createdAt: -1 }).lean();
    res.json({ ok: true, followed: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// شروع پیگیری یک سیگنال
router.post("/signals/followed", requireApiKey, async function (req, res) {
  try {
    var body = req.body || {};
    if (!body.signalKey) {
      return res.status(400).json({ ok: false, error: "signalKey لازم است" });
    }
    if (!body.entries || typeof body.entries !== "object") {
      return res.status(400).json({ ok: false, error: "entries لازم است" });
    }

    // چک کنیم که از قبل فعال نباشد
    var existing = await FollowedSignal.findOne({
      ownerId: "default",
      signalKey: body.signalKey,
      status: "active"
    }).lean();
    if (existing) {
      return res.status(409).json({ ok: false, error: "این سیگنال از قبل در حال پیگیری است" });
    }

    var log = await SignalLog.findOne({ ownerId: "default", key: body.signalKey })
      .sort({ sentAt: -1 })
      .lean();
    if (!log) {
      return res.status(404).json({ ok: false, error: "سیگنال پیدا نشد" });
    }

    var targets = Array.isArray(body.targets) && body.targets.length > 0
      ? body.targets
      : [
          { kind: "profit", value: 20 },
          { kind: "profit", value: 50 },
          { kind: "loss", value: -20 }
        ];

    var doc = await FollowedSignal.create({
      ownerId: "default",
      signalKey: body.signalKey,
      snapshot: log.snapshot,
      entries: {
        stockEntry: body.entries.stockEntry != null ? body.entries.stockEntry : null,
        legEntries: Array.isArray(body.entries.legEntries) ? body.entries.legEntries : [],
        margin: body.entries.margin != null ? body.entries.margin : null
      },
      entryNote: body.entryNote || "",
      targets: targets,
      status: "active"
    });

    // محاسبه‌ی اولیه‌ی P&L
    try {
      var cache = getCache();
      var r = signalTracker.computePnL(doc.snapshot, doc.entries, cache);
      if (!r.missing) {
        doc.currentPnL = r.pnl;
        doc.currentROI = r.roi;
        doc.base = r.base;
        doc.peakROI = r.roi;
        doc.troughROI = r.roi;
        doc.lastUpdated = new Date();
        await doc.save();
      }
    } catch (e) { /* ignore */ }

    res.json({ ok: true, followed: doc });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ویرایش پیگیری (قیمت‌های ورود، اهداف، یادداشت)
router.patch("/signals/followed/:id", requireApiKey, async function (req, res) {
  try {
    var body = req.body || {};
    var doc = await FollowedSignal.findOne({ _id: req.params.id, ownerId: "default" });
    if (!doc) return res.status(404).json({ ok: false, error: "not found" });

    if (body.entries && typeof body.entries === "object") {
      doc.entries = {
        stockEntry: body.entries.stockEntry != null ? body.entries.stockEntry : null,
        legEntries: Array.isArray(body.entries.legEntries) ? body.entries.legEntries : [],
        margin: body.entries.margin != null ? body.entries.margin : null
      };
    }
    if (typeof body.entryNote === "string") doc.entryNote = body.entryNote;
    if (Array.isArray(body.targets)) {
      doc.targets = body.targets;
    }

    await doc.save();

    // محاسبه‌ی مجدد
    try {
      var cache = getCache();
      var r = signalTracker.computePnL(doc.snapshot, doc.entries, cache);
      if (!r.missing) {
        doc.currentPnL = r.pnl;
        doc.currentROI = r.roi;
        doc.base = r.base;
        if (doc.peakROI == null || r.roi > doc.peakROI) doc.peakROI = r.roi;
        if (doc.troughROI == null || r.roi < doc.troughROI) doc.troughROI = r.roi;
        doc.lastUpdated = new Date();
        await doc.save();
      }
    } catch (e) { /* ignore */ }

    res.json({ ok: true, followed: doc });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// بستن دستی پیگیری
router.post("/signals/followed/:id/close", requireApiKey, async function (req, res) {
  try {
    var body = req.body || {};
    var doc = await FollowedSignal.findOne({ _id: req.params.id, ownerId: "default" });
    if (!doc) return res.status(404).json({ ok: false, error: "not found" });

    doc.status = "closed";
    doc.closedAt = new Date();
    doc.exitNote = body.exitNote || "";
    doc.finalPnL = doc.currentPnL;
    doc.finalROI = doc.currentROI;
    await doc.save();
    res.json({ ok: true, followed: doc });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// حذف کامل پیگیری
router.delete("/signals/followed/:id", requireApiKey, async function (req, res) {
  try {
    var r = await FollowedSignal.deleteOne({ _id: req.params.id, ownerId: "default" });
    res.json({ ok: true, deleted: r.deletedCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;