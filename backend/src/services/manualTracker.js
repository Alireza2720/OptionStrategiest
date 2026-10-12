"use strict";
// ============================================================
// manualTracker.js — پیگیری دستی سبد (کال/پوت/سهم)
// ============================================================
var ManualTracker = require("../models/ManualTracker");
var { sendLongMessage } = require("./telegram");

var deps = {
    logger: null,
    notify: null,      // optional custom notifier
    getChain: null     // () => Array<watchRow>
};

function init(d) { deps = Object.assign({}, deps, d); }

function escapeHtml(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function normalizeLeg(raw) {
    if (!raw || typeof raw !== "object") return null;
    var kind = String(raw.kind || "").toLowerCase();
    if (["stock", "call", "put"].indexOf(kind) === -1) return null;
    var side = raw.side === "sell" ? "sell" : "buy";
    var name = String(raw.contractName || raw.name || "").trim();
    if (!name) return null;
    var entryPrice = Number(raw.entryPrice);
    if (!(entryPrice > 0)) return null;
    var quantity = Math.max(1, Math.floor(Number(raw.quantity) || 1));
    var size = Number(raw.size) > 0 ? Number(raw.size) : (kind === "stock" ? 1 : 1000);
    return {
        kind: kind,
        contractName: name,
        expiry: raw.expiry ? String(raw.expiry) : null,
        strike: raw.strike != null ? Number(raw.strike) : null,
        side: side,
        quantity: quantity,
        size: size,
        entryPrice: entryPrice
    };
}

function normalizeTargets(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) {
        if (!t || typeof t !== "object") return null;
        var kind = t.kind === "loss" ? "loss" : "profit";
        var value = Number(t.value);
        if (!isFinite(value)) return null;
        return { kind: kind, value: value, hit: false, hitAt: null, notified: false };
    }).filter(Boolean);
}

// ─── ساخت map از cache ───
function buildMaps(chain) {
    var contractMap = new Map();   // name|expiry → row
    var basisMap = new Map();      // basis_name → { spot, bid, ask, bid_vol, ask_vol }
    if (!Array.isArray(chain)) return { contractMap: contractMap, basisMap: basisMap };
    for (var i = 0; i < chain.length; i++) {
        var c = chain[i];
        if (!c) continue;
        var name = String(c.name || "");
        var exp = String(c.expiry || "");
        if (name && exp) contractMap.set(name + "|" + exp, c);
        if (name && !contractMap.has(name)) contractMap.set(name, c);
        var bn = c.basis_name;
        if (bn && !basisMap.has(bn)) {
            basisMap.set(bn, {
                spot: Number(c.spot) || 0,
                bid: Number(c.basis_bid_price) || 0,
                ask: Number(c.basis_ask_price) || 0,
                bid_vol: Number(c.basis_bid_vol) || 0,
                ask_vol: Number(c.basis_ask_vol) || 0,
                queue: c.basis_queue || null
            });
        }
    }
    return { contractMap: contractMap, basisMap: basisMap };
}

