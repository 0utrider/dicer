import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeAudioContext } from './fake-audio.js';
import {
  createSoundEngine,
  impactGain,
  MIN_IMPACT_SPEED,
  LOUD_IMPACT_SPEED,
  MAX_VOICES,
  DIE_DEBOUNCE_MS,
} from '../../src/audio/sound-engine.js';

const MATS = ['plastic', 'metal', 'wood', 'glass', 'stone'];
const fakeSynth = {
  VARIANTS: 4,
  renderAll: async () => {
    const m = new Map();
    for (const mat of MATS) for (let v = 0; v < 4; v++) m.set(`impact:${mat}:${v}`, new Float32Array(480));
    for (const s of ['felt', 'wood', 'stone', 'metal']) m.set(`surface:${s}`, new Float32Array(480));
    for (const r of ['chime', 'fanfare', 'sparkle', 'fizzle', 'thud']) m.set(`result:${r}`, new Float32Array(480));
    return m;
  },
};

let ctx;
let settings;
let warn;
let now;
let focus;
function make(extra = {}) {
  ctx = undefined;
  const createContext = vi.fn(() => (ctx = new FakeAudioContext()));
  const engine = createSoundEngine({
    createContext,
    loadSynth: async () => fakeSynth,
    getSetting: (k) => settings[k],
    hasFocus: () => focus,
    warn,
    now: () => now,
    idle: (cb) => setTimeout(cb, 0),
    ...extra,
  });
  return { engine, createContext };
}
const hit = (over = {}) => ({ material: 'plastic', surface: 'felt', speed: 30, other: 2, dieKey: 'a', ...over });

beforeEach(() => {
  vi.useFakeTimers();
  settings = { sounds: true, soundVolume: 1, effectsVolume: 1, quietWhenUnfocused: true };
  warn = vi.fn();
  now = 1000;
  focus = true;
});
afterEach(() => vi.useRealTimers());

async function ready(extra) {
  const m = make(extra);
  const p = m.engine.preload();
  await vi.advanceTimersByTimeAsync(50);
  await p;
  return m;
}

