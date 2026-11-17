/**
 * The DicerResolver's body (lazy hand chunk; the world-start shell is ../shell.js). Foundry v14
 * (dice/roll.mjs, dice/terms/dice.mjs, applications/dice/roll-resolver.mjs):
 * - Roll#_evaluate awaits awaitFulfillment() (fulfill here), then evaluates every term. A die still
 *   missing then calls resolveResult(term, method, options) once (extraResult here), and so do
 *   explosions and rerolls ({explode} / {reroll}). undefined there is Foundry's randomFace().
 * - A term without `_id` (an intermediate or dynamic one, like (1d4)d6) calls addTerm(term)
 *   first (fulfillTerm here).
 * - RollResolver#close() fills dice only when its form is rendered, and Dicer's never is: so the
 *   timeout / cancel fallback is "push nothing and answer undefined from then on" (Review Focus 2).
 * - Manual terms (the only other method a DicerResolver gets: Roll.resolverImplementation) are
 *   Foundry's own: dicer terms get their `_id` and method first, so the base awaitFulfillment
 *   renders its form for the manual ones only, and their addTerm / resolveResult go to the base (R9).
 */
import { openThrowOverlay } from './overlay.js';
import { handFor } from './box.js';
import { HAND_UNFAIR } from '../unfair.js';
import { handAllowed } from '../shell.js';
import { normalizeAppearance } from '../../look/appearance.js';
import { shapeTypeFor } from '../../core/dice-shapes.js';
import { modelRotationFor } from '../../compat/dsn-orientation.js';

/** id (roll.options.dicerHand.id) -> {recording, handle, specs} of the thrower's hand throw (Task 8). */
export const handThrows = new Map();
/** A stored throw no chat message took (a roll only evaluated, or discarded) goes after this long… */
export const THROW_TTL_MS = 120000;
/** …and at most this many are kept (the oldest goes first). */
export const THROW_LIMIT = 16;

/**
 * Stores a thrower's hand throw under `id` for sendHand (M3): expired entries are dropped, and the
 * oldest past THROW_LIMIT. Dropping one only lets go of its recording and its DiceBox roll handle
 * (DiceBox removes the dice itself when they fade).
 */
export function storeThrow(id, entry) {
  const now = Date.now();
  // The TTL runs from the last throw stored, not from each one: a long burst (initiative for a
  // crowd) may create its messages only once every roll is thrown, so its first throws must
  // outlive the burst. After THROW_TTL_MS with no throw at all, the leftovers go.
  if (now - lastStored > THROW_TTL_MS) handThrows.clear();
  lastStored = now;
  handThrows.set(id, entry);
  while (handThrows.size > THROW_LIMIT) handThrows.delete(handThrows.keys().next().value);
}
let lastStored = -Infinity;

/**
 * H-19: modes in which the roller may not see the result (Foundry v14 messageMode, legacy rollMode).
 * Blind only: a "Private GM Roll" (gm / gmroll) is visible to its author (config.mjs modes.gm).
 */
const SECRET = ['blind', 'blindroll'];
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const facesOf = (type) => +/^d(\d+)$/.exec(type)?.[1];

/** The method the core dice configuration gives `term` (as DiceTerm's fulfillment handler). */
const methodOf = (resolver, term) => {
  const c =
    resolver.dicer?.getCore?.() ??
    globalThis.game?.settings?.get('core', 'diceConfiguration') ??
    {};
  return c[term.denomination] || c.default || globalThis.CONFIG?.Dice?.fulfillment?.defaultMethod;
};
const stateOf = (resolver) => (resolver._hand ??= { partial: 0, fallback: null });

/** Text for HTML: markup a flavor may carry dropped, the rest escaped. */
const asText = (s) =>
  String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? '&#39;');

/**
 * The default "Throw by hand / Roll automatically" prompt (Foundry's DialogV2), naming the roll
 * (its flavor and formula, M6); 'yes': by hand, 'no' or null: automatic. In a `burst` (rolls
 * queued, or right after another) it also offers 'rest': this roll and the rest of the burst roll
 * automatically. It closes itself after `ms` (then null: automatic).
 */
