/**
 * A receiver's replay of a thrower's hand throw (lazy hand chunk; the world-start half is
 * ../gate-hand.js, and the message gate calls replayFor through it): the decoded trajectory is
 * checked against the chat message, matched to this screen's own plan by die key (H-10), and
 * placed into the roller's area here (H-11).
 */
import { getShape, resultOf } from '../../core/dice-shapes.js';
import { readResult } from '../../core/physical-read.js';
import { FLOATS_PER_DIE } from '../../physics/protocol.js';
import { decodeTrajectory, placeTrajectory, replaySource } from './trajectory.js';
import { HAND_BUFFER_MS, HAND_REPLAY_WAIT_MS } from '../gate-hand.js';

const BUFFER_LIMIT = 32;
const SENDER_LIMIT = 4;
let alignWarned = false;

/**
 * `paths(x, z)` for alignFor: the distance from (x, z) to the nearest die centre of a placed
 * throw over all its frames. The positions are gathered on the first call.
 */
function pathsOf(placed) {
  let xz = null;
  return (x, z) => {
    if (!xz) {
      const all = [];
      for (const c of placed.chunks)
        for (let o = 0; o < c.length; o += FLOATS_PER_DIE) all.push(c[o], c[o + 2]);
      xz = Float64Array.from(all);
    }
    let best = Infinity;
    for (let i = 0; i < xz.length; i += 2) best = Math.min(best, (xz[i] - x) ** 2 + (xz[i + 1] - z) ** 2);
    return Math.sqrt(best);
  };
}

/**
 * The receiver's trajectory buffer behind createHandGate (one per gate). Payloads are keyed by
 * message, roll and verified sender, so a payload from anyone else than the author never matches
 * the author's wait. An early payload is kept HAND_BUFFER_MS (at most SENDER_LIMIT per sender,
 * that sender's oldest dropped, and BUFFER_LIMIT in all); a wait resolves on its payload, decoded
 * then (null when malformed or a `none` notice), or null at its deadline. replay never throws.
 */
export function handBuffer({ now = () => Date.now(), setTimeoutFn = (fn, ms) => setTimeout(fn, ms) } = {}) {
  const buffer = new Map(); // key -> {p, at}
  const waiters = new Map(); // key -> resolve
  const decode = (p) => decodeTrajectory(p.trajectory);
  const prune = () => {
    for (const [k, e] of buffer) if (now() - e.at > HAND_BUFFER_MS) buffer.delete(k);
  };
  return {
    accept(p, sender) {
      if (typeof p?.messageId !== 'string' || typeof p.id !== 'string') return;
      const k = `${p.messageId}|${p.id}|${sender}`;
      const w = waiters.get(k);
      waiters.delete(k);
      if (w) return w(decode(p));
      prune();
      buffer.delete(k);
      // One sender can never evict another's payloads: its own oldest goes past SENDER_LIMIT.
      const own = [...buffer].filter(([, e]) => e.sender === sender);
      if (own.length >= SENDER_LIMIT) buffer.delete(own[0][0]);
      buffer.set(k, { p, sender, at: now() });
      if (buffer.size > BUFFER_LIMIT) buffer.delete(buffer.keys().next().value);
    },
    /** `end`: the deadline (as `now`), taken when the gate asked; default HAND_REPLAY_WAIT_MS from now. */
    waitFor(messageId, rollId, authorId, end = now() + HAND_REPLAY_WAIT_MS) {
      prune();
      const k = `${messageId}|${rollId}|${authorId}`;
      const e = buffer.get(k);
      buffer.delete(k);
      if (e) return decode(e.p);
      waiters.get(k)?.(null); // a second wait for the same roll replaces the first
      return new Promise((resolve) => {
        waiters.set(k, resolve);
        setTimeoutFn(
          () => {
            if (waiters.get(k) !== resolve) return;
            waiters.delete(k);
            resolve(null);
          },
          Math.max(0, end - now()),
        );
      });
    },
    /**
     * The message gate's replay of one hand roll: `decoded` (waitFor's) checked as replayFor
     * does, and sent by the author who threw it (`roll`'s dicerHand.by). Throws it through
     * `cast(specs, opts)` (the gate's diceBox.roll(...).landed) as a source replay in `opts`'s
     * area, then the extras beyond the recording as a forced throw, while `alive()`. `full()`
     * plans every result. Returns the landed promise, or null: the gate throws the result.
     */
    replay(decoded, { roll, author, specs, full, opts, cast, diceBox, alive }) {
      try {
        const h = roll.options.dicerHand;
        const r =
          decoded &&
          h.by === author &&
          replayFor(decoded, {
            n: h.n,
            specs,
            full: full(),
            diceBox,
            rect: opts?.area,
            capacity: opts?.capacityDice,
          });
        if (!r) return null;
        // H-6: this screen's pets take the thrower's layout just before the replay's roll(). Only
        // real views reach here (H-7: the gate replays nothing for ghost or none). Never while
        // dice are held here (H-8) or another roll's dice still fly (its physics has the pets'
        // old spots; lingering dice are at rest). Only the pets it aligned take the replay's
        // hits; skipped, or a throw (warned once), the dice meet empty air and the replay goes on.
        let aligned = null;
        try {
          const flying = diceBox.holding || [...(diceBox._rolls ?? [])].some((x) => x.phase === 'playing');
          if (!flying) aligned = diceBox.alignFor?.(r.obstacles, r.area, r.paths);
        } catch (err) {
          if (!alignWarned) console.warn('dicer: pets could not take the thrower layout', err);
          alignWarned = true;
        }
        r.source.obstacleIds = r.source.obstacleIds.map((id) => (aligned?.has?.(id) ? id : undefined));
        const first = cast(r.specs, { ...opts, source: r.source, free: true, edge: r.edge });
        return r.extras.length ? first.then(() => alive() && cast(r.extras)) : first;
      } catch (err) {
        console.warn('dicer: a hand replay failed', err);
        return null;
      }
    },
  };
}

