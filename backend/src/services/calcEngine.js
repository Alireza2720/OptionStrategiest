"use strict";

function roiCalc(pnl, base) { return base > 0 ? (pnl / base) * 100 : 0; }
function adjustRoi(roi, dte) { return dte > 0 ? roi * (30 / dte) : roi; }
function bp(c) { return c.buy_price || 0; }
function sp(c) { return c.sell_price || 0; }
function canBuyOpt(c) { return c.ask_vol > 0 && c.ask_price > 0; }
function canSellOpt(c) { return c.bid_vol > 0 && c.bid_price > 0; }

function buildSteps(step) {
  var s = Math.abs(parseFloat(step));
  if (!s || isNaN(s)) s = 5;
  var a = [];
  for (var i = -3; i <= 3; i++) a.push(Math.round(i * s * 100) / 100);
  return a;
}

function calcCC(calls, steps) {
  var results = [];
  calls.forEach(function (c) {
    if (!canSellOpt(c) || c.spot <= 0 || c.dte <= 0) return;
    var income = sp(c), block = (c.spot - income) * c.size;
    if (block <= 0) return;
    var maxProfit = (c.strike - c.spot + income) * c.size;
    function payoff(pct) {
      var future = c.spot * (1 + pct / 100);
      return roiCalc(Math.min(c.strike, future) * c.size - block, block);
    }
    var zero = payoff(0);
    results.push({
      name: c.name, basis_name: c.basis_name, strike: c.strike, expiry: c.expiry, dte: c.dte, size: c.size,
      bid_vol: c.bid_vol, bid_price: c.bid_price, spot: c.spot, trade_value: Math.round(c.tvalue),
      margin: 0, break_even: Math.round(c.spot - income), premium: Math.round(income * 100) / 100,
      max_profit: Math.round(maxProfit), max_loss: Math.round(-block), roi_zero: Math.round(zero * 100) / 100,
      scenariosAdjusted: steps.map(function (p) { return adjustRoi(payoff(p), c.dte); }),
      scenariosRaw: steps.map(function (p) { return payoff(p); }),
      basis_buyable: c.basis_buyable,
      spot_overridden: c.spot_overridden, spot_original: c.spot_original,
      _payoff: payoff
    });
  });
  results.sort(function (a, b) { return b.roi_zero - a.roi_zero; });
  return results;
}

function calcMP(puts, steps) {
  var results = [];
  puts.forEach(function (c) {
    if (!canBuyOpt(c) || c.spot <= 0 || c.dte <= 0) return;
    var putCost = bp(c), total = (c.spot + putCost) * c.size;
    if (total <= 0) return;
    var maxLoss = (c.spot - c.strike + putCost) * c.size;
    function payoff(pct) {
      var future = c.spot * (1 + pct / 100);
      return roiCalc(Math.max(c.strike, future) * c.size - total, total);
    }
    var zero = payoff(0);
    results.push({
      name: c.name, basis_name: c.basis_name, strike: c.strike, expiry: c.expiry, dte: c.dte, size: c.size,
      ask_vol: c.ask_vol, ask_price: c.ask_price, spot: c.spot, trade_value: Math.round(c.tvalue),
      total_cost: Math.round(total), break_even: Math.round(c.spot + putCost),
      premium: Math.round(c.buy_price * 100) / 100, max_loss: Math.round(-maxLoss),
      roi_zero: Math.round(zero * 100) / 100,
      scenariosAdjusted: steps.map(function (p) { return adjustRoi(payoff(p), c.dte); }),
      scenariosRaw: steps.map(function (p) { return payoff(p); }),
      basis_buyable: c.basis_buyable,
      spot_overridden: c.spot_overridden, spot_original: c.spot_original,
      _payoff: payoff
    });
  });
  results.sort(function (a, b) { return b.roi_zero - a.roi_zero; });
  return results;
}

