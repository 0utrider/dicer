// Writes the six test face images for the dev gallery's image-face card (dev/assets/face-*.png):
// simple coloured shapes on transparent, encoded with node:zlib (no image dependency).
// Run: node scripts/make-face-pngs.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 64;
const OUT = 'dev/assets';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Inside tests in [-1, 1]^2, y up. */
const SHAPES = {
  circle: (x, y) => x * x + y * y < 0.7,
  square: (x, y) => Math.max(Math.abs(x), Math.abs(y)) < 0.7,
  triangle: (x, y) => y > -0.7 && y < 0.8 - 2 * Math.abs(x),
  diamond: (x, y) => Math.abs(x) + Math.abs(y) < 0.85,
  cross: (x, y) => Math.min(Math.abs(x), Math.abs(y)) < 0.25 && Math.max(Math.abs(x), Math.abs(y)) < 0.85,
  ring: (x, y) => {
    const r = Math.hypot(x, y);
    return r > 0.45 && r < 0.85;
  },
};
const COLORS = [
  [230, 60, 50],
  [60, 170, 80],
  [50, 110, 230],
  [240, 190, 40],
  [170, 70, 200],
  [30, 190, 200],
];

mkdirSync(OUT, { recursive: true });
Object.entries(SHAPES).forEach(([name, inside], i) => {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      // 4x4 supersampling for smooth edges
      let cover = 0;
      for (let s = 0; s < 16; s++) {
        const x = ((px + ((s % 4) + 0.5) / 4) / SIZE) * 2 - 1;
        const y = 1 - ((py + (Math.floor(s / 4) + 0.5) / 4) / SIZE) * 2;
        if (inside(x, y)) cover++;
      }
      const o = (py * SIZE + px) * 4;
      rgba.set([...COLORS[i], Math.round((cover / 16) * 255)], o);
    }
  }
  writeFileSync(`${OUT}/face-${i + 1}-${name}.png`, png(rgba));
});
console.log(`wrote ${Object.keys(SHAPES).length} PNGs to ${OUT}`);
