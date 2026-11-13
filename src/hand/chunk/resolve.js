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
import { modelRotationFor } from '../../compat/dsn-orientation.js';

/** id (roll.options.dicerHand.id) -> {recording, handle, specs} of the thrower's hand throw (Task 8). */
export const handThrows = new Map();

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

/**
 * The default "Throw by hand / Roll automatically" prompt (Foundry's DialogV2); true: by hand. It
 * closes itself after `ms` (then null: automatic).
 */
const askHand = (roll, ms) => {
  let dialog;
  const timer = setTimeout(() => dialog?.close(), ms);
  return foundry.applications.api.DialogV2.confirm({
    window: { title: loc('DICER.Hand.AskTitle') },
    content: `<p>${loc('DICER.Hand.AskText')}</p>`,
    yes: { label: loc('DICER.Hand.ThrowByHand'), icon: 'fa-solid fa-hand', default: true },
    no: { label: loc('DICER.Hand.RollAuto'), icon: 'fa-solid fa-dice', default: false },
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
/**
 * A hand throw (overlay open, then the dice in flight) is given handRollTimeout plus this long at
 * most; past it the roll falls back and the queue moves on. Above a free throw's 13 s
 * (MAX_FREE_STEPS) and DiceBox's landing grace, so a throw that lands is never cut.
 */
export const HAND_GRACE_MS = 15000;

/**
 * Runs `fn` (an ask prompt and overlay, a tray throw) once the interactive throw before it ends,
 * or after 2 × `ms` + HAND_GRACE_MS (the one before may spend its own ask and throw): nothing
 * waits forever. Resolves with fn's value.
 */
export async function queued(ms, fn) {
  const prev = queue;
  let next;
  queue = new Promise((r) => (next = r));
  try {
    await within(prev, 2 * ms + HAND_GRACE_MS);
    return await fn();
  } finally {
    next();
  }
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

/** The geometry DiceBox draws `spec` with (its #makeDie rule): a crystal-look d4 is a d4crystal. */
function shapeTypeOf(spec, rollLook) {
  const look = spec.appearance ? normalizeAppearance(spec.appearance) : rollLook;
  return spec.type === 'd4' &&
    !spec.variant &&
    !modelRotationFor(spec) &&
    !spec.faces &&
    look.shapes.d4 === 'crystal'
    ? 'd4crystal'
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
 * them), with the author's look and nothing result-dependent (fx, damage type). Unreadable and
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
  const placeholder = view(roll, { dice: dice.map((t) => view(t, { results: fake.get(t) })) });
  const dec = d.decorateFor?.(null, roll, me.id, me.id);
  const decorate =
    dec &&
    ((...a) => {
      const { fx, damageType, ...look } = dec(...a) ?? {};
      return look;
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
  const { roll, dicer: d } = resolver;
  const me = d.user();
  handFor(d.diceBox);
  const ghost = ghostFor(roll, me);
  const entry = { specs, handle: null, recording: null };
  try {
    const thrown = d.diceBox.roll(ghost ? specs.map((s) => ({ ...s, ghost })) : specs, {
      area: d.areas.rectFor({ rollerId: me.id }),
      free: true,
      record: (rec) => (entry.recording = rec),
    });
    entry.handle = thrown.handle;
    const values = await thrown.values;
    if (values) handThrows.get(roll.options?.dicerHand?.id)?.extras.push(entry);
    return values;
  } catch (err) {
    console.warn('dicer: a free throw failed', err);
    return null;
  }
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
  return queued(ms, async () => {
    if (resolver._closed) return fallback('cancel');
    if (d.getSetting('handRollsRequired') !== true && d.getSetting('handRolls') === 'ask') {
      let yes = false;
      try {
        yes = (await within((d.ask ?? askHand)(roll, ms), ms)) === true;
      } catch {
        /* no prompt: automatic */
      }
      if (!yes) return fallback('auto');
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
      out = await within(
        openThrowOverlay({
          specs,
          rect: rect(),
          getRect: rect,
          diceBox: d.diceBox,
          timeoutMs: ms,
          ghostOnRelease: ghostFor(roll, me),
          label: roll.formula,
        }),
        ms + HAND_GRACE_MS,
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
    const n = push(specs, owners, out.values);
    // Stored once pushed: a failure before this marks the roll's dicerHand a fallback (failed()).
    handThrows.set(hand.id, { recording: out.recording, handle: out.handle, specs, extras: [] });
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