function calcCollar(calls, puts, steps) {
  var byGroup = {};
  calls.forEach(function (c) {
    if (canSellOpt(c)) {
      // ✅ گروه‌بندی بر اساس expiry (نه dte)
      var key = c.basis_name + "|" + c.expiry;
      if (!byGroup[key]) byGroup[key] = [];
      byGroup[key].push(c);
    }
  });
  var results = [];
  puts.forEach(function (put) {
    if (!canBuyOpt(put) || put.dte <= 0) return;
    var group = byGroup[put.basis_name + "|" + put.expiry];
    if (!group) return;
    group.forEach(function (call) {
      if (call.strike === put.strike) return;
      // ✅ چک یکسانی سررسید و اندازه
      if (call.expiry !== put.expiry) return;
      if (call.size !== put.size) return;
      var sz = call.size, net = sp(call) - bp(put), block = (call.spot - net) * sz;
      if (block <= 0) return;
      function posVal(S) { return S - Math.max(S - call.strike, 0) + Math.max(put.strike - S, 0); }
      function payoff(pct) {
        var future = call.spot * (1 + pct / 100);
        return roiCalc((posVal(future) + net - call.spot) * sz, block);
      }
      var lowX = put.strike, highX = call.strike;
      var bestV = Math.max(lowX, highX), worstV = Math.min(lowX, highX);
      var maxProfit = (bestV - call.spot + net) * sz, maxLoss = (worstV - call.spot + net) * sz;
      var be = call.strike >= put.strike ? (call.spot - net) : (call.strike + put.strike - call.spot + net);
      var zero = payoff(0);
      results.push({
        call_name: call.name, put_name: put.name, basis_name: call.basis_name,
        k_call: call.strike, k_put: put.strike, expiry: call.expiry, dte: call.dte, size: sz,
        bid_vol: call.bid_vol, bid_price: call.bid_price, ask_vol: put.ask_vol, ask_price: put.ask_price,
        spot: call.spot, trade_value_call: Math.round(call.tvalue), trade_value_put: Math.round(put.tvalue),
        margin: 0, break_even: Math.round(be), max_profit: Math.round(maxProfit), max_loss: Math.round(maxLoss),
        roi_zero: Math.round(zero * 100) / 100,
        scenariosAdjusted: steps.map(function (p) { return adjustRoi(payoff(p), call.dte); }),
        scenariosRaw: steps.map(function (p) { return payoff(p); }),
        basis_buyable: (call.basis_buyable !== false) && (put.basis_buyable !== false),
        collar_type: call.strike > put.strike ? "استاندارد" : "معکوس",
        spot_overridden: call.spot_overridden, spot_original: call.spot_original,
        _payoff: payoff
      });
    });
  });
  results.sort(function (a, b) { return b.roi_zero - a.roi_zero; });
  return results;
}

function calcConversion(calls, puts) {
  var byGroup = {};
  // ✅ تغییر ۱: گروه‌بندی بر اساس expiry به جای dte
  calls.forEach(function (c) {
    if (canSellOpt(c)) {
      var key = c.basis_name + "|" + c.expiry + "|" + c.strike;
      if (!byGroup[key]) byGroup[key] = [];
      byGroup[key].push(c);
    }
  });
  var results = [];
  puts.forEach(function (put) {
    if (!canBuyOpt(put) || put.dte <= 0) return;
    var group = byGroup[put.basis_name + "|" + put.expiry + "|" + put.strike];
    if (!group) return;
    group.forEach(function (call) {
      // ✅ تغییر ۲: بررسی یکسانی سررسید و اندازه قرارداد
      if (call.expiry !== put.expiry) return;
      if (call.size !== put.size) return;
      var sz = call.size, perShareCost = call.spot + bp(put) - sp(call), total = perShareCost * sz;
      // ✅ تغییر ۳: دیگر total <= 0 حذف نمی‌شود — این هم آربیتراژ خالص است
      //    پول می‌گیری AND در سررسید strike × sz نصیبت می‌شود
      var isArbitrage = total <= 0;
      var pnl = (call.strike - perShareCost) * sz;
      var base = total > 0 ? total : Math.max(Math.abs(total), sz);
      var roi = roiCalc(pnl, base);
      function payoff() { return roi; }
      results.push({
        call_name: call.name, put_name: put.name, basis_name: call.basis_name,
        strike: call.strike, k_call: call.strike, k_put: put.strike,
        expiry: call.expiry, dte: call.dte, size: sz,
        bid_vol: call.bid_vol, bid_price: call.bid_price, ask_vol: put.ask_vol, ask_price: put.ask_price,
        spot: call.spot, trade_value_put: Math.round(put.tvalue), trade_value_call: Math.round(call.tvalue),
        margin: 0, break_even: Math.round(perShareCost), max_profit: Math.round(pnl), max_loss: null,
        roi_zero: Math.round(roi * 100) / 100,
        is_arbitrage: isArbitrage,
        net_cost: Math.round(total),
        scenariosAdjusted: [adjustRoi(roi, call.dte)],
        scenariosRaw: [roi],
        basis_buyable: (call.basis_buyable !== false) && (put.basis_buyable !== false),
        spot_overridden: call.spot_overridden, spot_original: call.spot_original,
        _payoff: payoff
      });
    });
  });
  results.sort(function (a, b) { return b.roi_zero - a.roi_zero; });
  return results;
}

