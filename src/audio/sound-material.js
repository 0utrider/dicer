// Look -> sound material. A DSN material hint (preset.material) wins over the body type.
// Note: colorset-derived appearances do not carry `material` (the colorset mapper folds it
// into body.type), so for those the body type decides; `appearance.material` is still read
// in case a look carries one.

const HINTS = {
  metal: 'metal',
  chrome: 'metal',
  wood: 'wood',
  glass: 'glass',
  pristine: 'glass',
  iridescent: 'glass',
  stone: 'stone',
};

const BODY = { metal: 'metal', marble: 'stone', resin: 'plastic', opaque: 'plastic', pearl: 'glass', wood: 'wood', gem: 'stone', iridescent: 'metal', stone: 'stone', bone: 'wood', jelly: 'squishy' };
// A body style that sounds unlike its type ('type:style', the body's preset): it wins over BODY.
const STYLE = { 'iridescent:dichroic': 'glass', 'bone:fossil': 'stone' };

export function soundMaterialOf(appearance, preset) {
  const hint = preset?.material ?? appearance?.material;
  if (typeof hint === 'string' && hint) return HINTS[hint] ?? 'plastic';
  const body = appearance?.body;
  return STYLE[`${body?.type}:${body?.preset}`] ?? BODY[body?.type] ?? 'plastic';
}
