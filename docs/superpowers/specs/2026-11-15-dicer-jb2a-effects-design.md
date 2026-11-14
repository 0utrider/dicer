# JB2A animations for dice effects — design

## Why

The owner judged Dicer's built-in effects "bad and unprofessional", and Claude agrees. Captures show
three faults:

- **Hairline strokes:** lightning, frost and fumble are drawn as 1-pixel lines.
- **Flat rings:** celebrate and shockwave are flat rings with no glow.
- **Near-invisible particles:** sparkles, embers, smoke and shatter barely show.

The owner pointed at JB2A (Jules & Ben's Animated Assets) as the quality bar.

The owner chose approach C:
- **Project 1 (this document):** play JB2A's own animations when JB2A is installed.
- **Project 2 (a separate design, later):** rebuild the built-in effects in JB2A's style for
  everyone else.

A throwaway spike (`dev/zz-spike.*`, not committed) played JB2A webm files as textured planes in
Dicer's scene at the landed die. The owner saw the frames and said "Yes, go with C".

## What

When a JB2A module is active and the viewer's **Use JB2A animations** setting is on, a library
effect that has a JB2A mapping plays JB2A animation layers at the die instead of its built-in
version. Without JB2A, or for an effect with no mapping, the built-in effect plays exactly as
today.

## Goals

- Effects in the owner's games look like JB2A: the critical banner and burst, frost crust,
  lightning strike, smoke, a crack on a fumble.
- No change for anyone without JB2A.
- No new required dependency.
- Nothing from JB2A is shipped in Dicer. Dicer only plays files the user already has installed.
  JB2A is CC BY-NC-SA, and playing an installed module's files does not redistribute them.

## Non-goals

- Impact effects (dust and sparks on every table hit) and damage themes stay built-in in this
  project.
- `glow-pulse`, `color-shift` and `number-flare` work on the die's own material. JB2A has
  nothing equivalent, so they stay built-in.
- `shake` stays built-in.
- No Sequencer dependency, and no use of Foundry's canvas layers. Everything renders in Dicer's
  own three.js scene, so it lines up with the dice.

## Anti-goals

- A JB2A file that is missing, fails to load or decodes slowly must never leave a roll with no
  effect at all, and must never delay a roll or its chat card. It falls back to the built-in
  effect.
- No console spam when JB2A is absent.

## Constraints

- **World-start budget:** the world-start ratchet (`tests/unit/build.test.js`, the LAZY list
  in `build/world-start.js`) must stay under its ceiling. The JB2A player lives in a new lazy
  chunk, loaded only when a JB2A module is active and the setting is on. The setting
  registration and a small resolver hook are the only world-start code.
- **Privacy:** privacy rules are unchanged. A JB2A layer plays only where the built-in effect
  would have played; `play()` receives the same `fx` after the same gating (blind, whisper,
  ghost dice).
- **Budget:** the effect budget is unchanged. A JB2A effect has a `cost`, like any library
  module, and goes through the same `play()` budget.
- **Reduced motion:** the existing `gate()` applies. Safe mode follows the same rule as library
  effects.
- **Per-viewer:** each client plays JB2A only if JB2A is installed on that client. Players
  without it see the built-in effect. Nothing is synchronized beyond what effects already do.
- **Own setting:** **Use JB2A animations**, a client setting, default on (owner rule: every
  feature has its own on/off setting, default on). Its hint says it does nothing without JB2A.

## Approaches

1. **JB2A when installed, built-in otherwise (picked, as part of C).** Instant quality for JB2A
   users and no dependency, but it only helps people who have JB2A.
2. Rebuild the built-in effects only. That works for everyone, but code-drawn effects get close
   to hand-painted art without fully matching it. This is project 2.
3. Both at once in one project. Rejected: two independent pieces of work, and JB2A gives the
   biggest jump soonest.

## How (decided)

### Finding the files

- **Modules:** `jb2a_patreon` is preferred. The free module id is `JB2A_DnD5e`.
- **Path:** `${location}/${moduleId}/Library/Generic/<sub-path>`. `location` is
  `game.settings.get(moduleId, 'jb2aLocation')` when that setting exists and is non-empty, else
  `modules`. JB2A lets a GM host its files elsewhere, such as an S3 bucket.
- **Mapping table:** one entry per effect id, as a list of layers. A layer is the file
  sub-path, how it is placed and its size in die units. Each layer may list variants: Patreon
  and free file names, and colour variants.
- **Colour variants:** an effect's rule colour picks the nearest listed colour variant by hue.
  Otherwise the layer's default variant plays.
- **Unloadable files:** a file that fails to load (video `error`, or no `canplay` within
  1.5 s) is remembered as missing for the session. That effect falls back to its built-in
  version, from then on and for that play.

### Playing

- **Shape:** each layer is a plane facing up (`MeshBasicMaterial` with a `VideoTexture`,
  `transparent`, `depthWrite: false`, `toneMapped: false`), centred on the die.
- **Two placements:**
  - `table`: just above the floor, depth-tested, so dice cover it.
  - `over`: above the die, drawn on top, for banners, lightning and smoke.
- **Offsets:** each layer has an `offsetZ` in die units (banners sit above the die on screen)
  and a size scaled by the effect's `intensity`.
- **Fit to the art:** each animation is drawn at a different scale inside its frame. The table
  stores a per-layer size and offset tuned so the art fits the die. Spike values: celebrate burst
  7, stars 3.2, banner 4.5 at offsetZ -2; fumble crack 6, banner 5 at -1.9; frost 6; lightning
  16 at -1.6; smoke 5.
- **Lifetime:** an effect lives until its last layer's video ends. Its `update()` keeps
  DiceBox's loop awake while it plays. `stop()` and `releaseDie(die)` pause and remove the
  layers and dispose them.
- **Slow motion:** videos honour slow motion through `playbackRate`, the same factor dice
  playback uses.
- **Pooling:** video elements are pooled per file, at most 4 per file and 8 playing at once. A
  play beyond that falls back to the built-in effect. The first use of a file preloads it. When
  JB2A is active and the setting is on, `prefetch()` also preloads the celebrate and fumble
  files in an idle callback.

### Initial mapping (Claude's call; the owner signs off in the live check)

| Effect | JB2A layers |
|---|---|
| celebrate | `Particles/ParticleBurstCircle01_01_Regular_Yellow` (table) + `Twinkling_Stars/TwinklingStars_04` (over) + `UI/Critical_01_Yellow` banner (over, above the die) |
| fumble | `Impact/GroundCrackImpact_01_Dark_Red` (table) + `UI/CriticalMiss_02_Red` banner (over, above the die) |
| frost | `Impact/FrostImpact_01_Regular_Blue` (table) |
| lightning | `Lightning/LightningStrike01_01_Regular_Blue` (over, tip on the die) |
| smoke | `Smoke/SmokePuff01_01_Dark_Black` (over) |
| sparkles | `Twinkling_Stars/TwinklingStars_04` (over) + `Particles/ParticlesOutward01_01_Regular_Blue` (table) |
| shockwave | an impact ring; the builder picks from `Impact/` (e.g. `Impact_0x`) and the owner approves |
| light-burst | `Explosion/Explosion_01_<colour>` or a softer flash; the builder picks and the owner approves |
| embers | `Impact/ImpactFire01_01_Regular_Orange` or a `Fire/` burst; the builder picks and the owner approves |
| shatter | something bigger than `Explosion/TopFractureFlask01` (too small in the spike), e.g. `Impact/ImpactIceShard01` or a shrapnel burst; the builder picks and the owner approves |

The free JB2A module carries fewer files. Layers the free module lacks are left out. An effect
with no playable layer falls back to built-in. Claude cannot check the free module's file list
offline, so the free variants are best effort and verified at runtime by the load check.

## Calls made by Claude (owner can override)

- The setting is per client, default on.
- When JB2A plays, it replaces the built-in effect. The two are not layered together.
- The banners are JB2A's English text images ("CRITICAL!", "Critical Miss!").
- Impact effects, damage themes and the three die-material effects stay built-in.

## Settled after the builder check (Claude's calls)

- **Units:**
  - Sizes and offsets are scene units. Scene units are die units, the same units as the
    physics stage and the die positions.
  - `table` layers sit at y = 0.02 with depth testing on.
  - `over` layers sit at y = 3 with `depthTest: false` and `renderOrder` 999, so they draw over
    the dice.
- **Deciding JB2A or built-in:**
  - The decision is synchronous, inside `play()`'s module lookup. JB2A is used when four things
    hold:
    - the JB2A chunk is loaded;
    - the effect has a mapping;
    - none of its layer files is known missing;
    - the pool has room.
  - The video starts at once. A file that errors, or has no `canplay` within 1.5 s, stops that
    effect's JB2A layers and starts the built-in effect late on the same die. It is a cosmetic
    effect, so a late start is acceptable. The file is also marked missing for the session.
  - A JB2A module's `cost` equals its built-in effect's cost, so the budget is the same either
    way.
- **When the chunk loads:**
  - `prefetch()` loads the JB2A chunk in the same idle callback as the library, when JB2A is
    available and the setting is on. It then preloads every mapped file's metadata
    (`preload = 'auto'` on one pooled element per file).
  - Rolls before that use the built-in effect. That is acceptable.
  - The effect layer gets an injected `jb2a` dependency, `{ source(): {moduleId, location} | null }`,
    built in main.js from `game.modules` and `game.settings`. The layer never reads `game` itself.
- **File names:** the mapping stores full file names, including the size suffix and `.webm`.
  There is no directory listing at runtime: players may lack the browse permission.
- **Colour:** only layers that list colour variants explicitly are recoloured. The banners and
  the fixed-colour layers, such as the Dark_Red crack, always play as listed.
- **Reduced motion and safe mode:**
  - Library effects ignore reduced motion; only screen shake and impact effects honour it. JB2A
    layers follow the library and play.
  - JB2A layers use no custom shaders, so they also run in safe mode, as `dsn:` effects do.
- **Harness:** `tests/visual/jb2a.mjs` runs locally, like the other visual scripts. It reads
  JB2A from `../jb2a_patreon` when present and skips otherwise. It is not part of `npm test`.

## Left to the builder

- Module layout: a lazy `jb2a` chunk exporting effect modules that match the library contract
  (`{ id, cost, defaults, start(ctx) }`), and a resolver the effect layer asks before
  `library[id]`.
- Hue matching and the exact variant lists, read from the installed Patreon folder.
- Final tuned sizes and offsets per layer, checked with a visual harness that reads JB2A from
  `../jb2a_patreon` when present and skips otherwise.
- Tests:
  - resolver unit tests: module detection, location prefix, mapping, colour pick, fallback on
    error or timeout, the pool limit;
  - the effect layer choosing JB2A or built-in;
  - the world-start ratchet.
- README: the setting and what it uses.

## Owner live check

In Foundry, with JB2A on, run `game.dice3d.previewEffect(id)` for each mapped id and roll a
natural 20 and a natural 1. The owner approves each look. Anything rejected gets a different
JB2A pick or a new size.
