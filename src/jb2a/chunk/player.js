import * as THREE from 'three';
import { JB2A_EFFECTS, customLayer, urlFor } from './catalogue.js';

/** A layer that has not fired `canplay` within this many ms counts as failed. */
export const CANPLAY_MS = 1500;
/** Pooled video elements per file (concurrent plays of one file). */
export const MAX_PER_FILE = 4;
/** Playing video layers (elements) across all effects. */
export const MAX_PLAYING = 8;

const TABLE_Y = 0.02;
const OVER_Y = 3;
const TABLE_ORDER = 5;
const OVER_ORDER = 999;

const costOf = (builtin) => (Number.isFinite(builtin?.cost) && builtin.cost > 0 ? builtin.cost : 0);
const isAbsolute = (url) => /^([a-z][a-z0-9+.-]*:)?\/\//i.test(url);
const DEAD = Object.freeze({ update: () => false, stop() {} });

/**
 * The JB2A video-plane player. `moduleFor(id, builtin, { safe })` returns an effect module in the
 * library contract ({ id, cost, defaults, start(ctx) -> { update, stop } }) that plays the effect's
 * webm layers on textured planes, or null when it cannot (no mapping or source, a file known to be
 * missing, or no room for its layers). A layer that errors or never gets `canplay` marks its file
 * missing and hands the effect to `builtin.start(ctx)` (not when `safe`), once per play.
 */
export function createJb2aPlayer({
    source,
    createVideo = () => document.createElement('video'),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id)
}) {
    const missing = new Set();
    /** url -> [{ video, busy }] */
    const pool = new Map();
    const active = new Set(); // live play handles, for dispose()
    let playing = 0;
    let disposed = false;

    function makeVideo(url) {
        const video = createVideo();
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        if (isAbsolute(url)) video.crossOrigin = 'anonymous';
        video.src = url;
        return video;
    }

    function acquire(url) {
        let list = pool.get(url);
        if (!list) pool.set(url, (list = []));
        let entry = list.find((e) => !e.busy);
        if (!entry) {
            if (list.length >= MAX_PER_FILE) return null;
            entry = { video: makeVideo(url), busy: false };
            list.push(entry);
        }
        entry.busy = true;
        return entry;
    }

    /** A valid user-chosen file plays alone; otherwise the effect's catalogue layers. */
    function layersOf(id, file) {
        const custom = file ? customLayer(file, source()) : null;
        return custom ? [custom] : (JB2A_EFFECTS[id] ?? null);
    }

    function start(id, builtin, safe, ctx, file) {
        const layers = layersOf(id, file);
        const src = source();
        let fallback = null;
        let finished = false;
        const live = []; // { entry, mesh, texture, timer, detach }

        const handle = {
            update(nowMs) {
                if (fallback) return fallback.update(nowMs);
                return !finished && live.length > 0;
            },
            stop() {
                finished = true;
                for (const l of [...live]) release(l);
                if (fallback) fallback.stop();
                active.delete(handle);
            }
        };

        function release(l) {
            const i = live.indexOf(l);
            if (i < 0) return;
            live.splice(i, 1);
            l.detach();
            if (l.timer != null) clearTimer(l.timer);
            try {
                l.entry.video.pause();
            } catch {
                /* a media element that cannot pause is already gone */
            }
            try {
                l.entry.video.currentTime = 0;
            } catch {
                /* not seekable yet */
            }
            ctx.scene.remove(l.mesh);
            l.texture.dispose();
            l.mesh.material.dispose();
            l.mesh.geometry.dispose();
            l.entry.busy = false;
            playing--;
        }

        function fail(url) {
            if (finished || fallback) return;
            if (url) missing.add(url);
            finished = true;
            for (const l of [...live]) release(l);
            if (!safe && builtin) fallback = builtin.start(ctx);
            if (!fallback) active.delete(handle);
        }

        if (!layers || !src || disposed || playing + layers.length > MAX_PLAYING) {
            fail(null);
            return fallback ?? DEAD;
        }
        const urls = layers.map((layer) => urlFor(src, layer, ctx.color));
        if (urls.some((u) => missing.has(u))) {
            fail(null);
            return fallback ?? DEAD;
        }

        active.add(handle);
        const scale = ctx.intensity ?? 1;
        const p = ctx.position;
        layers.forEach((layer, i) => {
            if (finished) return;
            const url = urls[i];
            const entry = acquire(url);
            if (!entry) return fail(null); // per-file pool exhausted: busy, not missing
            const { video } = entry;
            if (video.error != null) {
                entry.busy = false; // errored during preload
                return fail(url);
            }
            const over = layer.place === 'over';
            const texture = new THREE.VideoTexture(video);
            texture.colorSpace = THREE.SRGBColorSpace;
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthTest: !over,
                depthWrite: false,
                toneMapped: false
            });
            const size = layer.size * scale;
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
            mesh.renderOrder = over ? OVER_ORDER : TABLE_ORDER;
            if (over) {
                mesh.position.set(p.x, OVER_Y, p.z + (layer.offsetZ ?? 0));
                if (ctx.camera?.quaternion) mesh.quaternion.copy(ctx.camera.quaternion);
            } else {
                mesh.position.set(p.x, TABLE_Y, p.z + (layer.offsetZ ?? 0));
                mesh.rotation.x = -Math.PI / 2;
            }
            ctx.scene.add(mesh);

            const l = { entry, mesh, texture, timer: null, detach: () => {} };
            const onCanPlay = () => {
                if (l.timer != null) clearTimer(l.timer);
                l.timer = null;
            };
            const onEnded = () => release(l);
            const onError = () => fail(url);
            video.addEventListener('canplay', onCanPlay);
            video.addEventListener('ended', onEnded);
            video.addEventListener('error', onError);
            l.detach = () => {
                video.removeEventListener('canplay', onCanPlay);
                video.removeEventListener('ended', onEnded);
                video.removeEventListener('error', onError);
            };
            live.push(l);
            playing++;

            try {
                video.currentTime = 0;
            } catch {
                /* not seekable yet */
            }
            if (video.readyState >= 3) onCanPlay();
            else l.timer = setTimer(() => fail(url), CANPLAY_MS);
            try {
                Promise.resolve(video.play()).catch(() => fail(null)); // e.g. autoplay policy: not a missing file
            } catch {
                fail(null);
            }
        });
        return fallback ?? handle;
    }

    return {
        missing,
        get playing() {
            return playing;
        },
        moduleFor(id, builtin, { safe = false, file = null } = {}) {
            const layers = layersOf(id, file);
            const src = source();
            if (!layers || !src || disposed) return null;
            if (playing + layers.length > MAX_PLAYING) return null;
            if (layers.some((layer) => missing.has(urlFor(src, layer)))) return null;
            return {
                id,
                cost: costOf(builtin),
                defaults: builtin?.defaults,
                bindsDie: true,
                start: (ctx) => start(id, builtin ?? null, safe, ctx, file)
            };
        },
        preload(ids = Object.keys(JB2A_EFFECTS)) {
            const src = source();
            if (!src || disposed) return;
            for (const id of ids) {
                for (const layer of layersOf(id) ?? []) {
                    const url = urlFor(src, layer);
                    if (pool.has(url)) continue;
                    pool.set(url, [{ video: makeVideo(url), busy: false }]);
                }
            }
        },
        dispose() {
            for (const h of [...active]) h.stop();
            disposed = true;
            pool.clear();
        }
    };
}
