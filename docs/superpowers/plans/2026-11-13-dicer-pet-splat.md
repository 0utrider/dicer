# Dicer Pet Splat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pets rest on the table between rolls, dice really collide with them, and a hard hit splats a pet into a puddle that reforms on its owner's next roll.

**Architecture:**
- **The physics worker** takes up to 3 fixed pet obstacles per throw and reports die–pet impacts with their own "other" code.
- **DiceBox** asks the pet layer for obstacles before each throw. It hands pet impacts back at playback time, and holds the canvas shown while pets rest.
- **The pet layer** (the lazy chunk) gains resting spots, a cap that counts puddles, wobble, splat, puddle and reform. The splat visuals live in their own module.

**Tech Stack:** Plain JS ES modules, three.js 0.184, Rapier3D deterministic (worker), Vite lazy chunks, Vitest, Playwright (visual).

**Spec:** `docs/superpowers/specs/2026-11-13-dicer-pet-splat-design.md` (it builds on `docs/superpowers/specs/2026-11-13-dicer-dice-pet-design.md`).

## Global Constraints

- **Branch and commits:** branch `pet-splat`. Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge.
- **World-start budget:**
  - Task 2 re-bases the ratchet reference in `tests/unit/build.test.js` to today's world start, `4_100_546`.
  - This plan may add at most **1,536 bytes** over that.
  - Measure in the main checkout `dicer/` after `npm run build`, never in `dicer-repro`.
  - All splat visuals and logic live in the lazy pet chunk.
- **Unchanged without pets:** a throw with no obstacles gives byte-identical physics frames to today. The existing sim hash tests stay green, unchanged.
- **Results:** results never change. A bounce changes where a die rests, never the value it shows.
- **Privacy:** a splat depends only on physics, never on a value. Ghost dice can splat.
- **Timing:**
  - The pet never delays `roll.landed`, `roll.finished`, the chat card or `diceSoNiceRollComplete`.
  - Splats happen at playback time, when the die visibly touches the pet.
- **Idle cost:** a resting pet does not animate. With only resting pets on screen, the loop returns `'hold'`: the canvas is shown and no rAF is pending.
- **Settings (client, Boolean, default `true`):**
  - `petsStay`: "Pets stay on the table" / "Your and other players' pets sit on the table between rolls."
  - `petSplat`: "Dice can splat pets" / "A die that hits a pet hard enough splats it until its owner rolls again."
- **Limits:**
  - `MAX_PETS = 3` counts resting pets and puddles.
  - Only resting pets and puddles can be replaced, the one idle longest first.
  - At most `MAX_OBSTACLES = 3` obstacles per throw.
- **Impact protocol:** floor `-1`, wall `-2`, pet obstacle `-3 - i` (where `i` is the obstacle's index in that throw's list).
- **Durations (ms):**

  | Constant | Value |
  | --- | --- |
  | `WOBBLE_MS` | 400 |
  | `SPLAT_MS` | 500 (burst into puddle) |
  | `REFORM_MS` | 400 |
  | `REST_HOP_MS` | 450 (hop to a resting spot) |

- **Resting spot:**
  - Inside the owner's roll area (or the stage), at least `1.2 × height` from every edge.
  - Outside the inner 60% (`|x - cx| > 0.6·halfWidth` or `|z - cz| > 0.6·halfDepth`).
  - At least `2 × height` from every other pet or puddle.
  - Picked with seeded rejection sampling; after 24 tries, the best candidate found.
- **Look:**
  - The splat is cartoon goo in the pet's own colour, never red gore.
  - The puddle shows the pet's eyes. The mimic leaves its lid and the dragonling leaves a wing.
  - `MeshStandardMaterial`, colours clamped ≤ 1.
- **Sound:** `petSplat` built in `synth.js` with peak `0.55`, like the chirps. It is pet-only, so it is not added to `USER_SOUNDS`.
- **Checks:** lint clean; full suite green.

## Review Focus

1. **A die settling on top of a resting pet.** It must slide off and rest flat on the floor, never balance on the pet or stay cocked. Test in Task 1: a die dropped onto an obstacle's top ends with its centre at floor height.
2. **Several dice hitting one pet in the same frame, or a die hitting a puddle or an already-splatted pet:** one splat, one sound, and nothing for impacts against a pet that is no longer standing. Test in Task 4.
3. **The window resizes or the roll area changes while pets rest or puddles lie:** each moves to a valid new spot. An engine restart clears them, as spec S-8 says. A puddle stays a puddle, and none is left outside the area or overlapping another. Test in Task 3.
4. **Settings turned off with puddles on screen:** `petsStay` off makes resting pets and puddles hop or fade away, and the loop ends. `petSplat` off with a puddle present leaves the puddle until its owner rolls, and makes no new splats. Test in Task 4.
5. **The owner disconnects while their pet rests or lies as a puddle:** it goes away. A reconnect starts fresh on the next roll. Test in Task 3.

