import zlib from 'node:zlib';

/**
 * NODE ONLY: finishing a .glb written by three's GLTFExporter in a browser.
 *
 *   const { glb, report } = finishGlb(exportedBytes, { rgba: textureBytes });
 *
 * 1. The alpha-0 PNG wipe: GLTFExporter turns a DataTexture into PNG through a 2D canvas, and a
 *    canvas stores premultiplied colour, so every texel with alpha 0 (the untinted, painted parts:
 *    muzzles, noses, mouths...) comes out BLACK. finishGlb decodes the embedded PNG, compares it with
 *    the original RGBA and, if they differ, swaps in a lossless PNG encoded here.
 * 2. Sparse shape keys: GLTFExporter writes every morph target densely; most of each is zero.
 *    finishGlb rewrites them as sparse accessors (GLTFLoader reads them) and repacks the buffer,
 *    which saves ~40 % of a pet's file.
 */

const crcT = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcT[n] = c >>> 0;
}
const crc = (b) => {
  let x = 0xffffffff;
  for (const v of b) x = crcT[(x ^ v) & 255] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
};

/** Decodes an 8-bit RGB/RGBA PNG (any filter): { w, h, ch, px }. */
export function decodePng(buf) {
  let o = 8;
  let w;
  let h;
  let ct;
  const idat = [];
  while (o < buf.length) {
    const l = buf.readUInt32BE(o);
    const t = buf.toString('ascii', o + 4, o + 8);
    const d = buf.subarray(o + 8, o + 8 + l);
    if (t === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      ct = d[9];
    }
    if (t === 'IDAT') idat.push(d);
    if (t === 'IEND') break;
    o += 12 + l;
  }
  const ch = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * ch);
  const st = w * ch;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)];
    for (let x = 0; x < st; x++) {
      const v = raw[y * (st + 1) + 1 + x];
      const a = x >= ch ? out[y * st + x - ch] : 0;
      const u = y ? out[(y - 1) * st + x] : 0;
      const c = x >= ch && y ? out[(y - 1) * st + x - ch] : 0;
      let r = v;
      if (f === 1) r += a;
      else if (f === 2) r += u;
      else if (f === 3) r += (a + u) >> 1;
      else if (f === 4) {
        const p = a + u - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - u);
        const pc = Math.abs(p - c);
        r += pa <= pb && pa <= pc ? a : pb <= pc ? u : c;
      }
      out[y * st + x] = r & 255;
    }
  }
  return { w, h, ch, px: out };
}

/** A lossless RGBA PNG (non-premultiplied, so colour under alpha 0 survives). */
export function encodePng(rgba, w, h) {
  const st = w * 4;
  const raw = Buffer.alloc((st + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (st + 1)] = 1; // Sub filter
    for (let x = 0; x < st; x++) raw[y * (st + 1) + 1 + x] = (rgba[y * st + x] - (x >= 4 ? rgba[y * st + x - 4] : 0)) & 255;
  }
  const chunk = (t, d) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Splits a .glb into { json, bin }. */
export function parseGlb(glb) {
  const jl = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jl).toString());
  const bo = 20 + jl + 8;
  const bin = glb.subarray(bo, bo + glb.readUInt32LE(20 + jl));
  return { json, bin };
}

/**
 * Rebuilds a .glb from json and a list of buffer views' bytes: views[i] is the content of
 * json.bufferViews[i] (or null if unused); unused views are dropped and indices remapped.
 */
