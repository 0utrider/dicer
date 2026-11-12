// Offscreen theme thumbnails (P5-D5, P5-D6): one small WebGLRenderer renders one die per theme,
// one at a time, each in its own idle slice, and the result is cached for the session as an
// object URL. Lazy: lives in the theme-browser chunk. It never touches the live dice canvas.
import * as THREE from 'three';
import { buildScene } from '../render/scene.js';
import { configureRenderer } from '../render/renderer.js';
import { createDiceMaterial } from '../render/dice-material.js';
import { TIERS, flagsFor } from '../render/quality.js';
import { buildDieGeometry, snapEdgeRadius } from '../core/chamfer.js';
import { getShape, labelFor } from '../core/dice-shapes.js';
import { restingQuaternion, minY } from '../core/resting.js';
import { appearanceKey, normalizeAppearance, needsLookExtras } from '../look/appearance.js';
import { getLookExtras, requestLookExtras } from '../render/extras-loader.js';
import { createTurntable } from './turntable.js';

const ENV_RESOLUTION = 128;
/** The face shown on top per type (6 and 9 show the underline mark). */
const SHOWN = { d4: 4, d6: 6, d8: 8, d10: 9, d12: 12, d20: 20, d2: 2 };
const FOV = 26;
const VIEW_DISTANCE = 4.6;
const VIEW_ANGLE = THREE.MathUtils.degToRad(52);

const defaultIdle = (cb) =>
  typeof globalThis.requestIdleCallback === 'function'
    ? globalThis.requestIdleCallback(cb, { timeout: 1000 })
    : setTimeout(cb, 0);

function defaultCreateRenderer(size) {
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
  return new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
}

function frameCamera(cam, restY) {
  const target = new THREE.Vector3(0, restY * 0.85, 0);
  const dir = new THREE.Vector3(0, Math.sin(VIEW_ANGLE), Math.cos(VIEW_ANGLE));
  cam.position.copy(target).addScaledVector(dir, VIEW_DISTANCE);
  cam.lookAt(target);
}

const TMP = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
/** pitch (about X) * tilt (about Z) * yaw (about Y), applied on top of the resting orientation. */
function poseQuaternion({ yaw, pitch, tilt }, out) {
  out.setFromAxisAngle(AXIS_Y, yaw);
  out.premultiply(TMP.setFromAxisAngle(AXIS_Z, tilt));
  out.premultiply(TMP.setFromAxisAngle(AXIS_X, pitch));
  return out;
}

function canvasToBlob(canvas) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob gave no image'))), 'image/png'),
  );
}

/**
 * @param {object} o
 * @param {object} o.atlas the digit atlas (loadDigitAtlas)
 * @param {(size:number)=>THREE.WebGLRenderer} [o.createRenderer]
 * @param {number} [o.size]
 * @param {(cb:Function)=>void} [o.idle]
 * @param {(msg:string)=>void} [o.warn]
 * @param {()=>object} [o.createScene] test seam (headless PMREM)
 * @param {(cb:Function)=>number} [o.raf] requestAnimationFrame (live preview)
 * @param {(id:number)=>void} [o.caf] cancelAnimationFrame
 * @param {()=>boolean} [o.reducedMotion] prefers-reduced-motion
 * @param {object} [o.doc] the document (visibilityState + visibilitychange)
 * @param {{get: Function, request: Function}} [o.fonts] the font layer (fonts/font-atlas.js): the
 *   atlas of a look's numbers.font. A thumbnail waits for its font (the layer times out); a live
 *   preview draws with the serif until the font is ready, then rebuilds its die.
 */
