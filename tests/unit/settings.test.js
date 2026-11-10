import { registerSettings } from '../../src/settings.js';
import { LOOKS } from '../../src/look/looks.js';

function capture(callbacks) {
  const registered = {};
  globalThis.game = {
    settings: { register: (ns, key, cfg) => (registered[key] = { ns, ...cfg }) },
  };
  try {
    registerSettings(callbacks);
  } finally {
    delete globalThis.game;
  }
  return registered;
}

test('maxDice is a 1..100 range in steps of 1 (default 20)', () => {
  const registered = capture();
  expect(registered.maxDice.range).toEqual({ min: 1, max: 100, step: 1 });
  expect(registered.maxDice.default).toBe(20);
});

test('look is a client String whose choices map every LOOKS id to its name (default "default")', () => {
  const { look } = capture();
  expect(look).toMatchObject({
    ns: 'dicer',
    scope: 'client',
    config: true,
    type: String,
    default: 'default',
  });
  expect(look.choices).toEqual(
    Object.fromEntries(Object.entries(LOOKS).map(([id, l]) => [id, l.name])),
  );
  expect(look.name).toBe('DICER.Settings.look.Name');
  expect(look.hint).toBe('DICER.Settings.look.Hint');
});

test('quality is a client String auto/low/medium/high/ultra (default auto)', () => {
  const { quality } = capture();
  expect(quality).toMatchObject({ ns: 'dicer', scope: 'client', type: String, default: 'auto' });
  expect(Object.keys(quality.choices)).toEqual(['auto', 'low', 'medium', 'high', 'ultra']);
});

test('qualityCap is a world String low/medium/high/ultra (default ultra)', () => {
  const { qualityCap } = capture();
  expect(qualityCap).toMatchObject({ ns: 'dicer', scope: 'world', type: String, default: 'ultra' });
  expect(Object.keys(qualityCap.choices)).toEqual(['low', 'medium', 'high', 'ultra']);
});

test.each(['interiors', 'engraving', 'shadows', 'glow', 'presetFaces'])(
  '%s is a client Boolean toggle, default on',
  (key) => {
    const cfg = capture()[key];
    expect(cfg).toMatchObject({
      ns: 'dicer',
      scope: 'client',
      config: true,
      type: Boolean,
      default: true,
    });
    expect(cfg.name).toBe(`DICER.Settings.${key}.Name`);
    expect(cfg.hint).toBe(`DICER.Settings.${key}.Hint`);
  },
);

test('onChange routes look and feature toggles to onLookChange, quality and qualityCap to onQualityChange', () => {
  const onLookChange = vi.fn();
  const onQualityChange = vi.fn();
  const onAreaChange = vi.fn();
  const r = capture({ onAreaChange, onLookChange, onQualityChange });
  for (const key of ['look', 'interiors', 'engraving', 'shadows', 'glow']) r[key].onChange('x');
  expect(onLookChange.mock.calls.map((c) => c[0])).toEqual([
    'look',
    'interiors',
    'engraving',
    'shadows',
    'glow',
  ]);
  r.quality.onChange('low');
  r.qualityCap.onChange('medium');
  expect(onQualityChange.mock.calls.map((c) => c[0])).toEqual(['quality', 'qualityCap']);
  r.diceScale.onChange(1.5);
  expect(onAreaChange).toHaveBeenCalledTimes(1);
  expect(onLookChange).toHaveBeenCalledTimes(5);
});

test('onChange without callbacks does not throw', () => {
  const r = capture();
  for (const key of [
    'look',
    'quality',
    'qualityCap',
    'interiors',
    'engraving',
    'shadows',
    'glow',
  ]) {
    expect(() => r[key].onChange('x')).not.toThrow();
  }
});
