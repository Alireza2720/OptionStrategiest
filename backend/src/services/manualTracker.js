"use strict";
// ============================================================
// manualTracker.js — پیگیری دستی سبد (کال/پوت/سهم)
// ============================================================
var ManualTracker = require("../models/ManualTracker");
var { sendLongMessage } = require("./telegram");
var Settings = require("../models/Settings");

var _feesCache = null;
var _feesCacheAt = 0;
var _FEES_TTL_MS = 60 * 1000;

async function _loadFees() {
    var now = Date.now();
    if (_feesCache && (now - _feesCacheAt) < _FEES_TTL_MS) return _feesCache;
    try {
        var s = await Settings.findOne({ ownerId: "default" }).lean();
        _feesCache = {
            enabled: !!(s && s.feeEnabled),
            optionBuy: (s && Number.isFinite(s.optionFeeBuy)) ? s.optionFeeBuy : 0.0012,
            optionSell: (s && Number.isFinite(s.optionFeeSell)) ? s.optionFeeSell : 0.0012,
            optionTaxPct: (s && Number.isFinite(s.optionTaxOnSellPct)) ? s.optionTaxOnSellPct : 0.1,
            stockBuy: (s && Number.isFinite(s.stockFeeBuy)) ? s.stockFeeBuy : 0.0012,
            stockSell: (s && Number.isFinite(s.stockFeeSell)) ? s.stockFeeSell : 0.0012,
            stockTaxPct: (s && Number.isFinite(s.stockTaxOnSellPct)) ? s.stockTaxOnSellPct : 0.1,
            buy: (s && Number.isFinite(s.feeBuy)) ? s.feeBuy : 0.0012,
            sell: (s && Number.isFinite(s.feeSell)) ? s.feeSell : 0.0012,
            taxPct: (s && Number.isFinite(s.taxOnSellPct)) ? s.taxOnSellPct : 0.1
        };
        _feesCacheAt = now;
        return _feesCache;
    } catch (_) {
        return { enabled: false, optionBuy: 0.0012, optionSell: 0.0012, optionTaxPct: 0.1, stockBuy: 0.0012, stockSell: 0.0012, stockTaxPct: 0.1, buy: 0.0012, sell: 0.0012, taxPct: 0.1 };
    }
}

