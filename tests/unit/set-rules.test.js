// A DSN add-on's dice sets bring their own natural 20 / natural 1 effects (irl-dice-packs lists
// them per character and GM theme): Dicer reads the lists and plays them for that set's d20s.
import { readSetRules, setRulesFor, hasSetRules, shimDsn, resetLoaded } from '../../src/compat/installed-dice.js';
import { setRules } from '../../src/effects/rules.js';

afterEach(() => resetLoaded());

const catalog = {
  CHARACTERS: [
    {
      systemId: 'irl-pc-essie',
      effects: [
        { result: 20, id: 'IRLEssiePerfectReaction' },
        { result: 1, id: 'IRLEssieOneDrop' },
      ],
    },
    { systemId: 'irl-pc-kev', effects: [{ result: 7, id: 'Odd' }] },
  ],
};
const gm = {
  GM_THEMES: [{ id: 'irl-unbroken-vow', effects: [{ id: 'IRLGrayceVowHolds', result: 20 }] }],
  GM_EFFECTS: [{ id: 'IRLGrayceVowHolds', result: 20 }], // no effects list: not a set
  gmTheme() {},
};
const files = {
  '/modules/irl-dice-packs/scripts/characters/catalog.js': catalog,
  '/modules/irl-dice-packs/scripts/gm-themes.js': gm,
};
const read = (ids = ['irl-dice-packs']) =>
  readSetRules(ids, {
    route: (p) => `/${p}`,
    esmodule: async (url) => {
      if (!files[url]) throw new Error('404');
      return files[url];
    },
  });
const register = (...ids) => {
  const dice3d = { addSFXMode: () => {} };
  shimDsn(dice3d);
  for (const id of ids) dice3d.addSFXMode(class { static id = id; });
  return dice3d;
};

test("a character's nat 20 and nat 1 effects become its set's rules, once the effects are registered", async () => {
  await read();
  expect(setRulesFor('irl-pc-essie')).toBeUndefined(); // nothing registered yet
  expect(setRules.of).toBe(setRulesFor); // the trigger rules ask it (fx-resolver)
  register('IRLEssiePerfectReaction', 'IRLEssieOneDrop');
  const rules = setRulesFor('irl-pc-essie');
  expect(rules.map((r) => [r.id, r.die, r.result.value, r.effect.id])).toEqual([
    ['dicer.nat20', 'd20', 20, 'dsn:IRLEssiePerfectReaction'],
    ['dicer.nat1', 'd20', 1, 'dsn:IRLEssieOneDrop'],
  ]);
});

test("the set's rules go over the theme's own of the same id; its other rules stay", async () => {
  await read();
  register('IRLEssiePerfectReaction');
  const own = [{ id: 'dicer.nat20', effect: { id: 'embers' } }, { id: 'extra', effect: { id: 'spark' } }];
  expect(setRulesFor('irl-pc-essie', own).map((r) => r.effect.id)).toEqual(['spark', 'dsn:IRLEssiePerfectReaction']);
});

test("a roller who turned a set's own effects off (dicer.setFxOff) gets none from it; others still do", async () => {
  await read();
  register('IRLEssiePerfectReaction');
  const users = { get: (id) => ({ getFlag: (m, k) => (m === 'dicer' && k === 'setFxOff' && id === 'bob' ? ['irl-pc-essie'] : undefined) }) };
  expect(setRulesFor('irl-pc-essie', [], 'bob', users)).toBeUndefined();
  expect(setRulesFor('irl-pc-essie', [], 'alice', users)).toHaveLength(1);
  expect(hasSetRules('irl-pc-essie')).toBe(true); // the toggle still shows for bob
  expect(hasSetRules('irl-pc-kev')).toBe(false);
});

test('a GM theme lists its effects too; an unregistered effect, another result or another set brings none', async () => {
  await read();
  register('IRLGrayceVowHolds', 'Odd');
  expect(setRulesFor('irl-unbroken-vow').map((r) => r.effect.id)).toEqual(['dsn:IRLGrayceVowHolds']);
  expect(setRulesFor('irl-pc-kev')).toBeUndefined();
  expect(setRulesFor('irl-pc-essie')).toBeUndefined();
  expect(setRulesFor('standard')).toBeUndefined();
});

test('only listed add-ons are read; a file that fails to load is skipped', async () => {
  await read(['some-other-dice']);
  register('IRLEssiePerfectReaction');
  expect(setRulesFor('irl-pc-essie')).toBeUndefined();
  delete files['/modules/irl-dice-packs/scripts/gm-themes.js'];
  await read();
  expect(setRulesFor('irl-pc-essie')).toHaveLength(1);
  files['/modules/irl-dice-packs/scripts/gm-themes.js'] = gm;
});
