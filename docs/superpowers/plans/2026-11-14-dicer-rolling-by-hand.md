# Dicer Rolling by Hand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Refreshes** `2026-11-11-dicer-plan-6-hand-rolling.md` against `main` at `d9c8319`. That plan's design calls P6-D1..P6-D6 are owner-accepted and stay. Where this plan refines one, it says so. Audit notes: `.superpowers/hand-rolling-refresh-notes.md`.

**Goal:** A player grabs the dice, shakes and flicks them. The face that physically lands up is the roll result, fed to Foundry as a dice fulfillment method, so every system's rolls work unchanged. Every screen allowed to see the result replays that exact throw, including any pet it splats, before the chat card appears. A dice tray lets anyone roll freely.

**Architecture:**
- **The physics decides.** A throw marked `free` is never face-forced.
  - The worker nudges cocked dice and dice outside the area until each die reads cleanly. It gets every shape's face normals with `INIT`, the way it gets hulls.
  - Playback streams free dice without holding them at the area edge, and reads each die's result from its settled pose.
- **Foundry asks, Dicer throws.**
  - A small world-start shell registers the fulfillment method `dicer` with a `DicerResolver`.
  - The resolver's body is in the lazy `hand` chunk: it plans the dice with the author's look, opens the throw overlay, and writes the read results into the terms.
- **The thrower is authoritative.**
  - Its DiceBox records the free throw.
  - Once its chat message exists, the lazy chunk encodes the trajectory and the pet obstacles and sends them only to users whose view is `real`.
  - Their message gate holds the card, replays the frames through DiceBox (no physics), aligns their pets to the recorded layout, then reveals.

**Tech Stack:** Plain JS ES modules, three.js 0.184, Rapier3D deterministic (worker), Foundry v14 dice fulfillment (`CONFIG.Dice.fulfillment`, `foundry.applications.dice.RollResolver`, core client setting `diceConfiguration`), ApplicationV2, Vite 6 lazy chunks, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md`: G10, with G1 (privacy, hooks), G2 (size, idle) and §5 Physics. The pet specs `2026-11-13-dicer-pet-splat-design.md` and `2026-11-14-dicer-pet-dodge-design.md` define the pet behaviour this plan extends.

**Foundry facts this plan relies on** (re-read from the installed v14 client on 2026-11-13):
- `Roll#_evaluate` makes `new resolverImplementation(this)` and awaits `awaitFulfillment()`, unless any of these hold: `allowInteractive === false`, `minimize`, `maximize`, or `_root` is set.
- `resolverImplementation` uses a method's `resolver` only when the user's interactive methods, not counting `manual`, are exactly that one method.
- `RollResolver#close()` fills dice only **if the app is rendered**.
- An unfilled term is rolled through `resolver.resolveResult(term, method, options)`, once per missing die. Explode and reroll go through the same call.
- Terms without `_id` (dynamic or intermediate) reach `resolver.addTerm(term)`.
- `toMessage` evaluates with `allowInteractive: messageMode !== "blind"`.
- The per-die denominations are `d4 d6 d8 d10 d12 d20 d100 c f`. Others follow `default`.

## What changed since the 2026-11-11 plan

- **Shapes.**
  - There are now 16 designs on 10 shapes: d2 coin, d4, `d4crystal` (`readFaces`, `labelUp`), d6, d8, d10, d12, d14, d16, d20.
  - Relabel variants are `dF`/`d3` on d6, `d5` on d10, `d7` on d14, and the coin `dc`. `resultOf(value, variant)` maps a face back to the Foundry result.
  - `die.type` carries the value and `die.shapeType` the geometry, hull, reader and labels.
  - **The d16 has no single "most-up" face** when it rests flat (the gap is 0.000). Task 1 reads it from below.
- **The worker** has pet obstacles: `THROW.obstacles` ≤ 3, impact code `other = -3 - i`, and `splatSpeed`, which removes a splatted pet's collider. The worker never imports three.js or the shape table.
- **DiceBox:**
  - `roll(specs, {area, capacityDice, pet})`.
  - The hook calls `obstaclesFor` / `hit` / `areaChanged` / `userGone`, the pet's `begin(edge from throwEdge(seed))`, and `update()` returning `true` / `'rest'` / `false` (the held loop).
  - `#finish` recycles chunk buffers to the worker.
  - Assets (image faces, models) delay playback up to `ASSET_WAIT_MS`.
- **Pets** (lazy `pet-*` chunk):
  - They rest in their owner's area, splat and reform, dodge the cursor, and leave after `petStay`.
  - The obstacle id is the owner's user id.
  - Rest spots are chosen per screen (`Math.random`, UI rects).
- **Per-player areas:** `createAreaResolver().rectFor({rollerId, gmPrivate})` returns the roller's area on every viewer (P5-D1). Areas are screen fractions, so die-unit sizes differ per screen.
- **Message gate:** `throwGroups` throws per rollOrder group, one spec list per roll, with a 15 s watchdog per group, `entry.own`, `petOf(message, view)`, and `areaOf(message, group)`.
- **Privacy:** `viewFor` returns `real` / `ghost` / `none`. `dice3d.recipientsFor` lives inside the API closure. `compat/sync.js` accepts only `kind: 'show'`.
- **FX engine:** result-dependent `fx` and `damageType` are on real specs only, with slow motion, screen shake (a CSS translate of the canvas), impact dust and sound recipes.
- **Customization and hardening:**
  - Looks come from `decorateFor(message, roll, authorId, rollerId)`.
  - Bench scenarios are in `src/bench/scenarios.js`, with a DSN head-to-head and `soak500`.
  - World start is measured by the ratchet in `tests/unit/build.test.js`.
- **Foundry corrections:**
  - The resolver's `close()` fallback only works when the app is rendered. With Dicer's unrendered resolver, the fallback is `resolveResult` returning `undefined`.
  - `addTerm` must be overridden.
  - Fate (`f`) is a fulfillment denomination.
- **Size:** world start is 4,103,020 B today (headroom 91,284 B), and the ratchet base is 4,102,587 (+433 of 512 used).

## Design calls (owner can overturn)

Kept: P6-D1 (blind sheet rolls are never thrown by hand), P6-D2 (trajectory after the message exists), P6-D3 (extras thrown automatically), P6-D4 (hand rolls off by default, GM allows all), P6-D6 (the fairness script stays separate from the suite). Refined: P6-D5 (see H-11).

- **H-1 The d16 is read from below.**
  - Its result is the top kite paired with the face on the table, using `buildTrapezohedron`'s existing pairing (top kite `k` ↔ bottom kite `(k + 3) mod 8`). That is a bijection, so it is fair if the faces are.
  - After landing, the result face gets a short highlight (`RESULT_GLOW_MS = 600`) so players know which of the two top numbers counts.
  - Cost if wrong: the d16 is excluded from hand rolls instead.
