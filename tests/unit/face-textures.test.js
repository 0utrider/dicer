/** @vitest-environment jsdom */
import * as THREE from 'three';
import { createFaceTextures } from '../../src/render/face-textures.js';

const SIZE = 8;

function stubCanvas() {
  const ctx = {
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((t) => ({ width: t.length * 4 })),
    getImageData: vi.fn((x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(200) })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
  return ctx;
}

const image = (url) => ({ kind: 'image', url });
const faceSet = {
  key: 'sys|d6|abc',
  labels: [
    { kind: 'glyph', text: '1' },
    image('a.png'),
    { kind: 'blank' },
    { kind: 'text', text: '+' },
    image('b.webp'),
    { kind: 'glyph', text: '6' },
  ],
};

let ctx;
beforeEach(() => {
  ctx = stubCanvas();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('3 raster faces give 3 layers; glyph and blank faces get -1', async () => {
  const loadImage = vi.fn(async () => ({ naturalWidth: 16, naturalHeight: 8 }));
  const ft = createFaceTextures({ loadImage, size: SIZE });
  const { texture, layers, tint } = await ft.acquire(faceSet);
  expect(texture).toBeInstanceOf(THREE.DataArrayTexture);
  expect(texture.image.depth).toBe(3);
  expect(texture.image.width).toBe(SIZE);
  expect(texture.image.data.length).toBe(SIZE * SIZE * 4 * 3);
  expect(Array.from(layers)).toEqual([-1, 0, -1, 1, 2, -1]);
  expect(Array.from(tint)).toEqual([0, 0, 0, 1, 0, 0]);
  // images fitted (2:1 -> full width, half height, centred); text drawn white
  expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 2, 8, 4);
  expect(ctx.fillText).toHaveBeenCalledWith('+', expect.any(Number), expect.any(Number));
  expect(ctx.fillStyle).toBe('#ffffff');
  expect(ctx.font).toContain('DM Serif Display');
});

test('acquiring twice builds once; releasing both drops the cache', async () => {
  const loadImage = vi.fn(async () => ({ width: 4, height: 4 }));
  const ft = createFaceTextures({ loadImage, size: SIZE });
  const a = await ft.acquire(faceSet);
  const b = await ft.acquire(faceSet);
  expect(b).toBe(a);
  expect(loadImage).toHaveBeenCalledTimes(2); // two image faces, one build
  const dispose = vi.spyOn(a.texture, 'dispose');
  ft.release(faceSet);
  expect(ft.size).toBe(1);
  expect(dispose).not.toHaveBeenCalled();
  ft.release(faceSet);
  expect(ft.size).toBe(0);
  expect(dispose).toHaveBeenCalledTimes(1);
  await ft.acquire(faceSet);
  expect(loadImage).toHaveBeenCalledTimes(4); // rebuilt
});

test('a text symbol is fitted and centred by its ink box', async () => {
  // ink: 0.5 em wide, 0.1 em tall, 0.3 em above the baseline (a dash)
  ctx.measureText.mockImplementation(function () {
    const px = parseFloat(this.font);
    return {
      width: px * 0.6,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: px * 0.5,
      actualBoundingBoxAscent: px * 0.3,
      actualBoundingBoxDescent: -px * 0.2,
    };
  });
  const ft = createFaceTextures({ size: 100 });
  await ft.acquire({ key: 't', labels: [{ kind: 'text', text: '-' }] });
  const px = parseFloat(ctx.font);
  expect(px * 0.5).toBeCloseTo(55); // the larger side spans 0.55 of the square
  const [, x, y] = ctx.fillText.mock.calls[0];
  expect(x).toBeCloseTo((100 - px * 0.5) / 2);
  expect(y).toBeCloseTo((100 - px * 0.1) / 2 + px * 0.3);
});

test('the font loads once before text is drawn', async () => {
  const loadFont = vi.fn(async () => {});
  const ft = createFaceTextures({ loadImage: async () => ({}), loadFont, size: SIZE });
  await ft.acquire(faceSet);
  await ft.acquire({ ...faceSet, key: 'other' });
  expect(loadFont).toHaveBeenCalledTimes(1);
});

test('failed and slow faces fall back', async () => {
  vi.useFakeTimers();
  const warn = vi.fn();
  const loadImage = vi.fn((url) =>
    url === 'a.png' ? Promise.reject(new Error('404')) : new Promise(() => {}),
  );
  const ft = createFaceTextures({ loadImage, size: SIZE, timeoutMs: 4000, warn });
  const set = { key: 'k', labels: [image('a.png'), image('b.webp')] };
  let result = null;
  ft.acquire(set).then((r) => (result = r));
  await vi.advanceTimersByTimeAsync(3999);
  expect(result).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(result).not.toBeNull();
  expect(Array.from(result.layers)).toEqual([-1, -1]);
  expect(result.texture).toBeNull();
  expect(warn).toHaveBeenCalledTimes(2);
  expect(warn.mock.calls.map((c) => c[0]).join()).toContain('a.png');
  expect(warn.mock.calls.map((c) => c[0]).join()).toContain('b.webp');
  // one warning per URL, also across builds
  ft.release(set);
  ft.acquire(set);
  await vi.advanceTimersByTimeAsync(4000);
  expect(warn).toHaveBeenCalledTimes(2);
});

test('a tinted image face is a mask in the number colour, like text', async () => {
  const ft = createFaceTextures({ loadImage: vi.fn(async () => ({ width: 4, height: 4 })), size: SIZE });
  const set = { key: 'look|d6|1|x', labels: [image('a.png'), { ...image('b.png'), tint: true }] };
  const { tint } = await ft.acquire(set);
  expect(Array.from(tint)).toEqual([0, 1]);
});

test('atlas frames: one load per sheet, each face drawn from its rectangle', async () => {
  const loadImage = vi.fn(async () => ({ naturalWidth: 128, naturalHeight: 64 }));
  const ft = createFaceTextures({ loadImage, size: SIZE });
  const set = { key: 'atlas', labels: [image('s.webp#xywh=0,0,64,64'), image('s.webp#xywh=64,0,64,32')] };
  const { layers } = await ft.acquire(set);
  expect(Array.from(layers)).toEqual([0, 1]);
  expect(loadImage).toHaveBeenCalledTimes(1);
  expect(loadImage).toHaveBeenCalledWith('s.webp');
  expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 64, 64, 0, 0, 8, 8);
  expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 64, 0, 64, 32, 0, 2, 8, 4);
});
