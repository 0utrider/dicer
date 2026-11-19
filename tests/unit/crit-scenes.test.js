import * as THREE from 'three';
import { borrowDie } from '../../src/effects/library/borrow.js';
import { SCENE_STUBS, LOAD_WAIT_MS, _setSceneImport, loadScenes } from '../../src/effects/library/scene-stubs.js';
import { EFFECTS, withBursts } from '../../src/effects/library/index.js';
import { EFFECT_IDS } from '../../src/effects/effect-ids.js';
import { SCENE_IDS } from '../../src/effects/library/scene-catalog.js';
import { SCENES, CHUNK } from '../../src/scenes/scenes.js';
import { shadowThief, DURATION, REDUCED_DURATION, SPIT_DURATION } from '../../src/scenes/shadow-thief.js';
import { sceneFlight, clearSwallows, unswallow, CATCH, INTRO, MID_ROLL, UNCLAIMED_MS, createTrailFx } from '../../src/effects/library/scene-flight.js';
import { TIERS } from '../../src/render/quality.js';

/** A landed die of a lingering roll in a fake DiceBox, with a blob shadow handle. */
function fixture({ phase = 'lingering' } = {}) {
  const outer = new THREE.Group();
  outer.position.set(1.5, 0.8, -2);
  outer.quaternion.setFromEuler(new THREE.Euler(0.3, 0.6, 0.1));
  const geometry = new THREE.IcosahedronGeometry(0.9);
  geometry.computeBoundingSphere();
  const follow = { position: outer.position, geometry };
  const die = { outer, inner: new THREE.Mesh(), geometry, value: 20, type: 'd20', shadow: { follow, pool: { follow } } };
  const roll = { phase, removed: false, dice: [die], timer: setTimeout(() => {}, 1e6) };
  const box = { _rolls: [roll], _linger: vi.fn(), _renderer: { requestFrame: vi.fn() } };
  return { box, roll, die, follow };
}

afterEach(() => vi.restoreAllMocks());

describe('borrowDie', () => {
  it('pauses the hide timer, lets the die be moved and hidden, and restores every bit exactly', () => {
    const { box, roll, die, follow } = fixture();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const pos = die.outer.position.clone();
    const quat = die.outer.quaternion.clone();
    const b = borrowDie(box, die);
    expect(b.moving).toBe(true);
    expect(clear).toHaveBeenCalledWith(roll.timer);
    expect(roll.scenes).toBe(1);
    expect(die.borrowed).toBe(true);
    b.pose(new THREE.Vector3(0, 3, 0), new THREE.Quaternion());
    b.hide(true);
    expect(die.outer.visible).toBe(false);
    expect(die.shadow.follow).not.toBe(follow); // the blob goes nowhere
    expect(die.shadow.pool.follow).not.toBe(follow);
    expect(die.shadow.follow.position.y).toBeLessThan(-100);
    b.restore();
    expect(die.outer.position.equals(pos)).toBe(true);
    expect(die.outer.quaternion.equals(quat)).toBe(true);
    expect(die.outer.visible).toBe(true);
    expect(die.shadow.follow).toBe(follow);
    expect(die.shadow.pool.follow).toBe(follow);
    expect(die.borrowed).toBe(false);
    expect(roll.scenes).toBe(0);
    expect(box._linger).toHaveBeenCalledWith(roll); // the timer starts again from now
    b.restore(); // idempotent
    b.pose(new THREE.Vector3(9, 9, 9));
    expect(box._linger).toHaveBeenCalledTimes(1);
    expect(die.outer.position.equals(pos)).toBe(true);
  });

  it('a roll that is not lingering, a removed roll, no box or a die already borrowed: nothing moves', () => {
    for (const make of [
      () => ({ ...fixture({ phase: 'fading' }) }),
      () => {
        const f = fixture();
        f.roll.removed = true;
        return f;
      },
      () => ({ ...fixture(), box: null }),
    ]) {
      const { box, die } = make();
      const b = borrowDie(box, die);
      expect(b.moving).toBe(false);
      b.restore();
      expect(die.borrowed).toBeUndefined();
    }
    const { box, die } = fixture();
    borrowDie(box, die);
    expect(borrowDie(box, die).moving).toBe(false);
  });

  it('with two scenes on one roll, the timer waits for the last; a removed roll never lingers again', () => {
    const { box, roll, die } = fixture();
    const other = { ...die, outer: new THREE.Group(), shadow: null, borrowed: undefined };
    roll.dice.push(other);
    const a = borrowDie(box, die);
    const b = borrowDie(box, other);
    a.restore();
    expect(box._linger).not.toHaveBeenCalled();
    roll.removed = true;
    b.restore();
    expect(box._linger).not.toHaveBeenCalled();
  });
});

