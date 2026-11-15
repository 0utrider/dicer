# Dicer: styled edge strips (design)

## Intent

Players want the seams of a die (the rounded bevel strips between faces, `aFaceId < 0` in
`src/core/chamfer.js`) to stand out from the body: a painted line, a gold/silver inlay, or a
glowing seam. Today the strips are drawn with the body material (resin/pearl only make them a
little rougher). The owner confirmed "the lines between the numbers" means these bevel strips,
not a painted outline inside the face.

## Goals

- A die look carries an edge-strip style, colour and strength, saved with the look.
- It shows in the appearance editor preview and on rolled dice.
- Built-in looks and every existing saved look render exactly as before (default `body`).

## Non-goals

- Strips on sharp dice (radius 0 has no bevel geometry). The controls are disabled there.
- Changing strip width (it follows the existing roundness steps).
- Corner caps, number outlines and the other ideas from the brainstorm: separate features
  (see Backlog).

## Anti-goals

- Any pixel change for a look that does not set a strip style.
- Growing the world-start bundle (`tests/unit/build.test.js` has almost no headroom).

## Approaches

1. **Look-extras patch (picked).** A new `edgePatch` in the lazy look-extras chunk
   (`src/render/extras/edges.js`), merged in `patchMaterial`. Looks with a strip style need the
   chunk; until it lands, and under safe flags, `fallbackLook` drops the style, so the die draws
   today's strips. Near-zero world-start cost.
2. Main body shader behind a define: simpler, but adds world-start bytes and likely breaks the
   size ratchet.
3. Separate material group for bevel triangles: reworks geometry build and caching for every die
   type. Too heavy.

## Look model (`src/look/appearance.js`)

```js
edges: { radius, style, strip: { style: 'body', color: '#e2b04a', strength: 1 } }
```

- `strip.style` in `['body', 'paint', 'metal', 'glow']`, default `body` (unchanged look).
- `strip.color` hex, default `#e2b04a` (same gold as the default number fill).
- `strip.strength` 0..1, default 1: mix of the style over the body.
- `edges.style` (derived `sharp|rounded`) is untouched; `strip` is new.
- Migration: looks without `strip` normalise to the default. Invalid values fall back per field.
- Active when `strip.style !== 'body' && strip.strength > 0 && radius > 0`.
- `needsLookExtras` is true when active; `fallbackLook` resets `strip.style` to `body`.
- `programKey` gains a part `e:<style>` only when active (existing keys unchanged).
- `appearanceKey` changes shape for every look (new default field); keys are in-memory only
  (material cache, thumbnailer, theme-form preset match on normalised looks), so that is safe.

## Rendering (`src/render/extras/edges.js`)

Mask `dcEdge = ( vFaceId < -0.5 ? 1.0 : 0.0 ) * uEdgeStrength`, gated by a define per style
(`DICER_EDGE_PAINT|METAL|GLOW`), colour/strength as uniforms (`uEdgeColor`, `uEdgeStrength`).

- **paint**: `diffuseColor.rgb` mixed to `uEdgeColor`; metalness to 0, roughness to ~0.45.
- **metal**: diffuse mixed to `uEdgeColor`, metalness to 1, roughness ~0.25 (inlay look).
- **glow**: paint, plus `uEdgeColor * dcEdge` added to emissive.
- **resin**: the refraction block replaces the non-number diffuse with the refracted body; the
  patch saves the lit diffuse just before `#include <transmission_fragment>` and mixes it back
  by `dcEdge` after the refraction, so the refraction line itself (which the face-layer decal
  rewrite targets) is untouched.
- Coin rim triangles also carry `aFaceId = -1`, so a d2 rim gets the style too (accepted).

## Editor (`src/ui/appearance-editor.js`, `appearance-form.js`, template, `lang/en.json`)

Under the existing **Edges** section, below roundness: a style picker (Match body / Paint /
Metal / Glow), a colour input and a strength slider. Colour and strength are hidden while the
style is Match body. At radius 0 all three are replaced by a hint ("Edge strips need rounded edges.").
Form round-trips `edges.strip`. Section summary shows the style when it is not Match body.

## Settings

The look default `body` is the off switch: nothing changes unless a player picks a style.
(Owner rule: new features ship their own default; this one's lives on the look.) No extra
world/client setting, since safe mode already falls back to the plain strip.

## Tests

- `appearance` unit tests: defaults, normalisation/migration of missing/invalid `strip`,
  `needsLookExtras`/`fallbackLook`/`programKey` behaviour, built-in looks unchanged.
- Extras unit test: `edgePatch` returns nothing for inactive looks, the right define/uniforms
  per style, and the resin `replace` target exists in the assembled shader.
- Form round-trip test; build ratchet stays green.

## Left to the builder

Exact roughness numbers per style, editor markup details, whether resin bevel coat stays rough.

## Backlog (owner said "add all"; separate features, one at a time)

Corner caps, raised face border for non-metal bodies, number outline/shadow, number size,
6/9 marker style, two-tone/gradient body, alternating face colours, flecks/speckle, wear on
non-metal, resin clarity, per-look die scale, dice-within-dice, hollow/cage dice.
