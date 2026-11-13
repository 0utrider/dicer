/**
 * Rolling by hand, the world-start half (keep it byte-lean): Foundry's fulfillment method `dicer`,
 * the DicerResolver shell and the core diceConfiguration sync. The resolver's body is the lazy
 * hand chunk's (chunk/resolve.js): fulfill, fulfillTerm and extraResult.
 */
import { loadHand } from './hand-loader.js';

/** The per-die denominations Foundry's dice configuration offers (CONFIG.Dice.fulfillment.dice). */
export const HAND_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'c', 'f'];

let deps = null; // main.js's at ready: diceBox, areas, decorateFor, plan, getSetting, hooks, ...
/** The hand chunk's dependencies; every resolver made after this carries them (resolver.dicer). */
export const setHandDeps = (d) => (deps = d);

/** May `user` roll by hand? From the world's handRollsAllowed (unreadable: 'all') and the role. */
export function handAllowed(user, getSetting) {
  let v;
  try {
    v = getSetting('handRollsAllowed');
  } catch {
    /* not registered */
  }
  const min = { all: 0, trusted: 2, gm: 3 }[v ?? 'all'];
  return !!user && min !== undefined && (user.isGM === true || (user.role ?? 0) >= min);
}

const differ = (a, b) => {
  const keys = Object.keys(a);
  return keys.length !== Object.keys(b).length || keys.some((k) => a[k] !== b[k]);
};
let warnedOther = false;

/**
 * Brings the core diceConfiguration in line with the hand settings. Dicer's entries are removed
 * (entries required took from another method come back from the `handRollStash` client setting),
 * then, when hand rolls are on (or required) and allowed, each chosen denomination (none: all of
 * HAND_DICE, plus default) is mapped to `dicer` where no other method holds it; required also
 * takes a denomination from another method (never default), stashing it. With another
 * interactive method than manual configured (Foundry would then use its generic resolver, H-17),
 * nothing is mapped (one warning). Writes only on a change.
 */
export function syncDiceConfiguration({ getSetting, user, getCore, setCore, setSetting }) {
  const was = getCore() ?? {};
  const stash = { ...getSetting('handRollStash') };
  const kept = { ...stash };
  const out = {};
  for (const k in was) if (was[k] !== 'dicer') out[k] = was[k];
  for (const k in stash) if (!out[k]) out[k] = stash[k];
  for (const k in stash) delete stash[k];
  const req = getSetting('handRollsRequired') === true;
  const other = Object.values(out).some(
    (m) => m && m !== 'manual' && globalThis.CONFIG?.Dice?.fulfillment?.methods?.[m]?.interactive,
  );
  if (other && !warnedOther) warnedOther = !console.warn('dicer: another interactive dice method is configured; rolling by hand stays off');
  if (!other && handAllowed(user, getSetting) && (req || getSetting('handRolls') !== 'off')) {
    const chosen = getSetting('handRollTypes');
    for (const k of chosen?.length ? chosen : [...HAND_DICE, 'default']) {
      if (out[k] && req && k !== 'default') stash[k] = out[k];
      if (!out[k] || stash[k]) out[k] = 'dicer';
    }
  }
  if (differ(stash, kept)) setSetting?.('handRollStash', stash);
  if (differ(out, was)) return setCore(out);
}

let Resolver = null;

/** `fn(chunk)`, never rejecting: a failure (or no chunk) is undefined, Foundry's random. */
const chunk = (fn) =>
  loadHand()
    .then((m) => (m ? fn(m) : undefined)) // never null: Foundry rolls random only for undefined
    .catch((err) => console.warn('dicer: a hand roll failed', err));

/**
 * DicerResolver, made once from Foundry's RollResolver (at init: the base is a Foundry global).
 * Its form is never rendered for dicer terms: the chunk throws them and pushes the read results,
 * and a die left unfilled comes back through resolveResult (undefined: Foundry's random face).
 * close() is safe unrendered; it releases a pending awaitFulfillment and aborts an open throw.
 */
export function dicerResolver(Base = foundry.applications.dice.RollResolver) {
  return (Resolver ??= class DicerResolver extends Base {
    /** The chunk's dependencies (setHandDeps). */
    get dicer() {
      return deps;
    }
    /** The chunk's fulfill(this), or nothing when the chunk is unavailable. */
    awaitFulfillment() {
      return Promise.race([chunk((m) => m.fulfill(this)), new Promise((r) => (this._release = r))]);
    }
    addTerm(term) {
      return chunk((m) => m.fulfillTerm(this, term));
    }
    resolveResult(term, method, options) {
      return chunk((m) => m.extraResult(this, term, method, options));
    }
    close(options) {
      this._closed = true;
      this._abort?.();
      this._release?.();
      return super.close(options);
    }
    /** The base class's own `name` (manual terms: Foundry's form). */
    _base(name, ...args) {
      return super[name](...args);
    }
  });
}

/** Registers the fulfillment method (init). */
export function registerHandMethod(Base) {
  CONFIG.Dice.fulfillment.methods.dicer = {
    label: 'DICER.Hand.Method',
    icon: '<i class="fa-solid fa-hand"></i>',
    interactive: true,
    resolver: dicerResolver(Base),
  };
}
