const socket = io(window.location.origin, {
      transports: ["websocket", "polling"]
    });

    const polishSettings = {
      sound: localStorage.getItem("wca_sound") !== "off",
      sfx: localStorage.getItem("wca_sfx") !== "off" && localStorage.getItem("wca_sound") !== "off",
      bgm: localStorage.getItem("wca_bgm") !== "off",
      masterVolume: Math.max(0, Math.min(1, Number(localStorage.getItem("wca_master_volume") ?? 0.9))),
      sfxVolume: Math.max(0, Math.min(1, Number(localStorage.getItem("wca_sfx_volume") ?? 0.95))),
      bgmVolume: Math.max(0, Math.min(1, Number(localStorage.getItem("wca_bgm_volume") ?? 0.28))),
      animation: localStorage.getItem("wca_animation") !== "off"
    };

    let audioContext = null;
    let audioUnlocked = false;
    let bgmNodes = null;
    let currentBgmMode = "";
    let modalReturnFocus = null;
    let authPending = false;
    let submitPending = false;

    function setAuthPending(pending) {
      authPending = !!pending;
      const loginButton = document.getElementById("loginButton");
      const registerButton = document.getElementById("registerButton");
      if (loginButton) loginButton.disabled = authPending;
      if (registerButton) registerButton.disabled = authPending;
    }

    function showModalElement(element) {
      if (!element) return;
      modalReturnFocus = document.activeElement;
      element.classList.remove("modal-closing");
      element.style.display = "flex";
      const focusable = element.querySelector("button,input,select,[tabindex]");
      if (focusable) requestAnimationFrame(() => focusable.focus({ preventScroll:true }));
    }

    function hideModalElement(element) {
      if (!element || element.style.display === "none") return;
      element.classList.add("modal-closing");
      setTimeout(() => {
        element.style.display = "none";
        element.classList.remove("modal-closing");
        if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus({ preventScroll:true });
      }, 180);
    }

    function getAudioContext() {
      if (window.WCA && WCA.Audio) return WCA.Audio.getContext();
      if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        audioContext = new AudioContextClass();
      }
      return audioContext;
    }

    function unlockAudio() {
      if (window.WCA && WCA.Audio) {
        WCA.Audio.unlock();
        return;
      }
      const ctx = getAudioContext();
      if (!ctx) return;
      audioUnlocked = true;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      updateBgmForContext();
    }

    window.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    function connectWithFilter(ctx, destination, filterType = "lowpass", frequency = 4200) {
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      filter.Q.value = 0.7;
      filter.connect(destination);
      return filter;
    }

    function tone(freq, duration = 0.08, type = "sine", volume = 0.035, delay = 0, destination = null, detune = 0) {
      if (!polishSettings.sfx && !destination) return null;
      try {
        const ctx = getAudioContext();
        if (!ctx) return null;
        const output = destination || ctx.destination;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = connectWithFilter(ctx, output, "lowpass", Math.max(900, Math.min(6200, freq * 4)));
        const t = ctx.currentTime + Math.max(0, delay);

        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        osc.detune.setValueAtTime(detune, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * (destination ? 1 : polishSettings.sfxVolume)), t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.03, duration));

        osc.connect(gain);
        gain.connect(filter);
        osc.start(t);
        osc.stop(t + duration + 0.04);
        return osc;
      } catch (err) { return null; }
    }

    function noiseBurst(duration = 0.06, volume = 0.025, delay = 0, highpass = 1200, destination = null) {
      if (!polishSettings.sfx && !destination) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        const t = ctx.currentTime + delay;
        filter.type = "highpass";
        filter.frequency.value = highpass;
        gain.gain.setValueAtTime(volume * (destination ? 1 : polishSettings.sfxVolume), t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        source.buffer = buffer;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(destination || ctx.destination);
        source.start(t);
      } catch (err) {}
    }

    function chord(freqs, duration = 0.22, volume = 0.018, delay = 0, destination = null) {
      freqs.forEach((freq, index) => tone(freq, duration, index === 0 ? "triangle" : "sine", volume, delay + index * 0.006, destination, index * 3));
    }

    function malletHit(delay = 0, accent = false, pitch = 1) {
      if (!polishSettings.sfx) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const t = ctx.currentTime + Math.max(0, delay);
        const output = ctx.destination;

        // Low, rounded "땅" body instead of a high beep/ding.
        const body = ctx.createOscillator();
        const bodyGain = ctx.createGain();
        const bodyFilter = ctx.createBiquadFilter();
        body.type = "triangle";
        body.frequency.setValueAtTime(185 * pitch, t);
        body.frequency.exponentialRampToValueAtTime(118 * pitch, t + 0.13);
        bodyFilter.type = "lowpass";
        bodyFilter.frequency.setValueAtTime(accent ? 1350 : 1050, t);
        bodyGain.gain.setValueAtTime(0.0001, t);
        bodyGain.gain.exponentialRampToValueAtTime((accent ? 0.085 : 0.062) * polishSettings.sfxVolume, t + 0.006);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
        body.connect(bodyFilter);
        bodyFilter.connect(bodyGain);
        bodyGain.connect(output);
        body.start(t);
        body.stop(t + 0.28);

        // Wooden attack gives a game-like impact without sounding like "삐/띵".
        const click = ctx.createOscillator();
        const clickGain = ctx.createGain();
        click.type = "square";
        click.frequency.setValueAtTime(92 * pitch, t);
        clickGain.gain.setValueAtTime((accent ? 0.035 : 0.025) * polishSettings.sfxVolume, t);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
        click.connect(clickGain);
        clickGain.connect(output);
        click.start(t);
        click.stop(t + 0.045);

        noiseBurst(0.028, accent ? 0.012 : 0.008, delay, 260, output);
      } catch (err) {}
    }

    function playCharacterWordSound(length, power = 0) {
      if (window.WCA && WCA.Audio) return WCA.Audio.playWord(length, power);
      if (!polishSettings.sfx) return;
      const count = Math.max(1, Math.min(24, Number(length) || 1));

      // Keep 1-4 letters clearly separated and deliberately slow.
      // Longer words accelerate gradually, but never become a piercing beep burst.
      const step = count <= 4 ? 0.17 : count <= 7 ? 0.135 : count <= 11 ? 0.10 : 0.072;
      const groove = [1, 0.96, 1.04, 0.92, 1.08, 0.98];

      for (let i = 0; i < count; i++) {
        const accent = i === 0 || i === count - 1 || (count >= 8 && i % 4 === 0);
        malletHit(i * step, accent, groove[i % groove.length]);
      }

      const tail = (count - 1) * step + 0.23;

      // Long words get a low percussion fill, not a high-pitched "삐비비빅".
      if (count >= 8) {
        const fillCount = count >= 12 ? 6 : 4;
        for (let j = 0; j < fillCount; j++) {
          malletHit(tail + j * 0.065, j === fillCount - 1, 0.82 + j * 0.035);
        }
      }

      // Subtle musical payoff matching the BGM, kept warm and low.
      if (power === 1) {
        chord([196, 247, 294], 0.24, 0.012, tail + 0.10);
      } else if (power === 2) {
        chord([174.61, 220, 261.63, 329.63], 0.30, 0.014, tail + 0.10);
      } else if (power >= 3) {
        chord([146.83, 196, 246.94, 293.66], 0.38, 0.017, tail + 0.08);
        noiseBurst(0.11, 0.009, tail + 0.12, 500);
      }
    }

    function playSound(name, payload) {
      if (window.WCA && WCA.Audio) return WCA.Audio.playSound(name, payload);
      try {
        if (!polishSettings.sfx) return;
        if (name === "click") { noiseBurst(0.025, 0.012, 0, 1900); tone(480, 0.035, "triangle", 0.012); }
        else if (name === "open") { tone(440, 0.06, "triangle", 0.024); tone(660, 0.09, "sine", 0.028, 0.045); }
        else if (name === "close") { tone(520, 0.05, "triangle", 0.02); tone(300, 0.08, "sine", 0.022, 0.045); }
        else if (name === "success") { chord([659, 831, 988], 0.18, 0.025); noiseBurst(0.06, 0.012, 0.06, 2200); }
        else if (name === "error") { noiseBurst(0.045, 0.016, 0, 300); tone(155, 0.12, "triangle", 0.03); }
        else if (name === "buy") { tone(880, 0.05, "triangle", 0.025); tone(1175, 0.07, "sine", 0.03, 0.045); noiseBurst(0.08, 0.018, 0.075, 2500); }
        else if (name === "achievement") { chord([784, 988, 1319], 0.24, 0.03); noiseBurst(0.12, 0.02, 0.08, 2200); }
        else if (name === "correct") playCharacterWordSound(1, 0);
        else if (name === "longGood") playCharacterWordSound(6, 1);
        else if (name === "longGreat") playCharacterWordSound(9, 2);
        else if (name === "longLegendary") playCharacterWordSound(13, 3);
        else if (name === "turn") { tone(523, 0.05, "triangle", 0.022); tone(784, 0.08, "sine", 0.025, 0.04); }
        else if (name === "matchFound") { chord([392, 523], 0.12, 0.025); chord([659, 784, 988], 0.2, 0.03, 0.11); }
        else if (name === "warning") { tone(880, 0.055, "square", 0.022); noiseBurst(0.025, 0.01, 0, 1700); }
        else if (name === "victory") { chord([523, 659, 784], 0.18, 0.03); chord([659, 831, 1047], 0.32, 0.035, 0.18); noiseBurst(0.18, 0.025, 0.2, 2000); }
        else if (name === "defeat" || name === "fail") { chord([294, 247, 196], 0.28, 0.022); tone(147, 0.32, "sine", 0.018, 0.16); }
        else if (name === "promotion") { chord([523, 659, 784], 0.2, 0.03); chord([659, 831, 1047, 1319], 0.35, 0.034, 0.2); noiseBurst(0.2, 0.024, 0.24, 1800); }
        else if (name === "demotion") { tone(330, 0.11, "triangle", 0.026); tone(247, 0.15, "sine", 0.024, 0.09); tone(165, 0.2, "sine", 0.018, 0.2); }
      } catch (err) {}
    }

    function stopBgm() {
      if (window.WCA && WCA.Audio) return WCA.Audio.stopBgm();
      if (!bgmNodes) return;
      try {
        (bgmNodes.timers || []).forEach(id => clearInterval(id));
        bgmNodes.gain.gain.setTargetAtTime(0.0001, bgmNodes.ctx.currentTime, 0.12);
        (bgmNodes.oscillators || []).forEach(osc => setTimeout(() => { try { osc.stop(); } catch (err) {} }, 220));
      } catch (err) {}
      bgmNodes = null;
      currentBgmMode = "";
    }

    function scheduleBgmNote(ctx, bus, freq, start, duration, type = "triangle", volume = 0.018) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = connectWithFilter(ctx, bus, "lowpass", type === "square" ? 1800 : 3000);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(filter);
      osc.start(start);
      osc.stop(start + duration + 0.03);
      if (bgmNodes) bgmNodes.oscillators.push(osc);
    }

    function scheduleKick(ctx, bus, start, volume = 0.045) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, start);
      osc.frequency.exponentialRampToValueAtTime(48, start + 0.12);
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(start);
      osc.stop(start + 0.15);
      if (bgmNodes) bgmNodes.oscillators.push(osc);
    }

    function scheduleSnare(ctx, bus, start, volume = 0.014) {
      noiseBurst(0.08, volume, Math.max(0, start - ctx.currentTime), 900, bus);
      scheduleBgmNote(ctx, bus, 180, start, 0.07, 'triangle', volume * 0.7);
    }

    function scheduleHat(ctx, bus, start, volume = 0.004) {
      noiseBurst(0.025, volume, Math.max(0, start - ctx.currentTime), 4200, bus);
    }

    function startBgm(mode) {
      if (window.WCA && WCA.Audio) return WCA.Audio.startBgm(mode);
      if (!polishSettings.bgm || !audioUnlocked || !mode) return stopBgm();
      if (currentBgmMode === mode && bgmNodes) return;
      stopBgm();
      const ctx = getAudioContext();
      if (!ctx) return;

      const master = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      master.gain.value = 0.0001;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      master.gain.setTargetAtTime(0.085 * polishSettings.bgmVolume, ctx.currentTime, 0.25);

      const themes = {
        lobby: {
          beat: 0.29,
          chords: [[261.63,329.63,392],[220,277.18,329.63],[174.61,220,261.63],[196,246.94,293.66]],
          bass: [130.81,110,87.31,98],
          lead: [659.25,0,783.99,659.25,587.33,0,523.25,587.33,659.25,0,880,783.99,659.25,587.33,523.25,0]
        },
        normal: {
          beat: 0.22,
          chords: [[220,261.63,329.63],[196,246.94,293.66],[174.61,220,261.63],[196,246.94,329.63]],
          bass: [110,98,87.31,98],
          lead: [440,523.25,0,659.25,587.33,523.25,698.46,0,659.25,523.25,440,523.25,587.33,659.25,523.25,0]
        },
        ranked: {
          beat: 0.185,
          chords: [[174.61,220,261.63],[164.81,207.65,246.94],[146.83,185,220],[155.56,196,233.08]],
          bass: [87.31,82.41,73.42,77.78],
          lead: [349.23,0,440,523.25,466.16,440,0,587.33,523.25,466.16,440,523.25,587.33,698.46,587.33,0]
        }
      };

      const theme = themes[mode] || themes.lobby;
      bgmNodes = { ctx, gain: master, oscillators: [], timers: [] };
      currentBgmMode = mode;
      let step = 0;

      const scheduleStep = () => {
        if (!bgmNodes || currentBgmMode !== mode) return;
        const now = ctx.currentTime + 0.04;
        const beat = theme.beat;
        const barStep = step % 16;
        const chordIndex = Math.floor(barStep / 4) % theme.chords.length;
        const chordFreqs = theme.chords[chordIndex];

        // Warm pad at the start of each phrase.
        if (barStep % 4 === 0) {
          chordFreqs.forEach((freq, i) => scheduleBgmNote(ctx, master, freq, now, beat * 3.85, i === 0 ? 'triangle' : 'sine', mode === 'lobby' ? 0.011 : 0.009));
          scheduleBgmNote(ctx, master, theme.bass[chordIndex], now, beat * 1.65, 'sine', mode === 'ranked' ? 0.024 : 0.019);
        }

        // Bass groove instead of one sustained beep.
        if (barStep % 2 === 0 && barStep % 4 !== 0) {
          scheduleBgmNote(ctx, master, theme.bass[chordIndex] * 1.5, now, beat * 0.55, 'triangle', 0.012);
        }

        // Syncopated arpeggio gives the loop a song-like pulse.
        const arp = chordFreqs[(barStep + chordIndex) % chordFreqs.length] * (barStep % 4 === 3 ? 2 : 1);
        scheduleBgmNote(ctx, master, arp, now + beat * 0.08, beat * 0.48, 'triangle', mode === 'lobby' ? 0.009 : 0.011);

        const lead = theme.lead[barStep];
        if (lead) scheduleBgmNote(ctx, master, lead, now + beat * 0.12, beat * 0.72, 'sine', mode === 'ranked' ? 0.012 : 0.01);

        // Lightweight drums: kick, snare and hats.
        if (barStep % 4 === 0 || (mode === 'ranked' && barStep % 4 === 2)) scheduleKick(ctx, master, now, mode === 'lobby' ? 0.026 : 0.038);
        if (barStep % 4 === 2) scheduleSnare(ctx, master, now, mode === 'lobby' ? 0.007 : 0.012);
        if (mode !== 'lobby' || barStep % 2 === 1) scheduleHat(ctx, master, now + beat * 0.48, mode === 'ranked' ? 0.006 : 0.004);

        step = (step + 1) % 16;
      };

      for (let i = 0; i < 4; i++) scheduleStep();
      bgmNodes.timers.push(setInterval(scheduleStep, theme.beat * 1000));
    }

    function setBgmVolume(value) {
      if (window.WCA && WCA.Audio) WCA.Audio.setBgmVolume(value);
      polishSettings.bgmVolume = Math.max(0, Math.min(1, Number(value)));
      localStorage.setItem("wca_bgm_volume", String(polishSettings.bgmVolume));
      if (bgmNodes) bgmNodes.gain.gain.setTargetAtTime(0.018 * polishSettings.bgmVolume, bgmNodes.ctx.currentTime, 0.08);
      refreshSettingsUI();
    }

    function setSfxVolume(value) {
      if (window.WCA && WCA.Audio) WCA.Audio.setSfxVolume(value);
      polishSettings.sfxVolume = Math.max(0, Math.min(1, Number(value)));
      localStorage.setItem("wca_sfx_volume", String(polishSettings.sfxVolume));
      refreshSettingsUI();
      playSound("click");
    }

    function setMasterVolume(value) {
      polishSettings.masterVolume = Math.max(0, Math.min(1, Number(value)));
      localStorage.setItem("wca_master_volume", String(polishSettings.masterVolume));
      if (window.WCA && WCA.Audio) WCA.Audio.setMasterVolume(polishSettings.masterVolume);
      refreshSettingsUI();
    }

    function resetAudioSettings() {
      polishSettings.sfx = true;
      polishSettings.sound = true;
      polishSettings.bgm = true;
      polishSettings.masterVolume = 0.9;
      polishSettings.bgmVolume = 0.28;
      polishSettings.sfxVolume = 0.95;
      localStorage.setItem("wca_sound", "on");
      localStorage.setItem("wca_sfx", "on");
      localStorage.setItem("wca_bgm", "on");
      localStorage.setItem("wca_master_volume", "0.9");
      localStorage.setItem("wca_bgm_volume", "0.28");
      localStorage.setItem("wca_sfx_volume", "0.95");
      if (window.WCA && WCA.Audio) WCA.Audio.syncSettings(polishSettings);
      refreshSettingsUI();
      updateBgmForContext();
      playSound("success");
    }

    function updateBgmForContext() {
      if (!currentUserNickname) return stopBgm();
      if (latestRoomData && latestRoomData.status === "playing") {
        startBgm(latestRoomData.mode === "ranked" ? "ranked" : "normal");
      } else {
        startBgm("lobby");
      }
    }

    function refreshSettingsUI() {
      const sound = document.getElementById("soundSettingText");
      const sfx = document.getElementById("sfxSettingText");
      const bgm = document.getElementById("bgmSettingText");
      const animation = document.getElementById("animationSettingText");
      const sfxVolume = document.getElementById("sfxVolume");
      const bgmVolume = document.getElementById("bgmVolume");
      const masterVolume = document.getElementById("masterVolume");
      const sfxVolumeText = document.getElementById("sfxVolumeText");
      const bgmVolumeText = document.getElementById("bgmVolumeText");
      const masterVolumeText = document.getElementById("masterVolumeText");

      if (sound) sound.textContent = polishSettings.sfx ? "ON" : "OFF";
      if (sfx) sfx.textContent = polishSettings.sfx ? "ON" : "OFF";
      if (bgm) bgm.textContent = polishSettings.bgm ? "ON" : "OFF";
      if (animation) animation.textContent = polishSettings.animation ? "ON" : "OFF";
      if (sfxVolume) sfxVolume.value = String(Math.round(polishSettings.sfxVolume * 100));
      if (bgmVolume) bgmVolume.value = String(Math.round(polishSettings.bgmVolume * 100));
      if (masterVolume) masterVolume.value = String(Math.round(polishSettings.masterVolume * 100));
      if (sfxVolumeText) sfxVolumeText.textContent = `${Math.round(polishSettings.sfxVolume * 100)}%`;
      if (bgmVolumeText) bgmVolumeText.textContent = `${Math.round(polishSettings.bgmVolume * 100)}%`;
      if (masterVolumeText) masterVolumeText.textContent = `${Math.round(polishSettings.masterVolume * 100)}%`;

      if (document.body) {
        document.body.classList.toggle("polish-on", polishSettings.animation);
      }
    }

    function openSettings() {
      playSound("open");
      refreshSettingsUI();

      const modal = document.getElementById("settingsModal");
      showModalElement(modal);
    }

    let rankedData = {
      placementMatchesPlayed: 0,
      placementTotal: 10,
      rankTier: "Unranked",
      rankDivision: 4,
      rankLP: 0,
      rankedWins: 0,
      rankedLosses: 0,
      rankedWinRate: 0,
      seasonHighestTier: "Unranked",
      seasonHighestLP: 0,
      rankedMatchHistory: []
    };

    const rankTierKo = {
      Unranked: "배치 전",
      Bronze: "브론즈",
      Silver: "실버",
      Gold: "골드",
      Platinum: "플래티넘",
      Diamond: "다이아몬드",
      Emerald: "에메랄드",
      Ruby: "루비",
      Master: "마스터",
      Grandmaster: "그랜드마스터",
      Mythic: "신화"
    };

    function formatRankKo(tier, division) {
      if (!tier || tier === "Unranked") return rankTierKo.Unranked;
      return `${rankTierKo[tier] || tier} ${division || ""}`.trim();
    }

    function formatMs(ms) {
      const value = Number(ms) || 0;
      return value > 0 ? `${(value / 1000).toFixed(2)}초` : "-";
    }

    function formatPlayTime(seconds) {
      const total = Math.max(0, Math.floor(Number(seconds) || 0));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      if (h > 0) return `${h}시간 ${m}분`;
      return `${m}분`;
    }

    function renderCompetitiveData(data = rankedData) {
  rankedData = { ...rankedData, ...(data || {}) };

  const total = rankedData.placementTotal || 10;
  const played = rankedData.placementMatchesPlayed || 0;
  const pct = Math.min(100, Math.round((played / total) * 100));
  const placementText = `${played} / ${total}`;

  const tier = rankedData.rankTier || "Unranked";
  const division = rankedData.rankDivision || 4;
  const tierIcons = {
  Unranked: "❓",
  Bronze: "🥉",
  Silver: "🥈",
  Gold: "🥇",
  Platinum: "💠",
  Diamond: "💎",
  Emerald: "💚",
  Ruby: "❤️",
  Master: "👑",
  Grandmaster: "🔥",
  Mythic: "🌠"
};

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const setWidth = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.style.width = value;
  };

  setWidth("v29PlacementBar", `${pct}%`);
  setText("v29PlacementPreview", placementText);
  setWidth("competitivePlacementBar", `${pct}%`);
  setText("competitivePlacementText", placementText);

  setText("competitiveTierName", formatRankKo(tier, division));
  setText("competitiveTierEmblem", tierIcons[tier] || "❓");
  setText("competitiveMmr", tier === "Unranked" ? "—" : String(division));
  setText("competitiveLp", String(rankedData.rankLP || 0));
  setText("competitiveWins", String(rankedData.rankedWins || 0));
  setText("competitiveLosses", String(rankedData.rankedLosses || 0));
  setText("competitiveWinRate", `${rankedData.rankedWinRate || 0}%`);
  setText("competitiveStreak", placementText);
  setText("competitivePeak", rankedData.seasonHighestTier || "Unranked");
  setText("competitiveSeasonLp", String(rankedData.seasonHighestLP || 0));

  const hero = document.querySelector(".competitive-hero");
  if (hero) {
    let ux = document.getElementById("competitiveV33Ux");
    if (!ux) {
      ux = document.createElement("div");
      ux.id = "competitiveV33Ux";
      ux.className = "competitive-v33-ux";
      hero.appendChild(ux);
    }
    const lpPct = tier === "Unranked" ? pct : Math.max(0, Math.min(100, rankedData.rankLP || 0));
    const recentForm = (rankedData.recentForm || []).length
      ? rankedData.recentForm.map(form => `<span class="${form === "W" ? "win" : "loss"}">${form}</span>`).join("")
      : `<em>기록 없음</em>`;
    ux.innerHTML = `
      <div class="v33-lp-label"><span>LP 진행도</span><b>${tier === "Unranked" ? placementText : `${rankedData.rankLP || 0} / 100 LP`}</b></div>
      <div class="v33-lp-track"><div style="width:${lpPct}%"></div></div>
      <div class="v33-ranked-mini">
        <span>시즌 경기 <b>${rankedData.seasonGames || 0}</b></span>
        <span>현재 연승 <b>${rankedData.currentWinStreak || 0}</b></span>
        <span>최고 연승 <b>${rankedData.highestWinStreak || 0}</b></span>
      </div>
      <div class="v33-ranked-form">최근 폼 ${recentForm}</div>
      <div class="v33-peak-badge">피크 ${formatRankKo(rankedData.seasonHighestTier, rankedData.rankDivision)} · ${rankedData.seasonHighestLP || 0} LP</div>
    `;
  }

  document.querySelectorAll(".competitive-tier-row").forEach(row => {
    row.classList.toggle("current", row.dataset.tier === tier.toLowerCase());
  });

  const history = document.getElementById("competitiveMatchHistory");
  if (history) {
    const matches = rankedData.rankedMatchHistory || [];
    history.innerHTML = matches.length
      ? matches.slice(0, 10).map(match => {
          const isWin = match.result === "win";
          const day = new Date(match.date).toLocaleDateString();
          const transition = match.oldTier === match.newTier
            ? match.newTier
            : `${match.oldTier} → ${match.newTier}`;
          return `
            <div class="ranked-history-card ${isWin ? "win" : "loss"}">
              <div>
                <strong>${isWin ? "✔ 승리" : "✖ 패배"}</strong>
                <small>${escapeHtml(day)}</small>
              </div>
              <div>${escapeHtml(transition)}</div>
              <b>${match.lpChange > 0 ? "+" : ""}${match.lpChange} LP</b>
            </div>
          `;
        }).join("")
      : `<div class="ranked-empty">아직 랭크 전적이 없습니다.</div>`;
  }

  renderSeasonRewardsPreview(tier);
}

