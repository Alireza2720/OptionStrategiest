"use strict";
var mongoose = require("mongoose");

var BasisOverrideSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", index: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  enabled: { type: Boolean, default: true }
}, { timestamps: true });

BasisOverrideSchema.index({ ownerId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("BasisOverride", BasisOverrideSchema);