- **H-2 Cocked means "below half the shape's own flat gap".** A die is cocked when `topFaceClearance(shape, q) < COCKED_FRACTION × flatGap(shape)`, with `COCKED_FRACTION = 0.5`. A coin is cocked when the `|y|` of its cap normal is below `0.5`.
- **H-3 Every variant reads through the face value.**
  - `readResult(shape, q, variant)` returns `resultOf(shape.values[face], variant)`.
  - A d100 is its two d10s combined: tens `(v mod 10) × 10`, ones `v mod 10`, and `0 + 0` is 100.
  - A preset alias whose thrown shape's face count is not the term's (and is not a relabel) cannot be read physically. Those dice are not thrown by hand and take Foundry's random result (H-15).
- **H-4 Models and image faces read the hull's pose.** The collider is always Dicer's hull for `shapeType`, and a model is drawn with its verified rotation. Reading uses the hull, so a model never changes a result.
- **H-5 Pets are obstacles in a hand throw, exactly as in an automatic one.**
  - At release, DiceBox asks `obstaclesFor` with a **hand edge**: the side of the area the release point is nearest to.
  - The pet never does its throw pose in a hand throw (`begin` info `hand: true`). It watches from its resting spot, or hops in at the hand edge when it does not rest.
- **H-6 Receivers adopt the thrower's pet layout, so a splat is shared.**
  - The trajectory carries the obstacles (`{id, x, z, r, h}`, relative to the area centre) and the splat speed used.
  - Before the replay starts, the receiver's pet layer moves each listed pet to its recorded spot, transformed like the dice. A listed pet not standing here is placed there at rest.
  - An unlisted standing pet whose footprint any recorded die path crosses hops to a spot the paths clear.
  - The recorded `-3 - i` impacts then call `hit(id)` on the receiver, so the same pet splats on every screen that replays.
  - With `showPets` or `petsAllowed` off on a receiver, nothing is placed, and dice bounce off empty air there.
  - Cost if wrong: splats are shared as a state only.
- **H-7 Ghost and none viewers learn nothing about a hand throw.**
  - They get the usual ghost throw, or nothing.
  - Their pets are not moved, and no splat is sent to them: a splat would reveal that a hidden roll happened.
- **H-8 Pets freeze while dice are held.** While the overlay holds dice, pets neither dodge the cursor nor leave when idle (`deps.holding()`). A player can aim at a pet, which is the splat toy the owner wanted. Dodging resumes on release, then pauses again while the throw is in flight, as today.
- **H-9 The thrower's result effects play when its chat message exists.**
  - fx, result sounds, damage-type effects and dice events need the finished roll (and pf2e context in message flags).
  - So the thrower's own gate path decorates the dice still lingering from the throw, through `DiceBox.decorateLanded(handle, specs)`, and plays their landed effects then.
  - If they have already faded, nothing plays.
  - The thrower gets no slow motion. Impacts and dust play live as usual.
- **H-10 Receivers replay every recorded die.**
  - A recorded die is keyed `[term, result, part]`. The replay's specs come from the receiver's own plan by key (its looks, fx, damage type). A recorded die missing from that plan (discarded with `showExtraDice` off, or past its `maxDice`) is replayed with a look-only spec.
  - Recorded dice collide with each other, so the receiver's `maxDice` does not drop any.
  - Explosion and reroll extras that the receiver's plan has beyond the recording follow as a normal forced throw after the replay lands.
- **H-11 (refines P6-D5) The replay is scaled uniformly.**
  - Positions relative to the area centre are scaled by `s = min(1, rw/tw, rd/td)` on both horizontal axes. Here `rw` and `rd` are the receiver area's half extents and `tw` and `td` the thrower's.
  - The scale is floored at `MIN_REPLAY_SCALE = 0.6`. Below that the replay keeps `0.6` and may overrun the receiver's area, clamped to the stage.
  - Dice keep their size. Pet spots use the same transform.
- **H-12 The overlay is confined to the roller's area.** Held dice follow the pointer, but stop at the border of `areas.rectFor({rollerId: me})`, so a release never teleports. The pointer is mapped through the stage rect, never the canvas rect, so screen shake cannot move the aim.
- **H-13 A hand throw is at most `maxDice` dice.** Dice beyond it take Foundry's random result, and the card notes it (H-15).
- **H-14 The tray builds a real Roll from pre-filled terms.** It calls `new Roll(formula)`, pushes the read results into each DiceTerm, then `evaluate({allowInteractive: false})`. Foundry rolls nothing missing and computes modifiers and the total. The tray's throw is a normal hand throw: the user's pet watches, and resting pets are obstacles.
- **H-15 One flag records how each roll was resolved.**
  - `roll.options.dicerHand = {id, by, n, fallback?: 'timeout'|'cancel'|'auto', partial?: number}`.
  - `partial` counts dice that fell back (unreadable shape, over `maxDice`, dynamic term with no throw).
  - The chat mark reads it.
- **H-16 Receivers can opt out of replays.** New client setting `handReplay` (Boolean, default on). Off gives the normal forced animation of the real result.
- **H-17 A mixed interactive config is not handled in v1.** That is `dicer` plus another module's interactive method (Foundry then picks its generic resolver). The README notes it.
- **H-18 Re-shown hand rolls are not re-animated on the thrower.** When `showForRoll` re-shows a roll carrying a non-fallback `dicerHand` by this user, the thrower does not animate it again. Synchronized receivers get today's `show` payload: a forced throw of the real result, since trajectories are shared only for chat messages.
- **H-19 Rolls that look secret ghost on release.** When the roll carries `ghost`, `secret`, or `options.messageMode`/`rollMode` of blind or GM-only and Foundry still opened the resolver, the overlay throws with `ghostOnRelease`. This covers systems that evaluate before choosing the mode.
- **H-20 The hand chunk is fetched early.** It is prefetched at idle after `ready` when `handRollsAllowed !== 'none'`, like the pet chunk. It is never part of world start.

## Global Constraints