function renderSeasonRewardsPreview(currentTier = "Unranked") {
  const box = document.getElementById("competitiveRewardsPreview");
  if (!box) return;

  const tiers = [
    ["Bronze", "🥉", "브론즈 프로필 테두리"],
    ["Silver", "🥈", "실버 명찰"],
    ["Gold", "🥇", "골드 시즌 칭호"],
    ["Platinum", "💠", "플래티넘 배경"],
    ["Diamond", "💎", "다이아 이펙트"],
    ["Emerald", "💚", "에메랄드 배경"],
    ["Ruby", "❤️", "루비 입장 이펙트"],
    ["Master", "👑", "마스터 오라"],
    ["Grandmaster", "🔥", "그랜드마스터 배지"],
    ["Mythic", "🌠", "신화 전용 코스메틱"]
  ];

  box.innerHTML = tiers.map(([name, icon, reward]) => `
    <div class="season-reward-card ${name === currentTier ? "current" : ""}">
      <span>${icon}</span>
      <strong>${name}</strong>
      <small>${reward}</small>
    </div>
  `).join("");
}

    function openCompetitiveSeason() {
      playSound("open");
      renderCompetitiveData();
      showModalElement(document.getElementById("competitiveModal"));
      socket.emit("getRankedData");
      socket.emit("getRankedLeaderboard");
    }

    function renderRankedLeaderboard(board) {

    const box = document.getElementById("competitiveLeaderboard");

    if (!box) return;

    const tierIcons = {
        Bronze: "🥉",
        Silver: "🥈",
        Gold: "🥇",
        Platinum: "💠",
        Diamond: "💎",
        Emerald: "💚",
        Ruby: "❤️",
        Master: "👑",
        Grandmaster: "🔥",
        Mythic: "🌠"
    };

    const tierKo = {
        Bronze: "브론즈",
        Silver: "실버",
        Gold: "골드",
        Platinum: "플래티넘",
        Diamond: "다이아몬드",
        Emerald: "에메랄드",
        Ruby: "루비",
        Master: "마스터",
        Grandmaster: "그랜드마스터",
        Mythic: "신화"
    };

    if (!board.length) {
        box.innerHTML = `
        <div class="competitive-placeholder">
        아직 랭크 플레이어가 없습니다.
        </div>`;
        return;
    }

    box.innerHTML = board.map((p, i) => {
        const tier = p.rankTier || "Unranked";
        const tierName = tierKo[tier] || (tier === "Unranked" ? "배치전" : tier);
        const division = tier === "Unranked" ? "" : ` ${p.rankDivision || ""}`;
        const lp = Number.isFinite(Number(p.rankLP)) ? Number(p.rankLP) : 0;
        return `
        <div class="ranked-leaderboard-row v33-ranked-row">
            <strong>#${i + 1}</strong>
            <span>${tierIcons[tier] || "📋"} ${escapeHtml(p.nickname || "Unknown")}</span>
            <span>${formatRankKo(tier, p.rankDivision)}</span>
            <b>${lp} LP</b>
            <small>${p.rankedWins || 0}W ${p.rankedLosses || 0}L · ${p.rankedWinRate || 0}%</small>
        </div>`;
    }).join("");

}

    function closeCompetitiveSeason() {
      playSound("close");
      hideModalElement(document.getElementById("competitiveModal"));
    }

    function joinRankedQueue() {
      if (!currentUserNickname) return showToast("로그인 후 랭크 매칭을 이용할 수 있습니다.");
      const status = document.getElementById("competitiveQueueStatus");
      if (status) status.textContent = "상대를 찾는 중...";
      runOnce("rankedMatch", () => socket.emit("rankedMatch", { playerId }), 1200);
    }

    renderCompetitiveData();

    function closeSettings() {
      playSound("close");

      const modal = document.getElementById("settingsModal");
      hideModalElement(modal);
    }

    function toggleSetting(key) {
      polishSettings[key] = !polishSettings[key];

      if (key === "sound") {
        polishSettings.sfx = polishSettings.sound;
        localStorage.setItem("wca_sound", polishSettings[key] ? "on" : "off");
        localStorage.setItem("wca_sfx", polishSettings.sfx ? "on" : "off");
      }
      if (key === "sfx") {
        polishSettings.sound = polishSettings.sfx;
        localStorage.setItem("wca_sound", polishSettings.sfx ? "on" : "off");
        localStorage.setItem("wca_sfx", polishSettings.sfx ? "on" : "off");
      }
      if (key === "bgm") {
        localStorage.setItem("wca_bgm", polishSettings.bgm ? "on" : "off");
        updateBgmForContext();
      }
      if (key === "animation") localStorage.setItem("wca_animation", polishSettings[key] ? "on" : "off");

      if (window.WCA && WCA.Audio) WCA.Audio.syncSettings(polishSettings);
      refreshSettingsUI();
      playSound("click");
    }

    let polishToastTimer = null;
    function showToast(text) {
      const toast = document.getElementById("polishToast");
      if (!toast) return;

      toast.textContent = text;
      toast.style.display = "block";

      clearTimeout(polishToastTimer);
      polishToastTimer = setTimeout(() => {
        if (toast.textContent === text) toast.style.display = "none";
      }, 1800);
    }

    document.addEventListener("click", (event) => {
      if (event.target && event.target.closest && event.target.closest("button")) {
        playSound("click");
      }
      if (!event.target.closest("#playerContextMenu")) closePlayerContextMenu();
    });

    const dismissibleModalSelector = ".profile-modal,.ranking-modal,.achievement-modal,.settings-modal,.shop-modal,.premium-modal,.competitive-modal";
    document.addEventListener("click", event => {
      if (event.target && event.target.matches && event.target.matches(dismissibleModalSelector)) hideModalElement(event.target);
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      const openModals = [...document.querySelectorAll(dismissibleModalSelector)].filter(modal => getComputedStyle(modal).display !== "none");
      const topModal = openModals.sort((a,b)=>(Number(getComputedStyle(a).zIndex)||0)-(Number(getComputedStyle(b).zIndex)||0)).pop();
      if (topModal) {
        event.preventDefault();
        hideModalElement(topModal);
      }
    });

    refreshSettingsUI();


    let myRoomCode = "";
    let mySocketId = "";
    let isHost = false;
    let latestRooms = [];
    let currentUserNickname = "";
    let currentUserProfile = null;
    let shownAchievementKey = "";
    let lastPlayersMarkup = "";
    let lastUsedWordsMarkup = "";
    let latestRoomData = null;
    let lastWordEventId = 0;
    let lastCountdownBeepKey = "";
    let lastMatchFeelKey = "";
    let pendingPartyInvite = null;
    let partyInviteInterval = null;
    let contextPlayer = null;
    let latestNotifications = [];
    let pingTimer = null;

    function setConnectionStatus(state, label) {
      const pill = document.getElementById("connectionStatus");
      const banner = document.getElementById("reconnectBanner");
      if (pill) {
        pill.textContent = label || state;
        pill.className = `connection-pill ${state || "unknown"}`;
      }
      if (banner) {
        const disconnected = state === "offline" || state === "reconnecting";
        banner.textContent = state === "reconnecting" ? "연결 복구 중..." : "서버 연결이 끊어졌습니다. 자동으로 재연결합니다.";
        banner.classList.toggle("show", disconnected);
      }
    }

    function updatePingDisplay(ms) {
      const el = document.getElementById("pingDisplay");
      if (!el) return;
      el.textContent = Number.isFinite(ms) ? `${Math.max(0, Math.round(ms))}ms` : "--ms";
    }

    function startPingMonitor() {
      if (pingTimer) clearInterval(pingTimer);
      const tick = () => {
        if (!socket.connected) return updatePingDisplay(NaN);
        const sentAt = Date.now();
        socket.timeout(1200).emit("clientPing", sentAt, (err) => {
          if (err) return updatePingDisplay(NaN);
          updatePingDisplay(Date.now() - sentAt);
        });
      };
      tick();
      pingTimer = setInterval(tick, 5000);
    }

    let playerId = sessionStorage.getItem("wordChainPlayerId");
    if (!playerId) {
      playerId = "p_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      sessionStorage.setItem("wordChainPlayerId", playerId);
    }

    socket.on("connect", () => {
      mySocketId = socket.id;
      setConnectionStatus("online", "온라인");
      startPingMonitor();
      loadRoomList();
      setAuthPending(false);

      const savedNickname = localStorage.getItem("wordChainNickname");
      const savedToken = localStorage.getItem("wordChainToken");

      if (savedNickname && savedToken) {
        socket.emit("autoLogin", { nickname: savedNickname, token: savedToken });
      }
    });

    function register() {
      if (authPending) return;
      const nickname = document.getElementById("authNickname").value.trim();
      const password = document.getElementById("authPassword").value;

      setAuthPending(true);
      socket.emit("register", { nickname, password });
    }

    function togglePassword(id) {
      const input = document.getElementById(id);
      input.type = input.type === "password" ? "text" : "password";
      input.focus();
    }

    function login() {
      if (authPending) return;
      const nickname = document.getElementById("authNickname").value.trim();
      const password = document.getElementById("authPassword").value;

      setAuthPending(true);
      socket.emit("login", { nickname, password });
    }

    function logout() {
      localStorage.removeItem("wordChainNickname");
      localStorage.removeItem("wordChainToken");
      currentUserNickname = "";
      document.getElementById("authBox").style.display = "block";
      document.getElementById("lobby").style.display = "none";
      stopBgm();
      socket.emit("logout");
    }


    function styledNameHtml(name, style = {}, extraClass = "") {
      const safeName = String(name || "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#039;"
      }[ch]));

      const gradientClass = style.nameGradient === "rainbow" ? "rainbow-name" : "";
      const colorStyle = style.nameColor ? `style="color:${style.nameColor};"` : "";

      return `<span class="styled-name ${gradientClass} ${extraClass}" ${colorStyle}>${safeName}</span>`;
    }

    function cosmeticColor(value, fallback = "#8c72ff") {
      if (!value) return fallback;
      let hash = 0;
      for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
      return `hsl(${Math.abs(hash) % 360} 82% 67%)`;
    }

    function applyCosmeticSurface(element, style = {}) {
      if (!element) return;
      element.classList.toggle("cosmetic-background", !!style.profileBackground);
      element.classList.toggle("cosmetic-border", !!style.profileBorder);
      element.style.setProperty("--cosmetic-bg", cosmeticColor(style.profileBackground, "rgba(100,90,220,.38)"));
      element.style.setProperty("--cosmetic-border", cosmeticColor(style.profileBorder));
    }

    function applyCurrentUserProfile(profile) {
      if (!profile) return;

      currentUserProfile = profile;

      const displayName = profile.displayName || profile.nickname || currentUserNickname;
      const style = profile.style || {};

      const currentUserName = document.getElementById("currentUserName");
      if (currentUserName) {
        currentUserName.innerHTML = styledNameHtml(displayName, style);
      }

      const v20Name = document.getElementById("v20CurrentUserName");
      if (v20Name) {
        v20Name.innerHTML = styledNameHtml(displayName, style, "lobby-name-preview");
      }
      applyCosmeticSurface(document.querySelector(".v23-player"), style);
    }

    function showLoggedIn(nickname, token, profile = null) {
      currentUserNickname = nickname;
      localStorage.setItem("wordChainNickname", nickname);
      localStorage.setItem("wordChainToken", token);

      if (profile) {
        applyCurrentUserProfile(profile);
      } else {
        document.getElementById("currentUserName").textContent = nickname;
        const v20Name = document.getElementById("v20CurrentUserName");
        if (v20Name) v20Name.textContent = nickname;
      }

      document.getElementById("authBox").style.display = "none";
      document.getElementById("lobby").style.display = "block";
      updateBgmForContext();
    }




    function toggleV23Panel(id) {
      const target = document.getElementById(id);
      if (!target) return;
      target.classList.toggle("active");
    }

    function updateV23LobbyProfile(profile) {
      if (!profile) return;

      const style = profile.style || {};
      const displayName = profile.displayName || profile.nickname || currentUserNickname;

      const nameEl = document.getElementById("v23PlayerName");
      if (nameEl) nameEl.innerHTML = `${style.profileBadgeIcon ? `<span class="profile-badge-icon">${style.profileBadgeIcon}</span>` : ""}${styledNameHtml(displayName, style)}`;
      applyCosmeticSurface(document.querySelector(".v23-player"), style);

      const levelEl = document.getElementById("v23PlayerLevel");
      if (levelEl) levelEl.textContent = `Lv.${profile.level || 1}`;

      const titleEl = document.getElementById("v23PlayerTitle");
      if (titleEl) titleEl.textContent = profile.selectedTitle || "칭호 없음";

      const xpText = document.getElementById("v23XpText");
      if (xpText) xpText.textContent = `${profile.xp || 0} / ${profile.nextXp || 0}`;

      const xpBar = document.getElementById("v23XpBar");
      if (xpBar) xpBar.style.width = `${profile.xpPercent || 0}%`;

      const coins = document.getElementById("v23Coins");
      if (coins) coins.textContent = profile.coins || 0;

      const wins = document.getElementById("v23Wins");
      if (wins) wins.textContent = profile.wins || 0;

      const winRate = document.getElementById("v23WinRate");
      if (winRate) winRate.textContent = `${profile.winRate || 0}%`;

      const growth = document.getElementById("v23Growth");
      if (growth) growth.textContent = profile.growthPower || 0;

      const devPill = document.getElementById("v23DevPill");
      if (devPill) devPill.style.display = profile.isDev ? "inline-block" : "none";
    }

    const actionCooldowns = new Map();
    function runOnce(key, callback, delay=700) {
      if (actionCooldowns.has(key)) return;
      callback();
      const timer=setTimeout(()=>actionCooldowns.delete(key),delay);
      actionCooldowns.set(key,timer);
    }

    function randomMatch() {
      if (!currentUserNickname) {
        return alert("로그인 먼저 해주세요.");
      }

      showNotice("🎲 랜덤 매칭\n\n공개 대기방을 찾는 중...", 1800);
      runOnce("randomMatch",()=>socket.emit("randomMatch", { playerId }),1200);
    }

    function openAiBattle() {
      if (!currentUserNickname) return showNotice("로그인 후 AI 대전을 이용할 수 있습니다.", 2200);
      playSound("open");
      showModalElement(document.getElementById("aiBattleModal"));
    }

    function closeAiBattle() {
      playSound("close");
      hideModalElement(document.getElementById("aiBattleModal"));
    }

    function startAiBattle() {
      if (!currentUserNickname) return showNotice("로그인 후 AI 대전을 이용할 수 있습니다.", 2200);
      const difficulty = document.getElementById("aiDifficulty")?.value || "normal";
      const botCount = Number(document.getElementById("aiBotCount")?.value || 1);
      const personality = document.getElementById("aiPersonality")?.value || "balanced";
      const button = document.getElementById("aiBattleStartButton");
      if (button) {
        button.disabled = true;
        button.textContent = "AI 경기 생성 중...";
      }
      runOnce("createAiBattle", () => socket.emit("createAiBattle", {
        playerId,
        difficulty,
        botCount,
        personality
      }), 1500);
      setTimeout(() => {
        if (button) {
          button.disabled = false;
          button.textContent = "🤖 AI 대전 시작";
        }
      }, 1800);
    }

    function createRoom() {
      const password = document.getElementById("roomPassword").value.trim();
      const isPublic = document.getElementById("roomPublic").value === "public";
      const botCount = Number(document.getElementById("botCount").value);
      const botDifficulty = document.getElementById("botDifficulty").value;

      if (!currentUserNickname) return alert("로그인 먼저 해주세요.");
      runOnce("createRoom",()=>socket.emit("createRoom", { password, playerId, isPublic, botCount, botDifficulty }),1200);
    }

    function joinRoom() {
      const roomCode = document.getElementById("roomCodeInput").value.trim();
      const password = document.getElementById("joinPassword").value.trim();

      if (!currentUserNickname) {
        return alert("로그인 먼저 해주세요.");
      }

      if (!roomCode) {
        return alert("방번호를 입력하세요.");
      }

      isHost = false;

      runOnce("joinRoom",()=>socket.emit("joinRoom", { roomCode, password, playerId }),1200);
    }

    function loadRoomList() {
      socket.emit("getRoomList");
    }

    function fillRoomCode(code) {
      document.getElementById("roomCodeInput").value = code;
      document.getElementById("roomCodeInput").scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function renderRoomList() {
      const searchInput = document.getElementById("roomSearch");
      const keyword = searchInput ? searchInput.value.trim().toLowerCase() : "";
      const roomList = document.getElementById("roomList");

      let rooms = latestRooms;

      if (keyword) {
        rooms = rooms.filter(room =>
          room.code.includes(keyword) ||
          room.hostName.toLowerCase().includes(keyword) ||
          room.title.toLowerCase().includes(keyword)
        );
      }

      rooms = rooms.slice(0, 10);

      if (rooms.length === 0) {
        roomList.innerHTML = "표시할 공개방이 없습니다.";
        return;
      }

      roomList.innerHTML = rooms.map(room => {
        const statusIcon = room.status === "waiting" ? "🟢 대기중" :
          room.status === "playing" ? "🔴 게임중" :
          "⚫ 종료";

        const roomAction = room.status === "waiting"
          ? `<button onclick="fillRoomCode('${room.code}')">참가 준비</button>`
          : room.status === "playing"
            ? `<button onclick="spectateRoom('${room.code}')">👀 관전</button>`
            : `<button disabled>종료</button>`;
        const lock = room.locked ? "🔒" : "🌍";

        return `
          <div class="room-card">
            <div>${lock} ${room.title}</div>
            <div class="room-meta">방번호: ${room.code} / 👥 ${room.players}/${room.maxPlayers}${room.spectators ? ` / 👀 ${room.spectators}` : ""} / ${statusIcon}</div>
            ${roomAction}
          </div>
        `;
      }).join("");
    }
    function spectateRoom(roomCode){runOnce("spectate",()=>socket.emit("spectateRoom",{roomCode,playerId}),1000);}

    function getActiveRoomCode() {
      return myRoomCode || (document.getElementById("roomCode") ? document.getElementById("roomCode").textContent.trim() : "");
    }

    function startGame() {
      runOnce("startGame",()=>socket.emit("startGame", getActiveRoomCode()),1000);
    }

    function toggleReady() {
      runOnce("toggleReady",()=>socket.emit("toggleReady", getActiveRoomCode()),500);
    }

    function requestRematch() {
      runOnce("rematch",()=>socket.emit("requestRematch", myRoomCode),1000);
    }

    function saveRoomSettings(){
      const settings={title:document.getElementById("ownerRoomTitle").value,maxPlayers:Number(document.getElementById("ownerMaxPlayers").value)};
      const password=document.getElementById("ownerRoomPassword").value;
      if(password)settings.password=password;
      socket.emit("updateRoomSettings",settings);
      document.getElementById("ownerRoomPassword").value="";
    }
    function toggleRoomLock(){socket.emit("updateRoomSettings",{locked:!latestRoomData?.isLocked});}
    function toggleSpectators(){socket.emit("updateRoomSettings",{spectatorsEnabled:!latestRoomData?.spectatorsEnabled});}
    function toggleRoomChat(){socket.emit("updateRoomSettings",{chatEnabled:!latestRoomData?.chatEnabled});}
    function saveRoomAnnouncement(){socket.emit("setRoomAnnouncement",{text:document.getElementById("ownerAnnouncement").value,color:document.getElementById("ownerAnnouncementColor").value});}
    function switchWatchedPlayer(playerId){if(playerId)socket.emit("switchWatchedPlayer",{playerId});}
    function leaveCurrentRoom(){if(myRoomCode)socket.emit("leaveRoom",{roomCode:myRoomCode});}

    function formatDuration(seconds) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;

      if (m <= 0) return `${s}초`;
      return `${m}분 ${s}초`;
    }


    let profileRequestPending = false;
    function openProfileByNickname(nickname) {
      profileRequestPending = true;
      socket.emit("getProfile", { nickname });
    }

    function closeProfile() {
      hideModalElement(document.getElementById("profileModal"));
    }

    function showProfile(profile) {
      const modal = document.getElementById("profileModal");
      const name = document.getElementById("profileName");
      const content = document.getElementById("profileContent");

      const displayName = profile.displayName || profile.nickname;
      name.textContent = `${profile.selectedTitle || ""} ${displayName}`;
      if (profile.style && profile.style.profileBadgeIcon) name.textContent = `${profile.style.profileBadgeIcon} ${name.textContent}`;

      const nextRewardText = profile.nextLevelReward
        ? `Lv.${profile.nextLevelReward.level} / ${profile.nextLevelReward.coins || 0}코인${profile.nextLevelReward.title ? " / " + profile.nextLevelReward.title : ""}${profile.nextLevelReward.itemId ? " / 아이템" : ""}`
        : "모든 레벨 보상 획득!";

      const recentMatches = (profile.recentMatches || []).slice(0, 20);
      const recentHtml = recentMatches.length
        ? recentMatches.map(match => `
          <div class="v33-history-row ${match.result === "win" ? "win" : "loss"}">
            <div><strong>${match.result === "win" ? "승리" : "패배"}</strong><small>${new Date(match.date).toLocaleDateString("ko-KR")} · ${match.ranked ? "랭크" : "일반"}</small></div>
            <div>${escapeHtml((match.opponents || []).join(", ") || "상대 없음")}</div>
            <b>${match.xpEarned || 0}XP · ${match.coinsEarned || 0}코인${match.ranked ? ` · ${match.lpChange > 0 ? "+" : ""}${match.lpChange || 0}LP` : ""}</b>
          </div>
        `).join("")
        : `<div class="premium-empty">최근 경기 기록이 없습니다.</div>`;
      const v33StatsHtml = `
        <div class="v33-profile-section">
          <h3>플레이어 진행도</h3>
          <div class="v33-profile-grid">
            <div>현재 랭크<strong>${formatRankKo(profile.rankTier, profile.rankDivision)} · ${profile.rankLP || 0} LP</strong></div>
            <div>랭크 전적<strong>${profile.rankedWins || 0}승 ${profile.rankedLosses || 0}패 · ${profile.rankedWinRate || 0}%</strong></div>
            <div>시즌 최고<strong>${formatRankKo(profile.seasonHighestTier, profile.rankDivision)} · ${profile.seasonHighestLP || 0} LP</strong></div>
            <div>전체 전적<strong>${profile.totalMatches || profile.games || 0}전 ${profile.totalWins || profile.wins || 0}승 ${profile.totalLosses || profile.losses || 0}패</strong></div>
            <div>최고 콤보<strong>${profile.highestCombo || 0} COMBO</strong></div>
            <div>최장 단어<strong>${escapeHtml(profile.longestWord || "-")} ${profile.longestWordLength ? `(${profile.longestWordLength}글자)` : ""}</strong></div>
            <div>평균 단어 길이<strong>${profile.averageWordLength || 0}글자</strong></div>
            <div>최고 빠른 답<strong>${formatMs(profile.fastestValidWordMs)}</strong></div>
            <div>평균 응답<strong>${formatMs(profile.averageTurnTimeMs)}</strong></div>
            <div>총 플레이 시간<strong>${formatPlayTime(profile.totalPlayTimeSeconds)}</strong></div>
            <div>MVP<strong>${profile.mvpCount || 0}회</strong></div>
            <div>선호 시작/끝 글자<strong>${profile.favoriteStartingCharacter || "-"} / ${profile.favoriteEndingCharacter || "-"}</strong></div>
          </div>
        </div>
        <div class="v33-profile-section">
          <h3>최근 경기 기록</h3>
          <div class="v33-history-list">${recentHtml}</div>
        </div>
      `;

      content.innerHTML = `
        <div class="growth-profile-hero profile-showcase">
          <div class="profile-showcase-avatar">${profile.style&&profile.style.profileBadgeIcon?profile.style.profileBadgeIcon:"⚔"}</div>
          <div><div class="growth-level">Lv.${profile.level} · Prestige ${profile.prestige||0}</div>
          <div class="growth-name">${styledNameHtml(displayName, profile.style || {})}</div>
          <div class="growth-season">${profile.season || "Season 1"} · ${profile.favoriteTitle || profile.selectedTitle || "칭호 없음"}</div>
          <div class="xp-progress-wrap"><div class="xp-progress-bar" style="width:${profile.xpPercent || 0}%"></div></div>
          <div style="font-size:13px; opacity:0.9;">XP ${profile.xp} / ${profile.level>=100?"MAX":profile.nextXp} · 프레스티지 XP +${profile.prestigeXpBonus||0}%</div></div>
        </div>

        <div class="growth-stat-grid">
          <div class="growth-stat-card">💰 코인<strong>${profile.coins}</strong></div>
          <div class="growth-stat-card">🏆 승리<strong>${profile.wins}</strong></div>
          <div class="growth-stat-card">🎮 게임<strong>${profile.games}</strong></div>
          <div class="growth-stat-card">📈 승률<strong>${profile.winRate}%</strong></div>
          <div class="growth-stat-card">🔥 현재 연승<strong>${profile.currentWinStreak}</strong></div>
          <div class="growth-stat-card">👑 최고 연승<strong>${profile.bestWinStreak}</strong></div>
          <div class="growth-stat-card">📝 사용 단어<strong>${profile.wordsUsed}</strong></div>
          <div class="growth-stat-card">🏅 업적<strong>${profile.achievementPercent || 0}%</strong></div>
          <div class="growth-stat-card">🏛 컬렉션<strong>${profile.collectionPercent || 0}%</strong></div>
          <div class="growth-stat-card">🤝 친구<strong>${profile.friendCount || 0}</strong></div>
          <div class="growth-stat-card">📊 현재 랭크<strong>#${profile.currentRank || "-"}</strong></div>
          <div class="growth-stat-card">⚔️ 경쟁 랭크<strong>${profile.rankDisplay || "Unranked"}</strong></div>
          <div class="growth-stat-card">💠 랭크 LP<strong>${profile.rankLP || 0}</strong></div>
          <div class="growth-stat-card">⭐ 즐겨찾기<strong>${profile.favoriteCosmetic?profile.favoriteCosmetic.icon+" "+profile.favoriteCosmetic.name:"없음"}</strong></div>
          <div class="growth-stat-card growth-wide">🎁 다음 보상<br><strong style="font-size:15px;">${nextRewardText}</strong></div>
        </div>

        <div class="profile-row"><span>🎖 보유 칭호</span><span>${(profile.titles || []).join(", ")}</span></div>
        <div class="profile-row"><span>🎨 꾸미기</span><span>${profile.style && profile.style.nameEffect ? profile.style.nameEffect : "기본"}</span></div>
        <div class="profile-row"><span>🛡 테두리</span><span>${profile.currentCosmetics?.profileBorder?.name||"기본"}</span></div>
        <div class="profile-row"><span>🌌 배경</span><span>${profile.currentCosmetics?.profileBackground?.name||"기본"}</span></div>
        <div class="profile-row"><span>💬 채팅 효과</span><span>${profile.currentCosmetics?.chatEffect?.name||"기본"}</span></div>
        <div class="profile-row"><span>🚪 입장 효과</span><span>${profile.currentCosmetics?.entranceEffect?.name||"기본"}</span></div>
        <div class="profile-row"><span>🏆 승리 효과</span><span>${profile.currentCosmetics?.victoryEffect?.name||"기본"}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button onclick="openCollection('${profile.nickname}')">🏛 컬렉션 보기</button><button onclick="openAchievementsFor('${profile.nickname}')">🏅 업적 보기</button>${profile.nickname===currentUserNickname&&profile.canPrestige?`<button class="prestige-button" onclick="requestPrestige()">♛ PRESTIGE</button>`:""}</div>
      `;

      content.insertAdjacentHTML("beforeend", v33StatsHtml);

      modal.classList.remove("profile-border-gold");
      if (profile.style && profile.style.profileBorder === "gold") {
        modal.classList.add("profile-border-gold");
      }
      applyCosmeticSurface(modal.querySelector(".profile-card"), profile.style || {});

      showModalElement(modal);
    }

    function renderMatchResult(room) {
      const resultBox = document.getElementById("resultBox");
      const result = room.matchResult || {};
      const order = result.eliminationOrder || [];
      const rewards = result.rewards || [];

      const rewardHtml = rewards.length > 0
        ? rewards.map(item => {
            const rewardPlayer = (room.players || []).find(player => player.nickname === item.nickname);
            const rewardStyle = rewardPlayer && rewardPlayer.style ? rewardPlayer.style : {};
            const breakdown = item.breakdown && item.breakdown.length
              ? `<div class="reward-breakdown">${item.breakdown.map(b => `• ${b.label}: +${b.xp}XP / +${b.coins}코인`).join("<br>")}</div>`
              : "";

            const levelText = item.leveledUp
              ? `<span class="levelup-badge ${rewardStyle.levelUpEffect ? "levelup-effect-active" : ""}">LEVEL UP! Lv.${item.levelBefore} → Lv.${item.level}</span>`
              : `Lv.${item.level}`;

            const levelRewardHtml = item.levelRewards && item.levelRewards.length
              ? `<div class="level-reward-line">🎁 레벨 보상: ${item.levelRewards.map(r => `Lv.${r.level} +${r.coins || 0}코인${r.title ? " / " + r.title : ""}${r.itemId ? " / 아이템" : ""}`).join(", ")}</div>`
              : "";

            return `
              <div class="reward-card ${item.result === "win" && rewardStyle.victoryEffect ? "victory-effect-active" : ""}">
                <div>${item.result === "win" ? "🏆" : "💀"} ${item.nickname}: +${item.xp}XP / +${item.coins}코인 ${levelText}</div>
                <div style="font-size:13px; opacity:0.9; margin-top:4px;">XP ${item.xpAfter || 0} / ${item.nextXp || 0} · 누적 ${item.totalXp || 0}</div>
                ${breakdown}
                ${levelRewardHtml}
                ${item.achievements && item.achievements.length ? "🏅 " + item.achievements.map(a => a.name).join(", ") : ""}
              </div>
            `;
          }).join("")
        : "<div>보상 정보 없음</div>";

      const orderHtml = order.length > 0
        ? order.map((item, index) => `<div>${index + 1}. ${item.nickname} - ${item.reason}</div>`).join("")
        : "<div>탈락자 없음</div>";

      const mvp = result.mvpSummary || null;
      const mvpHtml = mvp ? `
        <div class="v33-mvp-card">
          <div class="v33-mvp-title">🏆 MATCH MVP</div>
          <div class="v33-mvp-name">${escapeHtml(mvp.mvp?.nickname || "-")} <small>${Math.round(mvp.mvp?.score || 0)} pts</small></div>
          <div class="v33-mvp-grid">
            <div>최장 단어<strong>${escapeHtml(mvp.longestWord?.word || "-")} ${mvp.longestWord?.length ? `(${mvp.longestWord.length})` : ""}</strong><small>${escapeHtml(mvp.longestWord?.nickname || "")}</small></div>
            <div>최고 콤보<strong>${mvp.highestCombo?.combo || 0} COMBO</strong><small>${escapeHtml(mvp.highestCombo?.nickname || "")}</small></div>
            <div>가장 빠른 답<strong>${formatMs(mvp.fastestAnswer?.ms)}</strong><small>${escapeHtml(mvp.fastestAnswer?.nickname || "")}</small></div>
          </div>
        </div>
      ` : "";

      resultBox.innerHTML = `
        <div class="result-summary-card">
          <div>⏱ 경기 시간: ${formatDuration(result.durationSec || 0)}</div>
          <div>📝 사용 단어: ${result.usedWordCount || 0}개</div>
        </div>
        <div class="result-summary-card">🎁 보상</div>
        ${rewardHtml}
        <div class="result-summary-card">💀 탈락 순서</div>
        ${orderHtml}
      `;
      if (mvpHtml) resultBox.insertAdjacentHTML("afterbegin", mvpHtml);
    }


    let localNoticeTimer = null;

    function showNotice(text, duration = 2500) {
      const noticeBox = document.getElementById("noticeBox");
      if (!noticeBox) return;

      if (!text) {
        noticeBox.style.display = "none";
        noticeBox.textContent = "";
        return;
      }

      noticeBox.textContent = text;
      noticeBox.style.display = "block";

      if (localNoticeTimer) {
        clearTimeout(localNoticeTimer);
        localNoticeTimer = null;
      }

      localNoticeTimer = setTimeout(() => {
        if (noticeBox.textContent === text) {
          noticeBox.style.display = "none";
          noticeBox.textContent = "";
        }
      }, duration);
    }

    function showWordImpact(event) {
      if (!event || event.id === lastWordEventId) return;
      lastWordEventId = event.id;

      const overlay = document.getElementById("wordImpactOverlay");
      if (!overlay) return;

      const label = event.label || "OK";
      const comboText = event.combo >= 2 ? `<div class="word-impact-combo">${event.combo} COMBO</div>` : "";
      const perfectText = event.perfect ? `<div class="word-impact-perfect">PERFECT</div>` : "";
      const rewardText = event.xp || event.coins ? `<div class="word-impact-reward">+${event.xp} XP · +${event.coins} 코인</div>` : "";

      overlay.className = `word-impact-overlay show power-${event.power || 0}`;
      overlay.innerHTML = `
        <div class="word-impact-word">${escapeHtml(event.word || "")}</div>
        <div class="word-impact-meta">${label} · ${event.length || 0}글자</div>
        ${comboText}${perfectText}${rewardText}
      `;

      playCharacterWordSound(event.length || 1, event.power || 0);

      setTimeout(() => {
        if (lastWordEventId === event.id) overlay.classList.remove("show");
      }, polishSettings.animation ? 1150 : 550);
    }

    function showFinalCountdown(room) {
      const box = document.getElementById("finalCountdownBurst");
      if (!box || !room || room.status !== "playing") return;
      const left = Number(room.timeLeft);
      if (!Number.isFinite(left) || left < 1 || left > 5) {
        box.classList.remove("show");
        if (window.WCA && WCA.Audio) WCA.Audio.setBgmTension(99);
        return;
      }
      if (window.WCA && WCA.Audio) WCA.Audio.setBgmTension(left);
      const key = `${room.turnPlayerId || ""}:${(room.usedWords || []).length}:${left}`;
      if (key === lastCountdownBeepKey) return;
      lastCountdownBeepKey = key;
      box.textContent = String(left);
      box.classList.remove("show");
      void box.offsetWidth;
      box.classList.add("show");
      playSound("warning");
    }

    function showMatchFeelOverlay(room) {
      if (!room || room.status !== "gameover") return;
      const rewards = room.matchResult && room.matchResult.rewards ? room.matchResult.rewards : [];
      const mine = rewards.find(item => item.nickname === currentUserNickname);
      const key = `${myRoomCode}:${room.matchEndedAt || room.winnerText || ""}:${mine ? mine.result : "spectator"}`;
      if (key === lastMatchFeelKey) return;
      lastMatchFeelKey = key;

      const overlay = document.getElementById("matchFeelOverlay");
      if (!overlay) return;

      const won = mine && mine.result === "win";
      const ranked = mine && mine.ranked;
      const lpText = ranked ? `<div class="match-feel-lp">${ranked.lpChange >= 0 ? "+" : ""}${ranked.lpChange || 0} LP · ${ranked.newTier || ""}</div>` : "";
      overlay.className = `match-feel-overlay show ${won ? "victory" : "defeat"}`;
      overlay.innerHTML = `
        <div class="match-feel-title">${won ? "VICTORY" : "DEFEAT"}</div>
        <div class="match-feel-sub">${escapeHtml(room.winnerText || "")}</div>
        ${lpText}
      `;

      playSound(won ? "victory" : "defeat");
      setTimeout(() => overlay.classList.remove("show"), polishSettings.animation ? 2400 : 1000);
    }

    function submitWord() {
      if (submitPending) return;
      const wordInput = document.getElementById("wordInput");
      const submitButton = document.getElementById("submitButton");
      if (!wordInput || wordInput.disabled || (submitButton && submitButton.disabled)) return;
      const word = wordInput.value.trim();
      if (!word) return;

      submitPending = true;
      if (submitButton) submitButton.disabled = true;
      socket.emit("submitWord", { roomCode: myRoomCode, word });
      wordInput.value = "";
      wordInput.focus();
    }

    function copyRoomCode() {
      if (!myRoomCode) return;

      navigator.clipboard.writeText(myRoomCode)
        .then(() => {
          const message = document.getElementById("message");
          message.textContent = `방번호 ${myRoomCode} 복사 완료!`;

          setTimeout(() => {
            if (message.textContent.includes("복사 완료")) {
              message.textContent = "";
            }
          }, 2000);
        })
        .catch(() => {
          alert("복사 실패! 방번호를 직접 복사해 주세요: " + myRoomCode);
        });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && document.activeElement.id === "wordInput") {
        event.preventDefault();
        submitWord();
      }

      if (event.key === "Enter" && document.activeElement.id === "authPassword") {
        event.preventDefault();
        login();
      }
    });

    let latestRecommendedWords = [];

    function fillRecommendedWord(word) {
      const wordInput = document.getElementById("wordInput");
      wordInput.value = word;
      wordInput.focus();
    }

    function renderRecommendations() {
      const recommendedWords = document.getElementById("recommendedWords");
      const toggle = document.getElementById("recommendToggle");

      if (!recommendedWords || !toggle) return;

      if (!toggle.checked) {
        recommendedWords.innerHTML = "추천 단어 숨김";
        return;
      }

      if (!latestRecommendedWords || latestRecommendedWords.length === 0) {
        recommendedWords.innerHTML = "추천 단어 없음";
        return;
      }

      recommendedWords.innerHTML = latestRecommendedWords.map(word =>
        `<button class="recommend-button" onclick="fillRecommendedWord('${word}')">${word}</button>`
      ).join("");
    }



    function sendChat() {
      const chatInput = document.getElementById("chatInput");
      const text = chatInput.value.trim();

      if (!text || !myRoomCode) return;

      socket.emit("sendChat", { roomCode: myRoomCode, text });
      chatInput.value = "";
      socket.emit("roomTyping",{roomCode:myRoomCode,typing:false});
    }
    let typingStopTimer=null;
    const activeTypers=new Set();
    function sendTyping(){if(!myRoomCode)return;socket.emit("roomTyping",{roomCode:myRoomCode,typing:true});clearTimeout(typingStopTimer);typingStopTimer=setTimeout(()=>socket.emit("roomTyping",{roomCode:myRoomCode,typing:false}),1200);}

    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && document.activeElement.id === "chatInput") {
        event.preventDefault();
        sendChat();
      }
    });

    socket.on("authSuccess", ({ nickname, token, profile }) => {
      setAuthPending(false);
      dailyPopupShown = false;
      showLoggedIn(nickname, token, profile);
      if (myRoomCode) {
        socket.emit("joinRoom", { roomCode: myRoomCode, password: "", playerId });
      }
      playSound("success");
      const displayName = profile && profile.displayName ? profile.displayName : nickname;
      showNotice(`✅ 로그인 성공!\n\n${displayName}`, 1800);
    });

    socket.on("rankedData", data => {
      renderCompetitiveData(data);
      const status = document.getElementById("competitiveQueueStatus");
      if (status) status.textContent = "";
    });

    socket.on("rankedLeaderboard", (board) => {
  renderRankedLeaderboard(board || []);
});

    socket.on("authError", (msg) => {
      setAuthPending(false);
      if (msg !== "자동 로그인 실패") {
        showNotice(`❌ ${msg}`, 2500);
      }
    });

    socket.on("connect_error", () => {
      setConnectionStatus("offline", "연결 오류");
      setAuthPending(false);
      submitPending = false;
      const submitButton = document.getElementById("submitButton");
      if (submitButton) submitButton.disabled = false;
    });

    socket.on("disconnect", () => {
      setConnectionStatus("reconnecting", "재연결 중");
      updatePingDisplay(NaN);
      setAuthPending(false);
      submitPending = false;
    });

    socket.on("loggedOut", () => {
      showNotice("로그아웃 완료", 1500);
    });

    socket.on("roomList", (rooms) => {
      latestRooms = rooms || [];
      renderRoomList();
    });

    socket.on("roomCreated", (roomCode) => {
      myRoomCode = roomCode;
      isHost = true;
      lastWordEventId = 0;
      lastCountdownBeepKey = "";
      lastMatchFeelKey = "";
      playSound("matchFound");

      document.getElementById("authBox").style.display = "none";
      document.getElementById("lobby").style.display = "none";
      document.getElementById("game").style.display = "block";
      document.getElementById("roomCode").textContent = roomCode;
    });

    socket.on("aiBattleCreated", ({ difficulty, botCount, personality }) => {
      closeAiBattle();
      const difficultyKo = {
        beginner: "입문",
        easy: "쉬움",
        normal: "보통",
        hard: "어려움",
        expert: "전문가",
        mythic: "신화"
      };
      const personalityKo = {
        balanced: "균형형",
        aggressive: "공격형",
        safe: "안정형",
        longword: "긴 단어형",
        gambler: "도박형"
      };
      showNotice(`🤖 AI 대전\n\n${difficultyKo[difficulty] || difficulty} · ${botCount}명 · ${personalityKo[personality] || personality}`, 2400);
    });

    socket.on("joinedRoom", (roomCode) => {
      myRoomCode = roomCode;
      isHost = false;
      lastWordEventId = 0;
      lastCountdownBeepKey = "";
      lastMatchFeelKey = "";
      playSound("matchFound");

      document.getElementById("lobby").style.display = "none";
      document.getElementById("game").style.display = "block";
      document.getElementById("roomCode").textContent = roomCode;
    });

    socket.on("roomMatched", ({ roomCode, created }) => {
      myRoomCode = roomCode;
      isHost = !!created;

      document.getElementById("lobby").style.display = "none";
      document.getElementById("game").style.display = "block";
      document.getElementById("roomCode").textContent = roomCode;
    });

    socket.on("roomUpdate", (room) => {
      submitPending = false;
      latestRoomData = room;
      updateBgmForContext();
      showWordImpact(room.lastWordEvent);
      showFinalCountdown(room);
      if (room.status !== "gameover") {
        lastMatchFeelKey = "";
      }
      document.getElementById("lobby").style.display = "none";
      document.getElementById("game").style.display = "block";

      document.getElementById("roomCode").textContent = myRoomCode;

      isHost = room.hostId === playerId;
      const ownerPanel=document.getElementById("roomOwnerPanel");
      ownerPanel.classList.toggle("active",isHost);
      if(isHost){
        document.getElementById("ownerRoomTitle").value=room.title||"";
        document.getElementById("ownerMaxPlayers").value=String(room.maxPlayers||8);
      }
      const announcement=document.getElementById("roomAnnouncement");
      announcement.textContent=room.announcement?.text||"";
      announcement.style.color=room.announcement?.color||"#ffd54a";
      announcement.classList.toggle("show",!!room.announcement?.text);

      const statusText =
        room.status === "waiting" ? "🟡 대기중" :
        room.status === "countdown" ? "⏳ 카운트다운" :
        room.status === "playing" ? "🟢 게임중" :
        "🔴 게임오버";

      document.getElementById("status").textContent = statusText;

      if (room.notice) {
        showNotice(room.notice, Math.max(1200, (room.noticeUntil || Date.now() + 2000) - Date.now()));
      }

      document.getElementById("currentWord").textContent = room.currentWord || "없음";

      if (room.currentWord && room.nextStarts && room.nextStarts.length > 0) {
        document.getElementById("nextHint").textContent = `(${room.nextStarts.join("/")})`;
      } else {
        document.getElementById("nextHint").textContent = "";
      }

      const helperBox = document.getElementById("helperBox");

      if (room.status === "playing" && room.currentWord) {
        helperBox.style.display = "block";

        document.getElementById("requiredStarts").textContent =
          room.requiredStarts && room.requiredStarts.length > 0 ? room.requiredStarts.join(" / ") : "-";

        document.getElementById("remainingWordCount").textContent = room.remainingWordCount ?? 0;

        latestRecommendedWords = room.recommendedWords || [];
        renderRecommendations();
      } else {
        helperBox.style.display = "none";
        latestRecommendedWords = [];
      }

      const timerBox = document.querySelector(".timer");
      document.getElementById("timeLimit").textContent = room.timeLeft ?? 20;

      if (room.status === "playing" && (room.timeLeft ?? 20) <= 5) {
        timerBox.classList.add("timer-danger");
      } else {
        timerBox.classList.remove("timer-danger");
      }

      document.getElementById("turnPlayer").textContent =
        room.turnPlayerName ? room.turnPlayerName : "";

      const playersMarkup = room.players.map((p, index) => {
          const icon = p.playerId === room.turnPlayerId && room.status === "playing" && !p.eliminated ? "👑" : (p.isBot ? "🤖" : "⚔️");
          const host = p.playerId === room.hostId ? " 👑방장" : "";
          const offline = p.connected ? "" : " (연결 끊김)";
          const eliminated = p.eliminated ? " 💀탈락" : "";
          const ready = room.status === "waiting" && !p.isBot ? (room.readyPlayers && room.readyPlayers[p.playerId] ? " ✅준비" : " ⏳미준비") : "";
          const cls =
            (p.connected ? "" : "disconnected ") +
            (p.eliminated ? "eliminated" : "");

          const profileText = p.profile ? ` Lv.${p.profile.level} ${p.profile.selectedTitle || ""}` : "";
          const click = p.isBot ? "" : `onclick="openProfileByNickname('${p.nickname}')" oncontextmenu="openPlayerContextMenu(event,'${p.playerId}','${p.nickname}')"`;
          const displayName = p.style && p.style.displayName ? p.style.displayName : p.nickname;
          const badge = p.style && p.style.profileBadgeIcon ? `<span class="profile-badge-icon">${p.style.profileBadgeIcon}</span>` : "";
          const displayHtml = styledNameHtml(displayName, p.style || {});
          const borderStyle = p.style && p.style.profileBorder ? `border-left:3px solid ${cosmeticColor(p.style.profileBorder)};box-shadow:inset 5px 0 12px ${cosmeticColor(p.style.profileBorder)}33;` : "";
          return `<li class="${cls.trim()}" ${click} style="cursor:${p.isBot ? "default" : "pointer"};${borderStyle}">${p.isSpectator?"👀":icon}${profileText} ${badge}${displayHtml}${host}${offline}${eliminated}${ready}</li>`;
        }).join("");
      if (playersMarkup !== lastPlayersMarkup) {
        document.getElementById("players").innerHTML = playersMarkup;
        lastPlayersMarkup = playersMarkup;
      }

      const usedWordsMarkup = room.usedWords.map(w => `<span class="used-card">🍎 ${w}</span>`).join("");
      if (usedWordsMarkup !== lastUsedWordsMarkup) {
        document.getElementById("usedWords").innerHTML = usedWordsMarkup;
        lastUsedWordsMarkup = usedWordsMarkup;
      }

      const countdownBox = document.getElementById("countdownBox");
      if (room.status === "countdown") {
        countdownBox.style.display = "flex";
        countdownBox.textContent = room.countdown || "START";
      } else {
        countdownBox.style.display = "none";
      }

      const readyButton = document.getElementById("readyButton");
      const startButton = document.getElementById("startButton");

      const myReady = room.readyPlayers && room.readyPlayers[playerId];

      readyButton.style.display = room.status === "waiting" ? "inline-block" : "none";
      readyButton.textContent = myReady ? "✅ 준비 완료" : "✅ 준비";
      startButton.style.display = room.status === "waiting" && isHost ? "inline-block" : "none";
      startButton.disabled = !room.canStart;

      const myPlayer = room.players.find(p => p.playerId === playerId);
      const isSpectator = room.status === "playing" && myPlayer && myPlayer.eliminated;
      const actuallySpectating=!!myPlayer?.isSpectator;
      document.getElementById("spectatorBox").style.display = isSpectator||actuallySpectating ? "block" : "none";
      const watched=document.getElementById("watchedPlayerSelect");
      watched.innerHTML=room.players.filter(p=>!p.isSpectator).map(p=>`<option value="${p.playerId}" ${myPlayer?.watchedPlayerId===p.playerId?"selected":""}>${escapeHtml(p.nickname)}</option>`).join("");

      const myTurn = !actuallySpectating && room.status === "playing" && room.turnPlayerId === playerId;
      const wordInput = document.getElementById("wordInput");

      document.getElementById("submitButton").disabled = !myTurn;
      wordInput.disabled = !myTurn;
      document.getElementById("chatInput").disabled = false;
      document.getElementById("chatSendButton").disabled = false;

      const turnBox = document.querySelector(".turn-box");
      if (turnBox) {
        turnBox.classList.toggle("my-turn-glow", myTurn);
      }

      const timerBox2 = document.querySelector(".timer");
      if (timerBox2) {
        timerBox2.classList.toggle("warning", room.status === "playing" && room.timeLeft <= 5);
      }

      if (room.status === "playing" && room.turnPlayerId && room.turnPlayerId !== lastTurnPlayerId) {
        if (room.turnPlayerId === playerId) playSound("turn");
        lastTurnPlayerId = room.turnPlayerId;
      }

      const activeId = document.activeElement ? document.activeElement.id : "";

      if (myTurn && activeId !== "chatInput") {
        wordInput.focus();
      }

      const winnerBox = document.getElementById("winnerBox");
      const winnerName = document.getElementById("winnerName");

      if (room.status === "gameover") {
        document.getElementById("message").textContent = room.gameoverReason || "게임오버!";
        winnerBox.style.display = "block";
        winnerName.textContent = room.winnerText || "승자 없음";
        renderMatchResult(room);
        showMatchFeelOverlay(room);
        document.getElementById("resultBox").style.display = "block";

        const myReward = room.matchResult && room.matchResult.rewards
          ? room.matchResult.rewards.find(r => r.nickname === currentUserNickname)
          : null;

        const achievementKey = myReward && myReward.achievements
          ? myReward.achievements.map(a => a.id).join(",")
          : "";

        if (achievementKey && achievementKey !== shownAchievementKey) {
          shownAchievementKey = achievementKey;
          showAchievementPopup(myReward.achievements);
        }
        document.getElementById("rematchButton").style.display = isHost ? "inline-block" : "none";
      } else {
        winnerBox.style.display = "none";
        winnerName.textContent = "";
        document.getElementById("resultBox").style.display = "none";
        document.getElementById("rematchButton").style.display = "none";

        if (room.lastNotice) {
          document.getElementById("message").textContent = room.lastNotice;
        }
      }
    });


    let latestRankingData = null;
    let currentRankingType = "wins";

    function openRanking() {
      socket.emit("getRankings");
    }

    function closeRanking() {
      hideModalElement(document.getElementById("rankingModal"));
    }

    function getRankTitle(type) {
      if (type === "wins") return "🏆 승리 랭킹";
      if (type === "winRate") return "📈 승률 랭킹 (10판 이상)";
      if (type === "level") return "⭐ 레벨 랭킹";
      if (type === "coins") return "💰 코인 랭킹";
      if (type === "streak") return "🔥 최고 연승 랭킹";
      return "🏆 랭킹";
    }

    function medal(rank) {
      if (rank === 1) return "🥇";
      if (rank === 2) return "🥈";
      if (rank === 3) return "🥉";
      return `#${rank}`;
    }

    function renderRanking(type) {
      if (!latestRankingData) return;

      currentRankingType = type;
      const list = latestRankingData[type] || [];
      const rankingList = document.getElementById("rankingList");
      const myRankBox = document.getElementById("myRankBox");

      if (list.length === 0) {
        rankingList.innerHTML = `<h3>${getRankTitle(type)}</h3><div>아직 랭킹 데이터가 없습니다.</div>`;
      } else {
        rankingList.innerHTML = `
          <h3>${getRankTitle(type)}</h3>
          ${list.map(item => `
            <div class="ranking-row">
              <div class="ranking-rank">${medal(item.rank)}</div>
              <div class="ranking-name">
                ${item.selectedTitle || ""} ${styledNameHtml(item.displayName || item.nickname, item.style || {})}
                <div class="ranking-sub">Lv.${item.level || "-"} · ${item.games || 0}판 · 승률 ${item.winRate || 0}%</div>
              </div>
              <div class="ranking-value">${item.value}</div>
            </div>
          `).join("")}
        `;
      }

      const my = latestRankingData.myRanks || {};
      const myRankText = my[type] ? `${my[type]}위` : "집계 조건 미달";

      myRankBox.innerHTML = `
        <div>👤 내 순위</div>
        <div>${getRankTitle(type)} : ${myRankText}</div>
      `;
    }


    function rarityLabel(rarity) {
      if (rarity === "normal") return "🟢 일반";
      if (rarity === "rare") return "🔵 희귀";
      if (rarity === "epic") return "🟣 영웅";
      if (rarity === "legend") return "🟠 전설";
      return "일반";
    }

    function openAchievements() {
      socket.emit("getAchievements", { nickname: currentUserNickname });
    }
    function openAchievementsFor(nickname) {
      socket.emit("getAchievements", { nickname: nickname || currentUserNickname });
    }

    function closeAchievements() {
      hideModalElement(document.getElementById("achievementModal"));
    }

    function selectTitle(title) {
      socket.emit("selectTitle", { title });
    }

    function showAchievementPopup(items) {
      if (!items || items.length === 0) return;

      const popup = document.getElementById("achievementPopup");
      const first = items[0];

      popup.innerHTML = `
        <div>🏅 업적 달성!</div>
        <div style="font-size:20px; margin-top:4px;">${first.name}</div>
        <div>+${first.xp}XP / +${first.coins}코인</div>
      `;

      playSound("achievement");
      popup.style.display = "block";

      setTimeout(() => {
        popup.style.display = "none";
      }, 3200);
    }

    function renderAchievements(data) {
      const profile = data.profile;
      const achievements = data.achievements || [];

      document.getElementById("achievementSummary").innerHTML = `
        <div class="profile-row"><span>달성 업적</span><span>${profile.achievementCount} / ${profile.achievementTotal}</span></div>
        <div class="profile-row"><span>현재 칭호</span><span>${profile.selectedTitle || "없음"}</span></div>
      `;

      document.getElementById("titleList").innerHTML = (profile.titles || []).map(title => `
        <button class="title-button" onclick="selectTitle('${title}')">
          ${title === profile.selectedTitle ? "✅ " : ""}${title}
        </button>
      `).join("");

      document.getElementById("achievementList").innerHTML = achievements.map(item => `
        <div class="achievement-row ${item.unlocked ? "unlocked" : ""}">
          <div class="rarity-${item.rarity}">${rarityLabel(item.rarity)}</div>
          <div style="font-size:18px;">${item.unlocked ? "✅" : "⬜"} ${item.name}</div>
          <div>${item.desc}</div>
          <div>${item.value} / ${item.target}</div>
          <div class="progress-wrap"><div class="progress-bar" style="width:${item.percent}%"></div></div>
          <div>보상: +${item.xp}XP / +${item.coins}코인 / 칭호 ${item.title}</div>
        </div>
      `).join("");

      showModalElement(document.getElementById("achievementModal"));
    }


    let latestQuestData = null;
    let latestDailyMissionData = null;
    let currentQuestCategory = "starter";
    let latestFriendsData = null;
    let latestDailyLoginData = null;
    let dailyPopupShown = false;
    let pendingBoxReward = null;
    let boxRevealReady = false;
    let boxOpeningTimers = [];
    const whisperHistory = [];
    let activeWhisper = null;
    let latestCollectionData = null;
    let inspectedCollectionNickname = "";
    let collectionRenderTimer = null;
    function scheduleCollectionRender(){clearTimeout(collectionRenderTimer);collectionRenderTimer=setTimeout(renderCollectionItems,90);}

    function openCollection(nickname = currentUserNickname) {
      inspectedCollectionNickname = nickname || currentUserNickname;
      showModalElement(document.getElementById("collectionModal"));
      socket.emit("getCollection",{nickname:inspectedCollectionNickname});
    }

    function renderCollection(data) {
      latestCollectionData=data;
      const hero=document.getElementById("collectionHero");
      hero.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px"><strong>${escapeHtml(data.nickname)}님의 컬렉션</strong><strong>${data.collected} / ${data.total} · ${data.percent}%</strong></div><div class="quest-progress"><div style="width:${data.percent}%"></div></div><div style="font-size:12px;opacity:.75">${data.categories.map(c=>`${c.label} ${c.collected}/${c.total}`).join(" · ")}</div>`;
      document.getElementById("collectionStats").innerHTML=data.categories.map(c=>`<div class="collection-item"><strong>${c.label}</strong><div>${c.collected}/${c.total} · ${c.percent}%</div><div style="font-size:10px;opacity:.7">${Object.entries(c.rarityStats).map(([r,v])=>`${rarityText(r)} ${v.owned}/${v.total}`).join(" · ")}</div><div class="quest-progress"><div style="width:${c.percent}%"></div></div></div>`).join("");
      document.getElementById("collectionMilestones").innerHTML=data.milestones.map(m=>`<div class="collection-milestone ${m.unlocked&&!m.claimed?"ready":""}"><strong>${m.percent}%</strong><div>${m.label}</div>${data.nickname===currentUserNickname?`<button ${!m.unlocked||m.claimed?"disabled":""} onclick="claimCollectionReward(${m.percent})">${m.claimed?"수령 완료":"보상 받기"}</button>`:""}</div>`).join("");
      const category=document.getElementById("collectionCategory");
      const previousCategory=category.value;
      category.innerHTML=`<option value="all">전체 카테고리</option>`+data.categories.map(c=>`<option value="${c.type}">${c.label} (${c.collected}/${c.total})</option>`).join("");
      if([...category.options].some(option=>option.value===previousCategory))category.value=previousCategory;
      renderCollectionItems();
    }

    function renderCollectionItems(){
      if(!latestCollectionData)return;
      const query=(document.getElementById("collectionSearch").value||"").toLowerCase();
      const category=document.getElementById("collectionCategory").value;
      const filter=document.getElementById("collectionFilter").value;
      const sort=document.getElementById("collectionSort").value;
      let items=latestCollectionData.categories.filter(c=>category==="all"||c.type===category).flatMap(c=>c.items.map(item=>({...item,categoryLabel:c.label})));
      items=items.filter(item=>item.name.toLowerCase().includes(query));
      if(filter==="owned")items=items.filter(i=>i.owned);else if(filter==="missing")items=items.filter(i=>!i.owned);else if(["normal","rare","epic","legend","mythic"].includes(filter))items=items.filter(i=>i.rarity===filter);
      if(sort==="alphabetical")items.sort((a,b)=>a.name.localeCompare(b.name,"ko"));else items.reverse();
      document.getElementById("collectionItems").innerHTML=items.map(item=>`<div class="collection-item ${item.owned?"owned":"missing"} ${item.rarity}"><div class="collection-icon">${item.icon}</div><strong>${escapeHtml(item.name)}</strong><div>${item.rarityLabel} · ${item.categoryLabel}</div><small>${item.owned?"✅ 수집 완료":item.exclusive?"🔒 한정 보상":"❔ 미수집"}</small></div>`).join("")||`<div class="premium-empty">조건에 맞는 아이템이 없습니다.</div>`;
    }
    function claimCollectionReward(percent){socket.emit("claimCollectionReward",{percent});}
    function requestPrestige(){if(confirm("레벨과 현재 XP가 초기화됩니다. 프레스티지할까요?"))socket.emit("prestigePlayer");}
    function closePrestigeCelebration(){document.getElementById("prestigeOverlay").classList.remove("active");}

    function showWhisperPopup(message) {
      activeWhisper = message;
      whisperHistory.push(message);
      if (whisperHistory.length > 100) whisperHistory.shift();
      const other = message.from === currentUserNickname ? message.to : message.from;
      document.getElementById("whisperSender").textContent = `💌 ${other}`;
      document.getElementById("whisperTime").textContent = new Date(message.time).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
      document.getElementById("whisperContent").textContent = message.text;
      document.getElementById("whisperPopup").style.display = "block";
    }
    function closeWhisperPopup(){document.getElementById("whisperPopup").style.display="none";}
    function whisperPartner(){return activeWhisper ? (activeWhisper.from===currentUserNickname?activeWhisper.to:activeWhisper.from) : "";}
    function replyWhisper(){const name=whisperPartner();if(name)whisperTo(name);}
    function viewWhisperProfile(){const name=whisperPartner();if(name)openProfileByNickname(name);}
    function addWhisperFriend(){const name=whisperPartner();if(name)addFriend(name);}
    function blockWhisperSender(){const name=whisperPartner();if(name&&confirm(`${name}님을 차단할까요?`)){socket.emit("blockPlayer",{nickname:name});closeWhisperPopup();}}

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function closePremiumModal(id) {
      const modal = document.getElementById(id);
      hideModalElement(modal);
    }

    function rewardText(reward) {
      const parts = [];
      if (reward.coins) parts.push(`💰 ${reward.coins} 코인`);
      if (reward.xp) parts.push(`⭐ ${reward.xp} XP`);
      if (reward.box) parts.push(`📦 상자 ${reward.amount || 1}개`);
      if (reward.itemId) parts.push("🎁 코스메틱");
      if (reward.title) parts.push(`🏷 ${reward.title}`);
      return parts.join(" · ");
    }

    function openQuests() {
      showModalElement(document.getElementById("questModal"));
      socket.emit("getQuests");
      socket.emit("getDailyMissions");
    }

    function renderDailyMissions() {
      const box = document.getElementById("dailyMissionList");
      if (!box) return;
      const missions = latestDailyMissionData && latestDailyMissionData.missions ? latestDailyMissionData.missions : [];
      box.innerHTML = missions.length ? missions.map(mission => `
        <div class="quest-card v33-daily-card ${mission.completed ? "completed" : ""} ${mission.claimed ? "claimed" : ""}">
          <div class="quest-title">${mission.completed ? "✅ " : ""}${escapeHtml(mission.name)}</div>
          <div style="font-size:12px;opacity:.78;">${escapeHtml(mission.desc)}</div>
          <div class="quest-progress"><div style="width:${mission.percent || 0}%"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;"><span>진행도</span><strong>${mission.progress || mission.value || 0} / ${mission.target}</strong></div>
          <div class="quest-reward">${rewardText(mission.reward || {})}</div>
          <button ${!mission.completed || mission.claimed ? "disabled" : ""} onclick="claimDailyMission('${mission.id}')">
            ${mission.claimed ? "수령 완료" : mission.completed ? "보상 받기" : "진행 중"}
          </button>
        </div>
      `).join("") : `<div class="premium-empty">오늘의 미션을 불러오는 중입니다.</div>`;
    }

    function renderQuests(category = currentQuestCategory) {
      currentQuestCategory = category;
      const list = document.getElementById("questList");
      const quests = latestQuestData && latestQuestData.quests
        ? latestQuestData.quests.filter(quest => quest.category === category)
        : [];
      list.innerHTML = quests.length ? quests.map(quest => `
        <div class="quest-card ${quest.completed ? "completed" : ""} ${quest.claimed ? "claimed" : ""}">
          <div class="quest-title">${quest.completed ? "✅ " : ""}${escapeHtml(quest.name)}</div>
          <div style="font-size:12px;opacity:.78;">${escapeHtml(quest.desc)}</div>
          <div class="quest-progress"><div style="width:${quest.percent}%"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;"><span>진행도</span><strong>${quest.value} / ${quest.target}</strong></div>
          <div class="quest-reward">${rewardText(quest.reward)}</div>
          <button ${!quest.completed || quest.claimed ? "disabled" : ""} onclick="claimQuest('${quest.id}')">
            ${quest.claimed ? "수령 완료" : quest.completed ? "보상 받기" : "진행 중"}
          </button>
        </div>
      `).join("") : `<div class="premium-empty">퀘스트를 불러오는 중입니다.</div>`;
    }

    function claimQuest(questId) {
      if (!questId) return;
      socket.emit("claimQuest", { questId });
    }

    function claimDailyMission(missionId) {
      if (!missionId) return;
      socket.emit("claimDailyMission", { missionId });
    }

    function openFriends() {
      showModalElement(document.getElementById("friendsModal"));
      socket.emit("getFriends");
    }

    function searchFriends() {
      const input = document.getElementById("friendSearchInput");
      socket.emit("searchPlayers", { query: input ? input.value : "" });
    }

    function renderFriends(data) {
      latestFriendsData = data || { count: 0, requests: [], friends: [] };
      document.getElementById("friendCount").textContent = `(${latestFriendsData.count || 0})`;
      const requests = document.getElementById("friendRequests");
      if ((latestFriendsData.requests || []).length) {
        requests.innerHTML = `<h3>🔔 받은 요청</h3>` + latestFriendsData.requests.map(name => `
          <div class="friend-row"><div>👤 ${escapeHtml(name)}</div><div class="friend-actions">
            <button onclick="respondFriend('${escapeHtml(name)}',true)">수락</button>
            <button onclick="respondFriend('${escapeHtml(name)}',false)">거절</button>
          </div></div>`).join("");
      } else {
        requests.innerHTML = "";
      }
      const list = document.getElementById("friendList");
      const friendQuery=(document.getElementById("friendSearchInput")?.value||"").toLowerCase();
      const friendFilter=document.getElementById("friendFilter")?.value||"all";
      const friendItems=(latestFriendsData.friends||[]).filter(friend=>friend.nickname.toLowerCase().includes(friendQuery)&&(friendFilter==="all"||friendFilter==="online"&&friend.online||friendFilter==="favorite"&&friend.favorite));
      list.innerHTML = friendItems.length
        ? friendItems.map(friend => `
          <div class="friend-row">
            <div><span class="online-dot ${friend.online ? "on" : ""}"></span><strong>${friend.favorite?"⭐ ":""}${escapeHtml(friend.nickname)}</strong> <span class="presence-badge ${friend.status}">${friend.status}</span>
              <div style="font-size:11px;opacity:.7;margin-top:3px;">${friend.online ? friend.inRoom ? `방 ${escapeHtml(friend.roomCode)}에서 활동 중` : "로비" : "오프라인"}</div>
            </div>
            <div class="friend-actions">
              <button ${!friend.online ? "disabled" : ""} onclick="whisperTo('${escapeHtml(friend.nickname)}')">귓속말</button>
              <button ${!friend.online || !myRoomCode ? "disabled" : ""} onclick="inviteFriend('${escapeHtml(friend.nickname)}')">초대</button>
              <button onclick="toggleFavoriteFriend('${escapeHtml(friend.nickname)}')">${friend.favorite?"★":"☆"}</button>
              <button onclick="removeFriend('${escapeHtml(friend.nickname)}')">삭제</button>
            </div>
          </div>`).join("")
        : `<div class="premium-empty">아직 친구가 없습니다. 플레이어를 검색해 보세요.</div>`;
      const blockedList=document.getElementById("blockedPlayerList");
      blockedList.innerHTML=(latestFriendsData.blocked||[]).length
        ? latestFriendsData.blocked.map(name=>`<div class="friend-row"><div>🚫 ${escapeHtml(name)}</div><div class="friend-actions"><button onclick="unblockPlayer('${escapeHtml(name)}')">차단 해제</button></div></div>`).join("")
        : `<div class="premium-empty">차단한 플레이어가 없습니다.</div>`;
    }

    function renderPlayerSearch(results) {
      const target = document.getElementById("friendSearchResults");
      target.innerHTML = (results || []).length ? results.map(player => `
        <div class="friend-row"><div><span class="online-dot ${player.online ? "on" : ""}"></span>${escapeHtml(player.nickname)}</div>
        <div class="friend-actions"><button ${player.isFriend || player.requested ? "disabled" : ""} onclick="addFriend('${escapeHtml(player.nickname)}')">${player.isFriend ? "친구" : player.requested ? "요청됨" : "친구 추가"}</button></div></div>
      `).join("") : `<div class="premium-empty">검색 결과가 없습니다.</div>`;
    }

    function addFriend(nickname) { socket.emit("sendFriendRequest", { nickname }); }
    function unblockPlayer(nickname){socket.emit("unblockPlayer",{nickname});}
    function respondFriend(nickname, accept) { socket.emit("respondFriendRequest", { nickname, accept }); }
    function removeFriend(nickname) { if (confirm(`${nickname}님을 친구에서 삭제할까요?`)) socket.emit("removeFriend", { nickname }); }
    function inviteFriend(nickname) { socket.emit("inviteFriend", { nickname }); }
    function whisperTo(nickname) {
      const text = prompt(`${nickname}님에게 보낼 귓속말`);
      if (text && text.trim()) socket.emit("whisperFriend", { nickname, text });
    }
    function openPlayerContextMenu(event,playerId,nickname){
      event.preventDefault();event.stopPropagation();
      contextPlayer={playerId,nickname};
      const friend=(latestFriendsData?.friends||[]).find(item=>item.nickname===nickname);
      const menu=document.getElementById("playerContextMenu");
      menu.innerHTML=`<button onclick="openProfileByNickname('${nickname}')">👤 프로필</button>
        ${friend?`<button onclick="inviteFriend('${nickname}')">🎉 파티 초대</button><button onclick="whisperTo('${nickname}')">💌 귓속말</button><button onclick="toggleFavoriteFriend('${nickname}')">${friend.favorite?"★":"☆"} 즐겨찾기</button>`:`<button onclick="addFriend('${nickname}')">➕ 친구 추가</button>`}
        <button onclick="copyNickname('${nickname}')">📋 닉네임 복사</button><button onclick="socket.emit('blockPlayer',{nickname:'${nickname}'})">🚫 차단</button><button onclick="reportPlayer('${nickname}')">⚠ 신고</button>
        ${isHost&&playerId!==latestRoomData?.hostId?`<button onclick="socket.emit('kickPlayer',{playerId:'${playerId}'})">🥾 추방</button><button onclick="socket.emit('transferRoomOwnership',{playerId:'${playerId}'})">👑 방장 위임</button>`:""}`;
      menu.style.left=`${Math.min(event.clientX,window.innerWidth-230)}px`;menu.style.top=`${Math.min(event.clientY,window.innerHeight-360)}px`;menu.style.display="block";
    }
    function closePlayerContextMenu(){document.getElementById("playerContextMenu").style.display="none";}
    function toggleFavoriteFriend(nickname){socket.emit("toggleFavoriteFriend",{nickname});closePlayerContextMenu();}
    function copyNickname(nickname){navigator.clipboard?.writeText(nickname);showToast(`${nickname} 복사 완료`);closePlayerContextMenu();}
    function reportPlayer(nickname){const reason=prompt(`${nickname}님 신고 사유`);if(reason)socket.emit("reportPlayer",{nickname,reason});closePlayerContextMenu();}
    function setSocialStatus(status){socket.emit("setSocialStatus",{status});}

    function openNotifications(){showModalElement(document.getElementById("notificationModal"));socket.emit("getNotifications");}
    function markNotificationsRead(){socket.emit("markNotificationsRead");}
    function renderNotifications(data){
      latestNotifications=data.items||[];
      const count=document.getElementById("notificationCount");count.textContent=data.unread||0;count.classList.toggle("show",(data.unread||0)>0);
      document.getElementById("notificationList").innerHTML=latestNotifications.length?latestNotifications.map(item=>`<div class="notification-row ${item.read?"":"unread"}"><strong>${escapeHtml(item.text)}</strong><div style="font-size:11px;opacity:.65">${new Date(item.time).toLocaleString("ko-KR")}</div></div>`).join(""):`<div class="premium-empty">새 알림이 없습니다.</div>`;
    }
    function showPartyInvite(invite){
      pendingPartyInvite=invite;clearInterval(partyInviteInterval);
      document.getElementById("partyInviteText").textContent=`${invite.from}님이 ${invite.title||invite.roomCode}으로 초대했습니다.`;
      document.getElementById("partyInvitePopup").style.display="block";
      const update=()=>{const left=Math.max(0,Math.ceil((invite.expiresAt-Date.now())/1000));document.getElementById("partyInviteTimer").textContent=`${left}초 후 만료`;if(!left)declinePartyInvite();};
      update();partyInviteInterval=setInterval(update,1000);
    }
    function closePartyInvite(){clearInterval(partyInviteInterval);partyInviteInterval=null;document.getElementById("partyInvitePopup").style.display="none";pendingPartyInvite=null;}
    function acceptPartyInvite(){if(!pendingPartyInvite)return;socket.emit("joinFriendRoom",{roomCode:pendingPartyInvite.roomCode,playerId});closePartyInvite();}
    function declinePartyInvite(){if(pendingPartyInvite)socket.emit("declineRoomInvite",{roomCode:pendingPartyInvite.roomCode});closePartyInvite();}

    function openDailyLogin() {
      showModalElement(document.getElementById("dailyLoginModal"));
      socket.emit("getDailyLogin");
    }

    function renderDailyLogin(data) {
      latestDailyLoginData = data;
      if (!data) return;
      document.getElementById("dailyLoginSummary").innerHTML = `
        <div>🔥 연속 출석 <strong>${data.streak}일</strong></div>
        <div>🏆 누적 출석 <strong>${data.totalDays}일</strong></div>
        <div>🎁 오늘 <strong>DAY ${data.today}</strong></div>
      `;
      const completedInCycle = data.totalDays % 30 || (data.totalDays > 0 ? 30 : 0);
      document.getElementById("dailyCalendar").innerHTML = data.rewards.map(reward => `
        <div class="daily-day ${reward.day <= completedInCycle ? "claimed" : ""} ${reward.day === data.today ? "current" : ""} ${reward.day === 30 ? "legendary" : ""}">
          <strong>DAY ${reward.day}</strong>
          <span>${escapeHtml(reward.label)}</span>
        </div>
      `).join("");
      const button = document.getElementById("dailyClaimButton");
      button.disabled = !data.canClaim;
      button.textContent = data.canClaim ? `DAY ${data.nextDay} 보상 받기` : "오늘 출석 완료";
      if (data.canClaim && !dailyPopupShown) {
        dailyPopupShown = true;
        showModalElement(document.getElementById("dailyLoginModal"));
      }
    }

    function claimDailyLogin() {
      if (latestDailyLoginData && latestDailyLoginData.canClaim) socket.emit("claimDailyLogin");
    }

    function clearBoxOpeningTimers() {
      boxOpeningTimers.forEach(timer => clearTimeout(timer));
      boxOpeningTimers = [];
    }

    function beginBoxOpening(box) {
      clearBoxOpeningTimers();
      pendingBoxReward = null;
      boxRevealReady = false;
      const overlay = document.getElementById("boxOpeningOverlay");
      overlay.className = `box-opening-overlay ${box.id === "legendary" ? "legendary" : ""}`;
      overlay.style.setProperty("--open-color", box.color);
      overlay.style.setProperty("--open-glow", box.glow);
      overlay.style.display = "flex";
      document.getElementById("openingBoxIcon").textContent = box.icon;
      playSound("open");
      boxOpeningTimers.push(setTimeout(() => overlay.classList.add("shaking"), 450));
      boxOpeningTimers.push(setTimeout(() => {
        overlay.classList.remove("shaking");
        overlay.classList.add("charging");
      }, 1250));
      boxOpeningTimers.push(setTimeout(() => {
        overlay.classList.remove("charging");
        overlay.classList.add("explode");
        tone(box.id === "legendary" ? 1280 : 980, .3, "sine", .07);
      }, 2250));
      boxOpeningTimers.push(setTimeout(() => {
        boxRevealReady = true;
        tryRevealBoxReward();
      }, 2700));
      socket.emit("openBox", { boxType: box.id });
    }

    function tryRevealBoxReward() {
      if (!boxRevealReady || !pendingBoxReward) return;
      const reward = pendingBoxReward;
      const overlay = document.getElementById("boxOpeningOverlay");
      let icon = "🎁";
      let text = "";
      let sub = `천장 ${reward.pity} / ${reward.pityLimit}`;
      if (reward.kind === "coins") { icon = "💰"; text = `${reward.amount} 코인`; }
      if (reward.kind === "xp") { icon = "⭐"; text = `${reward.amount} XP`; }
      if (reward.kind === "item") {
        icon = "🎁";
        text = reward.item.name;
        sub = `${reward.item.rarityLabel}${reward.duplicate ? ` · 중복 보상 ${reward.duplicateCoins} 코인` : ""}`;
      }
      document.getElementById("openingRewardIcon").textContent = icon;
      document.getElementById("openingRewardText").textContent = text;
      document.getElementById("openingRewardSub").textContent = sub;
      document.getElementById("openingRewardTitle").textContent = reward.pityTriggered ? "천장 보상!" : "보상 획득";
      overlay.classList.add("revealed");
      playSound("achievement");
    }

    function closeBoxOpening() {
      clearBoxOpeningTimers();
      const overlay = document.getElementById("boxOpeningOverlay");
      overlay.style.display = "none";
      overlay.className = "box-opening-overlay";
      pendingBoxReward = null;
    }

    function flyCoins() {
      const wallet = document.getElementById("shopCoins");
      if (!wallet) return;
      const target = wallet.getBoundingClientRect();
      for (let i = 0; i < 7; i++) {
        const coin = document.createElement("div");
        coin.className = "coin-flight";
        coin.textContent = "🪙";
        coin.style.left = `${window.innerWidth / 2 + (Math.random() - .5) * 100}px`;
        coin.style.top = `${window.innerHeight / 2 + (Math.random() - .5) * 80}px`;
        coin.style.setProperty("--coin-x", `${target.left - window.innerWidth / 2}px`);
        coin.style.setProperty("--coin-y", `${target.top - window.innerHeight / 2}px`);
        document.body.appendChild(coin);
        setTimeout(() => coin.remove(), 950);
      }
    }

    let latestShopData = null;
    let currentShopType = "all";
    let selectedBoxType = "common";
    let selectedShopItemId = "";

    function rarityText(rarity) {
      if (rarity === "normal") return "⚪ 일반";
      if (rarity === "rare") return "🔵 희귀";
      if (rarity === "epic") return "🟣 영웅";
      if (rarity === "legend") return "🟠 전설";
      if (rarity === "mythic") return "🔴 신화";
      return "일반";
    }

    function openShop() {
      socket.emit("getShop");
    }

    function closeShop() {
      hideModalElement(document.getElementById("shopModal"));
    }

    function buyItem(itemId) {
      const item = latestShopData && latestShopData.items
        ? latestShopData.items.find(i => i.id === itemId)
        : null;

      const message = item
        ? `${item.name}\n\n가격: ${item.price}코인\n필요 레벨: Lv.${item.minLevel || 1}\n\n구매할까요?`
        : "이 아이템을 구매할까요?";

      if (!confirm(message)) return;
      runOnce(`buyItem:${itemId}`,()=>socket.emit("buyItem", { itemId }),900);
    }

    function equipItem(itemId) {
      runOnce(`equip:${itemId}`,()=>socket.emit("equipItem", { itemId }),500);
    }

    function unequipItem(type) {
      runOnce(`unequip:${type}`,()=>socket.emit("unequipItem", { type }),500);
    }

    function getBoxShopEntries() {
      const defaults = [
        { id: "common", name: "일반 상자", price: 100, icon: "📦", color: "#b8c4d6", glow: "rgba(184,196,214,0.30)", pityLimit: 10, cosmeticChance: 8, coinRange: [40, 120], xpRange: [20, 70], rarityText: "일반 · 희귀" },
        { id: "rare", name: "희귀 상자", price: 500, icon: "💎", color: "#62b8ff", glow: "rgba(98,184,255,0.34)", pityLimit: 10, cosmeticChance: 18, coinRange: [180, 550], xpRange: [90, 260], rarityText: "일반 · 희귀 · 영웅" },
        { id: "epic", name: "영웅 상자", price: 2000, icon: "🔮", color: "#c479ff", glow: "rgba(196,121,255,0.36)", pityLimit: 15, cosmeticChance: 30, coinRange: [700, 2200], xpRange: [350, 900], rarityText: "희귀 · 영웅 · 전설" },
        { id: "legendary", name: "전설 상자", price: 10000, icon: "👑", color: "#ffd54a", glow: "rgba(255,213,74,0.38)", pityLimit: 20, cosmeticChance: 50, coinRange: [3500, 11000], xpRange: [1500, 4000], rarityText: "영웅 · 전설" }
      ];
      const catalog = latestShopData && Array.isArray(latestShopData.boxCatalog)
        ? latestShopData.boxCatalog
        : latestShopData && Array.isArray(latestShopData.boxTypes)
          ? latestShopData.boxTypes
          : [];
      const ownedCounts = latestShopData && latestShopData.boxes ? latestShopData.boxes : {};
      const pityCounts = latestShopData && latestShopData.boxPity ? latestShopData.boxPity : {};

      return defaults.map(fallback => {
        const serverBox = catalog.find(box => box && box.id === fallback.id) || {};
        return {
          ...fallback,
          ...serverBox,
          owned: Math.max(0, Number(serverBox.owned ?? ownedCounts[fallback.id]) || 0),
          pity: Math.max(0, Number(serverBox.pity ?? pityCounts[fallback.id]) || 0)
        };
      });
    }

    function selectBoxPreview(boxType) {
      const box = getBoxShopEntries().find(entry => entry.id === boxType);
      if (!box) return;
      selectedBoxType = boxType;

      document.querySelectorAll(".box-shop-item").forEach(card => {
        card.classList.toggle("selected", card.dataset.boxType === boxType);
      });

      const preview = document.querySelector(".shop-remake-preview");
      const avatar = preview && preview.querySelector(".shop-preview-avatar");
      const previewName = document.getElementById("shopPreviewName");
      const previewDetail = document.getElementById("shopPreviewDetail");
      if (preview) {
        preview.classList.add("box-preview-active");
        preview.style.setProperty("--preview-color", box.color);
        preview.style.setProperty("--preview-glow", box.glow);
      }
      if (avatar) avatar.textContent = box.icon;
      if (previewName) {
        previewName.textContent = box.name;
        previewName.style.color = box.color;
      }
      if (previewDetail) {
        previewDetail.innerHTML = `
          <div style="color:${box.color};font-size:13px;margin-bottom:8px;">보유 ${box.owned}개 · 코스메틱 확률 ${box.cosmeticChance}%</div>
          <div class="box-reward-preview">
            <div class="box-reward-row"><span>💰 코인</span><strong>${box.coinRange[0].toLocaleString()} ~ ${box.coinRange[1].toLocaleString()}</strong></div>
            <div class="box-reward-row"><span>⭐ 경험치</span><strong>${box.xpRange[0].toLocaleString()} ~ ${box.xpRange[1].toLocaleString()} XP</strong></div>
            <div class="box-reward-row"><span>🎁 코스메틱</span><strong>${box.rarityText}</strong></div>
            <div class="box-reward-row"><span>🛡 천장 보장</span><strong>${box.pityLimit}회</strong></div>
          </div>
        `;
      }
    }

    function buyBox(boxType) {
      const box = getBoxShopEntries().find(entry => entry.id === boxType);
      if (!box || !confirm(`${box.name}\n\n가격: ${box.price}코인\n\n구매할까요?`)) return;
      runOnce(`buyBox:${boxType}`,()=>socket.emit("buyBox", { boxType }),900);
    }

    function openOwnedBox(boxType) {
      const box = getBoxShopEntries().find(entry => entry.id === boxType);
      if (!box || box.owned < 1) return;
      beginBoxOpening(box);
    }


    function shopTypeTitle(type) {
      const titles = {
        all: "전체 아이템",
        boxes: "상자",
        nameColor: "닉네임 색상",
        nameEffect: "이름 효과",
        chatBubble: "채팅 말풍선",
        profileBorder: "프로필 테두리",
        profileBackground: "프로필 배경",
        profileBadge: "대표 배지",
        entranceEffect: "입장 효과",
        chatEffect: "채팅 효과",
        victoryEffect: "승리 효과",
        levelUpEffect: "레벨업 효과",
        title: "프리미엄 칭호"
      };
      return titles[type] || "아이템";
    }

    function shopItemIcon(item) {
      if (item && item.icon) return item.icon;
      const name = item && item.name ? item.name.trim() : "🎁";
      return [...name][0] || "🎁";
    }

    function previewShopItem(item) {
      if (!item) return;
      selectedShopItemId = item.id;

      const previewName = document.getElementById("shopPreviewName");
      const previewDetail = document.getElementById("shopPreviewDetail");
      const previewPanel = document.querySelector(".shop-remake-preview");
      const previewAvatar = previewPanel && previewPanel.querySelector(".shop-preview-avatar");
      const typeLabels = {
        nameColor:"닉네임 컬러", chatBubble:"채팅 말풍선", entranceEffect:"입장 연출",
        victoryEffect:"승리 연출", profileBorder:"프로필 테두리", title:"칭호",
        levelUpEffect:"레벨업 연출", profileBadge:"프로필 배지",
        chatEffect:"채팅 이펙트", profileBackground:"프로필 배경", nameEffect:"닉네임 효과"
      };
      if (previewAvatar) previewAvatar.textContent = item.icon || "🎁";
      if (previewPanel) {
        previewPanel.classList.toggle("cosmetic-background", item.type === "profileBackground");
        previewPanel.classList.toggle("cosmetic-border", item.type === "profileBorder");
        previewPanel.style.setProperty("--cosmetic-bg", cosmeticColor(item.value));
        previewPanel.style.setProperty("--cosmetic-border", cosmeticColor(item.value));
      }

      if (previewName) {
        previewName.innerHTML = `${shopItemIcon(item)} ${item.name}`;
      }

      if (previewDetail) {
        previewDetail.innerHTML = `
          <div style="color:#fff176; margin-bottom:6px;">${item.rarityLabel || rarityText(item.rarity)} · Lv.${item.minLevel || 1}</div>
          <div style="margin-bottom:6px;color:#b8c8ff;">${typeLabels[item.type] || item.type}</div>
          <div>${item.preview || item.description || "아이템 설명 없음"}</div>
          <div style="margin-top:8px;opacity:.72;">${item.description || ""}</div>
          <div style="margin-top:8px; color:#b8ffcf;">💰 ${item.price}코인</div>
        `;
      }
    }

    function selectShopItem(item) {
      previewShopItem(item);
      document.querySelectorAll("#shopList .shop-remake-item").forEach(card => card.classList.remove("selected"));
      const card = document.querySelector(`#shopList .shop-remake-item[data-item-id="${item.id}"]`);
      if (card) card.classList.add("selected");
    }


    function renderShop(type = currentShopType) {
      if (!latestShopData) return;

      currentShopType = type;

      const list = document.getElementById("shopList");
      const previousScrollTop = list ? list.scrollTop : 0;
      const inventory = latestShopData.inventory || [];
      const equipped = latestShopData.equipped || {};
      const items = latestShopData.items || [];
      const filtered = type === "all" ? items : items.filter(item => item.type === type);

      const ownedCount = inventory.length;
      const equippedCount = Object.values(equipped).filter(v => v && v !== "default").length;

      const wallet = document.getElementById("shopCoins");
      if (wallet) {
        wallet.innerHTML = `
          <div>💰 보유 코인 <strong>${latestShopData.coins}</strong></div>
          <div style="font-size:12px; opacity:0.8;">Lv.${latestShopData.level || 1} · 보유 ${ownedCount}개 · 장착 ${equippedCount}개</div>
        `;
      }

      const categoryTitle = document.getElementById("shopCategoryTitle");
      if (categoryTitle) categoryTitle.textContent = shopTypeTitle(type);

      const mini = document.getElementById("shopInventoryMini");
      if (mini) mini.textContent = `${filtered.length}개 표시`;

      if (!list) return;
      list.classList.add("shop-remake-grid");
      document.querySelectorAll(".shop-remake-sidebar button").forEach(button => {
        button.classList.toggle("active", button.getAttribute("onclick") === `renderShop('${type}')`);
      });

      if (type === "boxes") {
        const boxes = getBoxShopEntries();
        if (mini) mini.textContent = `보유 ${boxes.reduce((sum, box) => sum + box.owned, 0)}개`;
        list.innerHTML = boxes.map(box => {
          const pityPercent = Math.min(100, (box.pity / box.pityLimit) * 100);
          return `
            <div class="shop-remake-item box-shop-item ${selectedBoxType === box.id ? "selected" : ""}"
                 data-box-type="${box.id}"
                 style="--box-color:${box.color};--box-glow:${box.glow}"
                 onclick="selectBoxPreview('${box.id}')">
              <div>
                <div class="shop-remake-badges">
                  <span class="shop-remake-badge">보유 ${box.owned}개</span>
                  <span class="shop-remake-badge">코스메틱 ${box.cosmeticChance}%</span>
                </div>
                <div class="shop-remake-item-icon">${box.icon}</div>
                <div class="shop-remake-item-name">${box.name}</div>
                <div class="shop-remake-item-desc">코인, XP 또는 상점 코스메틱을 획득합니다.</div>
                <div class="box-pity-track"><div class="box-pity-fill" style="width:${pityPercent}%"></div></div>
                <div class="box-pity-label"><span>천장 진행도</span><strong>${box.pity} / ${box.pityLimit}</strong></div>
                <div class="shop-remake-price">💰 ${box.price}코인</div>
              </div>
              <div class="shop-remake-actions">
                <button onclick="event.stopPropagation(); buyBox('${box.id}')">구매</button>
                <button ${box.owned < 1 ? "disabled" : ""} onclick="event.stopPropagation(); openOwnedBox('${box.id}')">열기 (${box.owned})</button>
              </div>
            </div>
          `;
        }).join("");

        selectBoxPreview(selectedBoxType);
        requestAnimationFrame(()=>{ list.scrollTop=previousScrollTop; });
        showModalElement(document.getElementById("shopModal"));
        return;
      }

      const shopPreview = document.querySelector(".shop-remake-preview");
      const shopPreviewAvatar = shopPreview && shopPreview.querySelector(".shop-preview-avatar");
      const shopPreviewName = document.getElementById("shopPreviewName");
      if (shopPreview) {
        shopPreview.classList.remove("box-preview-active");
        shopPreview.style.removeProperty("--preview-color");
        shopPreview.style.removeProperty("--preview-glow");
      }
      if (shopPreviewAvatar) shopPreviewAvatar.textContent = "👤";
      if (shopPreviewName) shopPreviewName.style.removeProperty("color");

      list.innerHTML = filtered.map(item => {
        const owned = item.owned || inventory.includes(item.id);
        const isEquipped = item.equipped || (item.type === "title" ? latestShopData.selectedTitle === item.value : equipped[item.type] === item.id);
        const locked = item.locked || ((latestShopData.level || 1) < (item.minLevel || 1));
        const exclusive = !!item.exclusive;
        const rarityColors = {normal:["#9aa6ba","rgba(154,166,186,.22)"],rare:["#52b8ff","rgba(82,184,255,.24)"],epic:["#c479ff","rgba(196,121,255,.25)"],legend:["#ffd54a","rgba(255,213,74,.25)"],mythic:["#ff477e","rgba(255,71,126,.30)"]};
        const rarityStyle = rarityColors[item.rarity] || rarityColors.normal;

        return `
          <div class="shop-remake-item ${owned ? "owned" : ""} ${isEquipped ? "equipped" : ""} ${locked ? "locked" : ""} ${selectedShopItemId===item.id?"selected":""}" data-item-id="${item.id}" style="--item-color:${rarityStyle[0]};--item-glow:${rarityStyle[1]}" onclick="selectShopItem(latestShopData.items.find(i => i.id === '${item.id}'))">
            <div>
              <div class="shop-remake-badges">
                <span class="shop-remake-badge">${item.rarityLabel || rarityText(item.rarity)}</span>
                ${item.tag ? `<span class="shop-remake-badge">🏷 ${item.tag}</span>` : ""}
                ${locked ? `<span class="shop-remake-badge">🔒 Lv.${item.minLevel}</span>` : ""}
                ${owned ? `<span class="shop-remake-badge">🎒 보유</span>` : ""}
                ${isEquipped ? `<span class="shop-remake-badge">✅ 장착</span>` : ""}
                ${exclusive ? `<span class="shop-remake-badge">🏛 한정 보상</span>` : ""}
              </div>
              <div class="shop-remake-item-icon">${shopItemIcon(item)}</div>
              <div class="shop-remake-item-name">${item.name}</div>
              <div class="shop-remake-item-desc">${item.preview || ""}</div>
              <div class="shop-remake-price">💰 ${item.price}코인</div>
            </div>

            <div class="shop-remake-actions">
              ${owned
                ? `<button ${isEquipped ? "disabled" : ""} onclick="event.stopPropagation(); equipItem('${item.id}')">${isEquipped ? "장착중" : "장착"}</button>
                   <button onclick="event.stopPropagation(); unequipItem('${item.type}')">해제</button>`
                : `<button ${locked || exclusive ? "disabled" : ""} onclick="event.stopPropagation(); buyItem('${item.id}')">${exclusive ? "보상 전용" : locked ? "잠김" : "구매"}</button>`}
            </div>
          </div>
        `;
      }).join("");

      const equippedNameColor = items.find(item => item.id === equipped.nameColor);
      const equippedNameEffect = items.find(item => item.id === equipped.nameEffect);

      let previewText = currentUserNickname || "WordChain Player";

      if (equippedNameEffect && equippedNameEffect.value === "sparkle") {
        previewText = `✨ ${previewText} ✨`;
      } else if (equippedNameEffect && equippedNameEffect.value === "devil") {
        previewText = `👿 ${previewText} 👿`;
      } else if (equippedNameEffect && equippedNameEffect.value === "crown") {
        previewText = `👑 ${previewText} 👑`;
      }

      const previewStyle = {
        nameColor: equippedNameColor && equippedNameColor.value !== "rainbow" ? equippedNameColor.value : "",
        nameGradient: equippedNameColor && equippedNameColor.value === "rainbow" ? "rainbow" : ""
      };

      const previewName = document.getElementById("shopPreviewName");
      const previewDetail = document.getElementById("shopPreviewDetail");

      const selectedItem = items.find(item => item.id === selectedShopItemId && (type === "all" || item.type === type));
      if (selectedItem) {
        previewShopItem(selectedItem);
      } else {
        if (previewName) previewName.innerHTML = styledNameHtml(previewText, previewStyle);
        if (previewDetail) previewDetail.textContent = "아이템을 선택하면 이곳에서 효과를 미리 볼 수 있습니다.";
      }
      requestAnimationFrame(()=>{ list.scrollTop=previousScrollTop; });

      showModalElement(document.getElementById("shopModal"));
    }

    function applyNicknameStyle(element, style) {
      if (!element || !style) return;

      if (style.nameColor) {
        element.style.color = style.nameColor;
      }

      if (style.displayName) {
        element.textContent = style.displayName;
      }
    }

    function showRankEventOverlay(type, text) {
  const overlay = document.getElementById("rankEventOverlay");
  if (!overlay) return;

  document.getElementById("rankEventTitle").textContent =
    type === "placement" ? "PLACEMENT COMPLETE!" :
    type === "demotion" ? "RANK DOWN" : "PROMOTION!";

  document.getElementById("rankEventIcon").textContent =
    type === "placement" ? "🏆" :
    type === "demotion" ? "⬇️" : "🎉";

  document.getElementById("rankEventText").textContent = text || "";

  overlay.style.display = "flex";
  playSound(type === "demotion" ? "demotion" : "promotion");
}

