import * as THREE from 'three';
import { polarRing, VINYL } from './deck.js?v=1';

/* The intro, cut to the record. Every time here is a position in the song, read off the audio clock:
   the needle lands in the track's own second of silence, each vocal accent moves the shot, and the
   room lights on the bass at 26.1 s. Sampled from the waveform, 74 BPM. */
export const T = { start: 10, lift: 10.12, swing: 10.45, land: 11.5, touch: 11.97, open: 12, first: 13.15, accents: [13.9, 15.6, 17.2, 18.8, 20.4, 22.05, 23.7, 25.3], drop: 26.1, end: 28.2 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 4);
const span = (t, a, b) => (t - a) / (b - a);

function hermite(keys, t, out) {
  const n = keys.length;
  if (t <= keys[0].t) { keys[0].v.forEach((x, i) => { out[i] = x; }); return out; }
  if (t >= keys[n - 1].t) { keys[n - 1].v.forEach((x, i) => { out[i] = x; }); return out; }
  let i = 0; while (keys[i + 1].t < t) i++;
  const a = keys[i], b = keys[i + 1], h = b.t - a.t, u = (t - a.t) / h;
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const prev = keys[i - 1], next = keys[i + 2];
  for (let k = 0; k < a.v.length; k++) {
    const ma = prev ? (b.v[k] - prev.v[k]) / (b.t - prev.t) : 0, mb = next ? (next.v[k] - a.v[k]) / (next.t - a.t) : 0;
    out[k] = h00 * a.v[k] + h10 * h * ma + h01 * b.v[k] + h11 * h * mb;
  }
  return out;
}