// ─── محاسبه‌ی P&L زنده ───
function computeLive(legs, margin, contractMap, basisMap) {
    var totalPnL = 0;
    var entryCF = 0;
    var missing = false;
    var legsLive = [];

    for (var i = 0; i < legs.length; i++) {
        var leg = legs[i];
        var size = Number(leg.size) || (leg.kind === "stock" ? 1 : 1000);
        var qty = Number(leg.quantity) || 1;
        var mult = size * qty;
        var entry = Number(leg.entryPrice) || 0;

        var exitPrice = null;
        var detail = null;

        if (leg.kind === "stock") {
            var b = basisMap.get(leg.contractName);
            if (b && b.spot > 0) {
                // برای خرید با ask می‌فروشیم (یا spot اگر ask نداشتیم)
                exitPrice = leg.side === "sell"
                    ? (b.ask > 0 ? b.ask : b.spot)
                    : (b.bid > 0 ? b.bid : b.spot);
                detail = { spot: b.spot, bid: b.bid, ask: b.ask, queue: b.queue };
            }
        } else {
            var c = leg.expiry
                ? contractMap.get(leg.contractName + "|" + leg.expiry)
                : null;
            if (!c) c = contractMap.get(leg.contractName);
            if (c) {
                var bid = Number(c.bid_price) || 0;
                var ask = Number(c.ask_price) || 0;
                var last = Number(c.price) || 0;
                exitPrice = leg.side === "sell"
                    ? (ask > 0 ? ask : last)
                    : (bid > 0 ? bid : last);
                if (!(exitPrice > 0)) exitPrice = null;
                detail = { bid: bid, ask: ask, last: last, strike: c.strike, expiry: c.expiry };
            }
        }

        if (exitPrice == null || exitPrice <= 0) {
            missing = true;
            legsLive.push({
                kind: leg.kind, contractName: leg.contractName,
                expiry: leg.expiry, strike: leg.strike, side: leg.side,
                quantity: qty, size: size, entryPrice: entry,
                currentExitPrice: null, pnl: null, pnlPct: null,
                ok: false, detail: null
            });
            continue;
        }

        var pnl, pnlPct;
        if (leg.side === "sell") {
            pnl = (entry - exitPrice) * mult;
            entryCF -= entry * mult;
            pnlPct = entry > 0 ? ((entry - exitPrice) / entry) * 100 : 0;
        } else {
            pnl = (exitPrice - entry) * mult;
            entryCF += entry * mult;
            pnlPct = entry > 0 ? ((exitPrice - entry) / entry) * 100 : 0;
        }
        totalPnL += pnl;

        legsLive.push({
            kind: leg.kind, contractName: leg.contractName,
            expiry: leg.expiry, strike: leg.strike, side: leg.side,
            quantity: qty, size: size, entryPrice: entry,
            currentExitPrice: Math.round(exitPrice * 100) / 100,
            pnl: Math.round(pnl * 100) / 100,
            pnlPct: Math.round(pnlPct * 100) / 100,
            ok: true, detail: detail
        });
    }

    var base;
    if (entryCF > 0) base = entryCF;
    else if (entryCF < 0) {
        var credit = -entryCF;
        var m = Number(margin) || 0;
        base = m > 0 ? Math.max(m - credit, m * 0.01) : credit;
    } else base = 1;

    var roi = base > 0 ? (totalPnL / base) * 100 : 0;
    return {
        pnl: Math.round(totalPnL * 100) / 100,
        roi: Math.round(roi * 100) / 100,
        base: Math.round(base * 100) / 100,
        entryCF: Math.round(entryCF * 100) / 100,
        legsLive: legsLive,
        missing: missing
    };
}

// ─── عملیات ───
async function create(payload) {
    var rawLegs = Array.isArray(payload.legs) ? payload.legs : [];
    var legs = rawLegs.map(normalizeLeg).filter(Boolean);
    if (!legs.length) throw new Error("حداقل یک پای معتبر لازم است");

    var doc = new ManualTracker({
        ownerId: "default",
        title: String(payload.title || "پیگیری دستی").slice(0, 200),
        note: String(payload.note || "").slice(0, 2000),
        legs: legs,
        margin: Number(payload.margin) > 0 ? Number(payload.margin) : 0,
        targets: normalizeTargets(payload.targets),
        trackingEnabled: payload.trackingEnabled !== false,
        status: "active"
    });
    await doc.save();

    // محاسبه‌ی اولیه
    try {
        var chain = deps.getChain ? (deps.getChain() || []) : [];
        var maps = buildMaps(chain);
        var live = computeLive(doc.legs, doc.margin, maps.contractMap, maps.basisMap);
        if (!live.missing) {
            doc.currentPnL = live.pnl;
            doc.currentROI = live.roi;
            doc.base = live.base;
            doc.peakROI = live.roi;
            doc.troughROI = live.roi;
            doc.lastUpdated = new Date();
            await doc.save();
        }
    } catch (_) {}

    return doc;
}

async function list(filter) {
    var q = { ownerId: "default" };
    if (filter && filter.status && filter.status !== "all") q.status = filter.status;
    return ManualTracker.find(q).sort({ createdAt: -1 }).lean();
}

async function getById(id) {
    return ManualTracker.findOne({ _id: id, ownerId: "default" });
}

