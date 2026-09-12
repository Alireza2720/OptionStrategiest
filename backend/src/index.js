"use strict";
require("dotenv").config();
var express = require("express");
var cors = require("cors");
var rateLimit = require("express-rate-limit");

var { connectDB } = require("./db");
var Settings = require("./models/Settings");
var apiRouter = require("./routes/api");
var { runCycle, restoreFromSnapshot } = require("./services/cycleRunner");

var PORT = process.env.PORT || 3000;

var app = express();

// روی Render سرویس پشت یک reverse proxy است؛ برای تشخیص درست IP واقعی کاربر (لازم برای rate limit)
app.set("trust proxy", 1);

// اگر ALLOWED_ORIGIN تنظیم نشده باشد (مثلاً در توسعه‌ی محلی)، همه origin ها مجاز می‌مانند
var allowedOrigins = (process.env.ALLOWED_ORIGIN || "")
  .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
var corsOptions = allowedOrigins.length > 0 ? { origin: allowedOrigins } : {};
app.use(cors(corsOptions));

app.use(express.json());

// محدودیت نرخ: خواندن و نوشتن جدا
var readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "too many read requests" }
});
var writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "too many write requests" }
});
app.use("/api", function (req, res, next) {
  if (req.method === "GET") return readLimiter(req, res, next);
  return writeLimiter(req, res, next);
}, apiRouter);

app.get("/", function (req, res) {
  res.json({ ok: true, service: "option-hunter-backend" });
});

var timerRef = { current: null };

function scheduleNextInternalTick() {
  Settings.findOne({ ownerId: "default" }).then(function (settings) {
    var sec = (settings && settings.checkIntervalSec) || 60;
    sec = Math.max(20, Math.min(3600, sec));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(function () {
      runCycle({ notify: true }).catch(function (e) {
        console.error("[internal tick] error:", e.message);
      }).finally(function () {
        scheduleNextInternalTick();
      });
    }, sec * 1000);
  }).catch(function (e) {
    console.error("[scheduler] error reading settings:", e.message);
    timerRef.current = setTimeout(scheduleNextInternalTick, 60 * 1000);
  });
}

async function main() {
  await connectDB(process.env.MONGODB_URI);

  var existing = await Settings.findOne({ ownerId: "default" });
  if (!existing) await Settings.create({ ownerId: "default" });

  // بازیابی آخرین کش ذخیره‌شده (اگر سرویس تازه ری‌استارت شده، فرانت فوراً داده می‌بیند)
  await restoreFromSnapshot();

  app.listen(PORT, function () {
    console.log("🚀 Server listening on port " + PORT);
  });

  // اجرای اولیه (بدون تلگرام، فقط برای پر کردن کش در همان لحظه‌ی بالا آمدن)
  runCycle({ notify: false }).catch(function (e) {
    console.error("[startup] initial run error:", e.message);
  });

  // شروع حلقه‌ی داخلی (علاوه بر cron-job.org، به‌عنوان پشتیبان وقتی سرویس بیدار می‌ماند)
  scheduleNextInternalTick();
}

main().catch(function (err) {
  console.error("❌ خطای راه‌اندازی:", err.message);
  process.exit(1);
});