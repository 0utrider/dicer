import * as THREE from 'three';
import { parseAtlas, layoutLabel } from '../../src/render/sdf-atlas.js';
import {
  buildAtlas,
  cropGlyph,
  rasterSteps,
  runSliced,
  cssString,
  DISTANCE_RANGE,
  SUPERSAMPLE,
  GLYPHS,
} from '../../src/fonts/sdf-builder.js';
import {
  createFontAtlases,
  fontFileUrl,
  fontSource,
  FONT_TIMEOUT_MS,
  GENERATOR_VERSION,
  dataTextureAtlas,
} from '../../src/fonts/font-atlas.js';
import { createFontBuilder } from '../../src/fonts/font-builder.js';

const S = SUPERSAMPLE;
const PAD = DISTANCE_RANGE / 2; // atlas px of distance margin around each glyph box

/** A full-canvas alpha raster with `inside(x, y)` filled (pixel centres). */
function raster(cw, ch, inside) {
  const a = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) a[y * cw + x] = inside(x + 0.5, y + 0.5) ? 255 : 0;
  return a;
}
const CW = 400;
const CH = 400;
const BASE_Y = 300;
const PEN_X = 80;
// a 120 x 200 raster-px digit box sitting on the baseline, aligned to the supersample grid
const RECT = { x0: 100, x1: 220, y0: 100, y1: 300 };
const inRect = (r) => (x, y) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
const ring = (x, y) => {
  const d = Math.hypot(x - 160, y - 200);
  return d >= 60 && d < 100;
};

function syntheticGlyphs() {
  return [...GLYPHS].map((char) => {
    const shape =
      char === '0'
        ? ring
        : char === '_'
          ? inRect({ x0: 100, x1: 220, y0: 312, y1: 332 })
          : inRect(RECT);
    return cropGlyph(raster(CW, CH, shape), CW, CH, {
      char,
      penX: PEN_X,
      baseY: BASE_Y,
      advance: 160,
    });
  });
}

/** The 0..255 field value of atlas pixel (x, y) in image space (row 0 at the top). */
function at(built, x, y) {
  const row = built.height - 1 - y; // data rows are bottom-up (GL convention)
  return built.field[row * built.width + x];
}

