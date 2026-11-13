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
 * Brings the core diceConfiguration in line with the hand settings. Dicer's entries are removed
 * (entries required took from another method come back from the `handRollStash` client setting),
 * then, when hand rolls are on (or required) and allowed, each chosen denomination (none: all of
 * HAND_DICE, plus default) is mapped to `dicer` where no other method holds it; required also
 * takes a denomination from another method (never default), stashing it. With another
 * interactive method than manual configured (Foundry would then use its generic resolver, H-17),
 * nothing is mapped (one warning). Writes only on a change; the stash is written (and awaited)
 * before the configuration, so a failed stash write never loses the entries it holds.
 */
export async function syncConfig({ getSetting, user, getCore, setCore, setSetting }) {
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
  if (other && !warnedOther) {
    warnedOther = !console.warn(
      'dicer: another interactive dice method is configured; rolling by hand stays off',
    );
  }
  if (!other && handAllowed(user, getSetting) && (req || getSetting('handRolls') !== 'off')) {
    const chosen = getSetting('handRollTypes');
    for (const k of chosen?.length ? chosen : [...HAND_DICE, 'default']) {
      if (out[k] && req && k !== 'default') stash[k] = out[k];
      if (!out[k] || stash[k]) out[k] = 'dicer';
    }
  }
  if (differ(stash, kept)) await setSetting?.('handRollStash', stash);
  if (differ(out, was)) await setCore(out);
}
