# Dicer Plan 4 — Sounds, Effects and Damage Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dice sound like what they are made of and what they land on; results set off effects chosen by user-defined rules (a nat 20 celebrates, a nat 1 fumbles, any number can trigger anything); PF2e and dnd5e damage dice take on a theme per damage type; DSN `addSFXMode` / `addSFXDefaults` / `DiceSFX` integrations run in the same rule system. None of it leaks a hidden result, and none of it costs anything while no dice are on screen.

**Architecture:**

- **Impacts come from physics.** The Rapier worker records collision events per step and streams them with each frame chunk. Playback hands each event to DiceBox when the playhead crosses its step, so sound lines up with what is drawn.
- **Sound is synthesized, not downloaded.** A lazy `audio` chunk renders impact and result sounds with pure DSP code (modal synthesis) into `AudioBuffer`s once per session. No audio files ship, so world start does not grow and there is no licence question. User files (custom sounds) are fetched and decoded on demand.
- **Effects are decided at plan time, played at landing.** A pure rule engine runs inside the roll decorator, which only runs for a `real` privacy view (ghost dice use `ghostDecorator`, P3-R20). Matching rules ride on the `DieSpec` as `fx`. DiceBox plays them when the die lands. So a client that may not see a result never even computes its effects.
- **One GPU particle pool.** All particle effects share one `THREE.Points` draw with GPU-computed motion, sized per quality tier. Die effects (colour shift, number flare) use per-die material clones with an `fx` uniform block. Effects keep the render loop alive only while they run.
- **Damage themes are looks + sound + effect.** A damage type found on the roll (PF2e `DamageInstance.type`, dnd5e `roll.options.type`, or term flavor) maps to a built-in theme or a DSN colorset through a GM-editable map with per-user overrides.