export function buildGlb(json, views) {
  const parts = [];
  let o = 0;
  const remap = new Map();
  const out = [];
  json.bufferViews.forEach((v, i) => {
    if (!views[i]) return;
    while (o % 4) {
      parts.push(Buffer.alloc(1));
      o++;
    }
    remap.set(i, out.length);
    const nv = { ...v, byteOffset: o, byteLength: views[i].length };
    out.push(nv);
    parts.push(views[i]);
    o += views[i].length;
  });
  while (o % 4) {
    parts.push(Buffer.alloc(1));
    o++;
  }
  json.bufferViews = out;
  for (const a of json.accessors ?? []) {
    if (a.bufferView !== undefined) a.bufferView = remap.get(a.bufferView);
    if (a.sparse) {
      a.sparse.indices.bufferView = remap.get(a.sparse.indices.bufferView);
      a.sparse.values.bufferView = remap.get(a.sparse.values.bufferView);
    }
  }
  for (const im of json.images ?? []) if (im.bufferView !== undefined) im.bufferView = remap.get(im.bufferView);
  const bin = Buffer.concat(parts);
  json.buffers[0].byteLength = bin.length;
  let js = Buffer.from(JSON.stringify(json));
  while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
  const hdr = Buffer.alloc(12);
  hdr.writeUInt32LE(0x46546c67, 0);
  hdr.writeUInt32LE(2, 4);
  hdr.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(js.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([hdr, jh, js, bh, bin]);
}

/**
 * Fixes the base colour PNG (see the header) and makes the shape keys sparse.
 * @param {Buffer} glb GLTFExporter's binary output
 * @param {{rgba?: Uint8Array|Buffer, image?: number}} [o] the texture's original RGBA bytes
 *   (DataTexture.image.data) and which glTF image it is (default 0)
 * @returns {{glb: Buffer, report: object}}
 */
export function finishGlb(glb, { rgba = null, image = 0 } = {}) {
  const { json, bin } = parseGlb(Buffer.from(glb));
  const report = {};
  const views = json.bufferViews.map((v) => bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
  // 1. the PNG
  if (rgba && json.images?.[image]) {
    const vi = json.images[image].bufferView;
    const d = decodePng(views[vi]);
    let bad = 0;
    for (let i = 0; i < d.w * d.h; i++)
      for (let k = 0; k < 4; k++)
        if (d.ch !== 4 || Math.abs(d.px[i * 4 + k] - rgba[i * 4 + k]) > 1) {
          bad++;
          break;
        }
    report.pngTexelsWiped = bad;
    if (bad) views[vi] = encodePng(rgba, d.w, d.h);
    report.pngBytes = views[vi].length;
  }
  // 2. sparse shape keys
  let saved = 0;
  for (const m of json.meshes ?? [])
    for (const pr of m.primitives)
      for (const t of pr.targets ?? [])
        for (const key of Object.keys(t)) {
          const acc = json.accessors[t[key]];
          if (acc.sparse || acc.componentType !== 5126 || acc.type !== 'VEC3' || acc.bufferView === undefined) continue;
          const src = views[acc.bufferView];
          const off = acc.byteOffset ?? 0;
          const f = new Float32Array(src.buffer.slice(src.byteOffset + off, src.byteOffset + off + acc.count * 12));
          const idx = [];
          for (let i = 0; i < acc.count; i++) if (f[i * 3] || f[i * 3 + 1] || f[i * 3 + 2]) idx.push(i);
          if (idx.length * 14 >= acc.count * 12) continue;
          const n = Math.max(1, idx.length);
          const ib = acc.count > 65535 ? Buffer.from(new Uint32Array(idx.length ? idx : [0]).buffer) : Buffer.from(new Uint16Array(idx.length ? idx : [0]).buffer);
          const vb = Buffer.alloc(n * 12);
          idx.forEach((i, k) => {
            vb.writeFloatLE(f[i * 3], k * 12);
            vb.writeFloatLE(f[i * 3 + 1], k * 12 + 4);
            vb.writeFloatLE(f[i * 3 + 2], k * 12 + 8);
          });
          const used = acc.bufferView;
          delete acc.bufferView;
          delete acc.byteOffset;
          json.bufferViews.push({ buffer: 0, byteLength: ib.length });
          views.push(ib);
          json.bufferViews.push({ buffer: 0, byteLength: vb.length });
          views.push(vb);
          acc.sparse = {
            count: n,
            indices: { bufferView: json.bufferViews.length - 2, componentType: acc.count > 65535 ? 5125 : 5123 },
            values: { bufferView: json.bufferViews.length - 1 },
          };
          saved += acc.count * 12 - idx.length * 14;
          if (!json.accessors.some((a) => a.bufferView === used)) views[used] = null;
        }
  report.sparseSavedBytes = saved;
  // drop views nothing points at any more
  const live = new Set();
  for (const a of json.accessors ?? []) {
    if (a.bufferView !== undefined) live.add(a.bufferView);
    if (a.sparse) {
      live.add(a.sparse.indices.bufferView);
      live.add(a.sparse.values.bufferView);
    }
  }
  for (const im of json.images ?? []) if (im.bufferView !== undefined) live.add(im.bufferView);
  views.forEach((v, i) => {
    if (!live.has(i)) views[i] = null;
  });
  const out = buildGlb(json, views);
  report.bytes = out.length;
  return { glb: out, report };
}