export function createThumbnailer({
  atlas,
  createRenderer,
  size = 256,
  idle = defaultIdle,
  warn = console.warn,
  createScene = () => buildScene(),
  raf = (cb) => globalThis.requestAnimationFrame(cb),
  caf = (id) => globalThis.cancelAnimationFrame(id),
  reducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
  doc = globalThis.document,
  fonts = null,
} = {}) {
  const make = createRenderer ?? (() => defaultCreateRenderer(size));
  const cache = new Map(); // key -> object URL
  const loose = new Set(); // uncached object URLs (serif stand-ins), revoked on dispose
  const inflight = new Map(); // key -> Promise
  let chain = Promise.resolve();
  let renderer = null;
  let sceneApi = null;
  let camera = null;
  let canvas = null;
  let onLost = null;
  let broken = false;
  let disposed = false;
  // Geometry per die type and edge step (type|radius), shared by every thumbnail and preview
  // that uses it and freed when the last one lets go (the same keys as DiceBox's cache).
  const geometries = new Map(); // key -> { geometry, refs }
  function acquireGeometry(shape, shapeType, appearance) {
    const radius = snapEdgeRadius(appearance.edges?.radius);
    const key = `${shapeType}|${radius}`;
    let entry = geometries.get(key);
    if (!entry) {
      const geometry = buildDieGeometry(shape, { radius });
      geometry.computeBoundingSphere();
      entry = { geometry, refs: 0 };
      geometries.set(key, entry);
    }
    entry.refs++;
    return { geometry: entry.geometry, release: () => releaseGeometry(key, entry) };
  }
  function releaseGeometry(key, entry) {
    if (--entry.refs > 0) return;
    entry.geometry.dispose();
    if (geometries.get(key) === entry) geometries.delete(key);
  }
  let flags = null;
  const fontOf = (appearance) => appearance?.numbers?.font ?? 'serif';
  const isSerif = (id) => !id || id === 'serif' || !fonts;
  /** The ready atlas for a font id, else null (never throws). */
  const readyAtlas = (id) => {
    if (isSerif(id)) return atlas;
    try {
      return fonts.get(id) ?? null;
    } catch {
      return null;
    }
  };
  /** fonts.hold(a): keeps an evicted runtime atlas alive until release() (never throws). */
  const holdAtlas = (a) => {
    if (!a || a === atlas || typeof fonts?.hold !== 'function') return () => {};
    try {
      const release = fonts.hold(a);
      return typeof release === 'function' ? release : () => {};
    } catch {
      return () => {};
    }
  };
  /** Resolves the font's atlas once ready, or the serif when it cannot be used. */
  const awaitAtlas = async (id) => {
    if (isSerif(id)) return atlas;
    try {
      return (await fonts.request(id)) ?? atlas;
    } catch {
      return atlas;
    }
  };
  let curSize = 0; // the renderer's current square size (a preview frame may change it)
  let busy = false; // a thumbnail render + capture is in flight: no preview frame may touch the canvas
  const previews = new Set();

  const fail = (message) => {
    if (broken) return;
    broken = true;
    warn(`dicer: theme thumbnails unavailable (${message})`);
    for (const p of [...previews]) p.halt(true);
    teardown(); // release the broken renderer, scene and PMREM now (no idle GPU)
  };

  function init() {
    try {
      renderer = configureRenderer(make());
      canvas = renderer.domElement;
      onLost = (e) => {
        e?.preventDefault?.();
        fail('WebGL context lost');
      };
      canvas.addEventListener?.('webglcontextlost', onLost);
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      curSize = size;
      renderer.setClearColor(0x000000, 0);
      sceneApi = createScene();
      sceneApi.setEnvironment(renderer, { resolution: ENV_RESOLUTION });
      camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 20);
      flags = flagsFor(TIERS.medium, { interiors: true, engraving: true, glow: true });
    } catch (err) {
      fail(err?.message ?? String(err));
      teardown();
    }
  }

  function teardown() {
    try {
      if (canvas && onLost) canvas.removeEventListener?.('webglcontextlost', onLost);
      sceneApi?.dispose();
      renderer?.dispose();
    } catch {
      /* already gone */
    }
    sceneApi = renderer = camera = canvas = onLost = null;
    curSize = 0;
  }

  async function renderOne(theme, dieType, dieAtlas = atlas) {
    const appearance = theme.perType?.[dieType] ?? theme.appearance;
    const shapeType = dieType === 'd100' ? 'd10' : dieType;
    const shape = getShape(shapeType);
    const labels = shape.values.map((v) => labelFor(shapeType, v));
    const api = sceneApi; // dispose() may null the module state while the blob is pending
    const cam = camera;
    const cvs = canvas;
    const rnd = renderer;
    const material = createDiceMaterial(appearance, dieAtlas, shape, labels, flags);
    const releaseAtlas = holdAtlas(dieAtlas);
    // The geometry is acquired only once the material exists; anything after it that throws
    // gives it back.
    const held = acquireGeometry(shape, shapeType, appearance);
    const geometry = held.geometry;
    let mesh;
    let shadow;
    try {
      mesh = new THREE.Mesh(geometry, material);
      const face = shape.values.indexOf(SHOWN[shapeType] ?? shape.values[shape.values.length - 1]);
      mesh.quaternion.copy(restingQuaternion(shape, Math.max(0, face)));
      mesh.position.y = -minY(geometry, mesh.quaternion);
      shadow = api.shadowFor({ position: mesh.position, geometry });
    } catch (err) {
      material.userData?.uniforms?.uLabels?.value?.dispose();
      material.dispose();
      releaseAtlas();
      held.release();
      throw err;
    }
    api.scene.add(mesh);
    busy = true;
    try {
      frameCamera(cam, mesh.position.y);
      if (curSize !== size) {
        rnd.setSize(size, size, false);
        curSize = size;
      }
      rnd.render(api.scene, cam);
      return await canvasToBlob(cvs);
    } finally {
      busy = false;
      api.scene.remove(mesh);
      api.releaseShadow(shadow);
      material.userData?.uniforms?.uLabels?.value?.dispose();
      material.dispose();
      releaseAtlas();
      held.release();
    }
  }

  /** standIn: the serif drew a look whose font cannot be used; such an image is not cached. */
  async function job(theme, dieType, key, dieAtlas = atlas, standIn = false) {
    await new Promise((resolve) => idle(resolve));
    if (disposed || broken) return null;
    if (!renderer) init();
    if (!renderer || broken) return null;
    try {
      const blob = await renderOne(theme, dieType, dieAtlas);
      if (disposed) return null;
      if (broken) return null; // context lost mid-render: the image is not trustworthy
      const url = URL.createObjectURL(blob);
      if (standIn) loose.add(url);
      else cache.set(key, url);
      return url;
    } catch (err) {
      if (disposed) return null;
      warn(`dicer: theme thumbnail failed (${err?.message ?? err})`);
      return null;
    }
  }

  function thumbnail(theme, dieType = 'd20') {
    if (disposed || broken) return Promise.resolve(null);
    const appearance = theme?.perType?.[dieType] ?? theme?.appearance;
    if (!appearance) return Promise.resolve(null);
    const key = `${appearanceKey(appearance)}|${dieType}|${size}`;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inflight.has(key)) return inflight.get(key);
    const fontId = fontOf(appearance);
    // A look with another font waits for it before joining the render chain, so a slow font
    // never holds up other thumbnails.
    const enqueue = (dieAtlas, standIn) => {
      const r = chain.then(() => job(theme, dieType, key, dieAtlas, standIn));
      chain = r.catch(() => null);
      return r;
    };
    // A look needing the look-extras chunk waits for it too; a failed chunk draws the fallback
    // as a stand-in that is not cached.
    const wantsExtras = !getLookExtras() && needsLookExtras(normalizeAppearance(appearance));
    const p =
      isSerif(fontId) && !wantsExtras
        ? enqueue(atlas, false)
        : Promise.all([awaitAtlas(fontId), wantsExtras ? requestLookExtras() : true]).then(([a, x]) =>
            disposed ? null : enqueue(a, (a === atlas && !isSerif(fontId)) || !x),
          );
    inflight.set(key, p);
    const done = () => inflight.delete(key);
    p.then(done, done);
    return p;
  }

  /**
   * A live turning die on a visible 2D canvas, drawn by this thumbnailer's renderer and scene (no
   * second WebGL context): each frame is rendered offscreen, then copied with drawImage in the same
   * task. The material and geometry live only while the preview does. The loop runs only while the
   * document is visible; prefers-reduced-motion draws still frames (drag still turns the die).
   * @param {HTMLCanvasElement} target a canvas already sized (css size * pixel ratio), square
   * @param {object} theme
   * @param {string} [dieType]
   * @param {{onFrame?:Function, onLost?:Function}} [hooks] onFrame after each drawn frame; onLost
   *   once when the preview ended because WebGL failed (show the static thumbnail instead)
   * @returns {{setRotation:(r:{yaw?:number,pitch?:number})=>void, reset:()=>void, update:(theme:object, dieType?:string)=>void, stop:()=>void, active:boolean}|null}
   *   update swaps the look (and die type) in place: the old material is freed, the turn goes on.
   */
  function preview(target, theme, dieType = 'd20', hooks = {}) {
    let appearance = theme?.perType?.[dieType] ?? theme?.appearance;
    if (disposed || broken || !appearance || !target) return null;
    const ctx = target.getContext?.('2d');
    if (!ctx) return null;
    const still = reducedMotion();
    const turn = createTurntable({ reducedMotion: still });
    const q = new THREE.Quaternion();
    let res = null; // { mesh, material, geometry, baseQ, y }
    let handle = 0;
    let last = null;
    let stopped = false;
    const visible = () => !doc || doc.visibilityState === undefined || doc.visibilityState === 'visible';

    const free = () => {
      if (!res) return;
      res.material.userData?.uniforms?.uLabels?.value?.dispose();
      res.material.dispose();
      res.releaseAtlas();
      res.release();
      res = null;
    };
    const cancel = () => {
      if (handle) caf(handle);
      handle = 0;
      last = null;
    };

    function build() {
      if (!renderer) init();
      if (!renderer || broken) return false;
      const shapeType = dieType === 'd100' ? 'd10' : dieType;
      const shape = getShape(shapeType);
      const labels = shape.values.map((v) => labelFor(shapeType, v));
      const fontId = fontOf(appearance);
      const dieAtlas = readyAtlas(fontId);
      const material = createDiceMaterial(appearance, dieAtlas ?? atlas, shape, labels, flags);
      const releaseAtlas = holdAtlas(dieAtlas);
      if (!dieAtlas) {
        // the serif stands in: rebuild the die once the font is ready
        awaitAtlas(fontId).then((a) => {
          if (a === atlas || stopped || !res?.standIn) return;
          free();
          redraw();
        });
      }
      const extrasWait = !getLookExtras() && needsLookExtras(normalizeAppearance(appearance));
      if (extrasWait) {
        // the fallback look stands in: rebuild the die once the chunk is ready
        requestLookExtras().then((m) => {
          if (!m || stopped || !res?.extrasWait) return;
          free();
          redraw();
        });
      }
      const held = acquireGeometry(shape, shapeType, appearance);
      const geometry = held.geometry;
      let mesh;
      let baseQ;
      try {
        mesh = new THREE.Mesh(geometry, material);
        const face = shape.values.indexOf(SHOWN[shapeType] ?? shape.values[shape.values.length - 1]);
        baseQ = restingQuaternion(shape, Math.max(0, face)).clone();
        mesh.position.y = -minY(geometry, baseQ);
      } catch (err) {
        material.userData?.uniforms?.uLabels?.value?.dispose();
        material.dispose();
        releaseAtlas();
        held.release();
        throw err;
      }
      res = {
        mesh,
        material,
        geometry,
        release: held.release,
        releaseAtlas,
        baseQ,
        y: mesh.position.y,
        standIn: !dieAtlas,
        extrasWait,
      };
      return true;
    }

    function frame() {
      if (stopped || busy) return;
      try {
        if (!res && !build()) return;
        const api = sceneApi;
        const rnd = renderer;
        const px = Math.max(1, Math.round(target.width));
        if (curSize !== px) {
          rnd.setSize(px, px, false);
          curSize = px;
        }
        res.mesh.quaternion.copy(poseQuaternion(turn.pose(), q)).multiply(res.baseQ);
        const shadow = api.shadowFor({ position: res.mesh.position, geometry: res.geometry });
        api.scene.add(res.mesh);
        try {
          frameCamera(camera, res.y);
          rnd.render(api.scene, camera);
          ctx.clearRect(0, 0, target.width, target.height);
          ctx.drawImage(canvas, 0, 0, target.width, target.height);
        } finally {
          api.scene.remove(res.mesh);
          api.releaseShadow(shadow);
        }
        hooks.onFrame?.();
      } catch (err) {
        if (stopped || disposed) return;
        warn(`dicer: theme preview failed (${err?.message ?? err})`);
        p.halt(true);
      }
    }

    function tick(ts) {
      handle = 0;
      if (stopped || !visible()) return; // a hidden document resumes through visibilitychange
      const dt = last === null ? 0 : (ts - last) / 1000;
      last = ts;
      turn.update(dt);
      frame();
      if (!stopped) handle = raf(tick);
    }

    /** Draws now when the loop is not running (reduced motion, or between events). */
    const redraw = () => {
      if (still || !handle) frame();
    };
    const wake = () => {
      if (stopped || handle || !visible()) return;
      if (still) return frame();
      last = null;
      handle = raf(tick);
    };
    const onVisibility = () => (visible() ? wake() : cancel());

    // drag to spin, double-click to reset
    let pointer = null;
    let lastT = 0;
    const down = (e) => {
      if (e.button > 0) return;
      pointer = e.pointerId;
      target.setPointerCapture?.(e.pointerId);
      lastT = e.timeStamp ?? 0;
      turn.grab();
    };
    const move = (e) => {
      if (e.pointerId !== pointer) return;
      const t = e.timeStamp ?? lastT;
      turn.drag(e.movementX ?? 0, e.movementY ?? 0, (t - lastT) / 1000);
      lastT = t;
      redraw();
    };
    const up = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      target.releasePointerCapture?.(e.pointerId);
      turn.release();
      wake();
    };
    const dbl = () => {
      turn.reset();
      redraw();
    };
    const listeners = [
      ['pointerdown', down],
      ['pointermove', move],
      ['pointerup', up],
      ['pointercancel', up],
      ['dblclick', dbl],
    ];

    const p = {
      get active() {
        return !stopped;
      },
      setRotation(r) {
        turn.set(r);
        redraw();
      },
      reset: dbl,
      update(next, type = dieType) {
        const look = next?.perType?.[type] ?? next?.appearance;
        if (stopped || !look) return;
        appearance = look;
        dieType = type;
        free();
        redraw();
      },
      /** lost: the preview ended because WebGL failed rather than because the caller stopped it. */
      halt(lost = false) {
        if (stopped) return;
        stopped = true;
        cancel();
        for (const [t, f] of listeners) target.removeEventListener?.(t, f);
        doc?.removeEventListener?.('visibilitychange', onVisibility);
        previews.delete(p);
        free();
        if (lost) hooks.onLost?.();
      },
      stop() {
        p.halt(false);
      },
    };

    previews.add(p);
    for (const [t, f] of listeners) target.addEventListener?.(t, f);
    doc?.addEventListener?.('visibilitychange', onVisibility);
    if (visible()) {
      frame(); // the first frame at once, so the stage never sits empty
      if (!stopped && !still) handle = raf(tick);
    }
    return p;
  }

  function dispose() {
    for (const p of [...previews]) p.stop();
    disposed = true;
    for (const url of [...cache.values(), ...loose]) URL.revokeObjectURL(url);
    loose.clear();
    for (const e of geometries.values()) e.geometry.dispose();
    geometries.clear();
    cache.clear();
    teardown();
  }

  return { thumbnail, preview, dispose };
}