function calcStrangleBuy(calls, puts, steps) {
  var byGroup = {};
  calls.forEach(function (c) {
    if (canBuyOpt(c)) {
      // ✅ گروه‌بندی بر اساس expiry (نه dte)
      var key = c.basis_name + "|" + c.expiry;
      if (!byGroup[key]) byGroup[key] = [];
      byGroup[key].push(c);
    }
  });
  var results = [];
  puts.forEach(function (put) {
    if (!canBuyOpt(put) || put.dte <= 0) return;
    var group = byGroup[put.basis_name + "|" + put.expiry];
    if (!group) return;
    group.forEach(function (call) {
      // ✅ چک یکسانی سررسید و اندازه
      if (call.expiry !== put.expiry) return;
      if (call.size !== put.size) return;
      var sz = call.size;
      var totalCost = (put.ask_price + call.ask_price) * sz;
      if (totalCost <= 0) return;
      function payoff(pct) {
        var future = call.spot * (1 + pct / 100);
        var val = (Math.max(future - call.strike, 0) + Math.max(put.strike - future, 0)) * sz;
        return roiCalc(val - totalCost, totalCost);
      }
      var zero = payoff(0);
      var type = call.strike === put.strike ? "استرادل" : call.strike > put.strike ? "استرانگل" : "گاتس";
      results.push({
        put_name: put.name, call_name: call.name, basis_name: call.basis_name,
        k_put: put.strike, k_call: call.strike,
        put_ask_vol: put.ask_vol, put_ask_price: put.ask_price, put_tvalue: Math.round(put.tvalue),
        call_ask_vol: call.ask_vol, call_ask_price: call.ask_price, call_tvalue: Math.round(call.tvalue),
        expiry: call.expiry, dte: call.dte, size: sz, spot: call.spot,
        total_cost: Math.round(totalCost), roi_zero: Math.round(zero * 100) / 100,
        scenariosAdjusted: steps.map(function (p) { return adjustRoi(payoff(p), call.dte); }),
        scenariosRaw: steps.map(function (p) { return payoff(p); }),
        strangle_type: type,
        basis_buyable: (put.basis_buyable !== false) && (call.basis_buyable !== false),
        spot_overridden: call.spot_overridden, spot_original: call.spot_original,
        _payoff: payoff
      });
    });
  });
  results.sort(function (a, b) { return b.roi_zero - a.roi_zero; });
  return results;
}

function calcStrangleSell(calls, puts, steps) {
  var byGroup = {};
  calls.forEach(function (c) {
    if (canSellOpt(c)) {
      // ✅ گروه‌بندی بر اساس expiry (نه dte)
      var key = c.basis_name + "|" + c.expiry;
      if (!byGroup[key]) byGroup[key] = [];
      byGroup[key].push(c);
    }
  });
  var results = [];
  puts.forEach(function (put) {
    if (!canSellOpt(put) || put.dte <= 0) return;
    var group = byGroup[put.basis_name + "|" + put.expiry];
    if (!group) return;
    group.forEach(function (call) {
      // ✅ چک یکسانی سررسید و اندازه
      if (call.expiry !== put.expiry) return;
      if (call.size !== put.size) return;
      var sz = call.size;
      var totalPremium = call.bid_price * sz + put.bid_price * sz;
      var m1 = call.margin || 0, m2 = put.margin || 0;
      if (m1 <= 0 || m2 <= 0) return;
      var pMinBasis = (m1 <= m2) ? call.price : put.price;
      var margin = Math.max(m1, m2) + (pMinBasis || 0) * sz;
      if (margin <= 0) return;
      function payoff(pct) {
        var future = call.spot * (1 + pct / 100);
        var optVal = (Math.max(future - call.strike, 0) + Math.max(put.strike - future, 0)) * sz;
        return roiCalc(totalPremium - optVal, margin);
      }
      var zero = payoff(0);
      var type = call.strike === put.strike ? "استرادل" : call.strike > put.strike ? "استرانگل" : "گاتس";
      results.push({
        put_name: put.name, call_name: call.name, basis_name: call.basis_name,
        k_put: put.strike, k_call: call.strike,
        put_bid_vol: put.bid_vol, put_bid_price: put.bid_price, put_tvalue: Math.round(put.tvalue), put_margin: Math.round(m2),
        call_bid_vol: call.bid_vol, call_bid_price: call.bid_price, call_tvalue: Math.round(call.tvalue), call_margin: Math.round(m1),
        expiry: call.expiry, dte: call.dte, size: sz, spot: call.spot,
        margin: Math.round(margin), roi_zero: Math.round(zero * 100) / 100,
        scenariosAdjusted: steps.map(function (p) { return adjustRoi(payoff(p), call.dte); }),
        scenariosRaw: steps.map(function (p) { return payoff(p); }),
        strangle_type: type,
        basis_buyable: (put.basis_buyable !== false) && (call.basis_buyable !== false),
        spot_overridden: call.spot_overridden, spot_original: call.spot_original,
        _payoff: payoff
      });
    });
  });
  results.sort(function (a, b) { return b.roi_zero - a.roi_zero; });
  return results;
}

