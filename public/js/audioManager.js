(function () {
  const WCA = window.WCA = window.WCA || {};

  const DEFAULT_AUDIO_SETTINGS = {
    masterVolume: 0.9,
    bgmVolume: 0.28,
    sfxVolume: 0.95
  };

  const AUDIO_PATHS = {
    bgm: {
      lobby: "/assets/audio/bgm/lobby.ogg",
      normal: "/assets/audio/bgm/normal.ogg",
      ranked: "/assets/audio/bgm/ranked.ogg",
      victory: "/assets/audio/bgm/victory.ogg",
      defeat: "/assets/audio/bgm/defeat.ogg"
    },
    sfx: {
      button: "/assets/audio/sfx/button.wav",
      click: "/assets/audio/sfx/button.wav",
      correct: "/assets/audio/sfx/correct.wav",
      correct2: "/assets/audio/sfx/correct2.wav",
      correct3: "/assets/audio/sfx/correct3.wav",
      correct4: "/assets/audio/sfx/correct4.wav",
      submit: "/assets/audio/sfx/submit.wav",
      pass: "/assets/audio/sfx/pass.wav",
      wrong: "/assets/audio/sfx/wrong.wav",
      error: "/assets/audio/sfx/wrong.wav",
      open: "/assets/audio/sfx/open.wav",
      close: "/assets/audio/sfx/close.wav",
      turn: "/assets/audio/sfx/turn.wav",
      combo: "/assets/audio/sfx/combo.wav",
      countdown: "/assets/audio/sfx/countdown.wav",
      warning: "/assets/audio/sfx/countdown.wav",
      legendary: "/assets/audio/sfx/legendary.wav",
      purchase: "/assets/audio/sfx/purchase.wav",
      buy: "/assets/audio/sfx/purchase.wav",
      promotion: "/assets/audio/sfx/promotion.wav",
      demotion: "/assets/audio/sfx/demotion.wav",
      matchFound: "/assets/audio/sfx/matchFound.wav",
      match: "/assets/audio/sfx/match.wav",
      invite: "/assets/audio/sfx/invite.wav",
      friendInvite: "/assets/audio/sfx/friendInvite.wav",
      victory: "/assets/audio/sfx/victory.wav",
      defeat: "/assets/audio/sfx/defeat.wav"
    }
  };

  const state = {
    ctx: null,
    unlocked: false,
    assetsLoaded: false,
    assetsLoading: null,
    assets: { bgm: {}, sfx: {} },
    mixer: null,
    bgm: null,
    bgmMode: "",
    bgmGeneration: 0,
    duckToken: 0,
    characterSeq: 0,
    loadCache: new Map(),
    failedAssets: new Set(),
    lastSfxAt: {},
    synthTimers: [],
    synthNodes: [],
    characterTimers: [],
    lastCountdownKey: "",
    settings: {
      sfx: localStorage.getItem("wca_sfx") !== "off" && localStorage.getItem("wca_sound") !== "off",
      bgm: localStorage.getItem("wca_bgm") !== "off",
      masterVolume: readVolumeSetting("wca_master_volume", DEFAULT_AUDIO_SETTINGS.masterVolume),
      sfxVolume: readVolumeSetting("wca_sfx_volume", DEFAULT_AUDIO_SETTINGS.sfxVolume),
      bgmVolume: readVolumeSetting("wca_bgm_volume", DEFAULT_AUDIO_SETTINGS.bgmVolume)
    }
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  }

  function readVolumeSetting(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === "") return fallback;
    return clamp(Number(raw), 0, 1);
  }

  function getContext() {
    if (!state.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      state.ctx = new AudioContextClass();
    }
    ensureMixer();
    return state.ctx;
  }

  function ensureMixer() {
    const ctx = state.ctx;
    if (!ctx || state.mixer) return state.mixer;

    const master = ctx.createGain();
    const bgmBus = ctx.createGain();
    const sfxBus = ctx.createGain();
    const bgmEq = ctx.createBiquadFilter();
    const sfxEq = ctx.createBiquadFilter();
    const air = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor();
    const limiter = ctx.createDynamicsCompressor();

    master.gain.value = state.settings.masterVolume;
    bgmBus.gain.value = 1;
    sfxBus.gain.value = 1;

    bgmEq.type = "lowpass";
    bgmEq.frequency.value = 7600;
    bgmEq.Q.value = 0.45;

    sfxEq.type = "highshelf";
    sfxEq.frequency.value = 2600;
    sfxEq.gain.value = 1.5;

    air.type = "highshelf";
    air.frequency.value = 6200;
    air.gain.value = 0.8;

    compressor.threshold.value = -18;
    compressor.knee.value = 16;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    limiter.threshold.value = -3.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;

    bgmBus.connect(bgmEq);
    bgmEq.connect(master);
    sfxBus.connect(sfxEq);
    sfxEq.connect(master);
    master.connect(air);
    air.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(ctx.destination);

    state.mixer = { ctx, master, bgmBus, sfxBus, bgmEq, sfxEq, compressor, limiter, duckUntil: 0 };
    return state.mixer;
  }

  function duckBgm(amount = 0.58, duration = 0.32) {
    const mixer = ensureMixer();
    if (!mixer) return;
    const ctx = mixer.ctx;
    const now = ctx.currentTime;
    const token = ++state.duckToken;
    mixer.duckUntil = Math.max(mixer.duckUntil || 0, now + duration);
    if (state.bgm && state.bgm.audio) {
      state.bgm.audio.volume = masterBgmVolume((state.bgm.multiplier || 1) * amount);
      setTimeout(() => {
        if (token !== state.duckToken) return;
        if (!state.bgm || !state.bgm.audio) return;
        state.bgm.audio.volume = masterBgmVolume(state.bgm.multiplier || 1);
      }, duration * 1000);
    }
    mixer.bgmBus.gain.cancelScheduledValues(now);
    mixer.bgmBus.gain.setTargetAtTime(amount, now, 0.025);
    mixer.bgmBus.gain.setTargetAtTime(1, now + duration, 0.14);
  }

  function masterSfxVolume(multiplier = 1) {
    return state.settings.sfxVolume * state.settings.masterVolume * multiplier;
  }

  function masterBgmVolume(multiplier = 1) {
    return state.settings.bgmVolume * state.settings.masterVolume * multiplier;
  }

  function makeAudio(url, { loop = false } = {}) {
    if (state.loadCache.has(url)) {
      return state.loadCache.get(url).then(audio => audio ? audio.cloneNode(true) : null);
    }
    if (state.failedAssets.has(url)) return Promise.resolve(null);

    const promise = new Promise(resolve => {
      const audio = new Audio();
      audio.preload = "auto";
      audio.loop = loop;
      audio.src = url;
      let settled = false;
      const done = ok => {
        if (settled) return;
        settled = true;
        audio.oncanplaythrough = null;
        audio.onloadeddata = null;
        audio.onerror = null;
        if (!ok) state.failedAssets.add(url);
        resolve(ok ? audio : null);
      };
      audio.oncanplaythrough = () => done(true);
      audio.onloadeddata = () => done(true);
      audio.onerror = () => done(false);
      audio.load();
      setTimeout(() => {
        if (audio.readyState >= 2) done(true);
        else done(false);
      }, 1400);
    });
    state.loadCache.set(url, promise);
    return promise.then(audio => audio ? audio.cloneNode(true) : null);
  }

  function makeAudioLegacy(url, { loop = false } = {}) {
    return new Promise(resolve => {
      const audio = new Audio();
      audio.preload = "auto";
      audio.loop = loop;
      audio.src = url;
      const done = ok => {
        audio.oncanplaythrough = null;
        audio.onloadeddata = null;
        audio.onerror = null;
        resolve(ok ? audio : null);
      };
      audio.oncanplaythrough = () => done(true);
      audio.onloadeddata = () => done(true);
      audio.onerror = () => done(false);
      audio.load();
      setTimeout(() => {
        if (audio.readyState >= 2) done(true);
      }, 1200);
    });
  }

  function loadAssets() {
    if (state.assetsLoaded) return Promise.resolve(state.assets);
    if (state.assetsLoading) return state.assetsLoading;

    const jobs = [];
    for (const [name, url] of Object.entries(AUDIO_PATHS.bgm)) {
      jobs.push(makeAudio(url, { loop: name === "lobby" || name === "normal" || name === "ranked" })
        .then(audio => { if (audio) state.assets.bgm[name] = audio; }));
    }
    for (const [name, url] of Object.entries(AUDIO_PATHS.sfx)) {
      jobs.push(makeAudio(url).then(audio => { if (audio) state.assets.sfx[name] = audio; }));
    }

    state.assetsLoading = Promise.allSettled(jobs).then(() => {
      state.assetsLoaded = true;
      return state.assets;
    });
    return state.assetsLoading;
  }

  function unlock() {
    const ctx = getContext();
    state.unlocked = true;
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    loadAssets().finally(() => {
      if (typeof window.updateBgmForContext === "function") window.updateBgmForContext();
    });
  }

  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.unlocked) return;
    const ctx = getContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    if (typeof window.updateBgmForContext === "function") window.updateBgmForContext();
  });

  function syncSettings(settings = {}) {
    if (settings.sfx !== undefined) state.settings.sfx = !!settings.sfx;
    if (settings.bgm !== undefined) state.settings.bgm = !!settings.bgm;
    if (settings.sfxVolume !== undefined) state.settings.sfxVolume = clamp(Number(settings.sfxVolume), 0, 1);
    if (settings.bgmVolume !== undefined) state.settings.bgmVolume = clamp(Number(settings.bgmVolume), 0, 1);
    if (settings.masterVolume !== undefined) state.settings.masterVolume = clamp(Number(settings.masterVolume), 0, 1);
    if (state.mixer) state.mixer.master.gain.setTargetAtTime(state.settings.masterVolume, state.mixer.ctx.currentTime, 0.05);
    applyBgmVolume();
    if (!state.settings.bgm) stopBgm();
  }

  function duckAmountFor(name) {
    const key = aliasSfx(name);
    if (key === "combo" || key === "legendary" || key === "promotion" || key === "victory" || key === "defeat") return 0.50;
    if (key === "correct" || key === "wrong" || key === "turn" || key === "countdown" || key === "pass") return 0.70;
    return 0.82;
  }

  function cloneAndPlay(audio, volume, { duck = true, duckAmount = 0.70, onFail = null } = {}) {
    if (!audio || !state.settings.sfx) return false;
    if (duck) duckBgm(duckAmount, duckAmount <= 0.5 ? 0.44 : 0.28);
    const node = audio.cloneNode(true);
    node.volume = clamp(volume, 0, 1);
    node.currentTime = 0;
    node.play().catch(() => {
      if (typeof onFail === "function") onFail();
    });
    return true;
  }

  function playAssetSfx(name, volume = 1, options = {}) {
    const asset = state.assets.sfx[name] || state.assets.sfx[aliasSfx(name)];
    return cloneAndPlay(asset, masterSfxVolume(volume), {
      duck: options.duck !== false,
      duckAmount: options.duckAmount ?? duckAmountFor(name),
      onFail: options.onFail
    });
  }

  function aliasSfx(name) {
    if (name === "error") return "wrong";
    if (name === "warning") return "countdown";
    if (name === "buy") return "purchase";
    if (name === "achievement" || name === "matchFound" || name === "invite") return "combo";
    if (name === "friendInvite") return "invite";
    if (name === "click") return "button";
    return name;
  }

  function cancelSynth() {
    state.synthTimers.forEach(clearInterval);
    state.synthTimers = [];
    state.synthNodes = [];
  }

  function cancelCharacterSequence() {
    state.characterSeq++;
    state.characterTimers.forEach(clearTimeout);
    state.characterTimers = [];
  }

  function stopBgm() {
    state.bgmGeneration++;
    cancelSynth();
    if (state.bgm && state.bgm.audio) {
      const audio = state.bgm.audio;
      const startVolume = audio.volume;
      const fade = setInterval(() => {
        audio.volume = Math.max(0, audio.volume - startVolume / 12);
        if (audio.volume <= 0.001) {
          clearInterval(fade);
          audio.pause();
          audio.currentTime = 0;
        }
      }, 24);
    }
    state.bgm = null;
    state.bgmMode = "";
  }

  function applyBgmVolume() {
    if (state.bgm && state.bgm.audio) {
      state.bgm.audio.volume = masterBgmVolume(state.bgm.multiplier || 1);
    }
    if (state.bgm && state.bgm.gain) {
      state.bgm.gain.gain.setTargetAtTime(0.075 * masterBgmVolume(state.bgm.multiplier || 1), state.bgm.ctx.currentTime, 0.08);
    }
  }

  function crossFade(nextAudio, mode, duration = 550, multiplier = 1) {
    if (!nextAudio || !state.settings.bgm) return false;
    const previous = state.bgm && state.bgm.audio;
    const target = masterBgmVolume(multiplier);
    nextAudio.loop = mode === "lobby" || mode === "normal" || mode === "ranked";
    nextAudio.volume = 0;
    nextAudio.currentTime = 0;
    nextAudio.play().catch(() => {});
    state.bgm = { audio: nextAudio, multiplier };
    state.bgmMode = mode;

    const steps = 18;
    let step = 0;
    const fade = setInterval(() => {
      step++;
      const ratio = Math.min(1, step / steps);
      nextAudio.volume = target * ratio;
      if (previous) previous.volume = Math.max(0, previous.volume * (1 - ratio));
      if (ratio >= 1) {
        clearInterval(fade);
        if (previous && previous !== nextAudio) {
          previous.pause();
          previous.currentTime = 0;
        }
      }
    }, duration / steps);
    return true;
  }

  function playBgm(mode) {
    if (!state.settings.bgm || !state.unlocked || !mode) return stopBgm();
    if (state.bgmMode === mode && state.bgm) return;
    const asset = state.assets.bgm[mode];
    if (asset) {
      cancelSynth();
      crossFade(asset.cloneNode(true), mode, 650, mode === "ranked" ? 1.06 : 1);
      return;
    }
    startSynthBgm(mode);
  }

  function startBgm(mode) {
    return playBgm(mode);
  }

  function playFanfareBgm(type) {
    const asset = state.assets.bgm[type];
    if (asset) {
      crossFade(asset.cloneNode(true), type, 260, type === "victory" ? 1.1 : 0.9);
      setTimeout(() => {
        if (state.bgmMode === type && typeof window.updateBgmForContext === "function") window.updateBgmForContext();
      }, 3800);
      return;
    }
    synthFanfare(type);
  }

  function envGain(ctx, start, peak, attack, release, destination) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + release);
    gain.connect(destination || (ensureMixer() && state.mixer.sfxBus) || ctx.destination);
    return gain;
  }

  function filter(destination, type, frequency, q = 0.8) {
    const ctx = getContext();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    f.connect(destination || (ensureMixer() && state.mixer.sfxBus) || ctx.destination);
    return f;
  }

  function osc(freq, start, duration, type, volume, destination, detune = 0) {
    const ctx = getContext();
    if (!ctx) return null;
    const o = ctx.createOscillator();
    const g = envGain(ctx, start, volume, 0.006, Math.max(0.025, duration), filter(destination || (state.mixer && state.mixer.sfxBus) || ctx.destination, "lowpass", Math.max(500, Math.min(5000, freq * 3))));
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    o.detune.setValueAtTime(detune, start);
    o.connect(g);
    o.start(start);
    o.stop(start + duration + 0.04);
    state.synthNodes.push(o);
    return o;
  }

  function noise(duration, volume, delay, highpass, destination) {
    const ctx = getContext();
    if (!ctx) return;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
    }
    const source = ctx.createBufferSource();
    const t = ctx.currentTime + Math.max(0, delay);
    const g = envGain(ctx, t, volume, 0.003, duration, filter(destination || (state.mixer && state.mixer.sfxBus) || ctx.destination, "highpass", highpass));
    source.buffer = buffer;
    source.connect(g);
    source.start(t);
    state.synthNodes.push(source);
  }

  function impact(delay = 0, accent = false, pitch = 1, destination = null, pan = 0) {
    const ctx = getContext();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const out = destination || state.mixer.sfxBus || ctx.destination;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.setValueAtTime(clamp(pan, -0.65, 0.65), t);
      panner.connect(out);
    }
    const hitOut = panner || out;
    const v = masterSfxVolume(accent ? 0.105 : 0.074);
    osc(150 * pitch, t, 0.20, "triangle", v, hitOut);
    osc(74 * pitch, t, 0.075, "sine", v * 0.7, hitOut);
    noise(0.030, v * 0.16, delay, 220, hitOut);
    duckBgm(accent ? 0.52 : 0.68, accent ? 0.30 : 0.18);
  }

  function chord(freqs, delay = 0, duration = 0.24, volume = 0.017, destination = null) {
    const ctx = getContext();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    freqs.forEach((freq, index) => osc(freq, t + index * 0.006, duration, index ? "sine" : "triangle", masterSfxVolume(volume), destination, index * 3));
  }

  function spacingForLength(length) {
    if (length <= 4) return 110;
    if (length <= 7) return 80;
    if (length <= 11) return 55;
    return 35;
  }

  function playCorrect(lengthOrEvent, power = 0) {
    if (!state.settings.sfx) return;
    const event = typeof lengthOrEvent === "object" ? lengthOrEvent : null;
    const length = Math.max(1, Math.min(32, Number(event ? event.length : lengthOrEvent) || 1));
    const eventPower = event ? Number(event.power) || 0 : Number(power) || 0;

    if (state.assets.sfx.correct) {
      playAssetCorrectSequence(length, eventPower);
      return;
    }

    cancelCharacterSequence();
    const stepMs = spacingForLength(length);
    const groove = [1.00, 0.86, 1.08, 0.94, 1.15, 0.90, 1.04, 0.82];
    for (let i = 0; i < length; i++) {
      const timer = setTimeout(() => {
        const pan = length <= 1 ? 0 : ((i % 5) - 2) * 0.13;
        impact(0, i === 0 || i === length - 1 || (length >= 8 && i % 4 === 2), groove[i % groove.length] * (1 + Math.min(i, 12) * 0.006), null, pan);
      }, i * stepMs);
      state.characterTimers.push(timer);
    }

    const tail = ((length - 1) * stepMs) / 1000 + 0.12;
    if (eventPower >= 2) chord([196, 246.94, 293.66], tail, 0.22, 0.014);
    if (eventPower >= 3) {
      chord([174.61, 220, 261.63, 329.63], tail + 0.04, 0.32, 0.016);
      noise(0.13, masterSfxVolume(0.012), tail + 0.08, 1800);
    }
    if (eventPower >= 4 || length >= 12) {
      impact(tail + 0.05, true, 0.72);
      osc(92, getContext().currentTime + tail + 0.03, 0.36, "sine", masterSfxVolume(0.030), null);
      chord([146.83, 196, 246.94, 329.63], tail + 0.09, 0.42, 0.020);
      noise(0.20, masterSfxVolume(0.018), tail + 0.20, 2600);
    }
    playTurnPassCue(tail + 0.22);
  }

  function playAssetCorrectSequence(length, power = 0) {
    cancelCharacterSequence();
    const seq = ++state.characterSeq;
    duckBgm(length >= 12 ? 0.50 : 0.70, length >= 12 ? 0.50 : 0.34);
    const stepMs = spacingForLength(length);
    const variants = ["correct", "correct2", "correct3", "correct4"].filter(name => state.assets.sfx[name]);
    for (let i = 0; i < length; i++) {
      const timer = setTimeout(() => {
        if (seq !== state.characterSeq) return;
        const name = variants[i % variants.length] || "correct";
        const accent = i === 0 || i === length - 1 || (length >= 8 && i % 4 === 2);
        playAssetSfx(name, accent ? 1.05 : 0.82, { duck: false });
      }, i * stepMs);
      state.characterTimers.push(timer);
    }
    const tailMs = (length - 1) * stepMs + 120;
    if (power >= 2 && state.assets.sfx.combo) state.characterTimers.push(setTimeout(() => { if (seq === state.characterSeq) playAssetSfx("combo", 0.72, { duckAmount: 0.50 }); }, tailMs));
    if ((power >= 4 || length >= 12) && state.assets.sfx.legendary) state.characterTimers.push(setTimeout(() => { if (seq === state.characterSeq) playAssetSfx("legendary", 0.82, { duckAmount: 0.50 }); }, tailMs + 80));
    state.characterTimers.push(setTimeout(() => {
      if (seq !== state.characterSeq) return;
      if (state.assets.sfx.pass) playAssetSfx("pass", 0.58, { duck: false });
      else playTurnPassCue(0);
    }, tailMs + 150));
  }

  function playTurnPassCue(delay = 0) {
    const ctx = getContext();
    if (!ctx || !state.settings.sfx) return;
    duckBgm(0.70, 0.26);
    const t = ctx.currentTime + delay;
    osc(392, t, 0.055, "triangle", masterSfxVolume(0.015), null);
    osc(587.33, t + 0.045, 0.075, "sine", masterSfxVolume(0.012), null);
  }

  function playWrong() {
    if (!state.settings.sfx) return;
    if (playAssetSfx("wrong", 1, { duckAmount: 0.70, onFail: synthWrong })) return;
    synthWrong();
  }

  function synthWrong() {
    impact(0, true, 0.58);
    const ctx = getContext();
    if (ctx) osc(96, ctx.currentTime + 0.035, 0.18, "sine", masterSfxVolume(0.014), null);
  }

  function playCombo() {
    if (!state.settings.sfx) return;
    if (playAssetSfx("combo", 1, { duckAmount: 0.50, onFail: () => {
      chord([293.66, 392, 493.88], 0, 0.16, 0.016);
      noise(0.08, masterSfxVolume(0.010), 0.08, 1800);
    }})) return;
    chord([293.66, 392, 493.88], 0, 0.16, 0.016);
    noise(0.08, masterSfxVolume(0.010), 0.08, 1800);
  }

  function playCountdown() {
    if (!state.settings.sfx) return;
    if (playAssetSfx("countdown", 1, { duckAmount: 0.70 })) return;
    impact(0, true, 1.12);
    const ctx = getContext();
    if (ctx) osc(740, ctx.currentTime + 0.018, 0.045, "triangle", masterSfxVolume(0.010), null);
  }

  function playVictory() {
    playAssetSfx("victory", 1, { duckAmount: 0.50, onFail: () => synthFanfare("victory") }) || synthFanfare("victory");
    playFanfareBgm("victory");
  }

  function playDefeat() {
    playAssetSfx("defeat", 1, { duckAmount: 0.50, onFail: () => synthFanfare("defeat") }) || synthFanfare("defeat");
    playFanfareBgm("defeat");
  }

  function playSound(name, payload) {
    if (!state.settings.sfx && name !== "victory" && name !== "defeat") return;
    if (shouldThrottleSfx(name)) return;
    if (name === "correct") return playCorrect(payload || 1, payload && payload.power);
    if (name === "error" || name === "wrong") return playWrong();
    if (name === "combo" || name === "achievement" || name === "matchFound" || name === "invite") return playCombo();
    if (name === "warning" || name === "countdown") return playCountdown();
    if (name === "victory") return playVictory();
    if (name === "defeat" || name === "fail") return playDefeat();
    if (name === "buy" || name === "purchase") return playAssetSfx("purchase", 1, { onFail: synthPurchase }) || synthPurchase();
    if (name === "promotion") return playAssetSfx("promotion", 1, { duckAmount: 0.50, onFail: synthPromotion }) || synthPromotion();
    if (name === "demotion") return playAssetSfx("demotion", 1, { duckAmount: 0.50, onFail: synthDemotion }) || synthDemotion();
    if (name === "longGood") return playCorrect(6, 1);
    if (name === "longGreat") return playCorrect(9, 2);
    if (name === "longLegendary") return playCorrect(13, 4);
    if (playAssetSfx(aliasSfx(name))) return;
    if (name === "click" || name === "button") { noise(0.018, masterSfxVolume(0.010), 0, 2100); return; }
    if (name === "open") return chord([261.63, 329.63, 392], 0, 0.13, 0.012);
    if (name === "close") { const ctx = getContext(); if (ctx) { osc(392, ctx.currentTime, 0.045, "triangle", masterSfxVolume(0.012), null); osc(220, ctx.currentTime + 0.04, 0.08, "sine", masterSfxVolume(0.010), null); } return; }
    if (name === "turn") return playTurnPassCue(0);
    if (name === "success") return chord([523.25, 659.25, 783.99], 0, 0.16, 0.014);
  }

  function shouldThrottleSfx(name) {
    const key = aliasSfx(name);
    const windows = { button: 70, open: 120, close: 120, combo: 90, purchase: 90 };
    const ms = windows[key] || 0;
    if (!ms) return false;
    const now = performance.now();
    if (state.lastSfxAt[key] && now - state.lastSfxAt[key] < ms) return true;
    state.lastSfxAt[key] = now;
    return false;
  }

  function synthPurchase() {
    const ctx = getContext();
    if (!ctx) return;
    osc(987.77, ctx.currentTime, 0.04, "triangle", masterSfxVolume(0.016), null);
    osc(1318.51, ctx.currentTime + 0.045, 0.06, "sine", masterSfxVolume(0.016), null);
    noise(0.09, masterSfxVolume(0.015), 0.06, 2800);
  }

  function synthPromotion() {
    chord([392, 493.88, 659.25], 0, 0.18, 0.022);
    chord([523.25, 659.25, 783.99, 1046.5], 0.18, 0.34, 0.025);
    noise(0.17, masterSfxVolume(0.017), 0.22, 2200);
  }

  function synthDemotion() {
    const ctx = getContext();
    if (!ctx) return;
    osc(293.66, ctx.currentTime, 0.10, "triangle", masterSfxVolume(0.017), null);
    osc(220, ctx.currentTime + 0.08, 0.14, "sine", masterSfxVolume(0.014), null);
    osc(146.83, ctx.currentTime + 0.18, 0.20, "sine", masterSfxVolume(0.011), null);
  }

  function synthFanfare(type) {
    if (type === "victory") {
      chord([392, 493.88, 587.33], 0, 0.18, 0.022);
      chord([523.25, 659.25, 783.99, 1046.5], 0.18, 0.42, 0.028);
      noise(0.20, masterSfxVolume(0.016), 0.23, 2200);
    } else {
      const ctx = getContext();
      if (!ctx) return;
      osc(293.66, ctx.currentTime, 0.12, "triangle", masterSfxVolume(0.016), null);
      osc(220, ctx.currentTime + 0.11, 0.18, "sine", masterSfxVolume(0.013), null);
      osc(146.83, ctx.currentTime + 0.25, 0.28, "sine", masterSfxVolume(0.010), null);
    }
  }

  function startSynthBgm(mode) {
    if (!state.settings.bgm || !state.unlocked || !mode) return stopBgm();
    if (state.bgmMode === mode && state.bgm && state.bgm.synth) return;
    stopBgm();
    const ctx = getContext();
    if (!ctx) return;
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    master.gain.value = 0.0001;
    master.connect(comp);
    comp.connect((ensureMixer() && state.mixer.bgmBus) || ctx.destination);
    master.gain.setTargetAtTime(0.075 * masterBgmVolume(mode === "ranked" ? 1.08 : 1), ctx.currentTime, 0.24);

    const themes = {
      lobby: { beat: 285, chords: [[261.63,329.63,392],[220,277.18,329.63],[196,246.94,293.66],[174.61,220,261.63]], bass: [130.81,110,98,87.31], lead: [659,0,784,659,587,0,523,587,659,0,880,784,659,587,523,0], drum: 0.55 },
      normal: { beat: 215, chords: [[220,261.63,329.63],[196,246.94,293.66],[174.61,220,261.63],[196,246.94,329.63]], bass: [110,98,87.31,98], lead: [440,523,0,659,587,523,698,0,659,523,440,523,587,659,523,0], drum: 0.9 },
      ranked: { beat: 178, chords: [[174.61,220,261.63],[164.81,207.65,246.94],[146.83,185,220],[155.56,196,233.08]], bass: [87.31,82.41,73.42,77.78], lead: [349,0,440,523,466,440,0,587,523,466,440,523,587,698,587,0], drum: 1.12 }
    };
    const theme = themes[mode] || themes.lobby;
    state.bgm = { ctx, gain: master, synth: true, multiplier: mode === "ranked" ? 1.08 : 1 };
    state.bgmMode = mode;
    let step = 0;
    const generation = ++state.bgmGeneration;
    const schedule = () => {
      if (generation !== state.bgmGeneration || !state.bgm || state.bgmMode !== mode) return;
      const now = ctx.currentTime + 0.035;
      const beat = theme.beat / 1000;
      const s = step % 16;
      const c = Math.floor(s / 4) % theme.chords.length;
      const chordSet = theme.chords[c];
      if (s % 4 === 0) {
        chordSet.forEach((freq, i) => osc(freq, now, beat * 3.5, i ? "sine" : "triangle", 0.009 * masterBgmVolume(), master));
        osc(theme.bass[c], now, beat * 1.8, "sine", 0.020 * masterBgmVolume(), master);
      }
      if (s % 2 === 0 && s % 4 !== 0) osc(theme.bass[c] * 1.5, now, beat * 0.55, "triangle", 0.010 * masterBgmVolume(), master);
      osc(chordSet[(s + c) % chordSet.length] * (s % 4 === 3 ? 2 : 1), now + beat * 0.07, beat * 0.42, "triangle", 0.008 * masterBgmVolume(), master);
      if (theme.lead[s]) osc(theme.lead[s], now + beat * 0.12, beat * 0.68, "sine", 0.009 * masterBgmVolume(), master);
      if (s % 4 === 0 || (mode === "ranked" && s % 4 === 2)) synthKick(ctx, master, now, 0.030 * theme.drum * masterBgmVolume());
      if (s % 4 === 2) noise(0.07, 0.007 * theme.drum * masterBgmVolume(), Math.max(0, now - ctx.currentTime), 900, master);
      if (mode !== "lobby" || s % 2 === 1) noise(0.022, 0.0035 * theme.drum * masterBgmVolume(), Math.max(0, now + beat * 0.5 - ctx.currentTime), 4200, master);
      step = (step + 1) % 16;
    };
    schedule();
    state.synthTimers.push(setInterval(schedule, theme.beat));
  }

  function synthKick(ctx, destination, start, volume) {
    const o = ctx.createOscillator();
    const g = envGain(ctx, start, volume, 0.004, 0.13, destination);
    o.type = "sine";
    o.frequency.setValueAtTime(118, start);
    o.frequency.exponentialRampToValueAtTime(46, start + 0.12);
    o.connect(g);
    o.start(start);
    o.stop(start + 0.16);
    state.synthNodes.push(o);
  }

  function setBgmTension(secondsLeft) {
    if (!state.bgm || !Number.isFinite(Number(secondsLeft))) return;
    const target = Number(secondsLeft) <= 5 ? 0.098 : 0.075;
    if (state.bgm.audio) state.bgm.audio.volume = masterBgmVolume(Number(secondsLeft) <= 5 ? 1.12 : 1);
    if (state.bgm.gain) state.bgm.gain.gain.setTargetAtTime(target * masterBgmVolume(state.bgm.multiplier || 1), state.bgm.ctx.currentTime, 0.12);
  }

  function setSfxVolume(value) {
    state.settings.sfxVolume = clamp(Number(value), 0, 1);
    localStorage.setItem("wca_sfx_volume", String(state.settings.sfxVolume));
  }

  function setBgmVolume(value) {
    state.settings.bgmVolume = clamp(Number(value), 0, 1);
    localStorage.setItem("wca_bgm_volume", String(state.settings.bgmVolume));
    applyBgmVolume();
  }

  function setMasterVolume(value) {
    state.settings.masterVolume = clamp(Number(value), 0, 1);
    localStorage.setItem("wca_master_volume", String(state.settings.masterVolume));
    if (state.mixer) state.mixer.master.gain.setTargetAtTime(state.settings.masterVolume, state.mixer.ctx.currentTime, 0.05);
    applyBgmVolume();
  }

  WCA.Audio = {
    getContext,
    unlock,
    loadAssets,
    syncSettings,
    playBgm,
    startBgm,
    stopBgm,
    crossFade,
    playCorrect,
    playWrong,
    playCombo,
    playVictory,
    playDefeat,
    playCountdown,
    playSound,
    playWord: playCorrect,
    cancelCharacterSequence,
    setBgmTension,
    setSfxVolume,
    setBgmVolume,
    setMasterVolume,
    settings: state.settings,
    assets: state.assets
  };

  loadAssets();
})();