describe('the scene stand-ins', () => {
  const ctxFor = (box, die, over = {}) => ({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    die,
    position: die.outer.position.clone(),
    color: new THREE.Color('#8a5cff'),
    intensity: 1,
    duration: 4600,
    options: {},
    particles: null,
    tier: TIERS.high,
    isolate: () => null,
    shake: vi.fn(),
    reducedMotion: false,
    setting: () => undefined,
    box,
    ...over,
  });

  it('are library effects with an id in EFFECT_IDS; the automatic crit burst stands aside for them', () => {
    expect(Object.keys(SCENE_STUBS)).toEqual([...SCENE_IDS, 'scene-random']); // one per catalogued scene, and the random one
    expect(EFFECTS['scene-shadow-thief']).toBe(SCENE_STUBS['scene-shadow-thief']);
    expect(EFFECT_IDS.some((id) => id.startsWith('scene-'))).toBe(false); // accepted by prefix, not listed
    expect(SCENE_STUBS['scene-shadow-thief']).toMatchObject({ cost: 2, bindsDie: true });
    const die = { value: 20, type: 'd20', faces: 20, max: 20, appearance: {} };
    const fx = [{ ruleId: 'dicer.nat20', effect: { id: 'scene-shadow-thief' } }];
    expect(withBursts(die, fx, [], () => undefined)).toEqual(fx);
  });

  it('borrow the die, load the scenes chunk once and play it; the die is restored when it ends', async () => {
    const play = vi.fn(() => {
      let n = 0;
      return { update: () => ++n < 3, stop: vi.fn() };
    });
    const load = vi.fn(async () => ({ SCENES: { 'scene-shadow-thief': { play } } }));
    _setSceneImport(load);
    const { box, roll, die } = fixture();
    const h = SCENE_STUBS['scene-shadow-thief'].start(ctxFor(box, die));
    expect(die.borrowed).toBe(true);
    expect(h.update(0)).toBe(true); // waiting for the chunk
    await loadScenes();
    await Promise.resolve();
    expect(play).toHaveBeenCalledTimes(1);
    const sceneCtx = play.mock.calls[0][0];
    expect(sceneCtx.borrow.moving).toBe(true);
    expect(sceneCtx.anchor.equals(die.outer.position)).toBe(true);
    expect(sceneCtx.radius).toBeCloseTo(die.geometry.boundingSphere.radius);
    expect(h.update(16)).toBe(true);
    expect(h.update(32)).toBe(true);
    expect(h.update(48)).toBe(false); // the scene ended: restored, lingering again
    expect(die.borrowed).toBe(false);
    expect(box._linger).toHaveBeenCalledWith(roll);
    // a second scene reuses the loaded chunk
    SCENE_STUBS['scene-shadow-thief'].start(ctxFor(box, die)).stop();
    await loadScenes();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a chunk that never comes (or fails) gives the die back after LOAD_WAIT_MS, warned once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    _setSceneImport(() => new Promise(() => {}));
    const { box, die } = fixture();
    const h = SCENE_STUBS['scene-shadow-thief'].start(ctxFor(box, die));
    expect(h.update(0)).toBe(true);
    expect(h.update(LOAD_WAIT_MS + 1)).toBe(false);
    expect(die.borrowed).toBe(false);
    _setSceneImport(async () => {
      throw new Error('404');
    });
    const f = fixture();
    const h2 = SCENE_STUBS['scene-shadow-thief'].start(ctxFor(f.box, f.die));
    await loadScenes();
    await Promise.resolve();
    expect(h2.update(0)).toBe(false); // nothing to play: restored
    expect(f.die.borrowed).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stop() (the roll cleared) stops the scene and restores the die', async () => {
    const stop = vi.fn();
    _setSceneImport(async () => ({ SCENES: { 'scene-shadow-thief': { play: () => ({ update: () => true, stop }) } } }));
    const { box, die } = fixture();
    const h = SCENE_STUBS['scene-shadow-thief'].start(ctxFor(box, die));
    await loadScenes();
    await Promise.resolve();
    h.update(0);
    h.stop();
    expect(stop).toHaveBeenCalled();
    expect(die.borrowed).toBe(false);
    expect(h.update(16)).toBe(false);
  });
});

