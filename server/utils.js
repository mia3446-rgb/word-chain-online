"use strict";

function safePlayerKey(nickname) {
  return String(nickname || "unknown").trim().slice(0, 30) || "unknown";
}
function randomInteger(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function weightedPick(weights) {
  const entries = Object.entries(weights);
  let roll = Math.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1][0];
}

module.exports = { safePlayerKey, randomInteger, weightedPick };
