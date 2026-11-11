# Dicer Plan 6 — Rolling by Hand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player grabs the dice, shakes, flicks — and the face that physically lands up is the roll result, fed to Foundry as a dice fulfillment method so every system's attacks, saves and damage work unchanged; every other screen replays the exact same throw before the chat card appears; a dice tray lets anyone roll freely.

**Architecture:**

- **Physics decides.** A new "free" die mode skips today's face forcing: Playback reads the top face from the settled pose and reports the value. The worker nudges cocked dice and dice that settle outside the area until they rest cleanly, so the reading is always unambiguous.
- **Foundry asks, Dicer throws.** Dicer registers an interactive fulfillment method `dicer` in `CONFIG.Dice.fulfillment.methods` with its own `RollResolver` subclass. When a roll needs fulfilling, the resolver opens a throw overlay for all the roll's dice at once, waits for them to land, writes the read values into the terms, and lets Foundry finish evaluating and create the message.
- **The thrower is authoritative.** The thrower's client simulates the throw from the release (or a seeded "throw for me"), records the trajectory, quantizes it, and — once its chat message exists, so the roll mode is known — sends it only to the users who may see the result. Their message gate holds the card, replays that trajectory, then reveals. No cross-client determinism is needed.

**Tech Stack:** Plain JS ES modules, three.js 0.184, Rapier3D deterministic (worker), Foundry v14 dice fulfillment (`CONFIG.Dice.fulfillment`, `RollResolver`, core setting `diceConfiguration`), ApplicationV2, Vite 6, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md` — G10 (rolling by hand), with G1 privacy, G2 size/idle, §5 physics.

**Foundry facts this plan relies on** (read from the installed v14 client, `resources/app/client`): `CONFIG.Dice.fulfillment.methods[id] = {label, icon, interactive, handler?, resolver?}`; the per-user core client setting `diceConfiguration` maps denomination → method id (`default` key too); `Roll#_evaluate` creates `new this.constructor.resolverImplementation(this)` and awaits `resolver.awaitFulfillment()` unless `allowInteractive === false`; `Roll.resolverImplementation` uses a method's custom `resolver` only when the user's configured interactive methods are exactly that one method; `RollResolver#close()` fills unfilled dice with `term.randomFace()` (never rejects); extra results (explode/reroll) go through `resolver.resolveResult(term, method, options)`; `Roll#toMessage` evaluates with `allowInteractive: messageMode !== 'blind'`, so blind rolls never open a resolver; fulfillment always finishes before the chat message is created.

## Design calls made in this plan (owner can overturn)

- **P6-D1 Blind rolls follow Foundry: never thrown by hand from a sheet.** Foundry itself skips interactive fulfillment for blind rolls. The G10 blind behaviour (dice turn to ghosts on release) applies to the free-roll tray, where Dicer controls the roll mode. Cost if wrong: patching `Roll#toMessage`, which other modules also wrap.
- **P6-D2 The trajectory is sent after the chat message exists.** Only then are the whisper list and roll mode known, so recipients can be chosen safely. Receivers hold the card (hidden, as today) until the trajectory arrives. Cost if wrong: ~one socket round trip of extra delay before others see the card.
- **P6-D3 Explosions and rerolls throw extra dice automatically** with real physics (the "throw for me" path), shown to the thrower, rather than asking for another grab. Cost if wrong: an extra grab prompt per extra die.
- **P6-D4 Hand rolls are off by default** per user (Off / Ask each time / Always); the GM's permission setting defaults to allowing everyone. A per-user opt-in matches the spec's "per-user setting". Cost if wrong: flip a default.
- **P6-D5 Receivers place the thrower's trajectory at the centre of their own resolved area**, scaling only the horizontal offsets down when their area is smaller. Dice keep their size. Cost if wrong: dice may sit closer together on small screens than on the thrower's.
- **P6-D6 The full fairness run is a separate script** (`npm run test:fairness`, 10,000 throws per die type), not part of the pre-commit suite; the suite runs a fixed-seed smoke version. Cost if wrong: fairness regressions caught only when the script is run.