describe('SDF builder (pure)', () => {
  const built = buildAtlas(syntheticGlyphs(), { face: 'Test' });
  const atlas = parseAtlas(built.json);
  const box = (ch) => built.json.chars.find((c) => c.char === ch);

  test('the field is above 0.5 inside the ink and below it outside', () => {
    const g = box('5');
    // ink spans 120 x 200 raster px = 30 x 50 atlas px inside a PAD margin
    expect(g.width).toBe(30 + 2 * PAD);
    expect(g.height).toBe(50 + 2 * PAD);
    const inside = at(built, g.x + PAD + 15, g.y + PAD + 25);
    const outside = at(built, g.x, g.y);
    expect(inside).toBeGreaterThan(128);
    expect(outside).toBeLessThan(128);
  });

  test('the texture stores the one field in R, G and B (the shader median gives it back)', () => {
    const atlas3 = dataTextureAtlas(built);
    const tex = atlas3.texture;
    expect(tex.flipY).toBe(false);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.colorSpace).toBe(THREE.NoColorSpace);
    const px = tex.image.data;
    expect(px.length).toBe(built.width * built.height * 4);
    for (let i = 0; i < built.field.length; i += 97) {
      expect([px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]]).toEqual([
        built.field[i],
        built.field[i],
        built.field[i],
        255,
      ]);
    }
    expect(atlas3.distanceRange).toBe(DISTANCE_RANGE);
    expect(atlas3.glyphs.has('.')).toBe(true);
    tex.dispose();
  });

  test('distanceRange keeps its atlas-pixel meaning: 0.5 + d / range', () => {
    const g = box('7');
    const y = g.y + PAD + 25;
    // the pixel just outside the left ink edge has its centre 0.5 atlas px out, the next 1.5 px
    expect(at(built, g.x + PAD - 1, y)).toBeCloseTo(255 * (0.5 - 0.5 / DISTANCE_RANGE), -0.6);
    expect(at(built, g.x + PAD - 2, y)).toBeCloseTo(255 * (0.5 - 1.5 / DISTANCE_RANGE), -0.6);
    expect(at(built, g.x + PAD, y)).toBeCloseTo(255 * (0.5 + 0.5 / DISTANCE_RANGE), -0.6);
  });

  test('a ring has a hole: outside in the middle, inside on the band', () => {
    const g = box('0');
    const cx = g.x + g.width / 2;
    const cy = g.y + g.height / 2;
    expect(at(built, Math.floor(cx), Math.floor(cy))).toBeLessThan(128);
    expect(at(built, Math.floor(cx + 80 / S), Math.floor(cy))).toBeGreaterThan(128); // band at r = 80 raster px
  });

  test('the JSON parses with parseAtlas and lays out with layoutLabel', () => {
    expect(built.json.distanceField.distanceRange).toBe(DISTANCE_RANGE);
    for (const c of '0123456789.') expect(atlas.glyphs.has(c)).toBe(true);
    expect(atlas.glyphs.has('_')).toBe(false); // stored under '.', like build-sdf.mjs
    expect(atlas.digitHeight).toBe(50);
    expect(atlas.scaleW).toBe(built.width);
    expect(atlas.scaleH).toBe(built.height);
    expect(built.field.length).toBe(built.width * built.height);
    const two = layoutLabel('20', atlas);
    expect(two[2]).toBeLessThanOrEqual(two[8] + 1e-6); // side by side
    const six = layoutLabel('6.', atlas);
    expect(six[8 + 4]).toBe(-1); // the underline is the box mark
    expect(six[8 + 5]).toBeLessThan(six[1]); // below the digit
    // the digit's ink box is centred and as tall as `size`
    const g = atlas.glyphs.get('7');
    expect(g.yoffset).toBeGreaterThanOrEqual(0);
  });

  test('glyph boxes never overlap in the atlas', () => {
    const cs = built.json.chars;
    for (const a of cs)
      for (const b of cs)
        if (a !== b) {
          const apart =
            a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y;
          expect(apart).toBe(true);
        }
  });

  test('an empty raster gives no glyph', () => {
    expect(
      cropGlyph(new Uint8Array(CW * CH), CW, CH, { char: '1', penX: 0, baseY: 300, advance: 10 }),
    ).toBeNull();
  });

  test('cssString escapes what could end a CSS string', () => {
    expect(cssString('a"b\\c\nd')).toBe('a\\22 b\\5c c\\a d');
  });
});

