import { readFileSync } from 'node:fs';

const WASM = 'node_modules/@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm';
const bytes = readFileSync(WASM);

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

function fakeFetch() {
  return vi.fn(async () => ({
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  }));
}

test('a URL whose instantiateStreaming rejects (wrong MIME type) falls back to instantiate(arrayBuffer)', async () => {
  const fetch = fakeFetch();
  vi.stubGlobal('fetch', fetch);
  const streaming = vi
    .spyOn(WebAssembly, 'instantiateStreaming')
    .mockRejectedValue(new TypeError("Incorrect response MIME type. Expected 'application/wasm'."));
  const instantiate = vi.spyOn(WebAssembly, 'instantiate');
  const { initPhysics, createSim } = await import('../../src/physics/sim.js');
  await expect(initPhysics('https://example.test/rapier.wasm')).resolves.toBeUndefined();
  expect(streaming).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenLastCalledWith('https://example.test/rapier.wasm');
  expect(instantiate).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.any(Object));
  createSim({ halfWidth: 5, halfDepth: 5 }, {}).dispose(); // the wasm is really live
});

test('without instantiateStreaming at all, a URL still loads through instantiate(arrayBuffer)', async () => {
  const fetch = fakeFetch();
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(WebAssembly, 'instantiateStreaming').mockImplementation(() => {
    throw new TypeError('not supported');
  });
  const { initPhysics } = await import('../../src/physics/sim.js');
  await expect(initPhysics('/rapier.wasm')).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(2);
});
