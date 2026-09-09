"use strict";

var LABELS = {
  cc: "کاوردکال", mp: "مریدپوت", co: "کلار", cv: "کانورژن",
  strangle: "استرانگل خرید", strangleSell: "استرانگل فروش",
  callspread: "کال اسپرد صعودی", callspreadbear: "کال اسپرد نزولی",
  putspread: "پوت اسپرد نزولی", putspreadbull: "پوت اسپرد صعودی",
  box: "باکس"
};
var NO_SHOCK_TYPES = { cv: true, box: true };
var BUYABLE_CHECK_TYPES = { cc: true, mp: true, co: true, cv: true };

function fmt(v, d) {
  if (v == null || isNaN(v)) return "—";
  if (v >= 99999) return "∞";
  if (d === undefined) d = 1;
  return Number(v).toFixed(d);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// هر پایه با تگ <code> جدا می‌شود تا در تلگرام هرکدام مستقل قابل کپی باشد
function formatLegs(legs) {
  if (!legs || legs.length === 0) return "";
  return legs.map(function (leg) {
    var lbl = leg.label ? leg.label + ": " : "";
    return lbl + "<code>" + escapeHtml(leg.name) + "</code>";
  }).join("   ");
}

function formatRow(r, steps) {
  var lines = [];
  lines.push("🎯 <b>" + (LABELS[r.strategy_type] || r.strategy_type) + "</b>" + (r.is_straddle ? " (استرادل)" : ""));
  lines.push("موقعیت: " + formatLegs(r.legs));
  lines.push("سهم پایه: " + r.basis_name + "  |  سررسید: " + r.expiry + " (" + r.dte + " روز)");

  var scenRaw = r.scenariosRaw || [];
  if (NO_SHOCK_TYPES[r.strategy_type]) {
    var val = scenRaw.find(function (v) { return v != null; });
    lines.push("بازده (ثابت): " + fmt(val) + "٪");
  } else if (r.is_straddle) {
    lines.push("سود/زیان قبل از نوسان: " + fmt(r.roi_zero) + "٪");
    lines.push("نوسان منفی لازم: " + fmt(r.actual_shock_down) + "٪  |  نوسان مثبت لازم: " + fmt(r.actual_shock_up) + "٪");
  } else {
    var parts = scenRaw.map(function (v, i) {
      if (v == null) return null;
      var stepPct = steps && steps[i] != null ? steps[i] : null;
      var stepStr = stepPct != null ? ("تغییر " + (stepPct > 0 ? "+" : "") + fmt(stepPct, 1) + "٪: ") : "";
      return stepStr + fmt(v) + "٪";
    }).filter(Boolean);
    lines.push("سناریوهای واقعی: " + parts.join(" | "));
    lines.push("حداکثر نوسان مثبت مجاز: " + fmt(r.actual_shock_up) + "٪  |  حداکثر نوسان منفی مجاز: " + fmt(r.actual_shock_down) + "٪");
  }

  if (BUYABLE_CHECK_TYPES[r.strategy_type]) {
    lines.push(r.basis_buyable === false ? "⚠️ سهم پایه در صف خرید است" : "✅ سهم پایه قابل خرید است");
  }
  return lines.join("\n");
}

function formatBatch(rows, steps) {
  var header = "🔔 " + rows.length + " موقعیت جدید در «شکار موقعیت‌ها» پیدا شد:\n\n";
  var body = rows.map(function (r) { return formatRow(r, steps); }).join("\n\n———\n\n");
  return header + body;
}

module.exports = { formatRow: formatRow, formatBatch: formatBatch };