async function update(id, patch) {
    var doc = await getById(id);
    if (!doc) throw new Error("tracker not found");
    if (patch.title != null) doc.title = String(patch.title).slice(0, 200);
    if (patch.note != null) doc.note = String(patch.note).slice(0, 2000);
    if (Array.isArray(patch.legs)) {
        var legs = patch.legs.map(normalizeLeg).filter(Boolean);
        if (!legs.length) throw new Error("حداقل یک پای معتبر لازم است");
        doc.legs = legs;
    }
    if (patch.margin != null) doc.margin = Number(patch.margin) > 0 ? Number(patch.margin) : 0;
    if (Array.isArray(patch.targets)) doc.targets = normalizeTargets(patch.targets);
    if (typeof patch.trackingEnabled === "boolean") doc.trackingEnabled = patch.trackingEnabled;
    await doc.save();
    return doc;
}

async function remove(id) {
    var r = await ManualTracker.deleteOne({ _id: id, ownerId: "default" });
    return r.deletedCount;
}

async function close(id, payload) {
    var doc = await getById(id);
    if (!doc) throw new Error("tracker not found");
    if (doc.status === "closed") return doc;
    doc.status = "closed";
    doc.closedAt = new Date();
    doc.exitNote = String((payload && payload.exitNote) || "").slice(0, 2000);
    doc.finalPnL = doc.currentPnL;
    doc.finalROI = doc.currentROI;
    await doc.save();
    return doc;
}

async function calcOnce(payload) {
    var rawLegs = Array.isArray(payload.legs) ? payload.legs : [];
    var legs = rawLegs.map(normalizeLeg).filter(Boolean);
    if (!legs.length) throw new Error("حداقل یک پای معتبر لازم است");
    var chain = deps.getChain ? (deps.getChain() || []) : [];
    var maps = buildMaps(chain);
    return computeLive(legs, payload.margin, maps.contractMap, maps.basisMap);
}

// ─── چک دوره‌ای ───
async function checkAll() {
    var active = await ManualTracker.find({
        ownerId: "default",
        status: "active",
        trackingEnabled: { $ne: false }
    });
    if (!active.length) return { checked: 0, notified: 0 };

    var chain = deps.getChain ? (deps.getChain() || []) : [];
    var maps = buildMaps(chain);

    var token = process.env.TELEGRAM_BOT_TOKEN;
    var chatId = process.env.TELEGRAM_CHAT_ID;
    var notified = 0;

    for (var i = 0; i < active.length; i++) {
        var t = active[i];
        var live = computeLive(t.legs, t.margin, maps.contractMap, maps.basisMap);
        if (live.missing) continue;

        if (t.peakROI == null || live.roi > t.peakROI) t.peakROI = live.roi;
        if (t.troughROI == null || live.roi < t.troughROI) t.troughROI = live.roi;

        var toNotify = [];
        (t.targets || []).forEach(function (tg) {
            if (tg.hit) return;
            var hit = tg.kind === "profit" ? live.roi >= tg.value : live.roi <= tg.value;
            if (hit) { tg.hit = true; tg.hitAt = new Date(); toNotify.push(tg); }
        });

        t.currentPnL = live.pnl;
        t.currentROI = live.roi;
        t.base = live.base;
        t.lastUpdated = new Date();
        await t.save();

        if (toNotify.length && token && chatId) {
            for (var k = 0; k < toNotify.length; k++) {
                var tg = toNotify[k];
                var emoji = tg.kind === "profit" ? "🎯" : "🛑";
                var title = tg.kind === "profit" ? "به هدف سود رسید" : "به حد ضرر رسید";
                var msg = emoji + " <b>" + title + "</b>\n" +
                    "━━━━━━━━━━━━━━━━━━━━━━\n" +
                    "📌 " + escapeHtml(t.title) + "\n" +
                    "🎯 هدف: " + (tg.kind === "profit" ? "+" : "") + tg.value + "٪\n" +
                    "📈 ROI فعلی: " + (live.roi >= 0 ? "+" : "") + live.roi.toFixed(2) + "٪\n" +
                    "💰 P&L: " + Math.round(live.pnl).toLocaleString("en-US");
                try { await sendLongMessage(token, chatId, msg); notified++; }
                catch (e) { deps.logger && deps.logger.warn("manualTracker notify: " + e.message); }
            }
        }
    }
    return { checked: active.length, notified: notified };
}

module.exports = {
    init: init,
    create: create, list: list, getById: getById,
    update: update, remove: remove, close: close,
    calcOnce: calcOnce, checkAll: checkAll, computeLive: computeLive
};