---

### Task 1: Pet obstacles in the physics

**Files:**
- Modify: `src/physics/protocol.js` (`MAX_OBSTACLES = 3`; `THROW` doc gains `obstacles?`)
- Modify: `src/physics/sim.js` (fixed colliders; owner codes `-3 - i`)
- Test: `tests/unit/sim.test.js`

**Interfaces:**
- Produces: `THROW` gets `{ id, dice, seed, area?, obstacles?: {x, z, r, h}[] }`, in scene units on the floor. `r` is the radius and `h` the standing height. Impacts with obstacle `i` report `other = -3 - i`.
- An obstacle is a fixed capsule, or a cylinder with a rounded top: centre `(x, h/2, z)`, radius `r`.
  - Friction `0.05` and the dice's restitution, so dice slide off it rather than resting on it.
  - Obstacles beyond `MAX_OBSTACLES` are ignored.
  - Non-finite values make that obstacle ignored, never an error.

- [ ] **Step 1: Write the failing tests** in `sim.test.js`:
  - `a throw without obstacles is byte-identical to before` (the existing hash tests cover this; add one with `obstacles: []` giving the same hash).
  - `a die aimed at an obstacle reports an impact with other -3`. Place one obstacle `{x, z, r: 0.5, h: 1.5}` on the line between the seeded spawn edge and the aim point, using a seed whose path crosses it, and assert that at least one impact has `other === -3` and `speed > 0`.
  - `the second obstacle reports -4`.
  - `a die dropped onto an obstacle's top slides off`. Use a single die with zero spin over the obstacle's centre (use or add the sim's test hook for a manual start, if one exists, or a seed and area that drop onto it). At rest, its centre `y` is within `0.05` of a die resting flat on the floor.
  - `more than 3 obstacles: only the first 3 exist`.
  - `NaN obstacle fields are ignored`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/sim.test.js`. The new tests fail.
- [ ] **Step 3: Implement** the obstacles in `sim.js`. No extra `rand()` draws, so the seeded stream is unchanged.
- [ ] **Step 4: Run** the tests and the full suite. All pass, and the existing hashes are unchanged.
- [ ] **Step 5: Commit** `feat(physics): fixed pet obstacles with their own impact code`

### Task 2: DiceBox obstacles, pet hits, held rest, settings and wiring

**Files:**
- Modify: `src/throw/dice-box.js`
- Modify: `src/settings.js`, `lang/en.json`
- Modify: `src/main.js` (pet deps gain `wake`, the `userConnected` hook, and area-resize notification)
- Modify: `tests/unit/build.test.js` (reference `4_100_546`; comment: pet splat plan, 1,536 B cap)
- Test: `tests/unit/dice-box.test.js`, `tests/unit/settings.test.js`, `tests/unit/main-hooks.test.js`

**Interfaces:**
- Consumes: Task 1's `obstacles` and `-3 - i` codes; today's `PetHook` (`begin` / `landed` / `leave` / `end` / `update`).
- Produces these optional `PetHook` methods. DiceBox calls each one only if it exists, through `#petCall`:
  - `obstaclesFor(info: { spec: PetSpec|null, edge, area }) -> {x, z, r, h, id}[]`. It is called in `roll()` before `THROW`, for every throw, with or without a `PetSpec`. DiceBox sends the first 3 (without `id`) and keeps the `id` list on the roll.
  - `hit(id, { speed, position: {x, y, z}, dieKey })`. It is called from `#impacts` at playback time for each impact with `other <= -3`, mapping `-3 - i` to the roll's `ids[i]`.
  - `areaChanged(area)`. It is called when the stage or roll area changes size.
  - `userGone(userId)`. Main calls it from `Hooks.on('userConnected', (user, connected) => { if (!connected) ... })`.
  - `update(now)` may now return `true` (moving), `'rest'` (pets shown, nothing moving) or `false`.
- `#frame`:
  - With no rolls and the pet returning `'rest'`, it returns `'hold'`, so the canvas stays shown with no rAF.
  - With no rolls and `false`, it keeps today's behaviour.
  - With rolls, `'rest'` counts as not moving.
- `DiceBox.wake()`: starts the loop when it is stopped or held. The pet layer calls `deps.wake()` whenever something starts moving outside a roll, such as a hop-off or a re-place.
- Settings `petsStay` and `petSplat` follow the Global Constraints. When either changes, the layer is told through `deps.getSetting` on its next `update`, and main calls `wake()`.

