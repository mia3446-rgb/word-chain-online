# Word Chain Arena V3.2 - Full Game Renewal + Audio Architecture

V3.2 is the final renewal direction for the current client architecture. It preserves existing gameplay, ranked rules, timer/reconnect/mobile-login stability, shop, friends, collection, spectating, chat, and save compatibility.

## Client Module Structure

- `public/js/app.js` - bootstrap/coordinator and legacy compatibility layer for existing inline handlers.
- `public/js/audioManager.js` - generated Web Audio BGM/SFX engine.
- `public/js/auth.js` - auth/reconnect namespace.
- `public/js/lobby.js` - lobby/matchmaking namespace.
- `public/js/room.js` - room/gameplay namespace.
- `public/js/ranked.js` - competitive/ranked namespace.
- `public/js/social.js` - friends/invites/notifications namespace.
- `public/js/shop.js` - shop/boxes namespace.
- `public/js/collection.js` - collection/prestige namespace.
- `public/js/settings.js` - localStorage settings namespace.
- `public/js/uiEffects.js` - overlays and feedback namespace.
- `public/js/utils.js` - shared utility namespace.

## Audio Architecture

- One shared `AudioContext`.
- No external or copyrighted audio assets.
- Generated lobby, normal match, ranked match, victory, and defeat audio identity.
- BGM uses rhythm, percussion, bass, chord pads, and melody.
- Smooth BGM transitions and duplicate loop prevention.
- BGM/SFX/master volume settings persist in localStorage.
- Mobile autoplay restrictions are respected through first-interaction unlock.

## Correct Word Sound

Accepted words play one soft, weighty per-character hit:

- 1-4 characters: 110ms spacing
- 5-7 characters: 80ms spacing
- 8-11 characters: 55ms spacing
- 12+ characters: 35ms spacing

Long-word reward rules are unchanged.

## Visual Renewal

- Cleaner dark arcade styling.
- Stronger cards, buttons, shadows, and hierarchy.
- Clearer ranked/timer accents.
- Improved sound-test controls in settings.

## Compatibility

- No server gameplay rule changes.
- No ranked calculation changes.
- No player save format changes.
- Existing Socket.IO event names and payloads preserved.
