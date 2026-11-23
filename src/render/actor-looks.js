/**
 * The looks of the actors likely to roll, for the warm-up. A look that comes from an actor (its
 * dice flag, or a module's default provider: theme-registry.js) is not a user's look, so it was
 * compiled on the first frame of its first roll: a freeze of the whole canvas.
 *
 * Actors, in order: every user's character, the viewed scene's tokens (an unlinked token counts on
 * its own: its synthetic actor carries its own flags), then the other actors a player owns. The
 * author a look is resolved for is the user whose character it is, else the first player who owns
 * it, else a GM (the active one first): the user whose roll would most likely wear it (the
 * player-looks lock depends on the author).
 *
 * @param {object} o
 * @param {Iterable<{id: string, isGM?: boolean, character?: object}>} [o.users]
 * @param {Iterable<object>} [o.actors] the world's actors
 * @param {Iterable<object>} [o.tokens] the viewed scene's token documents
 * @param {(actor: object) => boolean} o.wants whether the actor's look can come from the actor
 * @param {(authorId: string, speaker: object, term: object) => object|null|undefined} o.lookOf
 * @param {object[]} [o.known] looks compiled anyway (the users' own): left out
 * @param {number} [o.limit] the most distinct looks returned: each is a compile on this screen, and
 *   a crowd sharing one look counts once (nothing more is resolved once it is reached)
 * @returns {object[]} distinct appearances
 */
import { WARMUP_TERMS } from './user-looks.js';
import { lookRefToAppearance } from '../compat/user-looks.js';
import { readThemeList } from '../themes/themes.js';
import { PROVIDERS, WARM_THEMES, flagChoice, providedTheme } from '../api/theme-registry.js';
import { dsnTypeOf } from '../core/dice-shapes.js';

/** The most actors resolved in one pass, whatever they look like (a scene of hundreds of tokens). */
const MAX_ACTORS = 300;

export function actorWarmupLooks({ users, actors, tokens, wants, lookOf, known = [], limit = 40 }) {
  const all = [...(users ?? [])].filter((u) => u?.id);
  const players = all.filter((u) => u.isGM !== true);
  const gmId = (all.find((u) => u.isGM === true && u.active) ?? all.find((u) => u.isGM === true))?.id;
  const ownerOf = (actor) => {
    try {
      return actor.hasPlayerOwner === false ? undefined : players.find((u) => actor.testUserPermission?.(u, 'OWNER'))?.id;
    } catch {
      return undefined;
    }
  };
  const skip = new Set();
  for (const look of known ?? []) skip.add(JSON.stringify(look));
  const looks = new Map();
  const seen = new Set();
  let resolved = 0;
  const full = () => looks.size >= limit || resolved >= MAX_ACTORS;
  const add = (key, actor, speaker, author) => {
    if (!actor?.id || !author || seen.has(key) || full()) return;
    seen.add(key);
    try {
      if (!wants(actor)) return;
    } catch {
      return; // one unreadable actor must not stop the others' warm-up
    }
    resolved++;
    for (const term of WARMUP_TERMS) {
      try {
        const look = lookOf(author, speaker, term);
        const k = look && typeof look === 'object' ? JSON.stringify(look) : null;
        if (k && !skip.has(k) && !looks.has(k) && looks.size < limit) looks.set(k, look);
      } catch {
        // one unreadable actor or die must not stop the others' warm-up
      }
    }
  };
  for (const u of all) if (u.character) add(u.character.id, u.character, { actor: u.character.id }, u.id);
  for (const t of tokens ?? []) {
    const a = t?.actor;
    if (!a?.id) continue;
    const author = ownerOf(a) ?? gmId;
    if (t.actorLink === false && t.id && t.parent?.id) add(`${t.parent.id}.${t.id}`, a, { actor: a.id, token: t.id, scene: t.parent.id }, author);
    else add(a.id, a, { actor: a.id }, author);
  }
  for (const a of actors ?? []) {
    if (full()) break;
    const owner = a ? ownerOf(a) : undefined;
    if (owner) add(a.id, a, { actor: a.id }, owner);
  }
  return [...looks.values()];
}

/**
 * The looks main.js compiles ahead besides the users' and the damage themes': the actors' (above)
 * and the themes a module named (api.warmThemes). Also asks for a warm-up when they may have
 * changed: an actor's dice flags, a new token, another scene, the module themes. Lives in the lazy
 * theme API chunk (world start only keeps the hook-up), so nothing here may be needed by a roll.
 *
 * @param {object} o
 * @param {() => object|null} o.resolver the look resolver (createLookResolver), null before the engine
 * @param {() => object|null} o.registry the DSN registry
 * @param {(key: string) => unknown} o.getSetting
 * @param {() => void} o.rewarm asks for a (debounced) warm-up
 * @param {() => object[]} [o.known] the looks main.js compiles anyway (the other users'): left out
 * @returns {() => object[]} the looks; never throws
 */
export function aheadLooks({ resolver, registry, getSetting, rewarm, known = () => [], game = () => globalThis.game, hooks = globalThis.Hooks }) {
  hooks?.on?.('updateActor', (actor, changes) => {
    if (changes?.flags?.dicer) rewarm();
  });
  hooks?.on?.('createToken', (token) => {
    if (token?.parent === game()?.scenes?.viewed) rewarm(); // only a token on the scene in view
  });
  for (const hook of ['canvasReady', 'dicer.themesChanged']) hooks?.on?.(hook, () => rewarm());
  /** The looks compiled without this list: the other users', and the viewer's own. */
  const compiled = (looks, g) => {
    const out = [...(known() ?? [])];
    const me = g?.user?.id;
    if (me) for (const term of WARMUP_TERMS) out.push(looks.decorate(null, null, me)(term, null, 0)?.appearance);
    return out.filter(Boolean);
  };
  const actors = (looks) => {
    const g = game();
    let skip = [];
    try {
      skip = compiled(looks, g);
    } catch {
      /* nothing left out: a look compiled twice is only a cache hit */
    }
    return actorWarmupLooks({
      known: skip,
      users: g?.users?.contents,
      actors: g?.actors?.contents,
      tokens: g?.scenes?.viewed?.tokens?.contents,
      // only an actor whose look comes from the actor: its own dice, or a module's default for it
      wants: (actor) => flagChoice(actor.flags?.dicer?.appearance) || (PROVIDERS.size > 0 && !!providedTheme(actor)),
      lookOf: (author, speaker, term) => looks.decorate(null, null, author, speaker)(term, null, 0)?.appearance,
    });
  };
  const named = () => {
    if (!WARM_THEMES.size) return [];
    const user = game()?.user;
    const themes = {
      worldThemes: readThemeList(getSetting('worldThemes'), 'world', () => {}),
      userThemes: readThemeList(user?.getFlag?.('dicer', 'themes'), 'user', () => {}),
    };
    const out = [];
    for (const theme of WARM_THEMES) {
      for (const term of WARMUP_TERMS) {
        const look = lookRefToAppearance({ theme }, registry(), 0, { dieType: dsnTypeOf(term), themes })?.appearance;
        if (look) out.push(look);
      }
    }
    return out;
  };
  return () => {
    const looks = resolver();
    if (!looks) return [];
    const out = new Map();
    for (const list of [() => actors(looks), named]) {
      try {
        for (const look of list()) out.set(JSON.stringify(look), look);
      } catch (err) {
        console.warn('dicer: cannot list some looks to warm up', err);
      }
    }
    return [...out.values()];
  };
}
