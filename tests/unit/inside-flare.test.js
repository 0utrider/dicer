import {
  flareInside,
  flareLevel,
  FLARE_RISE_MS,
  FLARE_RISE_CALM_MS,
} from '../../src/effects/library/inside-flare.js';

/** A die whose (isolated) material carries the living-insides uniforms. */
function insideDie() {
  const uniforms = { uInteriorFlare: { value: 0 }, uInteriorTime: { value: 0 } };
  return { uniforms, inner: { material: { userData: { uniforms } } } };
}

function ctxFor(die, over = {}) {
  return {
    die,
    duration: 900,
    reducedMotion: false,
    setting: () => undefined,
    isolate: (d) => d?.uniforms ?? null,
    ...over,
  };
}

describe('flareLevel: the envelope', () => {
  test('envelope: 0 at 0, >= 0.95 at 80 ms, 0 at duration', () => {
    expect(FLARE_RISE_MS).toBe(80);
    expect(flareLevel(0, 900, false)).toBe(0);
    expect(flareLevel(80, 900, false)).toBeGreaterThanOrEqual(0.95);
    expect(flareLevel(900, 900, false)).toBe(0);
    expect(flareLevel(1200, 900, false)).toBe(0);
    // decays (linear-ish) after the rise: down by half way, never negative
    expect(flareLevel(490, 900, false)).toBeGreaterThan(0.3);
    expect(flareLevel(490, 900, false)).toBeLessThan(0.7);
    for (let e = 80; e <= 900; e += 10)
      expect(flareLevel(e + 10, 900, false)).toBeLessThanOrEqual(flareLevel(e, 900, false));
  });

  test('reduced motion: rise 300 ms, monotonic, no overshoot', () => {
    expect(FLARE_RISE_CALM_MS).toBe(300);
    expect(flareLevel(80, 900, true)).toBeLessThan(0.5); // a soft rise, not the 80 ms snap
    expect(flareLevel(300, 900, true)).toBeGreaterThanOrEqual(0.95);
    let prev = -1;
    let peaked = false;
    for (let e = 0; e <= 900; e += 5) {
      const v = flareLevel(e, 900, true);
      expect(v).toBeLessThanOrEqual(1);
      if (e <= 300)
        expect(v).toBeGreaterThanOrEqual(prev); // rises once
      else expect(v).toBeLessThanOrEqual(prev); // then only falls: one soft rise, no pulse
      if (v >= 0.95) peaked = true;
      prev = v;
    }
    expect(peaked).toBe(true);
    expect(flareLevel(900, 900, true)).toBe(0);
  });

  test('a short duration still rises and falls to 0', () => {
    expect(flareLevel(0, 100, false)).toBe(0);
    expect(flareLevel(50, 100, true)).toBeGreaterThan(0);
    expect(flareLevel(100, 100, true)).toBe(0);
  });
});

