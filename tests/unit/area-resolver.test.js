import { createAreaResolver } from '../../src/areas/area-resolver.js';
import { resolveArea } from '../../src/areas/area-model.js';

const STAGE = { left: 0, top: 0, width: 1000, height: 800 };

let settings, user, warnSpy;
const make = () =>
  createAreaResolver({
    getSetting: (k) => settings[k],
    measureUsable: () => STAGE,
    currentUser: () => user,
  });

beforeEach(() => {
  settings = {
    rollAreas: { default: { preset: 'full' }, users: {} },
    areaScale: 1,
    gmPrivateCorner: false,
    gmPrivateArea: { preset: 'corner' },
    perPlayerAreas: true,
  };
  user = { id: 'p1', isGM: false };
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

test('stage() is the measured usable region', () => {
  expect(make().stage()).toEqual(STAGE);
});

test('the default full area at scale 1 is null (DiceBox throws on the whole stage as before)', () => {
  expect(make().rectFor({ rollerId: 'p1' })).toBeNull();
});

test('a non-full default applies to every roller', () => {
  settings.rollAreas.default = { preset: 'bottom' };
  const want = resolveArea({ preset: 'bottom' }, STAGE);
  expect(make().rectFor({ rollerId: 'p1' })).toEqual(want);
  expect(make().rectFor({ rollerId: 'p2' })).toEqual(want);
});

test("the roller's own area wins over the default", () => {
  settings.rollAreas = { default: { preset: 'bottom' }, users: { p2: { preset: 'centre' } } };
  const r = make();
  expect(r.rectFor({ rollerId: 'p2' })).toEqual(resolveArea({ preset: 'centre' }, STAGE));
  expect(r.rectFor({ rollerId: 'p1' })).toEqual(resolveArea({ preset: 'bottom' }, STAGE));
});

test('a custom per-user area resolves its fractions', () => {
  const def = { preset: 'custom', x: 0.1, y: 0.2, w: 0.4, h: 0.5 };
  settings.rollAreas.users.p2 = def;
  const r = make().rectFor({ rollerId: 'p2' });
  const rounded = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]));
  expect(rounded).toEqual({ left: 100, top: 160, width: 400, height: 400 });
});

test('perPlayerAreas off ignores the per-user areas', () => {
  settings.rollAreas = { default: { preset: 'bottom' }, users: { p2: { preset: 'centre' } } };
  settings.perPlayerAreas = false;
  expect(make().rectFor({ rollerId: 'p2' })).toEqual(resolveArea({ preset: 'bottom' }, STAGE));
});

