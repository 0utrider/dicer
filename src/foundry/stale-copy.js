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

async function refresh({ served, route, storage, fetch, reload, notify }) {
  if (busy) return;
  busy = true;
  let tried = true; // storage blocked: never reload in a loop, just ask
  try {
    const s = storage();
    tried = s.getItem(KEY) === served;
    if (!tried) s.setItem(KEY, served);
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
 * @returns {boolean} true when the running code is already known to be stale
 */
export function watchStaleCopy(deps) {
  const fix = () => refresh(deps);
  deps.win.addEventListener('unhandledrejection', (e) => {
    const m = String(e.reason?.message);
    if (CHUNK_FAILED.test(m) && m.includes('/modules/dicer/')) fix();
  });
  const stale = deps.served !== BUILT;
  if (stale) fix();
  return stale;
}

/** Tests: forget a refresh in progress. */
export const resetStaleCopy = () => {
  busy = false;
};
