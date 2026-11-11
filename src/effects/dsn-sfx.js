/**
 * Dice So Nice special effects (`game.dice3d.addSFXMode` classes) as Dicer effects, rebuilt from
 * the observed DiceSFX contract: `static id`, `static specialEffectName`, `static
 * PLAY_ONLY_ONCE_PER_MESH`, `static async init()`, `new Cls(box, dicemesh, options)`,
 * `async play()` and an optional `destroy()`. Third-party code: every call is guarded, capped by
 * a timeout and logged once per class; nothing here can stop a roll from revealing.
 */
export const SFX_TIMEOUT_MS = 10000;
export const SFX_INIT_TIMEOUT_MS = 5000;

const PREFIX = 'dsn:';
const COST = 2;

/** Resolves/rejects like `promise`, or rejects with `Error(message)` after `ms`. */
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        globalThis.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        globalThis.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * @param {object} o
 * @param {{sfxModes: Map<string, {sfxClass: Function}>}} o.registry
 * @param {() => {scene?: object, camera?: object, glRenderer?: object}} [o.getBox] the dice box's
 *   scene/camera and the THREE.WebGLRenderer
 * @param {(...a: unknown[]) => void} [o.warn]
 * @returns {{effectFor(id: string): object|null}}
 */
export function createDsnSfx({ registry, getBox = () => ({}), warn = (...a) => console.warn(...a) }) {
  const warned = new Set();
  const warnOnce = (key, message, err) => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(`dicer: ${message}`, err);
  };
  const inits = new Map(); // class -> Promise<boolean> (true = usable)
  const disabled = new WeakSet();
  const played = new WeakMap(); // die -> Set<class> for PLAY_ONLY_ONCE_PER_MESH
  const typed = new WeakMap(); // outer -> {n, type}: Object3D.type is overridden while SFX run
  const modules = new Map();

  function ensureInit(cls, name) {
    let p = inits.get(cls);
    if (!p) {
      p = (async () => {
        try {
          await withTimeout(Promise.resolve(cls.init?.()), SFX_INIT_TIMEOUT_MS, 'init timed out');
          return true;
        } catch (err) {
          disabled.add(cls);
          warnOnce(`init:${name}`, `special effect "${name}" failed to initialise; disabled`, err);
          return false;
        }
      })();
      inits.set(cls, p);
    }
    return p;
  }

  /** dicemesh: the die's outer Object3D, `result` = the value, `type` = the die type. */
  function lend(outer, die) {
    let rec = typed.get(outer);
    if (!rec) {
      rec = { n: 0, type: outer.type };
      typed.set(outer, rec);
    }
    rec.n++;
    outer.result = die.value;
    outer.type = die.type;
  }
  function unlend(outer) {
    const rec = typed.get(outer);
    if (!rec || --rec.n > 0) return;
    typed.delete(outer);
    outer.type = rec.type;
    delete outer.result;
  }

  function begin(name, ctx) {
    const entry = registry?.sfxModes?.get(name);
    const cls = entry?.sfxClass;
    if (typeof cls !== 'function' || disabled.has(cls)) return null;
    const die = ctx.die;
    if (cls.PLAY_ONLY_ONCE_PER_MESH && die && typeof die === 'object') {
      let set = played.get(die);
      if (!set) played.set(die, (set = new Set()));
      if (set.has(cls)) return null;
      set.add(cls);
    }
    const outer = die?.outer;
    const { id: _id, ...options } = ctx.options ?? {};
    let done = false;
    let instance = null;
    let lent = false;
    let timer = null;

    const finish = () => {
      if (done) return;
      done = true;
      globalThis.clearTimeout(timer);
      if (lent) unlend(outer);
      if (instance) {
        try {
          instance.destroy?.();
        } catch (err) {
          warnOnce(`destroy:${name}`, `special effect "${name}" failed to clean up`, err);
        }
      }
    };
    timer = globalThis.setTimeout(() => {
      warnOnce(`timeout:${name}`, `special effect "${name}" took over ${SFX_TIMEOUT_MS} ms; stopped`);
      finish();
    }, SFX_TIMEOUT_MS);

    (async () => {
      try {
        if (!(await ensureInit(cls, name)) || done) {
          finish();
          return;
        }
        let gb = {};
        try {
          gb = getBox() ?? {};
        } catch {
          /* fall back to the effect context */
        }
        // renderScene is a no-op: the layer's update() returning true keeps the loop rendering.
        const box = {
          scene: gb.scene ?? ctx.scene,
          camera: gb.camera ?? ctx.camera,
          renderer: gb.glRenderer ?? gb.renderer,
          renderScene() {},
          dicer: true,
        };
        if (outer) {
          lend(outer, die);
          lent = true;
        }
        instance = new cls(box, outer, options);
        await instance.play();
      } catch (err) {
        warnOnce(`play:${name}`, `special effect "${name}" failed; skipped`, err);
      }
      finish();
    })();

    return {
      // The effect lives until play() settles, SFX_TIMEOUT_MS passes, or the layer stops it.
      update: () => !done,
      stop: finish,
    };
  }

  return {
    effectFor(id) {
      if (typeof id !== 'string' || !id.startsWith(PREFIX)) return null;
      const name = id.slice(PREFIX.length);
      if (!registry?.sfxModes?.has(name)) return null;
      let mod = modules.get(name);
      if (!mod) {
        mod = { id, cost: COST, defaults: {}, bindsDie: true, start: (ctx) => begin(name, ctx) };
        modules.set(name, mod);
      }
      return mod;
    },
  };
}
