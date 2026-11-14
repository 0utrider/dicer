# Built-in effects rebuilt in JB2A's style — design

## Why

The owner judged Dicer's built-in dice effects "bad and unprofessional". They chose approach C:
- **Project 1 (merged, aea7cbb):** play JB2A animations when a JB2A module is installed.
- **Project 2 (this document):** rebuild the built-in effects in JB2A's style.

The built-in effects are what everyone without JB2A sees. JB2A users also see them for every effect
JB2A has no file for, and for damage themes.

When asked what makes JB2A feel professional, the owner answered "the quality": the whole package,
not one aspect. The captures from project 1 found three concrete faults:

- **Hairline strokes:** lightning, frost and the fumble crack are 1-pixel lines.
- **Flat rings:** celebrate, shockwave and light-burst are flat rings with no glow.
- **Near-invisible particles:** sparkles, embers, smoke and shatter barely show.

Success means the owner looks at each rebuilt effect beside the matching JB2A frame and judges it
at JB2A's level of polish. It does not have to be identical.

## Goals

- Rebuild the ten effects that JB2A maps, in this priority order:
  1. lightning, frost, fumble (with its crack);
  2. shockwave, light-burst, celebrate;
  3. sparkles, embers, smoke, shatter.
- Each rebuilt effect must have:
  - thick, tapered, glowing strokes instead of hairlines;
  - soft light falloff and halos instead of flat fills;
  - smooth, eased motion with anticipation and settle: a JB2A-like timing arc of build, peak and
    fade;
  - enough size and brightness to read at a glance on a normal table view.
- Every effect keeps its current contract:
  - it obeys `ctx.color`, `ctx.intensity` and `ctx.duration`;
  - it keeps its `id`, `cost` and `defaults`;
  - it honours the safe/off gate.
- The owner signs off effect by effect from side-by-side sheets.

## Non-goals

- No change to which effect plays when: rules, damage themes, the JB2A choice and privacy are
  untouched.
- `shake` stays as it is.
- The three die-material effects (glow-pulse, color-shift, number-flare) are not redesigned.
  - They appear on the sheets inside celebrate and fumble.
  - They are only reworked if the owner flags them there.
- No full-screen post-processing such as a bloom pass. It would cost frame time on every frame,
  tint the dice themselves, and fight Foundry's canvas.
- No downloaded or bundled art: no image or video files and no third-party effect packs.

## Anti-goals

- **Copying JB2A.** JB2A's free pack is licensed non-commercial share-alike. We match its quality,
  never its frames: no tracing, no sampling of its colours or textures into our assets.
- **A slower table.** A rebuilt effect must not drop frames where the current one doesn't, on the
  throttled benchmark tier.
- **Rolls blocked or delayed.** Effects never block or delay a roll or its chat card. That rule is
  unchanged.
- **Losing recolouring.** An effect that looks good only in its default colour fails. It must look
  right in any player die colour, including near-white, near-black and saturated colours.

## Approaches

1. **Shaders drawn in code, with textures generated when the chunk loads (picked).**
   - Effects are rebuilt as GPU shaders and soft sprite textures, all drawn by code.
   - Recolouring, intensity and duration keep working.
   - Nothing is added to the download.
   - It is fast to iterate on with the owner.
   - It gets about 85% of the way to hand-painted art.
2. **Pre-rendered flipbook animations made by us, played through the JB2A player.**
   - Closest to hand-painted.
   - Costs:
     - a few MB of assets;
     - recolouring by tint only;
     - a re-render for every tweak;
     - an art pipeline the project doesn't have.
3. **Free CC0 effect packs.** Dropped: too cartoony for the bar, and every asset is a download.

The owner picked approach 1.

## How (decided)

- **Where the code lives:** all work stays inside the lazy `effects` chunk (`src/effects/library/`).
  The world-start bundle must not grow; `tests/unit/build.test.js` already checks this.
