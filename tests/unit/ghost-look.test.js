import { createGhostDecorate } from '../../src/compat/ghost-look.js';

// Themed ghost dice: a roll a player cannot read shows as ghosts wearing the roller's own dice
// look. Privacy first: the look never depends on the roll (no flavor, options, actor, damage).
describe('createGhostDecorate', () => {
  const ruby = { colorset: 'ruby' };
  const make = ({ on = true, lookOf = () => ruby } = {}) => {
    const seen = vi.fn(lookOf);
    return { seen, ghostFor: createGhostDecorate({ getSetting: (k) => (k === 'themedGhostDice' ? on : undefined), lookOf: seen }) };
  };
  const term = { faces: 20, flavor: 'fire', options: { flavor: 'fire', appearance: { colorset: 'secret' }, dsnActorId: 'A' }, results: [{ result: 17 }] };

  it('off (the default): a plain ghost, and the look is never resolved', () => {
    const { ghostFor, seen } = make({ on: false });
    expect(ghostFor('u')(term)).toEqual({ ghost: true });
    expect(make({ on: null }).ghostFor('u')(term)).toEqual({ ghost: true });
    expect(seen).not.toHaveBeenCalled();
  });

  it("on: the ghost carries the roller's look for the die", () => {
    const { ghostFor, seen } = make();
    expect(ghostFor('u')(term)).toEqual({ ghost: true, ghostLook: ruby });
    expect(seen).toHaveBeenCalledWith('u', { faces: 20, options: {} });
  });

  it('hands the look resolver nothing of the roll: no flavor, options or results', () => {
    const { ghostFor, seen } = make();
    ghostFor('u')(term);
    expect(JSON.stringify(seen.mock.calls)).not.toMatch(/fire|secret|17|"A"/);
  });

  it('no author, no look or a throwing resolver: a plain ghost', () => {
    expect(make().ghostFor(undefined)(term)).toEqual({ ghost: true });
    expect(make({ lookOf: () => null }).ghostFor('u')(term)).toEqual({ ghost: true });
    expect(
      make({
        lookOf: () => {
          throw new Error('bad flag');
        },
      }).ghostFor('u')(term),
    ).toEqual({ ghost: true });
  });
});

// The claim the setting rests on, through the real resolver and damage themer as main.js wires them.
describe('themed ghost dice: the look resolved is the roller\'s own, whatever was rolled', () => {
  it('ignores the actor, the damage type, the flavor and the roll options', async () => {
    const { createLookResolver } = await import('../../src/compat/resolve-looks.js');
    const { createDamageThemer } = await import('../../src/effects/damage-themes.js');
    const { createRegistry } = await import('../../src/compat/registry.js');
    const { LOOKS } = await import('../../src/look/looks.js');
    const { normalizeAppearance } = await import('../../src/look/appearance.js');
    const registry = createRegistry({ warn: () => {} });
    const settings = { damagePresets: true };
    const users = { u: { getFlag: (s, k) => (s === 'dicer' && k === 'appearance' ? { global: { look: 'ruby-classic', chosen: true } } : undefined) } };
    const actors = { A: { flags: { dicer: { appearance: { global: { look: 'sharp-crystal' } } } } } };
    const damageThemer = createDamageThemer({ registry, getSetting: (k) => settings[k], getUserThemes: () => [], getViewerId: () => 'u' });
    const resolver = createLookResolver({
      registry,
      getUser: (id) => users[id],
      getActor: (id) => actors[id],
      damageThemeFor: (roll, userId) => damageThemer.forRoll(roll, userId),
      warn: () => {},
    });
    // main.js: userLook
    const lookOf = (id, term) => resolver.decorate(null, null, id)(term, null, 0)?.appearance;
    const ghostFor = createGhostDecorate({ getSetting: () => true, lookOf });
    const plain = ghostFor('u')({ faces: 6, options: {} });
    const loaded = ghostFor('u')({
      faces: 6,
      flavor: 'fire',
      options: { flavor: 'fire', colorset: 'fire', appearance: { colorset: 'acid' }, dsnActorId: 'A' },
      results: [{ result: 6 }],
    });
    expect(plain.ghostLook).toEqual(normalizeAppearance(LOOKS['ruby-classic'].appearance));
    expect(loaded).toEqual(plain);
    expect(Object.keys(loaded)).toEqual(['ghost', 'ghostLook']);
  });
});
