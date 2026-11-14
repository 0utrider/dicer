/**
 * The active JB2A module (patreon preferred, then free) and its file location: the
 * `jb2aLocation` setting without trailing slashes, or `modules`. Null when neither is active.
 * @returns {{moduleId: string, location: string}|null}
 */
export function jb2aSource({ modules, settings }) {
  const moduleId = ['jb2a_patreon', 'JB2A_DnD5e'].find((id) => modules?.get(id)?.active === true);
  if (!moduleId) return null;
  let location;
  try {
    location = settings.get(moduleId, 'jb2aLocation');
  } catch {
    // not registered: the default
  }
  return { moduleId, location: (typeof location === 'string' && location.replace(/\/+$/, '')) || 'modules' };
}