function _invalidateFeesCache() { _feesCache = null; _feesCacheAt = 0; }

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
    var margin = Number(raw.margin) > 0 ? Number(raw.margin) : 0;
    return {
        kind: kind,
        contractName: name,
        expiry: raw.expiry ? String(raw.expiry) : null,
        strike: raw.strike != null ? Number(raw.strike) : null,
        side: side,
        quantity: quantity,
        size: size,
        entryPrice: entryPrice,
        margin: margin,
        manualCurrentPrice: (Number(raw.manualCurrentPrice) > 0) ? Number(raw.manualCurrentPrice) : null,
        manualPriceAt: raw.manualPriceAt ? new Date(raw.manualPriceAt) : null
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

// ─── Helper: normalized key for lookup (handles ی/ي, ک/ك, ZWNJ, spaces) ───
function _normKey(s) {
    return String(s || '').trim()
        .replace(/\u064a/g, 'ی').replace(/\u0643/g, 'ک')
        .replace(/[\u200c\u200e\u200f\u00a0\s]+/g, '');
}

function _findBasis(basisMap, name) {
    if (!name || !basisMap) return null;
    var b = basisMap.get(name);
    if (b) return b;
    var n = _normKey(name);
    if (!n) return null;
    var it = basisMap.entries(), r = it.next();
    while (!r.done) {
        if (_normKey(r.value[0]) === n) return r.value[1];
        r = it.next();
    }
    return null;
}

function _findContract(contractMap, name, expiry) {
    if (!name || !contractMap) return null;
    var c = expiry ? contractMap.get(name + "|" + expiry) : null;
    if (c) return c;
    c = contractMap.get(name);
    if (c) return c;
    var n = _normKey(name);
    if (!n) return null;
    var it = contractMap.entries(), r = it.next();
    while (!r.done) {
        var parts = String(r.value[0]).split("|");
        if (_normKey(parts[0]) === n) {
            if (!expiry || parts[1] === expiry) return r.value[1];
        }
        r = it.next();
    }
    return null;
}

// ─── محاسبه‌ی P&L زنده ───

// helper: نرخ کارمزد بر اساس نوع پا و سمت معامله
function _feeFor(leg, side, fees) {
    if (!fees || !fees.enabled) return { rate: 0, tax: 0 };
    var isStock = leg.kind === "stock";
    if (side === "buy") return { rate: isStock ? fees.stockBuy : fees.optionBuy, tax: 0 };
    var rate = isStock ? fees.stockSell : fees.optionSell;
    var taxPct = isStock ? fees.stockTaxPct : fees.optionTaxPct;
    return { rate: rate, tax: rate * taxPct };
}

function computeLive(legs, margin, contractMap, basisMap, fees) {
    fees = fees || { enabled: false, optionBuy: 0.0012, optionSell: 0.0012, optionTaxPct: 0.1, stockBuy: 0.0012, stockSell: 0.0012, stockTaxPct: 0.1, buy: 0.0012, sell: 0.0012, taxPct: 0.1 };
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
            var b = _findBasis(basisMap, leg.contractName);
            if (b && (b.spot > 0 || b.bid > 0 || b.ask > 0)) {
                var refP = b.spot > 0 ? b.spot : (b.bid > 0 ? b.bid : b.ask);
                exitPrice = leg.side === "sell"
                    ? (b.ask > 0 ? b.ask : refP)
                    : (b.bid > 0 ? b.bid : refP);
                detail = { spot: b.spot, bid: b.bid, ask: b.ask, queue: b.queue };
            }
        } else {
            var c = _findContract(contractMap, leg.contractName, leg.expiry);
            if (c) {
                var bid = Number(c.bid_price) || 0;
                var ask = Number(c.ask_price) || 0;
                var last = Number(c.price) || 0;
                var bs = Number(c.bs) || 0;
                var ref = last > 0 ? last : (bs > 0 ? bs : 0);
                exitPrice = leg.side === "sell"
                    ? (ask > 0 ? ask : ref)
                    : (bid > 0 ? bid : ref);
                if (!(exitPrice > 0)) exitPrice = null;
                detail = {
                    bid: bid, ask: ask, last: last, bs: bs,
                    estimated: (bid <= 0 && ask <= 0),
                    strike: c.strike, expiry: c.expiry
                };
            }
        }

        // 🆕 manual price override from broker (takes priority for halted symbols)
        if (leg.manualCurrentPrice != null && leg.manualCurrentPrice > 0) {
            exitPrice = Number(leg.manualCurrentPrice);
            if (detail) detail.manual = true;
            else detail = { manual: true };
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
            // Sell: entry proceeds minus fee+sell tax; exit cost plus buy fee
            var _fS = _feeFor(leg, "sell", fees);
            var _fB = _feeFor(leg, "buy", fees);
            var _sellFee = entry * mult * (_fS.rate + _fS.tax);
            var _buyFee  = exitPrice * mult * _fB.rate;
            pnl = (entry * mult - exitPrice * mult) - _sellFee - _buyFee;
            entryCF -= entry * mult;
            pnlPct = entry > 0 ? ((pnl) / (entry * mult)) * 100 : 0;
        } else {
            // Buy: entry cost plus buy fee; exit proceeds minus sell fee and tax
            var _fB2 = _feeFor(leg, "buy", fees);
            var _fS2 = _feeFor(leg, "sell", fees);
            var _buyFeeIn  = entry * mult * _fB2.rate;
            var _sellFeeOut = exitPrice * mult * (_fS2.rate + _fS2.tax);
            pnl = (exitPrice * mult - entry * mult) - _buyFeeIn - _sellFeeOut;
            entryCF += entry * mult;
            pnlPct = entry > 0 ? ((pnl) / (entry * mult)) * 100 : 0;
        }
        totalPnL += pnl;

        legsLive.push({
            kind: leg.kind, contractName: leg.contractName,
            expiry: leg.expiry, strike: leg.strike, side: leg.side,
            quantity: qty, size: size, entryPrice: entry,
            margin: Number(leg.margin) || 0,
            currentExitPrice: Math.round(exitPrice * 100) / 100,
            pnl: Math.round(pnl * 100) / 100,
            pnlPct: Math.round(pnlPct * 100) / 100,
            ok: true, detail: detail
        });
    }

    // مجموع وجه تضمین هر پای
    var legMarginSum = 0;
    for (var mi = 0; mi < legs.length; mi++) {
        legMarginSum += Number(legs[mi].margin) || 0;
    }
    var effectiveMargin = legMarginSum > 0 ? legMarginSum : (Number(margin) || 0);

    var base;
    if (entryCF > 0) base = entryCF;
    else if (entryCF < 0) {
        var credit = -entryCF;
        base = effectiveMargin > 0 ? Math.max(effectiveMargin - credit, effectiveMargin * 0.01) : credit;
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

// ─── محاسبه‌ی وجه تضمین برای فروش اختیار بدون پوشش ───
// فرمول تقریبی TSETMC:
//   Margin = max(0.25 * S, 0.15 * S + Premium) * Size
function nakedOptionMargin(spot, premium, size) {
    if (!(spot > 0) || !(size > 0)) return 0;
    var p = (premium > 0) ? premium : 0;
    return Math.max(0.25 * spot, 0.15 * spot + p) * size;
}

// ─── لیست قراردادها برای autocomplete ───
function listContracts() {
    var chain = deps.getChain ? (deps.getChain() || []) : [];
    var out = [];
    for (var i = 0; i < chain.length; i++) {
        var c = chain[i];
        if (!c) continue;
        var spot = Number(c.spot) || 0;
        var size = Number(c.size) || 1000;
        var last = Number(c.price) || 0;
        var bid = Number(c.bid_price) || 0;
        var ask = Number(c.ask_price) || 0;
        var suggested = nakedOptionMargin(spot, last > 0 ? last : (bid > 0 ? bid : ask), size);
        out.push({
            name: String(c.name || ""),
            basis_name: String(c.basis_name || ""),
            type: c.type === "call" ? "call" : "put",
            strike: Number(c.strike) || 0,
            expiry: String(c.expiry || ""),
            size: size,
            dte: Number(c.dte) || 0,
            spot: spot,
            bid: bid,
            ask: ask,
            last: last,
            nakedMargin: Math.round(suggested)
        });
    }
    return out;
}

// ─── عملیات ───
async function create(payload) {
    var rawLegs = Array.isArray(payload.legs) ? payload.legs : [];
    var legs = rawLegs.map(normalizeLeg).filter(Boolean);
    if (!legs.length) throw new Error("حداقل یک پای معتبر لازم است");

    var doc = new ManualTracker({
        ownerId: "default",
        title: String(payload.title || "پیگیری دستی").slice(0, 200),
        strategyId: payload.strategyId ? String(payload.strategyId).slice(0, 100) : null,
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
        var _fees = await _loadFees();
        var live = computeLive(doc.legs, doc.margin, maps.contractMap, maps.basisMap, _fees);
        if (!live.missing) {
            doc.currentPnL = live.pnl;
            doc.currentROI = live.roi;
            doc.base = live.base;
            doc.peakROI = live.roi;
            doc.troughROI = live.roi;
            doc.lastLegsLive = live.legsLive;
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

async function setLegManualPrice(id, legIdx, price) {
    var doc = await getById(id);
    if (!doc) throw new Error("tracker not found");
    var idx = parseInt(legIdx, 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= doc.legs.length) {
        throw new Error("leg index نامعتبر");
    }
    var p = parseFloat(price);
    var leg = doc.legs[idx];
    if (p > 0) {
        leg.manualCurrentPrice = p;
        leg.manualPriceAt = new Date();
    } else {
        leg.manualCurrentPrice = null;
        leg.manualPriceAt = null;
    }
    doc.markModified("legs");
    await doc.save();
    // Immediate refresh
    try {
        var chain = deps.getChain ? (deps.getChain() || []) : [];
        var maps = buildMaps(chain);
        var fees = await _loadFees();
        var live = computeLive(doc.legs, doc.margin, maps.contractMap, maps.basisMap, fees);
        if (!live.missing) {
            doc.currentPnL = live.pnl;
            doc.currentROI = live.roi;
            doc.base = live.base;
            doc.lastLegsLive = live.legsLive;
            doc.lastUpdated = new Date();
            await doc.save();
        }
    } catch (_) {}
    return doc;
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
    var fees = await _loadFees();
    return computeLive(legs, payload.margin, maps.contractMap, maps.basisMap, fees);
}

// ─── چک دوره‌ای ───
async function checkAll(opts) {
    opts = opts || {};
    var allowNotify = opts.notify !== false;
    var active = await ManualTracker.find({
        ownerId: "default",
        status: "active",
        trackingEnabled: { $ne: false }
    });
    if (!active.length) return { checked: 0, notified: 0 };

    var chain = deps.getChain ? (deps.getChain() || []) : [];
    var maps = buildMaps(chain);
    var fees = await _loadFees();

    var token = allowNotify ? process.env.TELEGRAM_BOT_TOKEN : null;
    var chatId = allowNotify ? process.env.TELEGRAM_CHAT_ID : null;
    var notified = 0;

    for (var i = 0; i < active.length; i++) {
        var t = active[i];
        var live = computeLive(t.legs, t.margin, maps.contractMap, maps.basisMap, fees);
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
        t.lastLegsLive = live.legsLive;
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
    invalidateFeesCache: _invalidateFeesCache,
    setLegManualPrice: setLegManualPrice,
    create: create, list: list, getById: getById,
    update: update, remove: remove, close: close,
    calcOnce: calcOnce, checkAll: checkAll, computeLive: computeLive,
    listContracts: listContracts, nakedOptionMargin: nakedOptionMargin
};
