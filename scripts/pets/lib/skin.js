import { sstep } from './math.js';

/**
 * Skin weights from the field's parts. The usual recipe, per vertex:
 *
 *   const w = weights();                                  // an accumulator
 *   for (const [group, share] of soft([['core', dCore, 0.03], ['tail', dTail, 0.025]]))
 *     if (group === 'core') { w.put('head', share * hv); w.put('body', share * (1 - hv)); }
 *     else chain(w, share, s, ['body', 'tail_1', 'tail_2', 'tail_3'], [s1, s2, s3]);
 *   return w.done(BONE_INDEX);                            // [[boneIndex, weight] x <= 4], sum 1
 *
 * `soft` shares a vertex between the parts it is nearest by their distances (tau = blend width,
 * model units); inside a part, split it between bones by planes or along a chain (sstep blends).
 */

/**
 * Soft-min shares of groups [[name, distance, tau]]: exp(-(d - dmin) / tau), normalised.
 * Shares under `cut` are dropped. Returns [[name, share]].
 */
export function soft(groups, cut = 1e-3) {
  const dmin = Math.min(...groups.map((g) => g[1]));
  let sum = 0;
  const gw = groups.map(([name, d, tau]) => {
    const v = Math.exp(-(d - dmin) / tau);
    sum += v;
    return [name, v];
  });
  return gw.map(([n, v]) => [n, v / sum]).filter(([, v]) => v >= cut);
}

/** A weight accumulator: put(bone, w) adds; done(index) keeps the 4 largest, normalised. */
export function weights() {
  const w = new Map();
  return {
    put(b, v) {
      if (v > 1e-4) w.set(b, (w.get(b) ?? 0) + v);
    },
    done(index) {
      const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = top.reduce((s, e) => s + e[1], 0);
      return top.map(([b, v]) => [index[b], v / tot]);
    },
  };
}

/**
 * Splits `share` along a chain: bones[0] before pivots[0], bones[i] from pivots[i-1] to
 * pivots[i]..., blending over +-blend round each pivot (s = the vertex's arc length).
 */
export function chain(w, share, s, bones, pivots, blend = 0.05) {
  const k = pivots.map((p) => sstep(p - blend, p + blend, s));
  for (let i = 0; i < bones.length; i++) {
    const a = i === 0 ? 1 : k[i - 1];
    const b = i < k.length ? k[i] : 0;
    w.put(bones[i], share * (a - b));
  }
}
