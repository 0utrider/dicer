import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import * as THREE from 'three';
import { getShape } from '../core/dice-shapes.js';
import { buildDieGeometry } from '../core/chamfer.js';
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
const CLOSE_MARGIN = 1; // a die is "inside" when its centre is this far within the walls
const FORCE_CLOSE_STEP = 180; // close the wall regardless, so a stray die cannot hold it open
const HERD_AFTER_STEP = 20; // while the wall is open, dice still outside get nudged inwards
const HERD_DELTA_V = 0.4; // per step
const POOL_LIMIT = 8;

let initialised = null;

export function initPhysics() {
  initialised ??= RAPIER.init();
  return initialised;
}

const hullCache = new Map();

/** Deduplicated vertex positions of the chamfered visual geometry (the exact visual hull). */
function hullPoints(type) {
  let pts = hullCache.get(type);
  if (!pts) {
    const pos = buildDieGeometry(getShape(type)).getAttribute('position');
    const seen = new Set();
    const out = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x, y, z);
    }
    pts = new Float32Array(out);
    hullCache.set(type, pts);
  }
  return pts;
}

function dieColliderDesc(type) {
  const shape = getShape(type);
  const desc =
    shape.kind === 'coin'
      ? RAPIER.ColliderDesc.cylinder(0.125, 1)
      : RAPIER.ColliderDesc.convexHull(hullPoints(type));
  if (!desc) throw new Error(`dicer: could not build collider for "${type}"`);
  return desc.setRestitution(DIE_RESTITUTION).setFriction(DIE_FRICTION).setDensity(1);
}

/**
 * Create a simulation. World units: 1 = a die's circumradius, floor at y = 0.
 * Each throw builds a fresh Rapier world, so a throw depends only on (area, request).
 */
export function createSim(initialArea) {
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
          const q = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2),
          );
          const spin = {
            x: (rand() * 2 - 1) * 18,
            y: (rand() * 2 - 1) * 18,
            z: (rand() * 2 - 1) * 18,
          };
          const body = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
              .setTranslation(px, y, pz)
              .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
              .setLinvel(vx, vy, vz)
              .setAngvel(spin)
              .setLinearDamping(0.05)
              .setAngularDamping(0.1)
              .setCcdEnabled(true),
          );
          world.createCollider(dieColliderDesc(req.dice[i].type), body);
          bodies.push(body);
        }

        const floatsPerStep = n * FLOATS_PER_DIE;
        const fullLength = CHUNK_STEPS * floatsPerStep;
        let buf = takeBuffer(fullLength);
        let inChunk = 0;
        let chunkIndex = 0;
        let wallClosed = false;
        let settledStep = MAX_STEPS;

        for (let step = 1; step <= MAX_STEPS; step++) {
          world.step();

          let allInside = true;
          let allAsleep = true;
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
            if (Math.abs(p.x) > hw - CLOSE_MARGIN || Math.abs(p.z) > hd - CLOSE_MARGIN) {
              allInside = false;
              const pastSpawnPlane = alongX
                ? sign * p.x > hw - CLOSE_MARGIN
                : sign * p.z > hd - CLOSE_MARGIN;
              if (!wallClosed && step >= HERD_AFTER_STEP && pastSpawnPlane) {
                // Past the spawn plane (or knocked back out): push towards the area centre.
                const k = HERD_DELTA_V * b.mass();
                b.applyImpulse(
                  { x: alongX ? -sign * k : 0, y: 0, z: alongX ? 0 : -sign * k },
                  true,
                );
              }
            }
            if (!b.isSleeping()) allAsleep = false;
          }
          inChunk++;

          if (!wallClosed && (allInside || step >= FORCE_CLOSE_STEP)) {
            spawnWall.setEnabled(true);
            wallClosed = true;
          }

          const finished = (wallClosed && allAsleep) || step === MAX_STEPS;
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
