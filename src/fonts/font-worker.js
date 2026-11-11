// The font worker (its own lazy chunk): builds single-channel SDF digit atlases off the main thread.
//
//   { type: 'build', id, family, url }  load the font file (FontFace on self.fonts), draw the
//                                        glyphs on an OffscreenCanvas, build the atlas
//   { type: 'sdf', id, glyphs, family } build the atlas from glyphs drawn on the main thread
//
// Replies { id, ok: true, json, width, height, field } (field transferred) or
// { id, ok: false, code, message }; code 'unsupported' means "do it on the main thread".
import { rasterSteps, buildAtlasSteps, drain, cssString, FontError } from './sdf-builder.js';

async function glyphsOf(m) {
  if (m.type === 'sdf') return m.glyphs;
  if (m.type !== 'build') throw new FontError('error', `unknown message ${String(m.type)}`);
  if (typeof OffscreenCanvas !== 'function' || typeof FontFace !== 'function' || !self.fonts?.add) {
    throw new FontError('unsupported', 'no OffscreenCanvas or FontFace in this worker');
  }
  const face = new FontFace(m.family, `url("${cssString(m.url)}")`);
  try {
    self.fonts.add(await face.load());
  } catch (err) {
    throw new FontError('load', `cannot load the font file (${err?.message ?? err})`);
  }
  return drain(rasterSteps({ family: m.family, makeCanvas: (w, h) => new OffscreenCanvas(w, h) }));
}

self.onmessage = async (e) => {
  const m = e.data ?? {};
  try {
    const glyphs = await glyphsOf(m);
    const out = drain(buildAtlasSteps(glyphs, { face: m.family ?? 'font' }));
    self.postMessage({ id: m.id, ok: true, ...out }, [out.field.buffer]);
  } catch (err) {
    self.postMessage({
      id: m.id,
      ok: false,
      code: err?.code ?? 'error',
      message: String(err?.message ?? err),
    });
  }
};
