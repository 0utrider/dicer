/**
 * The throw overlay (G10 "The throw"; lazy hand chunk only). A full-stage element above the board
 * captures the pointer while a hand throw waits: pointer down grabs the dice, moving shakes them
 * (they jiggle and tumble with the shake energy), release flicks them. "Throw for me" (Space) is a
 * free throw with no release state; Esc or Cancel cancels; a countdown shows the time left.
 *
 * The dice are DiceBox.hold()'s, posed in die units every pointer move and every frame while the
 * overlay is open; the release hands DiceBox per-die release states (`launch`) and the hold's own
 * die objects fly on (or, with ghostOnRelease, ghost copies of them). Nothing runs once it closes.
 */
import { MAX_RELEASE_SPIN } from '../../physics/protocol.js';
import { toDieArea } from '../../areas/area-model.js';
import { cameraHeightFor } from '../../render/scene.js';
import { handEdge } from './edge.js';

/** The release velocity is read from the pointer's last this-many ms. */
export const SAMPLE_WINDOW_MS = 120;
/** Horizontal release speed cap (die units/s); with the most lift it stays under MAX_RELEASE_SPEED. */
export const MAX_FLICK_SPEED = 30;
/** A release with too few recent samples (a click, a still hand): a gentle toss down-screen. */
export const GENTLE_THROW = Object.freeze([0, 3]);
/** The lowest held die's height above the table (die units). */
export const HOLD_Y = 2.2;

const MIN_LIFT = 2; // units/s up at release: a little toss even when dropped
const LIFT_PER_SPEED = 0.2;
const MAX_LIFT = 9;
const MIN_SPIN = 4; // rad/s: a release with no shake still tumbles
const EDGE = 1; // a held die's centre stays this far inside the area (the sim's LAUNCH_MARGIN)
const SPACING = 1.3; // held dice sit on a sunflower: neighbours ~2.3 apart (circumradius 1 each)
const LAYER_DY = 1.9; // ... in up to 3 layers when the area is small
const MAX_LAYERS = 3;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const SHAKE_GAIN = 1 / 180; // energy per (die unit/s) of velocity change between pointer moves
const SHAKE_DECAY_MS = 800; // energy falls to 1/e this fast once the hand is still
const JIGGLE = 0.2; // die units of jitter at full shake
const TUMBLE = 16; // rad/s of held tumbling at full shake (plus 1)
const SPREAD = 0.12; // each die's release velocity varies by this fraction of the flick speed
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

/**
 * The flick velocity [vx, vz] in die units/s (x right, z down-screen) from pointer samples
 * [{t (ms), x, y (px)}]: the least-squares slope over the last SAMPLE_WINDOW_MS, converted at
 * `diePx` px per die unit and capped at MAX_FLICK_SPEED. Fewer than 2 samples in the window (or
 * no time between them): GENTLE_THROW.
 */
export function velocityFromSamples(samples, diePx) {
  const end = samples?.length ? samples[samples.length - 1].t : 0;
  const s = (samples ?? []).filter((p) => p.t >= end - SAMPLE_WINDOW_MS);
  if (s.length < 2 || !(diePx > 0)) return [...GENTLE_THROW];
  const n = s.length;
  const mt = s.reduce((a, p) => a + p.t, 0) / n;
  const mx = s.reduce((a, p) => a + p.x, 0) / n;
  const my = s.reduce((a, p) => a + p.y, 0) / n;
  let tt = 0;
  let tx = 0;
  let ty = 0;
  for (const p of s) {
    tt += (p.t - mt) ** 2;
    tx += (p.t - mt) * (p.x - mx);
    ty += (p.t - mt) * (p.y - my);
  }
  if (!(tt > 0)) return [...GENTLE_THROW];
  const k = 1000 / diePx / tt; // px/ms -> die units/s
  let vx = tx * k;
  let vz = ty * k;
  const v = Math.hypot(vx, vz);
  if (v > MAX_FLICK_SPEED) [vx, vz] = [(vx / v) * MAX_FLICK_SPEED, (vz / v) * MAX_FLICK_SPEED];
  return [vx, vz];
}

