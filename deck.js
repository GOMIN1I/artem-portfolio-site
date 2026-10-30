import * as THREE from 'three';

/* The hi-fi corner: console, turntable, amplifier and the sleeve. Everything is built here so moving
   parts stay separate; metres, y-up, front of the furniture is +z. Lit by a cube map of the room itself. */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Record geometry. Side C holds two tracks: Swimming Pools is the first quarter of the playing area.
export const VINYL = { y: 0.1232, rOut: 0.1505, rIn: 0.0502, lead: 0.1458, end: 0.1218, gap: 0.1209, runOut: 0.0655 };
const ARM = { px: 0.21, pz: -0.115, y: 0.16, rest: -0.012 };
ARM.d = Math.hypot(ARM.px, ARM.pz); ARM.L = ARM.d + 0.016; // 16 mm of overhang past the spindle

function rbox(w, h, d, r, bev = 0.002, seg = 3) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * bev, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: seg, curveSegments: 10, steps: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, bev, 0);
  return g;
}
// Lathe with crisp edges: each corner becomes a tiny chamfer so normals stay flat on the faces,
// and explicit tangents so brushed metal keeps a smooth highlight round the turn.
function lathe(pts, seg = 128, edge = 0.00016) {
  const p = pts.map(([r, y]) => new THREE.Vector2(r, y)), o = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i].clone().sub(p[i - 1]), b = p[i + 1].clone().sub(p[i]);
    const e = Math.min(edge, a.length() * 0.3, b.length() * 0.3);
    o.push(p[i].clone().addScaledVector(a.normalize(), -e), p[i].clone(), p[i].clone().addScaledVector(b.normalize(), e));
  }
  o.push(p[p.length - 1]);
  const g = new THREE.LatheGeometry(o, seg), n = g.attributes.position.count, t = new Float32Array(n * 4), rows = o.length;
  for (let i = 0; i <= seg; i++) for (let j = 0; j < rows; j++) {
    const phi = i / seg * Math.PI * 2, k = (i * rows + j) * 4;
    t[k] = Math.cos(phi); t[k + 1] = 0; t[k + 2] = -Math.sin(phi); t[k + 3] = 1;
  }
  g.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
  return g;
}

// A flat ring with polar UVs: u runs round the spindle, v runs out along the radius.
export function polarRing(r0, r1, segT = 192, segR = 4, y = 0) {
  const pos = [], uv = [], nor = [], tan = [], idx = [];
  for (let j = 0; j <= segR; j++) for (let i = 0; i <= segT; i++) {
    const a = i / segT * TAU, r = r0 + (r1 - r0) * (j / segR);
    pos.push(Math.cos(a) * r, y, Math.sin(a) * r); uv.push(i / segT, j / segR); nor.push(0, 1, 0); tan.push(-Math.sin(a), 0, Math.cos(a), 1);
  }
  const row = segT + 1;
  for (let j = 0; j < segR; j++) for (let i = 0; i < segT; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('tangent', new THREE.Float32BufferAttribute(tan, 4)); // per-pixel tangents from UVs would facet the wedge of light
  g.setIndex(idx);
  return g;
}

/* The grooves live in a one-dimensional strip along the radius, so a macro shot gets real pitch
   and a wide shot gets the mipmapped sheen of bands, lead-in and run-out. */
function grooveMaps(rnd, aniso) {
  const H = 4096, W = 4;
  const n = document.createElement('canvas'), r = document.createElement('canvas');
  n.width = r.width = W; n.height = r.height = H;
  const ng = n.getContext('2d'), rg = r.getContext('2d');
  const ni = ng.createImageData(W, H), ri = rg.createImageData(W, H);
  const { rIn, rOut, lead, end, gap, runOut } = VINYL;
  let loud = 0.6, target = 0.6, pitch = 5.2, phase = 0;
  for (let y = 0; y < H; y++) {
    const rad = rOut + (rIn - rOut) * (y / H); // canvas top sits at v = 1, the outer edge
    const cut = (rad < lead && rad > end) || (rad < gap && rad > runOut);
    if (y % 40 === 0) { target = 0.3 + rnd() * 0.7; pitch = 4.6 + rnd() * 1.4; }
    loud += (target - loud) * 0.02;
    phase += TAU / pitch;
    const slope = cut ? Math.sin(phase) * (0.55 + 0.45 * loud) : (Math.sin(y * 0.11) * 0.03);
    const rough = cut ? 0.42 + 0.14 * loud : 0.2;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      ni.data[i] = 128; ni.data[i + 1] = 128 + slope * 110; ni.data[i + 2] = 255; ni.data[i + 3] = 255;
      const q = rough * 255; ri.data[i] = q; ri.data[i + 1] = q; ri.data[i + 2] = q; ri.data[i + 3] = 255;
    }
  }
  ng.putImageData(ni, 0, 0); rg.putImageData(ri, 0, 0);
  const make = (c) => {
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
  };
  return { normal: make(n), rough: make(r) };
}

