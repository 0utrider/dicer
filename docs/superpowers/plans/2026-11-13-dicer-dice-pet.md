# Dicer Dice Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The roller's pet hops in at the edge the dice come from, throws them, watches, reacts to a natural 20 / natural 1 on a d20, and leaves before the dice fade.

**Architecture:**
- **DiceBox gets an optional `pet` hook,** ticked per frame like the effect layer. It learns the throw edge from the seed, using the same first `mulberry32` draw the worker uses.
- **A tiny world-start part:** the pet loader, `petFor()`, settings, and the throw wiring in `dice3d.js`. It decides whose pet, if any, and whether the watcher may see a reaction.
- **Everything else is a lazy chunk:** the timeline, the creatures and the layer.

**Tech Stack:** Plain JS ES modules, three.js 0.184 (WebGL2), Vite 6 lazy chunks, Vitest, Playwright (visual), Foundry v14 user flags and settings.

**Spec:** `docs/superpowers/specs/2026-11-13-dicer-dice-pet-design.md`

## Global Constraints

- Branch `dice-pet`. Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge.
- **World-start budget:**
  - Task 2 re-bases the ratchet reference in `tests/unit/build.test.js` from `4_097_080` to `4_096_854` (today's world start, measured in the main checkout, not in `dicer-repro`, whose `node_modules` junction adds ~116 KB).
  - This plan may spend at most **1,024 bytes** over `4_096_854`.
  - All pet geometry, animation and sound code lives in lazy chunks.
- **Lazy chunks:** the chunk file names match `pet-[^/]+\.js` and are added to `LAZY` in `build/world-start.js`.
- **Timing:** the pet never delays `roll.landed`, `roll.finished`, the chat card or `diceSoNiceRollComplete`. If the chunk is not loaded when a roll reveals, that roll has no pet.
- **Physics:** the pet is not in the physics. The seeded sim result is unchanged by this plan: the same seed gives the same frames.
- **Privacy:**
  - `view === 'none'` → no pet.
  - `view === 'ghost'` → the reaction is always `'plain'`, silent, and the same duration as every reaction.
- **Settings:**

  | Key | Scope | Type | Default |
  | --- | --- | --- | --- |
  | `petsAllowed` | world | Boolean | `true` |
  | `showPets` | client | Boolean | `true` |
  | `petSounds` | client | Boolean | `true` |
  | user flag `dicer.pet` | per user | `{kind: 'none'\|'mimic'\|'slime'\|'dragonling', color: '#rrggbb'}` | `{kind: 'mimic', color: user.color}` |

- **Limits:** at most `MAX_PETS = 3` pets on screen. One pet per roller.
- **Durations (ms):** `ENTER_MS = 350`, `REACT_MS = 1200`, `EXIT_MS = 450`, `QUICK_EXIT_MS = 300`.
- **Reactions:** `'crit'` | `'fumble'` | `'mixed'` | `'plain'`. Only `type === 'd20'` dice count.
- **GLSL/three:** use `MeshStandardMaterial` (not physical). Clamp colours to ≤ 1. On the lowest tier (`tier.shadows === false` or the `shadows` setting off), no pet shadow.
- **Lint:** clean (`npm run lint`). The full suite stays green (`npx vitest run`).

## Review Focus

1. **A roll that never animates** (hidden tab, empty specs, `box.clear()` mid-throw, the canvas torn down): no pet is created, or the pet is removed at once, and the render loop is not kept alive by it. Test in Task 1.
2. **The same user rolls again while their pet is on screen:** the pet is re-used (it throws again), never two pets for one user. After every roll finishes, the layer holds 0 pets. Test in Task 3.
3. **Ghost dice that still carry values** (a GM-side bug or a future change): the reaction is still `'plain'`, because ghosts are ignored in the summary *and* the `ghost` flag forces plain. Test in Task 3.
4. **The pet chunk fails to load or throws in `update`:** the roll plays normally, a single warning, and DiceBox never calls a broken pet again for that roll. Tests in Tasks 1 and 2.
5. **No roller** (API `showForRoll` with no user, a deleted user, a user flag holding junk): `petFor` returns `null` or a valid default, and never throws. Test in Task 2.

---

### Task 1: Throw edge and the DiceBox pet hook

**Files:**
- Modify: `src/core/rng.js` (add `throwEdge`)
- Modify: `src/physics/sim.js:246` (use `throwEdge`'s rule; same draw)
- Modify: `src/throw/dice-box.js` (constructor option, `roll()` option, `#reveal`, `#land`, linger/fade, `#finish`, `clear`, `#frame`)
- Test: `tests/unit/sim.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**
- Produces:
  - `throwEdge(seed: number) -> 0|1|2|3` (0 = +x, 1 = -x, 2 = +z, 3 = -z): equals `Math.floor(mulberry32(seed)() * 4)`.
  - `new DiceBox({ ..., pet })`, where `pet` is a `PetHook | (() => PetHook|null)`, resolved at each roll's reveal.
  - `diceBox.roll(specs, { area, capacityDice, pet })`. `pet` is a `PetSpec|null` from Task 2: `{ userId, kind, color, ghost }`.
  - `PetHook`:
    - `begin(key: string, info: { spec: PetSpec, edge: 0|1|2|3, area: {cx, cz, halfWidth, halfDepth}, centre: () => {x, z} }) -> void`, called once at `#reveal`. `area` is the rectangle sent to the worker, or the stage rectangle when the throw had none. Both are in the worker's units, which are scene units.
    - `landed(key, dice: {type, value, ghost}[]) -> void`, called in `#land` before `resolveLanded`.
    - `leave(key, msLeft: number) -> void`, called when the roll enters `fading`, with `msLeft = FADE_MS`, or `0` on `clear()`/failure.
    - `end(key) -> void`, called in `#finish` and in `clear()`.
    - `update(now: number) -> boolean`: true while any pet moves.
- Every `PetHook` call goes through one `#petCall(fn)` guard. A throw is caught, warns once per roll (`console.warn('Dicer | pet', err)`), and stops pet calls for that roll. A roll is never failed by its pet.

- [ ] **Step 1: Write the failing tests**
  - In `sim.test.js`: `throwEdge matches the worker's spawn edge`. For seeds `[1, 2, 3, 42, 99, 123456, 2**31]`, the first frame's die centres lie beyond the stage on the side `throwEdge(seed)` names. The expected sign of x for edges 0/1 and of z for edges 2/3 is `+` for 0 and 2, `-` for 1 and 3.
  - In `dice-box.test.js`, with a fake pet recording calls:
    - `a roll with a pet spec calls begin at reveal, landed with each die's type/value/ghost, leave on fade, end on finish`. Assert the order `['begin', 'landed', 'leave', 'end']`, the `begin` info's edge `=== throwEdge(seed)` (stub `crypto.getRandomValues`), and the shape of `area`.
    - `no pet spec, no pet calls`.
    - `the loop keeps running while pet.update returns true, and holds once it returns false`: the `#frame` return is `true`, then `'hold'` with the roll lingering.
    - `a pet that throws in update warns once and is not called again for that roll; the roll still lands and finishes`.
    - `clear() mid-throw calls leave(key, 0) and end(key)`.
    - `a hidden tab or empty specs never calls begin`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/sim.test.js tests/unit/dice-box.test.js`. They fail: `throwEdge` is not exported, and no pet calls are made.
- [ ] **Step 3: Implement** `throwEdge` in `src/core/rng.js`, and have `sim.js` take its edge with the same single first draw. Keep `rand()` consumption identical, so every other draw is unchanged. Then add the `pet` option, the `roll()` option, and the hook calls in `dice-box.js`. Include `pet.update(now) === true` in `moving` in `#frame`. When the pet is removed while the loop holds, call `renderer.requestFrame()`.
- [ ] **Step 4: Run** the tests above and the full suite. All pass, including the existing sim determinism tests, unchanged.
- [ ] **Step 5: Commit** `feat(throw): throw edge from the seed; DiceBox pet hook`

### Task 2: Whose pet, settings, loader, wiring

**Files:**
- Create: `src/pet/pet-for.js`, `src/pet/pet-loader.js`, `src/pet/chunk/pets.js` (a stub exporting `createPetLayer`, which returns a no-op `PetHook`; Task 3 fills it in)
- Modify:
  - `src/settings.js`
  - `lang/en.json`
  - `src/api/dice3d.js` (`throwHere`, `_throwLook`)
  - `src/main.js` (pass `pet` to `DiceBox`; request the chunk on idle)
  - `build/world-start.js` (`LAZY` gets `pet-[^/]+\.js`)
  - `tests/unit/build.test.js` (ratchet reference `4_096_854`; comment: dice pet plan, 1,024 B cap)
- Test: `tests/unit/pet-for.test.js`, `tests/unit/pet-loader.test.js`, `tests/unit/dice3d.test.js`, `tests/unit/settings.test.js` (if it lists keys)

**Interfaces:**
- Consumes: Task 1's `DiceBox({pet})`, `roll(specs, {pet})` and `PetHook`.
- Produces:
  - `PET_KINDS = ['none', 'mimic', 'slime', 'dragonling']` (frozen) in `pet-for.js`.
  - `readPet(user) -> {kind, color}`: validates the `dicer.pet` flag. An unknown kind or a bad colour falls back to the defaults (`'mimic'`, `user.color ?? '#c9a227'`).
  - `petFor({ user, view, getSetting }) -> PetSpec|null`. Returns `null` when:
    - `!user`;
    - `view === 'none'`;
    - `getSetting('petsAllowed') === false` or `getSetting('showPets') === false`;
    - or the kind is `'none'`.

    Otherwise it returns `{ userId: user.id, kind, color, ghost: view === 'ghost' }`.
  - `pet-loader.js`: `requestPets(deps) -> Promise<PetLayer|null>`, `getPets() -> PetLayer|null`, and the test seam `_setPetImport(fn)`.
    - The import is `import('./chunk/pets.js')`, made once, then `createPetLayer(deps)`.
    - A failure warns once and resolves `null`, never retried. This is the same shape as `src/render/extras-loader.js`.
  - `createPetLayer({ scene, camera, getTier, getSetting, playSound, warm }) -> PetHook & { dispose() }`.
- Wiring:
  - `throwHere` computes `const pet = petFor({ user: game.users.get(s.senderId), view, getSetting })` and passes it in `roll(dice, { area, pet })`.
  - `_throwLook` passes `petFor({ user: game.user, view: 'real', getSetting })`.
  - `main.js` gives `DiceBox` `pet: () => getPets()` and calls `requestPets({...})` from the same idle callback that prefetches the effect library, only when `petsAllowed` and `showPets` are on. When both later turn on, it requests then.

- [ ] **Step 1: Write the failing tests**
  - `pet-for.test.js`:
    - `no user, none view, either switch off, kind none -> null`.
    - `ghost view -> ghost true`.
    - `junk flag {kind:'cat', color:'red'} -> mimic with the user colour`.
    - `missing flag -> mimic, user colour`.
    - `a user with no colour -> '#c9a227'`.
  - `pet-loader.test.js`:
    - `loads once and shares the layer`.
    - `a failing import warns once and resolves null; getPets stays null; no retry`.
  - `dice3d.test.js`:
    - `throwHere passes the roller's pet spec to diceBox.roll`.
    - `a blind roll seen as ghost passes ghost:true`.
    - `pets off -> pet: null`.
  - The `settings.test.js` key list gains `petsAllowed`, `showPets` and `petSounds`.
- [ ] **Step 2: Run** those files. They fail.
- [ ] **Step 3: Implement** the files and the wiring above. Lang keys:
  - `DICER.Settings.petsAllowed.Name`: "Allow dice pets"
  - `DICER.Settings.petsAllowed.Hint`: "Players' pets hop in to throw their dice and react to a natural 20 or 1."
  - `DICER.Settings.showPets.Name`: "Show dice pets"
  - `DICER.Settings.showPets.Hint`: "See your own and other players' pets when they roll."
  - `DICER.Settings.petSounds.Name`: "Pet sounds"
  - `DICER.Settings.petSounds.Hint`: "Your pet's happy and sad chirps."
- [ ] **Step 4: Run** `npm run build`, then the full suite **in the main checkout**. `build.test.js` passes, and world start is ≤ `4_096_854 + 1_024`. Note the measured bytes in the report.
- [ ] **Step 5: Commit** `feat(pet): pet choice, settings, lazy loader and throw wiring`

### Task 3: The pet layer and its timeline

**Files:**
- Create: `src/pet/chunk/timeline.js`, `src/pet/chunk/reaction.js`
- Modify: `src/pet/chunk/pets.js` (the real layer, replacing the stub)
- Test: `tests/unit/pet-timeline.test.js`, `tests/unit/pet-layer.test.js`

**Interfaces:**
- Consumes: the `PetHook` contract (Task 1) and `createPetLayer(deps)` (Task 2). Creatures come from Task 4 through `CREATURES[kind](color) -> Creature`. This task ships a placeholder `CREATURES` entry for every kind: a coloured box with the `Creature` interface below, which Task 4 replaces.
- Produces:
  - `summarize(dice: {type, value, ghost}[], ghost: boolean) -> 'crit'|'fumble'|'mixed'|'plain'`. It ignores ghost dice and non-d20s; `ghost === true` always gives `'plain'`.
  - `phaseAt(track, now) -> { phase: 'enter'|'throw'|'watch'|'react'|'exit'|'gone', t: number }`, where `t` runs 0..1 within the phase.
    - `track = { beganAt, landedAt?, leaveAt?, leaveMs? }`.
    - Enter is `ENTER_MS` from `beganAt`, then throw (`250` ms), then watch until `landedAt`, then react (`REACT_MS`), then exit (`EXIT_MS`), then gone.
    - `leave(key, msLeft)` caps the end: the exit starts no later than `leaveAt + msLeft - QUICK_EXIT_MS` and lasts `QUICK_EXIT_MS`, or is instant when `msLeft === 0`.
  - `Creature`:
    - `{ root: THREE.Object3D, height: number, pose(phase, t, reaction, look: {yaw: number}) -> void, dispose() -> void }`.
    - The pose is local to `root`: squash, limbs, eyes. The layer owns `root`'s position and yaw.
  - Layer behaviour:
    - `begin` places `root` at the area edge named by `edge`, inset by `0.6 × height` from the edge, on the line through the area centre, at y = 0, facing inward.
    - A roller whose pet is already present re-uses it: the track is restarted from `throw`, with no re-enter.
    - When more than `MAX_PETS` pets would be present, the new one is skipped.
    - The watch yaw follows `centre()`.
    - `landed` stores `summarize(dice, spec.ghost)`.
    - When the reaction starts, it calls `playSound({builtin: 'petHappy'})` for crit or `'petSad'` for fumble, only if `getSetting('petSounds') !== false && getSetting('sounds') !== false`.
    - `update` returns true while any pet is not `gone`.
    - A `gone` pet is removed from the scene and disposed.
    - `end(key)` removes that roll's pet at once, unless another of the same roller's rolls still uses it.
    - The contact shadow is a soft disc mesh under the root, hidden when `getTier().shadows === false || getSetting('shadows') === false`.
    - `warm([...roots])` is called once at creation, with one of each creature, so the first pet compiles no programs mid-roll.

- [ ] **Step 1: Write the failing tests**
  - `pet-timeline.test.js`:
    - `phases in order with exact boundaries` (0 → enter; 350 → throw; 600 → watch; landedAt → react; landedAt + 1200 → exit; + 450 → gone).
    - `leave caps the exit before the fade ends`.
    - `leave with 0 is instant`.
    - `summarize`:
      - `[{d20, 20}]` → crit;
      - `[{d20, 1}]` → fumble;
      - `[{d20, 20}, {d20, 1}]` → mixed;
      - `[{d6, 6}]` → plain;
      - `[{d20, 20, ghost: true}]` → plain;
      - `[{d20, 20}]` with `ghost = true` → plain.
  - `pet-layer.test.js`, with fake scene and settings:
    - `begin places the pet inside the named edge, outside the inner 60% of the area`. Check all 4 edges.
    - `same roller twice -> one pet; after both rolls end the layer holds 0 pets and the scene has no pet objects`.
    - `a fourth roller gets no pet`.
    - `crit plays petHappy, fumble petSad, mixed/plain silent; petSounds off -> silent`.
    - `a ghost roll's reaction lasts exactly as long as a crit's`.
    - `update returns false once every pet is gone`.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement** `timeline.js`, `reaction.js` and the layer in `pets.js`.
- [ ] **Step 4: Run** them and the full suite. All pass.
- [ ] **Step 5: Commit** `feat(pet): pet layer, timeline and reactions`

### Task 4: The three creatures

**Files:**
- Create:
  - `src/pet/chunk/creatures/mimic.js`
  - `src/pet/chunk/creatures/slime.js`
  - `src/pet/chunk/creatures/dragonling.js`
  - `src/pet/chunk/creatures/index.js` (exports `CREATURES`)
  - `dev/pets.html`
  - `dev/pets.js`
  - `tests/visual/pets.mjs`
- Modify:
  - `src/pet/chunk/pets.js` (use the real `CREATURES`)
  - `package.json` (`"test:visual:pets": "node tests/visual/pets.mjs"`)
- Test: `tests/unit/pet-creatures.test.js`

**Interfaces:**
- Consumes: the `Creature` interface (Task 3).
- Produces: `CREATURES: { mimic, slime, dragonling }`, each `(color: string) -> Creature`. `height` is about 1.0 (a d20 is ~1 scene unit; match `getShape('d20')`'s size).
- **Look:**
  - **Mimic:** a rounded box body (a d6 with a hinged lid), two eyes on the lid edge, four stubby legs. On a crit the lid flaps; on a fumble the lid shuts and the body sinks.
  - **Slime:** a squashed sphere (scaled `SphereGeometry`, 16×12) with two eyes and slight transparency (`opacity 0.85`). It squash-stretches on every hop; on a crit it springs high; on a fumble it melts flat to `scale.y 0.4`.
  - **Dragonling:** an ellipsoid body and head, a cone snout, two wing planes (`DoubleSide`), a tapered tail chain, and eyes. On a crit the wings flap and it spins 360°; on a fumble the wings and head droop.
  - **All of them:**
    - The body colour is the user colour. Belly or accents are the colour lightened 30%. Eyes are white with a near-black pupil.
    - Pupils follow `look.yaw`.
    - Exit and enter are hops toward and away from the edge, done by the layer. The creature only squashes.
    - Each creature's geometry is ≤ 2,500 triangles, with ≤ 3 materials.
- [ ] **Step 1: Write the failing tests**
  - `pet-creatures.test.js`, for each kind:
    - `builds a root with height ~1 (0.8..1.2)`.
    - `≤ 2500 triangles`.
    - `≤ 3 distinct materials, all MeshStandardMaterial`.
    - `pose() for every phase and reaction leaves no NaN in any matrix`.
    - `dispose frees every geometry and material` (spy on `dispose`).
- [ ] **Step 2: Run** it. It fails.
- [ ] **Step 3: Implement** the creatures. Then build `dev/pets.html`: a grid of 3 kinds × the phases `enter, throw, watch, react(crit), react(fumble), react(mixed)`, rendered with the real `createScene()` studio lighting. Then write `tests/visual/pets.mjs`, which saves `docs/signoff/pets/pets-grid.png` and fails on any console error or shader error. Model it on `tests/visual/editors.mjs`, with the same vite start and GPU args.
- [ ] **Step 4: Run** the unit test, the full suite and `npm run test:visual:pets`. All pass. Read `pets-grid.png`: each creature is recognisable, and the crit and fumble poses read differently.
- [ ] **Step 5: Commit** `feat(pet): mimic, slime and dragonling`

### Task 5: Pet sounds

**Files:**
- Modify: `src/audio/synth.js` (the generators `*petHappy`, `*petSad`, and `RESULT_DUR` entries), `src/audio/sound-names.js` (`RESULT_SOUNDS` gains `'petHappy'` and `'petSad'`)
- Test: `tests/unit/synth.test.js` (or whichever test enumerates `RESULT_SOUNDS`), `tests/unit/sound-engine.test.js`

**Interfaces:**
- Produces: `soundEngine.result({builtin: 'petHappy'|'petSad'})` plays them.
  - `petHappy`: three rising chirps, 0.45 s.
  - `petSad`: a falling two-note whimper, 0.6 s.
- Pick the voices with `voice()`. Peak ≤ the level of `fanfare`.

- [ ] **Step 1: Write the failing tests:**
  - `petHappy and petSad render non-silent, peak ≤ fanfare's peak, length = RESULT_DUR`.
  - `they are offered nowhere in the trigger editor's sound list`. They are pet-only. Filter them out where `RESULT_SOUNDS` feeds UI choices, if it does.
- [ ] **Step 2: Run.** It fails.
- [ ] **Step 3: Implement** the sounds.
- [ ] **Step 4: Run** the tests and the full suite. All pass.
- [ ] **Step 5: Commit** `feat(audio): pet chirps`

### Task 6: Pet section in the appearance editor, README

**Files:**
- Modify:
  - `src/ui/appearance-editor.js`
  - `src/ui/appearance-form.js` (if the form model owns fields)
  - `templates/appearance-editor.hbs`
  - `styles/dicer.css`
  - `lang/en.json`
  - `README.md`
  - `tests/visual/editors.mjs` (shot `appearance-pet.png`)
- Test: `tests/unit/appearance-editor.test.js`

**Interfaces:**
- Consumes: `PET_KINDS` and `readPet(user)` (Task 2).
- **Behaviour:**
  - A collapsible "Pet" section, last among the layer sections.
  - Chips for None / Mimic / Slime / Dragonling (Font Awesome icons: `fa-ban`, `fa-box-open`, `fa-droplet`, `fa-dragon`) and a colour input.
  - The section edits the current user's flag `dicer.pet` directly: `game.user.setFlag('dicer', 'pet', {kind, color})` on change. It is not part of the look or theme being edited.
  - It is hidden when `petsAllowed` is off.
  - The Throw button already throws with the user's pet (Task 2's `_throwLook`).
- **Lang:**
  - `DICER.Appearance.Pet.Title` "Pet"
  - `.Hint` "Your pet throws your dice and reacts to a natural 20 or 1. Everyone sees it."
  - `.None` "None"
  - `.Mimic` "Mimic"
  - `.Slime` "Slime"
  - `.Dragonling` "Dragonling"
  - `.Color` "Colour"

- [ ] **Step 1: Write the failing tests:**
  - `the pet section shows the user's current pet`.
  - `choosing slime saves {kind:'slime', color} to the user flag`.
  - `a colour change saves`.
  - `the section is absent when petsAllowed is off`.
  - `saving the look does not write the pet into the theme`.
- [ ] **Step 2: Run.** It fails.
- [ ] **Step 3: Implement** the section. Then add a README "Dice pet" section covering what it does, the three settings, picking a pet, and the privacy note.
- [ ] **Step 4: Run** the tests, the full suite and `npm run test:visual:editors`. All pass. Read `appearance-pet.png`.
- [ ] **Step 5: Commit** `feat(ui): pick your dice pet in the appearance editor`

### Task 7: Owner look check and bench

- [ ] **Step 1:** Run `npm run test:visual` and `npm run test:visual:pets`. Expect zero shader errors.
- [ ] **Step 2:** Run `npm run test:live:bench -- --quick --only throttled`. Expect no regression beyond the harness's noise band against the last recorded run. If it cannot run (Foundry is not up), say so in the ledger.
- [ ] **Step 3:** Owner look check in Foundry, as steps for the owner:
  - Pick each pet.
  - `/r 1d20` until a 20 and a 1 come up.
  - `/r 2d20kh` for the mixed reaction.
  - A blind GM roll seen by a player: the player sees a neutral pet.
  - Three players rolling at once.
  - The settings off.
