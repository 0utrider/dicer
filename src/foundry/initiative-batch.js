/**
 * Roll All / Roll NPCs: the initiative of several combatants rolled in one go is shown as one
 * throw (lazy chunk: loaded when a combat tracker renders with a combat, and by the hand chunk).
 *
 * The roller's client: watchRollInitiative counts the Combat#rollInitiative calls for two or more
 * combatants, and while one runs every initiative message this user creates is marked
 * `flags.dicer.batch` with that call's id (before it is stored, so every client reads it).
 * A call for one combatant marks nothing: a single initiative roll is shown as it always was.
 *
 * Every client: the message gate hands the throw of a marked message to join(), which collects the
 * dice of one batch that land in the same area and throws them together, GAP_MS after the last one
 * came in (Foundry creates the messages in one request; PF2e and SF2e one request each).
 */

/**
 * A batch is thrown this long after its last message came in. PF2e's cards were seen up to 150 ms
 * apart in a live world (2026-11-24), so 100 could split one Roll NPCs into two throws.
 */
export const GAP_MS = 250;
/** One throw holds at most this many dice; a larger batch is thrown in several, side by side. */
export const MAX_DICE = 60;

let many = 0; // rollInitiative calls for several combatants now running
let batch = null; // their id (calls that overlap share it)
let hooked = false;

/** How many rollInitiative calls for several combatants are running (the hand chunk's resolver). */
export const rollingMany = () => many;

/** preCreateChatMessage: marks an initiative message created during such a call. Never throws. */
export function mark(message) {
  try {
    if (!batch || message?.flags?.core?.initiativeRoll !== true || message.flags.dicer?.batch) return;
    message.updateSource({ flags: { dicer: { batch } } });
  } catch (err) {
    console.warn('dicer: cannot mark an initiative roll', err);
  }
}

/**
 * Counts, on `proto` (the world's Combat class; a system's own rollInitiative included), the
 * rollInitiative calls for several combatants while they run. A call for one combatant is not
 * counted. Set once per method; the call's answer and failure are the method's own. The first call
 * also registers the preCreateChatMessage listener on `hooks`.
 */
export function watchRollInitiative(
  proto = globalThis.CONFIG?.Combat?.documentClass?.prototype,
  hooks = globalThis.Hooks,
) {
  if (!hooked && typeof hooks?.on === 'function') {
    hooked = true;
    // a block body: a pre-hook listener returning false would cancel the message
    hooks.on('preCreateChatMessage', (message) => {
      mark(message);
    });
  }
  const own = proto?.rollInitiative;
  if (typeof own !== 'function' || own.dicer) return;
  const watched = async function (ids, ...rest) {
    if (!Array.isArray(ids) || ids.length < 2) return own.call(this, ids, ...rest);
    many++;
    batch ??= globalThis.foundry?.utils?.randomID?.() ?? `${Date.now()}`;
    try {
      return await own.call(this, ids, ...rest);
    } finally {
      if (!--many) batch = null;
    }
  };
  watched.dicer = true;
  proto.rollInitiative = watched;
}

/** 'batch id|area' -> { parts: [{specs, opts, cast, resolve, reject}], dice, timer, timers } */
const open = new Map();

function flush(key) {
  const b = open.get(key);
  if (!b) return;
  open.delete(key);
  b.timers.clearTimeout(b.timer);
  const [first] = b.parts;
  try {
    let landed;
    if (b.parts.length === 1) landed = first.cast();
    else {
      // One throw, sized for all its dice (no capacityDice of one message), with the first roll's pet.
      const opts = first.opts ? { ...first.opts } : null;
      if (opts) delete opts.capacityDice;
      landed = first.cast(
        b.parts.flatMap((p) => p.specs),
        opts,
      );
    }
    for (const p of b.parts) p.resolve(landed);
  } catch (err) {
    for (const p of b.parts) p.reject(err);
  }
}

/**
 * The gate's throw of one roll of a marked message: `cast(specs, opts)` throws and returns the
 * landing promise (called with nothing, it throws the roll's own dice as the gate would have).
 * Resolves like that promise, for the throw this roll's dice ended up in. Rolls of the same batch
 * `id` and the same `opts.area` share a throw; one roll alone is thrown as it is.
 */
export function join(id, specs, opts, cast, timers = globalThis) {
  const key = `${id}|${JSON.stringify(opts?.area ?? null)}`;
  if (open.get(key)?.dice + specs.length > MAX_DICE) flush(key);
  let b = open.get(key);
  if (!b) open.set(key, (b = { parts: [], dice: 0, timer: null, timers }));
  b.dice += specs.length;
  timers.clearTimeout(b.timer);
  b.timer = timers.setTimeout(() => flush(key), GAP_MS);
  return new Promise((resolve, reject) => b.parts.push({ specs, opts, cast, resolve, reject }));
}
