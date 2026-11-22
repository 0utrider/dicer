/**
 * The tray picker (issue #5, a lazy chunk): when another module's dice tray is on (other-trays.js),
 * Dicer's chat dice bar stays hidden, and each user is asked once per Dicer version, unless they
 * ticked "Don't show this again", which one they want. "Use Dicer's chat dice bar" turns the
 * others off; "Keep X" turns Dicer's off. Nothing changes until a button is pressed. With Force
 * Client Settings active, the GM can apply the choice to everyone, soft (a default players can
 * change) or hard (locked). main.js loads this at ready, only where one of the trays' modules is
 * active.
 */
import { activeOtherTrays } from './other-trays.js';

export const FLAG = 'trayPick'; // user flag: { seen: Dicer version asked at, never: true }
const FCS_ID = 'force-client-settings';

const loc = (k) => globalThis.game?.i18n?.localize?.(k) ?? k;
const fmt = (k, data) => globalThis.game?.i18n?.format?.(k, data) ?? k;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? '&#39;');

/** The trays to ask about, or null: Dicer's bar on, another tray on, and not asked at `version`. */
export function traysToAsk(game, version) {
  try {
    if (game.settings.get('dicer', 'chatTray') !== true) return null;
    const trays = activeOtherTrays(game);
    if (!trays.length) return null;
    const f = game.user?.getFlag?.('dicer', FLAG) ?? {};
    if (f.never || f.seen === version) return null;
    return trays;
  } catch {
    return null;
  }
}

/** Force Client Settings (its global class) for a GM where that module is active, else null. */
export function forcer(game, fcs) {
  if (!game?.user?.isGM || !game.modules?.get?.(FCS_ID)?.active) return null;
  // A classic script's top-level class: a global binding, not a property of globalThis.
  // eslint-disable-next-line no-undef
  const found = fcs ?? (typeof ForceClientSettings === 'undefined' ? null : ForceClientSettings);
  return typeof found?.forceSetting === 'function' ? found : null;
}

/**
 * Applies a pick: 'dicer' turns Dicer's bar on and every tray in `trays` off; a tray's id turns
 * Dicer's bar off and leaves the others alone. `mode` 'soft' or 'hard' (a GM with Force Client
 * Settings, `fcs`) then forces each changed setting for everyone. Returns true when a changed
 * setting needs a reload. A setting that fails is skipped with a warning.
 */
export async function applyPick(game, pick, trays, { mode = 'me', fcs = null } = {}) {
  const changes =
    pick === 'dicer'
      ? [['dicer', 'chatTray', true], ...trays.map((t) => [t.id, t.setting, false])]
      : [['dicer', 'chatTray', false]];
  for (const [ns, key, value] of changes) {
    try {
      await game.settings.set(ns, key, value);
      if (fcs && (mode === 'soft' || mode === 'hard')) await fcs.forceSetting(`${ns}.${key}`, mode);
    } catch (err) {
      console.warn(`dicer: cannot set ${ns}.${key}`, err);
    }
  }
  return pick === 'dicer' && trays.some((t) => t.reload);
}

/** The window's body: what happened, the GM's scope choice (Force Client Settings), the checkbox. */
export function pickContent(trays, canForce) {
  const names = trays.map((t) => `<strong>${esc(t.title)}</strong>`).join(', ');
  const scope = canForce
    ? `<div class="form-group"><label>${loc('DICER.TrayPick.Scope')}</label><select name="mode">` +
      ['me', 'soft', 'hard'].map((m) => `<option value="${m}">${loc(`DICER.TrayPick.Scope_${m}`)}</option>`).join('') +
      '</select></div>'
    : '';
  return (
    `<p>${fmt('DICER.TrayPick.Text', { names })}</p>${scope}` +
    `<label class="checkbox"><input type="checkbox" name="never"> ${loc('DICER.TrayPick.Never')}</label>`
  );
}

/** Asks this user which tray to keep, when traysToAsk says so (main.js, at ready). Never throws. */
export async function askTrayPick(game = globalThis.game) {
  try {
    const version = game.modules.get('dicer')?.version ?? '';
    const trays = traysToAsk(game, version);
    if (!trays) return;
    const fcs = forcer(game);
    const read = (_event, button) => ({
      pick: button.dataset.action,
      never: !!button.form?.elements?.never?.checked,
      mode: button.form?.elements?.mode?.value ?? 'me',
    });
    const buttons = [
      { action: 'dicer', label: loc('DICER.TrayPick.UseDicer'), icon: 'fa-solid fa-dice-d20', default: true, callback: read },
      ...trays.map((t) => ({ action: t.id, label: fmt('DICER.TrayPick.Keep', { name: t.title }), icon: 'fa-solid fa-check', callback: read })),
    ];
    const result = await globalThis.foundry.applications.api.DialogV2.wait({
      window: { title: loc('DICER.TrayPick.Title') },
      content: pickContent(trays, !!fcs),
      buttons,
      rejectClose: false,
    });
    await game.user.setFlag('dicer', FLAG, { seen: version, never: !!result?.never });
    if (!result?.pick) return;
    const mode = fcs ? result.mode : 'me';
    if (await applyPick(game, result.pick, trays, { mode, fcs })) {
      await globalThis.foundry.applications.settings?.SettingsConfig?.reloadConfirm?.({ world: mode !== 'me' });
    }
  } catch (err) {
    console.warn('dicer: cannot ask which dice tray to keep', err);
  }
}
