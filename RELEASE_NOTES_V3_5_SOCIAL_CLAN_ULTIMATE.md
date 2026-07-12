# Word Chain Arena V3.5 — Social & Clan Ultimate Update

## Summary

Version 3.5 adds a server-authoritative social expansion: clans, clan profile/progression, clan chat, clan missions, clan currency, clan rankings, clan wars, direct messages, gifts, notification integration, and a clan dictionary vault.

Existing gameplay, ranked, AI battle, timer, progression, audio, reconnect, mobile login, shop, collection, friends, chat, achievements, missions, profile, and save systems remain additive-compatible.

## New data files

Created automatically under the active data directory:

- `clans.json`
- `clanWars.json`
- `clanVault.json`
- `messages.json`
- `gifts.json`

## Clan structure

Each clan stores:

- `id`
- `name`
- `tag`
- `description`
- `banner`
- `emblem`
- `isPublic`
- `createdAt`
- `level`
- `xp`
- `coins`
- `maxMembers`
- `wins`
- `losses`
- `seasonPoints`
- `members`
- `requests`
- `invites`
- `chat`
- `announcements`
- `missions`
- `warStats`
- `history`
- `unlocks`

## Clan roles and permissions

Roles:

- Owner
- Vice Leader
- Officer
- Member

Permissions:

- Owner: all clan actions
- Vice Leader: invite, kick lower roles, edit profile, manage requests
- Officer: invite, manage requests
- Member: chat

## Clan progression

Clan XP is earned when members complete matches. Clan contribution considers:

- Matches
- Wins/losses
- Words submitted
- Long words
- Combo performance
- XP earned

Level reward support:

- Level 1: 20 members
- Level 2: 25 members
- Level 3: clan banner unlock
- Level 5: animated emblem unlock
- Level 10: special frame unlock

## Clan missions

Included missions:

- Play 50 matches
- Win 20 matches
- Submit 500 words
- Use 100 long words
- Earn 100 combo contribution

Rewards grant clan XP and clan coins.

## Clan wars

Clan wars support:

- 4 vs 4
- 8 vs 8
- Invite another clan
- Accept
- Countdown state
- Battle state
- Finish result
- War history
- War wins/losses/streak/rating/season points

## Direct messages

Added:

- Recent conversations
- Offline message storage
- Unread counts
- Online status
- Read marking

## Gift system

Friends can send:

- Coins
- Boxes
- Cosmetic item IDs

Rules:

- Friends only
- 5 gifts per sender per Korean day
- 30 second anti-spam interval
- Server validates ownership and balances
- Gift history is stored

## Clan dictionary vault

Clan members can save:

- Rare/favorite words
- Long words
- Strategy notes
- Categories
- Favorites-ready metadata

## UI

Added:

- Social shortcut bar
- Clan modal
- Clan Home
- Members
- Clan Chat
- Clan Missions
- Clan War
- Dictionary Vault
- Clan Rankings
- Direct Message modal
- Gift Center modal

## New Socket.IO events

Clan:

- `getClans`
- `createClan`
- `deleteClan`
- `requestJoinClan`
- `respondClanRequest`
- `leaveClan`
- `kickClanMember`
- `transferClanOwnership`
- `setClanRole`
- `updateClanProfile`
- `getClanRankings`

Clan chat:

- `sendClanChat`
- `clanTyping`
- `setClanAnnouncement`

Clan missions:

- `claimClanMission`

Clan vault:

- `getClanVault`
- `addClanVaultWord`
- `removeClanVaultWord`

Clan wars:

- `createClanWar`
- `getClanWars`
- `acceptClanWar`
- `startClanWar`
- `finishClanWar`

Direct messages:

- `getDirectMessages`
- `sendDirectMessage`
- `markDirectMessagesRead`

Gifts:

- `sendGift`
- `getGiftHistory`

## Validation

Performed:

- `node --check server.js`
- `node --check server/app.js`
- PowerShell loop syntax check for `server/*.js`
- PowerShell loop syntax check for `public/js/*.js`

Additional manual checklist:

- Register/Login
- AI Battle
- Normal Match
- Ranked Match
- Friends
- Collection
- Shop
- Profile
- Achievements
- Daily Missions
- Audio
- Reconnect
- Clan creation/join/request/roles
- Clan chat
- Clan missions
- Clan vault
- Clan rankings
- Clan wars
- Direct messages
- Gift system
- Notification center
- Mobile modal layout
