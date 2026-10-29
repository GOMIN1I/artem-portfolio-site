import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const APP = window.APP || { t: (k) => k, onLang: [], reduced: false };
const reduced = APP.reduced;
const canvas = document.getElementById('roomCanvas');
const bootEl = document.getElementById('boot');
const bootBar = document.getElementById('bootBar');
const bootCount = document.getElementById('bootCount');
const hotspotsEl = document.getElementById('hotspots');

// Blender is Z-up, three is Y-up: (x, y, z) -> (x, z, -y)
const B = (x, y, z) => new THREE.Vector3(x, z, -y);
const lowTier = matchMedia('(pointer: coarse)').matches || innerWidth < 760 || (navigator.hardwareConcurrency || 8) <= 4;
const narrow = () => innerWidth < 760;

/* ---------------- renderer ---------------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowTier, powerPreference: 'high-performance' });
} catch (e) { fallback(); }
if (renderer) start();

function fallback() {
  document.body.classList.add('no-webgl');
  endBoot();
}

function endBoot() {
  document.body.classList.remove('is-loading');
  document.body.classList.add('is-ready');
  if (bootEl) bootEl.classList.add('is-done');
}

function start() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowTier ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Light comes from a Cycles bake already graded in AgX, so the page shows it as rendered.
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const BG = new THREE.Color('#13122e');
  scene.background = BG;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);

  let composer = null, bloom = null;
  if (!lowTier) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.22, 0.35, 0.93);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  // During the assembly the room is dark; the baked light comes up when everything is in place.
  const lights = [];
  const fade = { v: 1, mats: [] };
  const setFade = (v) => { fade.v = v; fade.mats.forEach(([m, base]) => m.color.setScalar(base * v)); };

  /* ---------- textures painted in code for the procedural materials ---------- */
  const tex = (w, h, draw, emissive) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  };
  const rnd = mulberry(7);
  const T = {
    city: tex(1024, 768, (g, w, h) => {
      g.fillStyle = '#0b0d26'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        const bw = 40 + rnd() * 90, bh = 160 + rnd() * 520, x = rnd() * w, y = h - bh;
        g.fillStyle = `rgb(${14 + rnd() * 10},${16 + rnd() * 10},${40 + rnd() * 18})`; g.fillRect(x, y, bw, bh);
        for (let wy = y + 12; wy < h - 8; wy += 18) for (let wx = x + 6; wx < x + bw - 8; wx += 14) {
          if (rnd() < 0.34) { g.fillStyle = rnd() < 0.8 ? '#ffd9a0' : '#bcd4ff'; g.fillRect(wx, wy, 7, 9); }
        }
      }
    }),
  };
  // Light: one Cycles bake on the second UV set. Surface: photo-texture detail on the first, tiled at
  // real-world scale, carrying the grain the lightmap is too coarse to hold.
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const texLoader = new THREE.TextureLoader();
  // Everyone starts on the light versions (about 2.3 MB); desktops swap in 4K once the room has assembled.
  const LM = texLoader.load('assets/room/lightmap-2k.jpg');
  LM.colorSpace = THREE.SRGBColorSpace; LM.flipY = false; LM.anisotropy = aniso; LM.channel = 1;
  const manifest = fetch('assets/room/detail/manifest.json').then((r) => r.json()).catch(() => ({}));
  const detailTex = {};
  const detailFor = (set) => {
    if (!detailTex[set]) {
      const t = texLoader.load(`assets/room/detail/${set}-m.jpg`);
      t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
      detailTex[set] = t;
    }
    return detailTex[set];
  };
  let upgraded = false;
  function upgradeTextures() {
    if (upgraded || lowTier || navigator.connection?.saveData) return;
    upgraded = true;
    // a new texture object per swap: WebGL2 storage keeps the first upload's size
    const swap = (old, url) => texLoader.load(url, (full) => {
      ['colorSpace', 'flipY', 'wrapS', 'wrapT', 'anisotropy', 'channel'].forEach((k) => { full[k] = old[k]; });
      fade.mats.forEach(([m]) => { if (m.lightMap === old) m.lightMap = full; if (m.map === old) m.map = full; });
      old.dispose();
    });
    swap(LM, 'assets/room/lightmap-4k.jpg');
    Object.entries(detailTex).forEach(([set, t]) => swap(t, `assets/room/detail/${set}.jpg`));
  }
  let DETAIL = {};
  function makeBaked(name) {
    const d = DETAIL[name];
    const m = new THREE.MeshBasicMaterial({ lightMap: LM, lightMapIntensity: Math.PI, toneMapped: false, map: d ? detailFor(d[0]) : null });
    if (d) {
      const strength = d[1];
      m.onBeforeCompile = (sh) => {
        sh.uniforms.dStrength = { value: strength };
        sh.fragmentShader = 'uniform float dStrength;\n' + sh.fragmentShader.replace('#include <map_fragment>',
          '#ifdef USE_MAP\n diffuseColor.rgb *= max(0.0, 1.0 + dStrength * (2.0 * texture2D(map, vMapUv).r - 1.0));\n#endif');
      };
    }
    fade.mats.push([m, 1]); m.color.setScalar(fade.v);
    return m;
  }
  const bakedMats = {};
  const bakedMat = (name) => bakedMats[name] || (bakedMats[name] = makeBaked(name));

  const video = document.createElement('video');
  video.src = 'assets/video/demo-search.mp4'; video.muted = true; video.loop = true; video.playsInline = true; video.crossOrigin = 'anonymous';
  // iOS Safari only plays (and hands frames to a canvas) for a muted inline video that sits in the document
  ['muted', 'playsinline', 'webkit-playsinline'].forEach((a) => video.setAttribute(a, ''));
  video.preload = 'auto'; video.setAttribute('aria-hidden', 'true');
  Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', left: '0', top: '0' });
  document.body.appendChild(video);
  const still = new Image(); still.src = 'assets/jobsearch/demo-search.jpg'; still.onload = () => drawDesktop();
  // The monitor shows a whole desktop: the app window at its true 16:10, a taskbar of the projects on this page.
  const screenDesk = { c: document.createElement('canvas'), last: -1 };
  screenDesk.c.width = 1600; screenDesk.c.height = 880; // the screen face is 0.60 by 0.33 m
  screenDesk.g = screenDesk.c.getContext('2d');
  const vtex = new THREE.CanvasTexture(screenDesk.c); vtex.colorSpace = THREE.SRGBColorSpace; vtex.anisotropy = 8;
  const TB = 64;
  function wallpaper(g, W, H) {
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#0f3b3d'); gr.addColorStop(1, '#1a1640'); g.fillStyle = gr; g.fillRect(0, 0, W, H - TB);
    g.fillStyle = 'rgba(242,181,82,0.10)'; g.font = '600 220px Tektur, sans-serif'; g.fillText('artem_', 70, H - TB - 60);
  }
  function icon(g, x, y, kind, active) {
    const r = 10, s = 44;
    if (active) { g.fillStyle = 'rgba(255,255,255,0.10)'; roundRect(g, x - 6, y - 6, s + 12, s + 12, 8); g.fill(); g.fillStyle = '#7fc8ff'; roundRect(g, x + s / 2 - 10, y + s + 4, 20, 4, 2); g.fill(); }
    g.save(); g.translate(x, y);
    if (kind === 'start') { g.fillStyle = '#5ab0ff'; [[2, 2], [24, 2], [2, 24], [24, 24]].forEach(([a, b]) => g.fillRect(a, b, 18, 18)); }
    if (kind === 'jobs') { g.fillStyle = '#0b5d4b'; roundRect(g, 0, 0, s, s, r); g.fill(); g.fillStyle = '#f6f8f4'; g.save(); g.translate(22, 22); g.rotate(-0.18); roundRect(g, -13, -16, 26, 32, 4); g.fill(); g.fillStyle = '#d8f04a'; g.fillRect(-10, -2, 20, 6); g.restore(); }
    if (kind === 'blender') { g.fillStyle = '#e87d0d'; g.beginPath(); g.arc(22, 24, 17, 0, 7); g.fill(); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(22, 24, 9, 0, 7); g.fill(); g.fillStyle = '#265787'; g.beginPath(); g.arc(22, 24, 5, 0, 7); g.fill(); }
    if (kind === 'figma') { [['#f24e1e', 13, 9], ['#ff7262', 27, 9], ['#a259ff', 13, 22], ['#1abcfe', 27, 22], ['#0acf83', 13, 35]].forEach(([c, a, b]) => { g.fillStyle = c; g.beginPath(); g.arc(a, b, 7, 0, 7); g.fill(); }); }
    if (kind === 'resolve') { ['#e64b3c', '#3fbf6f', '#3d8ff0'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(22 + Math.cos(i * 2.1) * 9, 22 + Math.sin(i * 2.1) * 9, 9, 0, 7); g.fill(); }); }
    if (kind === 'term') { g.fillStyle = '#1b1b24'; roundRect(g, 0, 0, s, s, r); g.fill(); g.fillStyle = '#f2b552'; g.font = '700 22px "JetBrains Mono", monospace'; g.fillText('>_', 8, 30); }
    if (kind === 'tg') { g.fillStyle = '#2aabee'; g.beginPath(); g.arc(22, 22, 20, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(10, 22); g.lineTo(33, 13); g.lineTo(28, 33); g.lineTo(21, 27); g.closePath(); g.fill(); }
    if (kind === 'gomini') { g.fillStyle = '#f5f3ec'; roundRect(g, 0, 0, s, s, r); g.fill(); g.fillStyle = '#a00000'; g.font = '700 26px Georgia, serif'; g.fillText('G', 7, 32); g.beginPath(); g.arc(34, 17, 3.5, 0, 7); g.arc(34, 29, 3.5, 0, 7); g.fill(); }
    g.restore();
  }
  function taskbar(g, W, H) {
    const y = H - TB; g.fillStyle = 'rgba(28,28,38,0.94)'; g.fillRect(0, y, W, TB); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, y, W, 1);
    const kinds = ['start', 'search', 'jobs', 'blender', 'figma', 'resolve', 'term', 'tg', 'gomini'];
    let x = W / 2 - 330; const iy = y + 10;
    kinds.forEach((k) => {
      if (k === 'search') { g.fillStyle = 'rgba(255,255,255,0.09)'; roundRect(g, x, iy + 2, 170, 40, 20); g.fill(); g.fillStyle = 'rgba(255,255,255,0.62)'; g.font = '400 20px Onest, sans-serif'; g.fillText(APP.lang === 'ru' ? 'Поиск' : 'Search', x + 46, iy + 29); g.strokeStyle = 'rgba(255,255,255,0.62)'; g.lineWidth = 2.5; g.beginPath(); g.arc(x + 24, iy + 20, 7, 0, 7); g.stroke(); g.beginPath(); g.moveTo(x + 29, iy + 25); g.lineTo(x + 34, iy + 30); g.stroke(); x += 190; return; }
      icon(g, x, iy, k, k === 'jobs'); x += 64;
    });
    g.fillStyle = 'rgba(255,255,255,0.88)'; g.font = '400 19px Onest, sans-serif'; g.textAlign = 'right';
    g.fillText('02:14', W - 28, y + 28); g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '400 16px Onest, sans-serif'; g.fillText(APP.lang === 'ru' ? 'РУС' : 'ENG', W - 112, y + 38); g.fillText('29.10.2026', W - 28, y + 50); g.textAlign = 'left';
  }
  function drawDesktop() {
    const g = screenDesk.g, W = screenDesk.c.width, H = screenDesk.c.height;
    wallpaper(g, W, H);
    const ar = (video.videoWidth / video.videoHeight) || 1.6, bar = 34;
    const vh = H - TB - 2 * 22 - bar, vw = vh * ar, x = (W - vw) / 2, y = 22;
    g.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(g, x + 4, y + 8, vw, vh + bar, 12); g.fill();
    g.save(); roundRect(g, x, y, vw, vh + bar, 12); g.clip();
    g.fillStyle = '#eef2ee'; g.fillRect(x, y, vw, bar);
    g.fillStyle = '#1c2226'; g.font = '600 16px Onest, sans-serif'; g.fillText('Job Search Desktop', x + 46, y + 22);
    g.fillStyle = '#0b5d4b'; roundRect(g, x + 14, y + 8, 20, 20, 5); g.fill();
    g.strokeStyle = '#1c2226'; g.lineWidth = 1.6; const cx = x + vw;
    g.beginPath(); g.moveTo(cx - 128, y + 17); g.lineTo(cx - 116, y + 17); g.stroke();
    g.strokeRect(cx - 80, y + 11, 11, 11);
    g.beginPath(); g.moveTo(cx - 32, y + 11); g.lineTo(cx - 21, y + 22); g.moveTo(cx - 21, y + 11); g.lineTo(cx - 32, y + 22); g.stroke();
    if (video.readyState >= 2) g.drawImage(video, x, y + bar, vw, vh);
    else if (still.complete && still.naturalWidth) g.drawImage(still, x, y + bar, vw, vh);
    else { g.fillStyle = '#f6f8f4'; g.fillRect(x, y + bar, vw, vh); }
    g.restore();
    taskbar(g, W, H);
    vtex.needsUpdate = true;
  }
  video.addEventListener('loadeddata', drawDesktop); video.addEventListener('canplay', drawDesktop); video.addEventListener('pause', drawDesktop);
  APP.onLang.push(drawDesktop);
  if (document.fonts) document.fonts.ready.then(drawDesktop);

  /* ---------- load the room ---------- */
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const groups = { monitor: [], phone: [], sound: [], board: [], pc: [], pylon: [], window: [], plane: [] };
  const groupRule = [
    ['monitor', /^(Monitor_|Keyboard_|Mouse)/], ['sound', /^(Speaker_|Headphones_|Hook_)/], ['board', /^(Draft_|Tube_)/],
    ['pc', /^PC_/], ['pylon', /^Pylon_/], ['window', /^Window_/], ['plane', /^Plane_/], ['phone', /^Phone_/]
  ];
  const nodes = [];

  loader.load('assets/room/room-baked.glb', (gltf) => manifest.then((man) => {
    DETAIL = man;
    const root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name;
      fixMaterial(o);
      for (const [k, re] of groupRule) if (re.test(n) || (o.parent && re.test(o.parent.name)) || (o.parent && o.parent.parent && re.test(o.parent.parent.name))) { groups[k].push(o); break; }
    });
    scene.add(root);
    root.updateMatrixWorld(true);
    root.children.forEach((c) => nodes.push(c));
    prepareAssembly();
    buildHotspots();
    setProgress(1);
    if (reduced || sessionSeen()) { finishAssembly(); endBoot(); }
    else playAssembly();
    loop();
  }), (e) => { if (e.total) setProgress(e.loaded / e.total * 0.9); }, () => fallback());

  function setProgress(p) { if (bootBar) bootBar.style.transform = `scaleX(${p})`; }
  function sessionSeen() { try { return sessionStorage.getItem('artem-built') === '1'; } catch (e) { return false; } }

  const LIVE = /^(Monitor_Screen|Window_CityBackdrop|Window_Glass|Phone_Screen|PC_SideGlass)/;
  const phoneTex = new THREE.TextureLoader().load('assets/market/screen-1.png'); phoneTex.colorSpace = THREE.SRGBColorSpace; phoneTex.anisotropy = 8;
  function fixMaterial(o) {
    const id = LIVE.test(o.name) ? o.name : (o.parent && LIVE.test(o.parent.name) ? o.parent.name : '');
    if (!id) { o.material = bakedMat(o.material.name); return; }
    if (id.startsWith('Monitor_Screen')) { planarUV(o); o.material = new THREE.MeshBasicMaterial({ map: vtex, toneMapped: false, color: new THREE.Color(0.8, 0.8, 0.8) }); }
    else if (id.startsWith('Phone_Screen')) { phoneTex.flipY = false; o.material = new THREE.MeshBasicMaterial({ map: phoneTex, toneMapped: false, color: new THREE.Color(0.74, 0.74, 0.74) }); }
    else if (id.startsWith('Window_CityBackdrop')) { planarUV(o); o.material = new THREE.MeshBasicMaterial({ map: T.city, toneMapped: false, color: new THREE.Color(0.78, 0.8, 0.95) }); }
    else if (id.startsWith('Window_Glass')) { o.material = new THREE.MeshBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.06, depthWrite: false }); }
    else { o.material = new THREE.MeshBasicMaterial({ color: 0x0a0b10, transparent: true, opacity: 0.7 }); }
    fade.mats.push([o.material, o.material.color.r]);
    o.material.userData.live = true;
  }

  function planarUV(mesh) {
    mesh.updateWorldMatrix(true, false);
    const g = mesh.geometry; const pos = g.attributes.position; const v = new THREE.Vector3();
    const box = new THREE.Box3().setFromObject(mesh); const s = box.getSize(new THREE.Vector3());
    const n = s.x <= s.y && s.x <= s.z ? 'x' : s.y <= s.z ? 'y' : 'z';
    const [ua, va] = n === 'x' ? ['z', 'y'] : n === 'y' ? ['x', 'z'] : ['x', 'y'];
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      let u = (v[ua] - box.min[ua]) / (s[ua] || 1), w = (v[va] - box.min[va]) / (s[va] || 1);
      if (n === 'x') u = 1 - u;
      if (n === 'y') w = 1 - w;
      uv[i * 2] = u; uv[i * 2 + 1] = w;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  // The tone-mapped clear colour is what the eye sees, so the page takes its stage colour from a real pixel.
  let sampled = false; const px = new Uint8Array(4);
  function sampleBackground() {
    const gl = renderer.getContext();
    gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (px[0] + px[1] + px[2] < 6) return;
    sampled = true;
    document.documentElement.style.setProperty('--color-stage', `rgb(${px[0]} ${px[1]} ${px[2]})`);
  }

  /* ---------- the assembly: 304 objects find their place ---------- */
  const order = [/^(Floor_|Rug)/, /^(Wall_|Baseboard_)/, /^(Window_|Door_)/, /^(Desk_|Sofa_|Shelf_B|Shelf_S|Shelf_T|Shelf_K|Draft_Board|Draft_Leg|Draft_Foot|Draft_Pivot|Draft_Stretch|Draft_Shelf|Draft_Bracket|Chair_Root|PC_Case|Storage_)/, /.*/];
  const anim = [];
  function prepareAssembly() {
    nodes.forEach((n) => {
      const tier = order.findIndex((re) => re.test(n.name));
      const base = { p: n.position.clone(), s: n.scale.clone(), r: n.rotation.y };
      const delay = tier * 0.34 + rnd() * (tier === 4 ? 0.9 : 0.25);
      anim.push({ n, base, tier, delay, dur: tier <= 1 ? 0.9 : 0.75 });
    });
  }
  let assembling = false, aStart = 0, total = 0;
  function playAssembly() {
    assembling = true; aStart = performance.now(); total = Math.max(...anim.map((a) => a.delay + a.dur)) + 0.6;
    setFade(0.12);
    // the words come up with the room, not after it; hotspots wait for is-ready
    document.body.classList.add('is-building');
    document.body.classList.remove('is-loading');
    clearTimeout(playAssembly.timer);
    playAssembly.timer = setTimeout(() => { if (assembling) { finishAssembly(); endBoot(); } }, total * 1000 + 2500);
  }
  function finishAssembly() {
    assembling = false;
    anim.forEach(({ n, base }) => { n.position.copy(base.p); n.scale.copy(base.s); n.rotation.y = base.r; n.visible = true; });
    setFade(1);
    upgradeTextures();
    if (bootCount) bootCount.textContent = '304';
    document.body.classList.remove('is-building');
    try { sessionStorage.setItem('artem-built', '1'); } catch (e) { /* ignore */ }
  }
  function stepAssembly(now) {
    const t = (now - aStart) / 1000;
    let placed = 0;
    anim.forEach((a) => {
      const k = clamp((t - a.delay) / a.dur, 0, 1); const e = 1 - Math.pow(1 - k, 4);
      const { n, base } = a;
      n.visible = k > 0;
      if (a.tier === 0) { n.scale.set(base.s.x * (0.3 + 0.7 * e), base.s.y, base.s.z * (0.3 + 0.7 * e)); }
      else if (a.tier === 1 || a.tier === 2) { n.position.set(base.p.x, base.p.y + (1 - e) * 3.2, base.p.z); }
      else if (a.tier === 3) { n.position.set(base.p.x, base.p.y + (1 - e) * 2.2, base.p.z); n.rotation.y = base.r + (1 - e) * 0.35; }
      else { const s = Math.max(0.001, e); n.scale.set(base.s.x * s, base.s.y * s, base.s.z * s); n.position.set(base.p.x, base.p.y + (1 - e) * 0.35, base.p.z); }
      if (k >= 1) placed++;
    });
    if (bootCount) bootCount.textContent = String(Math.round(placed / anim.length * 304));
    const lt = clamp((t - (total - 1.4)) / 1.0, 0, 1);
    setFade(0.12 + 0.88 * smooth(lt));
    if (t > total) { finishAssembly(); endBoot(); }
  }
  const skip = () => { if (assembling) { finishAssembly(); endBoot(); } };
  addEventListener('keydown', (e) => { if (e.key === 'Escape') skip(); });
  addEventListener('wheel', skip, { passive: true });
  addEventListener('touchmove', skip, { passive: true });
  if (bootEl) bootEl.addEventListener('click', skip);
  APP.replay = () => {
    try { sessionStorage.removeItem('artem-built'); } catch (e) { /* ignore */ }
    if (reduced) return;
    document.body.classList.remove('is-ready'); bootEl && bootEl.classList.remove('is-done');
    setTimeout(playAssembly, 500);
  };

  /* ---------- camera shots ---------- */
  const heroDir = B(13.48, -9.48, 12.77).sub(B(1.95, 2.0, 0.95)).normalize();
  const shot = (target, dir, dist) => ({ target, dir: dir.normalize(), dist });
  const SHOTS = {
    hero: shot(B(1.95, 2.0, 0.85), heroDir.clone(), 14.2),
    monitor: shot(B(1.55, 3.74, 1.05), B(0.1, -1, 0.26), 1.38),
    phone: shot(B(2.07, 3.37, 0.76), B(0.18, -0.6, 1), 0.58),
    sound: shot(B(0.3, 3.5, 1.25), B(1, -0.7, 0.22), 1.85),
    board: shot(B(3.3, 3.55, 1.0), B(-0.12, -0.8, 1.15), 1.7),
    pc: shot(B(1.2, 3.5, 0.62), B(-0.2, -1, 0.32), 2.0),
    pylon: shot(B(0.22, 3.8, 0.98), B(1, -0.45, 0.22), 0.72),
    window: shot(B(1.6, 4.1, 1.5), B(0.06, -1, 0.06), 2.7),
    plane: shot(B(0.22, 3.4, 2.07), B(1, -0.85, 0.3), 0.75)
  };
  const SIDE = { hero: 0.25, monitor: 0.2, phone: -0.2, sound: 0.2, board: 0.2, pc: -0.2, pylon: -0.2, window: 0.2, plane: 0.2 };
  const sections = Array.from(document.querySelectorAll('[data-shot]'));
  const cur = { target: SHOTS.hero.target.clone(), dir: SHOTS.hero.dir.clone(), dist: SHOTS.hero.dist, side: SIDE.hero, heroW: 1 };
  const want = { target: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, side: 0, heroW: 1 };
  let tops = [];
  const measure = () => { tops = sections.map((s) => s.getBoundingClientRect().top + scrollY); };
  measure(); addEventListener('load', measure); new ResizeObserver(measure).observe(document.body);

  function desired() {
    const vh = innerHeight; let p = 0;
    for (let i = 1; i < sections.length; i++) p += clamp((scrollY + vh * 0.62 - tops[i]) / (vh * 0.55), 0, 1);
    const i0 = Math.min(Math.floor(p), sections.length - 1), i1 = Math.min(i0 + 1, sections.length - 1);
    const t = smooth(p - i0);
    let a = sections[i0].dataset.shot, b = sections[i1].dataset.shot;
    if (APP.focus && (a === 'board' || b === 'board')) { if (a === 'board') a = APP.focus; if (b === 'board') b = APP.focus; }
    const A = SHOTS[a], Bs = SHOTS[b];
    want.target.lerpVectors(A.target, Bs.target, t);
    want.dir.lerpVectors(A.dir, Bs.dir, t).normalize();
    want.dist = THREE.MathUtils.lerp(A.dist, Bs.dist, t);
    want.side = THREE.MathUtils.lerp(SIDE[a] ?? 0.2, SIDE[b] ?? 0.2, t);
    want.heroW = clamp(1 - p * 1.6, 0, 1);
  }

  // A drag in the hero turns the room a little; it springs back on release.
  const drag = { on: false, x: 0, y: 0, yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 };
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; drag.on = true; drag.x = e.clientX; drag.y = e.clientY; drag.moved = 0; });
  addEventListener('pointerup', () => { drag.on = false; });
  addEventListener('pointermove', (e) => {
    if (drag.on) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.yaw = clamp(drag.yaw - dx * 0.004, -0.6, 0.6); drag.pitch = clamp(drag.pitch + dy * 0.003, -0.25, 0.3);
    }
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); pointer.dirty = true; pointer.over = e.target === canvas;
  });

  /* ---------- hover and hotspots ---------- */
  const pointer = new THREE.Vector2(9, 9); const ray = new THREE.Raycaster();
  const SECTION = { monitor: 'jobsearch', phone: 'market', sound: 'gomini', board: 'room', pc: 'agents', pylon: 'roots', window: 'contact' };
  const hotKeys = Object.keys(SECTION);
  const anchors = {}; const buttons = {};
  let hovered = null;
  const glowMats = new Map(); const hoverMats = {};
  function buildHotspots() {
    hotKeys.forEach((k) => {
      const box = new THREE.Box3(); groups[k].forEach((m) => box.expandByObject(m));
      const c = box.getCenter(new THREE.Vector3()); c.y = box.max.y + 0.06;
      if (k === 'window') c.y = box.min.y + (box.max.y - box.min.y) * 0.75;
      if (k === 'pc') c.y = box.max.y - 0.05;
      anchors[k] = c;
      groups[k].forEach((m) => {
        if (glowMats.has(m) || m.material.userData.live) return;
        const hk = k + '|' + m.material.name;
        if (!hoverMats[hk]) { hoverMats[hk] = makeBaked(m.material.name); hoverMats[hk].name = m.material.name; }
        m.material = hoverMats[hk]; glowMats.set(m, true);
      });
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'hotspot'; b.dataset.key = k;
      b.innerHTML = `<span class="hotspot-ring" aria-hidden="true"></span><span class="hotspot-label">${APP.t('hs.' + k)}</span>`;
      b.addEventListener('click', () => go(k));
      b.addEventListener('pointerenter', () => setHover(k)); b.addEventListener('pointerleave', () => setHover(null));
      b.addEventListener('focus', () => setHover(k)); b.addEventListener('blur', () => setHover(null));
      hotspotsEl.appendChild(b); buttons[k] = b;
    });
    APP.onLang.push(() => hotKeys.forEach((k) => { buttons[k].querySelector('.hotspot-label').textContent = APP.t('hs.' + k); }));
  }
  function go(k) {
    const el = document.getElementById(SECTION[k]); if (!el) return;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    const f = el.querySelector('h2'); if (f) { f.tabIndex = -1; setTimeout(() => f.focus({ preventScroll: true }), reduced ? 0 : 900); }
  }
  function setHover(k) {
    if (hovered === k) return; hovered = k;
    hotKeys.forEach((key) => {
      buttons[key] && buttons[key].classList.toggle('is-hot', key === k);
    });
    Object.entries(hoverMats).forEach(([hk, m]) => m.color.setScalar(fade.v * (hk.split('|')[0] === k ? 1.32 : 1)));
    canvas.style.cursor = k ? 'pointer' : '';
  }
  canvas.addEventListener('click', () => { if (drag.moved > 6) return; if (hovered && cur.heroW > 0.4) go(hovered); });
  const hoverables = () => hotKeys.flatMap((k) => groups[k].map((m) => [m, k]));
  let hoverList = null;
  function pick() {
    if (!pointer.dirty || drag.on) return; pointer.dirty = false;
    if (!pointer.over || cur.heroW < 0.4) { if (hovered && !document.activeElement?.classList.contains('hotspot')) setHover(null); return; }
    hoverList = hoverList || hoverables();
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(hoverList.map(([m]) => m), false)[0];
    setHover(hit ? hoverList.find(([m]) => m === hit.object)[1] : null);
  }

  const v3 = new THREE.Vector3();
  function placeHotspots() {
    const vis = cur.heroW > 0.55 && document.body.classList.contains('is-ready');
    hotspotsEl.classList.toggle('is-visible', vis);
    if (!vis) return;
    const w = innerWidth, h = innerHeight;
    hotKeys.forEach((k) => {
      v3.copy(anchors[k]).project(camera);
      const x = (v3.x * 0.5 + 0.5) * w, y = (-v3.y * 0.5 + 0.5) * h;
      buttons[k].style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });
  }

  /* ---------- frame loop ---------- */
  let last = performance.now(); let frameSkip = 0;
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (composer) { composer.setSize(w, h); bloom.resolution.set(w / 2, h / 2); }
  }
  addEventListener('resize', resize); resize();

  const camPos = new THREE.Vector3();
  function loop(now = performance.now()) {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    if (lowTier && (frameSkip++ & 1)) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (assembling) stepAssembly(now);
    desired();
    const k = reduced ? 1 : 1 - Math.exp(-dt * 3.4);
    cur.target.lerp(want.target, k); cur.dir.lerp(want.dir, k).normalize();
    cur.dist += (want.dist - cur.dist) * k; cur.side += (want.side - cur.side) * k; cur.heroW += (want.heroW - cur.heroW) * k;
    if (!drag.on) { drag.yaw *= reduced ? 0 : 0.92; drag.pitch *= reduced ? 0 : 0.92; }
    const d = cur.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), drag.yaw * cur.heroW);
    d.y = clamp(d.y + drag.pitch * cur.heroW, -0.2, 0.95); d.normalize();
    let dist = cur.dist;
    const aspect = innerWidth / innerHeight;
    if (aspect < 1) dist *= 1 + (1 - aspect) * 1.15 * cur.heroW + (1 - aspect) * 0.35;
    camPos.copy(cur.target).addScaledVector(d, dist);
    camera.position.copy(camPos); camera.lookAt(cur.target);
    // depth range follows the shot: a fixed 0.05 near plane z-fights trim against the wall from 14 m out
    camera.near = clamp(dist * 0.3, 0.05, 4); camera.far = dist + 16;
    const w = innerWidth, h = innerHeight;
    if (narrow()) camera.setViewOffset(w, h, 0, h * 0.2, w, h); else camera.setViewOffset(w, h, -cur.side * w, 0, w, h);
    pick();
    const vidWanted = cur.heroW > 0.2 || cur.target.distanceTo(SHOTS.monitor.target) < 0.9;
    if (!video.paused && video.currentTime !== screenDesk.last) { screenDesk.last = video.currentTime; drawDesktop(); }
    if (vidWanted && video.paused && !reduced) video.play().catch(() => {});
    else if (!vidWanted && !video.paused) video.pause();
    if (composer) composer.render(); else renderer.render(scene, camera);
    if (!sampled && nodes.length && !assembling) sampleBackground();
    placeHotspots();
  }
}

/* ---------- helpers ---------- */
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
