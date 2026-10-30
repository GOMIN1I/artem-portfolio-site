(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };

  // Shared with scene.js
  const APP = window.APP = { lang: 'en', focus: null, reduced, t: (k) => k, onLang: [] };

  /* ---------- i18n ---------- */
  const EN = Object.assign({}, window.I18N_EN_EXTRA || {});
  const RU = window.I18N_RU || {};
  $$('[data-i18n]').forEach((el) => { EN[el.dataset.i18n] = el.innerHTML; });
  const attrs = [['data-i18n-alt', 'alt'], ['data-i18n-aria', 'aria-label'], ['data-i18n-content', 'content']];
  attrs.forEach(([d, a]) => $$(`[${d}]`).forEach((el) => { EN[el.getAttribute(d)] = el.getAttribute(a); }));

  APP.t = (k) => (APP.lang === 'ru' ? RU[k] : EN[k]) ?? EN[k] ?? k;

  function setLang(lang, first) {
    APP.lang = lang === 'ru' ? 'ru' : 'en';
    document.documentElement.lang = APP.lang;
    const dict = APP.lang === 'ru' ? RU : EN;
    $$('[data-i18n]').forEach((el) => { const v = dict[el.dataset.i18n] ?? EN[el.dataset.i18n]; if (v != null) el.innerHTML = v; });
    attrs.forEach(([d, a]) => $$(`[${d}]`).forEach((el) => { const v = dict[el.getAttribute(d)] ?? EN[el.getAttribute(d)]; if (v != null) el.setAttribute(a, v); }));
    $$('.lang-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === APP.lang)));
    // Media that exists in two languages
    const film = $('#jsFilm');
    if (film) {
      const src = film.dataset['src' + (APP.lang === 'ru' ? 'Ru' : 'En')];
      const poster = film.dataset['poster' + (APP.lang === 'ru' ? 'Ru' : 'En')];
      if (!film.currentSrc.endsWith(src)) {
        const t = film.currentTime; const playing = !film.paused;
        film.poster = poster; film.querySelector('source').src = src; film.load();
        if (t > 0) film.addEventListener('loadedmetadata', () => { film.currentTime = t; if (playing) film.play().catch(() => {}); }, { once: true });
      }
    }
    updateShot();
    updateVerdict();
    if (!first) store.set('artem-lang', APP.lang);
    const url = new URL(location.href);
    if (APP.lang === 'ru') url.searchParams.set('lang', 'ru'); else url.searchParams.delete('lang');
    history.replaceState(null, '', url);
    APP.onLang.forEach((fn) => fn(APP.lang));
  }
  $$('.lang-btn').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

  /* ---------- nav ---------- */
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('is-solid', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* ---------- Job Search: marker demo ---------- */
  const pay = $('#jsPay'), eng = $('#jsEng'), calls = $('#jsCalls');
  function updateVerdict() {
    if (!pay) return;
    const v = {
      remote: 'yes',
      calls: calls.checked ? 'no' : 'yes',
      pay: Number(pay.value) <= 800 ? 'yes' : 'no',
      eng: eng.value === 'B2' ? 'yes' : 'ask'
    };
    $$('.js-lines li').forEach((li) => {
      const s = v[li.dataset.cond];
      const tag = $('.js-tag', li);
      tag.dataset.v = s;
      tag.textContent = APP.t('js.v.' + s);
      li.dataset.v = s;
      li.classList.remove('is-marking'); void li.offsetWidth; li.classList.add('is-marking');
    });
    const all = Object.values(v);
    const verdict = all.includes('no') ? 'no' : all.includes('ask') ? 'ask' : 'yes';
    const box = $('#jsVerdict');
    box.dataset.v = verdict;
    $('.js-mark-icon', box).textContent = verdict === 'yes' ? '✓' : verdict === 'ask' ? '?' : '✕';
    $('#jsVerdictText').textContent = APP.t('js.v.' + verdict);
  }
  [pay, eng, calls].forEach((el) => el && el.addEventListener('change', updateVerdict));

  /* ---------- Job Search: screens ---------- */
  let shotKey = '10-today-demo';
  function updateShot() {
    const img = $('#shotImg'); if (!img) return;
    const src = `assets/jobsearch/${APP.lang}-${shotKey}.jpg`;
    if (!img.src.endsWith(src)) img.src = src;
  }
  const tabs = $$('.shots-tabs [role="tab"]');
  tabs.forEach((tab, i) => {
    tab.tabIndex = i === 0 ? 0 : -1;
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return; e.preventDefault();
      const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); select(n);
    });
  });
  function select(tab) {
    tabs.forEach((t) => { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    shotKey = tab.dataset.shotImg;
    const img = $('#shotImg');
    img.classList.add('is-swapping');
    const done = () => img.classList.remove('is-swapping');
    img.addEventListener('load', done, { once: true });
    updateShot();
    if (img.complete) done();
  }

  /* ---------- Marketplace prototype ---------- */
  const screen = $('#phoneScreen');
  if (screen) {
    screen.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]'); if (!b) return;
      const next = $(`[data-screen="${b.dataset.go}"]`, screen);
      $$('.mk-screen', screen).forEach((s) => s.classList.toggle('is-active', s === next));
      const first = next.querySelector('button'); if (first && e.detail === 0) first.focus();
    });
    $$('.mk-size .chip').forEach((c) => c.addEventListener('click', () => {
      $$('.mk-size .chip').forEach((o) => o.setAttribute('aria-pressed', String(o === c)));
      screen.style.setProperty('--mk-scale', c.dataset.size);
    }));
  }

  /* ---------- GOMINI circle ---------- */
  const vid = $('#circleVid'), btn = $('#circleBtn'), ring = $('#circleRing'), time = $('#circleTime'), hint = $('#circleSound');
  if (vid) {
    const io = new IntersectionObserver(([en]) => {
      if (en.isIntersecting && !reduced && vid.muted) vid.play().catch(() => {});
      else if (!en.isIntersecting) vid.pause();
    }, { threshold: 0.35 });
    io.observe(vid);
    btn.addEventListener('click', () => {
      if (vid.muted || vid.paused) {
        vid.muted = false; if (!btn.classList.contains('is-live')) vid.currentTime = 0;
        vid.play().catch(() => {}); btn.classList.add('is-live');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        vid.pause(); btn.setAttribute('aria-pressed', 'false');
      }
    });
    const fmt = (s) => `0:${String(Math.max(0, Math.round(s))).padStart(2, '0')}`;
    const tick = () => {
      if (vid.duration) {
        const p = vid.currentTime / vid.duration;
        ring.style.strokeDashoffset = String(100 - p * 100);
        time.textContent = fmt(btn.classList.contains('is-live') ? vid.duration - vid.currentTime : vid.duration);
      }
      if (!vid.paused) requestAnimationFrame(tick);
    };
    vid.addEventListener('play', () => requestAnimationFrame(tick));
    vid.addEventListener('loadedmetadata', tick);
    APP.onLang.push(() => { if (!btn.classList.contains('is-live')) hint.textContent = APP.t('gm.sound'); });
  }

  /* ---------- autoplay small loops only while visible ---------- */
  const loops = $$('video[data-autoplay]');
  const lio = new IntersectionObserver((ens) => ens.forEach((en) => {
    const v = en.target;
    if (en.isIntersecting && !reduced) { if (v.preload === 'none') v.preload = 'auto'; v.play().catch(() => {}); }
    else v.pause();
  }), { threshold: 0.3 });
  loops.forEach((v) => { lio.observe(v); if (reduced) v.controls = true; });

  /* ---------- the room: parts focus the camera ---------- */
  const parts = $$('.part');
  parts.forEach((p) => p.addEventListener('click', () => {
    const on = p.getAttribute('aria-pressed') !== 'true';
    parts.forEach((o) => o.setAttribute('aria-pressed', String(on && o === p)));
    APP.focus = on ? p.dataset.focus : null;
    if (on) {
      const sec = $('#room');
      const r = sec.getBoundingClientRect();
      if (r.bottom < innerHeight * 0.2 || r.top > innerHeight * 0.8) { /* case section is in view; camera follows */ }
    }
  }));
  const roomCase = $('.case-rm');
  if (roomCase) new IntersectionObserver(([en]) => {
    if (!en.isIntersecting) { APP.focus = null; parts.forEach((o) => o.setAttribute('aria-pressed', 'false')); }
  }, { threshold: 0 }).observe(roomCase);

  /* ---------- if the 3D never arrives, the page still opens ---------- */
  setTimeout(() => { if (document.body.classList.contains('is-loading')) { document.body.classList.add('no-webgl'); document.body.classList.remove('is-loading'); document.body.classList.add('is-ready'); const b = $('#boot'); if (b) b.classList.add('is-done'); } }, 12000);

  /* ---------- start ---------- */
  const urlLang = new URL(location.href).searchParams.get('lang');
  setLang(urlLang || store.get('artem-lang') || 'en', true);
  APP.replay = () => {};
  $('#replay').addEventListener('click', () => { scrollTo({ top: 0, behavior: 'instant' }); APP.replay(); });
})();