- [ ] **Step 1: Write the failing tests:**
  - `dice-box.test.js`:
    - `roll() asks obstaclesFor before the throw and sends at most 3 obstacles without ids`.
    - `a throw with no pet hook sends no obstacles key`.
    - `an impact with other -4 calls hit with the second id, at playback time, with the die position copied`.
    - `impacts with other -1/-2 never call hit`.
    - `no rolls + update 'rest' -> #frame returns 'hold'`.
    - `no rolls + update false -> false`.
    - `wake() restarts a held loop`.
    - `a throwing obstaclesFor or hit warns once and the roll still lands`.
  - `settings.test.js`: the key list gains `petsStay` and `petSplat`.
  - `main-hooks.test.js`: a `userConnected` disconnect calls `userGone` on the current pet layer, and an area resize calls `areaChanged`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement.** In `roll()`, compute the edge from the seed before building `req`, as `#petBegin` does. The area is the one `req.area` carries, or the stage.
- [ ] **Step 4: Run** `npm run build`, then the full suite in the main checkout. World start must be ≤ `4_100_546 + 1_536`; report the bytes.
- [ ] **Step 5: Commit** `feat(pet): obstacles, pet hits and a held rest in DiceBox; splat settings`

### Task 3: Resting pets, the cap and lifecycle

**Files:**
- Create: `src/pet/chunk/resting.js`
- Modify: `src/pet/chunk/pets.js`
- Test: `tests/unit/pet-resting.test.js`, `tests/unit/pet-layer.test.js`

**Interfaces:**
- Consumes: Task 2's hook methods and `deps.wake`.
- Produces:
  - `restSpot(area, height, taken: {x, z}[], rand: () => number) -> {x, z}`. It follows the Global Constraints' resting-spot rule, with seeded rejection, 24 tries, then the best candidate (the one farthest from the nearest violation).
  - Layer behaviour:
    - With `petsStay` on, a pet's exit becomes a hop (`REST_HOP_MS`) to `restSpot(...)` in its owner's area, and the pet then rests: it is not posed again and `update` returns `'rest'` once nothing moves.
    - The owner's next `begin` makes the pet hop from its resting spot to the edge spot, re-using the existing enter-from-current-position.
    - `obstaclesFor` returns every standing pet: resting ones at their spot, rolling ones at their edge spot, and, for `info.spec`'s own user, the edge spot it is about to take, computed with the same placement as `begin`. Each has `r = 0.45 × height` and `h = height`, using the creature's footprint (for the mimic, its chest).
    - The cap of 3 counts resting pets and puddles. A new roller's pet replaces the one idle longest; that pet hops off. A pet mid-routine is never replaced.
    - `userGone(id)` makes that user's resting pet hop off (and fades a puddle).
    - `petsStay` turning off, or `petsAllowed` or `showPets` off, makes every resting pet hop off.
    - `areaChanged(area)` re-places each resting pet (and puddle) at a fresh valid spot inside its area.

      The owner's area comes from the same resolver DiceBox uses. Pass it in the `begin` info as `ownerArea`, or keep the last roll's area per user; choose one and document it.
    - The layer calls `deps.wake()` whenever any of these starts motion outside a roll.

- [ ] **Step 1: Write the failing tests:**
  - `pet-resting.test.js`:
    - `restSpot honours edges, the inner 60% and spacing for 200 seeded tries`.
    - `a crowded area returns the best candidate without throwing`.
    - `deterministic for a fixed rand`.
  - `pet-layer.test.js`:
    - `with petsStay a pet rests after its roll and update returns 'rest'`.
    - `petsStay off keeps today's hop-off`.
    - `the owner's next roll hops from the resting spot (no frame moves more than a hop step)`.
    - `obstaclesFor lists resting pets and the roller's upcoming edge spot`.
    - `a 4th roller replaces the longest-idle resting pet, never one mid-routine; all 3 mid-routine -> no pet`.
    - `userGone hops that pet off and the layer ends empty`.
    - `areaChanged re-places resting pets validly`.
    - `petsStay switched off mid-rest -> all hop off, update false at the end`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement.** Keep `pets.js` focused: put placement and spot logic in `resting.js`.
- [ ] **Step 4: Run** the tests and the full suite. All pass.
- [ ] **Step 5: Commit** `feat(pet): pets rest on the table between rolls`

### Task 4: Hits, wobble, splat, puddle and reform (logic)

**Files:**
- Create: `src/pet/chunk/splat.js`, with a placeholder visual: a flat coloured disc for the puddle and a few spheres for droplets. Task 5 replaces it.
- Modify: `src/pet/chunk/pets.js`, `src/pet/chunk/creatures/index.js` (the contract comment: `pose(phase, …)` gains `'wobble'` and `'reform'`)
- Modify: `src/audio/synth.js` (`*petSplat`), `src/audio/sound-names.js` (`RESULT_SOUNDS` gains `'petSplat'`, not `USER_SOUNDS`)
- Test: `tests/unit/pet-splat.test.js`, `tests/unit/pet-layer.test.js`, `tests/unit/synth.test.js`