const askHand = (roll, ms, burst) => {
  let dialog;
  const timer = setTimeout(() => dialog?.close(), ms);
  const flavor = roll.options?.flavor;
  const name = asText(flavor ? `${flavor}: ${roll.formula}` : roll.formula);
  const buttons = [
    { action: 'yes', label: loc('DICER.Hand.ThrowByHand'), icon: 'fa-solid fa-hand', default: true },
    { action: 'no', label: loc('DICER.Hand.RollAuto'), icon: 'fa-solid fa-dice' },
  ];
  if (burst) buttons.push({ action: 'rest', label: loc('DICER.Hand.ThrowRestAuto'), icon: 'fa-solid fa-forward' });
  return foundry.applications.api.DialogV2.wait({
    window: { title: loc('DICER.Hand.AskTitle') },
    content: `<p><strong>${name}</strong></p><p>${loc('DICER.Hand.AskText')}</p>`,
    buttons,
    rejectClose: false,
    render: (_, d) => (dialog = d),
  }).finally(() => clearTimeout(timer));
};

/** `p`, or null once `ms` have passed. */
export const within = (p, ms) => {
  let timer;
  return Promise.race([p, new Promise((r) => (timer = setTimeout(r, ms, null)))]).finally(() =>
    clearTimeout(timer),
  );
};

/** One interactive throw (ask prompt and overlay) at a time: each waits for the one before. */
let queue = Promise.resolve();
let waiting = 0; // queued() calls not finished (the one running included)
let lastEnd = -Infinity; // when the last one finished (Date.now)
/** A roll queued, or starting within this long of the last one's end, is part of a burst (M6). */
export const BURST_MS = 3000;
let resting = false; // "Throw the rest automatically" chosen in this burst
/**
 * A hand throw's dice are given this long in flight, from the release (M4: a release just before
 * handRollTimeout is never cut); past it the roll falls back and the queue moves on. Above a free
 * throw's 13 s (MAX_FREE_STEPS) plus DiceBox's 3 s landing grace, so a throw that lands is never cut.
 */
export const HAND_GRACE_MS = 20000;

/**
 * `overlay(o)` (openThrowOverlay) with its throw bounded: null once the dice have flown
 * HAND_GRACE_MS from the release (its onRelease), or handRollTimeout `ms` + HAND_GRACE_MS from the
 * opening when it never releases (the overlay times out itself at `ms`).
 */
export function throwWithin(overlay, o, ms) {
  let timer;
  let end;
  const arm = (t) => {
    clearTimeout(timer);
    timer = setTimeout(() => end(null), t);
  };
  const bound = new Promise((r) => (end = r));
  arm(ms + HAND_GRACE_MS);
  return Promise.race([overlay({ ...o, onRelease: () => arm(HAND_GRACE_MS) }), bound]).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Runs `fn` (an ask prompt and overlay, a tray throw) once the interactive throw before it ends,
 * or after 2 × `ms` + HAND_GRACE_MS (the one before may spend its own ask and throw): nothing
 * waits forever. Resolves with fn's value. `fn(hold)`: `hold(promise)` keeps the queue (not the
 * caller) until that promise settles, at most HAND_GRACE_MS: a live hand throw resolves its roll at
 * the read while the next throw still waits for its dice to land.
 */
export async function queued(ms, fn) {
  const prev = queue;
  let next;
  queue = new Promise((r) => (next = r));
  waiting++;
  let held = null;
  const end = () => {
    waiting--;
    lastEnd = Date.now();
    next();
  };
  try {
    await within(prev, 2 * ms + HAND_GRACE_MS);
    return await fn((p) => void (held = p));
  } finally {
    if (held) within(Promise.resolve(held), HAND_GRACE_MS).then(end, end);
    else end();
  }
}

/** Inside queued(): whether this roll is part of a burst (others queued, or one just ended). */
const inBurst = () => waiting > 1 || Date.now() - lastEnd < BURST_MS;

/**
 * A hand roll starting this long after the last overlay throw landed is a follow-up (a flat
 * check, an automatic damage roll): thrown free, with no ask prompt and no throw screen.
 */
export const FOLLOW_MS = 3000;
let lastLanded = -Infinity; // when the last overlay throw's values arrived; follow-ups never set it
// The window's end: FOLLOW_MS after that throw's dice land (Infinity while a live throw still flies).
let followUntil = -Infinity;
/** `startedAt`: when the roll started, before any queue wait (a roll queued behind a throw is not its follow-up). */
const isFollowUp = (getSetting, startedAt) =>
  getSetting('handFollowUps') === true && // also while hand rolls are required: still a real throw
  startedAt >= lastLanded &&
  startedAt < followUntil;

