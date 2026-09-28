"use strict";
var crypto = require("crypto");
var ApiWatchSample = require("../models/ApiWatchSample");

var TARGET_URL = "https://s3.optionschool24.com/last?type=3";
var DEFAULT_INTERVAL_SEC = 30;

var state = {
  running: false,
  intervalSec: DEFAULT_INTERVAL_SEC,
  timer: null,
  lastHash: null,
  lastChangeAt: null,
  sampleCount: 0,
  startedAt: null,
  lastSampleAt: null,
  lastError: null,
  inFlight: false
};

function tehranNow() {
  var now = new Date();
  var utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 3.5 * 60 * 60 * 1000);
}

function isMarketOpenNow() {
  var t = tehranNow();
  var day = t.getUTCDay(); // 0=Sun, 6=Sat
  var tradingDays = [6, 0, 1, 2, 3];
  if (tradingDays.indexOf(day) === -1) return false;
  var minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  return minutes >= 9 * 60 && minutes <= 12 * 60 + 30;
}

async function fetchOnce() {
  var controller = new AbortController();
  var to = setTimeout(function () { controller.abort(); }, 15000);
  try {
    var res = await fetch(TARGET_URL, { signal: controller.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var text = await res.text();
    var json = JSON.parse(text);
    var arr = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : []);
    return { text: text, arr: arr };
  } finally {
    clearTimeout(to);
  }
}

async function tick() {
  if (state.inFlight) return;
  state.inFlight = true;
  var t0 = Date.now();
  try {
    var data = await fetchOnce();
    var fetchMs = Date.now() - t0;
    var hash = crypto.createHash("md5").update(data.text).digest("hex");
    var changed = hash !== state.lastHash;
    var marketOpen = isMarketOpenNow();
    var now = new Date();

    var sampleData = null;
    if (data.arr.length > 0) {
      var r = data.arr[0];
      sampleData = {
        name: r.name,
        b_price: r.b_price,
        s_price: r.s_price,
        b_volume: r.b_volume,
        s_volume: r.s_volume
      };
    }

    await ApiWatchSample.create({
      at: now,
      hash: hash,
      rowCount: data.arr.length,
      fetchMs: fetchMs,
      isMarketOpen: marketOpen,
      changedSincePrev: changed,
      sampleData: sampleData
    });

    if (changed) state.lastChangeAt = now;
    state.lastHash = hash;
    state.sampleCount++;
    state.lastSampleAt = now;
    state.lastError = null;
  } catch (e) {
    state.lastError = e.message;
    try {
      await ApiWatchSample.create({
        at: new Date(),
        isMarketOpen: isMarketOpenNow(),
        error: e.message
      });
    } catch (e2) { /* ignore */ }
  } finally {
    state.inFlight = false;
  }
}

function scheduleNext() {
  if (!state.running) return;
  state.timer = setTimeout(async function () {
    if (!state.running) return;
    await tick();
    scheduleNext();
  }, state.intervalSec * 1000);
}

async function start(opts) {
  opts = opts || {};
  if (state.running) return { alreadyRunning: true, intervalSec: state.intervalSec };
  var intervalSec = parseInt(opts.intervalSec, 10);
  if (!intervalSec || intervalSec < 5) intervalSec = DEFAULT_INTERVAL_SEC;
  if (intervalSec > 3600) intervalSec = 3600;
  state.intervalSec = intervalSec;
  state.running = true;
  state.startedAt = new Date();
  state.sampleCount = 0;

  try {
    var lastSample = await ApiWatchSample
      .findOne({ hash: { $ne: null } })
      .sort({ at: -1 })
      .lean();
    if (lastSample) state.lastHash = lastSample.hash;
  } catch (e) { /* ignore */ }

  // اولین نمونه فوری
  tick().then(function () { scheduleNext(); });
  return { intervalSec: intervalSec };
}

function stop() {
  if (!state.running) return { alreadyStopped: true };
  state.running = false;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  return {};
}

function getStatus() {
  return {
    running: state.running,
    intervalSec: state.intervalSec,
    sampleCount: state.sampleCount,
    startedAt: state.startedAt,
    lastSampleAt: state.lastSampleAt,
    lastChangeAt: state.lastChangeAt,
    lastError: state.lastError,
    isMarketOpenNow: isMarketOpenNow(),
    tehranNow: tehranNow().toISOString()
  };
}

async function getSummary() {
  var totalSamples = await ApiWatchSample.countDocuments({});
  var totalErrors = await ApiWatchSample.countDocuments({ error: { $ne: null } });
  var marketSamples = await ApiWatchSample
    .find({ isMarketOpen: true, hash: { $ne: null } })
    .sort({ at: 1 })
    .lean();

  var marketCount = marketSamples.length;
  var changeCount = 0;
  var intervals = [];
  var prevAt = null;
  var uniqueHashes = {};

  for (var i = 0; i < marketSamples.length; i++) {
    var s = marketSamples[i];
    uniqueHashes[s.hash] = true;
    if (s.changedSincePrev) {
      changeCount++;
      if (prevAt) {
        intervals.push((new Date(s.at).getTime() - prevAt.getTime()) / 1000);
      }
      prevAt = new Date(s.at);
    }
  }

  var stats = null;
  if (intervals.length >= 1) {
    var sorted = intervals.slice().sort(function (a, b) { return a - b; });
    var sum = 0;
    for (var k = 0; k < sorted.length; k++) sum += sorted[k];
    stats = {
      count: sorted.length,
      avg: sum / sorted.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      min: sorted[0],
      max: sorted[sorted.length - 1]
    };
  }

  return {
    totalSamples: totalSamples,
    totalErrors: totalErrors,
    marketSamples: marketCount,
    changeCount: changeCount,
    uniqueHashCount: Object.keys(uniqueHashes).length,
    intervals: stats
  };
}

async function getSamples(limit) {
  limit = Math.min(parseInt(limit, 10) || 100, 1000);
  return ApiWatchSample.find({}).sort({ at: -1 }).limit(limit).lean();
}

async function clearSamples() {
  var r = await ApiWatchSample.deleteMany({});
  return { deleted: r.deletedCount };
}

module.exports = {
  start: start,
  stop: stop,
  getStatus: getStatus,
  getSummary: getSummary,
  getSamples: getSamples,
  clearSamples: clearSamples
};