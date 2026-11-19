// The contract every crit scene is held to (tests/unit/scenes-all.test.js runs it for each scene).
import * as THREE from 'three';
import { borrowDie } from '../../src/effects/library/borrow.js';

/** A landed die of a lingering roll in a fake DiceBox, with a blob shadow handle. */
function fixture(scene) {
  const outer = new THREE.Group();
  outer.position.set(2.5, 0.8, -1.5);
  outer.quaternion.setFromEuler(new THREE.Euler(0.4, 1.1, -0.2));
  scene.add(outer);
  const geometry = new THREE.IcosahedronGeometry(0.9);
  geometry.computeBoundingSphere();
  const follow = { position: outer.position, geometry };
  const die = {
    outer,
    inner: new THREE.Mesh(),
    geometry,
    value: 20,
    type: 'd20',
    shadow: { follow },
  };
  const roll = { phase: 'lingering', removed: false, dice: [die], timer: 0 };
  const box = { _rolls: [roll], _linger: () => {}, _renderer: { requestFrame: () => {} } };
  return { box, die, follow };
}

function ctxFor({ reduced = false, swallowed = false, introduced = false } = {}) {
  const scene = new THREE.Scene();
  const { box, die, follow } = fixture(scene);
  const borrow = borrowDie(box, die);
  if (swallowed) borrow.hide(true);
  const ctx = {
    scene,
    camera: new THREE.PerspectiveCamera(),
    die,
    anchor: die.outer.position.clone(),
    restQuat: die.outer.quaternion.clone(),
    radius: 0.9,
    color: new THREE.Color('#8a5cff'),
    intensity: 1,
    reduced,
    swallowed,
    introduced,
    tier: { effectBudget: 6 },
    shake: vi.fn(),
    glint: vi.fn(),
    borrow,
  };
  return {
    ctx,
    scene,
    die,
    follow,
    borrow,
    rest: die.outer.position.clone(),
    restQ: die.outer.quaternion.clone(),
  };
}

/** Plays the handle at 16 ms frames until it ends (or `limit` ms); returns the end time. */
function playOut(h, limit, onFrame) {
  let t = 0;
  while (t <= limit) {
    if (!h.update(t)) return t;
    onFrame?.(t);
    t += 16;
  }
  return Infinity;
}

export function checkScene(scene) {
  describe(scene.id, () => {
    it('plays in full and ends with the die exactly home, shown, and nothing left in the scene', () => {
      const { ctx, scene: three, die, follow, rest, restQ } = ctxFor();
      const before = three.children.length;
      const h = scene.play(ctx);
      let moved = 0;
      const end = playOut(
        h,
        scene.duration + 500,
        () => (moved = Math.max(moved, die.outer.position.distanceTo(rest))),
      );
      expect(end).toBeLessThanOrEqual(scene.duration + 32);
      expect(die.outer.visible).toBe(true);
      expect(die.outer.position.distanceTo(rest)).toBeLessThan(1e-6);
      expect(die.outer.quaternion.angleTo(restQ)).toBeLessThan(1e-5);
      expect(die.shadow.follow).toBe(follow);
      expect(three.children.length).toBe(before);
      expect(h.update(end + 100)).toBe(false);
      expect(Number.isFinite(moved)).toBe(true);
    });

    it('reduced: the die never moves or hides; it ends in about 1.6 s and cleans up', () => {
      const { ctx, scene: three, die, rest } = ctxFor({ reduced: true });
      const before = three.children.length;
      const h = scene.play(ctx);
      const end = playOut(h, 5000, () => {
        expect(die.outer.position.equals(rest)).toBe(true);
        expect(die.outer.visible).toBe(true);
      });
      expect(end).toBeLessThan(2600);
      expect(three.children.length).toBe(before);
    });

    it('is deterministic: two plays draw the die at the same place at the same moments', () => {
      const sample = () => {
        const { ctx, die } = ctxFor();
        const h = scene.play(ctx);
        const out = [];
        for (let t = 0; t <= scene.duration; t += 16) {
          if (!h.update(t)) break;
          if (t % 400 < 16)
            out.push(
              die.outer.position
                .toArray()
                .map((v) => +v.toFixed(6))
                .join(','),
            );
        }
        h.stop();
        return out;
      };
      expect(sample()).toEqual(sample());
    });

    it('stop() mid-play frees everything and leaves the die home', () => {
      const { ctx, scene: three, die, rest } = ctxFor();
      const before = three.children.length;
      const h = scene.play(ctx);
      for (let t = 0; t <= scene.duration / 2; t += 16) h.update(t);
      h.stop();
      expect(three.children.length).toBe(before);
      expect(die.outer.position.distanceTo(rest)).toBeLessThan(1e-6);
      expect(die.outer.visible).toBe(true);
    });

    it('starts mid-roll: a swallow (catch) or an intro (lead-in on the tumbling die), never both', () => {
      expect(typeof scene.swallow === 'function' || typeof scene.intro === 'function').toBe(true);
      expect(typeof scene.swallow === 'function' && typeof scene.intro === 'function').toBe(false);
    });

    if (typeof scene.intro === 'function') {
      it('its intro rides the tumbling die (never hidden, a card waits for the climax); played introduced, it skips ahead and ends home', () => {
        const three = new THREE.Scene();
        const { die } = fixture(three);
        const before = three.children.length;
        const emitted = [];
        const c = scene.intro({ scene: three, die, radius: 0.9, particles: { emit: (spec) => emitted.push(spec) } });
        for (let t = 0; t <= 1500; t += 16) {
          die.outer.position.x += 0.02;
          expect(c.update(t)).toBe(true);
          expect(c.swallowed()).toBe(false);
        }
        expect(die.outer.visible).toBe(true);
        expect(three.children.length).toBeGreaterThan(before); // it draws something
        c.dispose();
        expect(three.children.length).toBe(before);
        const { ctx, die: d2, rest, scene: t2 } = ctxFor({ introduced: true });
        const n = t2.children.length;
        const h = scene.play(ctx);
        const end = playOut(h, scene.duration + 500);
        expect(end).toBeLessThan(scene.duration); // its lead-in was skipped
        expect(d2.outer.visible).toBe(true);
        expect(d2.outer.position.distanceTo(rest)).toBeLessThan(1e-6);
        expect(t2.children.length).toBe(n);
      });
    }

    if (typeof scene.swallow === 'function') {
      it('catches mid-roll (hidden from swallowed() on), then brings the die back home when played swallowed', () => {
        const three = new THREE.Scene();
        const { die } = fixture(three);
        const before = three.children.length;
        const c = scene.swallow({ scene: three, die, radius: 0.9 });
        let caught = null;
        for (let t = 0; t <= 2000; t += 16) {
          die.outer.position.x += 0.02;
          c.update(t);
          if (c.swallowed() && caught === null) caught = t;
        }
        expect(caught).not.toBeNull();
        expect(caught).toBeLessThan(1000);
        c.dispose();
        expect(three.children.length).toBe(before);
        const { ctx, die: d2, rest } = ctxFor({ swallowed: true });
        expect(d2.outer.visible).toBe(false);
        const h = scene.play(ctx);
        let seen = false;
        playOut(h, scene.duration + 500, () => (seen ||= d2.outer.visible));
        expect(seen).toBe(true);
        expect(d2.outer.visible).toBe(true);
        expect(d2.outer.position.distanceTo(rest)).toBeLessThan(1e-6);
      });
    }
  });
}