/** Opens the follow-up window at the read; it closes FOLLOW_MS after `landed` (now when absent). */
function openFollowWindow(landed) {
  const at = (lastLanded = Date.now());
  if (!landed) return void (followUntil = at + FOLLOW_MS);
  followUntil = Infinity;
  const close = () => {
    if (lastLanded === at) followUntil = Date.now() + FOLLOW_MS; // a later throw owns the window
  };
  within(Promise.resolve(landed), HAND_GRACE_MS).then(close, close); // dice that never land too
}

let warned = false;
/**
 * A failure inside the resolver body (a throwing planner, decorator, look, DiceBox or Foundry
 * term): warned once, and the roll falls back, so Foundry rolls what is missing and the roll
 * still finishes. A roll whose hand throw already landed keeps its dicerHand as it is.
 */
function failed(resolver, err) {
  if (!warned) warned = !console.warn('dicer: a hand roll failed; Foundry rolls the dice', err);
  const st = stateOf(resolver);
  st.fallback ||= 'cancel';
  const h = resolver.roll?.options?.dicerHand;
  if (h && !h.fallback && !handThrows.has(h.id)) h.fallback = st.fallback;
}

/** The geometry DiceBox draws `spec` with (its #makeDie rule): a crystal-look d4 is a d4crystal, a bullet-look d6 a d6bullet. */
function shapeTypeOf(spec, rollLook) {
  const look = spec.appearance ? normalizeAppearance(spec.appearance) : rollLook;
  return !spec.variant && spec.dsnType !== 'd100' && !(spec.model && modelRotationFor(spec)) && !spec.faces
    ? shapeTypeFor(spec.type, look.shapes)
    : spec.type;
}

/**
 * H-3: a die is read through its face value, so it can be thrown by hand only when its shape has
 * the term's faces (a relabel variant, the coin on its d2, a d100's tens and ones), and it is not a
 * shape the fairness run failed (HAND_UNFAIR, owner decision).
 */
const readable = (s, term, part) =>
  !HAND_UNFAIR.includes(s.shapeType) &&
  (s.variant === 'dc'
    ? s.type === 'd2'
    : !!s.variant || facesOf(s.type) === term.faces || (part === 1 && term.faces === 100));

/**
 * The specs a hand throw of `terms` uses: planThrow on a placeholder roll in which each term has
 * `count(term)` results at its minimum face (the existing results hidden, so keys continue after
 * them), with the author's look and its term's damage type, nothing result-dependent (no fx; trail 2
 * drops to 1, so a die never bursts before decorate). Unreadable and
 * unfair dice are dropped, as planThrow drops those past maxDice; the rest are keyed in push order
 * ('roll.dice index:result index:part') and marked free. `owners[i]` is the term spec i's value
 * goes to (a d100's ones die; null for its tens die). `dropped` counts results not thrown.
 */
