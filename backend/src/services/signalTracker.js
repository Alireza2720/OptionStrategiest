"use strict";
var FollowedSignal = require("../models/FollowedSignal");
var { sendLongMessage } = require("./telegram");

var CONTRACT_SIZE = 1000;

// نگاشت هر استراتژی به ترتیب side هر پای
// side = "buy" → کاربر خرید، بستن با bid
// side = "sell" → کاربر فروخت، بستن با ask
function legsSideFor(strategyType) {
  switch (strategyType) {
    case "cc":            return ["sell"];
    case "mp":            return ["buy"];
    case "co":            return ["buy", "sell"];
    case "cv":            return ["buy", "sell"];
    case "strangle":      return ["buy", "buy"];
    case "strangleSell":  return ["sell", "sell"];
    case "callspread":    return ["buy", "sell"];
    case "callspreadbear":return ["buy", "sell"];
    case "putspread":     return ["buy", "sell"];
    case "putspreadbull": return ["buy", "sell"];
    case "box":           return ["buy", "sell", "buy", "sell"];
    case "boxSell":       return ["buy", "sell", "buy", "sell"];
    default:              return [];
  }
}

function needsStockEntry(strategyType) {
  return ["cc", "mp", "co", "cv"].indexOf(strategyType) !== -1;
}

function findCurrentContract(cache, name, expiry) {
  var watch = cache.watch || [];
  for (var i = 0; i < watch.length; i++) {
    var c = watch[i];
    if (c.name === name && c.expiry === expiry) return c;
  }
  return null;
}

function findStockSpot(cache, basisName) {
  var watch = cache.watch || [];
  for (var i = 0; i < watch.length; i++) {
    var c = watch[i];
    if (c.basis_name === basisName) return c.spot;
  }
  return null;
}

// محاسبه‌ی P&L
function computePnL(snapshot, entries, cache) {
  var strategyType = snapshot.strategy_type;
  var sides = legsSideFor(strategyType);
  var legs = snapshot.legs || [];
  var S = CONTRACT_SIZE;

  var totalPnL = 0;
  var entryCF = 0;   // > 0 = debit (پول دادی)، < 0 = credit (پول گرفتی)
  var missing = false;

  // سهم پایه (فقط برای استراتژی‌های سهم‌محور)
  if (needsStockEntry(strategyType)) {
    var stockEntry = entries && entries.stockEntry;
    if (stockEntry == null || isNaN(stockEntry)) {
      missing = true;
    } else {
      var spot = findStockSpot(cache, snapshot.basis_name);
      if (spot == null || spot <= 0) {
        missing = true;
      } else {
        // کاربر سهم پایه را خرید (همیشه side=buy)
        totalPnL += (spot - stockEntry) * S;
        entryCF += stockEntry * S;
      }
    }
  }

  // پای‌های آپشن
  for (var i = 0; i < legs.length; i++) {
    var leg = legs[i];
    var side = sides[i] || "buy";
    var entryPrice = entries && entries.legEntries ? entries.legEntries[i] : null;

    if (entryPrice == null || isNaN(entryPrice)) {
      missing = true;
      continue;
    }

    var contract = findCurrentContract(cache, leg.name, snapshot.expiry);
    if (!contract) {
      missing = true;
      continue;
    }

    if (side === "buy") {
      // بستن با فروش → bid فعلی
      var bidP = contract.bid_price || 0;
      if (bidP <= 0) { missing = true; continue; }
      totalPnL += (bidP - entryPrice) * S;
      entryCF += entryPrice * S;
    } else {
      // بستن با خرید → ask فعلی
      var askP = contract.ask_price || 0;
      if (askP <= 0) { missing = true; continue; }
      totalPnL += (entryPrice - askP) * S;
      entryCF -= entryPrice * S;
    }
  }

  // محاسبه‌ی base برای ROI
  var base;
  if (entryCF > 0) {
    // استراتژی بدهی: سرمایه = هزینه‌ی خالص پرداختی
    base = entryCF;
  } else if (entryCF < 0) {
    // استراتژی اعتباری: سرمایه = margin − credit
    var credit = -entryCF;
    var margin = (entries && entries.margin) || 0;
    if (margin > 0) {
      base = margin - credit;
      if (base <= 0) base = margin * 0.01; // fallback امنیتی
    } else {
      // اگر کاربر margin نداد، با credit خودش تقریب می‌زنیم
      base = credit > 0 ? credit : 1;
    }
  } else {
    base = 1;
  }

  return {
    pnl: Math.round(totalPnL * 100) / 100,
    entryCF: Math.round(entryCF * 100) / 100,
    base: Math.round(base * 100) / 100,
    roi: base > 0 ? Math.round((totalPnL / base) * 10000) / 100 : 0,
    missing: missing
  };
}

// در هر چرخه صدا زده می‌شود
async function checkFollowedSignals(token, chatId, notify, cache) {
  var list = await FollowedSignal.find({ ownerId: "default", status: "active" });
  if (list.length === 0) return;

  var now = new Date();

  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    var result = computePnL(f.snapshot, f.entries, cache);

    if (result.missing) continue; // اگر داده ناقص است، آخرین مقدار معتبر را نگه دار

    f.currentPnL = result.pnl;
    f.currentROI = result.roi;
    f.base = result.base;
    f.lastUpdated = now;

    if (f.peakROI == null || result.roi > f.peakROI) f.peakROI = result.roi;
    if (f.troughROI == null || result.roi < f.troughROI) f.troughROI = result.roi;

    // بررسی hit شدن اهداف
    var toNotify = [];
    (f.targets || []).forEach(function (t) {
      if (t.hit) return;
      var hit = false;
      if (t.kind === "profit" && result.roi >= t.value) hit = true;
      if (t.kind === "loss" && result.roi <= t.value) hit = true;
      if (hit) {
        t.hit = true;
        t.hitAt = now;
        toNotify.push(t);
      }
    });

    await f.save();

    // اعلان تلگرام
    if (notify && token && chatId && toNotify.length > 0) {
      for (var j = 0; j < toNotify.length; j++) {
        var t = toNotify[j];
        var emoji = t.kind === "profit" ? "🎯" : "🛑";
        var title = t.kind === "profit" ? "به هدف سود رسید" : "به حد ضرر رسید";
        var msg = emoji + " <b>" + title + "</b>\n"
                + "━━━━━━━━━━━━━━━━━━━━━━\n"
                + "📌 سیگنال: <code>" + (f.snapshot.primary_name || "") + "</code>\n"
                + "📊 استراتژی: " + (f.snapshot.strategy_type || "") + "\n"
                + "🎯 هدف: " + (t.kind === "profit" ? "+" : "") + t.value + "٪\n"
                + "📈 ROI فعلی: " + (result.roi >= 0 ? "+" : "") + result.roi.toFixed(2) + "٪\n"
                + "💰 P&L (per contract): " + Math.round(result.pnl).toLocaleString() + "\n"
                + "⏱ زمان: " + now.toLocaleString("fa-IR");
        try {
          await sendLongMessage(token, chatId, msg);
          t.notified = true;
          await f.save();
        } catch (e) {
          console.error("[signalTracker] خطا در ارسال:", e.message);
        }
      }
    }
  }
}

module.exports = {
  checkFollowedSignals: checkFollowedSignals,
  computePnL: computePnL,
  legsSideFor: legsSideFor,
  needsStockEntry: needsStockEntry
};