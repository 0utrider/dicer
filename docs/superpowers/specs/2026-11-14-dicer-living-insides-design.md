# Living insides — design

## Why

A player wrote: "hoping for some particles inside the dice too, like elemental effects, glitter,
liquid, creatures, whatever." Dicer already has ray-marched resin insides (liquid, glitter,
swirl, nebula, smoke, foil, eye, botanical, runes, weapons, dragon), but they are frozen: nothing
inside moves, there are no elemental insides, and roll effects never reach inside the die. The
owner asked to add what is missing, so insides feel alive and tie into roll effects and Animater.

## Goals

1. **Motion.** Insides move while dice are on screen:
   - liquid's surface lags behind the die's turns, overshoots once and settles (slosh);
   - glitter drifts along a slow swirl that speeds up with the die's spin and calms after landing;
   - smoke, nebula and swirl creep slowly (time-driven drift);
   - foil, eye, botanical, runes, weapons, dragon: a small life touch each where cheap (the eye's
     pupil follows the camera a little, runes pulse, the dragon breathes a faint glow); none
     required to move if it costs real time.
2. **Elemental insides**, four new inside modules with their own animation:
   - `fire`: flames rising from the bottom of the volume, licking upward, hot core to cool tips;
   - `storm`: a dark cloud with short forked sparks that flash and fade at random spots;
   - `frost`: ice spikes growing inward from the walls, a cold haze, a slow glint crawl;
   - `lava`: a slow glowing body under a dark crust that cracks and reseals.
3. **Picked as a look and from the damage type (owner: "C").**
   - The four appear in the appearance editor like any inside, with two colours and density.
   - Damage themes (src/effects/damage-themes.js rows) switch to them: fire → `fire`,
     cold → `frost`, electricity → `storm`. Lava is look-only (no damage type maps to it by
     default; a world map or user override may name it).
   - A die whose body is not resin keeps its normal look; insides only exist in resin.
4. **Roll effects reach inside (flare).** A die gets an inside flare level, 0..1, that brightens
   and agitates its inside (liquid boils, glitter scatters, fire roars, storm strikes, frost
   flashes, others brighten):
   - crit and fumble effects raise it on their die (the round 1 lightning, frost and fumble, and
     the later celebrate/light-burst/shockwave): a quick rise and a decay over the effect's life;
   - a public hook lets Animater (or any module) flare a die of a roll in flight.

## Non-goals

- No real particle simulation and no extra render pass (approach 2, dropped).
- No image textures or flipbooks (the effects rebuild rule: no image assets, no JB2A pixels).
- No new insides beyond the four elementals.
- No change to the low tier: at interiorSteps 0 insides are the body-tint fake; they stay still.

## Anti-goals (failure even if it works)

- Motion that makes the number hard to read at landing; the number fill stays on top as today.
- A frame-time hit while no dice are on screen. Dicer goes idle then; it must stay idle.
- A visible jump when a die switches from flight to rest, or when its look is applied.
- Hidden or blind rolls leaking: the flare follows the same visibility as the effects that cause
  it (an effect that is not shown does not flare).
- World-start growth: the build.test ratchet has almost no headroom left.

## Constraints

