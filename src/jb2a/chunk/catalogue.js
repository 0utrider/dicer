import * as THREE from 'three';

/**
 * JB2A effect catalogue: which webm layers play for each Dicer effect, and how to resolve a layer
 * to a file name and url. Pure data plus small helpers, so it loads in the lazy JB2A chunk.
 *
 * Layer: `dir` is relative to `Library/Generic/`; `place` is 'table' (flat on the surface) or
 * 'over' (billboard over the die); `size` is world units across; `offsetZ` nudges the layer in z;
 * `variants` are colour versions, and the one whose `file` equals `layer.file` is the default.
 */

/** Build a layer from a `<v>` file template and its variant colours. */
function variantLayer(dir, template, place, size, colors, def, extra = {}) {
    const name = (v) => template.replace('<v>', v);
    return Object.freeze({
        dir,
        file: name(def),
        place,
        size,
        ...extra,
        variants: Object.freeze(Object.entries(colors).map(([v, color]) => Object.freeze({ color, file: name(v) })))
    });
}

const layer = (dir, file, place, size, offsetZ) =>
    Object.freeze({ dir, file, place, size, ...(offsetZ === undefined ? {} : { offsetZ }) });

const STARS = layer('Twinkling_Stars', 'TwinklingStars_04_100x100.webm', 'over', 3.2);

export const JB2A_EFFECTS = Object.freeze({
    celebrate: Object.freeze([
        layer('Particles', 'ParticleBurstCircle01_01_Regular_Yellow_600x600.webm', 'table', 7),
        STARS,
        layer('UI', 'Critical_01_Yellow_200x200.webm', 'over', 4.5, -2)
    ]),
    fumble: Object.freeze([
        layer('Impact', 'GroundCrackImpact_01_Dark_Red_600x600.webm', 'table', 6),
        layer('UI', 'CriticalMiss_02_Red_200x200.webm', 'over', 5, -1.9)
    ]),
    frost: Object.freeze([layer('Impact', 'FrostImpact_01_Regular_Blue_600x600.webm', 'table', 6)]),
    lightning: Object.freeze([layer('Lightning', 'LightningStrike01_01_Regular_Blue_800x800.webm', 'over', 16, -0.2)]),
    smoke: Object.freeze([layer('Smoke', 'SmokePuff01_01_Dark_Black_400x400.webm', 'over', 5)]),
    sparkles: Object.freeze([
        STARS,
        variantLayer(
            'Particles',
            'ParticlesOutward01_01_Regular_<v>_400x400.webm',
            'table',
            6,
            { Blue: '#4a8cff', GreenYellow: '#b8e04a', Orange: '#ff8a2a', Purple: '#a05aff', Red: '#ff3a3a', White: '#ffffff' },
            'Orange'
        )
    ]),
    // The four below were tuned by eye on a d20 (tests/visual/jb2a.mjs).
    shockwave: Object.freeze([
        variantLayer(
            'Impact',
            'Impact_04_Regular_<v>_400x400.webm',
            'table',
            8,
            { Blue: '#4a8cff', Green: '#4ae07a', Orange: '#ff8a2a', PinkPurple: '#d05aff', Yellow: '#ffe27a' },
            'Yellow'
        )
    ]),
    'light-burst': Object.freeze([
        variantLayer(
            'Explosion',
            'Explosion_01_<v>_400x400.webm',
            'over',
            6,
            { Blue: '#4a8cff', Green: '#4ae07a', Orange: '#ff8a2a', Purple: '#a05aff', Yellow: '#ffe27a' },
            'Yellow'
        )
    ]),
    embers: Object.freeze([layer('Impact', 'ImpactFire01_01_Regular_Orange_600x600.webm', 'table', 7)]),
    shatter: Object.freeze([layer('Impact', 'ImpactIceShard01_01_Regular_Blue_400x400.webm', 'table', 7)])
});

const _hsl = { h: 0, s: 0, l: 0 };

/** Circular distance between two colours' hues, in [0, 0.5]. */
export function hueDistance(a, b) {
    const ha = a.getHSL({ h: 0, s: 0, l: 0 }).h;
    const hb = b.getHSL(_hsl).h;
    const d = Math.abs(ha - hb);
    return Math.min(d, 1 - d);
}

/** The file name for a layer: the variant nearest `color` in hue, or the layer's default file. */
export function pickFile(layer, color) {
    if (!layer.variants || !color) return layer.file;
    const hsl = color.getHSL({ h: 0, s: 0, l: 0 });
    if (hsl.s < 0.15) {
        // grey/white: hue is meaningless, so use a variant that is itself low-saturation (White)
        const grey = layer.variants.find((v) => new THREE.Color(v.color).getHSL({ h: 0, s: 0, l: 0 }).s < 0.15);
        return grey ? grey.file : layer.file;
    }
    let best = layer.file;
    let bestDist = Infinity;
    for (const v of layer.variants) {
        const d = hueDistance(color, new THREE.Color(v.color));
        if (d < bestDist) {
            bestDist = d;
            best = v.file;
        }
    }
    return best;
}

/** JB2A folders whose animations lie flat on the table (impacts, markers, templates). */
const TABLE_DIRS = /\/(Impact|Marker|Template|Ground|Circle|Wind|Liquid)[^/]*\//i;

/**
 * A user-chosen JB2A file (a theme rule's `effect.jb2a`): a relative Foundry path to a .webm, or a
 * url under the JB2A source's own absolute location (a bucket); never any other url, so a shared
 * theme cannot send other clients off-site. Null when it is not one.
 */
export function customLayer(file, source = null) {
    if (typeof file !== 'string' || file.length > 400) return null;
    const path = file.trim();
    if (!/\.webm$/i.test(path) || path.includes('..') || path.startsWith('\\')) return null;
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) {
        const base = String(source?.location ?? '').replace(/\/+$/, '');
        if (!/^https:\/\//i.test(base) || !path.startsWith(`${base}/`)) return null;
    }
    const table = TABLE_DIRS.test(`/${path}`);
    return Object.freeze({ url: path, file: path, place: table ? 'table' : 'over', size: table ? 7 : 6 });
}

/** The url of a layer's file under a JB2A source `{ moduleId, location }`. */
export function urlFor(source, layer, color) {
    if (layer.url) return layer.url;
    const base = String(source.location).replace(/\/+$/, '');
    return `${base}/${source.moduleId}/Library/Generic/${layer.dir}/${pickFile(layer, color)}`;
}