export function planFor(resolver, terms, count) {
  const { roll, dicer: d } = resolver;
  const me = d.user();
  const all = roll.dice ?? [];
  const dice = [...all, ...terms.filter((t) => !all.includes(t))];
  const fake = new Map(
    dice.map((t) => [
      t,
      [
        ...t.results.map(() => ({ hidden: true })),
        ...Array.from({ length: terms.includes(t) ? count(t) : 0 }, () => ({
          result: t.minResult,
          active: true,
        })),
      ],
    ]),
  );
  // Reflect.get on the term itself: Foundry's getters read private fields.
  const view = (o, over) =>
    new Proxy(o, {
      get: (t, k) => {
        if (Object.hasOwn(over, k)) return over[k];
        const v = Reflect.get(t, k);
        return typeof v === 'function' && k !== 'constructor' ? v.bind(t) : v;
      },
    });
  const views = dice.map((t) => view(t, { results: fake.get(t) }));
  const placeholder = view(roll, { dice: views });
  const dec = d.decorateFor?.(null, roll, me.id, me.id);
  // The decorators get the real term (the damage type and damage theme are looked up by it) and
  // the placeholder result. No fx; trail 2 drops to 1: a placeholder never bursts (decorate does).
  const decorate =
    dec &&
    ((t, ...a) => {
      const { fx, trail, ...look } = dec(dice[views.indexOf(t)] ?? t, ...a) ?? {};
      return trail ? { ...look, trail: 1 } : look;
    });
  const { dice: planned } = d.plan(placeholder, {
    maxDice: Number(d.getSetting('maxDice')) || 20,
    decorate,
  });
  const rollLook = normalizeAppearance(d.diceBox._getAppearance?.() ?? {});
  const groups = new Map(); // 't:r' -> that result's specs
  for (const s of planned) {
    const k = s.key.slice(0, s.key.lastIndexOf(':'));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const specs = [];
  const owners = [];
  const next = new Map(); // term -> its next result index
  let kept = 0;
  for (const [k, g] of groups) {
    const t = +k.split(':')[0];
    const term = dice[t];
    for (const s of g) s.shapeType = shapeTypeOf(s, rollLook);
    if (!g.every((s, p) => readable(s, term, p))) continue;
    const r = next.get(term) ?? term.results.length;
    next.set(term, r + 1);
    kept++;
    g.forEach((s, p) => {
      Object.assign(s, { key: `${t}:${r}:${p}`, free: true });
      specs.push(s);
      owners.push(p === g.length - 1 ? term : null);
    });
  }
  return { specs, owners, dropped: terms.reduce((n, t) => n + count(t), 0) - kept };
}

/** A read value as a DiceTerm result, or null when it is not a face of `term` (Foundry rolls it). */
function asResult(term, v) {
  if (!Number.isInteger(v) || v < term.minResult || v > term.maxResult) return null;
  const r = { result: v, active: true };
  if (term.denomination === 'f') {
    // As FateDie#roll, which pre-filled results skip.
    if (v === 1) r.success = true;
    if (v === -1) r.failure = true;
  }
  return r;
}

/**
 * Pushes each read value into its term in order; returns how many were read. A value that is not
 * a face of its term (defensive) takes term.randomFace() in its slot, so later results stay on
 * the keys the recording carries.
 */
export function push(specs, owners, values) {
  let n = 0;
  specs.forEach((_, i) => {
    const t = owners[i];
    if (!t) return;
    const r = asResult(t, values[i]);
    if (r) n++;
    t.results.push(r ?? asResult(t, t.randomFace()) ?? { result: t.minResult, active: true });
  });
  return n;
}

/** The chat mode a roll goes out in: its own, else the core chat mode (as Roll#toMessage). */
function modeOf(roll) {
  const own = roll.options?.messageMode ?? roll.options?.rollMode;
  if (own) return own;
  for (const k of ['messageMode', 'rollMode']) {
    try {
      const v = game.settings.get('core', k);
      if (v) return v;
    } catch {
      /* not registered (rollMode in v14) */
    }
  }
}

/** H-19: the roll hints that its roller must not see it (a GM sees every such roll). */
const ghostFor = (roll, user) =>
  !user?.isGM && !!(roll.ghost || roll.secret || SECRET.includes(modeOf(roll)));

/**
 * P6-D3: a free "throw for me" of `specs` in the roller's area (no overlay); the read values or
 * null. It is recorded under the roll's hand throw (handThrows entry `extras`), for Task 8.
 */
async function throwFree(resolver, specs) {
  // Live hand throws resolve before their dice land: an explosion or reroll is thrown only once
  // the hand throw's dice have landed here, as before (no early extra die gives the result away,
  // and it follows the throw as the replays elsewhere play it).
  const main = handThrows.get(resolver.roll.options?.dicerHand?.id);
  if (main?.landed) await within(Promise.resolve(main.landed), HAND_GRACE_MS);
  const entry = await castFree(resolver, specs);
  if (entry.values) handThrows.get(resolver.roll.options?.dicerHand?.id)?.extras.push(entry);
  return entry.values;
}

/**
 * A free throw of `specs` in the roller's area (ghosts when the roller must not see the roll):
 * {specs, values, handle, recording}, values null when it fails. With `full`, it also waits for
 * the recording (DiceBox records at physics done; a follow-up's recording is its replay).
 */
async function castFree(resolver, specs, full = false, early = false) {
  const { roll, dicer: d } = resolver;
  const me = d.user();
  handFor(d.diceBox);
  const ghost = ghostFor(roll, me);
  const entry = { specs, values: null, handle: null, recording: null };
  try {
    let gotRecording;
    const recorded = new Promise((r) => (gotRecording = r));
    const thrown = d.diceBox.roll(ghost ? specs.map((s) => ({ ...s, ghost })) : specs, {
      area: d.areas.rectFor({ rollerId: me.id }),
      free: true,
      record: (rec) => gotRecording((entry.recording = rec)),
    });
    entry.handle = thrown.handle;
    // Live: the values physics read, while the dice still fly (landed for the queue's hold).
    const live = early && thrown.read;
    if (live) entry.landed = thrown.landed;
    entry.values = (await (live ? thrown.read : thrown.values)) ?? null;
    if (full && entry.values && !entry.recording) await Promise.race([recorded, thrown.finished]);
  } catch (err) {
    console.warn('dicer: a free throw failed', err);
  }
  return entry;
}

/** Notes `partial` on the roll's dicerHand (H-15), when there is one. */
function notePartial(resolver, n) {
  const st = stateOf(resolver);
  st.partial += n;
  const h = resolver.roll.options?.dicerHand;
  if (h && st.partial) h.partial = st.partial;
}

/**
 * The first pass (DicerResolver#awaitFulfillment): the roll's dicer terms are thrown by hand in
 * the throw overlay (after the ask prompt in 'ask' mode), their read values pushed in order;
 * manual terms then get Foundry's form. A timeout, cancel, failed throw, failure or close pushes
 * nothing: the roll is in fallback and every later resolveResult answers undefined (Foundry's
 * random). Never rejects for its own part.
 */
export async function fulfill(resolver) {
  const { roll, dicer: d } = resolver;
  let manual = false;
  try {
    const mine = [];
    for (const t of foundry.dice.Roll.defaultImplementation.identifyFulfillableTerms(roll.terms)) {
      if (t._id) continue;
      if (methodOf(resolver, t) !== 'dicer') manual = true;
      else {
        // Pre-set (R9): Foundry's form skips a term that has an _id.
        t._id = foundry.utils.randomID();
        t.method = 'dicer';
        mine.push(t);
      }
    }
    if (mine.length) {
      foundry.dice.Roll.defaultImplementation.RESOLVERS.set(roll, resolver);
      if (d) await throwByHand(resolver, mine);
      else stateOf(resolver).fallback = 'auto'; // no engine: Foundry's random
    }
  } catch (err) {
    failed(resolver, err);
  }
  if (manual && !resolver._closed) await resolver._base('awaitFulfillment');
}

async function throwByHand(resolver, terms) {
  const { roll, dicer: d } = resolver;
  const st = stateOf(resolver);
  const me = d.user();
  const hand = ((roll.options ??= {}).dicerHand = {
    id: foundry.utils.randomID(),
    by: me.id,
    n: 0,
  });
  const { specs, owners, dropped } = planFor(resolver, terms, (t) =>
    Math.max(0, Math.abs(t.number) - t.results.length),
  );
  hand.n = specs.length;
  const ms = Number(d.getSetting('handRollTimeout')) * 1000 || 60000;
  const fallback = (why) => void (st.fallback = hand.fallback = why);
  if (!handAllowed(me, d.getSetting)) return fallback('auto');
  if (!specs.length) return notePartial(resolver, dropped);
  // Queued behind any throw in progress (another roll's prompt or overlay, a tray throw); its
  // timeout starts when shown.
  const startedAt = Date.now();
  // Live hand throws: the roll resolves when physics reads the values, seconds before this
  // screen's dice land, so its message (and the trajectory for the others) goes out at once.
  const early = d.getSetting('handLiveShare') !== false;
  // "Physics decides": every roll is thrown for the roller, and the faces physics lands up are its
  // result (a required hand throw is still a real one).
  const physics = d.getSetting('handRollsRequired') !== true && d.getSetting('handRolls') === 'physics';
  return queued(ms, async (hold) => {
    if (resolver._closed) return fallback('cancel');
    if (physics || isFollowUp(d.getSetting, startedAt)) {
      // Bounded: dice that never settle must not hold the queue.
      const entry = await within(castFree(resolver, specs, true, early), HAND_GRACE_MS);
      if (entry?.landed) hold(entry.landed);
      if (!entry?.values || resolver._closed) return fallback(entry ? 'cancel' : 'timeout');
      if (physics) hand.physics = true;
      else hand.follow = true;
      const n = push(specs, owners, entry.values);
      storeThrow(hand.id, { recording: entry.recording, handle: entry.handle, specs, extras: [], landed: entry.landed });
      return notePartial(resolver, dropped + owners.filter(Boolean).length - n);
    }
    if (d.getSetting('handRollsRequired') !== true && d.getSetting('handRolls') === 'ask') {
      const burst = inBurst();
      if (!burst) resting = false; // a new burst asks again
      if (resting) return fallback('auto');
      let a = null;
      try {
        a = await within((d.ask ?? askHand)(roll, ms, burst), ms);
      } catch {
        /* no prompt: automatic */
      }
      if (a === 'rest') resting = true;
      if (a !== true && a !== 'yes') return fallback('auto');
      if (resolver._closed) return fallback('cancel');
    }
    const rect = () => d.areas.rectFor({ rollerId: me.id });
    handFor(d.diceBox);
    d.hooks?.callAll('diceSoNicePendingThrowOpened', roll);
    // close() mid-throw (another app closed the resolver): the overlay cancels.
    resolver._abort = () =>
      globalThis.document?.querySelector?.('.dicer-hand-overlay [data-action="cancel"]')?.click();
    let out;
    try {
      // A throw whose dice never settle (DiceBox's values pending) must not hold the queue: null.
      out = await throwWithin(
        openThrowOverlay,
        {
          specs,
          rect: rect(),
          getRect: rect,
          diceBox: d.diceBox,
          timeoutMs: ms,
          ghostOnRelease: ghostFor(roll, me),
          label: roll.formula,
          early,
        },
        ms,
      );
    } catch (err) {
      console.warn('dicer: the throw overlay failed', err);
    } finally {
      resolver._abort = null;
      d.hooks?.callAll('diceSoNicePendingThrowClosed', roll);
    }
    // null: past the bound (within); undefined: the overlay threw.
    if (!out?.values || resolver._closed) {
      return fallback(out === null || out?.timedOut ? 'timeout' : 'cancel');
    }
    if (out.landed) hold(out.landed); // the next throw waits for these dice to land
    openFollowWindow(out.landed); // until FOLLOW_MS after the landing
    const n = push(specs, owners, out.values);
    // Stored once pushed: a failure before this marks the roll's dicerHand a fallback (failed()).
    storeThrow(hand.id, { recording: out.recording, handle: out.handle, specs, extras: [], landed: out.landed });
    notePartial(resolver, dropped + owners.filter(Boolean).length - n);
  });
}

/**
 * DicerResolver#addTerm: a dynamic or intermediate term. A manual one is Foundry's; a dicer one
 * gets its _id and method and its dice thrown free in the roller's area (P6-D3), unless the roll
 * is in fallback or the user may not roll by hand: then nothing (Foundry's random), counted in
 * `partial`. A failure falls back the same way.
 */
export async function fulfillTerm(resolver, term) {
  if (methodOf(resolver, term) !== 'dicer') return resolver._base('addTerm', term);
  const count = () => Math.max(0, Math.abs(term.number) - term.results.length);
  try {
    if (!term.number || !term.faces) return;
    term._id ??= foundry.utils.randomID();
    term.method = 'dicer';
    const d = resolver.dicer;
    const want = count();
    if (!want) return;
    if (
      !d ||
      stateOf(resolver).fallback ||
      resolver._closed ||
      !handAllowed(d.user(), d.getSetting)
    ) {
      return notePartial(resolver, want);
    }
    const { specs, owners, dropped } = planFor(resolver, [term], count);
    const values = specs.length ? await throwFree(resolver, specs) : null;
    const n = values ? push(specs, owners, values) : 0;
    notePartial(resolver, dropped + owners.filter(Boolean).length - n);
  } catch (err) {
    failed(resolver, err);
    notePartial(resolver, count() || 0);
  }
}

/**
 * DicerResolver#resolveResult: an explosion or reroll of a dicer term is one free die thrown in
 * the same area (P6-D3), answered with its read result. A missing die (dropped from the throw),
 * a roll in fallback, an unreadable shape, a failed throw or a failure answer undefined: Foundry's
 * random. Manual terms are Foundry's.
 */
export async function extraResult(resolver, term, method, options) {
  if (method !== 'dicer') return resolver._base('resolveResult', term, method, options);
  try {
    const d = resolver.dicer;
    if (!(options?.explode || options?.reroll) || !d || resolver._closed) return undefined;
    if (stateOf(resolver).fallback || !handAllowed(d.user(), d.getSetting)) return undefined;
    const { specs, owners } = planFor(resolver, [term], () => 1);
    if (!specs.length) return undefined;
    const values = await throwFree(resolver, specs);
    return asResult(term, values?.[owners.findIndex(Boolean)])?.result;
  } catch (err) {
    failed(resolver, err);
    return undefined;
  }
}
