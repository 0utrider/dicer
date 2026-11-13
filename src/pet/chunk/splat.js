import * as THREE from 'three';

/**
 * The splat a pet leaves: a goo burst that settles into a flat puddle of the pet's colour, and
 * pulls back together when the pet reforms. A placeholder look (a disc, a few droplets and two
 * eyes); `kind` is for the real design to vary the leftovers (a lid, a wing). It stands on y = 0
 * in the pet's own space and animates only inside its root.
 *
 * createSplat(kind, color) -> { root, pose(phase: 'burst'|'puddle'|'reform', t), dispose }
 *   burst: t 0..1, droplets fly out and fall, the puddle spreads.
 *   puddle: t 0..1, the eyes open and blink once; t = 1 is the resting look.
 *   reform: t 0..1, everything pulls into the middle.
 */
const RADIUS = 1.05;
const DROPS = 7;
const MIN = 1e-3; // a scale never reaches 0, so no matrix is degenerate

const clamp01 = (t) => (t > 0 ? (t < 1 ? t : 1) : 0); // NaN -> 0
const smooth = (t) => t * t * (3 - 2 * t);
const DROP = Array.from({ length: DROPS }, (_, i) => ({
  a: (i / DROPS) * Math.PI * 2 + 0.4 * Math.sin(i * 7.3),
  reach: 1.2 + 0.7 * ((i * 0.618) % 1),
  size: 0.1 + 0.08 * ((i * 0.37) % 1),
  peak: 0.9 + 0.5 * ((i * 0.29) % 1),
}));

export function createSplat(kind, color) {
  const body = new THREE.Color(color || '#888888');
  const goo = new THREE.MeshStandardMaterial({ color: body, roughness: 0.25, metalness: 0 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5, metalness: 0 });
  const discGeo = new THREE.CylinderGeometry(RADIUS, RADIUS, 0.06, 28);
  const dropGeo = new THREE.SphereGeometry(1, 10, 8);
  const eyeGeo = new THREE.SphereGeometry(0.2, 12, 10);
  const pupilGeo = new THREE.SphereGeometry(0.09, 8, 6);

  const root = new THREE.Group();
  root.name = 'petSplat';
  const disc = new THREE.Mesh(discGeo, goo);
  disc.position.y = 0.03;
  root.add(disc);
  const drops = DROP.map(() => {
    const m = new THREE.Mesh(dropGeo, goo);
    root.add(m);
    return m;
  });
  const eyes = [-0.32, 0.32].map((x) => {
    const e = new THREE.Group();
    e.position.set(x, 0.08, 0.1);
    e.add(new THREE.Mesh(eyeGeo, white));
    const p = new THREE.Mesh(pupilGeo, dark);
    p.position.set(0, 0.02, 0.15);
    e.add(p);
    root.add(e);
    return e;
  });

  /** All parts at once: puddle radius scale, droplet progress (fly 0..1 out and down), eye openness. */
  function set(spread, fly, eye, pull = 1) {
    const r = Math.max(MIN, spread);
    disc.scale.set(r, 1, r);
    for (let i = 0; i < DROPS; i++) {
      const d = DROP[i];
      const m = drops[i];
      const out = Math.sin(fly * Math.PI * 0.5);
      const s = Math.max(MIN, d.size * (fly < 1 ? 1 : 0.7) * pull);
      m.scale.set(s, s * (fly < 1 ? 1 : 0.4), s);
      m.position.set(Math.sin(d.a) * d.reach * out * pull, Math.max(0.03, d.peak * 4 * fly * (1 - fly) * pull), Math.cos(d.a) * d.reach * out * pull);
    }
    for (const e of eyes) {
      e.scale.setScalar(Math.max(MIN, eye * pull));
      e.visible = eye > 0.01;
    }
  }

  function pose(phase, t) {
    const u = clamp01(t);
    if (phase === 'burst') {
      set(0.3 + 0.7 * smooth(u), u, 0);
    } else if (phase === 'reform') {
      const pull = 1 - smooth(u);
      set(Math.max(MIN, pull), 1, 1, Math.max(MIN, pull));
    } else {
      // puddle: the eyes open (first third), blink once (around the middle), then rest
      const open = smooth(clamp01(u * 3));
      const blink = u > 0.5 && u < 0.7 ? 1 - Math.sin(((u - 0.5) / 0.2) * Math.PI) * 0.9 : 1;
      set(1, 1, open * blink);
    }
  }
  pose('puddle', 1);

  return {
    root,
    pose,
    dispose() {
      for (const x of [goo, white, dark, discGeo, dropGeo, eyeGeo, pupilGeo]) x.dispose();
    },
  };
}
