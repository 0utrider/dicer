import RAPIER from '@dimforge/rapier3d-deterministic';
import * as glue from '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js';
import { deriveSeed, seededRandom, throwEdge } from '../core/rng.js';
import {
  CHUNK_STEPS,
  COCKED_FRACTION,
  FLOATS_PER_DIE,
  IMPACT_FLOATS,
  MAX_FREE_STEPS,
  MAX_IMPACTS_PER_CHUNK,
  MAX_NUDGES,
  MAX_OBSTACLES,
  MAX_RELEASE_SPEED,
  MAX_RELEASE_SPIN,
  MAX_STEPS,
  NUDGE_STEPS,
  STEP_SECONDS,
} from './protocol.js';

const GRAVITY = -9.81 * 4;
const DIE_RESTITUTION = 0.35;
const DIE_FRICTION = 0.5;
const FLOOR_FRICTION = 0.8;
const OBSTACLE_FRICTION = 0.05; // dice slide off a pet rather than rest on it
const WALL_HALF_HEIGHT = 12;
/**
 * A hand throw's walls (every die launched): livelier than a die, combined by Max, so a hard flick
 * smashes into the bound and ricochets while a gentle one still just bumps it.
 */
export const HAND_WALL_RESTITUTION = 0.85;
const WALL_HALF_THICKNESS = 1;
const FLOOR_MARGIN = 60; // floor extends beyond the area so spawned dice have ground
const SPAWN_GAP = 1.5; // minimum distance beyond the wall plane
const DIE_SPACING = 2.4; // spawn grid pitch (circumradius units)
const INNER_FRACTION = 0.6;
const CLOSE_EPSILON = 0.05; // the wall closes once every centre is inside the spawn-side plane
const HERD_AFTER_STEP = 20; // while the wall is open, dice still beyond the plane get nudged in
const HERD_DELTA_V = 0.4; // per step
const SETTLE_LINVEL = 0.3; // a die is at rest below these speeds ...
const SETTLE_ANGVEL = 0.5;
const SETTLE_STEPS = 10; // ... for this many consecutive steps (Rapier's sleep flag is too slow)
const COIN_ANGULAR_DAMPING = 3; // a cylinder has no rolling resistance and would roll on its rim
const RELAX_FROM_STEP = 120; // after this the rest thresholds widen: a coin leaning on a pile
const RELAX_PER_STEP = 1 / 30; // can pivot slowly for ever, and must not hold playback to 10 s
const POOL_LIMIT = 8;
const LAUNCH_MARGIN = 1; // a launched centre stays this far inside the area's walls
const LIFT_CLEARANCE = 1.2; // a launch over a pet starts this far above its top
// A die is nudged the moment it rests cocked (not once every die has stopped, which read as a die
// lying still, then spinning to another number), and tipped toward the face nearest flat: it
// topples onto it, rather than spinning to some other number. One still cocked after a nudge gets
// a firmer one (NUDGE_GROW per nudge).
const NUDGE_TIP = 7; // rad/s of tip per radian its nearest face is off flat (a seeded 1..1.5 x)
const NUDGE_SPIN = 6; // a die with no clear way to tip spins by 6..12 rad/s about a seeded axis
const NUDGE_POP = 1.5; // ... and a cocked die pops up (units/s) so it can tip off its support
const NUDGE_GROW = 0.75; // each further nudge is this much (of the first) stronger
const NUDGE_HOP = 6; // an outside die hops (units/s) towards the area centre ...
const NUDGE_REACH = 12; // ... at up to this speed

let initialised = null;

/**
 * Instantiate the Rapier wasm once. `wasm` is a URL string (fetched, streamed: the worker's
 * separate asset) or raw bytes / a compiled module (Node tests).
 */
export function initPhysics(wasm) {
  initialised ??= (async () => {
    const imports = { './rapier_wasm3d_bg.js': glue };
    let instance;
    if (typeof wasm === 'string') {
      try {
        ({ instance } = await WebAssembly.instantiateStreaming(fetch(wasm), imports));
      } catch (err) {
        // Streaming needs `Content-Type: application/wasm`; some hosts/proxies send another
        // type (or the API is missing). Compile from the raw bytes instead.
        console.debug('dicer: instantiateStreaming failed, compiling the wasm from bytes', err);
        const bytes = await (await fetch(wasm)).arrayBuffer();
        ({ instance } = await WebAssembly.instantiate(bytes, imports));
      }
    } else if (wasm instanceof WebAssembly.Module) {
      instance = await WebAssembly.instantiate(wasm, imports);
    } else {
      ({ instance } = await WebAssembly.instantiate(wasm, imports));
    }
    glue.__wbg_set_wasm(instance.exports);
  })();
  return initialised;
}

