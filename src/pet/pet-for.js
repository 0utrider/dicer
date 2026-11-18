/** Whose pet a roll shows. World-start code: keep it byte-lean. */
export const PET_KINDS = Object.freeze(['none', 'mimic', 'slime', 'dragonling', 'owl', 'frog', 'ghost', 'mushroom', 'eye', 'golem', 'cat']);
const HEX = /^#[0-9a-f]{6}$/i;
const ok = (c) => (HEX.test(String(c)) ? String(c) : null);

/** The user's `dicer.pet` flag, validated: a bad kind or colour falls back to the defaults; natural: its own colours. Never throws. */
export function readPet(user) {
  let f;
  try {
    f = user?.getFlag?.('dicer', 'pet') ?? user?.flags?.dicer?.pet;
  } catch {
    /* unreadable flag: defaults */
  }
  return {
    kind: PET_KINDS.includes(f?.kind) ? f.kind : 'mimic',
    color: ok(f?.color) ?? ok(user?.color) ?? '#c9a227',
    natural: f?.natural === true,
  };
}

/** The PetSpec for a roll, or null: no roller, no view, either switch off, or the kind 'none'. Color null: the kind's natural colours (the pet chunk's). */
export function petFor({ user, view, getSetting }) {
  if (!user || view === 'none' || getSetting('petsAllowed') === false || getSetting('showPets') === false) return null;
  const { kind, color, natural } = readPet(user);
  return kind === 'none' ? null : { userId: user.id, kind, color: natural ? null : color, ghost: view === 'ghost' };
}
