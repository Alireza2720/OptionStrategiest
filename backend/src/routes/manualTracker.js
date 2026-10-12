"use strict";
var express = require("express");
var router = express.Router();
var manualTracker = require("../services/manualTracker");

// calc — بدون ذخیره (باید قبل از :id ثبت بشه)
router.get("/manual-trackers/contracts", async function (req, res) {
    try {
        var list = manualTracker.listContracts();
        res.json({ ok: true, contracts: list, count: list.length });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/manual-trackers/calc", async function (req, res) {
    try {
        var r = await manualTracker.calcOnce(req.body || {});
        res.json(Object.assign({ ok: true }, r));
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.get("/manual-trackers", async function (req, res, next) {
    try {
        var list = await manualTracker.list({ status: req.query.status || "active" });
        res.json({ ok: true, trackers: list });
    } catch (e) { next(e); }
});

router.get("/manual-trackers/:id", async function (req, res, next) {
    try {
        var t = await manualTracker.getById(req.params.id);
        if (!t) return res.status(404).json({ ok: false, error: "not found" });
        var live = null;
        try { live = await manualTracker.calcOnce({ legs: t.legs, margin: t.margin }); } catch (_) {}
        res.json({ ok: true, tracker: t, live: live });
    } catch (e) { next(e); }
});

router.post("/manual-trackers", async function (req, res) {
    try {
        var t = await manualTracker.create(req.body || {});
        res.json({ ok: true, tracker: t });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.patch("/manual-trackers/:id", async function (req, res) {
    try {
        var t = await manualTracker.update(req.params.id, req.body || {});
        res.json({ ok: true, tracker: t });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.delete("/manual-trackers/:id", async function (req, res, next) {
    try {
        var n = await manualTracker.remove(req.params.id);
        res.json({ ok: true, deleted: n });
    } catch (e) { next(e); }
});

router.patch("/manual-trackers/:id/legs/:idx/price", async function (req, res) {
    try {
        var price = (req.body || {}).price;
        var t = await manualTracker.setLegManualPrice(req.params.id, req.params.idx, price);
        res.json({ ok: true, tracker: t });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.post("/manual-trackers/:id/close", async function (req, res) {
    try {
        var t = await manualTracker.close(req.params.id, req.body || {});
        res.json({ ok: true, tracker: t });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

module.exports = router;
