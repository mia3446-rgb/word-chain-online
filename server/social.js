"use strict";

module.exports = Object.freeze({
  name: "social",
  events: ["getFriends","searchPlayers","sendFriendRequest","respondFriendRequest","removeFriend","toggleFavoriteFriend","setSocialStatus","getNotifications","markNotificationsRead","reportPlayer","whisperFriend","blockPlayer","unblockPlayer","inviteFriend","declineRoomInvite","joinFriendRoom","sendChat","roomTyping"],
  responsibilities: ["friends", "presence", "party invites", "notifications", "chat"]
});
