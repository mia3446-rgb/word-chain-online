"use strict";

module.exports = Object.freeze({
  name: "rooms",
  events: ["getRoomList","createRoom","randomMatch","joinRoom","updateRoomSettings","setRoomAnnouncement","kickPlayer","transferRoomOwnership","leaveRoom"],
  responsibilities: ["room lifecycle", "owner permissions", "room serialization"]
});