## Global Constraints

- **Physics decides (G10):** in hand mode the reported value is the face that is physically up (largest world normal Y; d4 reads the face down). Never rotate a free die to a chosen value.
- **Privacy (G1):** a trajectory carries the real faces, so it goes only to users whose view of the message is `real`; secret and whispered rolls reach recipients only; ghost viewers get the usual ghost throw. Nothing about a hand roll reaches a user who may not see its result.
- **`diceSoNiceRollComplete` fires exactly once per animated message** on every client, including fallbacks (no trajectory arrives, the thrower times out).
- **Nothing hangs:** the throw prompt times out (default 60 s) and falls back to Foundry's own random result, noted on the chat card; a missing trajectory falls back to a normal (forced) animation after `HAND_REPLAY_WAIT_MS = 4000`.
- **Fairness (G10):** chi-square over ≥ 10,000 throws per die type passes at p > 0.01 for d2, d4, d6, d8, d10, d12, d20 (script); colliders match the visual dice.
- **Download size:** world start ≤ 4 MiB (headroom ~93 KiB). The throw overlay, the tray picker, the trajectory codec and the fairness tooling are lazy chunks or dev-only; the main bundle gains only the fulfillment registration, the resolver shell, the gate hold and the socket kind (target ≤ 12 KiB minified).
- **Idle (G2):** nothing runs while no throw is in progress; the overlay removes its listeners and DOM on close.
- **Settings (§5):** every feature has its own setting.
- **Defensive integration:** a malformed or oversized trajectory payload is ignored (one warning) and the receiver falls back; a spoofed sender is rejected (P3-R15 sender check).
- **Tests:** `tests/unit/*.test.js`; `rtk proxy npx vitest run <file>`; build `node node_modules/vite/bin/vite.js build`; Windows: write scripts to files.

## Review Focus

1. **A die that lands cocked, on its edge (coin), or outside the area.** Expected: nudged until clean; the value read is the clean top face; the recorded trajectory includes the nudge so every screen sees it (tests in Task 1).
2. **The thrower closes the prompt, alt-tabs, or never throws.** Expected: after the timeout Foundry's random result is used, the card says "rolled automatically", nothing hangs, RollComplete fires once (test in Task 6).
3. **A whispered or secret hand roll.** Expected: only recipients receive the trajectory; others see nothing (or a ghost throw if they see ghosts); a player who may not see it never gets the faces (test in Task 7).
4. **A trajectory that never arrives or is garbage.** Expected: the receiver reveals after a normal forced animation of the message's real result within `HAND_REPLAY_WAIT_MS`; oversized or spoofed payloads are ignored (test in Task 7).
5. **A roll with explosions or many dice (8d6 fireball, 3d6 exploding).** Expected: one grab for the initial dice, extra dice thrown automatically, every value read physically, total correct (test in Task 6).

---

## File Structure