**Tech Stack:** Plain JS ES modules, three.js 0.184 (WebGL2), Rapier3D deterministic (worker), WebAudio, Foundry v14 ApplicationV2 (`HandlebarsApplicationMixin`), Vite 6 lib build, Vitest, ESLint 9 / Prettier 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md` — G7 (special effects), G8 (damage presets), G9 (sounds), with G1's privacy rule, G2's performance table, §4 anti-goals, §5 "Sound" and "Settings", §7 privacy tests.

**Inputs from earlier plans:**

- `docs/superpowers/plans/2026-11-10-dicer-plan-3-notes.md`: P3-R20 (ghost dice carry no real data), P3-R7 (budget in MiB), deferred "addSFXMode name fields guessed (Plan 4)".
- `docs/research/dsn-integration-survey.md` §4: `addSFXMode` / `addSFXDefaults` are used by daggerheart-duality-dice; `addDamageTypeDefaults` must stay feature-detectable.

## Design calls made in this plan (owner can overturn)

- **P4-D1 Synthesized sound instead of sample files.** §5 says "audio sprites"; this plan renders the same kind of pre-decoded buffers from code at runtime. Why: about 150 KiB of world-start headroom, no licensing of recorded samples, and variation per material for free. Cost if wrong: if the owner finds the synthesized clicks less convincing than recordings on the dev page, Task 2 is replaced by a sample pack loaded on demand (the engine's `result({src})` path already plays files), roughly one task of rework.
- **P4-D2 The roller's rules decide, the viewer filters.** A die's effects come from world rules plus the _roller's_ personal rules; each viewer only chooses whether to see other players' effects (`showOthersEffects`). Macros run once, on the roller's client. Cost if wrong: viewers who want their own celebration rules for others' rolls would need a second rule source; the resolver takes rule sources as injected functions, so it is additive.
- **P4-D3 Damage theme sits between flavor colorsets and actor/user looks.** An explicit colorset from a system or module still wins; a player's personal dice lose to the damage theme on damage dice (that is the point of the feature; `damagePresets` off or a per-type `none` override restores them). Cost if wrong: one reorder in the look chain.
- **P4-D4 Impact sounds play for ghost dice.** They come from this client's own random throw and carry no result information. Cost if wrong: one condition in `onImpact`.

## Global Constraints

- **Privacy outranks everything (G1, §4):** "effects and their sounds never fire for users who can't see the result. A nat-20 celebration must not leak a hidden roll." Nothing result-dependent (effect, result sound, slow motion, macro) is computed for a `ghost` or `none` view. Impact sounds are not result-dependent and play for any die that is drawn.
- **No timing leak:** a matched rule may change _this client's_ animation (slow motion), never the timing another client sees.
- **No GPU work while idle (G2):** effects start the loop only during a roll, and the loop stops when the last die and the last effect are gone. No `AudioContext` is created until the first sound is due; it is suspended again after 30 s with nothing playing.
- **Typical roll (≤10 dice) holds 60 fps; no main-thread task over 50 ms; 30-die pool visible within 100 ms (G2).** Synthesis runs once per session in chunks of ≤ 8 ms of work per idle callback, never on the landing frame.
- **Download size:** world start stays ≤ 4 MiB (P3-R7). Headroom is about 150 KiB. The `audio` synth, the `effects` library and the two editor UIs are lazy chunks (`import()`), prefetched in an idle callback after `ready`. `tests/unit/build.test.js`'s lazy list must name each new chunk.
- **No DSN code or assets copied** (AGPL-3.0). DiceSFX support is reimplemented from the observed contract (constructor `(box, dicemesh, options)`, `static init()`, `play()`, optional `destroy()`, `PLAY_ONLY_ONCE_PER_MESH`, `id`, `specialEffectName`).
- **Settings (§5):** every feature has its own setting, default on: `sounds`, `effects`, `damagePresets`, `screenShake`, `slowMotion`, `showOthersEffects`, `triggerMacros`, `quietWhenUnfocused`.
- **Defensive integration:** a malformed rule, theme map, third-party SFX class or sound file logs one warning per source and is skipped. It never throws into a hook, and never stops a roll from revealing (`diceSoNiceRollComplete` still fires exactly once).
- **Target:** Foundry v14 only; PF2e 8.x and dnd5e 6.x for system-specific reads (installed: pf2e 8.7.0, dnd5e 6.0.6).
- **Tests:** unit tests in `tests/unit/*.test.js` (node env; jsdom docblock when the DOM is needed). Husky pre-commit runs `npm run lint && npm test`. Run tests with `rtk proxy npx vitest run <file>`, builds with `node node_modules/vite/bin/vite.js build`. On Windows write multi-line scripts to files.

## Review Focus

1. **A hidden nat 20.** Blind, whispered, secret and ghost rolls, the `showForRoll(synchronize)` receivers, and a GM-only blind roll seen by the roller. Expected: a client whose view is not `real` gets no effect, no result sound, no slow motion and no macro; impact sounds still play for ghost dice (test in Task 7).
2. **A big pool where every die matches.** 30d6 with a "6 on any d6 → sparks" rule plus 30 dice of impacts. Expected: effects capped by the tier budget, at most `MAX_VOICES` sounds at once, no frame-time spike (tests in Tasks 3 and 8).
3. **No sound possible.** `AudioContext` missing, suspended by autoplay policy, or `decodeAudioData` failing on a custom file. Expected: silence, one warning, the roll lands and reveals on time (test in Task 3).
4. **Garbage rules.** A hand-edited user flag, an unknown effect id, a bad regex in a formula pattern, a DSN `addSFXDefaults` entry with an unknown `onResult`. Expected: that rule is skipped with one warning; the others still run (test in Task 5).
5. **A third-party `DiceSFX` that misbehaves.** `play()` throws, never resolves, or `init()` rejects. Expected: capped at `SFX_TIMEOUT_MS`, the render loop stops, `destroy()` is still called, the reveal is unaffected (test in Task 10).

---

## File Structure

| File                                                                                                  | Responsibility                                                                 |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/physics/sim.js`, `physics.worker.js`, `physics-client.js`, `protocol.js`                         | Collision events per step, streamed with chunks.                               |
| `src/throw/playback.js`                                                                               | Hands out the events the playhead crossed; speed ramp for slow motion.         |
| `src/audio/synth.js` (new, lazy chunk `audio`)                                                        | Pure DSP: impact, surface and result sounds as `Float32Array`.                 |
| `src/audio/sound-engine.js` (new)                                                                     | AudioContext lifecycle, buffers, voices, gains, custom files.                  |
| `src/audio/sound-material.js` (new)                                                                   | Die look / DSN material → sound material.                                      |
| `src/effects/rules.js` (new)                                                                          | Rule shape, normalization, matching, built-in defaults, DSN conversion.        |
| `src/effects/roll-context.js` (new)                                                                   | Outcome, role and damage type of a roll (PF2e, dnd5e, generic).                |
| `src/effects/fx-resolver.js` (new)                                                                    | Per die: which rules match, for this viewer; builds `fx`.                      |
| `src/effects/effect-layer.js` (new)                                                                   | Runs effects inside DiceBox's tick; budget; per-die material isolation; shake. |
| `src/effects/library/*.js` (new, lazy chunk `effects`)                                                | Particle pool and the effect catalogue.                                        |
| `src/effects/dsn-sfx.js` (new)                                                                        | Runs `addSFXMode` classes as effects.                                          |
| `src/effects/damage-themes.js` (new)                                                                  | Built-in damage themes, default maps, resolution chain.                        |
| `src/ui/trigger-editor.js`, `src/ui/damage-map-editor.js` (new, lazy chunks), `templates/*.hbs` (new) | The two editors.                                                               |
| `src/render/shaders/bodies.js`, `src/render/dice-material.js`                                         | The `fx` uniform block (program key `fx1`).                                    |
| `src/render/quality.js`                                                                               | Per-tier `particleScale` and `effectBudget`.                                   |
| `src/throw/dice-box.js`                                                                               | Impacts → sound; landing → effects; loop keep-alive.                           |
| `src/compat/resolve-looks.js`                                                                         | Damage theme in the look chain.                                                |
| `src/main.js`, `src/settings.js`, `lang/en.json`                                                      | Wiring, settings, menus.                                                       |
| `dev/effects.html`, `dev/effects.js` (new)                                                            | Owner review page: every effect and sound.                                     |

---

### Task 1: Impact events from physics

**Files:**

- Modify: `src/physics/sim.js`, `src/physics/physics.worker.js`, `src/physics/physics-client.js`, `src/physics/protocol.js`, `src/throw/playback.js`
- Test: `tests/unit/sim.test.js`, `tests/unit/physics-client.test.js`, `tests/unit/playback.test.js`

**Interfaces:**

- Produces:
  - `protocol.js`: `IMPACT_FLOATS = 4` — each event is `[step, die, other, speed]`. `other` is another die's index, or `-1` for the floor, `-2` for a wall.
  - `sim.throw(req, onChunk)`: every chunk gains `events: Float32Array` (length multiple of 4, `step` global, not chunk-local). Events come from a `RAPIER.EventQueue` with `ActiveEvents.COLLISION_EVENTS` on dice, floor and walls. Only `started` collisions count. `speed` is the relative linear speed of the pair just before the step, in sim units/s. Pairs are reported once (lower die index as `die`).
  - Worker transfers `events.buffer` alongside `data.buffer`. `PhysicsClient` chunk objects keep `events` (empty `Float32Array` when absent).
  - `Playback.push(chunk)` stores events. New method `Playback.takeEvents() -> Array<{die: number, other: number, speed: number}>` returns events whose step the playhead crossed since the last call, only while `update()` is `'playing'`, never events before `_firstInside` (the dice were off screen).

- [ ] **Step 1: Failing tests.**
  - `sim.test.js` "a throw reports floor impacts": a real 3d6 throw; at least one event with `other === -1`; every `die` is in `[0, 3)`; steps are non-decreasing across chunks.
  - `sim.test.js` "same seed gives identical events": two throws with one seed → equal concatenated event arrays.
  - `sim.test.js` "impacts fade out": the first floor impact's speed is greater than 4 × the speed of the last event before `settledStep`.
  - `physics-client.test.js` "chunk keeps events": a `FakeWorker` chunk with `events` arrives with them; without, `events.length === 0`.
  - `playback.test.js` "takeEvents hands each event once, in playhead order, none while waiting".
- [ ] **Step 2: Run, confirm failures.** `rtk proxy npx vitest run tests/unit/sim.test.js tests/unit/physics-client.test.js tests/unit/playback.test.js`
- [ ] **Step 3: Implement.** Map collider handles → die index when bodies are created. Pool the events buffer like the frame buffer (recycled through `MSG.RECYCLE`). Cap events at 64 per chunk (keep the fastest) so a pile-up cannot flood the main thread.
- [ ] **Step 4: Run, confirm pass;** run the full suite (determinism and fallback tests included).
- [ ] **Step 5: Commit** `feat(physics): stream collision events with frame chunks`.

---

### Task 2: Sound synthesis (lazy `audio` chunk)

**Files:**

- Create: `src/audio/synth.js`
- Test: `tests/unit/synth.test.js`

**Interfaces:**

- Produces (pure, no WebAudio):
  - `SOUND_MATERIALS = ['plastic', 'metal', 'wood', 'glass', 'stone']`, `SURFACES = ['felt', 'wood', 'stone', 'metal']`, `VARIANTS = 4`.
  - `renderImpact(material, variant, sampleRate) -> Float32Array`: a die-on-hard-surface click. Modal synthesis: a short noise burst exciting 3–6 damped sinusoids whose frequencies, decays and gains are per-material tables, perturbed per `variant` by `mulberry32(hash(material, variant))` from `src/core/rng.js`. Peak normalized to 0.9. Length ≤ 0.6 s (metal and glass ring longest).
  - `renderSurface(surface, sampleRate) -> Float32Array`: the table's own short response (felt: soft low thump; wood: hollow knock; stone: bright tick; metal: tray ring), convolved-in by the engine as a second voice for floor impacts.
  - `RESULT_SOUNDS = ['chime', 'fanfare', 'sparkle', 'fizzle', 'thud', 'whoosh', 'crackle', 'zap', 'boom']` and `renderResult(name, sampleRate) -> Float32Array` (≤ 1.5 s each). These serve the built-in triggers and damage themes.
  - `renderAll(sampleRate, {budgetMs = 8, idle}) -> Promise<Map<string, Float32Array>>`: renders every sound keyed `impact:<material>:<variant>`, `surface:<name>`, `result:<name>`, yielding to `idle(cb)` between sounds so no slice exceeds `budgetMs`.

- [ ] **Step 1: Failing tests** (`synth.test.js`):
  - every material × variant renders, finite, peak within `[0.85, 0.95]`, length ≤ 0.6 s at 48000 Hz;
  - variants of one material differ (correlation < 0.95), same inputs give identical output;
  - spectral centroid order: `metal > glass > stone > plastic > wood` (a small DFT helper in the test);
  - decay: RMS of the last 10% < 0.1 × RMS of the first 10% for `plastic` and `wood`;
  - every `RESULT_SOUNDS` name renders ≤ 1.5 s; an unknown name throws `RangeError`;
  - `renderAll` resolves with `SOUND_MATERIALS.length * VARIANTS + SURFACES.length + RESULT_SOUNDS.length` entries and calls `idle` at least once per sound.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement.** Tune by ear with the dev page later (Task 14); tests pin only structure and ordering.
- [ ] **Step 4: Run, confirm pass.**
- [ ] **Step 5: Commit** `feat(audio): synthesize impact, surface and result sounds`.

---

### Task 3: The sound engine

**Files:**

- Create: `src/audio/sound-engine.js`, `src/audio/sound-material.js`, `tests/unit/fake-audio.js`
- Test: `tests/unit/sound-engine.test.js`, `tests/unit/sound-material.test.js`

**Interfaces:**

- Consumes: `renderAll` (Task 2) through an injected `loadSynth = () => import('./synth.js')`.
- Produces:
  - `soundMaterialOf(appearance, preset?) -> SoundMaterial`: `body.type` `metal` → `metal`; `marble` → `stone`; `resin` → `glass`; `opaque`, `pearl` → `plastic`. A DSN material hint (`preset.material` or the colorset's `material`) wins: `metal`, `chrome` → `metal`; `wood` → `wood`; `glass`, `pristine`, `iridescent` → `glass`; `stone` → `stone`; anything else → `plastic`.
  - `createSoundEngine({createContext = () => new AudioContext(), loadSynth, getSetting, hasFocus = () => document.hasFocus(), fetchSound = fetch, idle = requestIdleCallback-or-setTimeout, warn = console.warn}) -> SoundEngine`:
    - `impact({material, surface, speed, other, dieKey}) -> void`. `other === -1` also plays the surface voice. Gain = `impactGain(speed)` × `soundVolume` × (unfocused && `quietWhenUnfocused` ? 0.25 : 1). Drops: `sounds` off, gain below `MIN_GAIN = 0.03`, the same `dieKey` within `DIE_DEBOUNCE_MS = 40`, or `MAX_VOICES = 8` already playing (the quietest new one is dropped). Picks a variant round-robin per material, with ±4% playback-rate jitter.
    - `result(sound) -> Promise<void>`: `sound` is `{builtin: RESULT_SOUNDS name}` or `{src: string, volume?: number}`. Gain = `volume ?? 1` × `effectsVolume` × `soundVolume` (× 0.25 when unfocused). Custom files are fetched once, decoded, cached (LRU of 32), and a failing file warns once per `src`.
    - `preload() -> Promise<void>`: loads the chunk and renders all synth buffers in idle slices.
    - `dispose()`.
    - The `AudioContext` is created on the first call that would play. A suspended context is resumed with `game.audio?.awaitFirstGesture?.()`-style waiting (`ctx.resume()` after the first `pointerdown`), and calls made while suspended are dropped, not queued (a late clatter is worse than none). After 30 s idle the context is suspended.
  - `impactGain(speed) -> number` in `[0, 1]`: 0 below `MIN_IMPACT_SPEED`, 1 at or above `LOUD_IMPACT_SPEED`, smooth (squared) in between. Pick both constants (sim units) from Task 1's measured speeds: the first floor impact of a normal throw lands within 0.6–1.0; the final settling contacts give 0.
  - `fake-audio.js`: `FakeAudioContext` recording created sources, gains, start times and `state` transitions; `FakeAudioBuffer`.

- [ ] **Step 1: Failing tests:**
  - `sound-material.test.js`: every body type and every DSN material hint above; unknown → `plastic`.
  - `sound-engine.test.js`:
    - no context exists before the first `impact` (lazy);
    - "voice cap": 30 simultaneous impacts start ≤ 8 sources;
    - "debounce": two impacts with the same `dieKey` 10 ms apart start 1 source;
    - "floor adds the surface voice": `other: -1` → 2 sources; `other: 2` → 1;
    - "settings": `sounds: false` → 0 sources; `soundVolume: 0.5` halves gain; unfocused with `quietWhenUnfocused` → × 0.25;
    - "no WebAudio": `createContext` throws → `impact` and `result` return normally, one warning total;
    - "suspended context drops, not queues";
    - "bad custom file": `fetchSound` rejects or decode fails → `result` resolves, one warning per `src`, a second call does not refetch;
    - "idle suspend": after 30 s (fake timers) with nothing playing, `ctx.suspend` was called.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, confirm pass.**
- [ ] **Step 5: Commit** `feat(audio): sound engine with voices, gains and custom files`.

---

### Task 4: Impact sounds in the dice box, and sound settings

**Files:**

- Modify: `src/throw/dice-box.js`, `src/main.js`, `src/settings.js`, `lang/en.json`, `tests/unit/build.test.js`
- Test: `tests/unit/dice-box.test.js`, `tests/unit/settings.test.js`, `tests/unit/main-hooks.test.js`

**Interfaces:**

- Consumes: `Playback.takeEvents` (Task 1), `SoundEngine.impact`, `soundMaterialOf` (Task 3).
- Produces:
  - `DiceBox` option `onImpact = () => {}` called per crossed event with `{material, surface, speed, other, dieKey}`. `material` comes from the die's spec `soundMaterial` (set from `soundMaterialOf(appearance, preset)` in `makeDie`); `dieKey` is unique per die per roll. `surface` comes from option `getSurface = () => 'felt'`.
  - `DieSpec` gains optional `soundMaterial` (overrides the derived one; damage themes use it in Task 11).
  - Settings (registered in `registerSettings`):

    | Key                    | Scope  | Type                                           | Default |
    | ---------------------- | ------ | ---------------------------------------------- | ------- |
    | `sounds`               | client | Boolean                                        | true    |
    | `soundVolume`          | client | Number (range 0–1, step 0.05)                  | 0.6     |
    | `effectsVolume`        | client | Number (range 0–1, step 0.05)                  | 0.8     |
    | `quietWhenUnfocused`   | client | Boolean                                        | true    |
    | `soundSurface`         | world  | String (`felt`/`wood`/`stone`/`metal`)         | `felt`  |
    | `soundSurfaceOverride` | client | String (`world`/`felt`/`wood`/`stone`/`metal`) | `world` |

  - `main.js`: creates one engine, passes `onImpact: (e) => engine.impact(e)` and `getSurface` (override unless `world`), calls `engine.preload()` in an idle callback after `ready` when `sounds` is on.
  - `build.test.js`: the `audio-*.js` chunk is lazy (`isLazy` regex and the exact lazy list).

- [ ] **Step 1: Failing tests:**
  - `dice-box.test.js` "impacts reach onImpact while playing": `fakePhysics` chunk with events → `onImpact` calls with the die's material, in step order, none before the dice enter.
  - `dice-box.test.js` "a ghost die still clacks; a cleared roll stops": ghost spec → impacts fire; `clear()` mid-roll → no more calls.
  - `settings.test.js`: the six keys, scopes, defaults and choices.
  - `main-hooks.test.js`: `soundSurfaceOverride: 'wood'` wins over `soundSurface: 'stone'`; `world` falls back.
- [ ] **Step 2–4:** run, implement, pass; `node node_modules/vite/bin/vite.js build` then `rtk proxy npx vitest run tests/unit/build.test.js` passes.
- [ ] **Step 5: Commit** `feat(audio): material and surface impact sounds`.

---

### Task 5: The trigger rule engine

**Files:**

- Create: `src/effects/rules.js`
- Test: `tests/unit/rules.test.js`

**Interfaces:**

- Produces:
  - Rule shape (after `normalizeRule`):
    ```js
    {
      id: string, name: string, enabled: boolean, source: 'world' | 'user' | 'module',
      die: 'any' | string,            // 'd20', 'd6', 'dc', or a DSN trigger/dsnType id
      result: { kind: 'any' | 'value' | 'range' | 'max' | 'min', value?: number, from?: number, to?: number },
      context: { formula?: string, role?: string, damageType?: string, actorId?: string, userId?: string },
      outcome: 'any' | 'critical-success' | 'success' | 'failure' | 'critical-failure',
      effect: { id: string, color?: string, intensity?: number, duration?: number } | null,
      sound: { builtin: string } | { src: string, volume?: number } | null,
      macro: string | null,           // a Macro UUID
    }
    ```
    `formula` is a case-insensitive substring, or a regex when written `/…/flags`. `intensity` is clamped to `[0, 2]` (default 1), `duration` to `[100, 5000]` ms (each effect has its own default).
  - `normalizeRule(raw, source, warn) -> Rule | null`: null (one warning per rule id) for: not an object, no effect and no sound and no macro, an unknown `result.kind`, an invalid regex, a non-finite range.
  - `matchRule(rule, die) -> boolean` where `die` is `{type, dsnType, value, faces, formula, role, damageType, actorId, userId, outcome}`. `die: 'any'` matches every type; otherwise it matches `type` or `dsnType`. `max` matches `value === faces`, `min` matches `value === 1` (a d100's ones die and tens die are both type `d10` with `faces` 10, and `max`/`min` there follow the d100's own result: the decorator passes `faces: 100` and the full result for both). A rule with a specific `outcome` never matches when the roll's outcome is `null`.
  - `DEFAULT_RULES`: two world rules, ids `dicer.nat20` (`die: 'd20'`, `result: {kind: 'value', value: 20}`, effect `celebrate`, sound `{builtin: 'fanfare'}`) and `dicer.nat1` (`d20`, value 1, effect `fumble`, sound `{builtin: 'fizzle'}`).
  - `dsnDefaultsToRules(list, triggers, warn) -> Rule[]`: each `{diceType, onResult: string[], specialEffect, options?}` becomes one rule per entry, `source: 'module'`, `die: diceType`, `effect: {id: 'dsn:' + specialEffect, ...options}`. `onResult` values: a numeric string → `value`; `max`/`min` → that kind; `critical`/`success`/`failure`/`fumble` → outcome `critical-success`/`success`/`failure`/`critical-failure` with `result: any`; and when `triggers.get(diceType)` (from `addSFXTrigger`) lists that exact label among its `results`, it matches a die whose face label (`faces.labels[i].text`) equals it — carried as `result: {kind: 'label', label}`, an extra kind used only for module rules. Unknown values warn once and are dropped.
  - `effectiveRules({world, roller, module}) -> Rule[]`: enabled rules, world first, then the roller's, then module rules.

- [ ] **Step 1: Failing tests** covering: each result kind; die `any`/type/dsnType; formula substring and regex; outcome null vs specific; d100 max/min; every `normalizeRule` rejection (Review Focus 4) with one warning each; `dsnDefaultsToRules` with the daggerheart-shaped entry `{diceType: 'daggerheart-duality-trigger', onResult: ['critical'], specialEffect: 'PlayAnimationConvergence'}`; a bad `onResult` warns once; `effectiveRules` drops disabled rules and keeps order.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(effects): trigger rule engine`.

---

### Task 6: Roll context — outcome, role, damage type

**Files:**

- Create: `src/effects/roll-context.js`
- Test: `tests/unit/roll-context.test.js` (fixtures shaped like PF2e 8.7 and dnd5e 6.0 rolls, built with `tests/unit/foundry-roll.js`)

**Interfaces:**

- Produces:
  - `outcomeOf(roll, message?) -> Outcome | null`:
    - PF2e: `roll.options.degreeOfSuccess` 0/1/2/3 → `critical-failure`/`failure`/`success`/`critical-success`; else `message.flags.pf2e.context.outcome` (`criticalFailure`, `failure`, `success`, `criticalSuccess`).
    - dnd5e: `roll.isCritical === true` → `critical-success`; `roll.isFumble === true` → `critical-failure`; else `roll.isSuccess` / `roll.isFailure` when they are booleans; a damage roll with `roll.options.isCritical` → `critical-success`.
    - Otherwise null. Property reads are guarded (getters may throw).
  - `roleOf(message?) -> string | null`: PF2e `flags.pf2e.context.type` — `attack-roll` → `attack`, `damage-roll` → `damage`, `saving-throw` → `save`, `skill-check` → `skill`, `perception-check` → `perception`, `initiative` → `initiative`, `flat-check` → `flat`, other strings → as is; dnd5e `flags.dnd5e.roll.type` (`attack`, `damage`, `save`, `skill`, `ability`, `tool`, `initiative`, `death`) → as is. Null otherwise.
  - `damageTypesByTerm(roll, knownTypes: Set<string>) -> WeakMap<DiceTerm, string>`: walks the roll tree (`terms`, nested `rolls`, `roll`, depth ≤ 32). The nearest ancestor that names a type wins: a PF2e `DamageInstance` (`.type` string, not `untyped`), a dnd5e roll's `options.type`, or a term whose `flavor` / `options.flavor`, lowercased and split on `,` and spaces, contains a known type.
  - `KNOWN_DAMAGE_TYPES`: the union of the PF2e and dnd5e lists in Task 11, plus `healing`. Callers pass `knownTypes` = this set ∪ the keys of `registry.damageTypeDefaults` ∪ the keys of the world `damageTypeMap`, so another system's types (G8 "other systems") are detected once registered or mapped.

- [ ] **Step 1: Failing tests:** PF2e check with degree 3 and with only the message flag; PF2e damage roll with two instances (`2d6 fire + 1d4 cold`) maps each die to its type; persistent bleed; dnd5e attack crit and fumble; dnd5e damage roll `options.type: 'radiant'`; flavor `"2d6[fire]"`; getters that throw; unknown systems give nulls.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(effects): read outcome, role and damage type from rolls`.

---

### Task 7: Effects decided at plan time (privacy-first)

**Files:**

- Create: `src/effects/fx-resolver.js`
- Modify: `src/main.js` (compose `decorateFor`), `src/throw/throw-planner.js` (DieSpec typedef), `src/throw/dice-box.js` (copy `fx` onto the die; `onLandedFx`), `src/settings.js`, `lang/en.json`
- Test: `tests/unit/fx-resolver.test.js`, `tests/unit/message-gate.test.js`, `tests/unit/dice3d.test.js`, `tests/unit/sync.test.js`

**Interfaces:**

- Consumes: Tasks 5 and 6.
- Produces:
  - `createFxResolver({getWorldRules, getUserRules(userId), getModuleRules, currentUser, getSetting, warn}) -> { decorate(message, roll, authorId) -> (term, result, termIndex) => {fx?: Fx[], damageType?: string} }`. It builds the per-roll context once (outcome, role, formula `roll.formula`, actor id `message.speaker.actor` or the term's `options.dsnActorId`, roller id `message.author.id` or `authorId`, damage type map) and matches every effective rule per die. Returns nothing when `effects` is off, or when the roller is someone else and `showOthersEffects` is off.
  - `Fx = {ruleId, effect, sound, macro, slowMotion: boolean}`. `slowMotion` is true when the effect id is `celebrate` or `fumble` or the effect asks for it, and the `slowMotion` setting is on.
  - `main.js`: `decorateFor(message, roll, authorId)` merges the look resolver's partial spec with the fx resolver's (fx resolver last; it never overrides look fields). Because the gate and `showForRoll` already use `ghostDecorator` for ghost views and skip `none`, `fx` exists only on `real` dice. Add a test that pins this, since it is the privacy guarantee.
  - `DieSpec` gains `fx?: Fx[]` and `damageType?: string`.
  - A d100 result decorates both of its dice (tens and ones); its `fx` plays only on the ones die (the one without `variant: 'd100tens'`), so one result never fires twice.
  - DiceBox: `makeDie` copies `fx`; at landing, for each die with `fx`, calls option `onLandedFx(die, fx)` (Task 8 plays effects there; this task plays only `sound` via the engine's `result`). A roll whose specs include any `slowMotion` fx sets the playback speed ramp (Task 8 implements the ramp; this task sets `roll.slowMotion = true`).
  - Macros: `onLandedFx` runs `fromUuid(macro).execute({dicer: {value, type, ruleId}})` only when the current user is the roller, `triggerMacros` is on, and at most once per rule per roll. A failing macro warns once.
  - Settings: `effects` (client, true), `showOthersEffects` (client, true), `slowMotion` (client, true), `triggerMacros` (world, true), `worldTriggers` (world, Array, `config: false`, default `DEFAULT_RULES`). User rules live in the user flag `dicer.triggers` (Array).

- [ ] **Step 1: Failing tests:**
  - `fx-resolver.test.js`: nat 20 on a d20 → `fx[0].effect.id === 'celebrate'`; a d20 rolling 19 → no fx; other roller with `showOthersEffects` off → none; `effects` off → none; a user rule only applies to that user's rolls; a malformed user flag is ignored with one warning.
  - Privacy (Review Focus 1), in `message-gate.test.js` with a nat-20 roll: blind message seen by a player → specs carry no `fx` and no `damageType`; whispered to someone else → nothing thrown; `roll.ghost` → ghost specs without `fx`; secret → none; GM viewing the blind roll → `fx` present.
  - `dice3d.test.js`: `showForRoll` with `blind` for a non-GM → no `fx`; `sync.test.js`: a receiver whose view is ghost gets no `fx`, and one whose view is real does (the outcome comes from `roll.options`, no message).
  - `dice-box.test.js`: landing a die with an fx sound calls `result` once; a ghost die never calls it.
  - Macro: runs once for the roller, never for another viewer, never with `triggerMacros` off.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(effects): resolve trigger effects per die for real views only`.

---

### Task 8: The effect runtime

**Files:**

- Create: `src/effects/effect-layer.js`, `src/effects/library/index.js` (lazy chunk `effects`), `src/effects/library/die-effects.js`
- Modify: `src/throw/dice-box.js`, `src/throw/playback.js`, `src/render/shaders/bodies.js`, `src/render/dice-material.js`, `src/render/quality.js`, `src/settings.js`, `tests/unit/build.test.js`
- Test: `tests/unit/effect-layer.test.js`, `tests/unit/dice-box.test.js`, `tests/unit/playback.test.js`, `tests/unit/dice-material.test.js`, `tests/unit/quality.test.js`

**Interfaces:**

- Produces:
  - `quality.js`: each `TIERS[name]` gains `particleScale` and `effectBudget`: low `0.25 / 2`, medium `0.5 / 4`, high `1 / 8`, ultra `1.5 / 12`. `flagsFor` adds `effects: settings.effects !== false && !safe`.
  - Effect module contract (every library entry): `{id, cost: number, defaults: {color, intensity, duration}, start(ctx) -> {update(nowMs) -> boolean, stop()}}`. `ctx = {scene, camera, die, position: Vector3, color: Color, intensity, duration, particles, isolate(die) -> uniforms, shake(amount, ms), tier}`.
  - `createEffectLayer({scene, camera, canvas, getTier, getSetting, loadLibrary = () => import('./library/index.js'), warn}) -> EffectLayer`:
    - `play(die, fx) -> void`: starts each fx effect if the library is loaded (otherwise skips it with one debug log: the prefetch after `ready` normally beats the first roll). Effects whose summed `cost` would exceed `tier.effectBudget` this frame are dropped, cheapest kept, in rule order. `PLAY_ONLY_ONCE_PER_MESH` is honoured by DSN effects (Task 10).
    - `update(nowMs) -> boolean`: advances every running effect; true while any runs.
    - `releaseDie(die)`: stops effects bound to a die being removed.
    - `clear()`, `dispose()`, `prefetch() -> Promise<void>`.
  - Die-level `fx` uniform block in `bodies.js`, compiled when `flags.effects` (program key segment `fx1`, else `fx0`): `uFxTint` (vec4: rgb + mix), `uFxFlare` (vec3 colour × strength, added to the numbers' emissive through `dcMask`). Defaults are zero, so a die with no running effect looks unchanged.
  - `isolate(die)`: gives the die its own material clone with its own `userData.uniforms` copies (unlike `cloneForFade`, which shares them); released at `#finish` with the die. Only dice with a running die effect are isolated.
  - `die-effects.js`: `color-shift` (cost 1; tint toward `color`, ease in 150 ms, hold, ease out), `number-flare` (cost 1; flare pulse), `glow-pulse` (cost 1; a back-face additive fresnel shell around the die, scale 1.08, pulsing `1 + 0.5 sin`).
  - Screen shake: `shake(amount, ms)` CSS-translates the dice canvas only (camera untouched, the Foundry board untouched), amplitude ≤ 6 px × intensity, damped; skipped when `screenShake` (client, true) is off or `prefers-reduced-motion` is set.
  - Slow motion: `Playback.setSpeedRamp({fromStep, toSpeed = 0.35})`: the speed eases from 1 to `toSpeed` over the 30 steps before `fromStep` and holds until landing. DiceBox calls it when the final chunk arrives with `fromStep = settledStep - 30`, if `roll.slowMotion`. The landing watchdog's duration accounts for the slower speed.
  - DiceBox: `onLandedFx` (Task 7) also calls `effectLayer.play(die, fx)`; `#frame` returns `true` while `effectLayer.update(now)` is true, so the loop outlives the dice only as long as effects run; `#finish` calls `releaseDie`; `clear()` calls `effectLayer.clear()`.
  - Settings: `screenShake` (client, true). `effects` from Task 7 also refreshes materials (program key) through `onLookChange`.

- [ ] **Step 1: Failing tests:**
  - `effect-layer.test.js`: budget (Review Focus 2) — 30 dice each with a cost-1 effect on `low` → at most 2 start; `update` false once all durations pass; `clear()` stops all; unloaded library → nothing starts, no throw.
  - `dice-box.test.js`: the loop stays alive past the roll's `finished` while an effect runs, and stops (`renderer.hide`) after it ends; `clear()` mid-effect stops the loop; `diceSoNiceRollComplete` timing is unchanged (landing still resolves `landed` at landing).
  - `dice-material.test.js`: `flags.effects` false → no `uFxTint` in the shader and key `fx0`; true → present, defaults zero; an isolated clone's uniforms are not shared with the original.
  - `playback.test.js`: with a ramp, the playhead advances at ~0.35× in the held range and the landing frame is still reached.
  - `quality.test.js`: the new tier fields.
  - `build.test.js`: `effects-*.js` chunk lazy.
- [ ] **Step 2–4:** run, implement, pass; full suite and build.
- [ ] **Step 5: Commit** `feat(effects): effect runtime, die effects, shake and slow motion`.

---

### Task 9: Particle pool and the effect catalogue

**Files:**

- Create: `src/effects/library/particles.js`, `src/effects/library/catalogue.js`
- Modify: `src/effects/library/index.js`
- Test: `tests/unit/particles.test.js`, `tests/unit/catalogue.test.js`

**Interfaces:**

- Produces:
  - `createParticlePool(scene, capacity) -> {emit(spec) -> void, update(nowMs) -> boolean, dispose()}`. One `THREE.Points` with a `ShaderMaterial` (additive and normal blend variants: two draws at most). Per-particle attributes: `aOrigin`, `aVelocity`, `aBirth`, `aLife`, `aColor`, `aSize`, `aKind`. Motion is computed in the vertex shader (`origin + v t + ½ g t²`, drag per kind); the CPU only writes newly emitted ranges (`updateRange`), never every particle per frame. Capacity = `round(2048 × tier.particleScale)`; a full pool overwrites the oldest particles. `spec = {count, origin, speed, spread, gravity, life, color, size, kind}`.
  - `catalogue.js` exports these effects (each with `cost` and `defaults`), built from the pool, small meshes and die effects:

    | id                                          | Does                                                                                   | cost |
    | ------------------------------------------- | -------------------------------------------------------------------------------------- | ---- |
    | `glow-pulse`, `color-shift`, `number-flare` | from Task 8                                                                            | 1    |
    | `light-burst`                               | additive billboard flash, scale up, fade                                               | 1    |
    | `sparkles`                                  | glitter particles spiralling up                                                        | 2    |
    | `embers`                                    | rising embers with flicker (the flame)                                                 | 2    |
    | `frost`                                     | crystalline shards plus a radial crack decal on the floor plane                        | 2    |
    | `lightning`                                 | 2–3 jagged arcs from the die (line segments regenerated every 60 ms)                   | 2    |
    | `smoke`                                     | soft grey puff, normal blending                                                        | 2    |
    | `shatter`                                   | shards burst outward with gravity, the die hidden for the duration                     | 3    |
    | `shockwave`                                 | expanding ring on the floor plane (shader ring quad)                                   | 1    |
    | `shake`                                     | screen shake only                                                                      | 0    |
    | `celebrate`                                 | `light-burst` + `sparkles` + `number-flare` + `shockwave` + small `shake`, slow motion | 4    |
    | `fumble`                                    | `smoke` + `color-shift` (dark grey) + a tiny downward `shake`, slow motion             | 3    |

  - Every effect obeys `color`, `intensity` (scales count, size and brightness) and `duration`. Composite costs are the sum of what actually starts.

- [ ] **Step 1: Failing tests:**
  - `particles.test.js`: emitting beyond capacity overwrites oldest; `update` false after the longest life; only the emitted range is marked for upload; capacity follows `particleScale`.
  - `catalogue.test.js`: every id exists with `cost` and `defaults`; each `start()` on a real three.js scene (no WebGL needed) returns a handle whose `update` turns false after `duration` and whose `stop()` removes every object it added (scene child count back to baseline: no leaks across 100 plays, G2 "500 rolls stable").
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(effects): GPU particle pool and the effect catalogue`.

---

### Task 10: DSN special effects (`addSFXMode`, `addSFXDefaults`, `DiceSFX`)

**Files:**

- Create: `src/effects/dsn-sfx.js`
- Modify: `src/effects/effect-layer.js`, `src/compat/registry.js` (name field per the deferred note), `src/main.js`
- Test: `tests/unit/dsn-sfx.test.js`, `tests/unit/registry.test.js`

**Interfaces:**

- Produces:
  - `SFX_TIMEOUT_MS = 10000`, `SFX_INIT_TIMEOUT_MS = 5000`.
  - `createDsnSfx({registry, getBox, warn}) -> {effectFor(id) -> EffectModule | null}`. For `dsn:<id>`, returns an effect module (cost 2) whose `start` runs, once per class, `await cls.init()` (capped at `SFX_INIT_TIMEOUT_MS`; a rejection disables the class with one warning), then `new cls(box, dicemesh, options)` and `play()`. The handle's `update` is true until `play()` settles or `SFX_TIMEOUT_MS` passes; `stop()` calls `destroy?.()` once, guarded.
  - `box` compat object (the members the surveyed SFX touch): `{scene, camera, renderer: glRenderer, renderScene() {/* request a frame */}, dicer: true}`. `dicemesh` is the die's `outer` Object3D with `result` (the value) and `type` set. `options` are the rule's effect options.
  - `PLAY_ONLY_ONCE_PER_MESH`: a class that sets it plays at most once per die per roll even when several rules match.
  - Registry: `addSFXMode` name = `specialEffectName` if a string, else `id`. Module rules from `addSFXDefaults` reach `effectiveRules` through `getModuleRules = () => dsnDefaultsToRules(registry.getSFXDefaults(), registry.sfxTriggers, warn)`, recomputed on `registry.onChange`.
  - The effect layer asks `dsnSfx.effectFor(id)` for `dsn:`-prefixed ids.

- [ ] **Step 1: Failing tests** (Review Focus 5): a class whose `play` resolves → `destroy` called once, layer idle afterwards; `play` throws → one warning, `destroy` called, layer idle; `play` never resolves → handle ends at `SFX_TIMEOUT_MS` (fake timers) and `destroy` is called; `init` rejects → class disabled, one warning, later plays skipped; `PLAY_ONLY_ONCE_PER_MESH`; registry name field; a daggerheart-shaped `addSFXDefaults` entry produces a module rule that matches a die with `dsnType: 'daggerheart-duality-trigger'` and a `critical` outcome.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(compat): run DSN special effects through the rule system`.

