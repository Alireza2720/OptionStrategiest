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
function fmtSigned(v, d, unit) {
  if (v == null || isNaN(v)) return "—";
  if (v >= 99999) return "∞";
  var sign = v > 0 ? "+" : "";
  return sign + fmt(v, d) + (unit || "");
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatRow(r, steps, opts) {
  opts = opts || {};
  var isExit = !!opts.isExit;
  var lines = [];

  var headerEmoji = isExit ? "🔕" : "🔔";
  var headerLabel = isExit ? "موقعیت از دست رفته" : "موقعیت جدید";
  lines.push(headerEmoji + " <b>" + headerLabel + " · " + (LABELS[r.strategy_type] || r.strategy_type) + "</b>" + (r.is_straddle ? " (استرادل)" : ""));
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");

  lines.push("📌 <b>موقعیت</b>");
  (r.legs || []).forEach(function (leg) {
    var lbl = leg.label ? leg.label + ": " : "";
    var nameHtml = "<code>" + escapeHtml(leg.name) + "</code>";
    if (isExit) nameHtml = "<s>" + nameHtml + "</s>";
    var priceStr = (leg.price != null && leg.price > 0) ? "  ·  سرخط: <b>" + fmt(leg.price, 0) + "</b>" : "";
    lines.push("   • " + lbl + nameHtml + priceStr);
  });
  lines.push("   • سهم پایه: <b>" + escapeHtml(r.basis_name || "") + "</b>");
  lines.push("   • سررسید: " + escapeHtml(String(r.expiry || "")) + "  ·  " + (r.dte != null ? r.dte + " روز" : "—"));

  // برای استراتژی‌های سهم‌محور، درصد آخرین و پایانی سهم پایه
  if (["cc", "mp", "co", "cv"].indexOf(r.strategy_type) !== -1) {
    if (r.basis_last_percent != null && !isNaN(r.basis_last_percent)) {
      lines.push("   • درصد آخرین سهم پایه: <b>" + fmtSigned(r.basis_last_percent, 2, "٪") + "</b>");
    }
    if (r.basis_close_percent != null && !isNaN(r.basis_close_percent)) {
      lines.push("   • درصد پایانی سهم پایه: <b>" + fmtSigned(r.basis_close_percent, 2, "٪") + "</b>");
    }
  }

  var scenRaw = r.scenariosRaw || [];

  if (NO_SHOCK_TYPES[r.strategy_type]) {
    lines.push("");
    lines.push("📊 <b>بازده (ثابت)</b>");
    var val = scenRaw.find(function (v) { return v != null; });
    lines.push("   " + fmtSigned(val, 1, "٪"));
  } else if (r.strategy_type === "strangle" && r.is_straddle === false) {
    // استرانگل خرید (شامل استرانگل و گاتس، نه استرادل)
    lines.push("");
    lines.push("📊 <b>کف سود/زیان قبل از نوسان</b>");
    lines.push("   " + fmtSigned(r.min_pnl, 1, "٪"));
    lines.push("");
    lines.push("🛡 <b>حداکثر نوسان لازم</b>");
    lines.push("   ↗ مثبت: <b>" + fmtSigned(r.actual_shock_up, 1, "٪") + "</b>");
    lines.push("   ↘ منفی: <b>-" + fmt(r.actual_shock_down, 1) + "٪</b>");
  } else if (r.strategy_type === "strangle" && r.is_straddle === true) {
    // استرادل خرید
    lines.push("");
    lines.push("📊 <b>کف سود/زیان قبل از نوسان</b>");
    lines.push("   " + fmtSigned(r.min_pnl, 1, "٪"));
    lines.push("");
    lines.push("🛡 <b>حداکثر نوسان لازم</b>");
    lines.push("   ↗ مثبت: <b>" + fmtSigned(r.actual_shock_up, 1, "٪") + "</b>");
    lines.push("   ↘ منفی: <b>-" + fmt(r.actual_shock_down, 1) + "٪</b>");
  } else {
    // cc, mp, co, cv, strangleSell, callspread, callspreadbear, putspread, putspreadbull, box
    lines.push("");
    lines.push("📊 <b>سناریوها</b>");
    if (steps && scenRaw.length > 0) {
      scenRaw.forEach(function (v, i) {
        if (v == null) return;
        var stepPct = steps[i];
        if (stepPct == null) return;
        lines.push("   ▸ <b>" + fmtSigned(stepPct, 1, "٪") + "</b>  →  " + fmtSigned(v, 1, "٪"));
      });
    }
    lines.push("");
    lines.push("🛡 <b>نوسان مجاز</b>");
    lines.push("   ↗ مثبت: <b>" + fmtSigned(r.actual_shock_up, 1, "٪") + "</b>");
    lines.push("   ↘ منفی: <b>-" + fmt(r.actual_shock_down, 1) + "٪</b>");
  }

  if (BUYABLE_CHECK_TYPES[r.strategy_type]) {
    lines.push("");
    lines.push(r.basis_buyable === false ? "⚠️ سهم پایه در صف خرید است" : "✅ سهم پایه قابل خرید است");
  }

  if (isExit) {
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("🔕 <b>موقعیت شکار شده از دست رفت</b>");
  }

  return lines.join("\n");
}

module.exports = { formatRow: formatRow };