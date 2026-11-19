import { version as BUILT } from '../../package.json';

/**
 * A browser may keep running an old dist/dicer.js after an update (Foundry puts no version in a
 * module script's URL, and some browsers and proxies cache it hard): that old code then asks for
 * chunk files the update replaced, and windows such as Roll stats fail to open. When the code
 * running is not the version Foundry serves, or a Dicer chunk fails to load, Dicer's own files are
 * fetched past the cache and the page reloads, once per served version; if that did not help, the
 * player is asked to hard-reload. World-start code: keep it byte-lean.
 */
const KEY = 'dicer.staleReload';
const FILES = ['dist/dicer.js', 'styles/dicer.css'];
const CHUNK_FAILED = /dynamically imported module/i; // Chrome's and Firefox's wording

let busy = false;

async function refresh({ served, route, storage, fetch, reload, notify }, why) {
  if (busy) return;
  busy = true;
  console.warn(`dicer: stale copy, ${why}`);
  // a reload in the last minute that did not help: ask instead of looping; a later stale copy
  // (the files fixed since) may try again. Storage blocked: never reload, just ask.
  let tried = true;
  try {
    const s = storage();
    const [v, t] = String(s.getItem(KEY)).split('|');
    tried = v === served && Date.now() - t < 6e4;
    if (!tried) s.setItem(KEY, `${served}|${Date.now()}`);
  } catch {
    /* blocked */
  }
  if (tried) return notify();
  await Promise.all(FILES.map((f) => fetch(route(`modules/dicer/${f}`), { cache: 'reload' }).catch(() => {})));
  reload();
}

/**
 * Starts the check (init). `deps`: served (the version Foundry reports), route (getRoute), storage
 * (() => sessionStorage), fetch, reload, notify, win (for unhandledrejection).
 * Stale only when Foundry serves a newer version than the code running: Foundry
 * reads module.json at world launch, so files changed on disk since (a git pull, a manual copy)
 * run newer code than it reports, and that is no stale copy.
 * @returns {boolean} true when the running code is already known to be stale
 */
export function watchStaleCopy(deps) {
  deps.win.addEventListener('unhandledrejection', (e) => {
    const m = String(e.reason?.message);
    if (CHUNK_FAILED.test(m) && m.includes('/modules/dicer/')) refresh(deps, m);
  });
  const stale = foundry.utils.isNewerVersion(deps.served, BUILT);
  if (stale) refresh(deps, `${BUILT} < ${deps.served}`);
  return stale;
}

/** Tests: forget a refresh in progress. */
export const resetStaleCopy = () => {
  busy = false;
};
