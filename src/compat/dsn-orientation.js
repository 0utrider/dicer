/**
 * How a DSN-compatible die model's faces sit relative to Dicer's face layout. Pure data.
 * Established by observation only (docs/research/dsn-model-orientation.md): the flat-face
 * normals of the locally installed third-party models, matched to the numbers their renders
 * show. A rotation that put the wrong number up would be a visible lie, so a type stays null
 * unless every observed model of that type maps onto Dicer's layout by one rotation; a null
 * type falls back to Dicer's procedural die.
 * 'value' types have no one rotation, but a rotation per value: the model chunk's
 * dsnModelRotation (compat/dsn-layouts.js) puts the model's face for the die's value on Dicer's
 * (the face read), from Dice So Nice's own layout. A free die (rolling by hand: physics decides
 * its face) follows the face it shows as it tumbles, so it rests on the model's own face.
 */

const H = Math.SQRT1_2;

/** Quaternion [x, y, z, w] taking a model's axes onto Dicer's face layout, per DSN die type. */
export const MODEL_ROTATIONS = Object.freeze({
  // 1 on -Z, 2 on +Z (three numbered coins) -> Dicer's 1 on +Y, 2 on -Y: +90 deg about X.
  d2: Object.freeze([H, 0, 0, H]),
  // Mirror image of Dicer's d4 (an odd permutation): no one rotation, but one per value.
  d4: 'value',
  // 1 -Y, 2 -X, 3 -Z, 4 +Z, 5 +X, 6 +Y (five models) -> Dicer's 1 +X, 2 +Y, 3 +Z.
  d6: Object.freeze([-H, H, 0, 0]),
  // No one rotation (the face layouts differ from Dicer's), but one per value (dsn-layouts.js).
  d8: 'value',
  d10: 'value',
  d12: 'value',
  d20: 'value',
  // The d10 models' layout, faces times ten (00 opposite 90): per value, on the tens die.
  d100: 'value',
});

/**
 * The model rotation for a die spec, or null when the spec's model is not verified for it:
 * its DSN type must be the Dicer type itself (a custom type aliased onto a shape is not), and a
 * d100 model, whose faces carry tens, belongs to the tens die only.
 * @param {{ type?: string, dsnType?: string, variant?: string }} spec
 * @returns {readonly number[] | null}
 */
export function modelRotationFor(spec) {
  const type = spec?.type;
  const dsnType = spec?.dsnType ?? type;
  if (typeof dsnType !== 'string') return null;
  const tens = spec.variant === 'd100tens';
  if (tens !== (dsnType === 'd100')) return null;
  if (!tens && dsnType !== type) return null;
  const rot = Object.hasOwn(MODEL_ROTATIONS, dsnType) ? MODEL_ROTATIONS[dsnType] : null;
  if (rot !== 'value') return rot;
  return spec.ghost || (!spec.free && !Number.isInteger(spec.value)) ? null : rot;
}