**Interfaces:**
- Consumes: Task 2's `hit(id, {speed, position, dieKey})`; Task 3's resting state.
- Produces:
  - `SPLAT_SPEED`: the threshold. Measure first: log die–pet impact speeds over 50 seeded throws aimed through an obstacle, plus a die tumbling into a resting pet at the end of a roll. Pick the value so a full-pace arrival usually splats and a tumble only wobbles. Record the measured numbers in the report.
  - `WOBBLE_SPEED`: the minimum speed for a wobble; below it, nothing happens.
  - `createSplat(kind, color) -> { root, pose(phase: 'burst'|'puddle'|'reform', t), dispose }` in `splat.js`.
  - Layer:
    - A `hit` on a standing pet at or above `SPLAT_SPEED`, with `petSplat` on, splats it: the creature is hidden, then `burst` runs (`SPLAT_MS`), then the pet becomes a puddle.
    - Any routine in progress ends, with no reaction for its rolls; their `landed`/`leave`/`end` calls stay harmless.
    - `playSound({builtin: 'petSplat'})` plays, gated like the chirps.
    - Below `SPLAT_SPEED`, or with `petSplat` off: a wobble (`WOBBLE_MS`) pushed away from `position`. It restarts on a new hit.
    - Hits on a puddle or a pet that is already splatting are ignored. Several hits in one frame give one splat and one sound.
    - The owner's next `begin` reforms the puddle in place (`REFORM_MS`), then runs the normal routine.
    - A puddle counts toward the cap and is not an obstacle.
  - `*petSplat`: a wet "splorch", a short noisy burst with a falling pitch, 0.35 s, peak 0.55.

- [ ] **Step 1: Write the failing tests:**
  - `pet-splat.test.js`:
    - `createSplat builds for every kind with ≤ 3 materials, no NaN for every phase × t ∈ {0, 0.5, 1, -1, 2, NaN}`.
    - `dispose frees everything`.
  - `pet-layer.test.js`:
    - `a hard hit splats: one petSplat sound, then a puddle`.
    - `a soft hit wobbles`.
    - `petSplat off -> wobble only`.
    - `three hits in one frame -> one splat`.
    - `hits on a puddle are ignored`.
    - `a splat mid-routine gives no reaction and no chirp`.
    - `the owner's next roll reforms the puddle and plays the routine`.
    - `a puddle counts toward the cap and is not in obstaclesFor`.
    - `petsStay off with a puddle -> it fades and the layer ends empty`.
  - `synth.test.js`: `petSplat renders, peak ≤ 0.7 × fanfare, not in USER_SOUNDS`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement.** Measure first for `SPLAT_SPEED`: a throwaway script against the real sim is fine, but don't commit it unless it becomes a test.
- [ ] **Step 4: Run** the tests and the full suite. All pass.
- [ ] **Step 5: Commit** `feat(pet): dice splat pets; puddles reform on the owner's next roll`

### Task 5: Splat look (design rounds)

**Files:**
- Modify: `src/pet/chunk/splat.js` (the real visuals), the creatures' `'wobble'`/`'reform'` poses
- Modify: `dev/pets.js` (rows for wobble, burst, puddle and reform for each kind), `tests/visual/pets.mjs` (saves `docs/signoff/pets/pets-splat.png`)
- Test: `tests/unit/pet-splat.test.js` (budgets: ≤ 1,500 triangles, ≤ 3 materials)

**Interfaces:**
- Consumes: `createSplat` and the pose phases from Task 4.
- **Look:**
  - **Burst:** a quick squash, then 6–10 goo droplets in the pet's colour arcing out and landing.
  - **Puddle:** a glossy, irregular flat blob with a slight rim. The pet's two eyes sit in it, with one blink at the end of the burst.
  - **Kind-specific debris:** the mimic's lid lies tilted in the puddle (with a tooth or two), and the dragonling's wing sticks out of it.
  - **Reform:** the reverse of the burst, ending with a little pop.
  - **Reads from directly above at 48 px per die** (the real game camera). Dark and light colours both read.
- [ ] **Step 1:** Render, look and refine in at least three rounds, as in the creature task, keeping `docs/signoff/pets/splat-round-N.png`. Write the critique per round in the report.
- [ ] **Step 2:** Run the unit tests, the full suite and `npm run test:visual:pets`. All pass, and Read `pets-splat.png`.
- [ ] **Step 3: Commit** `feat(pet): splat, puddle and reform look`

### Task 6: README and checks

- [ ] **Step 1:** README "Dice pet" section: resting, splat and respawn, the two new settings, and the note that a splat is per screen until rolling by hand.
- [ ] **Step 2:** Run `npm run test:visual`, `npm run test:visual:pets` and `npm run test:visual:editors`. Zero errors.
- [ ] **Step 3: Commit** `docs: pet splat in the README`