describe('the Shadow Thief', () => {
  function sceneCtx({ reduced = false, moving = true } = {}) {
    const { box, die } = fixture();
    const borrow = moving ? borrowDie(box, die) : { moving: false, pose: vi.fn(), hide: vi.fn(), restore() {} };
    const scene = new THREE.Scene();
    return {
      scene,
      die,
      borrow,
      ctx: {
        scene,
        camera: new THREE.PerspectiveCamera(),
        die,
        anchor: die.outer.position.clone(),
        restQuat: die.outer.quaternion.clone(),
        radius: 0.9,
        reduced,
        shake: vi.fn(),
        glint: vi.fn(),
        borrow,
      },
    };
  }

  it('is in the chunk under its id', () => {
    expect(CHUNK).toBe('dicer-scenes-chunk');
    expect(SCENES['scene-shadow-thief']).toBe(shadowThief);
  });

  it('takes the die away (hidden mid-show), sets it back exactly at its rest, glints and cleans up', () => {
    const { scene, die, ctx } = sceneCtx();
    const rest = die.outer.position.clone();
    const restQ = die.outer.quaternion.clone();
    const h = shadowThief.play(ctx);
    expect(scene.children).toHaveLength(1);
    let hiddenAt = null;
    let maxLift = 0;
    for (let t = 0; t <= DURATION + 32; t += 16) {
      const more = h.update(t);
      if (!die.outer.visible && hiddenAt === null) hiddenAt = t;
      maxLift = Math.max(maxLift, die.outer.position.distanceTo(rest));
      if (!more) break;
    }
    expect(hiddenAt).toBeGreaterThanOrEqual(560);
    expect(hiddenAt).toBeLessThan(600);
    expect(maxLift).toBeGreaterThan(0.3); // it really was carried off
    expect(die.outer.visible).toBe(true);
    expect(die.outer.position.distanceTo(rest)).toBeLessThan(1e-6);
    expect(die.outer.quaternion.angleTo(restQ)).toBeLessThan(1e-6);
    expect(ctx.shake).toHaveBeenCalledTimes(1);
    expect(ctx.glint).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0); // everything removed
    expect(h.update(DURATION + 100)).toBe(false);
  });

  it('is deterministic: two plays draw the die at the same place at the same moment', () => {
    const at = (t) => {
      const { die, ctx } = sceneCtx();
      const h = shadowThief.play(ctx);
      for (let s = 0; s <= t; s += 16) h.update(s);
      const p = die.outer.position.clone();
      h.stop();
      return p;
    };
    expect(at(1800).distanceTo(at(1800))).toBeLessThan(1e-9);
  });

  it('reduced (or a die that cannot be borrowed): the die never moves, a glint, done in REDUCED_DURATION', () => {
    for (const opts of [{ reduced: true }, { moving: false }]) {
      const { scene, die, ctx } = sceneCtx(opts);
      const rest = die.outer.position.clone();
      const h = shadowThief.play(ctx);
      let t = 0;
      while (h.update(t) && t < 10000) t += 16;
      expect(t).toBeGreaterThanOrEqual(REDUCED_DURATION - 16);
      expect(t).toBeLessThan(REDUCED_DURATION + 32);
      expect(die.outer.position.equals(rest)).toBe(true);
      expect(die.outer.visible).toBe(true);
      expect(ctx.glint).toHaveBeenCalledTimes(1);
      expect(scene.children).toHaveLength(0);
    }
  });

  it('stop() mid-show removes everything', () => {
    const { scene, ctx } = sceneCtx();
    const h = shadowThief.play(ctx);
    h.update(0);
    h.update(1200);
    h.stop();
    expect(scene.children).toHaveLength(0);
    expect(h.update(1300)).toBe(false);
  });
});

