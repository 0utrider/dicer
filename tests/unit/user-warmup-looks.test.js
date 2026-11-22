import { userWarmupLooks, WARMUP_TERMS } from '../../src/render/user-looks.js';
import { dsnTypeOf } from '../../src/core/dice-shapes.js';

// Each player's first roll on another screen compiled that look's shaders on its first frame
// (0.3 to 1.5 s freezes); the warm-up now compiles every other user's look ahead.
describe('userWarmupLooks', () => {
  const ruby = { colorset: 'ruby', material: 'glass' };
  const jade = { colorset: 'jade', material: 'metal' };

  it('lists the other users looks, without the viewer, deduplicated', () => {
    const looks = { gm: { colorset: 'own' }, a: ruby, b: jade, c: { ...ruby } };
    const result = userWarmupLooks({
      users: [{ id: 'gm' }, { id: 'a' }, { id: 'b' }, { id: 'c' }],
      viewerId: 'gm',
      lookOf: (id) => looks[id],
    });
    expect(result).toEqual([ruby, jade]);
  });

  it('skips users whose look is missing or throws', () => {
    const result = userWarmupLooks({
      users: [{ id: 'a' }, { id: 'broken' }, {}, { id: 'none' }, { id: 'b' }],
      viewerId: 'gm',
      lookOf: (id) => {
        if (id === 'broken') throw new Error('bad flag');
        return { a: ruby, b: jade }[id] ?? null;
      },
    });
    expect(result).toEqual([ruby, jade]);
  });

  it('copes with no users', () => {
    expect(userWarmupLooks({ users: undefined, viewerId: 'gm', lookOf: () => ruby })).toEqual([]);
  });

  it('asks for every standard die, so a theme dressing each type differently is warmed whole', () => {
    expect(WARMUP_TERMS.map(dsnTypeOf)).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);
    const perType = userWarmupLooks({
      users: [{ id: 'a' }],
      viewerId: 'gm',
      lookOf: (_id, term) => (term.faces === 20 ? ruby : jade),
    });
    expect(perType).toEqual([jade, ruby]);
  });
});