/**
 * The d2 is the only coin (its shape kind is 'coin'). A type check, not getShape(): importing
 * the shape table would bundle every shape builder into the worker for this one test.
 */
const isCoin = (type) => type === 'd2';

/** The frame stream's salt (deriveSeed): apart from the spawn and nudge streams. */
const FRAME_SALT = 0x85ebca6b;

/**
 * A hull's points as one throw's collider holds them: rotated by the inverse of the uniform random
 * rotation `q` and in a random order, from `rand`. With the collider at rotation `q` on its body,
 * the solid in the body frame is the same; only Rapier's own representation of it (its frame and
 * the order it builds the hull in) changes. Rapier's contact handling is not perfectly even across
 * that representation: with one fixed frame and order, the faces in some internal roles land a few
 * percent more often (the d12 at 100,000 throws: face 4 about 3 % short, p < 0.001; a shuffled
 * order or a rotated frame moves the bias to other faces). A fresh frame and order per throw gives
 * every face every role alike, so the bias averages out.
 */
export function framedPoints(points, q, rand) {
  const n = points.length / 3;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // v' = q^-1 v q (the conjugate's rotation), written out for a unit quaternion.
  const { x, y, z, w } = q;
  const out = new Float32Array(points.length);
  order.forEach((src, k) => {
    const vx = points[3 * src];
    const vy = points[3 * src + 1];
    const vz = points[3 * src + 2];
    // t = 2 * cross(-q.xyz, v); v' = v + w * t + cross(-q.xyz, t)
    const tx = 2 * (-y * vz + z * vy);
    const ty = 2 * (-z * vx + x * vz);
    const tz = 2 * (-x * vy + y * vx);
    out[3 * k] = vx + w * tx + (-y * tz + z * ty);
    out[3 * k + 1] = vy + w * ty + (-z * tx + x * tz);
    out[3 * k + 2] = vz + w * tz + (-x * ty + y * tx);
  });
  return out;
}

function dieColliderDesc(type, hulls, frameRand) {
  let desc;
  if (isCoin(type)) {
    desc = RAPIER.ColliderDesc.cylinder(0.125, 1);
  } else {
    const hull = hulls?.[type];
    if (!hull) throw new Error(`dicer: no hull supplied for "${type}"`);
    // P2-R4: the exact Minkowski solid (shrunk polyhedron + border radius) of the visual mesh, in a
    // fresh internal frame and point order per throw (framedPoints).
    const q = randomQuaternion(frameRand(), frameRand(), frameRand());
    desc = RAPIER.ColliderDesc.roundConvexHull(framedPoints(hull.points, q, frameRand), hull.radius);
    desc?.setRotation(q);
  }
  if (!desc) throw new Error(`dicer: could not build collider for "${type}"`);
  return desc.setRestitution(DIE_RESTITUTION).setFriction(DIE_FRICTION).setDensity(1);
}

/** Uniform random unit quaternion from three uniform samples (Shoemake). */
function randomQuaternion(u1, u2, u3) {
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return {
    x: a * Math.sin(2 * Math.PI * u2),
    y: a * Math.cos(2 * Math.PI * u2),
    z: b * Math.sin(2 * Math.PI * u3),
    w: b * Math.cos(2 * Math.PI * u3),
  };
}

/**
 * The tip that lays a die at rotation q flat on its nearest face: the horizontal axis to turn it
 * about and the angle (rad) its read face is off straight up (down for a read-down die), or null
 * when it already lies flat. From INIT's reader data, like clearanceOf.
 */
export function tipOf({ normals: N, read, mode }, q) {
  let b = null;
  for (let i = 0; i < N.length / 3; i++) {
    if (read && !read.includes(i)) continue;
    const v = rotate(q, mode * N[3 * i], mode * N[3 * i + 1], mode * N[3 * i + 2]);
    if (!b || v[1] > b[1]) b = v;
  }
  const h = b ? Math.hypot(b[0], b[2]) : 0;
  // turning about (-z, 0, x)/h brings that face's normal up to +Y
  return h > 1e-6 ? { x: -b[2] / h, z: b[0] / h, angle: Math.atan2(h, b[1]) } : null;
}
/** (x, y, z) rotated by the unit quaternion q. */
function rotate(q, x, y, z) {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return [x + q.w * tx + q.y * tz - q.z * ty, y + q.w * ty + q.z * tx - q.x * tz, z + q.w * tz + q.x * ty - q.y * tx];
}

/**
 * The read-side clearance of a die at rotation q from INIT's reader data (hulls.js
 * computeReaders): best minus second-best world normal Y times mode, among the read set; a coin's
 * cap |y|. The same number as face-reader's topFaceClearance, without three.js or shapes.
 */
