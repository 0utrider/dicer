/**
 * Merges patches: defines/uniforms/params assigned, chunk slots joined by '\n', replace
 * concatenated; the last labels/atlas/interior win.
 * Its own module so look-extras.js and bodies/index.js share it without an import cycle.
 */
export function mergePatches(...patches) {
  const out = { defines: {}, uniforms: {}, chunks: {}, replace: [] };
  for (const p of patches) {
    Object.assign(out.defines, p.defines);
    Object.assign(out.uniforms, p.uniforms);
    for (const [k, code] of Object.entries(p.chunks ?? {})) {
      out.chunks[k] = k in out.chunks ? `${out.chunks[k]}\n${code}` : code;
    }
    out.replace.push(...(p.replace ?? []));
    if (p.labels) out.labels = p.labels;
    if (p.atlas) out.atlas = p.atlas;
    if (p.interior) out.interior = p.interior;
    if (p.params) out.params = { ...out.params, ...p.params };
  }
  return out;
}
