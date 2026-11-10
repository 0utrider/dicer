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

describe('render target binding and compile exits', () => {
  function trackingRenderer(gl, { compile } = {}) {
    const prev = { id: 'canvas-target' };
    const r = {
      current: prev,
      prev,
      bound: [],
      getContext: () => gl,
      getRenderTarget: () => r.current,
      setRenderTarget: (t) => {
        r.current = t;
      },
      compileAsync: vi.fn((...args) => {
        r.bound.push(['compile', r.current]);
        return compile ? compile(...args) : Promise.resolve();
      }),
      render: () => r.bound.push(['render', r.current]),
    };
    return r;
  }

  test('the probe target is bound only around the synchronous blocks, never across an await', async () => {
    const gl = fakeGl({ timer: true });
    let release;
    const r = trackingRenderer(gl, { compile: () => new Promise((res) => (release = res)) });
    let polls = 0;
    const atPoll = [];
    gl.getQueryParameter = (q, p) => {
      if (p === 3) {
        atPoll.push(r.current); // the timer poll runs between awaits
        return ++polls > 2;
      }
      return 1e6;
    };
    const pending = runProbe(r, { frames: 2, atlas });
    await Promise.resolve();
    expect(r.compileAsync).toHaveBeenCalledTimes(1);
    // compiled for the probe target (program params depend on it), then restored while pending
    expect(r.bound[0][1]).not.toBe(r.prev);
    expect(r.current).toBe(r.prev);
    release();
    const res = await pending;
    expect(res.msPerFrame).toBeCloseTo(1);
    expect(r.bound.filter(([k]) => k === 'render').every(([, t]) => t !== r.prev)).toBe(true);
    expect(r.current).toBe(r.prev);
    expect(polls).toBeGreaterThan(2);
    expect(atPoll.every((t) => t === r.prev)).toBe(true);
  });

  test('a context lost during the compile falls back to medium and is not cached', async () => {
    const gl = fakeGl();
    const canvas = new EventTarget();
    const r = trackingRenderer(gl, { compile: () => new Promise(() => {}) });
    r.domElement = canvas;
    const pending = runProbe(r, { frames: 2, atlas });
    await Promise.resolve();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    await expect(pending).resolves.toEqual({ msPerFrame: 16, gpu: 'unknown' });
    expect(localStorage.getItem('dicer.probe.v1')).toBeNull();
    expect(r.current).toBe(r.prev);
  });

  test('a compile that never finishes times out to the fallback, uncached', async () => {
    vi.useFakeTimers();
    try {
      const gl = fakeGl();
      const r = trackingRenderer(gl, { compile: () => new Promise(() => {}) });
      const pending = runProbe(r, { frames: 2, atlas, compileTimeoutMs: 300 });
      await vi.advanceTimersByTimeAsync(301);
      await expect(pending).resolves.toEqual({ msPerFrame: 16, gpu: 'unknown' });
      expect(localStorage.getItem('dicer.probe.v1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
