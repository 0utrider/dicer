/**
 * Dice So Nice atlases, loaded only when a module registers one (registry.js fromAtlas): a preset's
 * labels or a texture's source name frames of one sheet.
 */
const isObj = (v) => v !== null && typeof v === 'object';
const isStr = (v) => typeof v === 'string' && v.length > 0;
export const fetchJson = (url) =>
  fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
export const SAFE_FILE = /^[^:<>"#?\\]+$/;
const px = (v) => (Number.isInteger(v) && v >= 0 && v < 1e5 ? v : null);

/**
 * A Dice So Nice atlas (a TexturePacker JSON hash: {frames: {name: {frame: {x, y, w, h}}}, meta:
 * {image}}) as {frame name: the sheet's path + #xywh=x,y,w,h}, the form face and body images crop
 * by (render/image-crop.js). The sheet sits beside the JSON. Rotated or unsafe frames are left out.
 */
export function atlasFrames(json, atlasPath) {
  const out = new Map();
  const image = json?.meta?.image;
  if (
    !isStr(image) ||
    !SAFE_FILE.test(image) ||
    image.split('/').includes('..') ||
    !isObj(json.frames)
  )
    return out;
  const sheet = atlasPath.slice(0, atlasPath.lastIndexOf('/') + 1) + image;
  for (const [name, f] of Object.entries(json.frames)) {
    const r = f?.frame;
    const xywh = [r?.x, r?.y, r?.w, r?.h].map(px);
    if (f.rotated || xywh.includes(null) || !xywh[2] || !xywh[3]) continue;
    out.set(name, `${sheet}#xywh=${xywh.join(',')}`);
  }
  return out;
}
