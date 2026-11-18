import { petFor, readPet, PET_KINDS } from '../../src/pet/pet-for.js';

const on = () => undefined;
const user = (flag, color = '#112233') => ({ id: 'u1', color, getFlag: () => flag });

test('PET_KINDS is frozen', () => {
  expect(PET_KINDS).toEqual(['none', 'mimic', 'slime', 'dragonling', 'owl', 'frog', 'ghost', 'mushroom', 'eye', 'golem', 'cat']);
  expect(Object.isFrozen(PET_KINDS)).toBe(true);
});

test('no user, none view, either switch off, kind none -> null', () => {
  expect(petFor({ user: undefined, view: 'real', getSetting: on })).toBeNull();
  expect(petFor({ user: user(), view: 'none', getSetting: on })).toBeNull();
  expect(petFor({ user: user(), view: 'real', getSetting: (k) => (k === 'petsAllowed' ? false : undefined) })).toBeNull();
  expect(petFor({ user: user(), view: 'real', getSetting: (k) => (k === 'showPets' ? false : undefined) })).toBeNull();
  expect(petFor({ user: user({ kind: 'none', color: '#ffffff' }), view: 'real', getSetting: on })).toBeNull();
});

test('a real view gives the spec; a ghost view sets ghost true', () => {
  const u = user({ kind: 'slime', color: '#00ff00' });
  expect(petFor({ user: u, view: 'real', getSetting: on })).toEqual({ userId: 'u1', kind: 'slime', color: '#00ff00', ghost: false });
  expect(petFor({ user: u, view: 'ghost', getSetting: on }).ghost).toBe(true);
});

test("natural colours: the spec colour is null (the pet chunk fills the kind's own); readPet says natural", () => {
  const u = user({ kind: 'frog', color: '#00ff00', natural: true });
  expect(readPet(u)).toEqual({ kind: 'frog', color: '#00ff00', natural: true });
  expect(petFor({ user: u, view: 'real', getSetting: on }).color).toBeNull();
});

test('a junk flag falls back to a mimic in the user colour', () => {
  expect(petFor({ user: user({ kind: 'hydra', color: 'red' }), view: 'real', getSetting: on })).toMatchObject({ kind: 'mimic', color: '#112233' });
});

test('a missing flag is a mimic in the user colour', () => {
  expect(readPet(user(undefined))).toEqual({ kind: 'mimic', color: '#112233', natural: false });
});

test('a user with no colour gets the default gold', () => {
  expect(readPet({ id: 'u', getFlag: () => undefined })).toEqual({ kind: 'mimic', color: '#c9a227', natural: false });
  expect(readPet(user(null, null)).color).toBe('#c9a227');
});

test('a throwing or non-object flag never throws', () => {
  const boom = () => {
    throw new Error('x');
  };
  expect(readPet({ getFlag: boom }).kind).toBe('mimic');
  expect(readPet({ flags: { dicer: { pet: 'junk' } } }).kind).toBe('mimic');
  expect(readPet(null).kind).toBe('mimic');
});
