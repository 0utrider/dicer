// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { runProbe } from '../../src/render/gpu-probe.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

function fakeGl({ timer = false } = {}) {
  const calls = [];
  const gl = {
    calls,
    RGBA: 1,
    UNSIGNED_BYTE: 2,
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension: (n) =>
      timer && n === 'EXT_disjoint_timer_query_webgl2'
        ? { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 }
        : null,
    getParameter: () => false,
    finish: () => calls.push('finish'),
    readPixels: () => calls.push('readPixels'),
    createQuery: () => ({ id: calls.length }),
    beginQuery: () => calls.push('begin'),
    endQuery: () => calls.push('end'),
    deleteQuery: (q) => calls.push(['delete', q]),
    getQueryParameter: (q, p) => (p === 3 ? true : 1e6),
  };
  return gl;
}

function fakeRenderer(gl, render = () => {}) {
  return {
    getContext: () => gl,
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    compileAsync: async () => {},
    render,
  };
}

test('a renderer whose getContext throws resolves to the medium fallback', async () => {
  const renderer = {
    getContext() {
      throw new Error('no gl');
    },
  };
  await expect(runProbe(renderer, { frames: 2, atlas: {} })).resolves.toEqual({
    msPerFrame: 16,
    gpu: 'unknown',
  });
});

test('wall-clock fallback reads pixels back before taking the end timestamp', async () => {
  const gl = fakeGl();
  const order = [];
  vi.spyOn(performance, 'now').mockImplementation(() => {
    order.push('now');
    return order.length;
  });
  gl.readPixels = () => order.push('readPixels');
  const res = await runProbe(fakeRenderer(gl), { frames: 2, atlas });
  expect(res.gpu).toBe('unknown');
  const i = order.indexOf('readPixels');
  expect(i).toBeGreaterThan(-1);
  expect(order.slice(0, i).filter((x) => x === 'now').length).toBe(1); // start stamp only
  expect(order.slice(i).includes('now')).toBe(true); // end stamp after the readback
});

test('an open timer query is deleted when render throws', async () => {
  const gl = fakeGl({ timer: true });
  let n = 0;
  const renderer = fakeRenderer(gl, () => {
    if (++n === 2) throw new Error('boom'); // first frame of the timed loop
  });
  const res = await runProbe(renderer, { frames: 3, atlas });
  expect(res).toEqual({ msPerFrame: 16, gpu: 'unknown' });
  expect(gl.calls.filter((c) => Array.isArray(c) && c[0] === 'delete').length).toBe(1);
  expect(gl.calls).toContain('end');
});