function calcCallSpread(calls, steps, bull) {
  var byGroup = {};
  calls.forEach(function (c) {
    // ✅ گروه‌بندی بر اساس expiry (نه dte)
    var key = c.basis_name + "|" + c.expiry;
    if (!byGroup[key]) byGroup[key] = [];
    byGroup[key].push(c);
  });
  var results = [];
  Object.keys(byGroup).forEach(function (key) {
    var arr = byGroup[key];
    for (var i = 0; i < arr.length; i++) {
      for (var j = 0; j < arr.length; j++) {
        if (i === j) continue;
        var buy = arr[i], sell = arr[j];
        if (buy.strike === sell.strike) continue;
        // ✅ چک یکسانی سررسید و اندازه
        if (buy.expiry !== sell.expiry) continue;
        if (buy.size !== sell.size) continue;
        var isBull = buy.strike < sell.strike;
        if (isBull !== bull) continue;
        if (!canBuyOpt(buy) || !canSellOpt(sell)) continue;
        var sz = buy.size;
        var netCost = buy.ask_price - sell.bid_price;
        var width = Math.abs(buy.strike - sell.strike);
        // ✅ آربیتراژ credit spread را دیگر فیلتر نمی‌کنیم
        var isArbitrage = netCost < 0 && Math.abs(netCost) > width;
        // اسپرد بدهی (netCost > 0): مبنا = بدهی پرداختی
        // اسپرد اعتباری (netCost < 0، معمول): مبنا = حداکثر زیان = عرض − |credit|
        // آربیتراژ: هیچ capital درگیری نیست؛ از width استفاده می‌کنیم
        var rawBase = netCost > 0 ? netCost * sz : Math.abs((width + netCost)) * sz;
        var base = rawBase > 0 ? rawBase : width * sz;
        // ✅ وجه تضمین: برای اسپرد اعتباری (netCost < 0) = max loss = width − credit
        //    برای اسپرد بدهی (netCost > 0) = صفر
        var margin = netCost < 0 ? Math.max(0, (width + netCost) * sz) : 0;
        (function (buy, sell, sz, netCost, base, margin) {
          function payoff(pct) {
            var future = buy.spot * (1 + pct / 100);
            var val = (Math.max(future - buy.strike, 0) - Math.max(future - sell.strike, 0)) * sz;
            return roiCalc(val - netCost * sz, base);
          }
          var zero = payoff(0);
          results.push({
            buy_name: buy.name, sell_name: sell.name, basis_name: buy.basis_name,
            k_buy: buy.strike, k_sell: sell.strike,
            buy_ask_vol: buy.ask_vol, buy_ask_price: buy.ask_price, buy_tvalue: Math.round(buy.tvalue),
            sell_bid_vol: sell.bid_vol, sell_bid_price: sell.bid_price, sell_tvalue: Math.round(sell.tvalue),
            expiry: buy.expiry, dte: buy.dte, size: sz, spot: buy.spot,
            base: Math.round(base), roi_zero: Math.round(zero * 100) / 100,
            margin: Math.round(margin),
            net_credit: netCost < 0 ? Math.round(-netCost * sz) : null,
            net_cost: Math.round(netCost * sz),
            is_arbitrage: isArbitrage,
            scenariosAdjusted: steps.map(function (p) { return adjustRoi(payoff(p), buy.dte); }),
            scenariosRaw: steps.map(function (p) { return payoff(p); }),
            basis_buyable: (buy.basis_buyable !== false) && (sell.basis_buyable !== false),
            spot_overridden: buy.spot_overridden, spot_original: buy.spot_original,
            _payoff: payoff
          });
        })(buy, sell, sz, netCost, base, margin);
      }
    }
  });
  results.sort(function (a, b) { return b.roi_zero - a.roi_zero; });
  return results;
}

