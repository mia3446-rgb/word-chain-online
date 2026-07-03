"use strict";

const domains = [
  require("./auth"), require("./players"), require("./words"),
  require("./rooms"), require("./game"), require("./social"),
  require("./shop"), require("./collection"), require("./achievements")
];

const eventOwners = new Map();
for (const domain of domains) {
  for (const event of domain.events || []) {
    if (eventOwners.has(event)) throw new Error(`Duplicate Socket.IO event owner: ${event}`);
    eventOwners.set(event, domain.name);
  }
}

/**
 * Owns the Socket.IO connection-registration boundary.
 * Domain handlers are composed by app.js so their existing closures and
 * event payloads remain byte-for-byte compatible with the pre-refactor runtime.
 */
function registerSocketHandlers(io, onConnection) {
  io.on("connection", onConnection);
}

module.exports = { registerSocketHandlers };
