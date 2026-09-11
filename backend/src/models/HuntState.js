"use strict";
var mongoose = require("mongoose");

var HuntStateSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", unique: true, index: true },
  rows: { type: mongoose.Schema.Types.Mixed, default: [] },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("HuntState", HuntStateSchema);