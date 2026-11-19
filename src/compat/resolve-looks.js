/**
 * Decides what each die looks like. The first matching rule wins, per term:
 *   1. term.options.appearance   2. term.options.colorset
 *   3. the damage theme of the term's damage type (P4-D3; also sets soundMaterial)
 *   3b. the term's flavor as a colorset name (only with no damage theme: a [fire] damage die is themed)
 *   4. the actor's dicer.appearance (options.dsnActorId, else the speaker's actor)   5. the roller's dicer.appearance
 *      (role:<role> when the message has one, die type, base shape, then global)
 *   6. DEFAULT_APPEARANCE.
 * Refs at steps 4-5 may name a theme (Plan 5): built-in, the world's (worldThemes) or the
 * roller's own (user flag dicer.themes). The theme gives the die type's look, its id (themeId)
 * and its sound material when no damage theme set one. A missing theme warns once per roller.
 * The GM's world default theme (worldDefaultTheme) is the fallback after the roller's own refs
 * and before DEFAULT_APPEARANCE; with lockPlayerLooks on, a non-GM roller's refs and actor flags
 * are skipped and the world default is used instead (P7-D4).
 * A registered preset for the ref's system replaces rules 5-6 (its colorset) and attaches its
 * model. Everything read here is third-party data: no step may throw.
 */
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../look/appearance.js';
import {
  isPlainObject,
  isNeverChose,
  readUserLooks,
  lookRefToAppearance,
  colorsetNameToAppearance,
} from './user-looks.js';
import { readThemeList } from '../themes/themes.js';
import { roleOf } from '../effects/roll-context.js';
import { dsnTypeOf } from '../core/dice-shapes.js';

const STANDARD = 'standard';
const FALLBACK_REF = { look: 'default' }; // what readUserLooks supplies when a user has no global

/**
 * The Dice So Nice die type of a term: 'd20', or 'd' + the bare-letter DENOMINATION of a custom
 * die ('c' gives 'dc', 'f' gives 'df'), which is how DSN presets name them.
 */

const systemOf = (v) => (isPlainObject(v) && typeof v.system === 'string' && v.system ? v.system : null);

/**
 * @param {object} deps
 * @param {object} deps.registry
 * @param {(id: string) => object | undefined} deps.getUser
 * @param {(id: string) => object | undefined} [deps.getActor]
 * @param {(preset: object) => object | undefined} [deps.facesFor] the Task 5 seam: a preset's FaceSet
 * @param {(roll: object, authorId?: string) => (((term, index: number) => object | null) | null)} [deps.damageThemeFor]
 *   a roll's damage themer (createDamageThemer.forRoll); null when damagePresets is off
 * @param {() => unknown} [deps.getWorldThemes] the raw worldThemes setting
 * @param {() => string} [deps.getWorldDefaultTheme] the worldDefaultTheme setting ('' = none)
 * @param {() => boolean} [deps.getLockPlayerLooks] the lockPlayerLooks setting
 * @param {() => boolean} [deps.damageOverDiceSet] the damageOverDiceSet setting: a damage-themed die
 *   drops the player's dice set (its models and faces); false keeps them
 * @param {(msg: string, err?: unknown) => void} [deps.warn]
 */
