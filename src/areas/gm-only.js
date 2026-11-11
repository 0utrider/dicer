/**
 * The one rule for "only GMs can see this roll" (P5-D7, P5-R7): a secret or blind roll, or one
 * whispered to GMs only. The GM private corner uses it (the resolver also requires a real view,
 * a GM client and the setting).
 *
 * @param {object} roll
 * @param {boolean} [roll.blind]
 * @param {boolean} [roll.secret]
 * @param {Array<string|{id?: string}>|null} [roll.recipients] the whisper list; null/empty = everyone
 * @param {(id: string) => boolean} roll.isGm
 */
export function isGmOnly({ blind = false, secret = false, recipients = null, isGm }) {
  if (blind || secret) return true;
  const list = Array.isArray(recipients) ? recipients : [];
  return list.length > 0 && list.every((r) => isGm(typeof r === 'string' ? r : r?.id));
}