describe('flareInside', () => {
  test('writes uInteriorFlare from the envelope and resets it when done', () => {
    const die = insideDie();
    const ctx = ctxFor(die);
    const h = flareInside(ctx, die, { duration: 900 });
    expect(h.update(1000)).toBe(true);
    expect(die.uniforms.uInteriorFlare.value).toBe(0);
    h.update(1080);
    expect(die.uniforms.uInteriorFlare.value).toBeGreaterThanOrEqual(0.95);
    h.update(1500);
    expect(die.uniforms.uInteriorFlare.value).toBeGreaterThan(0);
    expect(h.update(1900)).toBe(false);
    expect(die.uniforms.uInteriorFlare.value).toBe(0);
  });

  test('amount scales the flare; the duration defaults to the effect duration', () => {
    const die = insideDie();
    const h = flareInside(ctxFor(die, { duration: 400 }), die, { amount: 0.5 });
    h.update(0);
    h.update(80);
    expect(die.uniforms.uInteriorFlare.value).toBeCloseTo(0.5, 2);
    expect(h.update(400)).toBe(false);
    expect(die.uniforms.uInteriorFlare.value).toBe(0);
  });

  test('two flares overlap -> max, capped at 1', () => {
    const die = insideDie();
    const ctx = ctxFor(die);
    const a = flareInside(ctx, die, { amount: 2.5, duration: 900 });
    const b = flareInside(ctx, die, { amount: 0.6, duration: 2000 });
    a.update(0);
    b.update(0);
    a.update(80);
    b.update(80);
    expect(die.uniforms.uInteriorFlare.value).toBe(1); // capped
    // a ends: b's own level takes over (not a's leftover, not zero)
    b.update(900);
    a.update(900);
    const bLevel = 0.6 * flareLevel(900, 2000, false);
    expect(die.uniforms.uInteriorFlare.value).toBeCloseTo(bLevel, 5);
    b.update(1000);
    expect(die.uniforms.uInteriorFlare.value).toBeCloseTo(0.6 * flareLevel(1000, 2000, false), 5);
    b.stop();
    expect(die.uniforms.uInteriorFlare.value).toBe(0);
  });

  test('a weaker flare during a strong one does not lower it', () => {
    const die = insideDie();
    const ctx = ctxFor(die);
    const strong = flareInside(ctx, die, { duration: 900 });
    strong.update(0);
    strong.update(80);
    const weak = flareInside(ctx, die, { amount: 0.2, duration: 900 });
    weak.update(80);
    weak.update(160);
    expect(die.uniforms.uInteriorFlare.value).toBeCloseTo(flareLevel(80, 900, false), 5);
  });

  test('reduced motion: the written flare rises over 300 ms', () => {
    const die = insideDie();
    const h = flareInside(ctxFor(die, { reducedMotion: true }), die, { duration: 900 });
    h.update(0);
    h.update(80);
    expect(die.uniforms.uInteriorFlare.value).toBeLessThan(0.5);
    h.update(300);
    expect(die.uniforms.uInteriorFlare.value).toBeGreaterThanOrEqual(0.95);
  });

  test('off / no inside / isolate null -> no write', () => {
    // the insideFlare setting off
    const die = insideDie();
    const isolate = vi.fn((d) => d.uniforms);
    const off = flareInside(
      ctxFor(die, { isolate, setting: (k) => (k === 'insideFlare' ? false : undefined) }),
      die,
      {},
    );
    off.update(0);
    off.update(80);
    expect(off.update(100)).toBe(false);
    expect(die.uniforms.uInteriorFlare.value).toBe(0);
    expect(isolate).not.toHaveBeenCalled();
    // a die whose look has no moving inside (no uInteriorFlare on its material): never isolated
    const plainU = { uFxFlare: { value: 0 } };
    const plain = { uniforms: plainU, inner: { material: { userData: { uniforms: plainU } } } };
    const iso2 = vi.fn((d) => d.uniforms);
    const none = flareInside(ctxFor(plain, { isolate: iso2 }), plain, {});
    none.update(0);
    expect(none.update(80)).toBe(false);
    expect(iso2).not.toHaveBeenCalled();
    expect(plainU.uInteriorFlare).toBeUndefined();
    // isolate returns null (a ghost, a fading roll)
    const d3 = insideDie();
    const nul = flareInside(ctxFor(d3, { isolate: () => null }), d3, {});
    nul.update(0);
    nul.update(80);
    expect(d3.uniforms.uInteriorFlare.value).toBe(0);
    // no die at all
    expect(() => flareInside(ctxFor(null), null, {}).update(0)).not.toThrow();
    // a throwing setting reader counts as on (the layer's setting() never throws; be safe anyway)
    const d4 = insideDie();
    const h4 = flareInside(ctxFor(d4, { setting: undefined }), d4, {});
    h4.update(0);
    h4.update(80);
    expect(d4.uniforms.uInteriorFlare.value).toBeGreaterThan(0.9);
  });

  test('stop() before the end resets the flare; stop twice is harmless', () => {
    const die = insideDie();
    const h = flareInside(ctxFor(die), die, { duration: 900 });
    h.update(0);
    h.update(80);
    h.stop();
    h.stop();
    expect(die.uniforms.uInteriorFlare.value).toBe(0);
    expect(h.update(100)).toBe(false);
  });
});
