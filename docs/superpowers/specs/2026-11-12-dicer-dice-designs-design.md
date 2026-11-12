# Dicer: more dice designs (shapes, bodies, insides, numbers)

**Date:** 2026-11-12. **Status:** draft for the owner's review.
**Research:** `docs/research/2026-11-12-dice-designs.md` (market survey, references, cost per idea).
**Parent spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md` (G2 performance, G3 looks, G4 customization).

## Intent

The owner wants Dicer to offer many more dice designs than it does today, matching what real
premium dice look like. From the research shortlist the owner picked all 16 items below (four per
layer). Each new option must be usable everywhere looks are used today: the appearance editor
(with its live preview and the new Throw button), themes, per-type looks, damage themes and the
look API.

## What exists today

- Shapes: d2 (coin), d4, d6, d8, d10, d12, d20; d100 = two d10s; 5 edge-rounding steps.
- Bodies: opaque, resin, metal (polished / brushed / antique), marble, pearl.
- Insides (resin only): none, liquid, glitter, swirl, nebula, floating shape (star, heart, skull, sphere).
- Numbers: engraved; fill paint / gold / silver / enamel; fonts serif, sans, user CSS or file fonts; depth.

## The 16 additions (owner-chosen)

### Numbers and markings (plan 1)
1. **Crit and fumble icons.** An option to show an icon instead of the number on the die's max
   face (crit) and on its 1 (fumble). A small built-in icon set (for example star burst, crown,
   skull, broken shield), each a monochrome glyph rendered like a number (same fill, depth, relief).
   Off by default.
2. **Font bundle.** Six more built-in fonts covering blackletter, a rune-like Norse style, an
   elvish/uncial style, sci-fi, handwritten and Art Deco. Only fonts under the SIL Open Font
   Licence (or equally free) ship; the font files are downloaded only after the owner approves the
   exact list (name, source, licence, size). They join `FONT_IDS_BUILTIN` and the font picker.
3. **Raised and glow-ink numbers.** A relief choice: engraved (today) or raised (embossed: the
   same depth effect, sign flipped). A **glow** fill: the number emits its colour, visible in dark
   scenes, independent of the body glow.
4. **Outlined and holographic foil fills.** An **outline** fill (only a thin rim of the glyph is
   filled, the inside shows the body) and a **holo foil** fill (a rainbow shift with view angle,
   like holographic foil).

### Bodies and materials (plan 2)
5. **Iridescent / opal.** A body whose colour shifts with viewing angle between `color` and
   `color2` around the hue wheel; presets for chameleon resin, opal (milky with colour flashes) and
   dichroic glass.
6. **Gemstones.** Procedural stone looks with bands and veins: at least amethyst, malachite,
   obsidian and quartz, chosen by a gem preset; colours adjustable.
7. **Wood.** Procedural grain: at least oak, walnut, cherry and ebony presets; colours adjustable.
8. **Patina / battle-worn metal and glow-in-the-dark.** Two more metal finishes (copper patina:
   green-blue oxidation in recesses; battle-worn: scratches and worn edges), and a **luminous**
   body option: the body glows faintly in its colour, strongest where the scene is dark.

### Insides (plan 3; resin only, like today)
9. **Foil flakes.** Metal foil flakes suspended in the resin that flash as the die turns.
10. **Floating eye.** An eye inclusion that stays upright (gravity-aligned) while the die tumbles;
    iris colour adjustable.
11. **Flowers, moss, butterfly.** Real-object inclusions drawn as small textured cards inside the
    resin (procedural or a tiny shipped texture set), choose flower, moss or butterfly.
12. **Smoke, bubble and sand.** A smoke/ink plume interior; and two options on the liquid
    interior: an air bubble that floats to the top, and sand that settles to the bottom.

### Shapes (plan 4)
13. **Fate dice and d3 / d5.** Fate/Fudge dice (faces +, +, blank, blank, -, -) on the d6 shape;
    d3 on the d6 shape (1-3 twice); d5 on the d10 shape (1-5 twice). Relabelled existing dice:
    no new geometry or physics. Foundry terms `dF`, `d3`, `d5` animate as these.
14. **Crystal / shard d4.** The long pointed crystal d4 (a 4-sided form that lands on a long face),
    as an alternative d4 shape chosen in the look. Needs a new hull, new geometry and a face-reading
    rule; must be fair (symmetric faces).
15. **d14 and d16** (and **d7** as d14 relabelled 1-7 twice). Heptagonal and octagonal
    trapezohedrons built the way the d10 is; fair by symmetry. Foundry terms `d7`, `d14`, `d16`
    animate as these (today they fall back).
16. **Pipped d6 and coin motifs.** A pips option for the d6 (dots instead of numbers), and coin
    faces with motifs (for example heads/tails, sun/moon) instead of 1/2.

## Constraints

- **Performance (G2):** each option costs only when used. A new body, inside or fill becomes a
  shader variant compiled only for looks that use it; the default dice and every existing look
  render exactly as before. New looks degrade on lower quality tiers the way existing ones do
  (interiors fall back to their cheap version on low).
- **World-start size:** the world-start bundle is within about 0.2 KB of its 2 KB growth allowance.
  **Designer's call:** the shader code for the new bodies, insides and fills ships in a lazily
  loaded chunk, imported the first time a look needs it (like the effects library); a die whose
  chunk is not loaded yet draws with its fallback look for that roll. Only the small option lists
  and normalisation live in world-start code.
- **Appearance model:** every addition is a normalised field of the plain-data Appearance
  (`src/look/appearance.js`), with defaults that keep old saved looks and themes identical, and is
  part of `appearanceKey`. Unknown values fall back, as today.
- **Fairness:** a new physical shape must read the up face reliably and be fair; add the same kind
  of fairness tests the existing shapes have.
- **Licences:** fonts, textures or icons that ship must be free to redistribute (SIL OFL, CC0 or
  own work); every downloaded file is approved by the owner first.
- **DSN compatibility:** Dice So Nice presets, colorsets and terms keep working; new Foundry terms
  (`dF`, `d3`, `d5`, `d7`, `d14`, `d16`) only change from "falls back" to "animates".
- **UI:** each new option appears in the appearance editor in its layer, with labels in `lang/en.json`.

## Non-goals

- Real refraction or ray-traced gems (gems are procedural surface and volume colour, as resin is).
- A d30, d24 or zocchihedron d100 (not chosen).
- User-authored inclusion images or icon uploads (built-in sets only for now).
- Changing the dice physics engine beyond adding the new hulls.

## Order and plans

Four plans, each shippable alone, in this order: **numbers, bodies, insides, shapes** (cheapest
and most visible first; shapes carry the physics risk last). Each plan ends with the owner looking
at the new options through the appearance editor's live preview and Throw button.

## Left to the builder

Exact shader techniques and parameter ranges; the icon set's exact glyphs; preset colours; how
inclusion cards are textured (procedural vs a tiny shipped atlas); the crystal d4's exact
proportions within "long pointed, symmetric, lands on a long face"; UI layout inside each layer.
