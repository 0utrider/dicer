/**
 * The trigger editor (lazy chunk, opened from the `dicer.triggerEditor` settings menu).
 * World tab: the GM's `worldTriggers` plus the module rules (can be switched off, not edited).
 * Mine tab: the user's own `dicer.triggers` flag. All rule <-> form logic is in ./trigger-form.js.
 */
import { EFFECTS } from '../effects/library/effects.js';
import { DEFAULT_RULES, normalizeRule } from '../effects/rules.js';
import { RESULT_SOUNDS } from '../audio/sound-names.js';
import {
  blankEntry,
  entriesOf,
  entryFromRule,
  formFromRules,
  loadEntries,
  rawRuleFromEntry,
  rulesFromForm,
  saveTab,
  validateForm,
} from './trigger-form.js';

export { formFromRules, rulesFromForm, validateForm, saveTab, loadEntries };

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE = 'dicer';
const STANDARD_DICE = ['d2', 'd3', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
const OUTCOMES = ['any', 'critical-success', 'success', 'failure', 'critical-failure'];
const RESULT_KINDS = ['any', 'value', 'range', 'max', 'min'];
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const humanize = (id) => {
  const s = String(id).replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** What the registry offers (module rules, trigger ids, SFX modes, dice types), if the engine runs. */
function registryContext() {
  try {
    return (
      globalThis.game?.dice3d?._triggerContext?.() ?? {
        moduleRules: [],
        triggers: [],
        modes: {},
        diceTypes: [],
      }
    );
  } catch {
    return { moduleRules: [], triggers: [], modes: {}, diceTypes: [] };
  }
}

/** Choice maps ({value: label}) for the selects. */
export function buildChoices(ctx) {
  const dice = { any: loc('DICER.Triggers.AnyDie') };
  for (const t of STANDARD_DICE) dice[t] = t;
  for (const t of ctx.diceTypes ?? []) if (!(t in dice)) dice[t] = t;
  for (const t of ctx.triggers ?? []) dice[t.id] = `${t.name} (${t.id})`;
  const effects = { '': loc('DICER.Triggers.NoEffect') };
  for (const id of Object.keys(EFFECTS)) effects[id] = humanize(id);
  for (const [id, name] of Object.entries(ctx.modes ?? {})) effects[`dsn:${id}`] = `${name} (DSN)`;
  const sounds = Object.fromEntries(RESULT_SOUNDS.map((s) => [s, humanize(s)]));
  return { dice, effects, sounds };
}

/** The die type and face a preview should throw for a rule. */
export function previewTarget(rule) {
  const type = STANDARD_DICE.includes(rule.die) ? rule.die : 'd20';
  const r = rule.result;
  let value;
  if (r.kind === 'value') value = r.value;
  else if (r.kind === 'range') value = r.to;
  else if (r.kind === 'min') value = 1;
  return { type, value };
}

const basename = (path) => String(path ?? '').split(/[\\/]/).pop();

/**
 * The one-line summary of a rule in the list: "d20 · 20 → Light burst + Fanfare".
 * @param {object} e a form entry
 * @param {{dice?: object, effects?: object, kinds?: object, outcomes?: object, sounds?: object}} labels choice maps
 */
export function ruleSummary(e, { dice = {}, effects = {}, kinds = {}, outcomes = {}, sounds = {} } = {}) {
  const when = [];
  when.push(dice[e.die] ?? e.die ?? '');
  const kind = e.resultKind;
  if (kind === 'value' && String(e.resultValue ?? '') !== '') when.push(String(e.resultValue));
  else if (kind === 'range') when.push(`${e.resultFrom ?? ''}–${e.resultTo ?? ''}`);
  else if (kind === 'label' && e.resultLabel) when.push(`“${e.resultLabel}”`);
  else if (kind && kind !== 'any' && kinds[kind]) when.push(kinds[kind]);
  if (e.outcome && e.outcome !== 'any') when.push(outcomes[e.outcome] ?? e.outcome);
  for (const k of ['role', 'damageType']) if (e[k]) when.push(String(e[k]));
  const then = [];
  if (e.effectId) then.push(effects[e.effectId] ?? humanize(e.effectId));
  if (e.soundKind === 'builtin' && e.soundBuiltin) then.push(sounds[e.soundBuiltin] ?? humanize(e.soundBuiltin));
  if (e.soundKind === 'file' && e.soundSrc) then.push(basename(e.soundSrc));
  if (e.macro) then.push(loc('DICER.Triggers.MacroShort'));
  return `${when.filter(Boolean).join(' · ')} → ${then.join(' + ') || '—'}`;
}

/** The selected index kept inside the list (null for an empty list). */
export function clampIndex(index, length) {
  if (!length) return null;
  const i = Number.isInteger(index) ? index : 0;
  return Math.max(0, Math.min(length - 1, i));
}

let instance = null;

export class TriggerEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'dicer-trigger-editor',
    tag: 'form',
    classes: ['dicer-trigger-editor'],
    window: { title: 'DICER.Triggers.Title', icon: 'fa-solid fa-bolt', resizable: true },
    position: { width: 940, height: 640 },
    form: {
      handler: TriggerEditor.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: false,
    },
    actions: {
      switchTab: TriggerEditor.#onTab,
      selectRule: TriggerEditor.#onSelectRule,
      add: TriggerEditor.#onAdd,
      duplicate: TriggerEditor.#onDuplicate,
      delete: TriggerEditor.#onDelete,
      up: TriggerEditor.#onUp,
      down: TriggerEditor.#onDown,
      preview: TriggerEditor.#onPreview,
      reset: TriggerEditor.#onReset,
      pickFile: TriggerEditor.#onPickFile,
    },
  };

  static PARTS = {
    form: {
      template: 'modules/dicer/templates/trigger-editor.hbs',
      scrollable: ['.dicer-rule-list', '.dicer-rule-editors'],
    },
  };

  #tab = 'mine';
  #selected = { world: 0, mine: 0 }; // the rule shown in the editor pane, per tab
  #drafts = null; // { world: Entry[], mine: Entry[] }
  #errors = { world: new Map(), mine: new Map() };
  #moduleRules = [];
  #ctx = null;

  get #isGM() {
    return Boolean(globalThis.game?.user?.isGM);
  }

  /** The tab is editable by this user: Mine always, World for a GM. */
  get #canEdit() {
    return this.#tab === 'mine' || this.#isGM;
  }

  #load() {
    if (this.#drafts) return;
    this.#ctx = registryContext();
    this.#moduleRules = this.#ctx.moduleRules ?? [];
    const settings = globalThis.game.settings;
    const world = loadEntries(settings.get(MODULE, 'worldTriggers'), 'world');
    const off = settings.get(MODULE, 'disabledModuleTriggers');
    const disabled = new Set(Array.isArray(off) ? off : []);
    const mods = this.#moduleRules.map((r) => ({ ...r, enabled: !disabled.has(r.id) }));
    const mine = loadEntries(globalThis.game.user.getFlag(MODULE, 'triggers'), 'user');
    this.#drafts = {
      world: [...world.entries, ...formFromRules(mods).rules],
      mine: mine.entries,
    };
    // Unreadable stored rules are kept (as highlighted rows), never dropped by a save.
    if (world.unreadable + mine.unreadable > 0)
      globalThis.ui?.notifications?.warn(loc('DICER.Triggers.Unreadable'));
    this.#tab = this.#isGM ? 'world' : 'mine';
  }

  /** Reads the visible form into the current tab's draft (module entries keep their other fields). */
  #collect(object) {
    if (!this.#drafts || !this.#canEdit) return;
    let data = object;
    if (!data) {
      const fd = new foundry.applications.ux.FormDataExtended(this.element);
      data = fd.object;
    }
    const expanded = foundry.utils.expandObject(data);
    const prev = this.#drafts[this.#tab];
    this.#drafts[this.#tab] = entriesOf(expanded).map((e, i) => {
      const base = prev.find((p) => p.id === e.id) ?? prev[i] ?? {};
      const enabled = e.enabled === true || e.enabled === 'true' || e.enabled === 'on';
      return base.source === 'module' || base.source === 'raw'
        ? { ...base, enabled }
        : { ...base, ...e, enabled };
    });
  }

  async _prepareContext() {
    this.#load();
    const choices = buildChoices(this.#ctx);
    const triggers = new Map((this.#ctx.triggers ?? []).map((t) => [t.id, t]));
    const canEdit = this.#canEdit;
    const errors = this.#errors[this.#tab];
    const options = (map, current) => {
      const out = { ...map };
      if (current !== '' && current !== undefined && !(current in out)) out[current] = String(current);
      return out;
    };
    const list = this.#drafts[this.#tab];
    const selected = clampIndex(this.#selected[this.#tab], list.length);
    this.#selected[this.#tab] = selected ?? 0;
    const outcomeChoices = Object.fromEntries(OUTCOMES.map((o) => [o, loc(`DICER.Triggers.Outcomes.${o}`)]));
    const allKinds = Object.fromEntries([...RESULT_KINDS, 'label'].map((k) => [k, loc(`DICER.Triggers.ResultKinds.${k}`)]));
    const dieLabels = { ...choices.dice };
    for (const t of this.#ctx.triggers ?? []) dieLabels[t.id] = t.name;
    const summaryLabels = { dice: dieLabels, effects: choices.effects, kinds: allKinds, outcomes: outcomeChoices, sounds: choices.sounds };
    const rules = list.map((e, index) => {
      const isModule = e.source === 'module';
      const isRaw = e.source === 'raw';
      const trigger = triggers.get(e.die);
      const labels = trigger?.results ?? [];
      const kinds = {};
      for (const k of [...RESULT_KINDS, ...(trigger || e.resultKind === 'label' ? ['label'] : [])])
        kinds[k] = loc(`DICER.Triggers.ResultKinds.${k}`);
      const readonly = isModule || isRaw || !canEdit;
      const defaults = EFFECTS[e.effectId]?.defaults ?? {};
      const error = isRaw ? loc('DICER.Triggers.UnreadableRule') : (errors.get(index) ?? '');
      return {
        ...e,
        index,
        selected: index === selected,
        displayName: e.name || (isRaw ? loc('DICER.Triggers.UnreadableShort') : loc('DICER.Triggers.Untitled')),
        summary: isRaw ? loc('DICER.Triggers.UnreadableShort') : ruleSummary(e, summaryLabels),
        hasError: Boolean(error),
        colorPlaceholder: defaults.color ?? '#ffffff',
        intensityPlaceholder: defaults.intensity ?? 1,
        durationPlaceholder: defaults.duration ?? 1000,
        soundFileName: basename(e.soundSrc),
        isModule,
        isRaw,
        readonly,
        canDelete: isRaw && canEdit,
        enabledLocked: !canEdit,
        error,
        dieChoices: options(choices.dice, e.die),
        kindChoices: kinds,
        labelChoices: labels.length ? options(Object.fromEntries(labels.map((l) => [l, l])), e.resultLabel) : null,
        outcomeChoices,
        effectChoices: options(choices.effects, e.effectId),
        soundKindChoices: {
          none: loc('DICER.Triggers.Sound.none'),
          builtin: loc('DICER.Triggers.Sound.builtin'),
          file: loc('DICER.Triggers.Sound.file'),
        },
        soundChoices: options(choices.sounds, e.soundBuiltin),
        showValue: e.resultKind === 'value',
        showRange: e.resultKind === 'range',
        showLabel: e.resultKind === 'label',
        soundIsBuiltin: e.soundKind === 'builtin',
        soundIsFile: e.soundKind === 'file',
        hasEffect: Boolean(e.effectId),
        hasContext: Boolean(e.formula || e.role || e.damageType || e.actorId || e.userId),
        canMoveUp: !readonly && index > 0 && list[index - 1].source !== 'module',
        canMoveDown: !readonly && index < list.length - 1 && list[index + 1].source !== 'module',
      };
    });
    const current = selected === null ? null : rules[selected];
    return {
      isGM: this.#isGM,
      canEdit,
      tab: this.#tab,
      tabs: [
        { id: 'world', label: loc('DICER.Triggers.World'), active: this.#tab === 'world' },
        { id: 'mine', label: loc('DICER.Triggers.Mine'), active: this.#tab === 'mine' },
      ],
      isWorld: this.#tab === 'world',
      readonlyNote: !canEdit,
      rules,
      hasRules: rules.length > 0,
      current,
      canMove: Boolean(current && !current.readonly),
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    for (const el of root.querySelectorAll('[data-refresh]')) {
      el.addEventListener('change', () => {
        this.#collect();
        this.render();
      });
    }
    for (const input of root.querySelectorAll('input[data-macro]')) {
      input.addEventListener('drop', (event) => {
        try {
          const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
          if (data?.type === 'Macro' && typeof data.uuid === 'string') {
            event.preventDefault();
            input.value = data.uuid;
          }
        } catch {
          /* not a Foundry drag */
        }
      });
    }
    for (const swatch of root.querySelectorAll('input[type="color"][data-color-for]')) {
      const text = root.querySelector(`input[name="${swatch.dataset.colorFor}"]`);
      if (!text) continue;
      swatch.addEventListener('input', () => (text.value = swatch.value));
      text.addEventListener('input', () => {
        if (/^#[0-9a-f]{6}$/i.test(text.value.trim())) swatch.value = text.value.trim();
      });
    }
  }

  /** The form's saved result: shows the first error, highlights the rules, or confirms. */
  async #save(object) {
    this.#collect(object);
    const tab = this.#tab;
    const g = globalThis.game;
    const res = await saveTab(
      tab,
      { rules: this.#drafts[tab] },
      {
        isGM: this.#isGM,
        moduleRules: this.#moduleRules,
        setWorld: (rules) => g.settings.set(MODULE, 'worldTriggers', rules),
        setDisabled: (ids) => g.settings.set(MODULE, 'disabledModuleTriggers', ids),
        setMine: (rules) => g.user.setFlag(MODULE, 'triggers', rules),
      },
    );
    this.#errors[tab] = new Map((res.errors ?? []).map((e) => [e.index, e.message]));
    if (res.errors?.length) this.#selected[tab] = res.errors[0].index; // show the first invalid rule
    if (res.ok) {
      globalThis.ui?.notifications?.info(loc('DICER.Triggers.Saved'));
    } else if (res.reason === 'not-gm') {
      globalThis.ui?.notifications?.error(loc('DICER.Triggers.NotGM'));
    } else {
      globalThis.ui?.notifications?.error(
        `${loc('DICER.Triggers.Invalid')}: ${res.errors.map((e) => e.message).join('; ')}`,
      );
    }
    await this.render();
  }

  static async #onSubmit(event, form, formData) {
    event.preventDefault?.();
    await this.#save(formData?.object);
  }

  static async #onTab(event, target) {
    this.#collect();
    this.#tab = target.dataset.tab === 'world' ? 'world' : 'mine';
    await this.render();
  }

  static async #onSelectRule(event, target) {
    const i = Number(target.dataset.index);
    if (!Number.isInteger(i) || i === this.#selected[this.#tab]) {
      // A click on the enable toggle of the shown rule: keep the draft in step, nothing to re-render.
      this.#collect();
      return;
    }
    this.#collect();
    this.#selected[this.#tab] = i;
    await this.render();
  }

  #insertAt() {
    const list = this.#drafts[this.#tab];
    const firstModule = list.findIndex((e) => e.source === 'module');
    return firstModule < 0 ? list.length : firstModule;
  }

  #newId() {
    return `rule-${foundry.utils.randomID?.() ?? Math.random().toString(36).slice(2, 10)}`;
  }

  static async #onAdd() {
    if (!this.#canEdit) return;
    this.#collect();
    const e = blankEntry(this.#newId(), this.#tab === 'world' ? 'world' : 'user');
    e.name = loc('DICER.Triggers.NewRule');
    e.effectId = 'light-burst';
    const at = this.#insertAt();
    this.#drafts[this.#tab].splice(at, 0, e);
    this.#selected[this.#tab] = at;
    this.#errors[this.#tab].clear();
    await this.render();
  }

  static async #onDuplicate(event, target) {
    if (!this.#canEdit) return;
    this.#collect();
    const list = this.#drafts[this.#tab];
    const i = Number(target.dataset.index);
    if (!list[i] || list[i].source === 'module' || list[i].source === 'raw') return;
    const copy = { ...list[i], id: this.#newId(), name: `${list[i].name} ${loc('DICER.Triggers.Copy')}`.trim() };
    list.splice(i + 1, 0, copy);
    this.#selected[this.#tab] = i + 1;
    this.#errors[this.#tab].clear();
    await this.render();
  }

  static async #onDelete(event, target) {
    if (!this.#canEdit) return;
    this.#collect();
    const list = this.#drafts[this.#tab];
    const i = Number(target.dataset.index);
    if (!list[i] || list[i].source === 'module') return;
    list.splice(i, 1);
    this.#selected[this.#tab] = clampIndex(i, list.length) ?? 0;
    this.#errors[this.#tab].clear();
    await this.render();
  }

  async #move(target, delta) {
    if (!this.#canEdit) return;
    this.#collect();
    const list = this.#drafts[this.#tab];
    const i = Number(target.dataset.index);
    const j = i + delta;
    if (!list[i] || !list[j] || list[i].source === 'module' || list[j].source === 'module') return;
    [list[i], list[j]] = [list[j], list[i]];
    this.#selected[this.#tab] = j;
    this.#errors[this.#tab].clear();
    await this.render();
  }

  static async #onUp(event, target) {
    await this.#move(target, -1);
  }

  static async #onDown(event, target) {
    await this.#move(target, 1);
  }

  /** Plays the rule's effect and sound on a local test die. Nothing is broadcast. */
  static async #onPreview(event, target) {
    this.#collect();
    const entry = this.#drafts[this.#tab][Number(target.dataset.index)];
    if (!entry) return;
    let message = null;
    const source = entry.source === 'module' ? 'module' : this.#tab === 'world' ? 'world' : 'user';
    const rule =
      entry.source === 'module'
        ? this.#moduleRules.find((r) => r.id === entry.id)
        : normalizeRule(rawRuleFromEntry(entry), source, (m) => (message = m));
    if (!rule) {
      globalThis.ui?.notifications?.error(`${loc('DICER.Triggers.Invalid')}: ${message ?? ''}`);
      return;
    }
    const api = globalThis.game?.dice3d;
    if (typeof api?._preview !== 'function') {
      globalThis.ui?.notifications?.warn(loc('DICER.Triggers.PreviewUnavailable'));
      return;
    }
    const { type, value } = previewTarget(rule);
    await api._preview(
      {
        ruleId: rule.id,
        effect: rule.effect,
        sound: rule.sound,
        macro: null,
        slowMotion: false,
        value,
        type,
      },
      { type, value },
    );
  }

  static async #onReset() {
    if (this.#tab !== 'world' || !this.#isGM) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc('DICER.Triggers.Reset') },
      content: `<p>${loc('DICER.Triggers.ResetConfirm')}</p>`,
    });
    if (!ok) return;
    this.#collect();
    const mods = this.#drafts.world.filter((e) => e.source === 'module');
    this.#drafts.world = [...DEFAULT_RULES.map((r) => entryFromRule(structuredClone(r))), ...mods];
    this.#errors.world.clear();
    await this.render();
  }

  static #onPickFile(event, target) {
    const input = this.element.querySelector(`input[name="rules.${target.dataset.index}.soundSrc"]`);
    if (!input) return;
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    new FilePicker({
      type: 'audio',
      current: input.value,
      callback: (path) => {
        input.value = path;
      },
    }).render(true);
  }

  async close(options) {
    if (instance === this) instance = null;
    return super.close(options);
  }
}

/** Opens (or brings to front) the editor: what the settings menu's proxy class calls. */
export function openTriggerEditor() {
  instance ??= new TriggerEditor();
  return instance.render({ force: true });
}