describe('the GM private corner (P5-D7)', () => {
  const corner = resolveArea({ preset: 'corner' }, STAGE);

  test('on a GM client with the setting on, a GM-private throw uses gmPrivateArea', () => {
    user = { id: 'gm', isGM: true };
    settings.gmPrivateCorner = true;
    settings.rollAreas.users.gm = { preset: 'centre' };
    expect(make().rectFor({ rollerId: 'gm', gmPrivate: true })).toEqual(corner);
  });

  test('a non-private throw on the GM client keeps the roller area', () => {
    user = { id: 'gm', isGM: true };
    settings.gmPrivateCorner = true;
    expect(make().rectFor({ rollerId: 'gm', gmPrivate: false })).toBeNull();
  });

  test('off by default: the GM client keeps the roller area', () => {
    user = { id: 'gm', isGM: true };
    expect(make().rectFor({ rollerId: 'gm', gmPrivate: true })).toBeNull();
  });

  test('never on a player client, even with gmPrivate claimed and the setting on', () => {
    settings.gmPrivateCorner = true;
    expect(make().rectFor({ rollerId: 'gm', gmPrivate: true })).toBeNull();
    user = undefined;
    expect(make().rectFor({ rollerId: 'gm', gmPrivate: true })).toBeNull();
  });

  test('a custom gmPrivateArea is used', () => {
    user = { id: 'gm', isGM: true };
    settings.gmPrivateCorner = true;
    settings.gmPrivateArea = { preset: 'custom', x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(make().rectFor({ rollerId: 'gm', gmPrivate: true })).toEqual({
      left: 0,
      top: 0,
      width: 500,
      height: 400,
    });
  });
});

test('areaScale scales the area around its centre on this screen', () => {
  settings.rollAreas.default = { preset: 'centre' };
  settings.areaScale = 0.75;
  expect(make().rectFor({ rollerId: 'p1' })).toEqual(resolveArea({ preset: 'centre' }, STAGE, { scale: 0.75 }));
});

test('areaScale below 1 shrinks even the full area (not null)', () => {
  settings.areaScale = 0.5;
  expect(make().rectFor({ rollerId: 'p1' })).toEqual({ left: 250, top: 200, width: 500, height: 400 });
});

test('settings are read per throw (no rebuild)', () => {
  const r = make();
  expect(r.rectFor({ rollerId: 'p1' })).toBeNull();
  settings.rollAreas = { default: { preset: 'bottom' }, users: {} };
  expect(r.rectFor({ rollerId: 'p1' })).toEqual(resolveArea({ preset: 'bottom' }, STAGE));
});

describe('malformed stored settings fall back with one warning', () => {
  test.each([
    ['not an object', 'oops'],
    ['an array', []],
    ['null', null],
  ])('rollAreas %s → the full default', (_, value) => {
    settings.rollAreas = value;
    const r = make();
    expect(r.rectFor({ rollerId: 'p1' })).toBeNull();
    expect(r.rectFor({ rollerId: 'p1' })).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('a malformed per-user area falls back to the default', () => {
    settings.rollAreas = { default: { preset: 'bottom' }, users: { p2: { preset: 'nowhere' } } };
    const r = make();
    const want = resolveArea({ preset: 'bottom' }, STAGE);
    expect(r.rectFor({ rollerId: 'p2' })).toEqual(want);
    expect(r.rectFor({ rollerId: 'p2' })).toEqual(want);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('a malformed users map is ignored', () => {
    settings.rollAreas = { default: { preset: 'bottom' }, users: 'x' };
    const r = make();
    expect(r.rectFor({ rollerId: 'p2' })).toEqual(resolveArea({ preset: 'bottom' }, STAGE));
    r.rectFor({ rollerId: 'p2' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('a malformed default falls back to full', () => {
    settings.rollAreas = { default: 7, users: {} };
    const r = make();
    expect(r.rectFor({ rollerId: 'p1' })).toBeNull();
    r.rectFor({ rollerId: 'p1' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('a malformed gmPrivateArea falls back to the corner preset', () => {
    user = { id: 'gm', isGM: true };
    settings.gmPrivateCorner = true;
    settings.gmPrivateArea = { preset: 'custom' };
    const r = make();
    expect(r.rectFor({ rollerId: 'gm', gmPrivate: true })).toEqual(resolveArea({ preset: 'corner' }, STAGE));
    r.rectFor({ rollerId: 'gm', gmPrivate: true });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('a throwing getSetting or measureUsable gives null, never throws', () => {
    const r = createAreaResolver({
      getSetting: () => {
        throw new Error('boom');
      },
      measureUsable: () => STAGE,
      currentUser: () => user,
    });
    expect(r.rectFor({ rollerId: 'p1' })).toBeNull();
    const r2 = createAreaResolver({
      getSetting: (k) => settings[k],
      measureUsable: () => {
        throw new Error('boom');
      },
      currentUser: () => user,
    });
    settings.rollAreas.default = { preset: 'bottom' };
    expect(r2.rectFor({ rollerId: 'p1' })).toBeNull();
  });

  test('an absent rollAreas (unregistered) is the default, without a warning', () => {
    settings.rollAreas = undefined;
    expect(make().rectFor({ rollerId: 'p1' })).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