function closeRankEventOverlay() {
  const overlay = document.getElementById("rankEventOverlay");
  if (overlay) overlay.style.display = "none";
}

    socket.on("profileData", (profile) => {
      if (profile && profile.nickname === currentUserNickname) {
        applyCurrentUserProfile(profile);
      }
      if (profileRequestPending) {
        profileRequestPending = false;
        showProfile(profile);
      }
    });

    socket.on("achievementData", (data) => {
      renderAchievements(data);
    });

    socket.on("shopData", (data) => {
      latestShopData = data;
      renderShop(currentShopType);
    });

    socket.on("shopNotice", (msg) => {
      playSound("buy");
      flyCoins();
      showToast(msg);
      showNotice(`🛒 상점\n\n${msg}`, 2200);
    });

    socket.on("boxResult", (reward) => {
      if (!reward) return;
      pendingBoxReward = reward;
      tryRevealBoxReward();
    });

    socket.on("questData", (data) => {
      latestQuestData = data;
      renderQuests(currentQuestCategory);
    });

    socket.on("dailyMissionData", (data) => {
      latestDailyMissionData = data;
      renderDailyMissions();
    });

    socket.on("dailyMissionClaimed", ({ rewards, achievements }) => {
      playSound("achievement");
      showNotice(`오늘의 미션 완료!\n\n${(rewards || []).join(" · ")}`, 2600);
      if (achievements && achievements.length) showAchievementPopup(achievements);
    });

    socket.on("collectionData", renderCollection);
    socket.on("collectionRewardClaimed", ({percent,rewards}) => {
      playSound("achievement");
      showNotice(`🏛 컬렉션 ${percent}% 달성!\n\n${(rewards||[]).join(" · ")}`,3500);
      if(percent===100) document.getElementById("prestigeOverlay").classList.add("active");
    });
    socket.on("prestigeComplete", ({prestige,title}) => {
      document.getElementById("prestigeOverlayTitle").textContent=`PRESTIGE ${prestige}`;
      document.getElementById("prestigeOverlay").classList.add("active");
      playSound("achievement");
      showToast(`♛ ${title} 달성`);
    });

    socket.on("questClaimed", ({ rewards }) => {
      playSound("achievement");
      showNotice(`✅ 퀘스트 완료!\n\n${(rewards || []).join(" · ")}`, 2600);
    });

    socket.on("friendsData", renderFriends);
    socket.on("playerSearchResults", renderPlayerSearch);
    socket.on("friendNotice", (message) => {
      playSound("success");
      showToast(`🤝 ${message}`);
    });
    socket.on("whisperMessage", (message) => {
      showWhisperPopup(message);
    });
    socket.on("roomInvite", invite => { playSound("matchFound");showPartyInvite(invite); });
    socket.on("socialNotification", notification => {
      latestNotifications.unshift(notification);
      const count=document.getElementById("notificationCount");
      const next=(Number(count.textContent)||0)+1;count.textContent=next;count.classList.add("show");
      showToast(`🔔 ${notification.text}`);
    });
    socket.on("notificationData",renderNotifications);
    socket.on("roomTyping",({nickname,typing})=>{
      if(typing)activeTypers.add(nickname);else activeTypers.delete(nickname);
      document.getElementById("typingIndicator").textContent=activeTypers.size?`${[...activeTypers].join(", ")} 입력 중...`:"";
    });
    socket.on("kickedFromRoom",reason=>{
      myRoomCode="";latestRoomData=null;document.getElementById("game").style.display="none";document.getElementById("lobby").style.display="block";showNotice(`🚫 ${reason}`,3000);
    });
    socket.on("leftRoom",()=>{myRoomCode="";latestRoomData=null;document.getElementById("game").style.display="none";document.getElementById("lobby").style.display="block";loadRoomList();});

    socket.on("dailyLoginData", renderDailyLogin);
    socket.on("dailyLoginClaimed", ({ day, rewards }) => {
      playSound("achievement");
      showNotice(`📅 DAY ${day} 출석 완료!\n\n${(rewards || []).join(" · ")}`, 3000);
    });

    socket.on("rankingData", (data) => {
      latestRankingData = data;
      showModalElement(document.getElementById("rankingModal"));
      renderRanking(currentRankingType);
    });

    socket.on("chatUpdate", (messages) => {
      const chatMessages = document.getElementById("chatMessages");

      if (!chatMessages) return;

      chatMessages.innerHTML = (messages || []).map(msg => {
        if (msg.type === "system") {
          return `<div class="chat-message chat-system">${msg.text}</div>`;
        }

        const style = msg.style || {};
        const bubbleClass = style.chatBubble ? ` bubble-${style.chatBubble}` : "";
        const chatEffectClass = style.chatEffect ? " chat-effect-active" : "";
        const displayName = style.displayName || msg.nickname;
        const displayHtml = styledNameHtml(displayName, style);

        return `
          <div class="chat-message${bubbleClass}${chatEffectClass}" data-chat-effect="${escapeHtml(style.chatEffect || "")}">
            <span class="chat-nickname">${displayHtml}</span>
            <span>: ${msg.text}</span>
          </div>
        `;
      }).join("");

      chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    socket.on("errorMessage", (msg) => {
      submitPending = false;
      const submitButton = document.getElementById("submitButton");
      if (submitButton && latestRoomData && latestRoomData.status === "playing") {
        submitButton.disabled = latestRoomData.turnPlayerId !== playerId;
      }
      const overlay = document.getElementById("boxOpeningOverlay");
      if (overlay && overlay.style.display === "flex" && !pendingBoxReward) closeBoxOpening();
      playSound("error");
      showNotice(msg, 2800);
    });
  