function calcPutSpread(puts, steps, bull) {
  var byGroup = {};
  puts.forEach(function (c) {
    // ✅ گروه‌بندی بر اساس expiry (نه dte)
    var key = c.basis_name + "|" + c.expiry;
    if (!byGroup[key]) byGroup[key] = [];
    byGroup[key].push(c);
  });
  var results = [];
  Object.keys(byGroup).forEach(function (key) {
    var arr = byGroup[key];
    for (var i = 0; i < arr.length; i++) {
      for (var j = 0; j < arr.length; j++) {
        if (i === j) continue;
        var buy = arr[i], sell = arr[j];
        if (buy.strike === sell.strike) continue;
        if (buy.expiry !== sell.expiry) continue;
        if (buy.size !== sell.size) continue;
        var isBull = buy.strike < sell.strike;
        if (isBull !== bull) continue;
        if (!canBuyOpt(buy) || !canSellOpt(sell)) continue;
        var sz = buy.size;
        var netCost = buy.ask_price - sell.bid_price;
        var width = Math.abs(buy.strike - sell.strike);
        var isArbitrage = netCost < 0 && Math.abs(netCost) > width;
        var rawBase = netCost > 0 ? netCost * sz : Math.abs((width + netCost)) * sz;
        var base = rawBase > 0 ? rawBase : width * sz;
        // ✅ وجه تضمین: برای اسپرد اعتباری (netCost < 0) = max loss = width − credit
        //    برای اسپرد بدهی (netCost > 0) = صفر
        var margin = netCost < 0 ? Math.max(0, (width + netCost) * sz) : 0;
        (function (buy, sell, sz, netCost, base, margin) {
          function payoff(pct) {
            var future = buy.spot * (1 + pct / 100);
            var val = (Math.max(buy.strike - future, 0) - Math.max(sell.strike - future, 0)) * sz;
            return roiCalc(val - netCost * sz, base);
          }
          var zero = payoff(0);
          results.push({
            buy_name: buy.name, sell_name: sell.name, basis_name: buy.basis_name,
            k_buy: buy.strike, k_sell: sell.strike,
            buy_ask_vol: buy.ask_vol, buy_ask_price: buy.ask_price, buy_tvalue: Math.round(buy.tvalue),
            sell_bid_vol: sell.bid_vol, sell_bid_price: sell.bid_price, sell_tvalue: Math.round(sell.tvalue),
            expiry: buy.expiry, dte: buy.dte, size: sz, spot: buy.spot,
            base: Math.round(base), roi_zero: Math.round(zero * 100) / 100,
            margin: Math.round(margin),
            net_credit: netCost < 0 ? Math.round(-netCost * sz) : null,
            net_cost: Math.round(netCost * sz),
            is_arbitrage: isArbitrage,
            scenariosAdjusted: steps.map(function (p) { return adjustRoi(payoff(p), buy.dte); }),
            scenariosRaw: steps.map(function (p) { return payoff(p); }),
            basis_buyable: (buy.basis_buyable !== false) && (sell.basis_buyable !== false),
            spot_overridden: buy.spot_overridden, spot_original: buy.spot_original,
            _payoff: payoff
          });
        })(buy, sell, sz, netCost, base, margin);
      }
    }
  });
  results.sort(function (a, b) { return b.roi_zero - a.roi_zero; });
  return results;
}

