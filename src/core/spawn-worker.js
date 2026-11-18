/**
 * Starts a module worker from `url` (a `?worker&url` import). Browsers refuse `new Worker()` on a
 * script from another origin, and The Forge serves module files from its asset CDN, not the game's
 * origin. Then the worker starts from a same-origin blob that imports the real script: a module
 * import may cross origins (the CDN allows it, as it does for dicer.js itself), and the script's
 * import.meta.url stays its own, so its relative assets (the physics wasm) still resolve.
 * @param {string} url
 * @param {{location?: {origin: string, href: string}, Worker?: typeof Worker}} [env] test seam
 * @returns {Worker}
 */
export function spawnWorker(url, env = {}) {
  const loc = env.location ?? globalThis.location;
  const W = env.Worker ?? globalThis.Worker;
  const href = new URL(url, import.meta.url).href;
  if (!loc || new URL(href).origin === loc.origin) return new W(href, { type: 'module' });
  const blob = URL.createObjectURL(new Blob([`import ${JSON.stringify(href)};`], { type: 'text/javascript' }));
  const worker = new W(blob, { type: 'module' });
  setTimeout(() => URL.revokeObjectURL(blob), 60000); // long after the worker has fetched it
  return worker;
}
