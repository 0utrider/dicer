/**
 * Images cut from a sheet: a path ending in #xywh=x,y,w,h (a media fragment) is that rectangle of
 * the image at the path before it. Dicer writes this form for the frames of a Dice So Nice atlas
 * (compat/registry.js atlasFrames); face and body images load the sheet and crop.
 */
const XYWH = /#xywh=(\d+),(\d+),(\d+),(\d+)$/;

/** {src, crop}: the url to load and the rectangle [x, y, w, h] to cut from it, or null. */
export function splitCrop(url) {
  const m = XYWH.exec(url);
  if (!m) return { src: url, crop: null };
  const crop = m.slice(1).map(Number);
  return { src: url.slice(0, m.index), crop: crop[2] > 0 && crop[3] > 0 ? crop : null };
}

/** The rectangle of `img` as a canvas of its own size. */
export function cropImage(img, [x, y, w, h]) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas context');
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return canvas;
}