function calcBox(calls, puts, direction) {
  var callMap = {}, putMap = {}, groupStrikes = {};
  calls.forEach(function (c) {
    var gk = c.basis_name + "|" + c.expiry;
    callMap[gk + "|" + c.strike] = c;
    if (!groupStrikes[gk]) groupStrikes[gk] = [];
    if (groupStrikes[gk].indexOf(c.strike) === -1) groupStrikes[gk].push(c.strike);
  });
  puts.forEach(function (p) {
    putMap[p.basis_name + "|" + p.expiry + "|" + p.strike] = p;
  });
  var results = [];
  Object.keys(groupStrikes).forEach(function (gk) {
    var strikes = groupStrikes[gk];
    for (var i = 0; i < strikes.length; i++) {
      for (var j = 0; j < strikes.length; j++) {
        if (i === j) continue;
        var k1 = strikes[i], k2 = strikes[j];
        if (k1 >= k2) continue;
        var callK1 = callMap[gk + "|" + k1];
        var callK2 = callMap[gk + "|" + k2];
        var putK1  = putMap[gk + "|" + k1];
        var putK2  = putMap[gk + "|" + k2];
        if (!callK1 || !callK2 || !putK1 || !putK2) continue;
        var sz = callK1.size;
        if (callK2.size !== sz || putK1.size !== sz || putK2.size !== sz) continue;
        if (callK1.expiry !== callK2.expiry ||
            callK1.expiry !== putK1.expiry ||
            callK1.expiry !== putK2.expiry) continue;

        var width = (k2 - k1) * sz;
        var basisBuyable = (callK1.basis_buyable !== false) && (callK2.basis_buyable !== false) &&
                            (putK1.basis_buyable !== false) && (putK2.basis_buyable !== false);
        var spotOverridden = callK1.spot_overridden;
        var spotOriginal = callK1.spot_original;
        var dteVal = callK1.dte;
        var expiryVal = callK1.expiry;
        var spotVal = callK1.spot;
        var basisName = callK1.basis_name;

        // ====== Buy Box (Long Box) ======
        // Bull Call Spread + Bear Put Spread → هر دو debit → margin = 0
        if (direction === "buy" &&
            canBuyOpt(callK1) && canSellOpt(callK2) && canBuyOpt(putK2) && canSellOpt(putK1)) {
          var buyNetCost = (callK1.ask_price - callK2.bid_price) + (putK2.ask_price - putK1.bid_price);
          var buyTotalCost = buyNetCost * sz;
          var buyProfit = width - buyTotalCost;
          if (buyProfit > 0) {
            var buyBase = buyTotalCost > 0 ? buyTotalCost : Math.max(Math.abs(buyTotalCost), sz);
            var buyRoi = roiCalc(buyProfit, buyBase);
            var buyAdjRoi = adjustRoi(buyRoi, dteVal);
            results.push({
              call_buy_name: callK1.name, call_sell_name: callK2.name,
              put_buy_name: putK2.name, put_sell_name: putK1.name,
              basis_name: basisName, k1: k1, k2: k2,
              call_buy_ask_vol: callK1.ask_vol, call_buy_ask_price: callK1.ask_price, call_buy_tvalue: Math.round(callK1.tvalue),
              call_sell_bid_vol: callK2.bid_vol, call_sell_bid_price: callK2.bid_price, call_sell_tvalue: Math.round(callK2.tvalue),
              put_buy_ask_vol: putK2.ask_vol, put_buy_ask_price: putK2.ask_price, put_buy_tvalue: Math.round(putK2.tvalue),
              put_sell_bid_vol: putK1.bid_vol, put_sell_bid_price: putK1.bid_price, put_sell_tvalue: Math.round(putK1.tvalue),
              expiry: expiryVal, dte: dteVal, size: sz, spot: spotVal,
              net_cost: Math.round(buyTotalCost),
              net_credit: null,
              base: Math.round(buyBase),
              fixed_profit: Math.round(buyProfit),
              margin: 0,
              rom: null,
              roi_zero: Math.round(buyRoi * 100) / 100,
              is_arbitrage: buyTotalCost <= 0,
              scenariosAdjusted: [buyAdjRoi], scenariosRaw: [buyRoi],
              basis_buyable: basisBuyable,
              spot_overridden: spotOverridden, spot_original: spotOriginal,
              _payoff: (function (v) { return function () { return v; }; })(buyRoi)
            });
          }
        }

        // ====== Sell Box (Short Box) ======
        // Bear Call Spread + Bull Put Spread → هر دو credit spread → margin لازم است
        // margin بدترین حالت (اگر کارگزاری دو اسپرد را جدا حساب کند): 2W − C'
        // margin بهترین حالت (اگر باکس را به‌عنوان یک ترکیب واحد بشناسد): max(0, W − C')
        if (direction === "sell" &&
            canSellOpt(callK1) && canBuyOpt(callK2) && canSellOpt(putK2) && canBuyOpt(putK1)) {
          var sellNetCredit = (callK1.bid_price - callK2.ask_price) + (putK2.bid_price - putK1.ask_price);
          var sellTotalCredit = sellNetCredit * sz;
          var sellProfit = sellTotalCredit - width;
          if (sellProfit > 0) {
            // محافظه‌کارانه: فرض می‌کنیم کارگزاری دو اسپرد را جدا حساب می‌کند
            var sellMargin = Math.max(0, 2 * width - sellTotalCredit);
            // ✅ مبنای ROI = margin واقعی (نه credit)
            //    اگر margin صفر باشه (آربیتراژ خالص)، از width استفاده می‌کنیم
            var sellBase = sellMargin > 0 ? sellMargin : width;
            var sellRoi = roiCalc(sellProfit, sellBase);
            var sellRoiOnMargin = sellMargin > 0 ? roiCalc(sellProfit, sellMargin) : null;
            // ✅ ROI روی width هم به‌عنوان بازده «بازارساز» محاسبه و ذخیره کن
            var sellRoiOnWidth = width > 0 ? roiCalc(sellProfit, width) : sellRoi;
            var sellAdjRoi = adjustRoi(sellRoi, dteVal);
            results.push({
              call_buy_name: callK2.name, call_sell_name: callK1.name,
              put_buy_name: putK1.name, put_sell_name: putK2.name,
              basis_name: basisName, k1: k1, k2: k2,
              call_buy_ask_vol: callK2.ask_vol, call_buy_ask_price: callK2.ask_price, call_buy_tvalue: Math.round(callK2.tvalue),
              call_sell_bid_vol: callK1.bid_vol, call_sell_bid_price: callK1.bid_price, call_sell_tvalue: Math.round(callK1.tvalue),
              put_buy_ask_vol: putK1.ask_vol, put_buy_ask_price: putK1.ask_price, put_buy_tvalue: Math.round(putK1.tvalue),
              put_sell_bid_vol: putK2.bid_vol, put_sell_bid_price: putK2.bid_price, put_sell_tvalue: Math.round(putK2.tvalue),
              expiry: expiryVal, dte: dteVal, size: sz, spot: spotVal,
              net_cost: null,
              net_credit: Math.round(sellTotalCredit),
              base: Math.round(sellBase),
              fixed_profit: Math.round(sellProfit),
              margin: Math.round(sellMargin),
              rom: sellRoiOnMargin == null ? null : Math.round(sellRoiOnMargin * 100) / 100,
              roi_zero: Math.round(sellRoi * 100) / 100,
              is_arbitrage: sellTotalCredit > width,
              scenariosAdjusted: [sellAdjRoi], scenariosRaw: [sellRoi],
              basis_buyable: basisBuyable,
              spot_overridden: spotOverridden, spot_original: spotOriginal,
              _payoff: (function (v) { return function () { return v; }; })(sellRoi)
            });
          }
        }
      }
    }
  });
  results.sort(function (a, b) { return b.roi_zero - a.roi_zero; });
  return results;
}

function computeAll(calls, puts, steps) {
  return {
    cc: calcCC(calls, steps),
    mp: calcMP(puts, steps),
    co: calcCollar(calls, puts, steps),
    cv: calcConversion(calls, puts),
    strangle: calcStrangleBuy(calls, puts, steps),
    strangleSell: calcStrangleSell(calls, puts, steps),
    callspread: calcCallSpread(calls, steps, true),
    callspreadbear: calcCallSpread(calls, steps, false),
    putspread: calcPutSpread(puts, steps, false),
    putspreadbull: calcPutSpread(puts, steps, true),
    box: calcBox(calls, puts, "buy"),
    boxSell: calcBox(calls, puts, "sell")
  };
}

function stripInternal(row) {
  if (!row) return row;
  var copy = Object.assign({}, row);
  delete copy._payoff;
  return copy;
}

module.exports = {
  buildSteps: buildSteps,
  computeAll: computeAll,
  stripInternal: stripInternal
};