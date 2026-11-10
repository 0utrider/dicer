// @vitest-environment jsdom
import { runProbe } from '../../src/render/gpu-probe.js';

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
