import { actorWarmupLooks, aheadLooks } from '../../src/render/actor-looks.js';
import { PROVIDERS, WARM_THEMES } from '../../src/api/theme-registry.js';
import { createRegistry } from '../../src/compat/registry.js';

// A look that comes from an actor (its dice flag, or a module's default provider) was compiled on
// the first frame of its first roll; the warm-up now compiles the looks of the actors likely to roll.
describe('actorWarmupLooks', () => {
  const gm = { id: 'gm', isGM: true };
  const ann = { id: 'ann', isGM: false };
  const bob = { id: 'bob', isGM: false };
  const actor = (id, owners = []) => ({
    id,
    hasPlayerOwner: owners.length > 0,
    testUserPermission: (user) => owners.includes(user.id),
  });
  /** A look per call, recorded: `${author}|${actor}|${token ?? ''}`. */
  const recorder = () => {
    const calls = [];
    const lookOf = (author, speaker, term) => {
      if (term.faces === 20) calls.push({ author, speaker });
      return { colorset: `${speaker.actor}${speaker.token ?? ''}` };
    };
    return { calls, lookOf };
  };
  const wants = () => true;

  it('lists characters, owned actors and scene tokens once each', () => {
    const hero = actor('hero', ['ann']);
    const pet = actor('pet', ['ann']);
    const orc = actor('orc');
    const { calls, lookOf } = recorder();
    const looks = actorWarmupLooks({
      users: [gm, { ...ann, character: hero }, bob],
      actors: [hero, pet, orc],
      tokens: [
        { id: 't1', actor: hero, actorLink: true, parent: { id: 's' } },
        { id: 't2', actor: orc, actorLink: true, parent: { id: 's' } },
      ],
      wants,
      lookOf,
    });
    // the tokens in view before the rest of the players' actors: they are the likeliest to roll
    expect(calls.map((c) => c.speaker.actor)).toEqual(['hero', 'orc', 'pet']);
    expect(looks).toEqual([{ colorset: 'hero' }, { colorset: 'orc' }, { colorset: 'pet' }]);
  });

  it('skips actors wants() rejects', () => {
    const { calls, lookOf } = recorder();
    actorWarmupLooks({
      users: [gm, ann],
      actors: [actor('a', ['ann']), actor('b', ['ann'])],
      tokens: [],
      wants: (a) => a.id === 'b',
      lookOf,
    });
    expect(calls.map((c) => c.speaker.actor)).toEqual(['b']);
  });

  it('caps the distinct looks at limit, and stops resolving there', () => {
    const { calls, lookOf } = recorder();
    const actors = Array.from({ length: 10 }, (_, i) => actor(`a${i}`, ['ann']));
    const looks = actorWarmupLooks({ users: [gm, ann], actors, tokens: [], wants, lookOf, limit: 3 });
    expect(looks).toHaveLength(3);
    expect(calls).toHaveLength(3);
  });

  it('a crowd sharing one look does not use up the limit: the token after it is still warmed', () => {
    const goblin = actor('goblin');
    const boss = actor('boss');
    const tokens = [
      ...Array.from({ length: 50 }, (_, i) => ({ id: `g${i}`, actor: goblin, actorLink: false, parent: { id: 's' } })),
      { id: 'b', actor: boss, actorLink: true, parent: { id: 's' } },
    ];
    const looks = actorWarmupLooks({ users: [gm], actors: [], tokens, wants, lookOf: (a, speaker) => ({ colorset: speaker.actor }), limit: 3 });
    expect(looks).toEqual([{ colorset: 'goblin' }, { colorset: 'boss' }]);
  });

  it('many player-owned actors do not starve the tokens in view', () => {
    const owned = Array.from({ length: 60 }, (_, i) => actor(`o${i}`, ['ann']));
    const thrall = actor('thrall');
    const looks = actorWarmupLooks({
      users: [gm, ann],
      actors: owned,
      tokens: [{ id: 't', actor: thrall, actorLink: false, parent: { id: 's' } }],
      wants,
      lookOf: (a, speaker) => ({ colorset: speaker.actor }),
      limit: 5,
    });
    expect(looks[0]).toEqual({ colorset: 'thrall' });
  });

  it('skips the looks already known (the users own looks)', () => {
    const looks = actorWarmupLooks({
      users: [gm, ann],
      actors: [actor('a', ['ann']), actor('b', ['ann'])],
      wants,
      lookOf: (author, speaker) => ({ colorset: speaker.actor }),
      known: [{ colorset: 'a' }],
    });
    expect(looks).toEqual([{ colorset: 'b' }]);
  });

  it('a throwing lookOf or wants skips that actor only', () => {
    const looks = actorWarmupLooks({
      users: [gm, ann],
      actors: [actor('bad', ['ann']), actor('worse', ['ann']), actor('ok', ['ann'])],
      tokens: [],
      wants: (a) => {
        if (a.id === 'worse') throw new Error('bad provider');
        return true;
      },
      lookOf: (author, speaker) => {
        if (speaker.actor === 'bad') throw new Error('bad flag');
        return { colorset: 'ok' };
      },
    });
    expect(looks).toEqual([{ colorset: 'ok' }]);
  });

  it('an unlinked token resolves with {actor, token, scene}, once per token', () => {
    const orc = actor('orc');
    const { calls, lookOf } = recorder();
    actorWarmupLooks({
      users: [gm],
      actors: [orc],
      tokens: [
        { id: 't1', actor: orc, actorLink: false, parent: { id: 's' } },
        { id: 't2', actor: orc, actorLink: false, parent: { id: 's' } },
        { id: 't2', actor: orc, actorLink: false, parent: { id: 's' } },
      ],
      wants,
      lookOf,
    });
    expect(calls.map((c) => c.speaker)).toEqual([
      { actor: 'orc', token: 't1', scene: 's' },
      { actor: 'orc', token: 't2', scene: 's' },
    ]);
  });

  it('uses the owning player as author, a GM when nobody owns it', () => {
    const hero = actor('hero', ['bob']);
    const mine = actor('mine', ['ann']);
    const orc = actor('orc');
    const { calls, lookOf } = recorder();
    actorWarmupLooks({
      users: [gm, { ...ann, character: hero }, bob],
      actors: [hero, mine, orc],
      tokens: [{ id: 't', actor: orc, actorLink: true, parent: { id: 's' } }],
      wants,
      lookOf,
    });
    expect(calls.map((c) => [c.speaker.actor, c.author])).toEqual([
      ['hero', 'ann'], // the user whose character it is
      ['orc', 'gm'],
      ['mine', 'ann'],
    ]);
  });

  it('deduplicates equal looks and survives missing lists', () => {
    expect(actorWarmupLooks({ users: [gm, ann], actors: [actor('a', ['ann']), actor('b', ['ann'])], wants, lookOf: () => ({ colorset: 'same' }) })).toEqual([
      { colorset: 'same' },
    ]);
    expect(actorWarmupLooks({ wants, lookOf: () => null })).toEqual([]);
  });
});

