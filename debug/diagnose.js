// debug/diagnose.js
// اجرا: node debug/diagnose.js [contract_name]
// مثال: node debug/diagnose.js ضملت7044
"use strict";
require("dotenv").config();
var path = require("path");
var crypto = require("crypto");
var mongoose = require("mongoose");

var { connectDB } = require("../backend/src/db");
var CacheSnapshot = require("../backend/src/models/CacheSnapshot");
var DebugTick = require("../backend/src/models/DebugTick");

var TARGET_URL = "https://s3.optionschool24.com/last?type=3";

function jdump(o) {
  return JSON.stringify(o, null, 2);
}

async function fetchFresh() {
  console.log("\n→ Fetching fresh from", TARGET_URL);
  var t0 = Date.now();
  var controller = new AbortController();
  var to = setTimeout(function () { controller.abort(); }, 20000);
  try {
    var res = await fetch(TARGET_URL, { signal: controller.signal });
    var txt = await res.text();
    var t1 = Date.now();
    console.log("  HTTP " + res.status + " in " + (t1 - t0) + "ms, " + txt.length + " bytes");
    try {
      return { json: JSON.parse(txt), rawText: txt, ms: t1 - t0 };
    } catch (e) {
      console.error("  ✗ JSON parse error:", e.message);
      console.error("  First 800 chars:\n" + txt.slice(0, 800));
      return null;
    }
  } catch (e) {
    console.error("  ✗ Fetch error:", e.message);
    return null;
  } finally {
    clearTimeout(to);
  }
}

function findContractInRaw(arr, name) {
  if (!Array.isArray(arr)) return null;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].name === name) return arr[i];
  }
  return null;
}

function printContractSummary(label, c) {
  console.log("\n  --- " + label + " ---");
  if (!c) { console.log("    (یافت نشد)"); return; }
  console.log("    name       :", c.name);
  console.log("    expiry     :", c.expiry || c.to_date);
  console.log("    strike     :", c.strike || c.emal);
  console.log("    spot       :", c.spot);
  console.log("    type       :", c.type);
  console.log("    ask_price  :", c.ask_price);
  console.log("    ask_vol    :", c.ask_vol);
  console.log("    bid_price  :", c.bid_price);
  console.log("    bid_vol    :", c.bid_vol);
  console.log("    final      :", c.price);
  console.log("    tvalue     :", c.tvalue);
  if (c._raw) {
    console.log("    raw.s_price  :", c._raw.s_price);
    console.log("    raw.s_volume :", c._raw.s_volume);
    console.log("    raw.b_price  :", c._raw.b_price);
    console.log("    raw.b_volume :", c._raw.b_volume);
    console.log("    raw.final    :", c._raw.final);
    console.log("    raw.close    :", c._raw.close);
    console.log("    raw.Tvalue   :", c._raw.Tvalue);
    console.log("    raw.basis_c  :", c._raw.basis_c);
    console.log("    raw.basis_c_percent :", c._raw.basis_c_percent);
    console.log("    raw.basis_percent   :", c._raw.basis_percent);
  }
}