| File                                                                                                                     | Responsibility                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `src/core/face-reader.js`                                                                                                | `readTopFace` + cockedness measure.                                           |
| `src/physics/sim.js`, `protocol.js`, `physics-client.js`                                                                 | Launch overrides, nudging cocked / out-of-area dice.                          |
| `src/throw/playback.js`, `src/throw/dice-box.js`                                                                         | Free dice (read, don't force), results promise, recording, `replay`.          |
| `src/hand/trajectory.js` (new, lazy)                                                                                     | Quantize / encode / decode trajectories.                                      |
| `src/hand/throw-overlay.js` (new, lazy)                                                                                  | Grab, shake, flick, "throw for me", countdown.                                |
| `src/hand/fulfillment.js` (new, main bundle, small)                                                                      | Method registration, `DicerResolver`, settings sync with `diceConfiguration`. |
| `src/hand/hand-sync.js` (new)                                                                                            | Trajectory broadcast and receipt; gate hold/replay.                           |
| `src/hand/tray.js` (new, lazy), `templates/dice-tray.hbs`                                                                | Free-roll tray.                                                               |
| `src/foundry/message-gate.js`, `src/api/dice3d.js`, `src/main.js`, `src/settings.js`, `lang/en.json`, `styles/dicer.css` | Wiring, chat icon, settings.                                                  |
| `scripts/fairness.mjs` (new), `docs/research/fairness.md` (new)                                                          | Fairness run and report.                                                      |

---

### Task 1: Free dice — read the physical face, nudge until clean

**Files:**

- Modify: `src/core/face-reader.js`, `src/physics/sim.js`, `src/physics/protocol.js`, `src/throw/playback.js`, `src/throw/dice-box.js`
- Test: `tests/unit/face-reader.test.js`, `tests/unit/sim.test.js`, `tests/unit/playback.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**

- Produces:
  - `topFaceClearance(shape, q) -> number`: the difference between the largest and second-largest world normal Y among faces (0 = perfectly cocked); for d4 use the down-reading equivalent; for a coin, `|normal.y|` of the caps (≈ 0 means on its edge).
  - `COCKED_CLEARANCE` per shape kind (constants in `face-reader.js`, chosen so a die resting flat always passes and a die leaning on an edge or another die fails; pin with tests).
  - Sim: when a throw is marked `free: true`, after the dice settle the sim checks each die; a die with clearance below `COCKED_CLEARANCE`, or whose centre lies outside the throw area, gets a small seeded impulse (cocked: random angular impulse; outside: linear impulse toward the area centre plus spin) and the simulation continues in the same world, up to `MAX_NUDGES = 3` per die; frames keep streaming, so the nudge is part of the trajectory. `MAX_STEPS` becomes `MAX_STEPS + MAX_NUDGES × NUDGE_STEPS` for free throws only. Non-free throws are unchanged (determinism hashes still pass).
  - `DieSpec.free = true` (value optional): Playback's `_applyResults` skips `rotationToShow` for free dice and instead records `die.readValue = shape.values[readTopFace(shape, q)]` (d100 tens die: value × 10 with 0 for "10"; ones die: 10 → 10, as the existing d100 split expects). Inner rotation stays identity (model dice keep `modelQuat`).
  - `DiceBox.roll(specs, opts)` returns `{landed, finished, values}` where `values: Promise<number[]>` resolves at landing with each die's read value in spec order (forced dice report their forced value).
- [ ] **Step 1: Failing tests:** clearance is ≥ the threshold for each shape resting on each face and below it for a pose balanced on an edge; a coin standing on its rim is cocked; a free sim throw with a die started balanced on an edge ends with that die clean (and a nudge visible in the frames); a die forced to start outside the area ends inside; same seed + same free request → identical frames; non-free throws keep the Plan-5 determinism hashes; Playback reads (not forces) free dice, values match `readTopFace`; DiceBox `values` resolves in spec order; d100 tens/ones read correctly.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(hand): free dice read the physical face and settle cleanly`.

---

### Task 2: Throws from a release, and "throw for me"

**Files:**

- Modify: `src/physics/sim.js`, `src/physics/physics-client.js`, `src/throw/dice-box.js`
- Test: `tests/unit/sim.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**

- Produces:
  - `sim.throw({dice, seed, area, free, launch?})`: `launch = [{pos: [x,y,z], quat: [x,y,z,w], linvel: [x,y,z], angvel: [x,y,z]}]` per die (die units, stage-centred). With `launch`, dice start at those states (positions clamped inside the area horizontally, height clamped to [1, 6]), all four area walls are active from step 0 (no spawn edge), and the `rand()` stream is still consumed in the same order so dice without a launch entry behave as before.
  - "Throw for me" = a free throw without `launch` (today's seeded spawn, read not forced).
  - `DiceBox.roll(specs, {area, capacityDice, launch, record})` passes `launch` through (converted from the overlay's screen units by the overlay itself, Task 5); `record: true` keeps every chunk (`frames: Float32Array`, `events`) for Task 4.
  - Release speeds are capped (`MAX_RELEASE_SPEED` die units/s, `MAX_RELEASE_SPIN` rad/s) so a wild flick can't tunnel or fling dice off-stage.
- [ ] **Step 1: Failing tests:** a launched throw starts exactly at the given states (first frame), stays within the area walls, settles; a launch outside the area is clamped in; extreme velocities are capped; dice without launch entries match the seeded spawn; `record` returns all chunks.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(hand): throws from a release state`.

---

### Task 3: Fairness

**Files:**

- Create: `scripts/fairness.mjs`, `docs/research/fairness.md`
- Modify: `package.json` (`test:fairness`)
- Test: `tests/unit/fairness.test.js`

**Interfaces:**

- `chiSquare(counts) -> {stat, df, p}` (in `scripts/fairness.mjs`, exported for tests; p from the chi-square CDF via the regularized gamma function).
- The script runs, per die type (d2, d4, d6, d8, d10, d12, d20), 10,000 free throws in the real Rapier sim (node, one die per throw, seeds 1..10000, random launch velocities and spins drawn like a human flick, plus the seeded spawn for half), reads each top face, and prints/records counts, χ², p. It exits non-zero if any p ≤ 0.01. It writes `docs/research/fairness.md` (method, counts table, p per type, date, commit).
- If a shape fails, the cause (collider vs visual mismatch, centre of mass, chamfer bias) is investigated and fixed in the sim/collider before this task completes; the report records it.
- Unit smoke (in the suite): d6 and d20, fixed seeds, 600 and 1,200 throws, p > 0.001 (deterministic, so not flaky), and `chiSquare` against known values.
- [ ] **Step 1:** failing `chiSquare` tests; smoke tests.
- [ ] **Step 2–4:** implement, run the smoke in the suite, then `npm run test:fairness` (report its runtime); fix any failing shape.
- [ ] **Step 5: Commit** `test(hand): physics dice fairness check and report`.

---

### Task 4: Trajectory recording, encoding and replay

**Files:**

- Create: `src/hand/trajectory.js` (lazy chunk)
- Modify: `src/throw/dice-box.js`, `tests/unit/build.test.js`
- Test: `tests/unit/trajectory.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**

- Produces:
  - `encodeTrajectory({frames, steps, dice, area, settledStep, values, events}) -> {v: 1, n, steps, stride, area, settledStep, values, pos: string, rot: string, events?: string}`: keeps every `TRAJ_STRIDE = 2`nd step (30 Hz) plus the final step; positions relative to the area centre quantized to int16 at `1/512` die unit; rotations quantized smallest-three (2 bits index + 3 × int16); base64 strings. Impacts kept (step, die, other, speed as uint16/int8) so receivers hear the same clatter.
  - `decodeTrajectory(payload, {maxDice = 100, maxSteps}) -> {frames: Float32Array, steps, dice, area, settledStep, values, events}` or `null` for malformed input; intermediate steps rebuilt by lerp/slerp.
  - `MAX_TRAJECTORY_BYTES = 262144` (encoded size cap; decode refuses larger).
  - `DiceBox.replay(specs, decoded, {area}) -> {landed, finished}`: builds dice as `roll` does but feeds Playback from the decoded frames (no physics), positions offset to this client's area centre with the P6-D5 horizontal scale; free dice show their recorded values (the reader agrees because the pose is the recorded pose).
- [ ] **Step 1: Failing tests:** round trip error ≤ 1/256 die unit and ≤ 0.5° on a real recorded throw; final frame exact enough that `readTopFace` gives the same values; encoded size for 10d6 typical throw under 32 KiB; malformed/oversized → null; replay lands with the recorded values; area offset/scale applied.
- [ ] **Step 2–4:** run, implement, pass; build; lazy list.
- [ ] **Step 5: Commit** `feat(hand): record, encode and replay throws`.

---

### Task 5: The throw overlay

**Files:**

- Create: `src/hand/throw-overlay.js` (lazy chunk), styles
- Modify: `lang/en.json`, `tests/unit/build.test.js`
- Test: `tests/unit/throw-overlay.test.js` (jsdom)

**Interfaces:**

- Produces `openThrowOverlay({specs, area, diceBox, timeoutMs, ghostOnRelease = false, label}) -> Promise<{values: number[], recording} | {cancelled: true} | {timedOut: true}>`:
  - Full-screen transparent overlay above the board. The dice appear held under the pointer (rendered by DiceBox in a "held" pose that follows the pointer and jiggles with shake energy; no physics while held). Pointer down grabs; moving shakes; release throws. Touch works the same.
  - Release state from the last 120 ms of pointer samples: `velocityFromSamples(samples, diePx) -> [vx, vz]` (screen px/s → die units/s, capped), lift from flick speed, spin from accumulated shake energy plus seeded jitter: `spinFromShake(energy, rng) -> [x,y,z]`.
  - **Throw for me** button and Space key: a seeded free throw.
  - Countdown (`timeoutMs`) shown; Esc or Cancel cancels; window blur pauses nothing (timeout still runs).
  - `ghostOnRelease`: on release the dice render as ghost dice on this screen (tray blind rolls, P6-D1) — the values are still read.
  - Removes all DOM and listeners on settle.
- [ ] **Step 1: Failing tests:** `velocityFromSamples` (direction, scale, cap, too-few samples → gentle default); `spinFromShake` bounded and seeded; Space triggers a launch-less throw; Esc resolves `{cancelled: true}`; timeout resolves `{timedOut: true}`; listener-leak spy test (add/remove counts match).
- [ ] **Step 2–4:** run, implement, pass; build; lazy list.
- [ ] **Step 5: Commit** `feat(hand): throw overlay`.

---

### Task 6: The fulfillment method and resolver

**Files:**

- Create: `src/hand/fulfillment.js`
- Modify: `src/main.js`, `src/settings.js`, `lang/en.json`
- Test: `tests/unit/fulfillment.test.js`

**Interfaces:**

- Produces:
  - Settings:

    | Key                 | Scope  | Type                                                                                                                | Default |
    | ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- | ------- |
    | `handRolls`         | client | String (`off`/`ask`/`always`)                                                                                       | `off`   |
    | `handRollTypes`     | client | Array of denominations, `config: false` (edited via a small form or checkboxes in the setting hint UI; empty = all) | `[]`    |
    | `handRollsAllowed`  | world  | String (`all`/`trusted`/`gm`/`none`)                                                                                | `all`   |
    | `handRollsRequired` | world  | Boolean                                                                                                             | false   |
    | `handRollTimeout`   | world  | Number (10–300 s)                                                                                                   | 60      |

  - At `init`: `CONFIG.Dice.fulfillment.methods.dicer = {label: 'DICER.Hand.Method', icon: '<i class="fa-solid fa-hand"></i>', interactive: true, resolver: DicerResolver}`.
  - `syncDiceConfiguration({getSetting, user, setCore})`: at `ready` and whenever the settings above change, writes the user's core `diceConfiguration` so each chosen denomination maps to `dicer` when hand rolls are on and allowed (`required` forces all denominations to `dicer` for allowed users), and removes Dicer's entries otherwise — never touching entries that point to other methods.
  - `class DicerResolver extends foundry.applications.dice.RollResolver`:
    - `awaitFulfillment()`: collects the roll's fulfillable terms whose method is `dicer` (manual-method terms are delegated to `super`); `ask` mode first shows a small prompt ("Throw by hand" / "Roll automatically"); builds free DieSpecs (d100 → two d10 specs; `c` coin → d2), resolves the roller's area (Plan 5 resolver), lazily imports the overlay and opens it with `handRollTimeout`.
    - On landing: pushes `{result, active: true}` into each term's `results` in order (as Foundry's `_fulfillRoll` does), stores `roll.options.dicerHand = {id, by: userId}` and keeps the recording keyed by `id` for Task 7.
    - On timeout/cancel: lets `close()` fill random faces (Foundry behaviour) and sets `roll.options.dicerHand = {id, fallback: true}`.
    - `resolveResult(term, method, options)` for extra dice: a seeded free throw of one die in the same area (P6-D3), returning its read value.
    - Fires `diceSoNicePendingThrowOpened(roll)` when the overlay opens and `diceSoNicePendingThrowClosed(roll)` when it closes (`SlotsBound` is not emitted; documented).
- [ ] **Step 1: Failing tests** (with Foundry globals stubbed and a fake overlay): method registered with the resolver; `syncDiceConfiguration` writes/removes only Dicer entries, honours `handRollTypes`, `allowed` and `required`; resolver fills `term.results` from the overlay values in order for `2d6 + 1d20`; d100 maps tens/ones; `ask` + "Roll automatically" fills random faces without opening the overlay; Review Focus 2 — timeout and cancel produce random faces and `fallback: true`; Review Focus 5 — `3d6x` with explosions throws extras automatically and the term totals match the read values; manual terms go to `super`; pending-throw hooks fire once each.
- [ ] **Step 2–4:** run, implement, pass; size check (main bundle growth noted).
- [ ] **Step 5: Commit** `feat(hand): fulfillment method and resolver`.

---

### Task 7: Everyone sees the same throw

**Files:**

- Create: `src/hand/hand-sync.js`
- Modify: `src/foundry/message-gate.js`, `src/compat/sync.js` (accept a second payload kind), `src/main.js`
- Test: `tests/unit/hand-sync.test.js`, `tests/unit/message-gate.test.js`

**Interfaces:**

- Consumes: Tasks 4 and 6; `recipientsFor` logic and the sender check from `src/compat/sync.js` / `src/api/dice3d.js`; `viewFor`.
- Produces:
  - Thrower client, on its own `createChatMessage` for a message whose rolls carry `options.dicerHand` (not fallback): encodes the stored recording (lazy `trajectory.js`) and emits `{v: 1, kind: 'hand', id, messageId, userId, trajectory}` to the users whose view of that message is `real` (blind → GMs; whisper → recipients + GMs; secret → GMs; public → everyone), never to others. The thrower's own gate does not re-animate the message: it fires `diceSoNiceRollStart` and `diceSoNiceRollComplete` once and reveals immediately (the dice already landed in the overlay).
  - Receivers: the gate recognizes a hand message (`rolls[*].options.dicerHand`) and, for a `real` view, holds the card and waits up to `HAND_REPLAY_WAIT_MS = 4000` for the matching `hand` payload (buffered if it arrived first; buffer entries expire after 30 s); on arrival it replays with `DiceBox.replay` in the roller's area, then reveals and fires RollComplete once. On timeout or a bad payload it falls back to the normal forced animation of the message's real results. Ghost and none views behave exactly as for any other message (no trajectory involved).
  - Payload checks: sender id must equal `userId` and the message author; decoded size ≤ `MAX_TRAJECTORY_BYTES`; dice count ≤ `maxDice`; values must equal the message's dice results (else ignored → fallback).
- [ ] **Step 1: Failing tests:** recipients for public / whisper / blind / secret; a player not allowed to see a whispered hand roll receives nothing; the receiver replays the trajectory and reveals after landing; payload before message and message before payload both work; Review Focus 4 — no payload → forced animation within the wait; spoofed sender, oversized payload, or values that don't match the message → ignored + fallback; the thrower's gate fires RollStart/RollComplete exactly once without throwing; fallback hand rolls (timeout) animate normally everywhere.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(hand): everyone sees the same throw`.

---

### Task 8: Chat card marks and the free-roll tray

**Files:**

- Create: `src/hand/tray.js` (lazy chunk), `templates/dice-tray.hbs`
- Modify: `src/main.js` (`renderChatMessageHTML` mark; scene control button), `src/settings.js` (`diceTray`, client Boolean, true), `lang/en.json`, `styles/dicer.css`, `tests/unit/build.test.js`
- Test: `tests/unit/tray.test.js` (jsdom), `tests/unit/main-hooks.test.js`

**Interfaces:**

- Produces:
  - Chat card: a roll with `options.dicerHand` (not fallback) gets a small hand icon with a tooltip "Rolled by hand"; a fallback roll gets "Rolled automatically (no throw)". Visible to everyone who sees the card.
  - Tray: a token-controls (or notes) scene control button "Dice tray" (`getSceneControlButtons`), shown when `diceTray` is on and hand rolls are allowed for the user. Opens a small picker (lazy): counts per die type (d4–d20, d100, d2), a modifier, the roll mode (public / private GM / blind GM / self), Throw. The tray throws through the overlay (blind → `ghostOnRelease`), builds the Roll from the read values (`Roll.fromData` of the formula with filled results, or a temporary non-interactive method whose handler returns the read values in order — the builder picks the one that works with v14's handler lookup and tests it), and posts it with `toMessage` in the chosen mode, carrying `options.dicerHand` so Task 7 replays it.
  - The pure `formulaFromCounts(counts, modifier) -> string` helper.
- [ ] **Step 1: Failing tests:** `formulaFromCounts` (`{d6: 2, d20: 1}, +3` → `2d6 + 1d20 + 3`); the card mark for hand / fallback / normal rolls; the tray builds a Roll whose dice results equal the thrown values and total is correct; blind mode opens the overlay with `ghostOnRelease`; the button only appears when allowed.
- [ ] **Step 2–4:** run, implement, pass; build; lazy list.
- [ ] **Step 5: Commit** `feat(hand): chat marks and the dice tray`.

---

### Task 9: Review page, live checks and docs

**Files:**

- Create: `dev/hand.html`, `dev/hand.js`, `tests/live/hand.mjs`
- Modify: `docs/live-checks.md`, `README.md`, `package.json` (`test:live:hand`)

**Interfaces:**

- `dev/hand.html`: the overlay on the studio stage — grab/shake/flick, Throw for me, a cocked-die demo (start a die on an edge and watch the nudge), and a replay of the last throw from its encoded trajectory side by side.
- Live test (owner-run, GM + player): the player enables hand rolls (Always), makes a public `1d20` roll via `Roll#toMessage` with the overlay's "throw for me" triggered by script; the GM client receives a `hand` payload and its replay's final values equal the chat card's result; a whispered-to-GM hand roll never reaches a second player's socket handler (debug counter); a timeout fallback marks the card.
- `docs/live-checks.md`: real mouse and touch throws; system rolls in PF2e and dnd5e (attack, save, damage with crit doubling); exploding dice in a system that uses them; the dice tray in each roll mode; Foundry's own Dice Configuration menu showing "Dicer (by hand)".
- README: Rolling by hand (settings, how to throw, tray, trust note: hand rolls are as trustworthy as Foundry's manual entry; the GM can disable them), fairness report link.
- [ ] **Step 1:** dev page runs with no console errors.
- [ ] **Step 2:** live test; `node --check`.
- [ ] **Step 3:** docs.
- [ ] **Step 4:** full suite, lint, build, build budget test.
- [ ] **Step 5: Commit** `docs: hand rolling review page, live checks and README`.

---

## Not in this plan

- Hand-throwing blind rolls from character sheets (P6-D1).
- Persistent dice left on the table.
- The pet that rolls for you (planned as Plan 6b once this ships).