- **Generated textures:** a new module (Claude's call: `src/effects/library/textures.js`) draws a
  small set of soft sprite textures once, when the chunk loads, into canvases or DataTextures:
  - a soft round glow;
  - a smoke puff with noise;
  - a spark or glint;
  - a flame tongue;
  - an ice shard.

  They are created lazily on first use, shared by all effects, and disposed with the pool.
- **Particle pool upgrade:**
  - The shared pool (`particles.js`) gains textured shapes beside today's procedural ones, so
    particles become soft-edged sprites.
  - Additive particles get a soft halo, which makes them read as light.
  - Impact effects and damage themes share the pool. They pick up the new look automatically and
    must still pass their tests. The sheets include them so the owner sees the change.
- **Strokes (lightning, frost, crack):** these become screen-facing ribbon or quad geometry with:
  - a width that tapers along the stroke;
  - a bright core;
  - an exponential glow falloff, in the same technique as the `runes.js` bloom.

  `ribbon.js` already exists and is the starting point. Lightning also gets:
  - branching;
  - a flicker of 2–3 re-strikes inside its duration;
  - a floor flash.
- **Rings (shockwave, light-burst, celebrate):** these become gradient bands with:
  - an inner glow;
  - a thin hot leading edge;
  - noise-broken edges, so they aren't perfect circles;
  - fading trails behind the ring.
- **Fake glow:** glow comes from additive halo layers drawn by each effect. It is never a scene-wide
  pass.
- **Colour handling:**
  - Each effect derives a palette (core, mid, edge) from `ctx.color`.
  - A near-white colour gets a warm or cool tint for depth.
  - A near-black colour is drawn as a dark body with a coloured rim, so it never vanishes on a
    dark table.
- **Cost stays put:** each effect keeps its current `cost`. Particle counts stay within today's
  pool capacity (`round(2048 × particleScale)`), so the budget tiers behave the same.
- **Sign-off harness:**
  - A new visual harness renders each rebuilt effect at fixed frames beside the matching JB2A frame,
    into `docs/signoff/builtin-fx/`. It extends `tests/visual/jb2a.mjs` and `dev/jb2a.*`.
  - The JB2A frames come from the owner's local `jb2a-local/`, which stays git-ignored.
  - The harness has two outputs (Claude's call, to respect the licence):
    - committed sheets contain only Dicer's renders and no JB2A pixels;
    - a local side-by-side sheet, Dicer beside JB2A, goes to a git-ignored folder for the owner to
      view.
  - If `jb2a-local/` is missing, the harness still writes the Dicer-only sheets and notes that the
    reference was skipped. It does not fail.
  - **Colour matrix (Claude's call):** each effect is rendered in five colours:
    - its default;
    - near-white `#f4f4f4`;
    - near-black `#141418`;
    - saturated red `#e02020`;
    - saturated blue `#2050ff`.

    Each colour is shown on two backdrops: the dark studio scene and a light, map-like table.
- **Delivery in rounds:** the three priority groups are built in order, and work stops after each
  round for the owner's sign-off. The owner can redirect after each round.
  - Round 1 also lands the shared foundation that every later round needs: the textures module,
    the pool upgrade and the stroke technique.
  - Before showing a round, Claude judges its sheets and revises any effect that is clearly short
    of the bar.
  - After three of Claude's own revision passes on one effect, it goes to the owner as it is, with
    a note.
- **Fumble's parts:** fumble's rebuild includes its fumble-smoke, its crack and its fizzle.
- **Pool side effects:** textured shapes become the pool's new default. Impact effects and damage
  themes changing look is accepted. They appear on the round 1 sheets, and their tests are updated
  where they pin drawing details.
- **Setting (Claude's call):**
  - No new on/off setting. This replaces a look rather than adding a feature.
  - The existing effect settings (the effects gate, Impact effects, Use JB2A animations) still
    turn everything off.
  - The old drawings are deleted, not kept behind a toggle, to avoid maintaining two versions.

## Left to the builder

- Exact shader maths, texture sizes, easing curves and particle counts, within the cost and
  capacity limits above.
- Whether a given effect is a ribbon, an instanced quad set or pool particles.
- How the harness lays out its sheets.

## Testing

- Unit tests stay green. Changed visuals update only the assertions that pin drawing details. The
  contract tests (colour, intensity, duration, stop disposes everything) must still pass for every
  effect.
- A new unit test checks that the generated textures are created once and disposed with the pool.
- The visual harness produces the side-by-side sheets for each round.
- The throttled benchmark (`npm run test:live:bench`):
  - first records a baseline with the current effects, from main before any change;
  - is run again after each round;
  - the bar is no worse frame time at the 95th percentile than that baseline, within 5%.
  - If a round misses the bar, the cheap budget tiers drop halo layers and texture sizes until it
    passes.
- The owner checks live in Foundry with the `previewEffect` loop, JB2A off.