---

### Task 11: Damage themes

**Files:**

- Create: `src/effects/damage-themes.js`
- Modify: `src/compat/resolve-looks.js`, `src/effects/fx-resolver.js`, `src/main.js`, `src/settings.js`, `lang/en.json`
- Test: `tests/unit/damage-themes.test.js`, `tests/unit/resolve-looks.test.js`, `tests/unit/fx-resolver.test.js`

**Interfaces:**

- Produces:
  - `DAMAGE_THEMES`: frozen map of 13 themes, each `{id, appearance (a full Dicer appearance), soundMaterial, landing: {effect, sound} | null}`. Ids and intent (visual tuning is the builder's call, reviewed on the dev page):

    | id            | Look                                       | Impact  | Landing                |
    | ------------- | ------------------------------------------ | ------- | ---------------------- |
    | `fire`        | resin, ember interior, orange glow numbers | glass   | `embers`, `crackle`    |
    | `cold`        | clear resin, frost-white interior          | glass   | `frost`                |
    | `acid`        | resin, green liquid core                   | glass   | `smoke` (green)        |
    | `electricity` | resin, nebula blue-violet, glowing numbers | glass   | `lightning`, `zap`     |
    | `sonic`       | pearl, pale gold                           | plastic | `shockwave`            |
    | `poison`      | opaque deep green, silver numbers          | plastic | `smoke` (sickly green) |
    | `force`       | resin, violet swirl                        | glass   | `glow-pulse`           |
    | `vitality`    | pearl white, gold numbers, warm glow       | plastic | `light-burst` (gold)   |
    | `void`        | opaque black, violet glow numbers          | stone   | `smoke` (black)        |
    | `mental`      | resin, pink nebula                         | glass   | `glow-pulse` (pink)    |
    | `bleed`       | resin, dark red liquid                     | glass   | none                   |
    | `spirit`      | resin, pale cyan swirl                     | glass   | `glow-pulse` (cyan)    |
    | `physical`    | metal, antique steel                       | metal   | none                   |

  - `DEFAULT_DAMAGE_MAP`: PF2e `acid, bludgeoning→physical, cold, electricity, fire, force, mental, piercing→physical, poison, slashing→physical, sonic, spirit, vitality, void, bleed`; dnd5e `lightning→electricity, thunder→sonic, radiant→vitality, necrotic→void, psychic→mental, healing→vitality` (shared names map to themselves). `untyped` is unmapped.
  - `resolveDamageTheme(type, {userOverrides, worldMap, moduleDefaults, registry, index}) -> {appearance, soundMaterial?, landing?} | null`. Order: user override (`'none'` disables) → world map → `registry.damageTypeDefaults` (DSN `addDamageTypeDefaults`, colorset names) → `DEFAULT_DAMAGE_MAP`. A value that names a `DAMAGE_THEMES` id gives the full theme; any other value is treated as a colorset name (look only, via `colorsetNameToAppearance`); an unknown name warns once and gives null.
  - Look chain (`resolve-looks.js`): explicit `options.appearance` → `options.colorset` → flavor colorset → **damage theme** → actor flag → user looks → default. The resolver gets `damageThemeFor(term) -> theme | null` (from `damageTypesByTerm`, Task 6) when `damagePresets` is on. The spec carries `soundMaterial` from the theme.
  - The theme's `landing` becomes an extra `Fx` (`ruleId: 'damage:<id>'`) on every die of that type, added by the fx resolver under the same real-view-only and `effects` gates.
  - Settings: `damagePresets` (client, true), `damageTypeMap` (world, Object, `config: false`, `{}`), `damageThemeOverrides` (client, Object, `config: false`, `{}`).

- [ ] **Step 1: Failing tests:** each default mapping for both systems; override `'none'`; world map to a colorset name gives look only; `addDamageTypeDefaults({fire: 'Ember Colorset'})` beats the built-in map but loses to the world map; explicit `options.colorset` beats the theme; `damagePresets` off → no theme; a PF2e `2d6 fire + 1d4 cold` roll gives fire looks to the d6s and cold to the d4; landing fx absent for ghost views.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(effects): PF2e and dnd5e damage themes`.

---

### Task 12: The trigger editor

**Files:**

- Create: `src/ui/trigger-editor.js` (lazy chunk), `templates/trigger-editor.hbs`, `styles/dicer.css` additions
- Modify: `src/settings.js` (settings menu), `lang/en.json`, `module.json` (nothing new unless templates need listing — they are loaded with `foundry.applications.handlebars.loadTemplates`), `tests/unit/build.test.js`
- Test: `tests/unit/trigger-editor.test.js` (jsdom)

**Interfaces:**

- Produces:
  - `class TriggerEditor extends HandlebarsApplicationMixin(ApplicationV2)`, `id: 'dicer-trigger-editor'`, opened from a settings menu `dicer.triggerEditor` (`game.settings.registerMenu`, client-visible; the World tab is read-only for players).
  - Two tabs: **World** (GM edits `worldTriggers`; includes the two defaults and any module rules, which can be disabled but not edited) and **Mine** (the user's `dicer.triggers` flag).
  - Per rule: enabled toggle, name, die (select: `any`, the standard types, registered DSN types and `addSFXTrigger` ids), result (kind + value/range; label choices when the die is an `addSFXTrigger` id), context fields, outcome, effect (select from the catalogue and `dsn:` modes, then colour, intensity, duration), sound (none / built-in select / file via `FilePicker`, volume), macro (UUID field accepting a dropped Macro). Buttons: add, duplicate, delete, move up/down, **Preview** (plays the effect and sound on a local test die, nothing broadcast), Reset to defaults (World).
  - Saving runs every rule through `normalizeRule`; an invalid rule is highlighted and not saved.
  - Pure helpers exported for tests: `rulesFromForm(formData) -> Rule[]`, `formFromRules(rules) -> object`.

- [ ] **Step 1: Failing tests:** `rulesFromForm(formFromRules(DEFAULT_RULES))` round-trips; an invalid regex is reported and not saved; a player cannot save the World tab (save handler refuses when `!game.user.isGM`); module rules keep `source: 'module'` and only `enabled` changes.
- [ ] **Step 2–4:** run, implement, pass; build; lazy list updated.
- [ ] **Step 5: Commit** `feat(ui): trigger editor`.

---

### Task 13: The damage map editor

**Files:**

- Create: `src/ui/damage-map-editor.js` (lazy chunk), `templates/damage-map-editor.hbs`
- Modify: `src/settings.js`, `lang/en.json`, `tests/unit/build.test.js`
- Test: `tests/unit/damage-map-editor.test.js` (jsdom)

**Interfaces:**

- Produces: `class DamageMapEditor` (ApplicationV2), menu `dicer.damageMap`. One row per known damage type (the active system's types first): the GM's world choice (built-in theme / DSN colorset / default) and the user's own override (default / theme / colorset / none). A **Preview** button throws one die of that type locally. Each row also takes an optional custom landing sound file (GM: world setting `damageTypeSounds`, world Object, `config: false`, `{}`; it replaces the theme's built-in landing sound, G9 "custom sounds"). Pure helpers `mapFromForm`, `formFromMap`.

- [ ] **Step 1: Failing tests:** round-trip; a `damageTypeSounds` entry replaces the theme's landing sound in the fx resolver; choosing "default" removes the key (so built-in and `addDamageTypeDefaults` still apply); a player's save writes only `damageThemeOverrides`.
- [ ] **Step 2–4:** run, implement, pass; build; lazy list updated.
- [ ] **Step 5: Commit** `feat(ui): damage map editor`.

---

### Task 14: Review page, live checks and docs

**Files:**

- Create: `dev/effects.html`, `dev/effects.js`, `tests/live/effects.mjs`
- Modify: `docs/live-checks.md`, `README.md`, `package.json` (`test:live:effects`)

**Interfaces:**

- `dev/effects.html` (run with `npm run dev`): a d20 on the studio scene with buttons for every catalogue effect, every damage theme (look + landing), every material × surface impact and every result sound, plus a tier select. This is the owner's sign-off surface for the look and sound of Plan 4.
- `tests/live/effects.mjs` (owner-run, same env vars as `compat.mjs`): rolls a forced nat 20 as GM; asserts the GM client logs a `celebrate` play and a `fanfare` result sound (through a debug counter on `game.dice3d._debug`), and the player client logs neither for a blind version of the same roll; a public version gives the player both when `showOthersEffects` is on.
- `docs/live-checks.md`: add sound unlock on first click, the unfocused quieting, a PF2e fire strike showing ember dice, a dnd5e radiant damage roll, a 30d6 roll with a "6 → sparks" rule watched for stutter, and a reduced-motion OS setting suppressing shake.
- `README.md`: Sounds, Effects and triggers, Damage themes sections; DSN SFX compatibility row (works through `game.dice3d`; path imports of DSN's `api.js` remain the documented gap).

- [ ] **Step 1:** build the dev page and confirm it runs (`npm run dev`, open `/dev/effects.html`, no console errors); screenshot to `docs/signoff/plan-4/effects.png`.
- [ ] **Step 2:** write the live test; run `node --check tests/live/effects.mjs`.
- [ ] **Step 3:** docs.
- [ ] **Step 4:** full suite, lint, build, and the build budget test.
- [ ] **Step 5: Commit** `docs: effects review page, live checks and README for Plan 4`.

---

## Not in this plan

- Themes that bundle look + sound set + effects set (G5) are Plan 5; this plan's sound and effect pieces are what those themes will reference.
- Same-throw-on-every-screen sync (v2): impact timings differ per client because each client simulates its own throw.
- Effects for hand rolls (Plan 6) reuse this runtime unchanged.
