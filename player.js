(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const APP = window.APP;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };

  /* ---------- the signal path: record > needle > analyser > volume ---------- */
  const el = new Audio(); el.preload = 'auto'; el.src = 'assets/vinyl/swimming-pools.mp3';
  const saved = Number(store.get('artem-volume'));
  let ctx = null, needle = null, master = null, analyser = null, freq = null, wave = null;
  const state = { vol: store.get('artem-volume') === null || Number.isNaN(saved) ? 0.72 : saved, muted: false, started: false, failed: false, bass: 0, level: 0, pulse: 0, slow: 0 };
  const listeners = [];
  const notify = () => listeners.forEach((fn) => fn());
  el.addEventListener('error', () => { state.failed = true; notify(); });

  const curve = (v) => v * v; // the ear hears volume roughly on a square law
  function applyVolume() {
    const v = state.muted ? 0 : curve(state.vol) * duck;
    if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02); else el.volume = Math.min(1, v);
  }
  let duck = 1;

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    try {
      ctx = new C();
      const src = ctx.createMediaElementSource(el);
      needle = ctx.createGain(); analyser = ctx.createAnalyser(); master = ctx.createGain();
      analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.32; analyser.minDecibels = -72; analyser.maxDecibels = -4; // this master is loud: the default range clips the bass
      freq = new Uint8Array(analyser.frequencyBinCount); wave = new Float32Array(analyser.fftSize);
      src.connect(needle); needle.connect(analyser); analyser.connect(master); master.connect(ctx.destination);
      master.gain.value = state.muted ? 0 : curve(state.vol);
      needle.gain.value = 1;
      ctx.resume();
    } catch (e) { ctx = null; }
  }

  const openNeedle = (on, tau = 0.012) => { if (needle) needle.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, tau); };

  function seek(t) {
    if (el.readyState >= 1) { try { el.currentTime = t; } catch (e) { /* not seekable yet */ } }
    else el.addEventListener('loadedmetadata', () => { el.currentTime = t; }, { once: true });
  }
  function play() {
    unlock(); state.started = true;
    openNeedle(true, 0.03);
    const p = el.play(); if (p) p.catch(() => { notify(); });
  }
  function pause() { openNeedle(false, 0.03); el.pause(); }
  const toggle = () => (el.paused ? play() : pause());

  function setVolume(v, keepMute) {
    state.vol = Math.min(1, Math.max(0, v)); if (!keepMute) state.muted = false;
    store.set('artem-volume', state.vol.toFixed(2)); applyVolume(); notify();
  }
  function setMuted(m) { state.muted = m; applyVolume(); notify(); }

  // The film starts the record in silence inside the click (iOS allows play() only there); the needle opens the sound later.
  function startFilm(from, muted) {
    unlock(); state.started = true; state.muted = muted; applyVolume();
    openNeedle(false, 0.001);
    seek(from); const p = el.play(); if (p) p.catch(() => {});
    notify();
  }

  el.addEventListener('ended', () => { el.currentTime = 0; el.play().catch(() => {}); });
  ['play', 'pause'].forEach((n) => el.addEventListener(n, notify));

  // Sampled once a frame by the scene. The analyser sits before the volume, so a muted room still dances.
  function sample(dt) {
    if (!analyser || el.paused) {
      state.bass *= Math.exp(-dt * 7); state.level *= Math.exp(-dt * 5); state.pulse *= Math.exp(-dt * 7);
      return state;
    }
    analyser.getByteFrequencyData(freq); analyser.getFloatTimeDomainData(wave);
    let b = 0; for (let i = 1; i < 6; i++) b += freq[i]; b = b / 5 / 255;
    let e = 0; for (let i = 0; i < wave.length; i += 4) e += wave[i] * wave[i];
    const rms = Math.sqrt(e / (wave.length / 4));
    state.level = Math.min(1.1, Math.pow(rms * 3.4, 0.8)); // the meter face reads a compressed scale, as a real VU does
    state.slow += (b - state.slow) * (1 - Math.exp(-dt * 2.4));
    const hit = Math.max(0, b - state.slow - 0.025) * 7;
    state.pulse = Math.max(state.pulse * Math.exp(-dt * 7), Math.min(1, hit));
    state.bass += (b - state.bass) * (1 - Math.exp(-dt * 18));
    return state;
  }

  // Other sound on the page wins: the film and the GOMINI circle pull the record down until they stop.
  const talkers = new Set();
  const onMedia = (e) => {
    const m = e.target; if (m === el || !(m instanceof HTMLMediaElement)) return;
    if (!m.paused && !m.muted && !m.ended) talkers.add(m); else talkers.delete(m);
    duck = talkers.size ? 0.12 : 1; applyVolume();
  };
  ['play', 'pause', 'ended', 'volumechange'].forEach((n) => document.addEventListener(n, onMedia, true));

  APP.audio = { el, state, unlock, play, pause, toggle, seek, setVolume, setMuted, startFilm, openNeedle, sample, on: (fn) => listeners.push(fn) };
  APP.listen = () => {};

  /* ---------- the dock ---------- */
  const dock = $('#dock');
  if (!dock) return;
  const playBtn = $('#dockPlay'), muteBtn = $('#dockMute'), slider = $('#dockVol'), time = $('#dockTime'), look = $('#dockLook');
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function paint() {
    const on = !el.paused;
    dock.classList.toggle('is-playing', on);
    playBtn.setAttribute('aria-label', APP.t(on ? 'dock.pause' : 'dock.play'));
    playBtn.setAttribute('aria-pressed', String(on));
    const v = Math.round((state.muted ? 0 : state.vol) * 100);
    if (Number(slider.value) !== v) slider.value = v;
    slider.style.setProperty('--v', v + '%');
    slider.setAttribute('aria-valuetext', v + '%');
    muteBtn.setAttribute('aria-label', APP.t(state.muted ? 'dock.unmute' : 'dock.mute'));
    muteBtn.setAttribute('aria-pressed', String(state.muted));
    dock.classList.toggle('is-muted', state.muted || state.vol === 0);
    dock.classList.toggle('is-failed', state.failed);
  }
  const tick = () => {
    const d = el.duration || 247;
    dock.style.setProperty('--p', (el.currentTime / d).toFixed(4));
    time.textContent = `${fmt(el.currentTime)} / ${fmt(d)}`;
  };
  el.addEventListener('timeupdate', tick); el.addEventListener('durationchange', tick);
  playBtn.addEventListener('click', toggle);
  muteBtn.addEventListener('click', () => { unlock(); setMuted(!state.muted); });
  slider.addEventListener('input', () => { unlock(); setVolume(Number(slider.value) / 100); });
  look.addEventListener('click', () => APP.listen('toggle'));
  listeners.push(paint); APP.onLang.push(paint); paint(); tick();
  // Past the hero it folds to the disc and the button, so it never sits on a panel's text
  const fold = () => dock.classList.toggle('is-compact', scrollY > innerHeight * 0.6);
  addEventListener('scroll', fold, { passive: true }); fold();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Swimming Pools (Drank)', artist: 'Kendrick Lamar', album: 'good kid, m.A.A.d city', artwork: [{ src: 'assets/vinyl/cover.jpg', sizes: '1000x1000', type: 'image/jpeg' }] });
    navigator.mediaSession.setActionHandler('play', play); navigator.mediaSession.setActionHandler('pause', pause);
  }
})();
