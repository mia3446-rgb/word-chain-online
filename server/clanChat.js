"use strict";

function formatClanChatMessage({ clanId, nickname, text, type = "member" }) {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    clanId,
    nickname: nickname || "SYSTEM",
    text: String(text || "").trim().slice(0, 400),
    type,
    time: Date.now()
  };
}

module.exports = {
  events: ["getClanChat", "sendClanChat", "setClanAnnouncement", "clanTyping"],
  formatClanChatMessage
};