export function clearanceOf({ normals: N, read, mode }, q, coin) {
  // Row Y of q's rotation matrix: the world Y of a local vector.
  const ax = 2 * (q.x * q.y + q.w * q.z);
  const ay = 1 - 2 * (q.x * q.x + q.z * q.z);
  const az = 2 * (q.y * q.z - q.w * q.x);
  let b = -Infinity;
  let s = -Infinity;
  for (let i = 0; i < N.length / 3; i++) {
    if (read && !read.includes(i)) continue;
    const y = mode * (ax * N[3 * i] + ay * N[3 * i + 1] + az * N[3 * i + 2]);
    if (y > b) [s, b] = [b, y];
    else if (y > s) s = y;
  }
  return coin ? b : b - s;
}

/** v clamped to centre c ± (half - LAUNCH_MARGIN), or to c when the area is narrower. */
const within = (v, c, half, margin = LAUNCH_MARGIN) => {
  const m = Math.max(0, half - margin);
  return Math.min(c + m, Math.max(c - m, v));
};
/** [x, y, z] as {x, y, z}, scaled down to length max at most. */
const capped = ([x, y, z], max) => {
  const k = Math.min(1, max / (Math.hypot(x, y, z) || 1));
  return { x: x * k, y: y * k, z: z * k };
};

/**
 * A launch entry as a body start {p, q, v, w}, clamped into area a (margin 1, y in [1, 6]) with
 * speed and spin capped; null when malformed (that die is then a seeded spawn). `rest: true` (a
 * landed die a toss knocks about) keeps its pose: no margin, y >= 0, never lifted over a pet.
 */
function launchState(s, a) {
  const parts = [s?.pos, s?.quat, s?.linvel, s?.angvel];
  if (!parts.every((v, i) => v?.length === (i === 1 ? 4 : 3) && [...v].every(Number.isFinite)))
    return null;
  const len = Math.hypot(...s.quat);
  const [x, y, z, w] = len > 1e-9 ? [...s.quat].map((c) => c / len) : [0, 0, 0, 1];
  const rest = s.rest === true;
  const m = rest ? 0 : LAUNCH_MARGIN;
  return {
    rest,
    p: {
      x: within(s.pos[0], a.cx, a.halfWidth, m),
      y: Math.min(6, Math.max(rest ? 0 : 1, s.pos[1])),
      z: within(s.pos[2], a.cz, a.halfDepth, m),
    },
    q: { x, y, z, w },
    v: capped(s.linvel, MAX_RELEASE_SPEED),
    w: capped(s.angvel, MAX_RELEASE_SPIN),
  };
}

const finitePositive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const finiteOr0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * The rectangle a throw uses: `req.area` ({cx, cz, halfWidth, halfDepth}, die units relative to
 * the stage centre) when it is well formed, else the stage area centred at the origin.
 */
function throwArea(reqArea, stage) {
  if (
    reqArea &&
    typeof reqArea === 'object' &&
    finitePositive(reqArea.halfWidth) &&
    finitePositive(reqArea.halfDepth) &&
    (reqArea.cx === undefined || Number.isFinite(reqArea.cx)) &&
    (reqArea.cz === undefined || Number.isFinite(reqArea.cz))
  ) {
    return {
      cx: finiteOr0(reqArea.cx),
      cz: finiteOr0(reqArea.cz),
      halfWidth: reqArea.halfWidth,
      halfDepth: reqArea.halfDepth,
      ...(SHAPES.includes(reqArea.shape) && { shape: reqArea.shape }),
    };
  }
  return { cx: 0, cz: 0, halfWidth: stage.halfWidth, halfDepth: stage.halfDepth };
}

/** A throw area's outline besides the rectangle (a dice tray's shape): its walls follow it. */
const SHAPES = ['round', 'hex', 'octagon'];
const ROUND_SIDES = 16; // the oval as a polygon with its corners on it (within 2% of the oval)

/**
 * The walls an area's shape adds to its four (shapeWalls): the outline's edges that are not on
 * the rectangle, as {x1, z1, x2, z2, nx, nz} (world, die units; n the unit normal pointing out),
 * the outline matching the tray's own (hexagon points left and right, octagon corners cut at a
 * quarter of each side, oval inscribed). [] for a rectangle.
 */
