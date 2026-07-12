"use strict";

const { createJsonStore } = require("./clan");

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function createGiftService({ fs, path, dataDir, makeToken, safePlayerKey }) {
  const store = createJsonStore({ fs, path, dataDir, filename: "gifts.json", defaultValue: { version: 1, gifts: [], daily: {} } });
  let data = store.load();
  function save() { store.save(data); }
  function canSend(from) {
    from = safePlayerKey(from);
    const key = todayKey();
    if (!data.daily[key]) data.daily = { [key]: {} };
    const entry = data.daily[key][from] || { count: 0, lastAt: 0 };
    if (entry.count >= 5) return { ok: false, message: "오늘 보낼 수 있는 선물 한도(5회)를 넘었습니다." };
    if (Date.now() - entry.lastAt < 30000) return { ok: false, message: "선물은 30초 간격으로 보낼 수 있습니다." };
    return { ok: true, entry, key };
  }
  function record(from, to, gift) {
    const check = canSend(from);
    if (!check.ok) return check;
    const item = { id: makeToken().slice(0, 12), from: safePlayerKey(from), to: safePlayerKey(to), gift, time: Date.now() };
    data.gifts.push(item);
    data.gifts = data.gifts.slice(-500);
    data.daily[check.key][safePlayerKey(from)] = { count: check.entry.count + 1, lastAt: Date.now() };
    save();
    return { ok: true, gift: item };
  }
  function history(nickname) {
    nickname = safePlayerKey(nickname);
    return data.gifts.filter(item => item.from === nickname || item.to === nickname).slice(-80).reverse();
  }
  return { canSend, record, history, save };
}

module.exports = { createGiftService, events: ["sendGift", "getGiftHistory"] };