- Three.js r184, WebGL2, the existing ray-marched inside pipeline (shaders/interior.js,
  extras/insides/*, INTERIOR_HOOK in shaders/bodies.js, insidePatch in insides/index.js).
- Each module defines `vec4 dcInterior( vec3 p, vec3 rd, float dt )` and uses only
  INTERIOR_PARS, `dcIUp` and its own `dc<Prefix>` names (the existing contract).
- Quality tiers (render/quality.js): march steps 16/32/48. Elemental insides must hold up at 16.
- Speed: the same bar as the effects rebuild — measured per frame with the fx-perf probe; a die
  with an animated inside adds no more than 5% over the same die frozen, or 0.05 ms, whichever is
  larger. GPU cost is not measured offline; the owner's live bench is the check.
- Each feature ships its own on/off setting, default on:
  - `insideMotion` (client): insides move. Off = today's frozen insides.
  - `insideFlare` (client): effects flare insides.
  - `elementalDamageInsides` (world): damage themes use the elemental insides. Off = today's rows.
  - (Elemental insides as pickable looks need no setting; they appear only when chosen.)
- Reduced motion (ctx.reducedMotion / prefers-reduced-motion): motion slows to a quarter and
  flare pulses become a single soft rise; nothing strobes (storm sparks hold instead of flash).
- Shared code stays in lazy chunks; nothing new is imported by world-start code.

## Approaches

1. **Everything in the existing shader (picked).** New inputs per die — time, spin, a lagged up
   vector, flare — feed the ray-marched insides; elementals are four new inside modules. No new
   textures or passes, cheapest, fits the licence rule and the speed bar.
2. **Real particles inside each die**, simulated per frame and drawn behind the resin. Truly
   physical glitter, but several times the GPU cost, clashes with the traced resin (it is not
   layered), and can't do flame or liquid well. Dropped.
3. **Hand-painted animated textures.** Ruled out by the no-image-assets rule.

## Design (decided)

- **Inputs, added to INTERIOR_PARS:**
  - `uInteriorTime` (seconds since the die's roll spawned, per die; see the calls below);
  - `uInteriorSpin` (vec3, the die's angular velocity in its canonical frame, smoothed, so
    glitter swirl and slosh follow real tumbling);
  - `uInteriorLag` (vec3, the lagged up vector in the canonical frame; liquid uses it in place of
    `dcIUp` for its surface, so the surface trails the die and settles);
  - `uInteriorFlare` (float 0..1).
- **Per-die values.** Spin, lag and flare are per die. Dice sharing a look share a material, so
  per-die values need either the existing `DiceBox.isolate(die)` (one isolated material per die,
  already used by die effects and freed at finish) or a per-object update before each draw.
  Builder's call, judged by cost; isolate is the known path.
- **Slosh.** CPU side, per die per frame: a damped spring pulls the lag vector toward the true up
  (critically under-damped: one overshoot, settled in about 0.6 s). Computed from the die's
  quaternion the renderer already has; no physics-worker change.
- **Flare.** A small envelope per die (rise ~80 ms, decay over the effect's duration), written by
  the effects library at the same place it writes uFxFlare today (library/die-effects.js), and
  by the public hook. Capped at 1; overlapping flares take the max.
- **Public hook.** `game.dicer.flareInside(rollOrMessageId, { die?, amount?, duration? })`
  (exact shape builder's call, documented in the README and the API doc), local only, no-op
  when the setting is off or the roll is not on screen.
- **Damage map.** Three rows in damage-themes.js change their interior when
  `elementalDamageInsides` is on: fire → `fire`, cold → `frost`, electricity → `storm`, keeping
  each row's colours.
- **Editor.** The four elementals join the inside list in the appearance editor with strings in
  lang/en.json and preview tiles like the other insides.
- **Rendering.** While any shown die has a moving inside, the render loop keeps drawing (it does
  already while dice are in flight or lingering); it never wakes an idle renderer.

## Calls made after the builder check (designer's calls, owner may override)

- **Which dice get per-die state:** only dice whose look has an inside (resin body, inside type
  not `none`), and only on marched tiers. They are isolated at spawn. Target: `maxDice` (default
  20) such dice animating at once within the speed bar. `#reisolate` in dice-box.js carries the
  new uniforms across a look change, as it does uFxTint and uFxFlare.
- **Time (revised while planning):** `uInteriorTime` is per die, on its isolated material,
  counting seconds since the roll spawned, scaled by the motion factor. Dice with insides are
  isolated and stepped anyway, so this costs nothing extra, needs no wrapping (a roll lasts
  seconds), and lets each die ease to a stop on its own after landing.
- **Resting dice:** landed dice stay until `timeBeforeHide` (default 2000 ms). While dice with a
  moving inside linger, the loop keeps drawing; if a player sets a very long hide time, insides
  ease to a stop 10 s after landing and the loop goes idle as it does today.
- **Frame for lag and spin:** the same canonical transform as `dcIUp` (UP_LINE in
  insides/index.js, generic across shapes), so every die type matches.
- **Damage map:** only the built-in default rows (fire, cold, electricity) switch; a world map or
  user override that names an inside is used as written. Each row's two colours and density pass
  through unchanged.
- **Flare scope:** local only. It runs where die effects run, so a hidden or blind roll that
  shows no effect gets no flare; ghost dice have no inside. `flareInside` needs no GM check (it
  changes nothing shared) and no-ops on dice that aren't on this screen.
- **16-step quality and GPU cost:** no automated image threshold. The owner judges the visual
  sheets, which include a 16-step row. The perf gate is CPU frame time (fx-perf probe); shader
  cost is held by conservative per-module budgets (early outs, at most four noise lookups per
  sample, like smoke) and the owner's live bench.
- **Reduced motion:** time and spin scale to a quarter, the slosh spring runs at quarter speed
  with the same damping, flares rise once softly, storm sparks hold instead of flashing.
- **Visual sheet moments:** 400 ms into flight and 1 s after landing; plus a reduced-motion row.

## Tests

- Unit: each new inside module compiles in the material (as the existing inside tests do), and
  its GLSL uses only the allowed names.
- Unit: the slosh spring settles within 0.6 s and overshoots once; with motion off the lag equals
  true up.
- Unit: flare envelope rise/decay; max of overlapping flares; hook no-ops when off or off-screen.
- Unit: damage map picks the elementals with the setting on and the old rows with it off.
- Unit: settings registered with strings.
- Visual (tests/visual, like builtin-fx): sheets of the four elementals on dark and light tables
  at two moments, and liquid mid-slosh; frozen vs moving sheets for the existing insides.
- Perf: fx-perf probe, animated vs frozen inside, against the bar above.
- Owner live check: insides move in flight and at rest, a fire damage roll fills the die with
  fire, a crit flares the inside.

## Left to the builder

- The exact GLSL of each motion and each elemental, within the step budget.
- Isolate vs per-object uniforms for per-die values.
- The life touches for foil/eye/botanical/runes/weapons/dragon (drop any that cost real time).
- The hook's exact argument shape.

## Order and branch

Built after the effects rebuild's round 1 sign-off, on a branch off `builtin-fx` (the flare is
driven from the rebuilt effects). Delivered in rounds with owner sign-off, like the effects
rebuild: (1) inputs + motion for existing insides, (2) the four elementals + damage map,
(3) flare + hook.
