/**
 * Fonts add-on modules registered (api.registerFont). Read only by lazy chunks (the API and the
 * appearance editor), so none of it is in the world-start bundle.
 */

/** Font id -> { id, moduleId, label, file }, in registration order. */
export const ADDON_FONTS = new Map();

/** The registered fonts grouped by module: [{ moduleId, fonts: [{ id, label, file }] }]. */
export function fontGroups(fonts = ADDON_FONTS.values()) {
  const groups = new Map();
  for (const { id, moduleId, label, file } of fonts) {
    (groups.get(moduleId) ?? groups.set(moduleId, []).get(moduleId)).push({ id, label, file });
  }
  return [...groups].map(([moduleId, list]) => ({ moduleId, fonts: list }));
}