function vuFace(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(w / 2, h * 1.05, h * 0.1, w / 2, h * 1.05, h * 1.25);
  gr.addColorStop(0, '#ffdf9e'); gr.addColorStop(0.7, '#f5ad4b'); gr.addColorStop(1, '#a8601c');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 1.02, R = h * 0.78;
  g.strokeStyle = '#2a1608'; g.fillStyle = '#2a1608'; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2 - 0.68, -Math.PI / 2 + 0.34); g.stroke();
  g.strokeStyle = '#a3170b'; g.lineWidth = 7;
  g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2 + 0.34, -Math.PI / 2 + 0.68); g.stroke();
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 - 0.68 + 1.36 * i / 12, l = i % 3 === 0 ? 20 : 11;
    g.strokeStyle = i > 9 ? '#a3170b' : '#2a1608'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R + l), cy + Math.sin(a) * (R + l)); g.stroke();
  }
  g.fillStyle = '#2a1608'; g.font = '700 20px Georgia, serif'; g.textAlign = 'center'; g.fillText('VU', cx, h * 0.72);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function softShadow(size, inner) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.92)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildDeck({ scene, renderer, texLoader, lowTier, rnd, aniso }) {
  const P = lowTier ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;
  const phys = (o, extra) => new P(lowTier ? o : { ...o, ...extra });

  /* ---------- materials ---------- */
  const oak = texLoader.load('assets/room/detail/oak-m.jpg');
  oak.colorSpace = THREE.NoColorSpace; oak.wrapS = oak.wrapT = THREE.RepeatWrapping; oak.anisotropy = aniso; oak.repeat.set(1.15, 1.15); oak.rotation = Math.PI / 2; // grain runs along the furniture
  const wood = (color, strength, gloss) => {
    const m = phys({ color, map: oak, roughness: 0.46 - gloss * 0.22 }, { clearcoat: gloss, clearcoatRoughness: 0.2 });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
        `#ifdef USE_MAP\n diffuseColor.rgb *= max(0.0, 1.0 + ${strength.toFixed(2)} * (2.0 * texture2D(map, vMapUv).r - 1.0));\n#endif`);
    };
    return m;
  };
  const M = {
    walnut: wood('#6a3a1e', 0.95, 0.75),
    walnutDark: wood('#3f2212', 0.95, 0.35),
    plate: phys({ color: '#26252a', metalness: 0.92, roughness: 0.4 }, { anisotropy: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.5 }),
    face: phys({ color: '#a39f97', metalness: 1, roughness: 0.42 }, { anisotropy: 0.5 }),
    alu: phys({ color: '#d6d3cc', metalness: 1, roughness: 0.26 }, { anisotropy: 0.75 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#ece9e3', metalness: 1, roughness: 0.09 }),
    black: phys({ color: '#141417', metalness: 0.85, roughness: 0.36 }, { clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    satin: new THREE.MeshStandardMaterial({ color: '#0d0d10', metalness: 0.2, roughness: 0.55 }),
    brass: new THREE.MeshStandardMaterial({ color: '#c79a58', metalness: 1, roughness: 0.27 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d9ab58', metalness: 1, roughness: 0.2 }),
    bronze: new THREE.MeshStandardMaterial({ color: '#c0925c', metalness: 0.62, roughness: 0.4 }),
    felt: new THREE.MeshStandardMaterial({ color: '#17171b', metalness: 0, roughness: 0.95 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#08080a', metalness: 0, roughness: 0.82 }),
    paper: new THREE.MeshStandardMaterial({ color: '#d9d3c7', metalness: 0, roughness: 0.82 }),
    diamond: new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.4, roughness: 0.06 })
  };
  const grooves = grooveMaps(rnd, aniso);
  M.vinyl = phys({ color: '#060607', metalness: 0, roughness: 1, roughnessMap: grooves.rough, normalMap: grooves.normal, normalScale: new THREE.Vector2(0.5, 0.5) },
    { anisotropy: 0.82, specularIntensity: 1, ior: 1.52 });
  M.vinylEdge = new THREE.MeshStandardMaterial({ color: '#050506', metalness: 0, roughness: 0.22 });
  const label = texLoader.load('assets/vinyl/label-side-c.jpg');
  label.colorSpace = THREE.SRGBColorSpace; label.anisotropy = aniso;
  M.label = new THREE.MeshStandardMaterial({ map: label, roughness: 0.5, metalness: 0 });
  const cover = texLoader.load('assets/vinyl/cover.jpg');
  cover.colorSpace = THREE.SRGBColorSpace; cover.anisotropy = aniso;
  M.cover = new THREE.MeshStandardMaterial({ map: cover, roughness: 0.58, metalness: 0 });
  const live = [];
  M.pilot = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.1, 0.25), toneMapped: false }); live.push(M.pilot);

  /* ---------- helpers that add a part to a parent ---------- */
  const shadowed = [];
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, cast = true) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (!lowTier) { m.castShadow = cast; m.receiveShadow = true; }
    parent.add(m); return m;
  };
  const rod = (r, h, seg = 24) => new THREE.CylinderGeometry(r, r, h, seg);

  const rig = new THREE.Group(); rig.name = 'Deck';

  /* ---------- the console: fluted walnut on brass-shod legs ---------- */
  const W = 1.3, D = 0.44, LEG = 0.2, BODY = 0.4, TOP = LEG + BODY;
  add(rig, rbox(W, BODY - 0.03, D, 0.012, 0.004), M.walnut, 0, LEG, 0);
  add(rig, rbox(W + 0.02, 0.03, D + 0.02, 0.016, 0.006, 4), M.walnut, 0, TOP - 0.03, 0);
  const rib = new THREE.CylinderGeometry(0.0062, 0.0062, BODY - 0.07, 10, 1, false, 0, Math.PI);
  const nRibs = Math.floor((W - 0.05) / 0.0124);
  const ribs = new THREE.InstancedMesh(rib, M.walnut, nRibs);
  const mx = new THREE.Matrix4();
  for (let i = 0; i < nRibs; i++) { mx.makeRotationY(-Math.PI / 2); mx.setPosition(-W / 2 + 0.03 + i * 0.0124, LEG + BODY / 2 - 0.018, D / 2 + 0.001); ribs.setMatrixAt(i, mx); }
  rig.add(ribs);
  [-0.016, 0.016].forEach((x) => add(rig, rod(0.0045, 0.15, 16), M.brass, x, LEG + BODY / 2, D / 2 + 0.018));
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const leg = new THREE.Group(); leg.position.set(sx * (W / 2 - 0.09), LEG, sz * (D / 2 - 0.06)); leg.rotation.set(sz * 0.09, 0, -sx * 0.09);
    add(leg, new THREE.CylinderGeometry(0.018, 0.0105, LEG - 0.05, 20), M.walnutDark, 0, -(LEG - 0.05) / 2, 0);
    add(leg, new THREE.CylinderGeometry(0.0105, 0.0085, 0.052, 20), M.brass, 0, -(LEG - 0.05) - 0.026, 0);
    rig.add(leg);
  });

  /* ---------- turntable ---------- */
  const tt = new THREE.Group(); tt.position.set(-0.04, TOP, 0.01); rig.add(tt);
  const PW = 0.47, PD = 0.37, cx = 0.045; // the plinth sits off-centre under the spindle to make room for the arm
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const fx = cx + sx * (PW / 2 - 0.04), fz = sz * (PD / 2 - 0.04);
    add(tt, lathe([[0, 0], [0.023, 0], [0.025, 0.003], [0.021, 0.016], [0.019, 0.019], [0, 0.019]], 40), M.black, fx, 0, fz);
    add(tt, lathe([[0, 0], [0.012, 0], [0.012, 0.003], [0, 0.003]], 24), M.rubber, fx, 0, fz);
  });
  add(tt, rbox(PW, 0.052, PD, 0.016, 0.0035, 4), M.walnut, cx, 0.019, 0);
  add(tt, rbox(PW - 0.012, 0.0065, PD - 0.012, 0.012, 0.0012, 2), M.plate, cx, 0.0712, 0);

  const platter = new THREE.Group(); tt.add(platter);
  add(platter, lathe([[0, 0.079], [0.14, 0.079], [0.1498, 0.0825], [0.1512, 0.0855], [0.1512, 0.1138], [0.1502, 0.1158], [0.1485, 0.1165], [0, 0.1165]], 180), M.alu);
  const dots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0034, 0.0022, 0.0009), M.chrome, 360);
  for (let i = 0; i < 360; i++) {
    const rowOuter = i < 180, a = (i % 180) / 180 * TAU, y = rowOuter ? 0.0962 : 0.1032;
    mx.makeRotationY(-a + Math.PI / 2); mx.setPosition(Math.cos(a) * 0.1516, y, Math.sin(a) * 0.1516); dots.setMatrixAt(i, mx);
  }
  platter.add(dots);
  add(platter, lathe([[0, 0.1165], [0.1475, 0.1165], [0.1475, 0.1195], [0, 0.1195]], 128), M.felt, 0, 0, 0, false);

  const record = new THREE.Group(); platter.add(record);
  add(record, lathe([[0.0505, 0.1212], [VINYL.rOut - 0.0015, 0.1212], [VINYL.rOut, 0.1216], [VINYL.rOut + 0.0002, 0.122], [VINYL.rOut, 0.1226], [VINYL.rOut - 0.0015, VINYL.y]], 180), M.vinylEdge);
  const surf = add(record, polarRing(VINYL.rIn, VINYL.rOut - 0.0012, 220, 3, VINYL.y), M.vinyl, 0, 0, 0, false);
  surf.name = 'Vinyl';
  const labelMesh = add(record, new THREE.CircleGeometry(VINYL.rIn + 0.0006, 96).rotateX(-Math.PI / 2), M.label, 0, VINYL.y + 0.00012, 0, false);
  labelMesh.rotation.y = 2.1;
  add(platter, lathe([[0.0017, VINYL.y], [0.0017, VINYL.y + 0.012], [0.0011, VINYL.y + 0.0135], [0, VINYL.y + 0.0139]], 24), M.chrome);
  const clamp3 = add(platter, lathe([[0.0148, 0], [0.0148, 0.0009], [0.0142, 0.0016], [0.0118, 0.0026], [0.0102, 0.0042], [0.0096, 0.0068], [0.0096, 0.0148], [0.0102, 0.0156], [0.0102, 0.0176], [0.0094, 0.0186], [0.0036, 0.0186], [0.0028, 0.0194], [0, 0.0194]], 96), M.alu, 0, VINYL.y + 0.0002, 0);
  clamp3.name = 'Clamp';

  // Start/stop and speed: machined rotary controls at the front corners, an amber pilot beside them
  const startBtn = new THREE.Group(); startBtn.position.set(-0.155 + cx - 0.018, 0.078, 0.148); tt.add(startBtn);
  const startCap = add(startBtn, lathe([[0.0145, 0], [0.0145, 0.0072], [0.0132, 0.0092], [0, 0.0092]], 56), M.alu);
  add(startBtn, rod(0.0009, 0.0002, 8), M.pilot, 0.008, 0.0094, 0, false);
  startCap.name = 'StartStop';
  const speed = add(tt, lathe([[0.0098, 0], [0.0098, 0.0058], [0.0088, 0.0074], [0, 0.0074]], 48), M.alu, startBtn.position.x + 0.042, 0.078, 0.148);
  speed.rotation.y = 0.5;
  add(tt, rod(0.0024, 0.0016, 18), M.pilot, startBtn.position.x + 0.076, 0.0782, 0.148, false);

  /* ---------- tonearm ---------- */
  add(tt, lathe([[0.03, 0], [0.03, 0.0035], [0.0268, 0.0052], [0.0235, 0.0052], [0.0225, 0.0105], [0.0172, 0.0118], [0.0158, 0.04], [0.0145, 0.0425], [0, 0.0425]], 72), M.chrome, ARM.px, 0.078, ARM.pz);
  const armYaw = new THREE.Group(); armYaw.position.set(ARM.px, ARM.y, ARM.pz); tt.add(armYaw);
  add(armYaw, lathe([[0.0185, -0.021], [0.0198, -0.0195], [0.0198, -0.0125], [0.0165, -0.011], [0.0165, -0.0085], [0, -0.0085]], 56), M.black);
  const yoke = new THREE.TorusGeometry(0.0185, 0.0026, 12, 56, Math.PI).rotateY(Math.PI / 2);
  add(armYaw, yoke, M.black, 0, -0.008, 0);
  [-1, 1].forEach((s) => add(armYaw, new THREE.SphereGeometry(0.0034, 18, 12), M.gold, 0, 0.0002, s * 0.0002).position.setX(s * 0.0));
  const armPitch = new THREE.Group(); armYaw.add(armPitch);
  [-1, 1].forEach((s) => { add(armPitch, rod(0.0028, 0.012, 16).rotateZ(Math.PI / 2), M.gold, s * 0.0135, 0, 0); });
  add(armPitch, new THREE.SphereGeometry(0.0108, 28, 20), M.black);
  const headAng = -0.385, hd = v3(Math.sin(headAng), 0, Math.cos(headAng)); // offset angle that keeps the stylus tangent to the groove
  const tipLocal = v3(0, VINYL.y - ARM.y, ARM.L);
  const headBack = tipLocal.clone().addScaledVector(hd, -0.05); headBack.y = -0.0125;
  const tube = new THREE.CatmullRomCurve3([v3(0, 0, 0), v3(-0.0035, -0.0012, 0.05), v3(-0.0125, -0.0035, 0.1), v3(-0.005, -0.0065, 0.16), v3(headBack.x - hd.x * 0.022, -0.01, headBack.z - hd.z * 0.022), headBack.clone()]);
  add(armPitch, new THREE.TubeGeometry(tube, 96, 0.0052, 20), M.chrome);
  add(armPitch, lathe([[0, 0], [0.0062, 0], [0.0066, 0.002], [0.0066, 0.012], [0.0058, 0.0135], [0, 0.0135]], 28).rotateX(Math.PI / 2).translate(0, 0, headBack.z - 0.003), M.black, headBack.x, headBack.y, 0).rotation.y = 0;
  add(armPitch, rod(0.0044, 0.056, 20).rotateX(Math.PI / 2), M.chrome, 0, 0, -0.038);
  const cw = add(armPitch, lathe([[0, -0.018], [0.0205, -0.018], [0.0215, -0.0165], [0.0215, 0.0128], [0.0195, 0.0152], [0.0078, 0.0158], [0.0068, 0.019], [0, 0.019]], 72).rotateX(-Math.PI / 2), M.alu, 0, 0, -0.082);
  cw.name = 'Counterweight';
  for (let i = 0; i < 44; i++) { // knurling on the counterweight grip
    const a = i / 44 * TAU; add(cw, new THREE.BoxGeometry(0.0009, 0.0009, 0.019), M.chrome, Math.cos(a) * 0.0216, Math.sin(a) * 0.0216, 0.0, false);
  }

  const head = new THREE.Group(); head.position.copy(headBack); head.rotation.y = headAng; armPitch.add(head);
  const shell = new THREE.Shape();
  [[-0.0052, 0], [0.0052, 0], [0.0098, 0.012], [0.0098, 0.058], [0.0076, 0.0635], [-0.0076, 0.0635], [-0.0098, 0.058], [-0.0098, 0.012]].forEach(([x, y], i) => (i ? shell.lineTo(x, y) : shell.moveTo(x, y)));
  add(head, new THREE.ExtrudeGeometry(shell, { depth: 0.0028, bevelEnabled: true, bevelSize: 0.0006, bevelThickness: 0.0006, bevelSegments: 3 }).rotateX(Math.PI / 2).translate(0, 0.0012, 0), M.black);
  const lift = new THREE.CatmullRomCurve3([v3(-0.0092, -0.0004, 0.056), v3(-0.0166, 0.0015, 0.066), v3(-0.0232, 0.0078, 0.0705), v3(-0.0262, 0.0126, 0.0716)]);
  add(head, new THREE.TubeGeometry(lift, 24, 0.0011, 10), M.chrome);
  // The cartridge, side-on: a tapered black body with a gold plate, two mounting screws, four pin leads, cantilever and diamond
  const plate = document.createElement('canvas'); plate.width = 512; plate.height = 146;
  const plateTex = new THREE.CanvasTexture(plate); plateTex.colorSpace = THREE.SRGBColorSpace; plateTex.anisotropy = 8;
  const drawPlate = () => {
    const g = plate.getContext('2d');
    g.fillStyle = '#121216'; g.fillRect(0, 0, 512, 146);
    g.strokeStyle = '#e0ad62'; g.lineWidth = 4; g.strokeRect(10, 10, 492, 126);
    g.fillStyle = '#f2c07a'; g.font = '600 92px Tektur, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText('artem_', 256, 78);
    plateTex.needsUpdate = true;
  };
  drawPlate(); document.fonts?.load('600 92px Tektur').then(drawPlate).catch(() => {});
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, metalness: 0.5, roughness: 0.35 });
  const prof = new THREE.Shape();
  [[0.0165, -0.0012], [0.0482, -0.0012], [0.0522, -0.0042], [0.0528, -0.0128], [0.0478, -0.0186], [0.0342, -0.0196], [0.0296, -0.0166], [0.0165, -0.0166]].forEach(([z, y], i) => (i ? prof.lineTo(z, y) : prof.moveTo(z, y)));
  const prism = new THREE.ExtrudeGeometry(prof, { depth: 0.0142, bevelEnabled: true, bevelSize: 0.0009, bevelThickness: 0.0011, bevelSegments: 4, curveSegments: 4 });
  prism.rotateY(-Math.PI / 2); prism.translate(0.0071, 0, 0);
  add(head, prism, M.bronze);
  [-1, 1].forEach((s) => {
    add(head, new THREE.PlaneGeometry(0.0232, 0.0066), plateMat, s * 0.0088, -0.0088, 0.0332, false).rotation.y = s * Math.PI / 2;
    [0.0232, 0.0432].forEach((z) => add(head, rod(0.0016, 0.0016, 12), M.chrome, s * 0.0, 0.0024, z, false));
  });
  add(head, rbox(0.0086, 0.0034, 0.009, 0.0008, 0.0004, 2), M.gold, 0, -0.0206, 0.0408, false);
  const stem = tipLocal.clone().sub(headBack); const tipInHead = v3(0, stem.y, stem.dot(hd));
  const cant = new THREE.CatmullRomCurve3([v3(0, -0.0198, 0.0436), tipInHead.clone().add(v3(0, 0.0009, -0.0005))]);
  add(head, new THREE.TubeGeometry(cant, 4, 0.00042, 8), M.chrome);
  add(head, new THREE.ConeGeometry(0.0005, 0.0013, 8).rotateX(Math.PI), M.diamond, tipInHead.x, tipInHead.y + 0.00065, tipInHead.z);
  ['#c3272b', '#2f7d3b', '#2e5fb0', '#e9e6df'].forEach((c, i) => {
    const sx = i % 2 ? 1 : -1, sy = i < 2 ? -0.0102 : -0.0132;
    const w = new THREE.CatmullRomCurve3([v3(sx * 0.0055, sy, 0.0208), v3(sx * 0.0072, sy + 0.003, 0.0158), v3(sx * 0.0035, -0.0044, 0.0088), v3(sx * 0.0024, 0.0005, -0.0004)]);
    add(head, new THREE.TubeGeometry(w, 16, 0.00034, 6), new THREE.MeshStandardMaterial({ color: c, roughness: 0.42 }));
    add(head, rod(0.00075, 0.0034, 10).rotateX(Math.PI / 2), M.gold, sx * 0.0055, sy, 0.0216);
  });
  const tip = new THREE.Object3D(); tip.position.copy(tipInHead); head.add(tip);

  // Arm rest and cueing lever
  const restZ = ARM.pz + ARM.L * 0.8, restX = ARM.px + Math.sin(ARM.rest) * ARM.L * 0.8;
  add(tt, rod(0.0028, 0.05, 16), M.chrome, restX, 0.078 + 0.025, restZ);
  add(tt, new THREE.TorusGeometry(0.0082, 0.0014, 10, 32, Math.PI).rotateZ(Math.PI).rotateY(Math.PI / 2 + ARM.rest), M.satin, restX, 0.0795 + 0.058, restZ);
  const cue = new THREE.Group(); cue.position.set(ARM.px + 0.034, 0.0785, ARM.pz + 0.016); tt.add(cue);
  add(cue, rod(0.0062, 0.012, 24), M.chrome, 0, 0.006, 0);
  const cueArm = new THREE.Group(); cueArm.position.set(0, 0.012, 0); cue.add(cueArm);
  add(cueArm, rod(0.0017, 0.03, 12).rotateZ(Math.PI / 2).translate(0.014, 0, 0), M.chrome);
  add(cueArm, new THREE.SphereGeometry(0.0042, 18, 12), M.black, 0.03, 0, 0);

  /* ---------- amplifier: the volume lives here ---------- */
  const amp = new THREE.Group(); amp.position.set(-0.47, TOP, 0.03); rig.add(amp);
  const AW = 0.33, AH = 0.112, AD = 0.3;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => add(amp, rod(0.012, 0.012, 20), M.rubber, sx * (AW / 2 - 0.03), 0.006, sz * (AD / 2 - 0.03)));
  add(amp, rbox(AW, AH - 0.012, AD, 0.008, 0.0025, 3), M.walnut, 0, 0.012, 0);
  add(amp, rbox(AW - 0.02, 0.003, AD - 0.03, 0.002, 0.0006, 1), M.black, 0, AH - 0.0012, -0.003);
  const vents = new THREE.InstancedMesh(new THREE.BoxGeometry(0.003, 0.0012, 0.11), M.satin, 36);
  for (let i = 0; i < 36; i++) { mx.identity(); mx.setPosition(-0.14 + i * 0.008, AH + 0.0015, -0.055); vents.setMatrixAt(i, mx); }
  amp.add(vents);
  const face = add(amp, rbox(AW - 0.018, 0.092, 0.006, 0.003, 0.0012, 2), M.face, 0, 0.022, AD / 2 + 0.0002); face.name = 'AmpFace';
  const dial = new THREE.MeshBasicMaterial({ map: vuFace(420, 220), toneMapped: false, color: new THREE.Color(1.08, 1.08, 1.08) }); live.push(dial);
  const needles = [];
  [-0.098, -0.008].forEach((x) => {
    const y = 0.07, z = AD / 2 + 0.0064, w = 0.082, h = 0.043;
    add(amp, rbox(w + 0.006, 0.0022, h + 0.006, 0.002, 0.0006, 1).rotateX(Math.PI / 2), M.black, x, y, z - 0.0026, false);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), dial); glass.position.set(x, y, z); amp.add(glass);
    const pivot = new THREE.Group(); pivot.position.set(x, y - h * 0.5, z + 0.0006); amp.add(pivot);
    const nm = new THREE.Mesh(new THREE.BoxGeometry(0.0006, h * 0.86, 0.0003).translate(0, h * 0.43, 0), new THREE.MeshBasicMaterial({ color: '#1a0c05', toneMapped: false }));
    pivot.add(nm); pivot.rotation.z = 0.68; needles.push({ p: pivot, v: 0.68 });
  });
  const knob = new THREE.Group(); knob.position.set(0.098, 0.0695, AD / 2 + 0.0036); amp.add(knob);
  const knobCap = add(knob, lathe([[0.03, 0], [0.03, 0.0048], [0.0278, 0.0056], [0.0272, 0.0192], [0.0252, 0.0212], [0, 0.0212]], 72).rotateX(Math.PI / 2), M.alu);
  knobCap.name = 'Volume';
  add(knob, new THREE.BoxGeometry(0.0022, 0.016, 0.001), M.pilot, 0, 0.0178, 0.0216, false);
  for (let i = 0; i < 11; i++) { // scale around the knob
    const a = -2.36 + 4.72 * i / 10; add(amp, new THREE.BoxGeometry(0.0009, 0.0034, 0.0004), M.black, 0.098 + Math.sin(a) * 0.0355, 0.0695 + Math.cos(a) * 0.0355, AD / 2 + 0.0037, false).rotation.z = -a;
  }
  const inputs = [-0.13, -0.098, -0.066, -0.034];
  inputs.forEach((x) => add(amp, lathe([[0.0058, 0], [0.0058, 0.0045], [0.0044, 0.0058], [0, 0.0058]], 28).rotateX(Math.PI / 2), M.brass, x, 0.0345, AD / 2 + 0.0035));
  add(amp, rod(0.0028, 0.002, 18).rotateX(Math.PI / 2), M.pilot, 0.002, 0.0345, AD / 2 + 0.0038, false);

  // RCA leads from the back of the deck to the back of the amp
  [-0.006, 0.006].forEach((dz, i) => {
    const c = new THREE.CatmullRomCurve3([v3(-0.22, TOP + 0.052, -0.17 + dz), v3(-0.26, TOP + 0.03, -0.205 + dz), v3(-0.33, TOP + 0.0045, -0.208 + dz), v3(-0.42, TOP + 0.0045, -0.18 + dz), v3(-0.46, TOP + 0.03, -0.138 + dz)]);
    add(rig, new THREE.TubeGeometry(c, 48, 0.0024, 10), i ? M.satin : M.rubber);
  });

  /* ---------- the sleeve on a brass rest ---------- */
  const SL = 0.315;
  const sleeveRig = new THREE.Group(); sleeveRig.position.set(0.415, TOP, -0.035); sleeveRig.rotation.y = -0.52; rig.add(sleeveRig);
  add(sleeveRig, rbox(0.27, 0.007, 0.075, 0.006, 0.0012, 2), M.brass, 0, 0, 0.018);
  add(sleeveRig, rbox(0.24, 0.016, 0.0036, 0.0015, 0.0006, 1), M.brass, 0, 0.004, 0.048);
  const tilt = new THREE.Group(); tilt.position.set(0, 0.008, 0.038); tilt.rotation.x = -0.21; sleeveRig.add(tilt);
  add(tilt, rod(0.0028, 0.2, 12), M.brass, 0, 0.1, -0.0072);
  const sleeve = add(tilt, new THREE.BoxGeometry(SL, SL, 0.0042), [M.paper, M.paper, M.paper, M.paper, M.cover, M.paper], 0, SL / 2, 0);
  sleeve.name = 'Sleeve';

  /* ---------- light: a warm key with real shadows, a cold kicker that draws the wedge on the vinyl ---------- */
  const key = new THREE.SpotLight('#ffc78c', 3, 0, 0.62, 0.9, 0);
  key.position.set(-0.75, TOP + 1.55, 0.72); key.target.position.set(0, TOP + 0.08, 0);
  if (!lowTier) {
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.camera.near = 0.6; key.shadow.camera.far = 3.2;
    key.shadow.bias = -0.00012; key.shadow.normalBias = 0.0012; key.shadow.radius = 5;
  }
  const kick = new THREE.SpotLight('#86d9ff', 2.2, 0, 0.17, 0.75, 0);
  kick.position.set(0.95, TOP + 0.5, -1.05); kick.target.position.set(-0.04, TOP + 0.12, 0.01);
  const fill = new THREE.PointLight('#ffb36b', 0.04, 1.6, 1.4); fill.position.set(-0.47, TOP + 0.13, 0.3);
  const macro = new THREE.PointLight('#ffd9ab', 0, 0.55, 2); macro.position.set(0.04, 0.2, 0.2); tt.add(macro); // only the macro shots use it
  rig.add(key, key.target, kick, kick.target, fill);

  const floorShade = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.35).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: softShadow(256, 0.1), transparent: true, depthWrite: false, opacity: 0.86, toneMapped: false }));
  floorShade.position.set(0.04, 0.012, -0.04); floorShade.renderOrder = 1; rig.add(floorShade);

  const proxy = new THREE.Mesh(new THREE.BoxGeometry(W + 0.05, 0.75, D + 0.1).translate(0, 0.38, 0), new THREE.MeshBasicMaterial());
  proxy.visible = false; proxy.material.userData.live = true; proxy.name = 'DeckProxy'; rig.add(proxy);

  /* ---------- behaviour ---------- */
  const yawFor = (r) => {
    const K = (r * r - ARM.d * ARM.d - ARM.L * ARM.L) / (2 * ARM.L);
    return Math.atan2(ARM.px, ARM.pz) - Math.acos(clamp(K / ARM.d, -1, 1));
  };
  const arm = { yaw: ARM.rest, lift: 0.46, wantYaw: ARM.rest, wantLift: 0.46, snap: false };
  const SPEED = 3.491; // 33⅓ rpm
  let spin = 0, spinWant = 0, wobble = 0, vuL = 0, vuR = 0, knobAngle = 0;

  const deck = {
    KEY: 1.15, KICK: 0.5, FILL: 0.03,
    rig, tt, tip, platter, record, arm, needles, key, kick, fill, macro, sleeve, amp, proxy, yawFor, TOP, floorShade,
    picks: { start: startCap, vinyl: surf, label: labelMesh, clamp: clamp3, volume: knobCap, sleeve },
    sleeveCenter: () => sleeve.getWorldPosition(new THREE.Vector3()),
    restYaw: ARM.rest,
    rFor: (p) => VINYL.lead + (VINYL.end - VINYL.lead) * clamp(p, 0, 1),
    setSpin(on) { spinWant = on ? SPEED : 0; },
    spinning: () => spin > 0.3,
    setVolumeKnob(v) { knobAngle = 2.36 - 4.72 * clamp(v, 0, 1); },
    // the arm: `want` values ease in, `snap` hands every frame to the intro
    update(dt, level) {
      spin += (spinWant - spin) * (1 - Math.exp(-dt * (spinWant ? 2.1 : 1.1)));
      platter.rotation.y -= spin * dt;
      wobble += spin * dt;
      record.rotation.set(Math.sin(wobble) * 0.0011, 0, Math.cos(wobble) * 0.0011); // a real pressing is never quite flat
      if (arm.snap) { /* driven directly */ } else {
        const far = Math.abs(arm.wantYaw - arm.yaw) > 0.022;
        arm.yaw += (arm.wantYaw - arm.yaw) * (1 - Math.exp(-dt * (far ? 2.6 : 9)));
        const liftWant = far ? Math.max(arm.wantLift, 1) : arm.wantLift;
        arm.lift += (liftWant - arm.lift) * (1 - Math.exp(-dt * 6.5));
      }
      armYaw.rotation.y = arm.yaw;
      armPitch.rotation.x = -0.062 * arm.lift + (arm.lift < 0.04 ? Math.sin(wobble) * 0.00042 : 0);
      cueArm.rotation.z = clamp(arm.lift, 0, 1) * 0.5;
      const l = clamp(level, 0, 1.15);
      vuL += (l - vuL) * (1 - Math.exp(-dt * (l > vuL ? 16 : 5)));
      vuR += (l * 0.92 - vuR) * (1 - Math.exp(-dt * (l > vuR ? 13 : 4.2)));
      needles[0].p.rotation.z = 0.68 - 1.36 * clamp(vuL, 0, 1.1);
      needles[1].p.rotation.z = 0.68 - 1.36 * clamp(vuR, 0, 1.1);
      knob.rotation.z += (knobAngle - knob.rotation.z) * (1 - Math.exp(-dt * 14));
    },
    // Reflections are the room itself, captured once it is lit, so the metal belongs in the scene.
    captureEnv() {
      rig.visible = false;
      const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
      const cube = new THREE.CubeCamera(0.05, 30, rt);
      cube.position.copy(tt.getWorldPosition(new THREE.Vector3())).add(v3(0, 0.32, 0));
      cube.update(renderer, scene);
      const pm = new THREE.PMREMGenerator(renderer);
      const env = pm.fromCubemap(rt.texture);
      scene.environment = env.texture;
      pm.dispose(); rt.dispose();
      rig.visible = true;
    }
  };
  armYaw.rotation.y = arm.yaw; armPitch.rotation.x = -0.062 * arm.lift;
  key.intensity = deck.KEY; kick.intensity = deck.KICK; fill.intensity = deck.FILL;
  return deck;
}
