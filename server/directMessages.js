"use strict";

const { createJsonStore } = require("./clan");

function conversationId(a, b) {
  return [String(a || ""), String(b || "")].sort((x, y) => x.localeCompare(y, "ko")).join("::");
}

function createDirectMessageService({ fs, path, dataDir, makeToken, safePlayerKey }) {
  const store = createJsonStore({ fs, path, dataDir, filename: "messages.json", defaultValue: { version: 1, conversations: {} } });
  let data = store.load();
  function save() { store.save(data); }
  function getConversation(a, b) {
    const id = conversationId(a, b);
    if (!data.conversations[id]) data.conversations[id] = { id, participants: [safePlayerKey(a), safePlayerKey(b)], messages: [], unread: {} };
    return data.conversations[id];
  }
  function send(from, to, text) {
    from = safePlayerKey(from); to = safePlayerKey(to);
    const clean = String(text || "").trim().slice(0, 800);
    if (!clean) return { ok: false, message: "메시지를 입력하세요." };
    const conv = getConversation(from, to);
    const msg = { id: makeToken().slice(0, 12), from, to, text: clean, time: Date.now(), readBy: [from] };
    conv.messages.push(msg);
    conv.messages = conv.messages.slice(-200);
    conv.unread[to] = (Number(conv.unread[to]) || 0) + 1;
    save();
    return { ok: true, conversation: conv, message: msg };
  }
  function markRead(reader, other) {
    const conv = getConversation(reader, other);
    conv.unread[safePlayerKey(reader)] = 0;
    for (const msg of conv.messages) if (!msg.readBy.includes(reader)) msg.readBy.push(reader);
    save();
    return conv;
  }
  function publicConversation(viewer, other, online = false) {
    const conv = getConversation(viewer, other);
    return {
      id: conv.id,
      other: safePlayerKey(other),
      online,
      unread: Number(conv.unread[safePlayerKey(viewer)]) || 0,
      messages: conv.messages.slice(-80)
    };
  }
  function inbox(viewer, onlineFn = () => false) {
    viewer = safePlayerKey(viewer);
    return Object.values(data.conversations).filter(conv => conv.participants.includes(viewer)).map(conv => {
      const other = conv.participants.find(name => name !== viewer);
      const last = conv.messages[conv.messages.length - 1] || null;
      return { id: conv.id, other, online: onlineFn(other), unread: Number(conv.unread[viewer]) || 0, last };
    }).sort((a, b) => ((b.last?.time || 0) - (a.last?.time || 0)));
  }
  return { send, markRead, publicConversation, inbox, save };
}

module.exports = { createDirectMessageService, events: ["getDirectMessages", "sendDirectMessage", "markDirectMessagesRead"] };