/** A 2D context stub: the font draws a filled rect per glyph; widths differ per fallback. */
function fakeCanvas({ has = () => true } = {}) {
  let font = '';
  const cv = { width: 0, height: 0 };
  let drawn = null;
  cv.getContext = () => ({
    set font(f) {
      font = f;
    },
    get font() {
      return font;
    },
    fillStyle: '',
    textBaseline: '',
    clearRect() {
      drawn = null;
    },
    fillRect() {},
    fillText(ch, x, y) {
      drawn = { ch, x, y };
    },
    measureText(ch) {
      const own = has(ch) && /"Fam"/.test(font);
      const width = own ? 100 : /monospace/.test(font) ? 154 : 128;
      return { width };
    },
    getImageData(x0, y0, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      if (drawn) {
        const px = Number(/(\d+)px/.exec(font)[1]);
        for (let y = Math.round(drawn.y - px * 0.7); y < drawn.y; y++)
          for (let x = Math.round(drawn.x); x < drawn.x + px * 0.4; x++)
            data[(y * w + x) * 4 + 3] = 255;
      }
      return { data, width: w, height: h };
    },
  });
  return cv;
}
describe('glyph raster', () => {
  test('rasterSteps draws 0-9 and _ and returns cropped glyphs', () => {
    const it = rasterSteps({ family: 'Fam', makeCanvas: () => fakeCanvas() });
    let r;
    let steps = 0;
    while (!(r = it.next()).done) steps++;
    expect(steps).toBeGreaterThanOrEqual(GLYPHS.length);
    expect(r.value.map((g) => g.char).join('')).toBe(GLYPHS);
    const built = buildAtlas(r.value, { face: 'Fam' });
    expect(parseAtlas(built.json).glyphs.size).toBe(11);
  });

  test('a font without a digit (the fallback draws it) fails with code "nodigits"', () => {
    const it = rasterSteps({
      family: 'Fam',
      makeCanvas: () => fakeCanvas({ has: (c) => c !== '7' }),
    });
    expect(() => {
      while (!it.next().done);
    }).toThrow(expect.objectContaining({ code: 'nodigits' }));
  });

  test('a missing underline glyph is synthesized, not a failure', () => {
    const it = rasterSteps({
      family: 'Fam',
      makeCanvas: () => fakeCanvas({ has: (c) => c !== '_' }),
    });
    let r;
    while (!(r = it.next()).done);
    expect(r.value.find((g) => g.char === '_')).toBeTruthy();
  });

  test('runSliced spends at most the budget per idle slice', async () => {
    let t = 0;
    const now = () => t;
    const slices = [];
    const idle = (cb) => setTimeout(() => (slices.push(0), cb()), 0);
    function* work() {
      for (let i = 0; i < 10; i++) {
        t += 3; // each step costs 3 ms
        slices[slices.length - 1]++;
        yield;
      }
      return 'done';
    }
    expect(await runSliced(work(), { idle, now, budgetMs: 8 })).toBe('done');
    expect(Math.max(...slices)).toBeLessThanOrEqual(2); // a third 3 ms step would pass 8 ms
    expect(slices.length).toBeGreaterThanOrEqual(4);
  });
});

describe('font file URLs (the security boundary for file: ids)', () => {
  const origin = 'https://vtt.example';
  const getRoute = (p) => `/game-prefix/${p}`;

  test('routes and encodes, never decodes', () => {
    expect(fontFileUrl('fonts/My Font.ttf', { getRoute, origin })).toBe(
      'https://vtt.example/game-prefix/fonts/My%20Font.ttf',
    );
    expect(fontFileUrl('fonts/%41.ttf', { getRoute, origin })).toBe(
      'https://vtt.example/game-prefix/fonts/%2541.ttf',
    );
    expect(fontFileUrl('fonts/Шрифт.woff2', { getRoute, origin })).toMatch(
      /^https:\/\/vtt\.example\/game-prefix\/fonts\/%D0/,
    );
  });

  test('rejects what normalizeAppearance would reject and anything off-origin', () => {
    expect(fontFileUrl('../x.ttf', { getRoute, origin })).toBeNull();
    expect(fontFileUrl('https://evil.example/x.ttf', { getRoute, origin })).toBeNull();
    expect(fontFileUrl('fonts/x.exe', { getRoute, origin })).toBeNull();
    expect(
      fontFileUrl('fonts/x".ttf', { getRoute: () => '//evil.example/x.ttf', origin }),
    ).toBeNull();
  });

  test('fontSource maps ids to a family (css) or a url and a synthetic family (file)', () => {
    expect(fontSource('css:Comic Neue', { getRoute, origin })).toEqual({
      kind: 'css',
      family: 'Comic Neue',
    });
    const f = fontSource('file:fonts/a.ttf', { getRoute, origin });
    expect(f.kind).toBe('file');
    expect(f.url).toBe('https://vtt.example/game-prefix/fonts/a.ttf');
    expect(f.family).toMatch(/^dicer-font-[a-z0-9]+$/);
    expect(fontSource('css:bad"name', { getRoute, origin })).toBeNull();
    expect(fontSource('file:../a.ttf', { getRoute, origin })).toBeNull();
  });
});

