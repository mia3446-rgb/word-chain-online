"use strict";

const { createJsonStore } = require("./clan");

function createClanWarService({ fs, path, dataDir, makeToken }) {
  const store = createJsonStore({ fs, path, dataDir, filename: "clanWars.json", defaultValue: { version: 1, wars: {}, history: [] } });
  let data = store.load();
  function save() { store.save(data); }
  function create(fromClanId, toClanId, size, createdBy) {
    size = Number(size) === 8 ? 8 : 4;
    if (!fromClanId || !toClanId || fromClanId === toClanId) return { ok: false, message: "상대 클랜을 선택하세요." };
    const id = makeToken().slice(0, 12);
    const war = { id, fromClanId, toClanId, size, status: "invited", createdBy, createdAt: Date.now(), acceptedAt: 0, startedAt: 0, endedAt: 0, winnerClanId: "", result: "" };
    data.wars[id] = war;
    save();
    return { ok: true, war };
  }
  function accept(warId) {
    const war = data.wars[warId];
    if (!war || war.status !== "invited") return { ok: false, message: "수락할 수 없는 클랜전입니다." };
    war.status = "countdown";
    war.acceptedAt = Date.now();
    war.countdownEndsAt = Date.now() + 30000;
    save();
    return { ok: true, war };
  }
  function start(warId) {
    const war = data.wars[warId];
    if (!war || !["countdown", "invited"].includes(war.status)) return { ok: false, message: "시작할 수 없는 클랜전입니다." };
    war.status = "battle";
    war.startedAt = Date.now();
    save();
    return { ok: true, war };
  }
  function finish(warId, winnerClanId) {
    const war = data.wars[warId];
    if (!war || !["battle", "countdown"].includes(war.status)) return { ok: false, message: "종료할 수 없는 클랜전입니다." };
    war.status = "finished";
    war.endedAt = Date.now();
    war.winnerClanId = winnerClanId;
    war.result = winnerClanId === war.fromClanId ? "from" : winnerClanId === war.toClanId ? "to" : "draw";
    data.history.push(war);
    data.history = data.history.slice(-200);
    save();
    return { ok: true, war };
  }
  function listForClan(clanId) {
    return Object.values(data.wars).filter(war => war.fromClanId === clanId || war.toClanId === clanId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  }
  return { create, accept, start, finish, listForClan, save };
}

module.exports = { createClanWarService, events: ["createClanWar", "acceptClanWar", "startClanWar", "finishClanWar", "getClanWars"] };