export function shapeEdges(a) {
  const { cx, cz, halfWidth: w, halfDepth: d, shape } = a;
  let pts;
  if (shape === 'hex') pts = [[-0.5 * w, -d], [0.5 * w, -d], [w, 0], [0.5 * w, d], [-0.5 * w, d], [-w, 0]];
  else if (shape === 'octagon')
    pts = [[-0.5 * w, -d], [0.5 * w, -d], [w, -0.5 * d], [w, 0.5 * d], [0.5 * w, d], [-0.5 * w, d], [-w, 0.5 * d], [-w, -0.5 * d]];
  else if (shape === 'round')
    pts = Array.from({ length: ROUND_SIDES }, (_, k) => {
      const t = (2 * Math.PI * k) / ROUND_SIDES;
      return [w * Math.cos(t), d * Math.sin(t)];
    });
  else return [];
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const dx = x2 - x1;
    const dz = z2 - z1;
    if (Math.abs(dx) < 1e-9 || Math.abs(dz) < 1e-9) continue; // on the rectangle: its own wall
    const len = Math.hypot(dx, dz);
    let nx = dz / len;
    let nz = -dx / len;
    if (nx * (x1 + x2) + nz * (z1 + z2) < 0) [nx, nz] = [-nx, -nz]; // pointing away from the centre
    out.push({ x1: cx + x1, z1: cz + z1, x2: cx + x2, z2: cz + z2, nx, nz });
  }
  return out;
}

/** Run one 1-die throw per type and discard it: warms colliders, hulls and the wasm paths. */
export function prewarm(sim, types) {
  for (const type of types) {
    sim.throw({ dice: [{ type }], seed: 0 }, (c) => sim.recycle(c.data));
  }
}

/**
 * Create a simulation. World units: 1 = a die's circumradius, floor at y = 0.
 * Each throw builds a fresh Rapier world, so a throw depends only on (area, request).
 * `throw({dice, seed, area?})`: `area` = {cx, cz, halfWidth, halfDepth} puts this throw's walls
 * and aim around (cx, cz); its dice spawn beyond the stage edge on the seeded side (P5-R5),
 * within the area's lateral span, and fly in through the open area wall; without it the throw uses the resized stage area at the
 * origin (bit-identical to before per-throw areas). The floor is shared and covers both.
 */
