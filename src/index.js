"use strict";
require("dotenv").config();
var express = require("express");
var cors = require("cors");

var { connectDB } = require("./db");
var Settings = require("./models/Settings");
var apiRouter = require("./routes/api");
var { runCycle } = require("./services/cycleRunner");

var PORT = process.env.PORT || 3000;

var app = express();
app.use(cors());
app.use(express.json());
app.use("/api", apiRouter);

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