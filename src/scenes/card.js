// Crit title cards: the bowling-alley "STRIKE!" moment over the table. Big extruded display
// lettering slams, pops or crashes in, with light rays, a flash, confetti, sparks, rain or a crack
// running across, holds, and leaves. An HTML overlay in Dicer's layer (#dicer-layer, over the dice
// canvas): crisp at any size, timed by the Web Animations API, freed when it ends or is stopped.
// Seeded (no Math.random): every screen shows the same card.
//
// A card spec (all optional but lines):
//   lines: [{ text, size (of the short screen side, 0.12), at (0..1 down the screen), fill: [top,
//            bottom], edge (extrusion colour), enter: 'slam'|'pop'|'drop'|'thud'|'zoom'|'rise'|
//            'stamp'|'whip', delay (ms), tilt (deg) }]
//   glow (text glow colour), font ('display'|'tech'), hold (ms the card stays after its last
//   entrance, default 1300), exit: 'rise'|'fade'|'crumble'|'shatter'|'sink'
//   rays: { colors: [a, b], spin (turns/s) }, flash: colour, vignette: colour,
//   confetti: { colors, count }, sparks: { colors, count, up }, rain: { color, count },
//   crack: colour, shake (0..1: the lettering shakes on landing), seed (number)
// Reduced motion: the lines fade in and out, nothing flies, flashes or shakes.

const NS = 'http://www.w3.org/2000/svg';
const FONTS = {
  display: "'Modesto Condensed', 'Signika', Georgia, serif",
  tech: "'Bruno Ace', 'Signika', system-ui, sans-serif",
};

/**
 * A card spec with its lines' text replaced by `text` (a rule's own sceneText, cleaned by
 * scene-catalog.js sceneText), line by line: a blank line keeps the scene's own, the style stays.
 */
export function withText(spec, text) {
  if (!Array.isArray(text) || !Array.isArray(spec?.lines)) return spec;
  return { ...spec, lines: spec.lines.map((l, i) => (typeof text[i] === 'string' && text[i].trim() ? { ...l, text: text[i].trim() } : l)) };
}

