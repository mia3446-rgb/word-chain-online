# Word Chain Arena V3.1 - Game Feel Update

V3.1 improves match feedback, audio polish, long-word excitement, and end-of-match presentation while preserving existing normal/ranked matchmaking, ranked rules, and save compatibility.

## Highlights

- Added generated Web Audio SFX and BGM systems.
- Added SFX/BGM toggles and volume controls saved in localStorage.
- Added accepted-word impact animation with length, tier, combo, PERFECT, and reward feedback.
- Added server-authoritative long-word match rewards.
- Added combo and PERFECT tracking for each match.
- Added large final-countdown warning feedback for 5, 4, 3, 2, 1 seconds.
- Added victory/defeat match-end overlay while preserving existing result/rematch UI.

## Long Word Reward Rules

- 6-7 Korean characters: GOOD, +2 XP, +2 coins
- 8-9 Korean characters: GREAT, +5 XP, +5 coins
- 10-11 Korean characters: AMAZING, +10 XP, +10 coins
- 12+ Korean characters: LEGENDARY, +20 XP, +20 coins

Rewards are accumulated server-side during the match and saved once through the normal match reward flow.

## Compatibility

- No ranked calculation changes.
- No dictionary rule changes.
- No save format breakage.
- No external or copyrighted audio assets.
