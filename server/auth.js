"use strict";

const crypto = require("crypto");

function makeSalt() { return crypto.randomBytes(16).toString("hex"); }
function makeToken() { return crypto.randomBytes(24).toString("hex"); }
function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(String(password) + salt).digest("hex");
}
function isValidNickname(nickname) { return /^[가-힣a-zA-Z0-9_]{2,12}$/.test(String(nickname || "")); }
function isValidPassword(password) {
  const length = String(password || "").length;
  return length >= 4 && length <= 30;
}

module.exports = {
  name: "auth",
  events: ["register", "login", "autoLogin", "logout"],
  makeSalt, makeToken, hashPassword, isValidNickname, isValidPassword
};