export function createSim(initialArea, hulls, readers) {
  let area = { ...initialArea };
  let disposed = false;
  let warned = false;
  /** Buffer pool keyed by full-chunk float length. */
  const pool = new Map();
  /** Pool of impact-event buffers (fixed size, one per chunk in flight). */
  const eventPool = [];
  const EVENT_LENGTH = MAX_IMPACTS_PER_CHUNK * IMPACT_FLOATS;

  function takeEventBuffer() {
    while (eventPool.length) {
      const buf = eventPool.pop();
      if (buf.byteLength > 0) return buf;
    }
    return new Float32Array(EVENT_LENGTH);
  }

  function takeBuffer(length) {
    const list = pool.get(length);
    while (list?.length) {
      const buf = list.pop();
      if (buf.byteLength > 0) return buf; // a detached (transferred) buffer is dropped
    }
    return new Float32Array(length);
  }

  /**
   * Four walls in fixed order: +x, -x, +z, -z, around the throw's area `a`. The walls running
   * along the travel direction are extended outwards on the spawn side so thrown dice cannot
   * leave sideways before it closes.
   */
  function addWalls(world, edge, a, hand = false) {
    const { cx, cz, halfWidth: hw, halfDepth: hd } = a;
    const t = WALL_HALF_THICKNESS;
    const h = WALL_HALF_HEIGHT;
    const alongX = edge < 2;
    const sign = edge % 2 === 0 ? 1 : -1;
    const wall = (hx, hz, x, z) =>
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, h, hz)
          .setTranslation(x, h, z)
          .setRestitution(hand ? HAND_WALL_RESTITUTION : DIE_RESTITUTION)
          .setRestitutionCombineRule(
            hand ? RAPIER.CoefficientCombineRule.Max : RAPIER.CoefficientCombineRule.Average,
          )
          .setFriction(DIE_FRICTION),
      );
    // Span [lo, hi] of a side wall along its axis, extended on the spawn side if it applies.
    const span = (half, extendsSpawn) => {
      let lo = -half - 2 * t;
      let hi = half + 2 * t;
      if (extendsSpawn) {
        if (sign > 0) hi = half + FLOOR_MARGIN;
        else lo = -half - FLOOR_MARGIN;
      }
      return [lo, hi];
    };
    const [zLo, zHi] = span(hd, !alongX); // extent of the +x/-x walls along z
    const [xLo, xHi] = span(hw, alongX); // extent of the +z/-z walls along x
    return [
      wall(t, (zHi - zLo) / 2, cx + hw + t, cz + (zHi + zLo) / 2),
      wall(t, (zHi - zLo) / 2, cx - hw - t, cz + (zHi + zLo) / 2),
      wall((xHi - xLo) / 2, t, cx + (xHi + xLo) / 2, cz + hd + t),
      wall((xHi - xLo) / 2, t, cx + (xHi + xLo) / 2, cz - hd - t),
    ];
  }

  return {
    resize(next) {
      area = { ...next };
    },

    /** The face readers free throws need, when the sim was made without them (READERS). */
    setReaders(next) {
      readers = next;
    },

    /** Return a transferred-back buffer to the pool. */
    recycle(buffer, events) {
      if (events && events.byteLength > 0 && eventPool.length < POOL_LIMIT) {
        eventPool.push(new Float32Array(events.buffer));
      }
      if (!buffer || buffer.byteLength === 0) return;
      const full = new Float32Array(buffer.buffer);
      const list = pool.get(full.length) ?? [];
      if (list.length < POOL_LIMIT) list.push(full);
      pool.set(full.length, list);
    },

    throw(req, onChunk) {
      if (disposed) throw new Error('dicer: sim disposed');
      const a = throwArea(req.area, area);
      const { cx, cz, halfWidth: hw, halfDepth: hd } = a;
      // The shared floor covers the stage and this throw's area (identical to the stage's floor
      // when the area lies inside it, which is the default).
      const floorHw = Math.max(area.halfWidth, Math.abs(cx) + hw);
      const floorHd = Math.max(area.halfDepth, Math.abs(cz) + hd);
      const rand = seededRandom(req.seed);
      const frameRand = seededRandom(deriveSeed(req.seed, FRAME_SALT));
      const n = req.dice.length;
      const free = req.free === true;
      if (free && !readers && !warned) {
        warned = true;
        console.warn('dicer: no face readers, free dice are never nudged');
      }
      const launch = req.dice.map((_, i) => launchState(req.launch?.[i], a));
      const launched = launch.some(Boolean);
      // R5: the walls stand from step 0 (no herding) only when every die is launched.
      const allLaunched = n > 0 && launch.every(Boolean);
      const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
      world.timestep = STEP_SECONDS;
      const eventQueue = new RAPIER.EventQueue(true);
      /** collider handle -> die index, -1 floor, -2 wall */
      const owner = new Map();
      const withEvents = (desc) => desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      try {
        const floor = world.createCollider(
          withEvents(
            RAPIER.ColliderDesc.cuboid(floorHw + FLOOR_MARGIN, 0.5, floorHd + FLOOR_MARGIN)
              .setTranslation(0, -0.5, 0)
              .setFriction(FLOOR_FRICTION)
              .setRestitution(DIE_RESTITUTION),
          ),
        );
        owner.set(floor.handle, -1);

        // Seeded spawn edge: 0 = +x, 1 = -x, 2 = +z, 3 = -z. Its wall starts disabled ("open").
        // throwEdge(seed) (core/rng.js), which also names it to the pet layer. The stream's first
        // draw is still taken (for an integer seed it is that edge), so legacy seeds keep their spawn.
        const edge = throwEdge(req.seed);
        rand();
        const walls = addWalls(world, edge, a, allLaunched);
        const alongX = edge < 2;
        const sign = edge % 2 === 0 ? 1 : -1;
        for (const w of walls) owner.set(w.handle, -2);
        const spawnWall = walls[edge];
        if (!allLaunched) spawnWall.setEnabled(false);
        // The tray's outline (round, hexagon, octagon): a wall along each edge off the rectangle,
        // so dice hit the tray's own sides. Those facing the spawn side start open, as the spawn
        // wall does (a hexagon's point would shut the dice out), and each closes once every die
        // centre is inside it. No shape: none, and no rand() draws (old throws unchanged).
        const shaped = shapeEdges(a).map((e) => {
          const len = Math.hypot(e.x2 - e.x1, e.z2 - e.z1);
          const yaw = Math.atan2(-(e.z2 - e.z1), e.x2 - e.x1);
          const t = WALL_HALF_THICKNESS;
          const wall = world.createCollider(
            RAPIER.ColliderDesc.cuboid(len / 2 + t, WALL_HALF_HEIGHT, t)
              .setTranslation((e.x1 + e.x2) / 2 + e.nx * t, WALL_HALF_HEIGHT, (e.z1 + e.z2) / 2 + e.nz * t)
              .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
              .setRestitution(allLaunched ? HAND_WALL_RESTITUTION : DIE_RESTITUTION)
              .setRestitutionCombineRule(
                allLaunched ? RAPIER.CoefficientCombineRule.Max : RAPIER.CoefficientCombineRule.Average,
              )
              .setFriction(DIE_FRICTION),
          );
          owner.set(wall.handle, -2);
          const open = !allLaunched && (alongX ? e.nx : e.nz) * sign > 1e-6;
          if (open) wall.setEnabled(false);
          return { wall, e, open };
        });

        // Pets standing on the floor: fixed capsules, owner code -3 - i. No rand() draws. A die
        // contact at splatSpeed or more splats the pet: its collider is gone from the next step.
        const splatAt = req.splatSpeed > 0 ? req.splatSpeed : Infinity;
        const pets = [];
        const placed = [];
        const splatted = [];
        const obstacles = Array.isArray(req.obstacles) ? req.obstacles.slice(0, MAX_OBSTACLES) : [];
        obstacles.forEach((o, i) => {
          if (
            !o ||
            ![o.x, o.z, o.r, o.h].every(Number.isFinite) ||
            o.r <= 0 ||
            o.h <= 0 ||
            o.r > 3 ||
            o.h > 6
          )
            return;
          const c = world.createCollider(
            withEvents(
              RAPIER.ColliderDesc.capsule(Math.max(0, o.h / 2 - o.r), o.r)
                .setTranslation(o.x, o.h / 2, o.z)
                .setFriction(OBSTACLE_FRICTION)
                .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min) // Min beats the die's Average
                .setRestitution(DIE_RESTITUTION),
            ),
          );
          owner.set(c.handle, -3 - i);
          pets[i] = c;
          placed.push(o);
        });

        const lateralHalf = alongX ? hd : hw;
        const columns = Math.max(1, Math.floor((2 * (lateralHalf - 1)) / DIE_SPACING));
        // P5-R5: dice spawn beyond the STAGE edge on the spawn side (off-screen), never inside
        // the visible stage, and fly across it to the area; laterally they stay within the
        // area's span. For the default (area == stage) this is exactly the old spawn.
        const stageHalf = alongX ? area.halfWidth : area.halfDepth;
        const areaFar = sign * (alongX ? cx : cz) + (alongX ? hw : hd);
        const spawnFrom = Math.max(stageHalf, areaFar);
        const bodies = [];
        for (let i = 0; i < n; i++) {
          const col = i % columns;
          const row = Math.floor(i / columns);
          const lateral = (col - (columns - 1) / 2) * DIE_SPACING + (rand() - 0.5) * 0.3;
          const out = spawnFrom + SPAWN_GAP + 0.5 + row * DIE_SPACING + rand() * 0.3;
          let y = 2 + rand() * 3;
          let px = alongX ? sign * out : cx + lateral;
          let pz = alongX ? cz + lateral : sign * out;
          // Aim at a seeded point inside the inner 60% of the area.
          const tx = cx + (rand() * 2 - 1) * INNER_FRACTION * hw;
          const tz = cz + (rand() * 2 - 1) * INNER_FRACTION * hd;
          const flight = 0.7 + row * 0.1 + rand() * 0.3;
          let vel = {
            x: (tx - px) / flight,
            y: (1 - y + 0.5 * -GRAVITY * flight * flight) / flight,
            z: (tz - pz) / flight,
          };
          let q = randomQuaternion(rand(), rand(), rand());
          let spin = {
            x: (rand() * 2 - 1) * 18,
            y: (rand() * 2 - 1) * 18,
            z: (rand() * 2 - 1) * 18,
          };
          const l = launch[i];
          if (l) {
            // The seeded draws above are still taken, so unlaunched dice keep their spawn.
            ({ x: px, y, z: pz } = l.p);
            if (!l.rest)
              for (const o of placed)
                if (Math.hypot(px - o.x, pz - o.z) < o.r + 1) y = Math.max(y, o.h + LIFT_CLEARANCE);
            [q, vel, spin] = [l.q, l.v, l.w];
          }
          const coin = isCoin(req.dice[i].type);
          const body = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
              .setTranslation(px, y, pz)
              .setRotation(q)
              .setLinvel(vel.x, vel.y, vel.z)
              .setAngvel(spin)
              .setLinearDamping(0.05)
              .setAngularDamping(coin ? COIN_ANGULAR_DAMPING : 0.1)
              .setCcdEnabled(true),
          );
          const collider = world.createCollider(
            withEvents(dieColliderDesc(req.dice[i].type, hulls, frameRand)),
            body,
          );
          owner.set(collider.handle, i);
          bodies.push(body);
        }

        const floatsPerStep = n * FLOATS_PER_DIE;
        const fullLength = CHUNK_STEPS * floatsPerStep;
        let buf = takeBuffer(fullLength);
        let inChunk = 0;
        let chunkIndex = 0;
        let wallClosed = allLaunched;
        let restSteps = 0;
        const maxSteps = free ? MAX_FREE_STEPS : MAX_STEPS;
        let settledStep = maxSteps;
        const nudges = Array(n).fill(0);
        const dieRest = new Int32Array(n); // steps each die has been at rest
        const nudgeRand = seededRandom(deriveSeed(req.seed));
        let relaxFrom = 0; // the rest thresholds widen from here (the last nudge)
        /** Writes die d's pose into frame slot `slot` of buf; returns its position. */
        const put = (slot, d) => {
          const b = bodies[d];
          const p = b.translation();
          const r = b.rotation();
          const o = (slot * n + d) * FLOATS_PER_DIE;
          buf[o] = p.x;
          buf[o + 1] = p.y;
          buf[o + 2] = p.z;
          buf[o + 3] = r.x;
          buf[o + 4] = r.y;
          buf[o + 5] = r.z;
          buf[o + 6] = r.w;
          return p;
        };
        // A launched throw's frame 0 is the release state itself; step s is then frame s.
        const frame0 = launched ? 1 : 0;
        if (launched) {
          for (let d = 0; d < n; d++) put(0, d);
          inChunk = 1;
        }
        /** Nudge every die at rest, cocked or outside, with nudges left; false when none needed one. */
        const nudge = () => {
          let any = false;
          bodies.forEach((b, d) => {
            if (dieRest[d] < SETTLE_STEPS) return; // still moving: judged once it stops
            const p = b.translation();
            const dx = cx - p.x;
            const dz = cz - p.z;
            const dist = Math.hypot(dx, dz);
            const out = Math.abs(dx) > hw || Math.abs(dz) > hd;
            const type = req.dice[d].type;
            const rd = readers[type];
            const cocked =
              rd && clearanceOf(rd, b.rotation(), isCoin(type)) < COCKED_FRACTION * rd.gap;
            if (nudges[d] >= MAX_NUDGES || !(out || cocked)) return;
            const grow = 1 + NUDGE_GROW * nudges[d];
            nudges[d]++;
            dieRest[d] = 0;
            any = true;
            // Spin about a seeded horizontal axis; a cocked die pops up off its support, an
            // outside one hops towards the area centre.
            const turn = nudgeRand() * 2 * Math.PI;
            const r = nudgeRand();
            const tip = cocked ? tipOf(rd, b.rotation()) : null;
            const [tx, tz, w] = tip
              ? [tip.x, tip.z, NUDGE_TIP * grow * Math.max(0.3, tip.angle) * (1 + r / 2)]
              : [Math.cos(turn), Math.sin(turn), NUDGE_SPIN * grow * (1 + r)];
            const av = b.angvel();
            b.setAngvel({ x: av.x + tx * w, y: av.y, z: av.z + tz * w }, true);
            const m = b.mass();
            const k = out ? (m * Math.min(NUDGE_REACH, 3 + 2 * dist)) / dist : 0;
            b.applyImpulse({ x: k * dx, y: m * (out ? NUDGE_HOP : NUDGE_POP * grow), z: k * dz }, true);
          });
          return any;
        };
        // Linear velocities just before each step (the impact speed is read from these).
        const preVel = new Float64Array(n * 3);
        let impacts = []; // this chunk's events: [frame, die, other, speed]

        const onCollision = (h1, h2, started, frame) => {
          if (!started) return;
          const a = owner.get(h1);
          const b = owner.get(h2);
          if (a === undefined || b === undefined) return;
          let die = a;
          let other = b;
          if (die < 0 || (other >= 0 && other < die)) [die, other] = [other, die];
          if (die < 0) return; // floor/wall pair cannot happen (both fixed), guard anyway
          let speed;
          if (other >= 0) {
            speed = Math.hypot(
              preVel[die * 3] - preVel[other * 3],
              preVel[die * 3 + 1] - preVel[other * 3 + 1],
              preVel[die * 3 + 2] - preVel[other * 3 + 2],
            );
          } else {
            speed = Math.hypot(preVel[die * 3], preVel[die * 3 + 1], preVel[die * 3 + 2]);
          }
          impacts.push([frame, die, other, speed]);
          // Float32, like the copy the pet layer reads: both sides agree at the threshold.
          if (other <= -3 && req.dice[die]?.splat !== false && Math.fround(speed) >= splatAt)
            splatted.push(pets[-3 - other]);
        };

        for (let step = 1; step <= maxSteps; step++) {
          for (let d = 0; d < n; d++) {
            const v = bodies[d].linvel();
            preVel[d * 3] = v.x;
            preVel[d * 3 + 1] = v.y;
            preVel[d * 3 + 2] = v.z;
          }
          world.step(eventQueue);
          const frame = step - 1 + frame0; // global frame index == Playback's playhead unit
          eventQueue.drainCollisionEvents((h1, h2, started) => onCollision(h1, h2, started, frame));
          for (const c of splatted.splice(0)) c.setEnabled(false);

          let allInside = true;
          let allAtRest = true;
          const relax = 1 + Math.max(0, step - relaxFrom - RELAX_FROM_STEP) * RELAX_PER_STEP;
          for (let d = 0; d < n; d++) {
            const b = bodies[d];
            const p = put(inChunk, d);
            if (!wallClosed) {
              // Distance beyond the spawn-side wall plane (positive = outside the area).
              const beyond = alongX ? sign * (p.x - cx) - hw : sign * (p.z - cz) - hd;
              if (beyond > -CLOSE_EPSILON) allInside = false;
              if (beyond > 0 && step >= HERD_AFTER_STEP) {
                // Only dice whose centre is outside (knocked back out, or slow to arrive).
                const k = HERD_DELTA_V * b.mass();
                b.applyImpulse(
                  { x: alongX ? -sign * k : 0, y: 0, z: alongX ? 0 : -sign * k },
                  true,
                );
              }
            }
            const lv = b.linvel();
            const av = b.angvel();
            if (
              Math.hypot(lv.x, lv.y, lv.z) > SETTLE_LINVEL * relax ||
              Math.hypot(av.x, av.y, av.z) > SETTLE_ANGVEL * relax
            ) {
              allAtRest = false;
              dieRest[d] = 0;
            } else dieRest[d]++;
          }
          inChunk++;

          // The shape's open walls: each closes once every centre is inside it. Until then a die
          // in a corner (inside the rectangle, beyond an open wall) is herded towards the centre,
          // once per step (after HERD_AFTER_STEP, as the spawn wall's): never a die still flying
          // in, which the pushes of every open wall would add up on and throw over the far wall.
          let shapeOpen = false;
          const herd = step >= HERD_AFTER_STEP ? new Map() : null; // die -> the wall it is furthest beyond
          for (const sw of shaped) {
            if (!sw.open) continue;
            let inside = true;
            for (let d = 0; d < n; d++) {
              const p = bodies[d].translation();
              const out = (p.x - sw.e.x1) * sw.e.nx + (p.z - sw.e.z1) * sw.e.nz;
              if (out > -CLOSE_EPSILON) inside = false;
              if (herd && out > 0 && Math.abs(p.x - cx) <= hw && Math.abs(p.z - cz) <= hd && !(herd.get(d)?.out >= out))
                herd.set(d, { e: sw.e, out });
            }
            if (inside) {
              sw.wall.setEnabled(true);
              sw.open = false;
            } else shapeOpen = true;
          }
          for (const [d, { e }] of herd ?? []) {
            const k = HERD_DELTA_V * bodies[d].mass();
            bodies[d].applyImpulse({ x: -e.nx * k, y: 0, z: -e.nz * k }, true);
          }

          // Close once every centre is inside the plane: any overlap with the new wall is then
          // resolved inwards. Never force it closed over a die that is still outside.
          if (!wallClosed && allInside) {
            spawnWall.setEnabled(true);
            wallClosed = true;
          }

          restSteps = wallClosed && !shapeOpen && allAtRest ? restSteps + 1 : 0;
          let finished = step === maxSteps;
          // A free throw nudges each cocked or outside die as soon as it rests (while a nudge still
          // has time to settle), and runs on after it.
          if (free && readers && wallClosed && !shapeOpen && step + NUDGE_STEPS <= maxSteps && nudge()) {
            restSteps = 0;
            relaxFrom = step;
          } else if (restSteps >= SETTLE_STEPS) finished = true;
          if (finished) settledStep = step;
          if (inChunk === CHUNK_STEPS || finished) {
            const data = new Float32Array(buf.buffer, 0, inChunk * floatsPerStep);
            if (impacts.length > MAX_IMPACTS_PER_CHUNK) {
              // Keep the fastest; the stable sort keeps step order for equal speeds.
              impacts = impacts
                .map((e, i) => [e, i])
                .sort((x, y) => y[0][3] - x[0][3] || x[1] - y[1])
                .slice(0, MAX_IMPACTS_PER_CHUNK)
                .map(([e]) => e)
                .sort((x, y) => x[0] - y[0]);
            }
            const eventBuf = takeEventBuffer();
            impacts.forEach((e, i) => eventBuf.set(e, i * IMPACT_FLOATS));
            const events = new Float32Array(eventBuf.buffer, 0, impacts.length * IMPACT_FLOATS);
            impacts = [];
            onChunk({ index: chunkIndex++, steps: inChunk, data, events, done: finished });
            if (finished) break;
            buf = takeBuffer(fullLength);
            inChunk = 0;
          }
        }
        return { settledStep, nudges };
      } finally {
        eventQueue.free();
        world.free();
      }
    },

    dispose() {
      disposed = true;
      pool.clear();
      eventPool.length = 0;
    },
  };
}