async function main() {
  await connectDB(process.env.MONGODB_URI);
  console.log("✔ MongoDB connected");

  var targetName = process.argv[2] || null;

  // 1) کش فعلی در دیتابیس
  var snap = await CacheSnapshot.findOne({ ownerId: "default" }).lean();
  if (!snap) {
    console.log("⚠ هیچ CacheSnapshot یافت نشد — سرور را یک‌بار اجرا کن تا snapshot ساخته شود");
    process.exit(0);
  }
  console.log("\n=== CacheSnapshot (آخرین وضعیت سرور) ===");
  console.log("  updatedAt  :", snap.updatedAt);
  console.log("  watch count:", (snap.watch || []).length);
  console.log("  hunt rows  :", ((snap.huntLatest || {}).rows || []).length);

  // 2) پاسخ تازه API
  var fresh = await fetchFresh();
  if (!fresh) {
    console.log("\n✗ API پاسخ نداد — احتمالاً مشکل شبکه یا API down است");
    process.exit(1);
  }
  var arr = Array.isArray(fresh.json) ? fresh.json : (fresh.json && fresh.json.data) || [];
  var hash = crypto.createHash("md5").update(JSON.stringify(arr)).digest("hex");
  console.log("\n=== پاسخ تازه API ===");
  console.log("  rows :", arr.length);
  console.log("  hash :", hash);
  console.log("  size :", fresh.rawText.length, "bytes");
  console.log("  ms   :", fresh.ms);
  if (arr.length > 0) {
    console.log("\n  --- نمونه ردیف اول خام ---");
    console.log(jdump(arr[0]).slice(0, 2500));
  }

  // 3) مقایسه کش با API تازه
  console.log("\n=== مقایسه کش فعلی با API تازه (۵ قرارداد نمونه) ===");
  var cacheRows = snap.watch || [];
  var sampleN = Math.min(5, cacheRows.length);
  var fieldsToCompare = [
    ["ask_price", "s_price"],
    ["ask_vol", "s_volume"],
    ["bid_price", "b_price"],
    ["bid_vol", "b_volume"],
    ["price", "final"]
  ];
  for (var i = 0; i < sampleN; i++) {
    var cr = cacheRows[i];
    var fr = findContractInRaw(arr, cr.name);
    console.log("\n  • " + cr.name + "  |  expiry=" + cr.expiry);
    fieldsToCompare.forEach(function (pair) {
      var cacheV = cr[pair[0]];
      var freshRaw = fr && fr[pair[1]];
      var flag = (cacheV != freshRaw) ? "  ⚠️ MISMATCH" : "";
      console.log("      " + pair[0] + ": cache=" + cacheV + "   fresh." + pair[1] + "=" + freshRaw + flag);
    });
  }

  // 4) اگر نام قرارداد داده شده، فقط همان را با جزئیات کامل
  if (targetName) {
    console.log("\n\n======== بررسی دقیق قرارداد: " + targetName + " ========");
    var cached = cacheRows.find(function (c) { return c.name === targetName; });
    var freshRow = findContractInRaw(arr, targetName);
    printContractSummary("در cache دیتابیس", cached);
    printContractSummary("در پاسخ تازه API (خام)", freshRow);

    if (cached && cached._raw && freshRow) {
      console.log("\n  --- مقایسه‌ی فیلد به فیلد raw ---");
      var keys = Object.keys(freshRow);
      var diffs = [];
      keys.forEach(function (k) {
        var cv = cached._raw[k];
        var fv = freshRow[k];
        if (JSON.stringify(cv) !== JSON.stringify(fv)) {
          diffs.push({ key: k, cache: cv, fresh: fv });
        }
      });
      if (diffs.length === 0) {
        console.log("    ✓ همه‌ی فیلدها یکسان‌اند (API از آخرین snapshot تغییر نکرده)");
      } else {
        console.log("    ✗ " + diffs.length + " فیلد متفاوت:");
        diffs.forEach(function (d) {
          console.log("      " + d.key + ":");
          console.log("         cache = " + JSON.stringify(d.cache));
          console.log("         fresh = " + JSON.stringify(d.fresh));
        });
      }
    }
  }

  // 5) آخرین ۱۰ تیک دیباگ
  var ticks = await DebugTick.find({}).sort({ at: -1 }).limit(10).lean();
  console.log("\n\n=== آخرین " + ticks.length + " تیک دیباگ ===");
  if (ticks.length === 0) {
    console.log("  (هیچ تیکی ثبت نشده — مطمئن شو settings.debugCollectEnabled فعال است)");
  } else {
    ticks.forEach(function (t, i) {
      console.log("  [" + i + "] at=" + t.at.toISOString() +
        "  kind=" + (t.kind || "auto") +
        "  apiRows=" + (t.apiRowCount || 0) +
        "  apiHash=" + (t.apiHash || "-") +
        "  fetchMs=" + (t.apiFetchMs || "-") +
        "  err=" + (t.lastError || "-"));
    });
  }

  // 6) بررسی تازگی: آیا hash API در طول ۱۰ دقیقه‌ی اخیر تغییر کرده؟
  var recentTicks = await DebugTick.find({
    at: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
    apiHash: { $ne: null }
  }).sort({ at: -1 }).limit(50).lean();

  console.log("\n=== تحلیل تازگی API (۱۰ دقیقه اخیر) ===");
  if (recentTicks.length < 2) {
    console.log("  تعداد تیک کافی نیست برای تحلیل تازگی");
  } else {
    var uniqueHashes = {};
    recentTicks.forEach(function (t) { uniqueHashes[t.apiHash] = true; });
    var uhCount = Object.keys(uniqueHashes).length;
    console.log("  تعداد تیک‌ها: " + recentTicks.length);
    console.log("  هش‌های یکتا: " + uhCount);
    if (uhCount === 1) {
      console.log("  ⚠️⚠️⚠️  API پاسخ یکسان داده در تمام تیک‌ها!");
      console.log("     یعنی API در حال سرو کردن داده‌ی stale است.");
    } else {
      console.log("  ✓ API در حال به‌روزرسانی است (" + uhCount + " نسخه‌ی متفاوت)");
    }
  }

  console.log("\n✔ Done");
  await mongoose.connection.close();
  process.exit(0);
}

main().catch(function (e) {
  console.error("\n✗ Fatal:", e);
  process.exit(1);
});