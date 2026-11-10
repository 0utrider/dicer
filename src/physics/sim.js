import RAPIER from '@dimforge/rapier3d-deterministic';
import * as glue from '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js';
import { getShape } from '../core/dice-shapes.js';
import { mulberry32 } from '../core/rng.js';
import { CHUNK_STEPS, FLOATS_PER_DIE, MAX_STEPS, STEP_SECONDS } from './protocol.js';

const GRAVITY = -9.81 * 4;
const DIE_RESTITUTION = 0.35;
const DIE_FRICTION = 0.5;
const FLOOR_FRICTION = 0.8;
const WALL_HALF_HEIGHT = 12;
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

function dieColliderDesc(type, hulls) {
  let desc;
  if (getShape(type).kind === 'coin') {
    desc = RAPIER.ColliderDesc.cylinder(0.125, 1);
  } else {
    const hull = hulls?.[type];
    if (!hull) throw new Error(`dicer: no hull supplied for "${type}"`);
    // P2-R4: the exact Minkowski solid (shrunk polyhedron + border radius) of the visual mesh.
    desc = RAPIER.ColliderDesc.roundConvexHull(hull.points, hull.radius);
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

/** Run one 1-die throw per type and discard it: warms colliders, hulls and the wasm paths. */
export function prewarm(sim, types) {
  for (const type of types) {
    sim.throw({ dice: [{ type }], seed: 0 }, (c) => sim.recycle(c.data));
  }
}

/**
 * Create a simulation. World units: 1 = a die's circumradius, floor at y = 0.
 * Each throw builds a fresh Rapier world, so a throw depends only on (area, request).
 */
export function createSim(initialArea, hulls) {
  let area = { ...initialArea };
  let disposed = false;
  /** Buffer pool keyed by full-chunk float length. */
  const pool = new Map();

  function takeBuffer(length) {
    const list = pool.get(length);
    while (list?.length) {
      const buf = list.pop();
      if (buf.byteLength > 0) return buf; // a detached (transferred) buffer is dropped
    }
    return new Float32Array(length);
  }

  /**
   * Four walls in fixed order: +x, -x, +z, -z. The walls running along the travel direction are
   * extended outwards on the spawn side so thrown dice cannot leave sideways before it closes.
   */
  function addWalls(world, edge) {
    const { halfWidth: hw, halfDepth: hd } = area;
    const t = WALL_HALF_THICKNESS;
    const h = WALL_HALF_HEIGHT;
    const alongX = edge < 2;
    const sign = edge % 2 === 0 ? 1 : -1;
    const wall = (hx, hz, x, z) =>
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, h, hz)
          .setTranslation(x, h, z)
          .setRestitution(DIE_RESTITUTION)
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
      wall(t, (zHi - zLo) / 2, hw + t, (zHi + zLo) / 2),
      wall(t, (zHi - zLo) / 2, -hw - t, (zHi + zLo) / 2),
      wall((xHi - xLo) / 2, t, (xHi + xLo) / 2, hd + t),
      wall((xHi - xLo) / 2, t, (xHi + xLo) / 2, -hd - t),
    ];
  }

  return {
    resize(next) {
      area = { ...next };
    },

    /** Return a transferred-back buffer to the pool. */
    recycle(buffer) {
      if (!buffer || buffer.byteLength === 0) return;
      const full = new Float32Array(buffer.buffer);
      const list = pool.get(full.length) ?? [];
      if (list.length < POOL_LIMIT) list.push(full);
      pool.set(full.length, list);
    },

    throw(req, onChunk) {
      if (disposed) throw new Error('dicer: sim disposed');
      const { halfWidth: hw, halfDepth: hd } = area;
      const rand = mulberry32(req.seed);
      const n = req.dice.length;
      const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
      world.timestep = STEP_SECONDS;
      try {
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(hw + FLOOR_MARGIN, 0.5, hd + FLOOR_MARGIN)
            .setTranslation(0, -0.5, 0)
            .setFriction(FLOOR_FRICTION)
            .setRestitution(DIE_RESTITUTION),
        );

        // Seeded spawn edge: 0 = +x, 1 = -x, 2 = +z, 3 = -z. Its wall starts disabled ("open").
        const edge = Math.floor(rand() * 4);
        const walls = addWalls(world, edge);
        const alongX = edge < 2;
        const sign = edge % 2 === 0 ? 1 : -1;
        const spawnWall = walls[edge];
        spawnWall.setEnabled(false);

        const lateralHalf = alongX ? hd : hw;
        const columns = Math.max(1, Math.floor((2 * (lateralHalf - 1)) / DIE_SPACING));
        const bodies = [];
        for (let i = 0; i < n; i++) {
          const col = i % columns;
          const row = Math.floor(i / columns);
          const lateral = (col - (columns - 1) / 2) * DIE_SPACING + (rand() - 0.5) * 0.3;
          const out = (alongX ? hw : hd) + SPAWN_GAP + 0.5 + row * DIE_SPACING + rand() * 0.3;
          const y = 2 + rand() * 3;
          const px = alongX ? sign * out : lateral;
          const pz = alongX ? lateral : sign * out;
          // Aim at a seeded point inside the inner 60% of the area.
          const tx = (rand() * 2 - 1) * INNER_FRACTION * hw;
          const tz = (rand() * 2 - 1) * INNER_FRACTION * hd;
          const flight = 0.7 + row * 0.1 + rand() * 0.3;
          const vx = (tx - px) / flight;
          const vz = (tz - pz) / flight;
          const vy = (1 - y + 0.5 * -GRAVITY * flight * flight) / flight;
          const q = randomQuaternion(rand(), rand(), rand());
          const spin = {
            x: (rand() * 2 - 1) * 18,
            y: (rand() * 2 - 1) * 18,
            z: (rand() * 2 - 1) * 18,
          };
          const coin = getShape(req.dice[i].type).kind === 'coin';
          const body = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
              .setTranslation(px, y, pz)
              .setRotation(q)
              .setLinvel(vx, vy, vz)
              .setAngvel(spin)
              .setLinearDamping(0.05)
              .setAngularDamping(coin ? COIN_ANGULAR_DAMPING : 0.1)
              .setCcdEnabled(true),
          );
          world.createCollider(dieColliderDesc(req.dice[i].type, hulls), body);
          bodies.push(body);
        }

        const floatsPerStep = n * FLOATS_PER_DIE;
        const fullLength = CHUNK_STEPS * floatsPerStep;
        let buf = takeBuffer(fullLength);
        let inChunk = 0;
        let chunkIndex = 0;
        let wallClosed = false;
        let restSteps = 0;
        let settledStep = MAX_STEPS;

        for (let step = 1; step <= MAX_STEPS; step++) {
          world.step();

          let allInside = true;
          let allAtRest = true;
          const relax = 1 + Math.max(0, step - RELAX_FROM_STEP) * RELAX_PER_STEP;
          const base = inChunk * floatsPerStep;
          for (let d = 0; d < n; d++) {
            const b = bodies[d];
            const p = b.translation();
            const r = b.rotation();
            const o = base + d * FLOATS_PER_DIE;
            buf[o] = p.x;
            buf[o + 1] = p.y;
            buf[o + 2] = p.z;
            buf[o + 3] = r.x;
            buf[o + 4] = r.y;
            buf[o + 5] = r.z;
            buf[o + 6] = r.w;
            if (!wallClosed) {
              // Distance beyond the spawn-side wall plane (positive = outside the area).
              const beyond = alongX ? sign * p.x - hw : sign * p.z - hd;
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
            if (allAtRest) {
              const lv = b.linvel();
              const av = b.angvel();
              if (
                Math.hypot(lv.x, lv.y, lv.z) > SETTLE_LINVEL * relax ||
                Math.hypot(av.x, av.y, av.z) > SETTLE_ANGVEL * relax
              ) {
                allAtRest = false;
              }
            }
          }
          inChunk++;

          // Close once every centre is inside the plane: any overlap with the new wall is then
          // resolved inwards. Never force it closed over a die that is still outside.
          if (!wallClosed && allInside) {
            spawnWall.setEnabled(true);
            wallClosed = true;
          }

          restSteps = wallClosed && allAtRest ? restSteps + 1 : 0;
          const finished = restSteps >= SETTLE_STEPS || step === MAX_STEPS;
          if (finished) settledStep = step;
          if (inChunk === CHUNK_STEPS || finished) {
            const data = new Float32Array(buf.buffer, 0, inChunk * floatsPerStep);
            onChunk({ index: chunkIndex++, steps: inChunk, data, done: finished });
            if (finished) break;
            buf = takeBuffer(fullLength);
            inChunk = 0;
          }
        }
        return { settledStep };
      } finally {
        world.free();
      }
    },

    dispose() {
      disposed = true;
      pool.clear();
    },
  };
}