/** The upward release speed (die units/s) for a flick of `speed`: a faster flick tosses higher. */
export function liftFromSpeed(speed) {
  return Math.min(
    MAX_LIFT,
    MIN_LIFT + LIFT_PER_SPEED * (Number.isFinite(speed) ? Math.abs(speed) : 0),
  );
}

/**
 * A die's release spin [x, y, z] (rad/s) from the shake `energy` (0..1): MIN_SPIN at rest up to
 * MAX_RELEASE_SPIN at full shake, about a uniformly random axis, all drawn from `rng`.
 */
export function spinFromShake(energy, rng = Math.random) {
  const e = Number.isFinite(energy) ? clamp(energy, 0, 1) : 0;
  const mag = MIN_SPIN + e * (MAX_RELEASE_SPIN - MIN_SPIN) * (0.75 + 0.25 * rng());
  const y = 2 * rng() - 1;
  const a = 2 * Math.PI * rng();
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return [r * Math.cos(a) * mag, y * mag, r * Math.sin(a) * mag];
}

/** Held dice offsets from the hand point: a sunflower per layer, squeezed into `area`. */
function cluster(n, area) {
  const room = Math.max(0, Math.min(area.halfWidth, area.halfDepth) - EDGE);
  const fit = Math.max(1, Math.floor((room / SPACING) ** 2 + 0.5));
  const layers = Math.min(MAX_LAYERS, Math.ceil(n / fit));
  const per = Math.ceil(n / layers);
  const r = per > 1 ? SPACING * Math.sqrt(per - 0.5) : 0;
  const s = r > room ? room / r : 1;
  return Array.from({ length: n }, (_, i) => {
    const l = i % layers;
    const k = Math.floor(i / layers);
    const rr = per > 1 ? SPACING * Math.sqrt(k + 0.5) * s : 0;
    const a = k * GOLDEN + l * 1.1;
    return { x: rr * Math.cos(a), y: l * LAYER_DY, z: rr * Math.sin(a) };
  });
}

/** Unit quaternion product a * b ({x, y, z, w}). */
const qmul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
/** `q` turned by spin `w` (rad/s, world axes) over `dt` s, normalised. */
function turn(q, w, dt) {
  const m = Math.hypot(w[0], w[1], w[2]);
  if (!(m * dt > 1e-9)) return q;
  const h = (m * dt) / 2;
  const s = Math.sin(h) / m;
  const r = qmul({ x: w[0] * s, y: w[1] * s, z: w[2] * s, w: Math.cos(h) }, q);
  const len = Math.hypot(r.x, r.y, r.z, r.w);
  return { x: r.x / len, y: r.y / len, z: r.z / len, w: r.w / len };
}
/** A uniformly random unit quaternion from `rng` (Shoemake). */
function randomQuat(rng) {
  const [u, v, w] = [rng(), rng(), rng()];
  const a = Math.sqrt(1 - u);
  const b = Math.sqrt(u);
  return {
    x: a * Math.sin(2 * Math.PI * v),
    y: a * Math.cos(2 * Math.PI * v),
    z: b * Math.sin(2 * Math.PI * w),
    w: b * Math.cos(2 * Math.PI * w),
  };
}

/**
 * Opens the throw overlay over `stage` (px {left, top, width, height}; DiceBox's stage rect by
 * default) and holds `specs` in `rect` (the roller's area, px; the stage by default). The pointer
 * maps through the stage rect, never the canvas (screen shake translates the canvas only), and
 * held dice stop at the area's border (H-12), so a release never teleports.
 *
 * Resolves {values, handle, recording} once the throw lands (values null if it never does),
 * {cancelled: true} on Esc or Cancel, {timedOut: true} after `timeoutMs` (a window blur does not
 * pause it). `ghostOnRelease`: on release the held dice turn into ghost dice on this screen; their
 * values are still read and recorded (P6-D1, H-19). The overlay's DOM goes at landing, its
 * listeners and frame loop at release; DiceBox.holding is true until then (pets hold still: H-8).
 */