describe('impactGain', () => {
  it('maps measured speeds', () => {
    expect(MIN_IMPACT_SPEED).toBe(4);
    expect(LOUD_IMPACT_SPEED).toBe(24);
    expect(impactGain(0)).toBe(0);
    expect(impactGain(3.9)).toBe(0);
    expect(impactGain(5.2)).toBeLessThan(0.01);
    expect(impactGain(20)).toBeCloseTo(0.64, 5);
    expect(impactGain(24)).toBe(1);
    expect(impactGain(99)).toBe(1);
    expect(impactGain(NaN)).toBe(0);
  });
  it('is monotone', () => {
    let prev = 0;
    for (let s = 0; s <= 30; s += 0.5) {
      const g = impactGain(s);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});

describe('sound engine', () => {
  it('creates no context before the first impact', async () => {
    const { engine, createContext } = await ready();
    expect(createContext).not.toHaveBeenCalled();
    engine.impact(hit());
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it('caps simultaneous voices', async () => {
    const { engine } = await ready();
    for (let i = 0; i < 30; i++) engine.impact(hit({ dieKey: `d${i}` }));
    expect(ctx.sources.length).toBe(MAX_VOICES);
  });

  it('a louder newcomer replaces the quietest voice at the cap', async () => {
    const { engine } = await ready();
    for (let i = 0; i < MAX_VOICES; i++) engine.impact(hit({ dieKey: `d${i}`, speed: 10 }));
    engine.impact(hit({ dieKey: 'loud', speed: 30 }));
    expect(ctx.sources.length).toBe(MAX_VOICES + 1);
    expect(ctx.sources.filter((s) => s.stopped).length).toBe(1);
  });

  it('debounces the same die', async () => {
    const { engine } = await ready();
    engine.impact(hit());
    now += 10;
    engine.impact(hit());
    expect(ctx.sources.length).toBe(1);
    now += DIE_DEBOUNCE_MS;
    engine.impact(hit());
    expect(ctx.sources.length).toBe(2);
  });

  it('floor adds the surface voice', async () => {
    const { engine } = await ready();
    engine.impact(hit({ other: -1 }));
    expect(ctx.sources.length).toBe(2);
    engine.impact(hit({ other: 2, dieKey: 'b' }));
    expect(ctx.sources.length).toBe(3);
  });

  it('drops quiet impacts without creating a context', async () => {
    const { engine, createContext } = await ready();
    engine.impact(hit({ speed: 1.8 }));
    expect(createContext).not.toHaveBeenCalled();
  });

  it('honours settings', async () => {
    let { engine } = await ready();
    settings.sounds = false;
    engine.impact(hit());
    expect(ctx).toBeUndefined();
    settings.sounds = true;

    ({ engine } = await ready());
    engine.impact(hit({ speed: 24 }));
    const full = ctx.sources[0].totalGain;
    expect(full).toBeCloseTo(1, 5);

    settings.soundVolume = 0.5;
    ({ engine } = await ready());
    engine.impact(hit({ speed: 24 }));
    expect(ctx.sources[0].totalGain).toBeCloseTo(full / 2, 5);

    settings.soundVolume = 1;
    focus = false;
    ({ engine } = await ready());
    engine.impact(hit({ speed: 24 }));
    expect(ctx.sources[0].totalGain).toBeCloseTo(0.25, 5);

    settings.quietWhenUnfocused = false;
    ({ engine } = await ready());
    engine.impact(hit({ speed: 24 }));
    expect(ctx.sources[0].totalGain).toBeCloseTo(1, 5);
  });

  it('jitters playback rate within 4% and rotates variants', async () => {
    const { engine } = await ready();
    for (let i = 0; i < 8; i++) {
      now += 100;
      engine.impact(hit());
    }
    for (const s of ctx.sources) {
      expect(s.playbackRate.value).toBeGreaterThanOrEqual(0.96);
      expect(s.playbackRate.value).toBeLessThanOrEqual(1.04);
    }
    const bufs = new Set(ctx.sources.map((s) => s.buffer));
    expect(bufs.size).toBe(4);
  });

  it('survives missing WebAudio with one warning', async () => {
    const { engine } = await ready({
      createContext: () => {
        throw new Error('no audio');
      },
    });
    expect(() => engine.impact(hit())).not.toThrow();
    now += 100;
    engine.impact(hit());
    await expect(engine.result({ builtin: 'chime' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('drops, not queues, while suspended', async () => {
    const { engine } = await ready();
    engine.impact(hit());
    ctx.state = 'suspended';
    now += 100;
    engine.impact(hit());
    expect(ctx.sources.length).toBe(1);
    ctx.state = 'running';
    now += 100;
    engine.impact(hit());
    expect(ctx.sources.length).toBe(2);
  });

  it('resumes through game.audio.awaitFirstGesture when present', async () => {
    let release;
    globalThis.game = { audio: { awaitFirstGesture: () => new Promise((r) => (release = r)) } };
    try {
      const { engine } = await ready({
        createContext: () => (ctx = new FakeAudioContext({ state: 'suspended' })),
      });
      engine.impact(hit());
      expect(ctx.sources.length).toBe(0);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(ctx.state).toBe('running');
      now += 100;
      engine.impact(hit());
      expect(ctx.sources.length).toBe(1);
    } finally {
      delete globalThis.game;
    }
  });

  it('suspends after 30 s with nothing playing', async () => {
    const { engine } = await ready();
    engine.impact(hit());
    ctx.currentTime = 100; // the click has long finished
    await vi.advanceTimersByTimeAsync(29000);
    expect(ctx.state).toBe('running');
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctx.state).toBe('suspended');
  });

  describe('result', () => {
    it('plays a builtin with effects x sound volume', async () => {
      settings.effectsVolume = 0.5;
      settings.soundVolume = 0.5;
      const { engine } = await ready();
      await engine.result({ builtin: 'chime' });
      expect(ctx.sources.length).toBe(1);
      expect(ctx.sources[0].totalGain).toBeCloseTo(0.25, 5);
    });

    it('fetches, decodes and caches a custom file', async () => {
      const fetchSound = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
      const { engine } = await ready({ fetchSound });
      await engine.result({ src: 'a.ogg', volume: 0.5 });
      await engine.result({ src: 'a.ogg' });
      expect(fetchSound).toHaveBeenCalledTimes(1);
      expect(ctx.sources.length).toBe(2);
      expect(ctx.sources[0].totalGain).toBeCloseTo(0.5, 5);
    });

    it('warns once per bad src and never refetches', async () => {
      const fetchSound = vi.fn(async () => {
        throw new Error('404');
      });
      const { engine } = await ready({ fetchSound });
      await expect(engine.result({ src: 'bad.ogg' })).resolves.toBeUndefined();
      await expect(engine.result({ src: 'bad.ogg' })).resolves.toBeUndefined();
      expect(fetchSound).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      await engine.result({ src: 'bad2.ogg' });
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('survives a decode failure', async () => {
      const fetchSound = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
      const { engine } = await ready({
        fetchSound,
        createContext: () => {
          ctx = new FakeAudioContext();
          ctx.decodeFails = true;
          return ctx;
        },
      });
      await expect(engine.result({ src: 'x.ogg' })).resolves.toBeUndefined();
      await engine.result({ src: 'x.ogg' });
      expect(fetchSound).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(ctx.sources.length).toBe(0);
    });

    it('evicts the least recently used custom file beyond 32', async () => {
      const fetchSound = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
      const { engine } = await ready({ fetchSound });
      for (let i = 0; i < 33; i++) await engine.result({ src: `f${i}.ogg` });
      expect(fetchSound).toHaveBeenCalledTimes(33);
      await engine.result({ src: 'f0.ogg' });
      expect(fetchSound).toHaveBeenCalledTimes(34);
      await engine.result({ src: 'f32.ogg' });
      expect(fetchSound).toHaveBeenCalledTimes(34);
    });
  });

  it('dispose closes the context and silences later calls', async () => {
    const { engine } = await ready();
    engine.impact(hit());
    engine.dispose();
    expect(ctx.state).toBe('closed');
    const n = ctx.sources.length;
    now += 100;
    engine.impact(hit());
    expect(ctx.sources.length).toBe(n);
  });
});
