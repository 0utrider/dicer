import * as THREE from 'three';

/** Screen shake: peak offset in CSS px at intensity 1. */
export const SHAKE_PX = 6;

/**
 * The effect runtime: starts library effects for landed dice, advances them from DiceBox's
 * render tick and stops them. DiceBox keeps its loop alive only while update() returns true,
 * so nothing runs (and no frame renders) once the last effect is done (G2).
 *
 * The library (./library/index.js, the lazy `effects` chunk) is loaded by prefetch(), which
 * main.js calls in an idle callback after `ready`; until it is in, play() starts nothing.
 *
 * Effect module contract: { id, cost, defaults: {color, intensity, duration}, bindsDie?,
 *   start(ctx) -> { update(nowMs) -> boolean, stop() } }
 * ctx = { scene, camera, die, position, color, intensity, duration, options, particles,
 *   isolate(die) -> uniforms | null, shake(amount, ms), tier, reducedMotion,
 *   setting(key) -> value (never throws; insideFlare is read through it) }.
 * An effect with bindsDie (or one that isolated its die) is stopped by releaseDie(die).
 *
 * Budget: the summed cost of the effects running at once never exceeds tier.effectBudget.
 * When a die's effects do not all fit, the cheapest are kept (ties in rule order) and are
 * started in rule order; the rest are dropped.
 *
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {THREE.Camera} o.camera
 * @param {{style: CSSStyleDeclaration}} o.canvas the dice canvas (shake moves it alone)
 * @param {() => {effectBudget: number, particleScale: number}} o.getTier quality TIERS entry
 * @param {(key: string) => unknown} [o.getSetting]
 * @param {() => Promise<{EFFECTS: Record<string, object>}>} [o.loadLibrary]
 * @param {() => number} [o.now] the ms clock impact effects use (the pool's own default clock)
 * @param {(id: string) => void} [o.onPlay] called once per effect that actually started (debug counters)
 * @param {(die: object) => object|null} [o.isolate] DiceBox.isolate: the die's own uniforms
 * @param {() => boolean} [o.isSafe] the safe flags are on: library shaders are skipped, DSN effects run
 * @param {(objects: THREE.Object3D[]) => unknown} [o.warm] compiles these objects' programs off the
 *   hot path (main.js: DiceRenderer.warmObjects, a guarded compileAsync); called once with the
 *   particle pool's meshes when prefetch() made the pool. May throw or reject: ignored.
 * @param {{effectFor(id: string): object|null}} [o.dsnSfx] resolves `dsn:` ids (Dice So Nice
 *   special effects, third-party code that is not in the library chunk)
 */
