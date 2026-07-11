# Word Chain Arena V3.2.1 - Professional Audio Remaster

V3.2.1 replaces the generated-only audio layer with a hybrid asset-first audio manager while preserving gameplay, ranked rules, Socket.IO payloads, and save compatibility.

## Hybrid Audio Architecture

- Uses one shared `AudioContext`.
- Automatically loads audio assets from `public/assets/audio/` when files exist.
- Falls back to layered synthesis when files are missing.
- Prevents duplicate BGM loops and leaked intervals.
- Keeps mobile autoplay unlock behavior.
- Preserves BGM, SFX, and master volume localStorage settings.
- Adds an internal mix chain with separate BGM/SFX buses, EQ, compression, limiting, and dynamic BGM ducking under impactful SFX.

## Expected Asset Paths

```text
public/assets/audio/
  bgm/
    lobby.ogg
    normal.ogg
    ranked.ogg
    victory.ogg
    defeat.ogg
  sfx/
    button.wav
    correct.wav
    wrong.wav
    combo.wav
    countdown.wav
    legendary.wav
    purchase.wav
    promotion.wav
    demotion.wav
```

If these files are added later, the game will use them automatically without code changes.

## Fallback Synthesis

- BGM fallback uses bass, percussion, pad, and lead layers.
- Correct-word fallback uses soft arcade impact hits per Korean character.
- Long words accelerate into rhythmic bursts with final impact and sparkle layers.
- Wrong answers use a muted low thunk instead of harsh buzzer tones.
- Countdown uses a distinct percussive tick.
- Correct-word impact hits use subtle stereo placement and short BGM ducking for clarity.

## Public Audio API

- `playBgm()`
- `stopBgm()`
- `crossFade()`
- `playCorrect(length)`
- `playWrong()`
- `playCombo()`
- `playVictory()`
- `playDefeat()`
- `playCountdown()`
- `unlock()`
- `loadAssets()`
