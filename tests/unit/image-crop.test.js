/** @vitest-environment jsdom */
import { splitCrop, cropImage } from '../../src/render/image-crop.js';

test('splitCrop: an #xywh frame is the sheet url and its rectangle; anything else loads as given', () => {
  expect(splitCrop('modules/m/sheet.webp#xywh=64,0,32,16')).toEqual({
    src: 'modules/m/sheet.webp',
    crop: [64, 0, 32, 16],
  });
  expect(splitCrop('modules/m/a.webp')).toEqual({ src: 'modules/m/a.webp', crop: null });
  expect(splitCrop('modules/m/a.webp#xywh=1,1,0,4').crop).toBeNull(); // an empty rectangle is no crop
});

test('cropImage draws the rectangle onto a canvas of its size', () => {
  const ctx = { drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
  const img = {};
  const canvas = cropImage(img, [64, 0, 32, 16]);
  expect([canvas.width, canvas.height]).toEqual([32, 16]);
  expect(ctx.drawImage).toHaveBeenCalledWith(img, 64, 0, 32, 16, 0, 0, 32, 16);
  vi.restoreAllMocks();
});
