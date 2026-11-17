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
/** The same dependencies, for the chunk's dice tray. */
export const handDeps = () => deps;

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

/** Dicer fulfils this user's dice: hand rolls on or required, or physics decides the results. */
export const diceOnDicer = (get) =>
  get('handRollsRequired') === true || get('handRolls') !== 'off' || get('physicsResults') === true;

/**
 * Could `user` throw by hand (M8: the idle prefetch)? Allowed, and hand rolls on (or required) or
 * a die on `dicer` in the core dice configuration `core`.
 */
export const wantsHand = (user, get, core) =>
  handAllowed(user, get) &&
  (diceOnDicer(get) || Object.values(core ?? {}).includes('dicer'));

/**
 * Brings the core diceConfiguration in line with the hand settings (the body is the hand chunk's
 * syncConfig). The chunk is loaded only when there is something to do: a dicer entry or a stash
 * to undo, or hand rolls on (or required) for an allowed user. An "off" world never loads it.
 */
export function syncDiceConfiguration(o) {
  const { getSetting: get, user } = o;
  if (
    Object.values(o.getCore() ?? {}).includes('dicer') ||
    Object.keys(get('handRollStash') ?? {}).length ||
    (handAllowed(user, get) && diceOnDicer(get))
  ) {
    return loadHand().then((m) => m?.syncConfig(o));
  }
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