export function openThrowOverlay({
  specs,
  rect,
  stage,
  diePx,
  diceBox,
  timeoutMs,
  ghostOnRelease = false,
  label,
  rng = Math.random,
}) {
  stage ??= diceBox._stageRect;
  diePx ??= diceBox._diePx;
  rect ??= stage;
  const n = specs.length;
  const area = diceBox.dieArea?.(rect, n) ?? toDieArea(rect, stage, diePx);
  // The camera looks straight down from `camH`: a die at height y shows under the pointer when it
  // sits (camH - y) / camH of the way from the stage centre to the pointer's ground point.
  const camH = diceBox._renderer?.camera?.position?.y || cameraHeightFor(stage.height / 2 / diePx);
  const offsets = cluster(n, area);
  const ex = Math.max(0, ...offsets.map((o) => Math.abs(o.x)));
  const ez = Math.max(0, ...offsets.map((o) => Math.abs(o.z)));
  const dice = offsets.map((o) => ({
    o,
    q: randomQuat(rng),
    axis: spinFromShake(1, rng).map((c) => c / MAX_RELEASE_SPIN),
    j: [0, 0, 0], // this frame's jiggle
    p: null,
  }));
  const hand = { x: area.cx, z: area.cz }; // where the cluster is centred (die units, at HOLD_Y)
  let energy = 0;
  let grab = null; // {id, samples} while the pointer holds the dice
  let lastMove = null; // {t, vx, vz} of the previous pointer move (shake energy)
  let frame = 0;
  let lastFrame = 0;
  let open = true;

  let held = null;
  try {
    held = diceBox.hold(specs, { area: rect });
  } catch (err) {
    console.warn('dicer: holding the dice failed', err);
  }

  // ---- DOM ----
  const el = document.createElement('div');
  el.className = 'dicer-hand-overlay';
  Object.assign(el.style, {
    left: `${stage.left}px`,
    top: `${stage.top}px`,
    width: `${stage.width}px`,
    height: `${stage.height}px`,
  });
  const areaEl = document.createElement('div');
  areaEl.className = 'dicer-hand-area';
  Object.assign(areaEl.style, {
    left: `${rect.left - stage.left}px`,
    top: `${rect.top - stage.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  const bar = document.createElement('div');
  bar.className = 'dicer-hand-bar';
  const below = rect.top - stage.top + rect.height;
  if (below + 64 <= stage.height) bar.style.top = `${below + 10}px`;
  else if (rect.top - stage.top >= 64)
    bar.style.bottom = `${stage.height - (rect.top - stage.top) + 10}px`;
  else bar.style.bottom = '16px';
  const text = (cls, s) => {
    const t = document.createElement('span');
    t.className = cls;
    t.textContent = s;
    return t;
  };
  const button = (action, key, kbd) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.action = action;
    b.append(loc(key), ' ', Object.assign(document.createElement('kbd'), { textContent: kbd }));
    return b;
  };
  const count = text('dicer-hand-count', '');
  const auto = button('auto', 'DICER.Hand.ThrowForMe', loc('DICER.Hand.SpaceKey'));
  const cancel = button('cancel', 'DICER.Hand.Cancel', 'Esc');
  if (label) bar.append(text('dicer-hand-label', label));
  bar.append(text('dicer-hand-hint', loc('DICER.Hand.Hint')), count, auto, cancel);
  el.append(areaEl, bar);
  document.body.append(el);
  // Centred under (or over) the area, kept on the stage: its width is known once it is laid out.
  const half = bar.offsetWidth / 2 + 8;
  bar.style.left = `${clamp(rect.left - stage.left + rect.width / 2, half, stage.width - half)}px`;

  // ---- listeners (each removed by name at release or close) ----
  const offs = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };

  let finish; // resolves the overlay's promise
  const done = new Promise((r) => (finish = r));
  let timer = null;
  let ticker = null;
  /** Stops input, the timers and the frame loop (the throw, if any, flies on). */
  function detach() {
    if (!open) return;
    open = false;
    for (const off of offs.splice(0)) off();
    clearTimeout(timer);
    clearInterval(ticker);
    if (frame) globalThis.cancelAnimationFrame?.(frame);
    frame = 0;
  }
  /** Closes without a throw: the held dice go. */
  function close(result) {
    if (!open) return;
    detach();
    try {
      held?.drop();
    } catch (err) {
      console.warn('dicer: dropping the held dice failed', err);
    }
    el.remove();
    diceBox.wake?.(); // the pets' idle timers re-arm on the next frame
    finish(result);
  }

  // ---- posing ----
  /** The ground point (die units from the stage centre) under client px (x, y). */
  const ground = (x, y) => ({
    x: (x - stage.left - stage.width / 2) / diePx,
    z: (y - stage.top - stage.height / 2) / diePx,
  });
  /** Moves the hand under the pointer, inside the area (minus the cluster and a die's radius). */
  function aim(x, y) {
    const g = ground(x, y);
    const k = (camH - HOLD_Y) / camH;
    hand.x = clamp(
      g.x * k,
      area.cx - area.halfWidth + EDGE + ex,
      area.cx + area.halfWidth - EDGE - ex,
    );
    hand.z = clamp(
      g.z * k,
      area.cz - area.halfDepth + EDGE + ez,
      area.cz + area.halfDepth - EDGE - ez,
    );
  }
  /** Poses every die: the hand, its offset, and the jiggle (hovering while not grabbed). */
  function pose(now) {
    const t = now / 1000;
    dice.forEach((d, i) => {
      const bob = grab ? 0 : 0.12 * Math.sin(t * 5 + i * 1.7);
      const p = {
        x: clamp(
          hand.x + d.o.x + d.j[0],
          area.cx - area.halfWidth + EDGE,
          area.cx + area.halfWidth - EDGE,
        ),
        y: HOLD_Y + d.o.y + bob + d.j[1],
        z: clamp(
          hand.z + d.o.z + d.j[2],
          area.cz - area.halfDepth + EDGE,
          area.cz + area.halfDepth - EDGE,
        ),
      };
      d.p = p;
      held?.setPose(i, p, d.q);
    });
  }
  function tick(now) {
    frame = 0;
    if (!open) return;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    energy *= Math.exp((-dt * 1000) / SHAKE_DECAY_MS);
    const rate = grab ? 1 + TUMBLE * energy : 0.6;
    const jig = JIGGLE * energy;
    el.style.setProperty('--dicer-shake', energy.toFixed(2)); // the area glows with the shake
    for (const d of dice) {
      d.q = turn(
        d.q,
        d.axis.map((c) => c * rate),
        dt,
      );
      d.j = d.j.map(() => jig * (2 * rng() - 1));
    }
    pose(now);
    frame = globalThis.requestAnimationFrame?.(tick) ?? 0;
  }
  const clock = () => globalThis.performance?.now?.() ?? Date.now();

  // ---- the throw ----
  /** Throws (launch: per-die release states; none: "throw for me") and resolves at landing. */
  async function release(launch) {
    if (!open) return;
    detach();
    el.classList.add('dicer-hand-thrown');
    let recording = null;
    let gotRecording;
    const recorded = new Promise((r) => (gotRecording = r));
    const options = {
      free: true,
      seed: Math.floor(rng() * 2 ** 32) >>> 0,
      record: (rec) => gotRecording((recording = rec)),
    };
    if (launch) {
      options.launch = launch;
      options.edge = handEdge(launch, area);
    }
    try {
      let thrown;
      if (ghostOnRelease) {
        held.drop();
        thrown = diceBox.roll(
          specs.map((s) => ({ ...s, ghost: true })),
          { area: rect, ...options },
        );
      } else thrown = held.release(options);
      const values = await thrown.values;
      if (values && !recording) await Promise.race([recorded, thrown.finished]);
      finish({ values: values ?? null, handle: thrown.handle, recording });
    } catch (err) {
      console.warn('dicer: a hand throw failed', err);
      finish({ cancelled: true });
    } finally {
      el.remove();
    }
  }
  /** The release states of a flick: the dice where they are drawn, flying with the pointer. */
  function launchFrom(samples) {
    const [vx, vz] = velocityFromSamples(samples, diePx);
    const speed = Math.hypot(vx, vz);
    const vy = liftFromSpeed(speed);
    const spread = () => (2 * rng() - 1) * SPREAD * speed;
    return dice.map((d) => ({
      pos: [d.p.x, d.p.y, d.p.z],
      quat: [d.q.x, d.q.y, d.q.z, d.q.w],
      linvel: [vx + spread(), vy, vz + spread()],
      angvel: spinFromShake(energy, rng),
    }));
  }

  // ---- input ----
  on(el, 'pointerdown', (e) => {
    if (grab || e.button > 0 || e.target?.closest?.('.dicer-hand-bar')) return;
    e.preventDefault();
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* a synthetic pointer */
    }
    grab = { id: e.pointerId, samples: [{ t: clock(), x: e.clientX, y: e.clientY }] };
    lastMove = null;
    el.classList.add('dicer-hand-grabbing');
    aim(e.clientX, e.clientY);
    pose(clock());
  });
  on(el, 'pointermove', (e) => {
    if (!grab || e.pointerId !== grab.id) return;
    const t = clock();
    const prev = grab.samples[grab.samples.length - 1];
    grab.samples.push({ t, x: e.clientX, y: e.clientY });
    if (grab.samples.length > 64) grab.samples.splice(0, 32);
    const dt = t - prev.t;
    if (dt >= 1) {
      // Shake energy: how sharply the hand's velocity changes (a back-and-forth shake, not a sweep).
      const vx = ((e.clientX - prev.x) / dt) * (1000 / diePx);
      const vz = ((e.clientY - prev.y) / dt) * (1000 / diePx);
      if (lastMove) {
        const dv = Math.hypot(vx - lastMove.vx, vz - lastMove.vz);
        energy = Math.min(1, energy + dv * SHAKE_GAIN * Math.min(1, dt / 16));
      }
      lastMove = { vx, vz };
    }
    aim(e.clientX, e.clientY);
    pose(t);
  });
  on(el, 'pointerup', (e) => {
    if (!grab || e.pointerId !== grab.id) return;
    grab.samples.push({ t: clock(), x: e.clientX, y: e.clientY });
    aim(e.clientX, e.clientY);
    pose(clock());
    release(launchFrom(grab.samples));
  });
  // A cancelled touch (the browser took the gesture): let go without throwing; grab again.
  on(el, 'pointercancel', (e) => {
    if (!grab || e.pointerId !== grab.id) return;
    grab = null;
    el.classList.remove('dicer-hand-grabbing');
  });
  on(el, 'contextmenu', (e) => e.preventDefault());
  on(auto, 'click', () => release());
  on(cancel, 'click', () => close({ cancelled: true }));
  // Capture, before Foundry: Space would pause the game, Esc close a window.
  on(
    window,
    'keydown',
    (e) => {
      const t = e.target;
      if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '')) return;
      const space = e.code === 'Space' || e.key === ' ';
      if (!space && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (space) release();
      else close({ cancelled: true });
    },
    true,
  );

  // ---- the countdown (wall clock: a blur or a throttled tab does not pause it) ----
  if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
    const deadline = Date.now() + timeoutMs;
    const show = () => {
      count.textContent = `${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s`;
    };
    show();
    ticker = setInterval(show, 1000);
    timer = setTimeout(() => close({ timedOut: true }), timeoutMs);
  }

  if (!held) {
    close({ cancelled: true });
    return done;
  }
  pose(clock());
  frame = globalThis.requestAnimationFrame?.(tick) ?? 0;
  return done;
}