export function createEffectLayer({
  scene,
  camera,
  canvas,
  getTier,
  getSetting = () => undefined,
  loadLibrary = () => import('./library/effects.js'),
  isolate = () => null,
  dsnSfx = null,
  jb2a = null,
  isSafe = () => false,
  particles = null,
  warm = () => {},
  matchMedia = (q) => globalThis.matchMedia?.(q),
  now = () => performance.now(),
  onPlay = () => {},
  warn = (...a) => console.warn(...a),
  debug = (...a) => console.debug(...a),
}) {
  let library = null; // id -> module, once loaded
  let createPool = null; // the library's createParticlePool, once loaded
  let flareRolls = null; // the library's flareRolls (inside-flare.js), once loaded
  let impactFx = null; // the library's impact emitter (createImpactFx in library/particles.js), once loaded
  let trailFx = null; // the library's trail emitter (createTrailFx), once loaded
  let withBursts = null; // the library's crit burst rules (bursts.js: the automatic burst, the cap), once loaded
  let pool = particles; // the shared particle pool: made on first use (or injected)
  let loading = null;
  let player = null; // the JB2A player (src/jb2a/jb2a.js, the lazy `jb2a` chunk), once loaded
  let jb2aLoading = null;
  let loadFailed = false;
  let disposed = false;
  let debugged = false;
  const warned = new Set();
  /** Running effects: { handle, die, cost, bound }, in start order. */
  const running = [];
  let cost = 0;
  const shake = { amp: 0, ms: 0, t0: null, last: 0, seed: 0, base: null, active: false };

  const warnOnce = (key, message, err) => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(`dicer: ${message}`, err);
  };
  const setting = (key) => {
    try {
      return getSetting(key);
    } catch {
      return undefined;
    }
  };

  /** Loads the JB2A chunk once, when JB2A is active and jb2aEffects is not off; never rejects. */
  function loadJb2a() {
    try {
      if (!jb2aLoading && !disposed && setting('jb2aEffects') !== false && jb2a?.source()) {
        jb2aLoading = Promise.resolve(jb2a.load())
          .then((mod) => {
            if (disposed) return;
            player = mod.createJb2aPlayer({ source: jb2a.source });
            player.preload();
          })
          .catch((err) => warnOnce('jb2a', 'cannot load the JB2A player; built-in effects play', err));
      }
    } catch {
      // no JB2A: built-in effects
    }
    return jb2aLoading;
  }

  function prefetch() {
    return Promise.all([loadJb2a(), loadEffects()]).then(() => {});
  }

  function loadEffects() {
    if (library || loadFailed || disposed) return Promise.resolve();
    if (loading) return loading;
    let load;
    try {
      load = Promise.resolve(loadLibrary());
    } catch (err) {
      load = Promise.reject(err);
    }
    loading = load
      .then((mod) => {
        const effects = mod?.EFFECTS;
        if (!effects || typeof effects !== 'object') throw new Error('no EFFECTS export');
        if (!disposed) {
          library = effects;
          createPool = typeof mod.createParticlePool === 'function' ? mod.createParticlePool : null;
          flareRolls = typeof mod.flareRolls === 'function' ? mod.flareRolls : null;
          const deps = { getPool, getTier, now, reducedMotion, setting, warnOnce };
          impactFx = typeof mod.createImpactFx === 'function' ? mod.createImpactFx(deps) : null;
          trailFx = mod.createTrailFx && mod.createTrailFx(deps);
          withBursts = mod.withBursts;
          prewarmPool();
        }
      })
      .catch((err) => {
        loadFailed = true;
        warnOnce('library', 'cannot load the effects library; effects are off', err);
      });
    return loading;
  }

  /**
   * The gates every library entry point shares: 'off' (the effects setting), 'safe' (a Dicer
   * shader failed: library shaders are skipped, DSN effects still run) or 'on'. A throwing
   * isSafe() probe counts as not safe.
   */
  function gate() {
    if (setting('effects') === false) return 'off';
    try {
      if (isSafe() === true) return 'safe';
    } catch {
      // not safe
    }
    return 'on';
  }

  /**
   * Makes the particle pool once the library is in (an idle-time prefetch) and hands its meshes
   * to warm(), so the first impact or particle effect does not compile two programs mid-throw.
   * Never throws; without a warm-up the pool still works, compiled on first use.
   */
  function prewarmPool() {
    if (gate() !== 'on' || !getPool()) return;
    try {
      Promise.resolve(warm(pool.layers.map((l) => l.mesh))).catch(() => {});
    } catch {
      // the pool still compiles on first use
    }
  }

  function reducedMotion() {
    try {
      return !!matchMedia('(prefers-reduced-motion: reduce)')?.matches;
    } catch {
      return false;
    }
  }

  /** CSS-translates the dice canvas: amplitude <= SHAKE_PX x amount (0..1), damped over ms. */
  function startShake(amount, ms) {
    if (!canvas?.style || setting('screenShake') === false || reducedMotion()) return;
    const amp = SHAKE_PX * Math.min(1, Math.max(0, Number(amount) || 0));
    const dur = Math.max(0, Number(ms) || 0);
    if (!(amp > 0) || !(dur > 0)) return;
    if (!shake.active) shake.base = canvas.style.transform ?? '';
    // A stronger shake wins; a weaker one during it is absorbed.
    if (shake.active && amp < shake.amp * remaining(shake.last)) return;
    shake.amp = amp;
    shake.ms = dur;
    shake.t0 = null;
    shake.seed = Math.random() * 6.283;
    shake.active = true;
  }
  function remaining(now) {
    if (shake.t0 === null) return 1;
    return Math.max(0, 1 - (now - shake.t0) / shake.ms);
  }
  function stopShake() {
    if (!shake.active) return;
    shake.active = false;
    if (canvas?.style) canvas.style.transform = shake.base ?? '';
  }
  function updateShake(now) {
    if (!shake.active) return false;
    shake.t0 ??= now;
    shake.last = now;
    const k = remaining(now);
    if (k <= 0) {
      stopShake();
      return false;
    }
    const e = now - shake.t0;
    const a = shake.amp * k * k;
    // Oscillates along a slowly turning direction: |offset| <= a.
    const osc = a * Math.sin(e * 0.09 + shake.seed);
    const dir = e * 0.023 + shake.seed * 1.7;
    const x = osc * Math.cos(dir);
    const y = osc * Math.sin(dir);
    canvas.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    return true;
  }

  /** One pool per scene, capacity round(2048 x particleScale), created when an effect asks. */
  function getPool() {
    if (pool || !createPool || disposed) return pool;
    const scale = Number(getTier()?.particleScale);
    try {
      pool = createPool(scene, Math.round(2048 * (scale > 0 ? scale : 1)));
    } catch (err) {
      createPool = null;
      warnOnce('pool', 'cannot create the particle pool; particle effects are off', err);
    }
    return pool;
  }

  /** In safe mode only `dsn:` and JB2A modules resolve; JB2A is tried before the library. */
  function moduleFor(f, safe) {
    const id = f?.effect?.id;
    if (typeof id !== 'string') return null;
    if (id.startsWith('dsn:')) {
      let m = null;
      try {
        m = dsnSfx?.effectFor(id) ?? null;
      } catch (err) {
        warnOnce(`dsn:${id}`, `cannot resolve special effect "${id}"`, err);
      }
      return m && typeof m.start === 'function' ? m : null;
    }
    if (!library) return null;
    let mod = Object.hasOwn(library, id) ? library[id] : null;
    if (typeof mod?.start !== 'function') mod = null;
    let j = null;
    try {
      if (setting('jb2aEffects') !== false && !String(f?.ruleId).startsWith('damage:')) j = player?.moduleFor(id, mod, { safe, file: f.effect.jb2a });
    } catch {
      // the built-in plays
    }
    return j ?? (safe ? null : mod);
  }
  const costOf = (mod) => (Number.isFinite(mod.cost) && mod.cost > 0 ? mod.cost : 0);

  function start(die, f, mod) {
    const e = f.effect;
    const d = mod.defaults ?? {};
    let bound = mod.bindsDie === true;
    let color;
    try {
      color = new THREE.Color(e.color ?? d.color ?? '#ffffff');
    } catch {
      color = new THREE.Color('#ffffff');
    }
    const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
    const ctx = {
      scene,
      camera,
      die,
      position: die?.outer?.position?.clone?.() ?? new THREE.Vector3(),
      color,
      intensity: num(e.intensity, num(d.intensity, 1)),
      duration: Math.max(0, num(e.duration, num(d.duration, 1000))),
      options: { ...e }, // a copy: fx objects are shared with the cached rules
      get particles() {
        return getPool();
      },
      tier: getTier(),
      isolate: (target) => {
        if (target === die) bound = true;
        return isolate(target);
      },
      shake: startShake,
      reducedMotion: reducedMotion(),
      setting,
    };
    let handle;
    try {
      handle = mod.start(ctx);
    } catch (err) {
      warnOnce(`start:${mod.id}`, `effect "${mod.id}" failed to start; skipped`, err);
      return;
    }
    if (!handle || typeof handle.update !== 'function') return;
    const c = costOf(mod);
    cost += c;
    running.push({ handle, die, cost: c, bound, id: mod.id });
    try {
      onPlay(typeof e.id === 'string' ? e.id : mod.id);
    } catch {
      /* a debug counter never affects a roll */
    }
  }

  function stopAt(i) {
    const r = running[i];
    running.splice(i, 1);
    cost -= r.cost;
    try {
      r.handle.stop?.();
    } catch (err) {
      warnOnce(`stop:${r.id}`, `effect "${r.id}" failed to stop`, err);
    }
  }

  function disposePool() {
    try {
      pool?.dispose?.();
    } catch (err) {
      warnOnce('pool-dispose', 'the particle pool failed to dispose', err);
    }
    pool = null;
    createPool = null;
  }

  return {
    /** The number of running effects (for tests and diagnostics). */
    get running() {
      return running.length;
    },
    get loaded() {
      return library !== null;
    },
    prefetch,

    /**
     * Starts a landed die's effects (fx: Task 7 Fx[]) plus its crit burst, if any; never throws.
     * withBursts caps every burst-* and adds the automatic one; before the library is in, a 20 asks for it.
     */
    play(die, fx) {
      fx = withBursts ? withBursts(die, fx, running, setting) : (die?.value == 20 && gate() != 'off' && prefetch(), fx);
      if (disposed || !Array.isArray(fx) || !fx.length) return;
      const g = gate();
      if (g === 'off') return;
      if (!player) loadJb2a();
      if (!library) {
        // DSN special effects do not need the library; everything else waits for it.
        if (fx.some((f) => f?.effect && !String(f.effect.id).startsWith('dsn:'))) {
          if (!debugged) {
            debugged = true;
            debug('dicer: the effects library is not loaded yet; skipping this roll’s effects');
          }
          prefetch();
        }
      }
      const budget = Number(getTier()?.effectBudget) || 0;
      const picks = [];
      fx.forEach((f, i) => {
        const mod = moduleFor(f, g === 'safe');
        if (mod) picks.push({ f, mod, i, c: costOf(mod) });
      });
      if (!picks.length) return;
      picks.sort((a, b) => a.c - b.c || a.i - b.i);
      let left = budget - cost;
      const keep = [];
      for (const p of picks) {
        if (p.c > left) continue;
        left -= p.c;
        keep.push(p);
      }
      keep.sort((a, b) => a.i - b.i);
      for (const p of keep) start(die, p.f, p.mod);
    },

    /**
     * Flares the living inside of each of `dice` through the library's flareInside (the same
     * envelope, max and cap as the crit/fumble effects). True when at least one die flared;
     * false while the library is not loaded (it is asked for), when insideFlare is off or no
     * die has a moving inside. Free of budget; releaseDie stops it with its die.
     */
    flare(rolls, opts) {
      if (gate() === 'off') return false;
      if (!flareRolls) return prefetch(), false;
      return flareRolls(
        rolls,
        opts,
        (die) => ({ die, setting, isolate, reducedMotion: reducedMotion() }),
        (handle, die) => running.push({ handle, die, cost: 0, bound: true, id: 'inside-flare' }),
      );
    },

    /**
     * Sparks where a die hits the table hard (the emitter is in the library chunk). Free of
     * budget: the pool's own life keeps the loop running. Never throws.
     * Skipped in safe mode like every library effect (the pool's shaders are library shaders).
     * @param {{position: {x: number, y?: number, z: number}, speed: number, surface?: string, dieKey?: string}} hit
     */
    impact(hit) {
      if (disposed || !impactFx) return;
      try {
        // The cheap threshold first: a 30-die pool sends many events per frame.
        if (!(Number(hit?.speed) >= (Number(impactFx.minSpeed) || 0))) return;
        if (gate() !== 'on' || setting('impactEffects') === false || reducedMotion()) return;
        impactFx.impact(hit);
      } catch (err) {
        warnOnce('impact', 'impact effect failed', err);
      }
    },

    /** Per playing frame; the library trail fx checks elementalTrails and catches its own errors. Asks for an unloaded library. */
    flight(roll, nowMs) {
      gate() === 'on' && (trailFx ? trailFx.flight(roll.dice, nowMs) : loading || loadEffects());
    },

    /** Advances every running effect; true while any runs (or the canvas shakes). */
    update(nowMs) {
      for (let i = 0; i < running.length;) {
        let alive = false;
        try {
          alive = running[i].handle.update(nowMs) === true;
        } catch (err) {
          warnOnce(`update:${running[i].id}`, `effect "${running[i].id}" failed; stopped`, err);
        }
        if (alive) i++;
        else stopAt(i);
      }
      const shaking = updateShake(nowMs);
      let live = false;
      if (pool) {
        try {
          live = pool.update(nowMs) === true;
        } catch (err) {
          warnOnce('pool-update', 'the particle pool failed; disabled', err);
          disposePool();
        }
      }
      return running.length > 0 || shaking || live;
    },

    /** Stops the effects bound to a die being removed (its material or its mesh). */
    releaseDie(die) {
      for (let i = running.length - 1; i >= 0; i--) {
        if (running[i].bound && running[i].die === die) stopAt(i);
      }
    },

    clear() {
      for (let i = running.length - 1; i >= 0; i--) stopAt(i);
      cost = 0;
      impactFx?.clear();
      trailFx?.clear();
      stopShake();
      pool?.clear?.();
    },

    dispose() {
      this.clear();
      disposePool();
      disposed = true;
      library = flareRolls = null;
      try {
        player?.dispose();
      } catch {
        // its videos go with the page
      }
      player = null;
    },
  };
}