function textRing(text, r0, r1) {
  const c = document.createElement('canvas'); c.width = 4096; c.height = 160;
  const g = c.getContext('2d');
  g.font = '600 104px Tektur, sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  const m = g.measureText(text).width, n = Math.max(1, Math.floor(c.width / m)), gap = (c.width - n * m) / n;
  for (let i = 0; i < n; i++) g.fillText(text, i * (m + gap) + gap / 2, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { map: { value: t }, reveal: { value: 0 }, opacity: { value: 1 }, tint: { value: new THREE.Color(2.1, 1.28, 0.5) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float reveal, opacity; uniform vec3 tint; varying vec2 vUv;
      void main() { float a = texture2D(map, vUv).r * smoothstep(reveal, reveal - 0.03, vUv.x) * opacity; if (a < 0.004) discard; gl_FragColor = vec4(tint * a, a); }`
  });
  return new THREE.Mesh(polarRing(r0, r1, 256, 1), mat);
}

export function makeFilm({ deck, heroKey, lowTier, onLand }) {
  const tmp = new THREE.Vector3();
    const song12 = deck.rFor(12 / 247);
  const a12 = deck.yawFor(song12);
  let keys = [];

  // Shots are written in the turntable's own frame, around the point where the stylus meets the groove.
  function build() {
    const G = new THREE.Vector3(0.21 + (Math.hypot(0.21, 0.115) + 0.016) * Math.sin(a12), VINYL.y, -0.115 + (Math.hypot(0.21, 0.115) + 0.016) * Math.cos(a12));
    const key = (t, p, g) => {
      const pos = deck.tt.localToWorld(new THREE.Vector3(...p)), tgt = deck.tt.localToWorld(new THREE.Vector3(...g));
      const d = pos.clone().sub(tgt), dist = d.length(); d.normalize();
      return { t, v: [tgt.x, tgt.y, tgt.z, d.x, d.y, d.z, Math.log(dist)] };
    };
    const off = (x, y, z) => [G.x + x, G.y + y, G.z + z];
    const near = off(0.009, 0.0045, -0.0075);
    const hero = heroKey();
    const centre = deck.tt.localToWorld(new THREE.Vector3(0.16, 0.09, 0));
    const wide = (t, h, dist, dirMix, from) => {
      const tg = centre.clone().lerp(hero.target, h), d = from.clone().lerp(hero.dir, dirMix).normalize();
      return { t, v: [tg.x, tg.y, tg.z, d.x, d.y, d.z, Math.log(dist)] };
    };
    const k206 = key(20.4, [0.16, 0.62, 1.05], [0.16, 0.1, 0]);
    const d206 = new THREE.Vector3(k206.v[3], k206.v[4], k206.v[5]);
    keys = [
      // the camera waits at the groove; the arm comes in from the right of frame and sets down in the centre
      key(T.start, off(0.07, 0.0195, 0.082), off(-0.012, 0.0035, -0.011)),
      key(T.land, off(0.062, 0.0165, 0.076), off(0.004, 0.004, -0.004)),
      key(T.touch, off(0.056, 0.0145, 0.071), near),
      key(T.first, off(0.047, 0.012, 0.062), near),
      key(T.accents[0], off(0.02, 0.0115, 0.052), off(-0.008, 0.0015, -0.012)),
      key(T.accents[1], [0.03, 0.195, 0.118], [0.004, VINYL.y, 0.012]),
      key(T.accents[2], [-0.006, 0.6, 0.19], [0, VINYL.y, 0.0]),
      key(T.accents[3], [0.27, 0.5, 0.5], [0.24, 0.13, -0.02]),
      k206,
      wide(T.accents[5], 0.22, 2.5, 0.42, d206),
      wide(T.accents[6], 0.62, 5.6, 0.8, d206),
      wide(T.accents[7], 0.9, 10.2, 0.97, d206),
      wide(T.drop, 0.985, hero.dist * 0.93, 1, d206),
      { t: T.end, v: [hero.target.x, hero.target.y, hero.target.z, hero.dir.x, hero.dir.y, hero.dir.z, Math.log(hero.dist)] }
    ];
  }

  /* ---------- motion graphics: type orbits the record, light runs out through the grooves ---------- */
  const fxGroup = new THREE.Group(); fxGroup.visible = false; deck.tt.add(fxGroup);
  const rings = [];
  function buildRings(lines) {
    rings.forEach((r) => { fxGroup.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); r.mesh.material.uniforms.map.value.dispose(); });
    rings.length = 0;
    const spec = [[0.166, 0.194, 15.6, 0.34], [0.206, 0.238, 17.2, -0.24], [0.252, 0.29, 18.8, 0.17]];
    spec.forEach(([r0, r1, at, spin], i) => {
      const mesh = textRing(lines[i], r0, r1); fxGroup.add(mesh);
      rings.push({ mesh, at, spin, r0 });
    });
  }
  const pulseGeo = polarRing(0.992, 1, 200, 1);
  const pulses = T.accents.map(() => {
    const m = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.6, 0.7), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    m.position.y = VINYL.y + 0.0016; fxGroup.add(m); return m;
  });

  // The moment of contact lights the groove the needle dropped into
  const groove = new THREE.Mesh(polarRing(song12 - 0.00065, song12 + 0.00065, 256, 1), pulses[0].material.clone());
  groove.position.y = VINYL.y + 0.0009; groove.visible = false; fxGroup.add(groove);

  const out = new Array(7).fill(0);
  const cam = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 30, sideK: 0, dist: 1, aperture: 0, dim: 0.05, radius: 0, edge: 0, env: 0.3 };
  const film = {
    on: false, t: T.start, landed: false, cam, T,
    prepare(lines) { build(); if (lines) buildRings(lines); fxGroup.visible = true; film.t = T.start; film.landed = false; film.rest(); },
    rebuild: () => { if (keys.length) build(); },
    rest() { deck.arm.snap = true; deck.arm.yaw = deck.restYaw; deck.arm.lift = 0.46; },
    // `t` is the song position; before the track is audible this still advances with it
    update(t, now, dt) {
      film.t = t;
      const arm = deck.arm;
      if (t < T.touch + 0.05) {
        arm.snap = true;
        const swing = smooth(span(t, T.swing, T.land));
        arm.yaw = deck.restYaw + (deck.yawFor(song12) - deck.restYaw) * swing;
        const up1 = smooth(span(t, T.lift, T.swing)), down = smooth(span(t, T.land, T.touch));
        arm.lift = (0.46 + (1 - 0.46) * up1) * (1 - down);
      } else arm.snap = false;

      hermite(keys, t, out);
      cam.tgt.set(out[0], out[1], out[2]);
      tmp.set(out[3], out[4], out[5]).normalize();
      const dist = Math.exp(out[6]);
      cam.pos.copy(cam.tgt).addScaledVector(tmp, dist);
      if (t <= T.start + 0.01) { // the held frame before the click breathes a little
        const s = now * 0.00034;
        cam.pos.x += Math.sin(s) * 0.0026; cam.pos.y += Math.sin(s * 1.3) * 0.0012; cam.pos.z += Math.cos(s * 0.8) * 0.0024;
      }

      let hit = 0;
      T.accents.forEach((a, i) => {
        const age = t - a; const p = pulses[i];
        if (age < 0 || age > 1.5) { p.visible = false; } else {
          hit = Math.max(hit, Math.exp(-age * 5));
          const k = easeOut(age / 1.5); p.visible = true;
          const s = 0.055 + k * (i < 3 ? 0.11 : 0.34) + (i >= 3 ? 0.1 : 0); p.scale.set(s, 1, s);
          p.material.opacity = (1 - k) * (1 - k) * 0.9;
        }
      });
      const needleHit = Math.exp(-Math.max(0, t - T.touch) * 6) * (t >= T.touch ? 1 : 0);
      hit = Math.max(hit, needleHit * 0.8);
      cam.fov = 30 - hit * 0.55;

      rings.forEach((r, i) => {
        const age = t - r.at, m = r.mesh, u = m.material.uniforms;
        m.visible = age > 0 && t < T.accents[5] + 1;
        if (!m.visible) return;
        u.reveal.value = 1.04 * easeOut(age / 1.05);
        u.opacity.value = 1 - smooth(span(t, T.accents[4] + 0.2, T.accents[5] + 0.7));
        m.rotation.y = r.spin * (t - 14);
        const steps = T.accents.filter((a) => a > r.at && a <= t).length, into = T.accents.findLast((a) => a <= t) ?? r.at;
        const lift = 0.018 * (i + 1) + (steps - 1 + easeOut((t - into) / 0.35)) * 0.03;
        m.position.y = VINYL.y + 0.012 + lift;
        const blow = 1 + easeOut(span(t, T.accents[4], T.accents[5] + 0.8)) * 1.1; m.scale.set(blow, 1, blow);
      });

      const mac = 1 - smooth(span(t, 18.8, 22.05));
      deck.key.intensity = 1.25 + mac * 1.3 + hit * 1.2;
      deck.kick.intensity = 0.55 + mac * 5.2 + hit * 7;
      deck.macro.intensity = (smooth(span(t, T.start, T.swing + 0.5)) * 0.03 + 0.012) * (1 - smooth(span(t, T.accents[0], T.accents[1])));
      deck.macro.intensity *= 1.8;
      groove.material.opacity = Math.min(1, needleHit * 1.1 + Math.exp(-Math.max(0, t - T.first) * 3.2) * (t >= T.first ? 0.7 : 0));
      groove.visible = groove.material.opacity > 0.01;
      deck.fill.intensity = 0.05;
      cam.env = 0.34 + 0.66 * smooth(span(t, T.drop - 0.1, T.drop + 1.1));
      cam.dim = 0.08 + 0.12 * smooth(span(t, 20.4, 25.9));
      cam.radius = t < T.drop ? 0 : (t - T.drop) * 9.5;
      cam.edge = t < T.drop ? 0 : Math.max(0, 1 - (t - T.drop) / 1.15) * 1.9;
      cam.sideK = smooth(span(t, 20.4, T.drop));
      cam.dist = dist;
      cam.aperture = lowTier ? 0 : (1 - smooth(span(t, 18.8, 20.4))) * 0.00062 * Math.min(1, 0.09 / dist + 0.1);
      cam.pulse = t >= T.drop ? Math.exp(-(t - T.drop) * 2.4) : 0;
      if (!film.landed && t >= T.drop) { film.landed = true; onLand(); }
      return t >= T.end;
    },
    end() { film.on = false; fxGroup.visible = false; deck.arm.snap = false; }
  };
  return film;
}
