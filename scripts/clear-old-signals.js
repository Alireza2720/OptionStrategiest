"use strict";
var path = require("path");
var fs = require("fs");
var mongoose = require("mongoose");
var envCandidates = [
  path.resolve(__dirname, "..", ".env"),
  path.resolve(__dirname, "..", "backend", ".env"),
  path.resolve(__dirname, "..", "backend", "src", ".env")
];
for (var i = 0; i < envCandidates.length; i++) {
  if (fs.existsSync(envCandidates[i])) {
    require("dotenv").config({ path: envCandidates[i] });
    break;
  }
}
var { connectDB } = require("../backend/src/db");
var SignalLog = require("../backend/src/models/SignalLog");
var FollowedSignal = require("../backend/src/models/FollowedSignal");

(async function () {
  await connectDB(process.env.MONGODB_URI);
  var activeFollowed = await FollowedSignal.find({ status: "active" }).lean();
  var activeKeys = {};
  activeFollowed.forEach(function (f) { activeKeys[f.signalKey] = true; });
  var r = await SignalLog.deleteMany({ key: { $nin: Object.keys(activeKeys) } });
  console.log("پاک شد:", r.deletedCount);
  await mongoose.connection.close();
  process.exit(0);
})();