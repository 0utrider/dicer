// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createJb2aPlayer, placeText, CANPLAY_MS, MAX_PLAYING } from '../../src/jb2a/jb2a.js';

class FakeVideo extends EventTarget {
    constructor() {
        super();
        this.src = '';
        this.error = null;
        this.preload = '';
        this.muted = false;
        this.playsInline = false;
        this.currentTime = 0;
        this.paused = true;
        this.pause = vi.fn(() => {
            this.paused = true;
        });
        this.play = vi.fn(() => {
            this.paused = false;
            return Promise.resolve();
        });
    }
    fire(type) {
        this.dispatchEvent(new Event(type));
    }
}

const SRC = { moduleId: 'jb2a_patreon', location: 'modules' };

function setup() {
    const videos = [];
    const player = createJb2aPlayer({
        source: () => SRC,
        createVideo: () => {
            const v = new FakeVideo();
            videos.push(v);
            return v;
        }
    });
    const scene = new THREE.Scene();
    const ctx = (over = {}) => ({
        scene,
        camera: new THREE.PerspectiveCamera(),
        position: new THREE.Vector3(2, 0, -1),
        color: new THREE.Color('#ffffff'),
        intensity: 1,
        ...over
    });
    const builtin = () => ({
        cost: 3,
        defaults: { color: '#fff', intensity: 1, duration: 1 },
        handle: { update: vi.fn(() => true), stop: vi.fn() },
        start: vi.fn(function () {
            return this.handle;
        })
    });
    return { player, videos, scene, ctx, builtin };
}