describe('createFontAtlases', () => {
  const serif = { id: 'serif', glyphs: new Map(), texture: new THREE.Texture() };
  const origin = 'https://vtt.example';
  const getRoute = (p) => `/${p}`;
  const fakeBuilt = (n = 1) => ({ json: { n }, width: 4, height: 4, field: new Uint8Array(16) });

  function make(over = {}) {
    const warn = vi.fn();
    const textures = [];
    const build = over.build ?? vi.fn(async () => fakeBuilt());
    const store = over.store ?? { get: vi.fn(async () => undefined), set: vi.fn(async () => {}) };
    const fonts = createFontAtlases({
      serif,
      loadBundled:
        over.loadBundled ?? vi.fn(async (name) => ({ id: name, texture: new THREE.Texture() })),
      build,
      warn,
      store,
      getRoute,
      origin,
      toAtlas: (b) => {
        const texture = new THREE.Texture();
        textures.push(texture);
        return { built: b, texture };
      },
      ...over.opts,
    });
    return { fonts, warn, build, store, textures };
  }

  test('serif is always ready; sans loads its prebuilt atlas lazily, once', async () => {
    const loadBundled = vi.fn(async (name) => ({ id: name, texture: new THREE.Texture() }));
    const { fonts } = make({ loadBundled });
    expect(fonts.get('serif')).toBe(serif);
    expect(loadBundled).not.toHaveBeenCalled();
    expect(fonts.get('sans')).toBeNull();
    const [a, b] = await Promise.all([fonts.request('sans'), fonts.request('sans')]);
    expect(a).toBe(b);
    expect(loadBundled).toHaveBeenCalledTimes(1);
    expect(loadBundled).toHaveBeenCalledWith('sans');
    expect(fonts.get('sans')).toBe(a);
  });

  test('get is null until ready, then the atlas; onReady fires once per font', async () => {
    const { fonts, build } = make();
    const ready = vi.fn();
    fonts.onReady(ready);
    expect(fonts.get('css:Comic Neue')).toBeNull();
    const p1 = fonts.request('css:Comic Neue');
    const p2 = fonts.request('css:Comic Neue');
    expect(fonts.get('css:Comic Neue')).toBeNull();
    const atlas = await p1;
    expect(await p2).toBe(atlas);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0][0]).toEqual({ kind: 'css', family: 'Comic Neue' });
    expect(fonts.get('css:Comic Neue')).toBe(atlas);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledWith('css:Comic Neue');
    await fonts.request('css:Comic Neue');
    expect(ready).toHaveBeenCalledTimes(1);
  });

  test('onReady returns an unsubscribe', async () => {
    const { fonts } = make();
    const ready = vi.fn();
    const off = fonts.onReady(ready);
    off();
    await fonts.request('css:Arial');
    expect(ready).not.toHaveBeenCalled();
  });

  test('LRU: beyond cacheSize the least recently used runtime atlas is evicted and its texture disposed', async () => {
    const { fonts, textures } = make({ opts: { cacheSize: 2 } });
    await fonts.request('css:A');
    await fonts.request('css:B');
    fonts.get('css:A'); // A is now the most recently used
    const disposeB = vi.spyOn(textures[1], 'dispose');
    await fonts.request('css:C');
    expect(disposeB).toHaveBeenCalledTimes(1);
    expect(fonts.get('css:B')).toBeNull();
    expect(fonts.get('css:A')).not.toBeNull();
    expect(fonts.get('css:C')).not.toBeNull();
    expect(fonts.get('serif')).toBe(serif); // never evicted
  });

  test('an evicted font can be requested again (it is not a failure)', async () => {
    const { fonts, build } = make({ opts: { cacheSize: 1 } });
    await fonts.request('css:A');
    await fonts.request('css:B');
    expect(await fonts.request('css:A')).not.toBeNull();
    expect(build).toHaveBeenCalledTimes(3);
  });

  test('a failing font is null forever, with one warning and no retry', async () => {
    const build = vi.fn(async () => {
      throw Object.assign(new Error('no digits'), { code: 'nodigits' });
    });
    const { fonts, warn } = make({ build });
    expect(await fonts.request('css:Wingdings')).toBeNull();
    expect(await fonts.request('css:Wingdings')).toBeNull();
    expect(fonts.get('css:Wingdings')).toBeNull();
    expect(build).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"css:Wingdings"');
  });

  test(`a font that takes longer than ${FONT_TIMEOUT_MS} ms times out: null, one warning, no retry`, async () => {
    vi.useFakeTimers();
    try {
      const build = vi.fn(() => new Promise(() => {}));
      const { fonts, warn } = make({ build });
      const p = fonts.request('file:fonts/slow.ttf');
      await vi.advanceTimersByTimeAsync(FONT_TIMEOUT_MS - 1);
      expect(warn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(await p).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(await fonts.request('file:fonts/slow.ttf')).toBeNull();
      expect(build).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a bad id never reaches the builder: null and one warning', async () => {
    const { fonts, build, warn } = make();
    expect(await fonts.request('file:../../etc/x.ttf')).toBeNull();
    expect(await fonts.request('file:../../etc/x.ttf')).toBeNull();
    expect(await fonts.request('css:<b>')).toBeNull();
    expect(build).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('a sans atlas that cannot load is null with one warning', async () => {
    const loadBundled = vi.fn(async () => {
      throw new Error('404');
    });
    const { fonts, warn } = make({ loadBundled });
    expect(await fonts.request('sans')).toBeNull();
    expect(await fonts.request('sans')).toBeNull();
    expect(loadBundled).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('built atlases are stored by font id + generator version and reused without building', async () => {
    const mem = new Map();
    const store = {
      get: vi.fn(async (k) => mem.get(k)),
      set: vi.fn(async (k, v) => void mem.set(k, v)),
    };
    const first = make({ store });
    await first.fonts.request('css:A');
    expect(store.set).toHaveBeenCalledWith(
      `${GENERATOR_VERSION}|css:A`,
      expect.objectContaining({ width: 4 }),
    );
    const second = make({ store });
    expect(await second.fonts.request('css:A')).not.toBeNull();
    expect(second.build).not.toHaveBeenCalled();
  });

  test('a broken store is ignored: the font still builds', async () => {
    const store = {
      get: vi.fn(async () => Promise.reject(new Error('idb'))),
      set: vi.fn(() => Promise.reject(new Error('idb'))),
    };
    const { fonts, warn } = make({ store });
    expect(await fonts.request('css:A')).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test('dispose frees runtime textures and get gives null afterwards', async () => {
    const { fonts, textures } = make();
    await fonts.request('css:A');
    const d = vi.spyOn(textures[0], 'dispose');
    fonts.dispose();
    expect(d).toHaveBeenCalledTimes(1);
    expect(fonts.get('css:A')).toBeNull();
  });
});

describe('createFontBuilder (where the work runs)', () => {
  /** A fake worker that answers each message with `reply(msg)` (or never, when it returns undefined). */
  function fakeWorker(reply) {
    const w = {
      sent: [],
      terminate: vi.fn(),
      postMessage(msg) {
        w.sent.push(msg);
        queueMicrotask(() => {
          const r = reply(msg);
          if (r) w.onmessage({ data: { id: msg.id, ...r } });
        });
      },
    };
    return w;
  }
  const builtReply = (m) => ({
    ok: true,
    ...buildAtlas(m.glyphs ?? syntheticGlyphs(), { face: m.family }),
  });
  const idle = (cb) => setTimeout(cb, 0);
  const opts = (over) => ({
    idle,
    now: () => 0,
    makeCanvas: () => fakeCanvas(),
    loadFace: vi.fn(async () => {}),
    loadFamily: vi.fn(async () => {}),
    ...over,
  });

  test('css: glyphs are drawn on the main thread; only the distance transform goes to the worker', async () => {
    const w = fakeWorker(builtReply);
    const o = opts({
      createWorker: () => w,
      makeCanvas: vi.fn(() => fakeCanvas({ has: () => true })),
    });
    const b = createFontBuilder(o);
    const built = await b.build({ kind: 'css', family: 'Fam' });
    expect(o.loadFamily).toHaveBeenCalledWith('Fam');
    expect(o.makeCanvas).toHaveBeenCalled();
    expect(w.sent.map((m) => m.type)).toEqual(['sdf']);
    expect(w.sent[0].glyphs).toHaveLength(GLYPHS.length);
    expect(parseAtlas(built.json).glyphs.size).toBe(11);
  });

  test('file: the worker loads, draws and transforms; the main thread does nothing', async () => {
    const w = fakeWorker(builtReply);
    const o = opts({ createWorker: () => w, makeCanvas: vi.fn() });
    const built = await createFontBuilder(o).build({
      kind: 'file',
      family: 'dicer-font-x',
      url: 'https://vtt.example/a.ttf',
    });
    expect(w.sent).toEqual([
      expect.objectContaining({
        type: 'build',
        family: 'dicer-font-x',
        url: 'https://vtt.example/a.ttf',
      }),
    ]);
    expect(o.makeCanvas).not.toHaveBeenCalled();
    expect(o.loadFace).not.toHaveBeenCalled();
    expect(built.width).toBeGreaterThan(0);
  });

  test('file: a worker without OffscreenCanvas / FontFace hands the drawing to the main thread', async () => {
    const w = fakeWorker((m) =>
      m.type === 'build' ? { ok: false, code: 'unsupported', message: 'no' } : builtReply(m),
    );
    const o = opts({ createWorker: () => w });
    const src = { kind: 'file', family: 'Fam', url: 'https://vtt.example/a.ttf' }; // the fake canvas draws "Fam"
    await createFontBuilder(o).build(src);
    expect(o.loadFace).toHaveBeenCalledWith(src);
    expect(w.sent.map((m) => m.type)).toEqual(['build', 'sdf']);
  });

  test('file: a font that cannot load or lacks digits fails (no main-thread retry)', async () => {
    const w = fakeWorker(() => ({ ok: false, code: 'nodigits', message: 'the font has no "7"' }));
    const o = opts({ createWorker: () => w });
    await expect(
      createFontBuilder(o).build({ kind: 'file', family: 'f', url: 'https://vtt.example/a.ttf' }),
    ).rejects.toMatchObject({ code: 'nodigits' });
    expect(o.loadFace).not.toHaveBeenCalled();
  });

  test('no worker: everything runs on the main thread in idle slices', async () => {
    const o = opts({ createWorker: null });
    const built = await createFontBuilder(o).build({ kind: 'css', family: 'Fam' });
    expect(parseAtlas(built.json).glyphs.size).toBe(11);
    const f = await createFontBuilder(opts({ createWorker: () => null })).build({
      kind: 'file',
      family: 'Fam',
      url: 'https://vtt.example/a.ttf',
    });
    expect(f.field.length).toBe(f.width * f.height);
  });

  test('a worker that crashes mid-job: the pending job finishes on the main thread, later jobs too', async () => {
    const w = fakeWorker(() => undefined);
    const o = opts({ createWorker: vi.fn(() => w) });
    const b = createFontBuilder(o);
    const p = b.build({ kind: 'css', family: 'Fam' });
    await vi.waitFor(() => expect(w.sent).toHaveLength(1));
    w.onerror({ message: 'boom', preventDefault() {} });
    expect((await p).width).toBeGreaterThan(0);
    expect(w.terminate).toHaveBeenCalled();
    await b.build({ kind: 'css', family: 'Fam' });
    expect(o.createWorker).toHaveBeenCalledTimes(1);
    expect(w.sent).toHaveLength(1);
  });
});
