/**
 * Decides what each die looks like. The first matching rule wins, per term:
 *   1. term.options.appearance   2. term.options.colorset   3. the term's flavor
 *   4. the actor's dicer.appearance (options.dsnActorId)   5. the roller's dicer.appearance
 *      (die type, then global)   6. DEFAULT_APPEARANCE.
 * A registered preset for the ref's system replaces rules 5-6 (its colorset) and attaches its
 * model. Everything read here is third-party data: no step may throw.
 */
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../look/appearance.js';
import {
  isPlainObject,
  readUserLooks,
  lookRefToAppearance,
  colorsetNameToAppearance,
} from './user-looks.js';

const STANDARD = 'standard';

/**
 * The Dice So Nice die type of a term: 'd20', or 'd' + the bare-letter DENOMINATION of a custom
 * die ('c' gives 'dc', 'f' gives 'df'), which is how DSN presets name them.
 */
function dieTypeOf(term) {
  const denom = term?.constructor?.DENOMINATION;
  if (typeof denom === 'string' && denom && denom !== 'd') return `d${denom}`;
  return Number.isInteger(term?.faces) && term.faces > 0 ? `d${term.faces}` : null;
}

const systemOf = (v) => (isPlainObject(v) && typeof v.system === 'string' && v.system ? v.system : null);

/**
 * @param {object} deps
 * @param {object} deps.registry
 * @param {(id: string) => object | undefined} deps.getUser
 * @param {(id: string) => object | undefined} [deps.getActor]
 * @param {(preset: object) => object | undefined} [deps.facesFor] the Task 5 seam: a preset's FaceSet
 * @param {(msg: string, err?: unknown) => void} [deps.warn]
 */
export function createLookResolver({
  registry,
  getUser,
  getActor = () => undefined,
  facesFor = () => undefined,
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

  /** A colorset from a preset (a name, or a list of names picked by index). */
  function presetAppearance(preset, index) {
    const cs = Array.isArray(preset.colorset)
      ? preset.colorset[((index % preset.colorset.length) + preset.colorset.length) % preset.colorset.length]
      : preset.colorset;
    return colorsetNameToAppearance(cs, registry, index);
  }

  function resolve(term, authorId, index) {
    const type = dieTypeOf(term);
    const options = isPlainObject(term?.options) ? term.options : {};
    let appearance = null;
    let system = null;

    if (isPlainObject(options.appearance)) {
      appearance = normalizeAppearance(options.appearance);
      system = systemOf(options.appearance);
    }
    if (!appearance) {
      appearance = colorsetNameToAppearance(options.colorset, registry, index);
    }
    if (!appearance && typeof term?.flavor === 'string') {
      const flavor = term.flavor.trim();
      const named = flavor.toLowerCase().startsWith('die:') ? flavor.slice(4).trim() : flavor;
      appearance = colorsetNameToAppearance(named, registry, index);
    }
    if (!appearance && typeof options.dsnActorId === 'string') {
      const ref = getActor(options.dsnActorId)?.flags?.dicer?.appearance;
      appearance = lookRefToAppearance(ref, registry, index);
      if (appearance) system = systemOf(ref);
    }

    // The author's refs, most specific first. They feed rule 5 and, for every rule, the system.
    const looks = readUserLooks(getUser(authorId));
    const shape = type ? registry.baseShape?.(type) : null;
    const refs = [type, shape, 'global'].map((key) => (key ? looks[key] : null)).filter(Boolean);

    if (system === null) system = refs.map(systemOf).find(Boolean) ?? null;

    const preset = type ? registry.presetFor?.(system ?? STANDARD, type) : null;
    if (!appearance) {
      // Rules 5-6: the preset's colorset replaces the author's look, then the default.
      const authorRef = refs.find((ref) => lookRefToAppearance(ref, registry, index));
      const fromPreset = preset?.colorset ? presetAppearance(preset, index) : null;
      appearance = fromPreset ?? lookRefToAppearance(authorRef, registry, index) ?? DEFAULT_APPEARANCE;
    }

    const out = { appearance };
    if (type) out.dsnType = type;
    if (preset) {
      const faces = facesFor(preset);
      if (faces !== undefined) out.faces = faces;
      if (preset.modelFile) out.model = preset.modelFile;
    }
    return out;
  }

  return {
    /** @returns {(term, result, termIndex) => object} a decorator for planThrow */
    decorate(message, roll, authorId) {
      const author = authorId ?? message?.author?.id;
      return (term, result, termIndex = 0) => {
        try {
          return resolve(term, author, termIndex);
        } catch (err) {
          warnOnce(err);
          return { appearance: DEFAULT_APPEARANCE };
        }
      };
    },

    /** The base shape of the term's die type, or null (d100 and unknown shapes are not handled here). */
    shapeFor(term) {
      try {
        const type = dieTypeOf(term);
        return type ? registry.baseShape(type) : null;
      } catch {
        return null;
      }
    },
  };
}
