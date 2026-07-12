"use strict";

const { createJsonStore } = require("./clan");

function createClanVaultService({ fs, path, dataDir, makeToken }) {
  const store = createJsonStore({ fs, path, dataDir, filename: "clanVault.json", defaultValue: { version: 1, vaults: {} } });
  let data = store.load();
  function save() { store.save(data); }
  function getVault(clanId) {
    if (!data.vaults[clanId]) data.vaults[clanId] = { words: [] };
    data.vaults[clanId].words = Array.isArray(data.vaults[clanId].words) ? data.vaults[clanId].words.slice(-300) : [];
    return data.vaults[clanId];
  }
  function publicVault(clanId, query = "") {
    const q = String(query || "").trim().toLowerCase();
    const words = getVault(clanId).words.filter(item => !q || item.word.toLowerCase().includes(q) || item.note.toLowerCase().includes(q) || item.category.toLowerCase().includes(q));
    return { clanId, words: words.slice().reverse() };
  }
  function addWord(clanId, nickname, payload) {
    const word = String(payload.word || "").trim().slice(0, 40);
    if (word.length < 1) return { ok: false, message: "저장할 단어를 입력하세요." };
    const vault = getVault(clanId);
    const item = {
      id: makeToken().slice(0, 10),
      word,
      note: String(payload.note || "").trim().slice(0, 300),
      category: String(payload.category || "rare").trim().slice(0, 24),
      favorite: !!payload.favorite,
      createdBy: nickname,
      createdAt: Date.now()
    };
    vault.words.push(item);
    vault.words = vault.words.slice(-300);
    save();
    return { ok: true, item };
  }
  function removeWord(clanId, id) {
    const vault = getVault(clanId);
    vault.words = vault.words.filter(item => item.id !== id);
    save();
    return { ok: true };
  }
  return { publicVault, addWord, removeWord, save };
}

module.exports = { createClanVaultService, events: ["getClanVault", "addClanVaultWord", "removeClanVaultWord"] };