- **Branch and commits:** branch `rolling-by-hand`. Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge.
- **World-start budget (owner approval needed, see the notes' Q1):**
  - Task 3 re-bases the ratchet in `tests/unit/build.test.js` to the world start measured at that point (expected ≈ `4_103_020` plus Tasks 1–2).
  - This plan may add at most **12,288 bytes** over the 4,103,020 B measured today.
  - Per-task targets: T1 512, T2 2,048, T3 2,560, T5 128, T6 128, T7 2,560, T8 2,048, T9 256, T10 1,024. That is 11,264 B, plus a 1,024 B reserve.
  - Measure in the main checkout after `npm run build`, and report bytes per task.
  - Everything else goes in the lazy chunk `src/hand/chunk/*`, emitted as `dist/hand-XXXXXXXX.js` and added to `build/world-start.js` LAZY as `hand-[A-Za-z0-9_-]{8}\.js$`, like the pet chunk.
- **Unchanged without free:** a throw without `free`/`launch` gives byte-identical frames and events. The existing sim hash tests stay green, unchanged.
- **Physics decides (G10):** a free die is never rotated to a value. Its result is `readResult(shape, finalPose, variant)`.
- **Free throw limits:**

  | Constant | Value |
  | --- | --- |
  | `MAX_NUDGES` | 3 per die |
  | `NUDGE_STEPS` | 60 |
  | `MAX_FREE_STEPS` | 780 (13 s; under the pet `LIFE_MS` and `DONE_TIMEOUT_MS` of 15 s) |
  | `MAX_RELEASE_SPEED` | 40 die units/s |
  | `MAX_RELEASE_SPIN` | 30 rad/s |
  | Launch height | clamped to [1, 6] |
  | Launch over a pet capsule | lifted to `h + 1.2` |

  Nudges draw from `mulberry32(seed ^ 0x9e3779b9)`, so the main stream is untouched.
- **Privacy (G1):** a trajectory goes only to users whose view of the message is `real`:

  | Message | Recipients |
  | --- | --- |
  | public | everyone |
  | whisper | recipients + GMs |
  | blind | GMs |
  | any secret roll | GMs |
  | any ghost roll | nobody |

  Recipients never include the sender. A spoofed sender is rejected (P3-R15). A ghost or none viewer gets nothing about the throw, the pets or a splat.
- **Hooks:** `diceSoNiceRollComplete` fires exactly once per animated message on every client, including the thrower's immediate path and every fallback.
- **Timeouts:**

  | Constant | Value | Meaning |
  | --- | --- | --- |
  | `handRollTimeout` | default 60 s, 10–300 | the throw prompt, then Foundry's random result |
  | `HAND_REPLAY_WAIT_MS` | 4000 | a missing trajectory, then a forced animation |
  | `HAND_BUFFER_MS` | 30000 | an early payload is kept this long |

  A hand group's watchdog is `WATCHDOG_MS + HAND_REPLAY_WAIT_MS`.
- **Trajectory:**

  | Constant | Value |
  | --- | --- |
  | `TRAJ_STRIDE` | 2 (30 Hz) plus the final step |
  | Positions | int16 at 1/512 die unit, relative to the area centre |
  | Rotations | smallest-three, 2-bit index + 3 × int16 |
  | Final frame | raw float32 |
  | `MAX_TRAJECTORY_BYTES` | 262,144 encoded |
  | Decoded dice cap | 100 |

  A typical 10d6 encodes under 32 KiB.
- **Fairness (G10):** χ² over 10,000 throws per shape passes at p > 0.01 for d2, d4, d4crystal, d6, d8, d10, d12, d14, d16 and d20 (script). The relabel variants inherit their base shape's result.
- **Idle (G2):** nothing runs while no throw is in progress. The overlay removes all its DOM and listeners on close. A held loop stays held.
- **Settings (§5; each new feature has its own switch):**

  | Key | Scope | Type | Default | Notes |
  | --- | --- | --- | --- | --- |
  | `handRolls` | client | String `off`/`ask`/`always` | `off` | P6-D4 |
  | `handRollTypes` | client | Array of Foundry denominations, `config: false` | `[]` (all) | |
  | `handRollsAllowed` | world | String `all`/`trusted`/`gm`/`none` | `all` | |
  | `handRollsRequired` | world | Boolean | false | |
  | `handRollTimeout` | world | Number 10–300 | 60 | |
  | `handReplay` | client | Boolean | true | |
  | `diceTray` | client | Boolean | true | |

- **Defensive:** a malformed or oversized payload is ignored (one warning) and the receiver falls back. A throwing overlay, codec or pet call never fails a roll or blocks a reveal.
- **Tests:** `tests/unit/*.test.js`, run with `rtk proxy npx vitest run <file>`. Build with `node node_modules/vite/bin/vite.js build`. On Windows, write scripts to files (shell backslash mangling). Lint clean and full suite green at every commit.

## Review Focus

1. **A die that lands cocked, on its rim (coin), on a d16's ridge, or outside the area.** The nudge is in the frames every screen replays, and the read result is unambiguous. Tests in Tasks 1–2.
2. **The thrower times out, cancels, or the roll has dynamic or unreadable terms.** `resolveResult` returns `undefined`, so Foundry rolls random faces. The card says "rolled automatically" or "partly", nothing hangs, and RollComplete fires once. Tests in Task 7.
3. **A whispered, blind-to-GM or secret hand roll.** Only `real` viewers receive the trajectory. Others get a ghost throw or nothing, and their pets are never moved or splatted. Tests in Task 8.
4. **A trajectory that is late, missing, spoofed, oversized, or whose read results disagree with the message.** The receiver reveals after a forced animation within `HAND_REPLAY_WAIT_MS`. Tests in Task 8.
5. **A hand throw that splats a resting pet.** The pet splats on every replaying screen, at the same place relative to the dice. Its owner's next roll reforms it as today. Tests in Task 9.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/face-reader.js` | `topFaceClearance`, `flatGap`, `readFace`, `readResult` (d16 down-read). |
| `src/physics/hulls.js` | `computeReaders()`: per hull type normals, read set, mode, flat gap for `INIT`. |
| `src/physics/sim.js`, `protocol.js`, `physics-client.js`, `physics.worker.js` | Free throws, nudging, launch states. |
| `src/throw/playback.js` | Free dice: no hold at the edge, no forcing, read results. |
| `src/throw/dice-box.js` | `values`, `record`, `source` (replay), `hold()`, `decorateLanded()`, hand edge for pets. |
| `src/throw/throw-planner.js` | `spec.key = 't:r:p'`. |
| `src/hand/shell.js` (world start, small) | Method registration, `DicerResolver` shell, `syncDiceConfiguration`, prefetch. |
| `src/hand/gate-hand.js` (world start, small) | Hand-message detection and the payload buffer the gate consults. |
| `src/hand/chunk/resolve.js` | The resolver body: plan, prompt, overlay, fill terms, extras, fallbacks. |
| `src/hand/chunk/overlay.js` | Grab, shake, flick, "throw for me", countdown, ghost on release. |
| `src/hand/chunk/trajectory.js` | Encode, decode, transform (H-11). |
| `src/hand/chunk/send.js` | Recipients, encode and emit after the message exists. |
| `src/hand/chunk/tray.js`, `templates/dice-tray.hbs` | The free-roll tray. |
| `src/pet/chunk/pets.js`, `timeline.js` | `hand` begin, `alignFor`, `holding`. |
| `src/foundry/message-gate.js`, `src/compat/sync.js`, `src/api/dice3d.js`, `src/main.js`, `src/settings.js`, `lang/en.json`, `styles/dicer.css` | Wiring. |
| `src/bench/scenarios.js`, `src/bench/dicer-adapter.js` | Replay scenarios. |
| `scripts/fairness.mjs`, `docs/research/fairness.md` | The fairness run and report. |
| `build/world-start.js`, `tests/unit/build.test.js` | The lazy chunk and the ratchet. |

---

### Task 1: Read every shape physically

**Files:**
- Modify: `src/core/face-reader.js`, `src/physics/hulls.js`
- Test: `tests/unit/face-reader.test.js`, `tests/unit/hulls.test.js` (new)

**Interfaces:**
- Consumes: `getShape`, `resultOf` (`src/core/dice-shapes.js`), `readTopFace`.
- Produces:
  - `flatGap(shape) -> number`: the smallest top-two read-normal gap over the shape's restable faces, cached per shape. d16 uses the down gap.
  - `topFaceClearance(shape, q) -> number`: the gap between the best and second-best read normal at pose `q`, on the read side (down for d4 and d16), among `readFaces` when given. For a coin, the cap normal's `|y|`.
  - `isCocked(shape, q) -> boolean`, using H-2's `COCKED_FRACTION = 0.5`.
  - `readFace(shape, q) -> faceIndex`: `readTopFace`, except the d16, which takes the down face and maps it to its paired top kite (H-1).
  - `readResult(shape, q, variant) -> number`: `resultOf(shape.values[readFace], variant)`. For `variant === 'd100tens'` it returns the tens part `(v mod 10) × 10`. The caller combines a d100.
  - `combineD100(tens, ones) -> number`: `tens + (ones mod 10)`, where 0 means 100.
  - `computeReaders(types = [...HULL_TYPES, 'd2']) -> Record<type, {normals: Float32Array, read: Int8Array|null, mode: 1|-1, gap: number}>` in `hulls.js`, for the worker.
- Size target: 512 B world start.

- [ ] **Step 1: Write the failing tests:**
  - `face-reader.test.js`:
    - `every shape resting flat on every restable face is not cocked` (10 shapes, `restingQuaternion`).
    - `every shape balanced on an edge (midpoint of two faces) is cocked`.
    - `a coin on its rim is cocked; flat is not`.
    - `d16 resting on each face reads its paired top kite and the 16 faces map to 16 distinct values`.
    - `the crystal never reads a cap, flat or cocked`.
    - `readResult maps relabels: d3 faces 1..6 -> 1,2,3,1,2,3; dF -> +1,+1,0,0,-1,-1; dc face 2 -> 0; d7 on d14`.
    - `d100: tens face 10 + ones face 10 -> 100; tens 3 + ones 7 -> 37`.
  - `hulls.test.js`:
    - `computeReaders covers every hull type and d2, normals unit length, crystal read set [0,1,2,3], d4 mode -1, d16 mode -1`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement** with the signatures above. Pure functions, no three.js in `computeReaders`'s output.
- [ ] **Step 4: Run** the tests and the full suite. All pass.
- [ ] **Step 5: Commit** `feat(hand): read every shape physically, d16 from below`

### Task 2: Free throws, nudges and launch states in the worker

**Files:**
- Modify: `src/physics/protocol.js`, `src/physics/sim.js`, `src/physics/physics.worker.js`, `src/physics/physics-client.js`, `src/main.js` (`INIT` gains `readers: computeReaders()`)
- Test: `tests/unit/sim.test.js`, `tests/unit/physics-client.test.js`

**Interfaces:**
- Consumes: Task 1's `computeReaders`, and today's `THROW {id, dice, seed, area?, obstacles?, splatSpeed?}`.
- Produces:
  - `INIT {hulls, area, readers}`, and `createSim(area, hulls, readers)`.
  - `THROW` gains `free?: true` and `launch?: {pos:[x,y,z], quat:[x,y,z,w], linvel:[x,y,z], angvel:[x,y,z]}[]`. Launch states are in die units relative to the stage centre. Index `i` is die `i`, and a missing entry means a seeded spawn.
  - **Free:**
    - After the dice settle, a die is checked if it is cocked (the readers, `COCKED_FRACTION`) or has its centre outside the area.
    - Such a die gets a seeded nudge: a cocked die an angular impulse, an outside die a linear impulse toward the area centre plus spin.
    - The same world then continues, at most `MAX_NUDGES` per die, within `MAX_FREE_STEPS`. Frames keep streaming.
    - After the last nudge, the reading stands.
  - **Launch:**
    - Dice start at the launch states. Positions are clamped inside the area with a margin of 1, height to [1, 6], and speeds and spins capped.
    - A die within `r + 1` of an obstacle is lifted to `h + 1.2`.
    - All four walls are enabled from step 0, with no herding. The `rand()` stream is consumed in the same order.
  - `DONE {id, settledStep, nudges}`, and `PhysicsClient.throw(req).done -> {settledStep, nudges}`.
- Size target: 2,048 B world start (worker plus main).

- [ ] **Step 1: Write the failing tests** in `sim.test.js`:
  - `a throw without free or launch is byte-identical to before (hash, with and without obstacles)`.
  - `a free throw with a die launched balanced on an edge ends clean, with a nudge in the frames`.
  - `a free throw with a die launched outside the area ends inside it`.
  - `a coin launched on its rim ends flat`.
  - `same seed + same launch -> identical frames and nudges`.
  - `a launched throw's first frame equals the clamped launch states`.
  - `extreme release speeds are capped`.
  - `a launch over an obstacle is lifted and no impact with it exceeds the drop speed`.
  - `a free throw never exceeds MAX_FREE_STEPS`.
  - `dice without a launch entry match the seeded spawn`.
  - `missing readers -> free throws read nothing and never nudge (warn once)`.

  In `physics-client.test.js`: `done carries nudges`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement.** The clearance check in `sim.js` rotates the normals by the body's rotation with plain math. No three.js and no shape table in the worker.
- [ ] **Step 4: Run** the tests and the full suite. All pass, and the existing hashes are unchanged. Build and report the worker's size delta.
- [ ] **Step 5: Commit** `feat(hand): free throws settle cleanly; throws from a release state`

### Task 3: Free dice in Playback and DiceBox; the ratchet re-base

**Files:**
- Modify: `src/throw/playback.js`, `src/throw/dice-box.js`, `src/throw/throw-planner.js`, `src/core/rng.js` (`handEdge`), `tests/unit/build.test.js`
- Test: `tests/unit/playback.test.js`, `tests/unit/dice-box.test.js`, `tests/unit/throw-planner.test.js` (new)

**Interfaces:**
- Consumes: Task 1's `readResult` and `combineD100`, Task 2's `free`/`launch`, and today's pet hook calls.
- Produces:
  - `DieSpec.free?: true`, `DieSpec.key?: string`, `DieSpec.shapeType?: string`. `shapeType` forces the geometry: a replay must draw the recorded shape even if this viewer's look differs.
  - `planThrow` sets `key` to `'<termIndex>:<resultIndex>:<part>'` on every spec. `part` is 0, or 1 for a d100's ones die.
  - **Playback:** dice with `free` never hold at the area edge and are never forced. On the final chunk, each die gets `die.readValue = readResult(...)`, and `die.value` becomes its Foundry result (a d100's ones die carries the combined value, its tens die only the tens part). The inner rotation is identity, times `modelQuat` for a model.
  - `DiceBox.roll(specs, opts)` gains these options:
    - `free`
    - `launch`
    - `seed?`
    - `edge?`: the pet edge. A hand throw passes `handEdge(launch, area)`.
    - `record?: (rec) => void`: called once at physics done with `{chunks: Float32Array[], events: Float32Array, settledStep, nudges, dice: [{shapeType, key}], area, obstacles: {id,x,z,r,h}[], splatSpeed}`. Recorded chunks are never recycled to the worker.
    - `source?: {onChunk(cb), done}`: frames instead of physics. No `THROW` is sent, `obstaclesFor` is not called, chunks are never recycled, and `ids` comes from `source.obstacleIds`.

    It returns `{landed, finished, values: Promise<number[]>, handle}`. `values` resolves at landing, in spec order: each die's Foundry result (a d100 as its ones-die slot, tens slot `null`). Forced dice report their forced value.
  - `DiceBox.hold(specs, {area}) -> {setPose(i, {x,y,z}, {x,y,z,w}), ready: Promise<void>, release(rollOpts) -> rollResult, drop()}`:
    - It shows the held dice with their looks and waits for assets up to `ASSET_WAIT_MS`.
    - The loop runs only while held.
    - `release` hands the same die objects to a free roll (no rebuild). `drop` removes them.
  - `DiceBox.decorateLanded(handle, specs) -> boolean`: merges `fx`, `damageType`, `value`, `system` and `dsnType` onto the lingering dice of `handle` and runs today's landed effects, results and dice events once. It returns false if the roll has faded.
  - `handEdge(launch, area) -> 0|1|2|3`: the side whose wall the mean release point is nearest. `0 = +x`, as `throwEdge`.
  - The pet hook `begin` info gains `hand: boolean`.
  - `build.test.js`: the reference is the measured world start after this task, with the comment `rolling by hand plan: 12,288 B cap over 4,103,020 (owner approval, date)`. `LAZY` gains `hand-[A-Za-z0-9_-]{8}\.js$`.
- Size target: 2,560 B world start.

- [ ] **Step 1: Write the failing tests:**
  - `playback.test.js`:
    - `free dice inside the area play from frame 0 before the final chunk`.
    - `free dice are not rotated: inner quaternion identity (modelQuat kept)`.
    - `readValue/value from the final pose for d6, d16, d4crystal, d3, dF, dc, d100 pair`.
  - `dice-box.test.js`:
    - `values resolves in spec order at landing (free and forced)`.
    - `record gets every chunk, events, obstacles with ids; #finish does not recycle recorded chunks`.
    - `source plays without a THROW and without obstaclesFor; its chunks are never recycled; hit maps -3-i to source.obstacleIds`.
    - `spec.shapeType forces the geometry over the viewer's crystal look`.
    - `hold shows dice after assets, setPose moves them, release reuses the die objects, drop frees materials and geometries (refcounts back to 0)`.
    - `hold loop stops after drop (renderer stopLoop / 'hold')`.
    - `decorateLanded plays fx once on lingering dice; false after the fade`.
    - `a hand roll passes edge and hand: true to obstaclesFor and begin`.
  - `throw-planner.test.js`: `keys are t:r:p, d100 parts 0 and 1, stable under decorate`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement** with the signatures above. In `#makeDie`, `spec.shapeType` wins over the look's crystal choice.
- [ ] **Step 4: Run** `npm run build`, then the full suite in the main checkout. Re-base the ratchet. Report the world-start bytes for Tasks 1–3.
- [ ] **Step 5: Commit** `feat(hand): free dice in Playback and DiceBox; hold, record and replay sources`

### Task 4: Fairness

**Files:**
- Create: `scripts/fairness.mjs`, `docs/research/fairness.md`
- Modify: `package.json` (`test:fairness`)
- Test: `tests/unit/fairness.test.js`

**Interfaces:**
- Consumes: the real sim (`initPhysics`, `createSim`, `computeHulls`, `computeReaders`) and Task 1's readers.
- Produces:
  - `chiSquare(counts) -> {stat, df, p}`, exported. `p` comes from the regularized upper gamma function.
  - `runFairness({types, throws, seed0}) -> {type: {counts, stat, p, nudged, rimRate}}`.
  - The script runs 10,000 free one-die throws per shape: half with a human-like random launch, half seeded spawn. It exits non-zero on any p ≤ 0.01 and writes the report: method, counts, p, nudge rate, coin rim rate, the hull notes (sharp edges and models use Dicer's rounded hull), date and commit.
  - A failing shape is investigated (collider vs visual, chamfer, centre of mass). If it cannot be fixed, the owner's answer to the notes' Q2 applies. The plan assumes the shape is listed in `HAND_UNFAIR = []` (in `shell.js`) and refused by hand (H-15 `partial`).

- [ ] **Step 1: Write the failing tests:**
  - `chiSquare matches known values (df 5, stat 11.07 -> p ~0.05)`.
  - `uniform counts -> p ~1`.
  - `smoke: d6 600 throws and d20 1,200 throws, fixed seeds, p > 0.001`.
  - `smoke: d16 1,600 throws p > 0.001`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement.** Then run `npm run test:fairness` and report its runtime. Fix or list any failing shape.
- [ ] **Step 4: Run** the full suite. All pass.
- [ ] **Step 5: Commit** `test(hand): physics dice fairness check and report`

### Task 5: Trajectory encoding, transform and replay

**Files:**
- Create: `src/hand/chunk/trajectory.js`, `src/hand/chunk/index.js` (the chunk entry)
- Modify: `tests/unit/build.test.js` (the lazy list gains the hand chunk)
- Test: `tests/unit/trajectory.test.js`, `tests/unit/build.test.js`

**Interfaces:**
- Consumes: Task 3's `record` output and `source` option.
- Produces:
  - `encodeTrajectory(rec, {values}) -> {v: 1, n, steps, stride, area: {halfWidth, halfDepth}, settledStep, values, keys, shapes, obstacles, splatSpeed, pos, rot, last, events}`:
    - `pos`, `rot`, `last` and `events` are base64.
    - `last` is the raw float32 final frame.
    - `events` holds frame uint16, die int8, other int8 (`-3 - i` kept), and speed as float16 bits.
    - Positions are relative to the area centre.
  - `decodeTrajectory(payload, {maxDice = 100, maxBytes = MAX_TRAJECTORY_BYTES}) -> {chunks, events, settledStep, values, keys, shapes, obstacles, splatSpeed, area} | null`. Intermediate steps are rebuilt by lerp/slerp. It returns `null` for anything malformed (types, lengths, NaN, counts).
  - `placeTrajectory(decoded, targetArea) -> decoded'`: H-11's uniform scale and offset, applied to the frames and the obstacle spots.
  - `replaySource(decoded) -> {onChunk, done, obstacleIds}`, for `DiceBox.roll(specs, {source, free: true})`.
- Size target: 128 B world start (the import seam only).

- [ ] **Step 1: Write the failing tests:**
  - `round trip on a recorded 10d6 free throw: position error <= 1/256, rotation <= 0.5 deg`.
  - `the final frame is exact: readResult gives the recorded values`.
  - `10d6 typical encodes under 32 KiB; 30 dice under MAX_TRAJECTORY_BYTES`.
  - `malformed, truncated, NaN, oversized, too many dice -> null`.
  - `events keep -3-i and obstacle ids`.
  - `placeTrajectory: same area -> identity; a 0.7-size area -> s 0.7; a 0.4-size area -> s 0.6 (floor); obstacle spots transformed alike`.
  - `replaySource through DiceBox lands with the recorded values`.
  - `build.test.js`: `hand chunk is lazy and dist/dicer.js does not contain 'dicer-hand-chunk'`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement** with the signatures above. Mark the chunk with the string `dicer-hand-chunk`.
- [ ] **Step 4: Run** the build, the tests and the full suite. All pass.
- [ ] **Step 5: Commit** `feat(hand): record, encode and replay throws`

### Task 6: The throw overlay

**Files:**
- Create: `src/hand/chunk/overlay.js`; styles in `styles/dicer.css` (`.dicer-hand-overlay`)
- Modify: `src/pet/chunk/pets.js` (`deps.holding()` gates dodge and idle leave), `src/main.js` (petDeps `holding`), `lang/en.json`
- Test: `tests/unit/throw-overlay.test.js` (jsdom), `tests/unit/pet-layer.test.js`

**Interfaces:**
- Consumes: Task 3's `hold`, `roll({free, launch, record, edge})` and `handEdge`, and the area resolver's rect.
- Produces:
  - `openThrowOverlay({specs, rect, stage, diePx, diceBox, timeoutMs, ghostOnRelease = false, label, rng}) -> Promise<{values, handle, recording} | {cancelled: true} | {timedOut: true}>`.
  - A full-stage element above the board that captures the pointer.
    - Pointer down grabs, moving shakes (jiggle from shake energy), and release throws. Touch works the same.
    - Held dice are confined to `rect` (H-12).
  - `velocityFromSamples(samples, diePx) -> [vx, vz]`: uses the last 120 ms of samples, converts px/s to die units/s, and caps. Too few samples gives a gentle default.
  - `liftFromSpeed(speed) -> vy`.
  - `spinFromShake(energy, rng) -> [x, y, z]`: bounded by `MAX_RELEASE_SPIN`.
  - The **Throw for me** button and the Space key make a free throw without `launch`.
  - Esc or Cancel cancels. A countdown shows `timeoutMs`. Window blur does not pause the timeout.
  - `ghostOnRelease`: on release the held dice become ghost specs on this screen. The values are still read and recorded (P6-D1 tray, H-19).
  - Pets: `deps.holding()` is true from grab until release. The pet layer neither dodges nor arms idle leave while it is true (H-8).
  - Everything is removed on settle.
- Size target: 128 B world start (`holding` wiring).

- [ ] **Step 1: Write the failing tests:**
  - `throw-overlay.test.js`:
    - `velocityFromSamples direction, scale, cap, gentle default`.
    - `spinFromShake bounded and seeded`.
    - `held dice stop at the rect border`.
    - `the pointer maps through the stage rect even when the canvas is translated (shake)`.
    - `Space throws without launch`.
    - `Esc -> {cancelled: true}`.
    - `timeout -> {timedOut: true}`.
    - `ghostOnRelease swaps to ghost specs at release and still returns values`.
    - `add/removeEventListener counts match; no DOM left`.
  - `pet-layer.test.js`:
    - `no dodge while holding()`.
    - `no idle leave while holding(); the timer re-arms after release`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement** with the signatures above.
- [ ] **Step 4: Run** the build, the tests and the full suite. All pass.
- [ ] **Step 5: Commit** `feat(hand): throw overlay; pets hold still while dice are held`

### Task 7: The fulfillment method and resolver

**Files:**
- Create: `src/hand/shell.js`, `src/hand/chunk/resolve.js`
- Modify: `src/main.js` (registration at `init`, sync at `ready`, prefetch H-20), `src/settings.js`, `lang/en.json`
- Test: `tests/unit/hand-shell.test.js`, `tests/unit/hand-resolve.test.js`, `tests/unit/settings.test.js`

**Interfaces:**
- Consumes: Task 6's overlay, `planThrow` plus `decorateFor` (look-only), the area resolver and Task 3's `DiceBox`.
- Produces:
  - **Settings** per the Global Constraints table, registered through `settings.js register()`.
  - **At `init`:** `CONFIG.Dice.fulfillment.methods.dicer = {label: 'DICER.Hand.Method', icon: '<i class="fa-solid fa-hand"></i>', interactive: true, resolver: DicerResolver}`.
  - `handAllowed(user, getSetting) -> boolean`, from `handRollsAllowed` and the user's role.
  - `syncDiceConfiguration({getSetting, user, getCore, setCore})`:
    - With hand rolls on and allowed, it maps each chosen denomination to `dicer`. An empty list maps `d4 d6 d8 d10 d12 d20 d100 c f`, plus `default` when no other method holds it.
    - `required` forces this for allowed users.
    - Otherwise it removes Dicer's entries only, and never touches entries pointing at other methods.
    - It runs at `ready` and on each of these settings' `onChange`.
  - `class DicerResolver extends foundry.applications.dice.RollResolver` (shell):
    - `awaitFulfillment()` imports the chunk and calls `fulfill(this)`.
    - `addTerm(term)` calls `fulfillTerm(this, term)`.
    - `resolveResult(term, method, options)` calls `extraResult(this, term, method, options)`.
    - `close()` is safe unrendered.
    - It keeps `Roll.defaultImplementation.RESOLVERS` set and deleted like the base class.
  - **Chunk** `fulfill(resolver)`:
    - It collects the fulfillable terms with method `dicer`. Manual terms go to `super.awaitFulfillment` behaviour (render Foundry's form for them only).
    - In `ask` mode it prompts first ("Throw by hand" / "Roll automatically").
    - It builds specs with `planThrow(placeholderRoll(roll), {decorate: lookOnly})`: one placeholder result (the minimum face) per die, and fx and damage type stripped. Every spec gets `free: true`, `key` and `shapeType`.
    - It drops dice per H-3, H-13 and `HAND_UNFAIR` (counted in `partial`).
    - It opens the overlay in `rectFor({rollerId: me})` with `handRollTimeout`, and `ghostOnRelease` per H-19.
    - On landing it pushes `{result, active: true}` into each term in order (a d100 combined), sets `roll.options.dicerHand` (H-15), and stores `{recording, handle, specs}` under `id` for Task 8.
    - On timeout or cancel it sets `fallback`, pushes nothing, and from then on `extraResult` returns `undefined` for this roll (Foundry's `randomFace()`).
    - It fires `diceSoNicePendingThrowOpened(roll)` and `diceSoNicePendingThrowClosed(roll)` once each.
  - **Chunk** `extraResult` (explode or reroll): if the roll is not in fallback, a free "throw for me" of one die in the same area (P6-D3). It returns the read result, or `undefined`.
  - **Chunk** `fulfillTerm` (dynamic terms) throws that term's dice the same way. It resolves immediately with `partial` if the roll is in fallback.
- Size target: 2,560 B world start.

- [ ] **Step 1: Write the failing tests** (Foundry globals stubbed with `tests/unit/foundry-roll.js` and a fake overlay):
  - `hand-shell.test.js`:
    - `the method is registered with the resolver`.
    - `syncDiceConfiguration writes/removes only dicer entries; honours handRollTypes, allowed, required, default`.
    - `close() unrendered resolves the pending promise`.
  - `hand-resolve.test.js`:
    - `2d6 + 1d20: term.results filled from overlay values in order`.
    - `d100 combines tens and ones`.
    - `dF and c results come from resultOf`.
    - `crystal d4 spec carries shapeType d4crystal from the author's look`.
    - `ask + Roll automatically: no overlay, resolveResult -> undefined`.
    - `Review Focus 2: timeout and cancel -> nothing pushed, fallback set, every later resolveResult undefined`.
    - `3d6x: explosions throw one free die each and totals match read values`.
    - `(1d4)d6: addTerm throws the inner and outer dice`.
    - `over maxDice and an aliased 30-face preset -> partial counted, those dice undefined`.
    - `manual terms render Foundry's form only for them`.
    - `pending-throw hooks fire once each`.
    - `a roll with options.messageMode 'blind' opens with ghostOnRelease`.
  - `settings.test.js`: the key list gains the 7 keys, with their defaults.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement** with the signatures above.
- [ ] **Step 4: Run** the build and the full suite. All pass. Report the world-start bytes.
- [ ] **Step 5: Commit** `feat(hand): fulfillment method and resolver`

### Task 8: Everyone allowed sees the same throw

**Files:**
- Create: `src/hand/gate-hand.js`, `src/hand/chunk/send.js`
- Modify: `src/foundry/message-gate.js`, `src/compat/sync.js` (an `onHand` path for `kind: 'hand'`), `src/api/dice3d.js` (H-18, and exporting the recipients rule as `recipientsOf(s, gms, selfId)` for reuse), `src/main.js`
- Test: `tests/unit/hand-sync.test.js`, `tests/unit/message-gate.test.js`, `tests/unit/sync.test.js`, `tests/unit/dice3d.test.js`

**Interfaces:**
- Consumes: Tasks 5 and 7, `viewFor`, and the gate's `throwGroups`, `petOf` and `areaOf`.
- Produces:
  - **Thrower** (`send.js`), on its own `createChatMessage` for rolls with a non-fallback `dicerHand`:
    - Encodes the stored recording and emits `{v: 1, kind: 'hand', id, messageId, userId, trajectory}` to `handRecipients(message, gms, selfId)`. That is `recipientsOf` applied to the message's whisper list, `blind`, and each roll's `secret` and `ghost`: a ghost roll gives no recipients.
    - Then drops the store entry.
  - `createSync({..., onHand})`:
    - `kind 'hand'` with a matching sender is passed to `onHand(payload, senderId)`.
    - Over `MAX_TRAJECTORY_BYTES` of base64 it is ignored before decoding.
  - `createHandGate({importChunk, now, setTimeoutFn})` (`gate-hand.js`, world start):
    - `isHand(roll) -> boolean`.
    - `accept(payload, senderId)`: buffers for `HAND_BUFFER_MS`.
    - `waitFor(messageId, rollId, authorId) -> Promise<decoded|null>`: resolves on a matching payload (decoded lazily) or `null` after `HAND_REPLAY_WAIT_MS`.
  - `createMessageGate({..., hand})`. In `throwGroups`, per roll:
    - **Own hand roll** (`entry.own`, non-fallback): not thrown. `decorateLanded(handle, specs)` plays its effects (H-9). The roll counts as landed at once.
    - **Hand roll seen `real`** with `handReplay` on:
      1. Wait for the trajectory, then validate it: sender = author = `dicerHand.by`; the keys exist; `readResult` of the final frame per die equals the message's results.
      2. Build the replay specs by key (H-10), then `placeTrajectory` into `areaOf(...)`.
      3. Align the pets (Task 9), then `diceBox.roll(specs, {source, free: true, area, pet})`.
      4. Throw the extras beyond the recording as a forced throw after it lands.
    - **On a failure or `null`:** today's forced throw of the message's results.
    - **Ghost or none views, and fallback rolls:** exactly as today.
    - A group holding a hand roll gets the watchdog `WATCHDOG_MS + HAND_REPLAY_WAIT_MS`.
  - **H-18:** `throwHere` skips local animation for a non-fallback `dicerHand` roll by the current user.
- Size target: 2,048 B world start.

- [ ] **Step 1: Write the failing tests:**
  - `hand-sync.test.js`:
    - `recipients: public -> all but self; whisper -> recipients + GMs; blind -> GMs; secret roll -> GMs; ghost roll -> nobody`.
    - `a player not allowed to see a whispered hand roll receives nothing (socket spy)`.
    - `payload before message and message before payload both replay`.
    - `buffer entries expire after HAND_BUFFER_MS`.
  - `message-gate.test.js`:
    - `own hand roll: no throw, decorateLanded called, RollStart and RollComplete once, revealed at once`.
    - `real receiver replays with source and reveals after landing`.
    - `Review Focus 4: no payload -> forced throw, revealed within WATCHDOG_MS + HAND_REPLAY_WAIT_MS`.
    - `Review Focus 4: spoofed sender / values mismatch / garbage -> forced throw`.
    - `ghost view of a hand roll -> ghost throw, waitFor never called`.
    - `handReplay off -> forced throw`.
    - `extras beyond the recording throw after the replay`.
    - `fallback hand roll animates normally everywhere`.
    - `a message mixing a hand roll and a normal roll throws both in rollOrder`.
  - `sync.test.js`:
    - `kind hand reaches onHand only with a matching sender`.
    - `oversized hand payload ignored`.
    - `show path unchanged`.
  - `dice3d.test.js`: `showForRoll of the thrower's own hand roll does not animate locally`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement** with the signatures above.
- [ ] **Step 4: Run** the build and the full suite. All pass. Report the world-start bytes.
- [ ] **Step 5: Commit** `feat(hand): everyone allowed sees the same throw`

### Task 9: Pets in hand throws, and shared splats

**Files:**
- Modify: `src/pet/chunk/pets.js`, `src/pet/chunk/timeline.js`, `src/pet/chunk/resting.js` (an `away` predicate over die paths), `src/throw/dice-box.js` (`hand` and `edge` pass-through, if not done in Task 3)
- Test: `tests/unit/pet-layer.test.js`, `tests/unit/pet-timeline.test.js`, `tests/unit/pet-resting.test.js`, `tests/unit/message-gate.test.js`

**Interfaces:**
- Consumes: Task 3's `begin({hand})`, Task 5's `obstacles` and `placeTrajectory`, Task 8's replay path, and today's `hit` / `splat` / `restSpot(area, height, taken, rand, avoid, away)`.
- Produces:
  - `phaseAt(track, now)` with `track.hand` skips the `throw` phase: watch starts at `ENTER_MS`, or at once for a pet watching from rest.
  - `begin(key, {..., hand})`: no throw pose. Its edge is the hand edge.
  - `alignFor(list: {id, x, z, r, h}[], area, paths: (x, z) => number) -> void`, the H-6 rules. `paths` returns the distance from a point to the nearest recorded die centre over the whole replay. The function:
    - moves listed standing pets to their spots (`move`, `REST_HOP_MS`);
    - places absent listed pets at rest, using the same `slotFor` cap (a full cap replaces the longest-idle pet, never one mid-routine);
    - moves unlisted standing pets whose footprint `paths` crosses within `r + 1` to a `restSpot` with `away = (p) => paths(p.x, p.z) > r + 1`;
    - leaves puddles alone. A listed id whose pet is a puddle here stays a puddle: its die passes over it, as a puddle is no obstacle.
  - The gate calls `pets.alignFor` just before the replay's `roll()`, only for `real` replays (H-7). A throwing `alignFor` warns once and the replay goes on.

- [ ] **Step 1: Write the failing tests:**
  - `pet-timeline.test.js`: `hand track has no throw phase`.
  - `pet-layer.test.js`:
    - `a hand begin never poses 'throw'`.
    - `alignFor moves a listed resting pet to its spot`.
    - `alignFor places an absent listed pet at rest within the cap`.
    - `alignFor moves an unlisted pet off the die paths`.
    - `alignFor never moves a pet mid-routine or a puddle`.
    - `Review Focus 5: a replayed -3 impact over SPLAT_SPEED splats the listed pet on the receiver; the owner's next roll reforms it`.
  - `pet-resting.test.js`: `restSpot honours away over 200 seeded tries`.
  - `message-gate.test.js`:
    - `alignFor is called for real replays only, never for ghost or none views`.
    - `a throwing alignFor still replays`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement** with the signatures above.
- [ ] **Step 4: Run** the build and the full suite. All pass. Run `npm run test:visual:pets`, which shows zero errors.
- [ ] **Step 5: Commit** `feat(pet): pets in hand throws; splats shared with the replay`

### Task 10: Chat card marks and the free-roll tray

**Files:**
- Create: `src/hand/chunk/tray.js`, `templates/dice-tray.hbs`
- Modify: `src/main.js` (`renderChatMessageHTML` mark; the `getSceneControlButtons` tool in v14's record shape), `lang/en.json`, `styles/dicer.css`, `tests/unit/build.test.js`
- Test: `tests/unit/tray.test.js` (jsdom), `tests/unit/main-hooks.test.js`

**Interfaces:**
- Consumes: Task 7's `handAllowed` and overlay path, and H-14.
- Produces:
  - `markFor(roll) -> null | {icon: 'fa-hand', tip}`. The tips:
    - "Rolled by hand"
    - "Rolled by hand (N dice rolled automatically)" for `partial`
    - "Rolled automatically (no throw)" for `fallback`

    The mark is added once per rendered card, visible to everyone who sees the card.
  - **The tray tool** "Dice tray" sits under the token controls. It is shown when `diceTray` is on and `handAllowed`, and it lazily opens an ApplicationV2 picker with these fields:
    - counts for d4, d6, d8, d10, d12, d20, d100, d2 and dF
    - a modifier
    - the message mode, one of `CONFIG.ChatMessage.modes`: public, gm, blind, self
    - Throw
  - Throw opens the overlay (blind uses `ghostOnRelease`) in the user's area and builds the Roll per H-14. It sets `options.dicerHand`, then calls `toMessage({}, {messageMode})`. That message is not re-evaluated, and Task 8 replays it.
  - `formulaFromCounts(counts, modifier) -> string`.
- Size target: 1,024 B world start.

- [ ] **Step 1: Write the failing tests:**
  - `tray.test.js`:
    - `formulaFromCounts({d6: 2, d20: 1}, 3) -> '2d6 + 1d20 + 3'; dF -> '1dF'`.
    - `the tray Roll's dice results equal the thrown values and its total is right (pre-filled evaluate)`.
    - `blind opens the overlay with ghostOnRelease`.
    - `cancel posts nothing`.
  - `main-hooks.test.js`:
    - `the card mark for hand / partial / fallback / normal rolls, once per render`.
    - `the tray tool appears only when diceTray and allowed`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement** with the signatures above.
- [ ] **Step 4: Run** the build and the full suite. All pass. Report the world-start bytes.
- [ ] **Step 5: Commit** `feat(hand): chat marks and the dice tray`

### Task 11: Bench and soak coverage, review page, live checks and docs

**Files:**
- Create: `dev/hand.html`, `dev/hand.js`, `tests/live/hand.mjs`, `tests/fixtures/trajectory-mixed10.json` (a recorded, encoded throw)
- Modify: `src/bench/scenarios.js`, `src/bench/dicer-adapter.js`, `tests/live/bench-lib.mjs` (the DSN side skips `dicerOnly`), `docs/live-checks.md`, `README.md`, `package.json` (`test:live:hand`)
- Test: `tests/unit/bench-scenarios.test.js`, `tests/unit/dicer-adapter.test.js`

**Interfaces:**
- Produces:
  - Scenarios `{id: 'handReplay10', kind: 'typical', formula: MIXED, rolls: 1, hand: true, dicerOnly: true}` and `{id: 'handSoak100', kind: 'soak', rolls: 100, hand: true, dicerOnly: true}`. The adapter replays the fixture through `DiceBox.roll(specs, {source})`.
  - The G2 targets apply: first frame ≤ 50 ms, no task over 50 ms (decode included), and stable heap and GPU counts over the soak.
  - `checkTargets` judges them. The head-to-head report excludes `dicerOnly`.
  - `dev/hand.html` shows:
    - the overlay on the studio stage
    - Throw for me
    - a cocked-die demo
    - a d16 read demo with the result glow
    - a pet-splat hand throw
    - the last throw replayed side by side from its encoded form, at half the area size (H-11)
  - The live test (owner-run, GM + player):
    - The player sets hand rolls to Always and makes a public `1d20` through `Roll#toMessage`, with "throw for me" triggered by script. The GM receives a `hand` payload, and its replay's final values equal the card.
    - A whispered-to-GM hand roll never reaches a second player's socket handler (debug counter).
    - A timeout fallback marks the card.
    - A hand throw that splats the player's resting pet splats it on the GM's screen.
  - `docs/live-checks.md` covers:
    - real mouse and touch throws
    - PF2e and dnd5e attack, save and damage with crit doubling
    - **pf2e secret checks** (H-19: no faces for the thrower)
    - exploding dice
    - the tray in each mode
    - Foundry's Dice Configuration showing "Dicer (by hand)"
    - a smaller GM window (H-11)
  - The README "Rolling by hand" section covers:
    - the settings
    - how to throw and the tray
    - the trust note: as trustworthy as Foundry's manual entry, and the GM can disable it
    - the d16 rule
    - pets and shared splats (replacing the "per screen until rolling by hand" sentence)
    - mixed interactive methods not supported (H-17)
    - the fairness report link

- [ ] **Step 1: Write the failing tests:**
  - `bench-scenarios.test.js`:
    - `handReplay10 and handSoak100 exist and are dicerOnly`.
    - `the head-to-head skips dicerOnly`.
  - `dicer-adapter.test.js`: `hand scenarios replay the fixture through source, never THROW`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement.** The dev page runs with no console errors. Then run the live test and `node --check tests/live/hand.mjs`.
- [ ] **Step 4: Run** the docs pass, then the full suite, lint, build, the build budget test, `npm run test:visual`, `npm run test:visual:pets` and `npm run test:visual:editors`. All pass. Report the final world-start bytes against the 12,288 B cap.
- [ ] **Step 5: Commit** `docs: hand rolling bench scenarios, review page, live checks and README`

---

## Not in this plan

- Hand-throwing blind rolls from sheets (P6-D1).
- Mixed interactive fulfillment configs, for example a Bluetooth dice module plus Dicer (H-17).
- Sharing trajectories for `showForRoll` re-shows or for automatic rolls (spec non-goal; H-18).
- Persistent dice left on the table.
- The pet throwing the dice for you through rolling by hand. The dice pet shipped on automatic throws, so this plan only lets it watch hand throws.
