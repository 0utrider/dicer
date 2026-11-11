/**
 * Generates an MSDF digit atlas: <out dir>/<name>.png + <name>.json (by default
 * assets/fonts/digits.png + digits.json, the bundled serif).
 *
 *   npm run build:sdf [-- <font file> <out dir> <name>]
 *   npm run build:sdf -- assets/fonts/AtkinsonHyperlegible-Bold.ttf assets/fonts digits-sans
 *
 * Charset is 0-9 plus the font's "_" glyph, which is stored under the key "." (the
 * 6./9. underline mark). The outputs are committed, so the build never needs this script.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const generateBMFont = require('msdf-bmfont-xml');

const FONT = resolve(process.argv[2] ?? 'assets/fonts/DMSerifDisplay-Regular.woff');
const OUT = resolve(process.argv[3] ?? 'assets/fonts');
const NAME = process.argv[4] ?? 'digits';
if (!/^[A-Za-z0-9_-]+$/.test(NAME)) throw new Error(`bad output name "${NAME}"`);
const FONT_SIZE = 64;
const DISTANCE_RANGE = 8;
const UNDERLINE_SRC = '_';
const UNDERLINE_KEY = '.';

const opt = {
  outputType: 'json',
  filename: join(OUT, NAME),
  charset: '0123456789' + UNDERLINE_SRC,
  fieldType: 'msdf',
  fontSize: FONT_SIZE,
  distanceRange: DISTANCE_RANGE,
  textureSize: [512, 512],
  texturePadding: 2,
  smartSize: true,
  pot: true,
};

mkdirSync(OUT, { recursive: true });
generateBMFont(FONT, opt, (error, textures, font) => {
  if (error) throw error;
  if (textures.length !== 1) throw new Error(`expected 1 atlas page, got ${textures.length}`);
  writeFileSync(join(OUT, `${NAME}.png`), textures[0].texture);

  const data = JSON.parse(font.data);
  const chars = data.chars.map((c) => {
    if (c.char !== UNDERLINE_SRC) return c;
    return { ...c, id: UNDERLINE_KEY.charCodeAt(0), char: UNDERLINE_KEY };
  });
  const out = {
    // Keep only what the runtime needs: page size, metrics and glyph boxes.
    info: { face: data.info.face, size: data.info.size },
    common: {
      lineHeight: data.common.lineHeight,
      base: data.common.base,
      scaleW: data.common.scaleW,
      scaleH: data.common.scaleH,
    },
    distanceField: data.distanceField,
    chars: chars.map(({ id, char, x, y, width, height, xoffset, yoffset, xadvance }) => ({
      id,
      char,
      x,
      y,
      width,
      height,
      xoffset,
      yoffset,
      xadvance,
    })),
  };
  writeFileSync(join(OUT, `${NAME}.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(
    `dicer: wrote ${join(OUT, `${NAME}.png`)} and ${NAME}.json (${out.chars.length} glyphs)`,
  );
});