/**
 * The benchmark's hand replay (api._benchHand): an encoded throw played through `box.roll` as a
 * source (its recorded frames, no physics, never a THROW) over the whole stage, with look-only dice.
 * Returns the roll's landed promise, or false for a payload that does not decode.
 */
export function benchReplay(box, payload) {
  const d = decodeTrajectory(payload);
  if (!d) return false;
  const specs = d.shapes.map((shape, i) => ({
    type: shape === 'd4crystal' ? 'd4' : shape,
    shapeType: shape,
    value: d.values[i] ?? 1,
    free: true,
    key: d.keys[i],
  }));
  const placed = placeTrajectory(d, { cx: 0, cz: 0, ...box._area }, box._area);
  return box.roll(specs, { source: replaySource(placed), free: true, edge: d.edge }).landed;
}

/** The Foundry result a planned die stands for (a d100's tens die: its tens part, as readResult). */
const resultOfSpec = (s) => (s.variant === 'd100tens' ? s.value : resultOf(s.value, s.variant));

/**
 * The replay of `decoded` (decodeTrajectory's), or null when it does not match the message:
 * - `n`: the roll's dicerHand.n, which the recording's dice count must equal;
 * - `specs`: this screen's plan for the roll (real view: its looks, fx, damage type, keyed);
 * - `full`: the roll planned with every result (showExtra, no maxDice cut), same looks;
 * - `diceBox`, `rect` (the px area the gate throws in, or null: the stage), `capacity` (the dice
 *   that share the area).
 * Every recorded die must have a unique key of `full`, its own shape (a d4 may be a crystal d4),
 * and the final frame must read the message's result for it. Its replay spec is this plan's spec
 * for the key, or a look-only one (no fx or damage type) when this plan dropped it (maxDice,
 * showExtraDice off); it is drawn with the recorded shape and is free (physics already decided).
 * Returns {specs, source, extras, edge, obstacles, area, paths}: `extras` are this plan's dice the
 * recording lacks (explosions, rerolls thrown later), thrown forced after the replay lands (P6-D3);
 * `obstacles`, `area` and `paths` are placed here, for the pets' alignFor (H-6).
 */
export function replayFor(decoded, { n, specs, full, diceBox, rect, capacity = 0 }) {
  const { keys, shapes } = decoded;
  if (decoded.n !== n || new Set(keys).size !== keys.length) return null;
  const mine = new Map(specs.map((s) => [s.key, s]));
  const all = new Map(full.map((s) => [s.key, s]));
  const last = decoded.chunks[decoded.chunks.length - 1];
  const at = last.length - decoded.n * FLOATS_PER_DIE;
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const ref = all.get(keys[i]);
    const shape = shapes[i];
    if (!ref || !(shape === ref.type || (ref.type === 'd4' && shape === 'd4crystal'))) return null;
    const o = at + i * FLOATS_PER_DIE;
    const q = { x: last[o + 3], y: last[o + 4], z: last[o + 5], w: last[o + 6] };
    if (readResult(getShape(shape), q, ref.variant) !== resultOfSpec(ref)) return null;
    let spec = mine.get(keys[i]);
    if (!spec) {
      spec = { ...ref }; // H-10: look only
      delete spec.fx;
      delete spec.damageType;
    }
    out.push({ ...spec, shapeType: shape, free: true });
  }
  const stage = diceBox._area;
  const target = rect
    ? diceBox.dieArea(rect, Math.max(capacity, out.length))
    : { cx: 0, cz: 0, ...stage };
  const placed = placeTrajectory(decoded, target, stage);
  const recorded = new Set(keys);
  return {
    specs: out,
    source: replaySource(placed),
    extras: specs.filter((s) => !recorded.has(s.key)),
    edge: decoded.edge,
    // Task 9: the pets here take these spots (alignFor), off the die paths
    obstacles: placed.obstacles,
    area: placed.area,
    paths: pathsOf(placed),
  };
}
