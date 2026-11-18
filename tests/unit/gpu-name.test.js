import { gpuName } from '../../src/render/gpu-name.js';

const gl = (unmasked) => ({
  RENDERER: 0x1f01,
  getParameter: (p) => (p === 0x1f01 ? 'Generic Renderer' : p === 0x9246 ? unmasked : null),
  getExtension: vi.fn(() => (unmasked ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null)),
});

test('Firefox: RENDERER, never the deprecated debug extension; others: the unmasked name, else RENDERER', () => {
  const ff = gl('ANGLE (NVIDIA)');
  expect(gpuName(ff, 'Mozilla/5.0 Gecko/20100101 Firefox/140.0')).toBe('Generic Renderer');
  expect(ff.getExtension).not.toHaveBeenCalled();
  expect(gpuName(gl('ANGLE (NVIDIA)'), 'Chrome/140')).toBe('ANGLE (NVIDIA)');
  expect(gpuName(gl(null), 'Chrome/140')).toBe('Generic Renderer');
  expect(gpuName(null)).toBe('');
});
