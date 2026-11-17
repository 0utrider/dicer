/**
 * The core diceConfiguration sync's body (lazy hand chunk; the world-start gate is
 * ../shell.js syncDiceConfiguration, which loads this only when there is something to do).
 */
import { HAND_DICE, handAllowed, diceOnDicer } from '../shell.js';

const differ = (a, b) => {
  const keys = Object.keys(a);
  return keys.length !== Object.keys(b).length || keys.some((k) => a[k] !== b[k]);
};
let warnedOther = false;

/**
 * Foundry picks one resolver from the whole dice configuration and uses its generic one as soon as
 * two interactive methods are configured (Roll.resolverImplementation). Dicer's resolver already
 * hands every die that is not its own to that generic form, so with `dicer` next to methods that
 * have no resolver of their own (Pixels: they fill the open form), Dicer's is the one to use.
 * Installed by syncConfig: the chunk is loaded whenever a `dicer` entry exists, the only case it
 * matters.
 */
export function patchResolverChoice(Roll = globalThis.foundry?.dice?.Roll) {
  if (!Roll || Roll.dicerResolverChoice) return;
  /** Dicer's resolver when `dicer` sits only beside methods with no resolver of their own, else null. */
  const dicerOne = () => {
    const methods = CONFIG.Dice.fulfillment.methods;
    const config = game.settings.get('core', Roll.DICE_CONFIGURATION_SETTING) ?? {};
    const used = new Set(Object.values(config).filter((m) => m && m !== 'manual' && methods[m]?.interactive));
    return used.size > 1 && used.has('dicer') && [...used].every((m) => m === 'dicer' || !methods[m].resolver)
      ? methods.dicer.resolver
      : null;
  };
  // Foundry v14: a static getter (Roll#evaluate reads `this.constructor.resolverImplementation`);
  // assigning it throws, which once aborted the whole dice configuration sync. Older: a method.
  const own = Object.getOwnPropertyDescriptor(Roll, 'resolverImplementation');
  if (own?.get) {
    Object.defineProperty(Roll, 'resolverImplementation', {
      configurable: true,
      get() {
        return dicerOne() ?? own.get.call(this);
      },
    });
  } else {
    const base = Roll.resolverImplementation;
    if (typeof base !== 'function') return;
    Roll.resolverImplementation = function (roll) {
      return dicerOne() ?? base.call(this, roll);
    };
  }
  Roll.dicerResolverChoice = true;
}

/**
 * Brings the core diceConfiguration in line with the hand settings. Foundry's own Configure Dice
 * window is the per-die choice (I2): Dicer records the entries it writes itself in the
 * `handRollMapped` client setting and only ever removes those; a `dicer` entry the user picked
 * there is kept, whatever Roll by hand says.
 * - Dicer's entries are removed first (entries required took from another method come back from
 *   the `handRollStash` client setting).
 * - Hand rolls on (Ask / Always, or required) for an allowed user: Dicer maps `handRollTypes` when
 *   set; else, when no die is on `dicer` yet, every die of HAND_DICE plus default (otherwise the
 *   dice already on `dicer`, the user's and Dicer's own, are the choice and nothing is added).
 *   Only where no other method holds the die, except required: it takes a die from another
 *   method too (never default), stashing it, and maps every die (or `handRollTypes`).
 * - Another interactive method than manual holds its dice: Dicer never maps those (required
 *   included), nor anything automatically when it holds `default`. One that has no resolver of
 *   its own (Pixels) lives next to Dicer's (shell.js patchResolverChoice hands the roll to the
 *   DicerResolver, which gives its dice Foundry's form). One with its own resolver cannot (Foundry
 *   would use its generic one, H-17, one warning): then, and for a user who may not roll by hand,
 *   every `dicer` entry goes, the user's too.
 * Writes only on a change; the stash and the record are written (and awaited) before the
 * configuration, so a failed write never loses the entries they hold.
 */
export async function syncConfig({ getSetting, user, getCore, setCore, setSetting }) {
  patchResolverChoice();
  const was = getCore() ?? {};
  const stash = { ...getSetting('handRollStash') };
  const kept = { ...stash };
  const record = getSetting('handRollMapped') ?? [];
  // A stashed die is one Dicer took (and wrote) under required.
  const ours = new Set([...record, ...Object.keys(stash)]);
  const req = getSetting('handRollsRequired') === true;
  const methods = globalThis.CONFIG?.Dice?.fulfillment?.methods ?? {};
  const interactive = (m) => m && m !== 'manual' && m !== 'dicer' && methods[m]?.interactive;
  // Dice another interactive method holds (Pixels on d20, say): never Dicer's.
  const held = new Set(Object.keys(was).filter((k) => interactive(was[k])));
  const other = Object.values(was).some((m) => interactive(m) && methods[m].resolver);
  if (other && !warnedOther) {
    warnedOther = !console.warn(
      'dicer: another interactive dice method is configured; rolling by hand stays off',
    );
  }
  const usable = !other && handAllowed(user, getSetting);
  const onDicer = Object.keys(was).filter((k) => was[k] === 'dicer');
  const out = {};
  for (const k in was) if (was[k] !== 'dicer' || (usable && !ours.has(k))) out[k] = was[k];
  for (const k in stash) if (!out[k]) out[k] = stash[k];
  for (const k in stash) delete stash[k];
  const mapped = [];
  if (usable && diceOnDicer(getSetting)) {
    const chosen = getSetting('handRollTypes');
    const types = chosen?.length
      ? chosen
      : req || !onDicer.length
        ? [...HAND_DICE, 'default']
        : onDicer.filter((k) => ours.has(k));
    for (const k of held.has('default') && !chosen?.length ? [] : types) {
      if (out[k] === 'dicer' || held.has(k)) continue; // the user's own pick, or another method's die
      if (out[k] && req && k !== 'default') stash[k] = out[k];
      if (!out[k] || stash[k]) {
        out[k] = 'dicer';
        mapped.push(k);
      }
    }
  }
  if (differ(stash, kept)) await setSetting?.('handRollStash', stash);
  if (mapped.length !== record.length || mapped.some((k) => !record.includes(k))) {
    await setSetting?.('handRollMapped', mapped);
  }
  if (differ(out, was)) await setCore(out);
}
