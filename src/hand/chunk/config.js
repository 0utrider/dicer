/**
 * The core diceConfiguration sync's body (lazy hand chunk; the world-start gate is
 * ../shell.js syncDiceConfiguration, which loads this only when there is something to do).
 */
import { HAND_DICE, handAllowed } from '../shell.js';

const differ = (a, b) => {
  const keys = Object.keys(a);
  return keys.length !== Object.keys(b).length || keys.some((k) => a[k] !== b[k]);
};
let warnedOther = false;

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
 * - A user who may not roll by hand, or another interactive method than manual (Foundry would
 *   then use its generic resolver, H-17, one warning): every `dicer` entry goes, the user's too.
 * Writes only on a change; the stash and the record are written (and awaited) before the
 * configuration, so a failed write never loses the entries they hold.
 */
export async function syncConfig({ getSetting, user, getCore, setCore, setSetting }) {
  const was = getCore() ?? {};
  const stash = { ...getSetting('handRollStash') };
  const kept = { ...stash };
  const record = getSetting('handRollMapped') ?? [];
  // A stashed die is one Dicer took (and wrote) under required.
  const ours = new Set([...record, ...Object.keys(stash)]);
  const req = getSetting('handRollsRequired') === true;
  const other = Object.values(was).some(
    (m) => m && m !== 'manual' && globalThis.CONFIG?.Dice?.fulfillment?.methods?.[m]?.interactive,
  );
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
  if (usable && (req || getSetting('handRolls') !== 'off')) {
    const chosen = getSetting('handRollTypes');
    const types = chosen?.length
      ? chosen
      : req || !onDicer.length
        ? [...HAND_DICE, 'default']
        : onDicer.filter((k) => ours.has(k));
    for (const k of types) {
      if (out[k] === 'dicer') continue; // the user's own pick
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
