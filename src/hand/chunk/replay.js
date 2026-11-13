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
        const first = cast(r.specs, { ...opts, source: r.source, free: true, edge: r.edge });
        return r.extras.length ? first.then(() => alive() && cast(r.extras)) : first;
      } catch (err) {
        console.warn('dicer: a hand replay failed', err);
        return null;
      }
    },
  };
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
 * Returns {specs, source, extras, edge, obstacles}: `extras` are this plan's dice the recording
 * lacks (explosions, rerolls thrown later), thrown forced after the replay lands (P6-D3).
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
    obstacles: placed.obstacles, // Task 9 aligns the pets to these
  };
}
