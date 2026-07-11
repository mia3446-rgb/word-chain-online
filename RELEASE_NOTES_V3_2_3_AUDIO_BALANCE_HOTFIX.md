# Word Chain Arena V3.2.3 - Audio Balance & Stability Hotfix

V3.2.3 stabilizes the V3.2 audio system without changing gameplay, ranked logic, Socket.IO events, rewards, long-word rules, or save data.

## Final New-User Audio Defaults

- Master Volume: `0.90`
- BGM Volume: `0.28`
- SFX Volume: `0.95`

Existing users keep their saved localStorage settings.

## Ducking Values

- Correct / wrong / turn / countdown clarity duck: BGM lowered to about `70%`.
- Combo / legendary / promotion / victory / defeat impact duck: BGM lowered to about `50%`.
- Ducking uses smooth attack/release and token protection so overlapping ducks cannot leave BGM permanently quiet.

## Stability Fixes

- Prevented per-character correct-word asset hits from repeatedly re-ducking BGM.
- Added correct-word sequence tokens so old scheduled character hits cannot continue after a newer word event.
- Cached asset load results by URL to avoid repeated duplicate requests and repeated missing-asset checks.
- Kept fallback synthesis mutually exclusive with asset playback except for a safe one-time playback-failure fallback.
- Added SFX debounce for nested UI click/open/close events.
- Added mobile visibility resume handling for suspended AudioContext.

## Settings

- Added `Reset Audio Settings`, which resets only audio settings to the recommended defaults.
- Sound tests are now concise: Correct, Wrong, Legendary, Victory.