export function createLookResolver({
  registry,
  getUser,
  getActor = () => undefined,
  facesFor = () => undefined,
  damageThemeFor = null,
  getWorldThemes = () => [],
  getWorldDefaultTheme = () => '',
  getLockPlayerLooks = () => false,
  damageOverDiceSet = () => true,
  warn = console.warn,
}) {
  let warned = false;
  const warnOnce = (err) => {
    if (warned) return;
    warned = true;
    try {
      warn('dicer: cannot resolve a die look; using the default', err);
    } catch {
      /* a throwing logger must not reach the roll */
    }
  };

  const safeWarn = (msg) => {
    try {
      warn(msg);
    } catch {
      /* a throwing logger must not reach the roll */
    }
  };
  const missingWarned = new Set();
  /**
   * Per roll and author: the user, the theme lists their refs may name, and the once-per-roller
   * missing-theme warning.
   */
  function themeContext(authorId) {
    const user = getUser(authorId);
    let worldThemes = [];
    let userThemes = [];
    try {
      worldThemes = readThemeList(getWorldThemes(), 'world', safeWarn);
    } catch {
      /* no world themes */
    }
    try {
      const raw = typeof user?.getFlag === 'function' ? user.getFlag('dicer', 'themes') : user?.flags?.dicer?.themes;
      userThemes = readThemeList(raw, 'user', safeWarn);
    } catch {
      /* no user themes */
    }
    let worldDefault = null;
    let locked = false;
    try {
      const id = getWorldDefaultTheme();
      if (typeof id === 'string' && id) {
        worldDefault = { theme: id };
        locked = Boolean(getLockPlayerLooks()) && user?.isGM !== true;
      }
    } catch {
      /* no world default */
    }
    return {
      user,
      worldDefault,
      locked,
      themes: { worldThemes, userThemes },
      onMissingTheme: (themeId) => {
        const key = `${authorId}|${themeId}`;
        if (missingWarned.has(key)) return;
        missingWarned.add(key);
        safeWarn(`Dicer: theme "${themeId}" no longer exists; using the next look`);
      },
    };
  }

  /** A colorset from a preset (a name, or a list of names picked by index). */
  function presetAppearance(preset, index) {
    const cs = Array.isArray(preset.colorset)
      ? preset.colorset[((index % preset.colorset.length) + preset.colorset.length) % preset.colorset.length]
      : preset.colorset;
    return colorsetNameToAppearance(cs, registry, index);
  }

  function resolve(term, ctx, index, themeOf, role, speakerActorId) {
    const type = dsnTypeOf(term);
    const options = isPlainObject(term?.options) ? term.options : {};
    // The term's own actor, else the speaker's (showForRoll / animateRoll, which have no message).
    // A token-linked speaker names its base actor, whose flags getActor returns.
    const actorId = typeof options.dsnActorId === 'string' ? options.dsnActorId : speakerActorId;
    let appearance = null;
    let system = null;

    if (isPlainObject(options.appearance)) {
      appearance = normalizeAppearance(options.appearance);
      system = systemOf(options.appearance);
    }
    if (!appearance) {
      appearance = colorsetNameToAppearance(options.colorset, registry, index);
    }
    // The damage theme (P4-D3): after explicit colorsets, before actor/user looks. It also beats a
    // flavor colorset: PF2e and 5e flavor each damage die with its type ([fire]), which would
    // otherwise match the flat built-in colorset of that name.
    let soundMaterial;
    let themed = null; // the Plan 5 theme the die resolved to: {themeId, soundMaterial?, ...}
    const theme = appearance ? null : themeOf?.(term, index);
    if (theme?.appearance) {
      appearance = theme.appearance;
      soundMaterial = theme.soundMaterial;
      if (theme.themeId) themed = { themeId: theme.themeId, ...(theme.themeSource ? { themeSource: theme.themeSource } : {}) };
    }
    if (!appearance && typeof term?.flavor === 'string') {
      const flavor = term.flavor.trim();
      const named = flavor.toLowerCase().startsWith('die:') ? flavor.slice(4).trim() : flavor;
      appearance = colorsetNameToAppearance(named, registry, index);
    }
    const refOpts = { dieType: type, themes: ctx.themes, onMissingTheme: ctx.onMissingTheme };
    if (!appearance && !ctx.locked && typeof actorId === 'string') {
      // The theme browser writes {global: {theme}}; DSN-migrated flags are a flat LookRef. A
      // global slot takes precedence over flat keys left on the same actor.
      const stored = getActor(actorId)?.flags?.dicer?.appearance;
      const ref = isPlainObject(stored) && isPlainObject(stored.global) ? stored.global : stored;
      const got = lookRefToAppearance(ref, registry, index, refOpts);
      if (got) {
        appearance = got.appearance;
        themed = got;
        system = systemOf(ref);
      }
    }

    // The author's refs, most specific first. They feed rule 5 and, for every rule, the system.
    // Under the lock the world default replaces every ref of the author's; otherwise it follows
    // them, ahead of the built-in default that readUserLooks supplies for a user with no global.
    const looks = ctx.locked ? {} : readUserLooks(ctx.user, { fill: false });
    // A mirrored "never chose" default is no choice: the world default may apply.
    if (isNeverChose(looks.global)) delete looks.global;
    const shape = type ? registry.baseShape?.(type) : null;
    const keys = [role ? `role:${role}` : null, type, shape, 'global'];
    const refs = keys.map((key) => (key && Object.hasOwn(looks, key) ? looks[key] : null)).filter(Boolean);
    if (ctx.worldDefault) refs.push(ctx.worldDefault);
    if (!ctx.locked && !Object.hasOwn(looks, 'global')) refs.push(FALLBACK_REF);

    // damageOverDiceSet: a damage-themed die keeps its damage look, so the player's dice set (a
    // module set's 3D models and faces, whose own material would hide it) is not taken from their
    // refs. A system the roll names itself (options.appearance) still applies.
    const damageWins = !!theme?.appearance && damageOverDiceSet() !== false;
    if (system === null && !damageWins) system = refs.map(systemOf).find(Boolean) ?? null;

    const preset = type ? registry.presetFor?.(system ?? STANDARD, type) : null;
    if (!appearance) {
      // Rules 5-6: the preset's colorset replaces the author's look, then the default.
      const fromPreset = preset?.colorset ? presetAppearance(preset, index) : null;
      if (fromPreset) appearance = fromPreset;
      else {
        for (const ref of refs) {
          themed = lookRefToAppearance(ref, registry, index, refOpts);
          if (themed) break;
        }
        appearance = themed?.appearance ?? DEFAULT_APPEARANCE;
      }
    }

    const out = { appearance };
    if (type) out.dsnType = type;
    // DiceBox finds the preset again by system + dsnType (diceSoNiceOnMaterialReady, P3-R3).
    out.system = preset?.system ?? system ?? STANDARD;
    if (themed?.themeId) out.themeId = themed.themeId;
    if (themed?.themeId && themed.themeSource) out.themeSource = themed.themeSource;
    soundMaterial ??= themed?.soundMaterial;
    if (soundMaterial) out.soundMaterial = soundMaterial;
    if (preset) {
      // A bad preset loses its faces (the dice show numbers), never the look.
      let faces;
      try {
        faces = facesFor(preset);
      } catch (err) {
        warnOnce(err);
      }
      if (faces !== undefined) out.faces = faces;
      // A d100 preset dresses its tens die; the ones die wears the system's d10 (throw-planner).
      if (type === 'd100') {
        try {
          const ones = registry.presetFor?.(out.system, 'd10');
          const onesFaces = ones ? facesFor(ones) : undefined;
          if (onesFaces !== undefined) out.onesFaces = onesFaces;
        } catch (err) {
          warnOnce(err);
        }
      }
      // The routed url (registry routeUrl): the one the registry and DiceBox both load.
      if (preset.modelFile) out.model = preset.modelUrl ?? preset.modelFile;
    }
    return out;
  }

  return {
    /** @returns {(term, result, termIndex) => object} a decorator for planThrow */
    decorate(message, roll, authorId, speaker = null) {
      const author = authorId ?? message?.author?.id;
      const speakerActorId = typeof speaker?.actor === 'string' ? speaker.actor : undefined;
      let role = null;
      try {
        role = roleOf(message); // null on the showForRoll path (no message)
      } catch {
        /* no role */
      }
      let themeOf = null;
      try {
        themeOf = damageThemeFor?.(roll, author) ?? null;
      } catch (err) {
        warnOnce(err);
      }
      let ctx = null; // read on the first die, so a throwing user lookup fails per die
      return (term, result, termIndex = 0) => {
        try {
          ctx ??= themeContext(author);
          return resolve(term, ctx, termIndex, themeOf, role, speakerActorId);
        } catch (err) {
          warnOnce(err);
          return { appearance: DEFAULT_APPEARANCE };
        }
      };
    },

    /** The base shape of the term's die type, or null (d100 and unknown shapes are not handled here). */
    shapeFor(term) {
      try {
        const type = dsnTypeOf(term);
        return type ? registry.baseShape(type) : null;
      } catch {
        return null;
      }
    },
  };
}