describe('aheadLooks', () => {
  const setup = ({ resolver, known } = {}) => {
    const on = [];
    const rewarm = vi.fn();
    const orc = { id: 'orc', hasPlayerOwner: false, flags: { dicer: { appearance: { global: { theme: 'obsidian' } } } } };
    const plain = { id: 'plain', hasPlayerOwner: false, flags: {} };
    const game = {
      user: { id: 'gm', getFlag: () => undefined },
      users: { contents: [{ id: 'gm', isGM: true }] },
      actors: { contents: [orc, plain] },
      scenes: { viewed: { tokens: { contents: [orc, plain].map((actor, i) => ({ id: `t${i}`, actor, actorLink: true, parent: { id: 's' } })) } } },
    };
    const asked = [];
    const looks = {
      decorate: (m, r, author, speaker) => () => {
        if (speaker) asked.push(speaker.actor);
        return { appearance: { colorset: speaker?.actor ?? `user:${author}` } };
      },
    };
    const get = aheadLooks({
      known,
      resolver: resolver ?? (() => looks),
      registry: () => createRegistry({ warn: () => {} }),
      getSetting: () => [],
      rewarm,
      game: () => game,
      hooks: { on: (name, fn) => on.push([name, fn]) },
    });
    return { get, on, rewarm, asked, game };
  };
  afterEach(() => {
    WARM_THEMES.clear();
    PROVIDERS.clear();
  });

  it('lists only the actors with their own dice when no module provides defaults', () => {
    const { get, asked } = setup();
    expect(get()).toEqual([{ colorset: 'orc' }]);
    expect(new Set(asked)).toEqual(new Set(['orc']));
  });

  it('lists the actors a default provider answers for, and not the ones it declines', () => {
    PROVIDERS.set('mod', () => null);
    expect(setup().get()).toEqual([{ colorset: 'orc' }]);
    PROVIDERS.set('mod', (actor) => (actor.id === 'plain' ? 'obsidian' : null));
    expect(setup().get()).toEqual([{ colorset: 'orc' }, { colorset: 'plain' }]);
  });

  it("leaves out the looks compiled anyway: the other users' and the viewer's own", () => {
    expect(setup({ known: () => [{ colorset: 'orc' }] }).get()).toEqual([]);
    const s = setup();
    s.game.actors.contents[0].id = 'user:gm'; // an actor whose look equals the viewer's own
    s.game.actors.contents[0].flags.dicer.appearance = { global: { theme: 'obsidian' } };
    expect(JSON.stringify(s.get())).not.toContain('user:gm');
  });

  it('adds the themes a module named, and skips unknown ones', () => {
    WARM_THEMES.add('obsidian').add('no-such-theme');
    const { get } = setup();
    const looks = get();
    expect(looks[0]).toEqual({ colorset: 'orc' });
    expect(looks.length).toBeGreaterThan(1);
    expect(looks[1]).toMatchObject({ body: expect.any(Object) });
  });

  it('is empty before the engine has a resolver, and never throws', () => {
    expect(setup({ resolver: () => null }).get()).toEqual([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = setup({ resolver: () => ({ decorate: null }) });
    WARM_THEMES.add('obsidian');
    expect(broken.get().length).toBeGreaterThan(0); // the named themes survive the actors' failure
    warn.mockRestore();
  });

  it('asks for a warm-up on actor dice flags, new tokens, a scene change and theme changes', () => {
    const { on, rewarm, game } = setup();
    expect(on.map(([n]) => n)).toEqual(['updateActor', 'createToken', 'canvasReady', 'dicer.themesChanged']);
    on[0][1]({}, { name: 'x' });
    expect(rewarm).not.toHaveBeenCalled();
    on[0][1]({}, { flags: { dicer: {} } });
    on[1][1]({ parent: { id: 'another-scene' } }); // a token made on a scene nobody here views
    expect(rewarm).toHaveBeenCalledTimes(1);
    on[1][1]({ parent: game.scenes.viewed });
    on[2][1]();
    on[3][1]();
    expect(rewarm).toHaveBeenCalledTimes(4);
  });

  it('its listeners never return false: Foundry fires canvasReady with Hooks.call, which stops there', () => {
    const { on, rewarm, game } = setup();
    rewarm.mockReturnValue(false);
    const args = { updateActor: [{}, { flags: { dicer: {} } }], createToken: [{ parent: game.scenes.viewed }] };
    for (const [name, fn] of on) expect(fn(...(args[name] ?? [])), name).toBeUndefined();
    expect(rewarm).toHaveBeenCalledTimes(4);
  });
});