describe('jb2a player', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('every video loads with CORS, a relative path too (a hosted server may redirect it to a CDN)', () => {
        const { player, videos, ctx, builtin } = setup();
        player.moduleFor('frost', builtin()).start(ctx());
        expect(videos.length).toBeGreaterThan(0);
        expect(videos[0].src).not.toMatch(/^([a-z]+:)?\/\//i); // a relative Foundry path
        for (const v of videos) expect(v.crossOrigin).toBe('anonymous');
    });

    it('moduleFor mirrors builtin cost, and is null without mapping or source', () => {
        const { player, builtin } = setup();
        const b = builtin();
        const m = player.moduleFor('frost', b);
        expect(m.id).toBe('frost');
        expect(m.cost).toBe(b.cost);
        expect(player.moduleFor('glow-pulse', b)).toBeNull();
        const none = createJb2aPlayer({ source: () => null });
        expect(none.moduleFor('frost', b)).toBeNull();
    });

    it('a chosen file plays alone, for any effect id; an invalid one falls back to the catalogue', () => {
        const { player, videos, scene, ctx, builtin } = setup();
        const file = 'modules/jb2a_patreon/Library/Generic/Explosion/Explosion_02_Blue_400x400.webm';
        const m = player.moduleFor('glow-pulse', builtin(), { file });
        expect(m).not.toBeNull();
        m.start(ctx());
        expect(videos.at(-1).src).toBe(file);
        expect(scene.children).toHaveLength(1);
        expect(scene.children[0].position.y).toBe(3); // over the die
        player.moduleFor('frost', builtin(), { file: 'https://evil.example/x.webm' }).start(ctx());
        expect(videos.at(-1).src).toContain('/Library/Generic/Impact/FrostImpact_01');
        expect(player.moduleFor('glow-pulse', builtin(), { file: 'a/../b.webm' })).toBeNull();
    });

    it('places table and over layers', () => {
        const { player, scene, ctx, builtin } = setup();
        player.moduleFor('frost', builtin()).start(ctx());
        const frost = scene.children[0];
        expect(frost.position.toArray()).toEqual([2, 0.02, -1]);
        expect(frost.geometry.parameters.width).toBe(6);
        expect(frost.geometry.parameters.height).toBe(6);
        expect(frost.material.depthTest).toBe(true);
        expect(frost.renderOrder).toBe(5);

        player.moduleFor('celebrate', builtin()).start(ctx());
        const banner = scene.children[scene.children.length - 1];
        expect(banner.position.y).toBe(3);
        expect(banner.position.z).toBe(-3);
        expect(banner.material.depthTest).toBe(false);
        expect(banner.renderOrder).toBe(999);
    });

    it('scales the plane by intensity', () => {
        const { player, scene, ctx, builtin } = setup();
        player.moduleFor('frost', builtin()).start(ctx({ intensity: 1.5 }));
        expect(scene.children[0].geometry.parameters.width).toBe(9);
    });

    it('update is true until every layer ends', () => {
        const { player, videos, ctx, builtin } = setup();
        const h = player.moduleFor('fumble', builtin()).start(ctx());
        expect(videos).toHaveLength(2);
        expect(h.update(0)).toBe(true);
        videos[0].fire('ended');
        expect(h.update(0)).toBe(true);
        videos[1].fire('ended');
        expect(h.update(0)).toBe(false);
    });

    it('falls back on error, once, and marks the url missing', () => {
        const { player, videos, ctx, builtin } = setup();
        const b = builtin();
        const c = ctx();
        const h = player.moduleFor('frost', b).start(c);
        videos[0].fire('error');
        videos[0].fire('error');
        expect(b.start).toHaveBeenCalledTimes(1);
        expect(b.start).toHaveBeenCalledWith(c);
        expect(player.missing.size).toBe(1);
        b.handle.update.mockReturnValueOnce(false);
        expect(h.update(5)).toBe(false);
        expect(b.handle.update).toHaveBeenCalledWith(5);
        expect(player.moduleFor('frost', b)).toBeNull();
    });

    it('moduleFor modules bind the die, so releaseDie can stop them', () => {
        const { player, builtin } = setup();
        expect(player.moduleFor('frost', builtin()).bindsDie).toBe(true);
    });

    it('an element that already errored during preload is marked missing and falls back', () => {
        const { player, videos, scene, ctx, builtin } = setup();
        player.preload(['frost']);
        videos[0].error = { code: 4 };
        const b = builtin();
        player.moduleFor('frost', b).start(ctx());
        expect(b.start).toHaveBeenCalledTimes(1);
        expect(player.missing.size).toBe(1);
        expect(scene.children).toHaveLength(0);
        expect(player.moduleFor('frost', b)).toBeNull();
    });

    it('falls back when canplay does not arrive in time', () => {
        const { player, videos, scene, ctx, builtin } = setup();
        const b = builtin();
        player.moduleFor('frost', b).start(ctx());
        vi.advanceTimersByTime(CANPLAY_MS - 1);
        expect(b.start).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(b.start).toHaveBeenCalledTimes(1);
        expect(scene.children).toHaveLength(0);
        expect(videos[0].pause).toHaveBeenCalled();
    });

    it('canplay cancels the timeout', () => {
        const { player, videos, ctx, builtin } = setup();
        const b = builtin();
        player.moduleFor('frost', b).start(ctx());
        videos[0].fire('canplay');
        vi.advanceTimersByTime(CANPLAY_MS * 2);
        expect(b.start).not.toHaveBeenCalled();
    });

    it('safe mode never calls the builtin', () => {
        const { player, videos, ctx, builtin } = setup();
        const b = builtin();
        const h = player.moduleFor('frost', b, { safe: true }).start(ctx());
        videos[0].fire('error');
        expect(b.start).not.toHaveBeenCalled();
        expect(h.update(0)).toBe(false);
    });

    it('never exceeds MAX_PLAYING layers, and recovers after ended', () => {
        const { player, videos, ctx, builtin } = setup();
        const b = builtin();
        const m = player.moduleFor('celebrate', b);
        for (let i = 0; i < 10; i++) m.start(ctx());
        expect(player.playing).toBeLessThanOrEqual(MAX_PLAYING);
        expect(b.start).toHaveBeenCalled();

        const fresh = setup();
        const m2 = fresh.player.moduleFor('celebrate', fresh.builtin());
        m2.start(fresh.ctx());
        m2.start(fresh.ctx());
        expect(fresh.player.playing).toBe(6);
        fresh.player.moduleFor('frost', fresh.builtin()).start(fresh.ctx());
        fresh.player.moduleFor('frost', fresh.builtin()).start(fresh.ctx());
        expect(fresh.player.playing).toBe(MAX_PLAYING);
        expect(fresh.player.moduleFor('frost', fresh.builtin())).toBeNull();
        fresh.videos.find((v) => v.src.includes('FrostImpact')).fire('ended');
        expect(fresh.player.playing).toBe(MAX_PLAYING - 1);
        expect(fresh.player.moduleFor('frost', fresh.builtin())).not.toBeNull();
    });

    it('per-file pool exhaustion falls back without marking the file missing', () => {
        const { player, ctx, builtin } = setup();
        const b = builtin();
        const m = player.moduleFor('frost', b);
        for (let i = 0; i < 4; i++) m.start(ctx());
        expect(b.start).not.toHaveBeenCalled();
        m.start(ctx());
        expect(b.start).toHaveBeenCalledTimes(1);
        expect(player.missing.size).toBe(0);
        expect(player.moduleFor('frost', b)).not.toBeNull();
    });

    it('a play() rejection falls back without marking the file missing', async () => {
        const s = setup();
        const b = s.builtin();
        const player = createJb2aPlayer({
            source: () => SRC,
            createVideo: () => {
                const v = new FakeVideo();
                v.play = vi.fn(() => Promise.reject(new Error('blocked')));
                return v;
            }
        });
        player.moduleFor('frost', b).start(s.ctx());
        await Promise.resolve();
        await Promise.resolve();
        expect(b.start).toHaveBeenCalledTimes(1);
        expect(player.missing.size).toBe(0);
    });

    it('stop releases videos, meshes and gpu resources', () => {
        const { player, videos, scene, ctx, builtin } = setup();
        const h = player.moduleFor('celebrate', builtin()).start(ctx());
        const meshes = [...scene.children];
        const spies = meshes.flatMap((m) => [
            vi.spyOn(m.material.map, 'dispose'),
            vi.spyOn(m.material, 'dispose'),
            vi.spyOn(m.geometry, 'dispose')
        ]);
        h.stop();
        videos.forEach((v) => expect(v.pause).toHaveBeenCalled());
        expect(scene.children).toHaveLength(0);
        spies.forEach((s) => expect(s).toHaveBeenCalled());
        expect(player.playing).toBe(0);
    });

    it('preload makes one preloading element per file', () => {
        const { player, videos } = setup();
        player.preload(['frost']);
        expect(videos).toHaveLength(1);
        expect(videos[0].preload).toBe('auto');
        expect(videos[0].src).toContain('FrostImpact_01_Regular_Blue_600x600.webm');
    });
});