describe('the mid-roll catch', () => {
  const SCENE_FX = [{ ruleId: 'dicer.nat20', effect: { id: 'scene-shadow-thief' } }];
  const deps = { getTier: () => TIERS.high, reducedMotion: () => false };

  /** A die in a scene, flying: fast first, then slowing (die units per s, 16 ms frames). */
  function flying() {
    const f = fixture();
    const scene = new THREE.Scene();
    scene.add(f.die.outer);
    f.die.fx = SCENE_FX;
    return { ...f, scene };
  }
  /** Moves the die at `speed` units/s for one 16 ms frame and runs the hook. */
  const frame = (die, t, speed) => {
    die.outer.position.x += (speed * 16) / 1000;
    sceneFlight([die], t, deps);
  };

  beforeEach(async () => {
    _setSceneImport(async () => ({ SCENES }));
    await loadScenes();
  });
  afterEach(() => clearSwallows());

  it('catches a scene die once it has flown fast and slows down; the die is hidden while physics goes on', () => {
    const { die, scene, follow } = flying();
    let t = 0;
    for (; t < CATCH.minFlight; t += 16) frame(die, t, 20); // fast: not yet
    expect(die.swallow).toBeFalsy();
    frame(die, (t += 16), 2); // slowing: caught
    expect(die.swallow).toBeTruthy();
    expect(scene.children.length).toBe(3); // the die and the catch visual (its following root, its world group)
    expect(die.outer.visible).toBe(true); // the hand still reaching
    for (let i = 0; i < 25; i++) frame(die, (t += 16), 1);
    expect(die.outer.visible).toBe(false); // pulled under
    expect(die.shadow.follow).not.toBe(follow);
    unswallow(die);
    expect(die.outer.visible).toBe(true);
    expect(die.shadow.follow).toBe(follow);
    expect(scene.children.length).toBe(1); // the visual freed
  });

  it('an intro scene starts mid-flight (by time, not speed) and rides the die (never hidden); at landing the scene plays on introduced', async () => {
    let env = null;
    let ctxSeen = null;
    const disposed = vi.fn();
    const intro = (e) => ((env = e), { update: () => true, swallowed: () => false, dispose: disposed });
    const play = (c) => ((ctxSeen = c), { update: () => false, stop() {} });
    _setSceneImport(async () => ({ SCENES: { 'scene-meteor': { intro, play } } }));
    await loadScenes();
    const { die, box, scene } = flying();
    die.fx = [{ effect: { id: 'scene-meteor' } }];
    const pool = { emit() {} };
    const d = { ...deps, getPool: () => pool };
    let t = 0;
    for (; t < INTRO.minFlight; t += 16) {
      die.outer.position.x += 0.32;
      sceneFlight([die], t, d);
    }
    expect(die.swallow).toBeFalsy();
    die.outer.position.x += 0.32; // still at full speed: an intro starts by time, mid-flight
    sceneFlight([die], (t += 16), d);
    expect(die.swallow?.ride).toBe(true);
    expect(env.particles).toBe(pool);
    for (let i = 0; i < 40; i++) sceneFlight([die], (t += 16), d);
    expect(die.outer.visible).toBe(true); // an intro never hides it
    SCENE_STUBS['scene-meteor'].start({ scene, camera: new THREE.PerspectiveCamera(), die, position: die.outer.position.clone(), color: new THREE.Color(), intensity: 1, duration: 3200, options: {}, tier: TIERS.high, isolate: () => null, shake: vi.fn(), reducedMotion: false, setting: () => undefined, box });
    expect(die.swallow).toBeFalsy();
    expect(disposed).toHaveBeenCalled();
    expect(die.outer.visible).toBe(true);
    await loadScenes();
    await Promise.resolve();
    expect(ctxSeen.introduced).toBe(true);
    expect(ctxSeen.swallowed).toBe(false);
  });

  it('in play nothing shows mid-roll (it would give a 1 or a 20 away): the trail hook never catches', () => {
    expect(MID_ROLL).toBe(false);
    const { die, scene } = flying();
    const n = scene.children.length;
    const trails = createTrailFx({ getPool: () => null, getTier: () => TIERS.high, now: () => 0, reducedMotion: () => false, setting: () => undefined, warnOnce: () => {} });
    for (let t = 0; t < 2000; t += 16) {
      die.outer.position.x += t < 1000 ? 0.32 : 0.02;
      trails.flight([die], t);
    }
    expect(die.swallow).toBeFalsy();
    expect(die.outer.visible).toBe(true);
    expect(scene.children.length).toBe(n);
  });

  it('dice without a scene, reduced motion, the low tier or a chunk not yet in: never caught', async () => {
    const plain = flying();
    plain.die.fx = [{ effect: { id: 'celebrate' } }];
    const slow = (die, d) => {
      let t = 0;
      for (; t < CATCH.minFlight; t += 16) {
        die.outer.position.x += 0.32;
        sceneFlight([die], t, d);
      }
      sceneFlight([die], t + 16, d);
    };
    slow(plain.die, deps);
    expect(plain.die.swallow).toBeFalsy();
    const reduced = flying();
    slow(reduced.die, { ...deps, reducedMotion: () => true });
    expect(reduced.die.swallow).toBeFalsy();
    const low = flying();
    slow(low.die, { ...deps, getTier: () => TIERS.low });
    expect(low.die.swallow).toBeFalsy();
    _setSceneImport(() => new Promise(() => {}));
    const early = flying();
    slow(early.die, deps);
    expect(early.die.swallow).toBeFalsy();
  });

  it('a swallowed die nobody claims comes back after UNCLAIMED_MS; clear() brings every one back', () => {
    vi.useFakeTimers();
    try {
      const { die } = flying();
      let t = 0;
      for (; t < CATCH.minFlight; t += 16) frame(die, t, 20);
      frame(die, (t += 16), 2);
      for (let i = 0; i < 25; i++) frame(die, (t += 16), 0);
      expect(die.outer.visible).toBe(false);
      vi.advanceTimersByTime(UNCLAIMED_MS + 1);
      expect(die.swallow).toBeFalsy();
      expect(die.outer.visible).toBe(true);
      const other = flying();
      t = 0;
      for (; t < CATCH.minFlight; t += 16) frame(other.die, t, 20);
      frame(other.die, (t += 16), 2);
      const trails = createTrailFx({ getPool: () => null, getTier: () => TIERS.high, now: () => 0, reducedMotion: () => false, setting: () => undefined, warnOnce: () => {} });
      trails.clear();
      expect(other.die.swallow).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('at landing the stand-in takes the caught die over: it stays hidden and the thief spits it back out', async () => {
    const { box, die, scene } = flying();
    let t = 0;
    for (; t < CATCH.minFlight; t += 16) frame(die, t, 20);
    frame(die, (t += 16), 2);
    for (let i = 0; i < 25; i++) frame(die, (t += 16), 0);
    // it landed: DiceBox fires the effect
    const rest = die.outer.position.clone();
    const h = SCENE_STUBS['scene-shadow-thief'].start({
      scene,
      camera: new THREE.PerspectiveCamera(),
      die,
      position: rest.clone(),
      color: new THREE.Color(),
      intensity: 1,
      duration: 4600,
      options: {},
      tier: TIERS.high,
      isolate: () => null,
      shake: vi.fn(),
      reducedMotion: false,
      setting: () => undefined,
      box,
    });
    expect(die.swallow).toBeFalsy(); // handed over
    expect(die.outer.visible).toBe(false); // still out of sight
    await loadScenes();
    await Promise.resolve();
    let seen = null;
    let now = 0;
    while (h.update(now) && now < 10000) {
      if (die.outer.visible && seen === null) seen = now;
      now += 16;
    }
    expect(seen).toBeGreaterThanOrEqual(480); // spat out at 500 ms
    expect(seen).toBeLessThan(560);
    expect(now).toBeLessThan(SPIT_DURATION + 100);
    expect(die.outer.visible).toBe(true);
    expect(die.outer.position.distanceTo(rest)).toBeLessThan(1e-6);
    expect(die.borrowed).toBe(false);
  });
});