/** A seeded random 0..1 stream (mulberry32). */
export function seeded(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENTER = {
  slam: { ms: 420, kf: [{ transform: 'scale(3.2)', opacity: 0, filter: 'blur(10px)' }, { transform: 'scale(0.9)', opacity: 1, filter: 'blur(0)', offset: 0.7 }, { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }], easing: 'cubic-bezier(.2,.7,.2,1)' },
  pop: { ms: 620, kf: [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.28)', opacity: 1, offset: 0.45 }, { transform: 'scale(0.93)', offset: 0.7 }, { transform: 'scale(1.04)', offset: 0.85 }, { transform: 'scale(1)', opacity: 1 }], easing: 'ease-out' },
  drop: { ms: 560, kf: [{ transform: 'translateY(-70vh)', opacity: 1 }, { transform: 'translateY(0)', offset: 0.6 }, { transform: 'translateY(-6vh)', offset: 0.78 }, { transform: 'translateY(0)' }], easing: 'cubic-bezier(.5,0,.7,1)' },
  zoom: { ms: 520, kf: [{ transform: 'scale(0.2) translateZ(0)', opacity: 0, letterSpacing: '0.6em' }, { transform: 'scale(1)', opacity: 1, letterSpacing: '0.02em' }], easing: 'cubic-bezier(.16,1,.3,1)' },
  rise: { ms: 600, kf: [{ transform: 'translateY(30vh) scale(0.8)', opacity: 0 }, { transform: 'translateY(-2vh) scale(1.04)', opacity: 1, offset: 0.75 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], easing: 'cubic-bezier(.2,.8,.2,1)' },
  stamp: { ms: 380, kf: [{ transform: 'scale(1.9) rotate(-8deg)', opacity: 0 }, { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: 0.6 }, { transform: 'scale(1.06)', offset: 0.8 }, { transform: 'scale(1)', opacity: 1 }], easing: 'ease-in' },
  whip: { ms: 480, kf: [{ transform: 'translateX(-90vw) skewX(30deg)', opacity: 0 }, { transform: 'translateX(4vw) skewX(-10deg)', opacity: 1, offset: 0.7 }, { transform: 'translateX(0) skewX(0deg)', opacity: 1 }], easing: 'cubic-bezier(.3,.9,.3,1)' },
};
// 'thud' is per letter (a heavy drop each, staggered)
const EXIT = {
  rise: { ms: 520, kf: [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-14vh)', opacity: 0 }], easing: 'cubic-bezier(.5,0,.8,.5)' },
  fade: { ms: 420, kf: [{ opacity: 1 }, { opacity: 0 }], easing: 'ease-in' },
  shatter: { ms: 360, kf: [{ transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }, { transform: 'scale(1.5)', opacity: 0, filter: 'blur(6px)' }], easing: 'ease-in' },
  sink: { ms: 700, kf: [{ transform: 'translateY(0) rotate(0deg)', opacity: 1 }, { transform: 'translateY(12vh) rotate(3deg)', opacity: 0 }], easing: 'cubic-bezier(.6,0,.9,.6)' },
};

/**
 * The extruded, glowing letter style of a line: its gradient fill (background-clip: text) with
 * the extrusion and glow as a chain of drop-shadow filters. Filters draw behind the painted
 * letters; text-shadow would paint over a clipped background and turn the fill to the edge colour.
 */
function letterStyle(el, line, spec, px) {
  const [top, bottom] = line.fill ?? ['#ffffff', '#ffd27a'];
  const edge = line.edge ?? '#5a2a08';
  const step = Math.max(1, px * 0.011);
  const filters = [];
  // each drop-shadow copies everything before it one step down: six steps make a solid extrusion
  for (let i = 0; i < 6; i++) filters.push(`drop-shadow(${(step * 0.45).toFixed(1)}px ${step.toFixed(1)}px 0 ${edge})`);
  filters.push(`drop-shadow(0 ${(step * 4).toFixed(1)}px ${Math.round(px * 0.12)}px rgba(0,0,0,0.6))`);
  if (spec.glow) filters.push(`drop-shadow(0 0 ${Math.round(px * 0.16)}px ${spec.glow})`);
  Object.assign(el.style, {
    fontFamily: FONTS[spec.font] ?? FONTS.display,
    fontSize: `${px}px`,
    fontWeight: '700',
    lineHeight: '1',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    color: top,
    backgroundImage: `linear-gradient(180deg, ${top} 18%, ${bottom} 82%)`,
    backgroundClip: 'text',
    webkitBackgroundClip: 'text',
    webkitTextFillColor: 'transparent',
    webkitTextStroke: `${Math.max(1, px * 0.018).toFixed(1)}px rgba(20,8,2,0.75)`,
    paddingBottom: `${(step * 7).toFixed(0)}px`, // room for the extrusion below the letters
    filter: filters.join(' '),
  });
}

function animate(el, kf, opts) {
  if (typeof el.animate !== 'function') return null; // jsdom: the card just shows
  try {
    return el.animate(kf, { fill: 'both', ...opts });
  } catch {
    return null;
  }
}

/**
 * Shows a card; returns { stop(), ms } (it removes itself after `ms`). `host`: where it goes
 * (default #dicer-layer, else document.body); `reduced`: the calm form.
 */
/** A rough glyph width (em) per font, uppercase with the extrusion: enough to keep lines on screen. */
const EM = { display: 0.56, tech: 0.92 };

/**
 * A line's font size: its share of the short screen side, shrunk so the whole word fits in 90%
 * of the screen's width (a long word on a narrow or portrait screen would run off its edges).
 */
export function fitPx(line, spec, short, width) {
  const want = short * (line.size ?? 0.12);
  const ems = Math.max(1, String(line.text ?? '').length) * (EM[spec.font] ?? EM.display);
  return Math.round(Math.min(want, (width * 0.9) / ems));
}

/**
 * The part of the window the table shows in (px): the window minus what Foundry docks over its
 * sides, the sidebar and a side camera dock, so a card is centred on what players see and never
 * runs under them.
 */
export function freeArea(doc, view) {
  const W = view.innerWidth || 1280;
  const H = view.innerHeight || 800;
  let left = 0;
  let right = W;
  for (const id of ['sidebar', 'camera-views']) {
    const r = doc.getElementById?.(id)?.getBoundingClientRect?.();
    if (!r || !(r.width > 0) || r.width > W / 2 || r.height < H / 2) continue; // absent, or docked top or bottom
    if (r.left <= 1) left = Math.max(left, r.right);
    else if (r.right >= W - 1) right = Math.min(right, r.left);
  }
  return right - left > W / 3 ? { left, top: 0, width: right - left, height: H } : { left: 0, top: 0, width: W, height: H };
}

// --- several crits at once: the screen split between their cards ----------------------------
// A card drawn while others show takes a slice of the table: 2 side by side, 3 in thirds, 4 in a
// 2 x 2 grid; the cards already up are drawn again in theirs, from where their animation was, so
// every slice is laid out alike (lettering, the roller's name). A fifth waits for a free slice.
// One finishing leaves the others where they are.

/** The most cards on screen at once; more wait their turn. */
export const MAX_CARDS = 4;
const live = []; // the cards up, oldest first: { spec, opts, started, box, root, stop, ms }
const waiting = []; // { spec, opts, stopped }
const sameRect = (a, b) => a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

/** The slices of `box` for `n` cards: side by side up to 3, a 2 x 2 grid for 4. */
export function slotRects(n, box) {
  if (n <= 1) return [box];
  const grid = n === 4;
  const cols = grid ? 2 : n;
  const w = box.width / cols;
  const h = grid ? box.height / 2 : box.height;
  return Array.from({ length: n }, (_, i) => ({ left: box.left + (i % cols) * w, top: box.top + Math.floor(i / cols) * h, width: w, height: h }));
}

/** Draws `card` in `rect`, `skip` ms into its animation. */
function draw(card, rect, skip) {
  card.box = rect;
  const d = drawCard(card.spec, { ...card.opts, area: rect, skip, onEnd: () => leave(card) });
  card.root = d.root;
  card.stop = d.stop;
  card.ms = d.ms;
}

/** A card left the screen (not one being drawn again): the next waiting one takes its place. */
function leave(card) {
  if (card.moving) return;
  const i = live.indexOf(card);
  if (i >= 0) live.splice(i, 1);
  while (waiting.length && live.length < MAX_CARDS) {
    const w = waiting.shift();
    if (!w.stopped) showCard(w.spec, w.opts);
  }
}

/** Tests: no card up or waiting. */
export function _resetCards() {
  for (const c of [...live]) c.stop();
  live.length = 0;
  waiting.length = 0;
}

/**
 * Shows a card in its slice of the table (see above); options as drawCard's, plus `who`: the
 * roller's name, shown small over the card. Returns { stop(), ms, root } (`waiting: true` and no
 * root while it waits for a free slice; stop() then drops it).
 */
export function showCard(spec, opts = {}) {
  const doc = opts.doc ?? globalThis.document;
  if (!doc?.createElement || !spec?.lines?.length) return { stop() {}, ms: 0 };
  if (live.length >= MAX_CARDS) {
    const w = { spec, opts, stopped: false };
    waiting.push(w);
    return { stop: () => (w.stopped = true), ms: 0, root: null, waiting: true };
  }
  const box = opts.area ?? freeArea(doc, doc.defaultView ?? globalThis);
  const rects = slotRects(live.length + 1, box);
  const now = Date.now();
  live.forEach((c, i) => {
    if (sameRect(c.box, rects[i])) return;
    c.moving = true;
    c.stop();
    c.moving = false;
    draw(c, rects[i], Math.min(now - c.started, c.ms - 1));
  });
  const card = { spec, opts: { ...opts, doc }, started: now };
  draw(card, rects[rects.length - 1], 0);
  if (card.root) live.push(card);
  // the scene's handle follows its card through redraws
  return {
    stop: () => card.stop(),
    ms: card.ms,
    get root() {
      return card.root;
    },
  };
}

/** Draws one card in `area` (default: the free table); onEnd runs once it is gone. */
function drawCard(spec, { host, reduced = false, doc = globalThis.document, area, who, onEnd, skip = 0 } = {}) {
  if (!doc?.createElement || !spec?.lines?.length) return { stop() {}, ms: 0 };
  const parent = host ?? doc.getElementById?.('dicer-layer') ?? doc.body;
  const view = doc.defaultView ?? globalThis;
  const box = area ?? freeArea(doc, view);
  const W = box.width;
  const H = box.height;
  const short = Math.min(W, H);
  const rand = seeded(spec.seed ?? 7);
  const root = doc.createElement('div');
  root.className = 'dicer-crit-card';
  Object.assign(root.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${W}px`, height: `${H}px`, pointerEvents: 'none', overflow: 'hidden', contain: 'strict' }); // its z-index: dicer.css .dicer-crit-card
  const anims = [];
  const timers = [];
  let raf = 0;
  let gone = false;

  // timing: entrances, then the hold, then the exit
  const lastIn = Math.max(...spec.lines.map((l) => (l.delay ?? 0) + (l.enter === 'thud' ? 70 * String(l.text).length + 480 : (ENTER[l.enter] ?? ENTER.slam).ms)));
  const hold = spec.hold ?? 1300;
  const exit = reduced ? EXIT.fade : (EXIT[spec.exit] ?? EXIT.rise);
  const outAt = lastIn + hold;
  const ms = outAt + (spec.exit === 'crumble' && !reduced ? 900 : exit.ms) + 60;

  const layer = (style) => {
    const d = doc.createElement('div');
    Object.assign(d.style, { position: 'absolute', inset: '0', ...style });
    root.appendChild(d);
    return d;
  };
  const fadeLayer = (el, peak = 1, inMs = 260) =>
    anims.push(animate(el, [{ opacity: 0 }, { opacity: peak, offset: inMs / ms }, { opacity: peak, offset: Math.min(0.99, outAt / ms) }, { opacity: 0 }], { duration: ms, easing: 'linear' }));

  if (!reduced) {
    if (spec.vignette) fadeLayer(layer({ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, ${spec.vignette} 100%)`, opacity: '0' }), 0.85);
    if (spec.rays) {
      const [a, b] = spec.rays.colors ?? ['#ffbe3c', '#ff7a1e'];
      const size = Math.hypot(W, H) * 1.2;
      const rays = layer({
        inset: 'auto',
        left: `${W / 2 - size / 2}px`,
        top: `${H * 0.47 - size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        background: `repeating-conic-gradient(from 0deg, ${a}55 0deg 7deg, transparent 7deg 20deg, ${b}44 20deg 26deg, transparent 26deg 40deg)`,
        maskImage: 'radial-gradient(circle, black 0%, black 25%, transparent 62%)',
        webkitMaskImage: 'radial-gradient(circle, black 0%, black 25%, transparent 62%)',
        mixBlendMode: 'screen',
        opacity: '0',
      });
      fadeLayer(rays, 1, 300);
      anims.push(animate(rays, [{ transform: 'rotate(0deg)' }, { transform: `rotate(${360 * (spec.rays.spin ?? 0.12) * (ms / 1000)}deg)` }], { duration: ms, easing: 'linear' }));
    }
    if (spec.flash) {
      const f = layer({ background: spec.flash, opacity: '0', mixBlendMode: 'screen' });
      const at = (spec.lines[0].delay ?? 0) + 260;
      anims.push(animate(f, [{ opacity: 0 }, { opacity: 0, offset: at / ms }, { opacity: 0.9, offset: (at + 40) / ms }, { opacity: 0, offset: Math.min(0.99, (at + 420) / ms) }, { opacity: 0 }], { duration: ms }));
    }
    if (spec.crack) {
      const svg = doc.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
      const pts = [];
      let x = W * 0.08;
      let y = H * (0.38 + rand() * 0.1);
      while (x < W * 0.94) {
        pts.push(`${x.toFixed(0)},${y.toFixed(0)}`);
        x += W * (0.04 + rand() * 0.05);
        y += H * (rand() - 0.5) * 0.09;
      }
      const line = doc.createElementNS(NS, 'polyline');
      line.setAttribute('points', pts.join(' '));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', spec.crack);
      line.setAttribute('stroke-width', String(Math.max(3, short * 0.008)));
      line.setAttribute('stroke-linejoin', 'miter');
      line.style.filter = 'drop-shadow(0 0 3px rgba(0,0,0,0.8))';
      svg.appendChild(line);
      root.appendChild(svg);
      const len = W * 1.4;
      line.style.strokeDasharray = `${len}`;
      const at = (spec.lines[0].delay ?? 0) + 380;
      anims.push(animate(line, [{ strokeDashoffset: len, opacity: 1 }, { strokeDashoffset: len, offset: at / ms }, { strokeDashoffset: 0, offset: (at + 240) / ms, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: Math.min(0.99, outAt / ms) }, { strokeDashoffset: 0, opacity: 0 }], { duration: ms }));
    }
  }

  // the lettering
  const lines = [];
  for (const line of spec.lines) {
    const px = fitPx(line, spec, short, W);
    const wrap = layer({ display: 'flex', alignItems: 'center', justifyContent: 'center', inset: 'auto', left: '0', right: '0', top: `${(line.at ?? 0.5) * H - px * 0.55}px`, height: `${px * 1.1}px` });
    const word = doc.createElement('div');
    letterStyle(word, line, spec, px);
    word.style.transform = `rotate(${line.tilt ?? 0}deg)`;
    const letters = [];
    if (line.enter === 'thud' || spec.exit === 'crumble') {
      // Each letter moves on its own: it carries its own fill, extrusion and glow. A clipped
      // gradient on the word does not reach letters that animate (Chrome draws them see-through).
      word.style.backgroundImage = 'none';
      word.style.filter = 'none';
      for (const ch of String(line.text)) {
        const s = doc.createElement('span');
        s.textContent = ch;
        letterStyle(s, line, spec, px);
        s.style.display = 'inline-block';
        s.style.whiteSpace = 'pre'; // a space keeps its width
        word.appendChild(s);
        letters.push(s);
      }
    } else word.textContent = String(line.text);
    wrap.appendChild(word);
    lines.push({ line, wrap, word, letters });
    const delay = line.delay ?? 0;
    if (reduced) {
      anims.push(animate(wrap, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay, easing: 'ease-out' }));
    } else if (line.enter === 'thud') {
      letters.forEach((s, i) =>
        anims.push(animate(s, [{ transform: 'translateY(-55vh)', opacity: 1 }, { transform: 'translateY(0)', offset: 0.7 }, { transform: 'translateY(-3vh) scaleY(0.9)', offset: 0.85 }, { transform: 'translateY(0)' }], { duration: 480, delay: delay + i * 70, easing: 'cubic-bezier(.5,0,.75,1)' })),
      );
    } else {
      const e = ENTER[line.enter] ?? ENTER.slam;
      anims.push(animate(wrap, e.kf, { duration: e.ms, delay, easing: e.easing }));
    }
    if (!reduced && spec.shake) {
      const land = delay + (line.enter === 'thud' ? 70 * letters.length + 340 : (ENTER[line.enter] ?? ENTER.slam).ms * 0.7);
      const a = Math.max(2, short * 0.012 * spec.shake);
      anims.push(animate(word, [0, 1, -1, 0.7, -0.6, 0.3, 0].map((k) => ({ transform: `rotate(${line.tilt ?? 0}deg) translate(${(k * a).toFixed(1)}px, ${(-k * a * 0.6).toFixed(1)}px)` })), { duration: 320, delay: land, fill: 'none' }));
    }
  }

  // the exit (crumble: each letter falls away turning; else the whole card)
  if (!reduced && spec.exit === 'crumble') {
    for (const { letters, wrap } of lines) {
      if (!letters.length) continue;
      letters.forEach((s, i) => {
        const turn = (rand() - 0.5) * 70;
        anims.push(animate(s, [{ transform: 'translateY(0) rotate(0deg)', opacity: 1 }, { transform: `translateY(75vh) rotate(${turn}deg)`, opacity: 0 }], { duration: 760, delay: outAt + i * 60, easing: 'cubic-bezier(.55,0,.9,.5)', fill: 'forwards' }));
      });
      void wrap;
    }
  } else {
    for (const { wrap } of lines) anims.push(animate(wrap, exit.kf, { duration: exit.ms, delay: outAt, easing: exit.easing, fill: 'forwards', composite: 'replace' }));
  }

  // confetti, sparks and rain: one 2D canvas, seeded particles
  const parts = [];
  if (!reduced && (spec.confetti || spec.sparks || spec.rain)) {
    const cv = doc.createElement('canvas');
    const dpr = Math.min(2, view.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    root.appendChild(cv);
    const g = cv.getContext?.('2d');
    const cx = W / 2;
    const cy = H * 0.47;
    const burstAt = (spec.lines[0].delay ?? 0) + 300;
    if (spec.confetti) {
      const cols = spec.confetti.colors ?? ['#ffd23f', '#ff5e5b', '#3bceac', '#7a5cff', '#ffffff'];
      for (let i = 0; i < (spec.confetti.count ?? 110); i++) {
        const a = rand() * Math.PI * 2;
        const v = (0.35 + rand() * 0.9) * short * 1.6;
        parts.push({ kind: 'confetti', t0: burstAt + rand() * 120, x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8 - short * 0.6, w: short * (0.012 + rand() * 0.012), h: short * (0.006 + rand() * 0.006), rot: rand() * 6, vr: (rand() - 0.5) * 18, col: cols[i % cols.length], life: 2400 + rand() * 900, sway: rand() * 6 });
      }
    }
    if (spec.sparks) {
      const cols = spec.sparks.colors ?? ['#fff2c0', '#ffb347', '#ff6a1e'];
      for (let i = 0; i < (spec.sparks.count ?? 70); i++) {
        const a = spec.sparks.up ? -Math.PI / 2 + (rand() - 0.5) * 1.6 : rand() * Math.PI * 2;
        const v = (0.4 + rand()) * short * 1.4;
        parts.push({ kind: 'spark', t0: burstAt + rand() * 200, x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col: cols[i % cols.length], life: 700 + rand() * 700, r: short * (0.003 + rand() * 0.004) });
      }
    }
    if (spec.rain) {
      for (let i = 0; i < (spec.rain.count ?? 90); i++) {
        parts.push({ kind: 'rain', t0: 600 + rand() * (ms - 1200), x: rand() * W * 1.2, y: -H * 0.1, vx: -short * 0.15, vy: short * (1.6 + rand() * 0.8), col: spec.rain.color ?? 'rgba(170,190,220,0.6)', life: 900, len: short * (0.03 + rand() * 0.03) });
      }
    }
    const start = (view.performance?.now?.() ?? Date.now()) - skip;
    const draw = () => {
      if (gone || !g) return;
      const t = (view.performance?.now?.() ?? Date.now()) - start;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      for (const p of parts) {
        const e = (t - p.t0) / 1000;
        if (e < 0 || e * 1000 > p.life) continue;
        const k = (e * 1000) / p.life;
        if (p.kind === 'confetti') {
          const drag = Math.exp(-e * 2.4);
          const x = p.x + (p.vx * (1 - drag)) / 2.4 + Math.sin(e * p.sway) * short * 0.02;
          const y = p.y + (p.vy * (1 - drag)) / 2.4 + 0.5 * short * 0.9 * e * e;
          g.save();
          g.translate(x, y);
          g.rotate(p.rot + p.vr * e);
          g.scale(1, Math.cos(e * 9 + p.rot));
          g.globalAlpha = 1 - Math.max(0, k - 0.75) * 4;
          g.fillStyle = p.col;
          g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          g.restore();
        } else if (p.kind === 'spark') {
          const drag = Math.exp(-e * 3);
          const x = p.x + (p.vx * (1 - drag)) / 3;
          const y = p.y + (p.vy * (1 - drag)) / 3 + 0.5 * short * 0.7 * e * e;
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 1 - k;
          g.fillStyle = p.col;
          g.beginPath();
          g.arc(x, y, p.r * (1 - k * 0.5), 0, Math.PI * 2);
          g.fill();
          g.globalCompositeOperation = 'source-over';
        } else {
          const x = p.x + p.vx * e;
          const y = p.y + p.vy * e;
          g.globalAlpha = 0.8 * (1 - k);
          g.strokeStyle = p.col;
          g.lineWidth = Math.max(1, short * 0.002);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + (p.vx / p.vy) * p.len, y + p.len);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      if (t < ms) raf = view.requestAnimationFrame?.(draw) ?? 0;
    };
    raf = view.requestAnimationFrame?.(draw) ?? 0;
  }

  // whose crit it is: the roller's name, small, over the card
  if (typeof who === 'string' && who.trim()) {
    const name = doc.createElement('div');
    name.className = 'dicer-crit-who';
    name.textContent = who.trim().slice(0, 40);
    Object.assign(name.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top: `${Math.round(H * 0.08)}px`,
      textAlign: 'center',
      fontFamily: FONTS[spec.font] ?? FONTS.display,
      fontSize: `${Math.round(Math.max(14, short * 0.05))}px`,
      fontWeight: '700',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: '#fff',
      textShadow: `0 2px 6px rgba(0,0,0,0.85)${spec.glow ? `, 0 0 ${Math.round(short * 0.03)}px ${spec.glow}` : ''}`,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    root.appendChild(name);
    anims.push(animate(name, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], { duration: ms }));
  }
  parent.appendChild(root);
  // fitPx guesses glyph widths; now that it is laid out, a line still wider than 92% of the
  // screen (a wide font, a long word) is scaled down to fit (zoom keeps its extrusion in step)
  for (const { word } of lines) {
    const w = word.scrollWidth;
    if (w > W * 0.92) word.style.zoom = (W * 0.92 / w).toFixed(3);
  }
  const stop = () => {
    if (gone) return;
    gone = true;
    for (const t of timers) clearTimeout(t);
    if (raf) view.cancelAnimationFrame?.(raf);
    for (const a of anims) a?.cancel?.();
    root.remove();
    onEnd?.();
  };
  // drawn again mid-way (a slice of a split screen): every animation picks up where it was
  if (skip > 0) for (const a of anims) if (a) a.currentTime = skip;
  timers.push(setTimeout(stop, ms - skip));
  return { stop, ms, root };
}