describe('placeText (crit / fumble text layers)', () => {
    const cam = (halfWidth, halfDepth) => {
        const c = new THREE.PerspectiveCamera(20, halfWidth / halfDepth);
        c.position.set(0, halfDepth / Math.tan((10 * Math.PI) / 180), 0);
        return c;
    };

    it('keeps the same screen size whatever diceScale is', () => {
        const at1 = placeText({ size: 4.5, x: 0, z: 0, y: 3, camera: cam(20, 11), diceScale: 1 });
        const at2 = placeText({ size: 4.5, x: 0, z: 0, y: 3, camera: cam(10, 5.5), diceScale: 2 });
        // screen fraction = size / visible depth at the plane
        const frac = (r, c) => r.size / (2 * (c.position.y - 3) * Math.tan((10 * Math.PI) / 180));
        expect(frac(at2, cam(10, 5.5))).toBeCloseTo(frac(at1, cam(20, 11)), 6);
        expect(at2.size).toBeLessThan(at1.size);
    });

    it('moves a text plane near an edge back inside the view', () => {
        const c = cam(20, 11);
        const r = placeText({ size: 4.5, x: 19.5, z: -10.8, y: 3, camera: c, diceScale: 1 });
        const halfD = (c.position.y - 3) * Math.tan((10 * Math.PI) / 180);
        const halfW = halfD * c.aspect;
        expect(r.x + r.size / 2).toBeLessThanOrEqual(halfW + 1e-9);
        expect(r.z - r.size / 2).toBeGreaterThanOrEqual(-halfD - 1e-9);
        const mid = placeText({ size: 4.5, x: 1, z: 2, y: 3, camera: c, diceScale: 1 });
        expect([mid.x, mid.z]).toEqual([1, 2]); // already inside: untouched
    });

    it('centres text larger than the view, and falls back without a camera height', () => {
        const c = cam(2, 1);
        expect(placeText({ size: 40, x: 1.5, z: 0.8, y: 3, camera: c, diceScale: 1 })).toMatchObject({ x: 0, z: 0 });
        expect(placeText({ size: 4, x: 5, z: 6, y: 3, camera: new THREE.PerspectiveCamera(), diceScale: 2 })).toEqual({
            size: 2,
            x: 5,
            z: 6
        });
    });
});
