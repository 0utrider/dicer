# Dicer Pet Dodge and Idle Leave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resting pets dodge the player's cursor in character, and leave the table after a chosen idle time.

**Architecture:**
- **The pet layer (lazy chunk) gains an idle timer and a pointer-driven dodge.** It reuses `restSpot`, which gets an extra point to keep away from, and the page-to-stage mapping already used for the UI exclusions.
- **DiceBox's existing `activeRolls` tells the layer whether a throw is in flight.**
- **One new client setting replaces `petsStay`.**

**Tech Stack:** Plain JS ES modules, three.js 0.184, Vitest, Playwright (visual).

**Spec:** `docs/superpowers/specs/2026-11-14-dicer-pet-dodge-design.md`

## Global Constraints

- **Branch and commits:** branch `pet-dodge`. Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge.
- **World-start budget:** Task 1 re-bases the ratchet in `tests/unit/build.test.js` to today's world start, `4_102_587`, with an allowance of **512 bytes** for this plan. Measure in the main checkout `dicer/` after `npm run build`. Everything except the setting and its migration lives in the lazy pet chunk.
- **Setting `petStay`** (client, `Number`), with these `choices`:

  | Value | Label |
  | --- | --- |
  | `0` | "Leave after the roll" |
  | `30` | "30 seconds" |
  | `60` | "1 minute" |
  | `120` | "2 minutes" |
  | `-1` | "Always" |

  - Default `60`.
  - Name: "How long pets stay"
  - Hint: "How long a pet stays on the table after its owner's last roll. Pets move out of your cursor's way while they wait."
  - It replaces `petsStay`. Migration on ready: if the old client value `petsStay === false` was stored, set `petStay` to `0` once.
- **Idle cost:** listen with a passive `pointermove`. No frames are drawn unless a pet moves. When the last pet leaves, `update` returns `false` (the canvas hides).
- **Dodge:**
  - The trigger radius is footprint + 2 (stage units).
  - The new spot is at least 4 from the cursor, else the farthest valid one.
  - Cooldown `DODGE_COOLDOWN_MS = 600`.
  - Move times: `MOVE_MS = 450`, dragonling `FLY_MS = 600`.
  - No dodge while `deps.activeRolls() > 0`.
  - Puddles never dodge.
- **Creatures:** a new pose phase `'move'` (t in 0..1) is added for each kind:
  - the dragonling flies (wing flaps, body raised; the layer adds the height arc);
  - the slime does 2 squash hops;
  - the mimic scuttles low with fast legs.

  It must be allocation-free and NaN-safe, like the other phases.
- **Checks:** lint clean; full suite green.

## Review Focus

1. **A still cursor sitting exactly at a pet's new spot,** or a cursor in a corner with no valid far spot: no ping-pong. The cooldown applies, and the pet takes the farthest spot and stays. Test in Task 2.
2. **A throw starting mid-dodge:** the obstacle is the destination, and no dodge starts while `activeRolls > 0`. Test in Task 2.
3. **The idle timer** fires while the loop is held and the tab is hidden, after engine dispose, and after `petStay` changes mid-wait. It never throws after dispose, and a changed setting re-arms or clears the timer. Test in Task 1.
4. **`petStay = -1` (Always):** pets never leave. **`petStay = 0`:** they leave as soon as the reaction ends. Own-roll splats are unchanged, because the pet still hops to a resting spot and watches. Test in Task 1.
5. **The pointer over the sidebar, chat or outside the stage** is ignored. The pointer listener is removed on dispose. Test in Task 2.

---

### Task 1: The `petStay` setting and idle leave

**Files:**
- Modify: `src/settings.js`, `lang/en.json`, `src/main.js` (migration and wake on change, replacing `petsStay`), `src/pet/chunk/pets.js`
- Modify: `tests/unit/build.test.js` (reference `4_102_587`, allowance 512)
- Test: `tests/unit/settings.test.js`, `tests/unit/pet-layer.test.js`, `tests/unit/main-hooks.test.js`

**Interfaces:**
- Produces:
  - `getSetting('petStay') -> 0|30|60|120|-1`.
  - The layer's `stays()` becomes `getSetting('petStay') !== 0` (a pet stays at least until its idle timer).
  - Each resting pet or puddle has `leaveAt = idleSince + petStay*1000` (none for `-1`). A single layer `setTimeout` targets the earliest `leaveAt` and calls `deps.wake()`. At or after `leaveAt`, `update` sends that pet off (a hop off, or a fade for a puddle).
  - Every `begin` for that owner clears the pet's `leaveAt`. The pet's first appearance after leaving hops in to a fresh resting spot, as today.

- [ ] **Step 1: Write failing tests:**
  - `petStay 60: a resting pet leaves 60 s after its reaction; update false afterwards`
  - `a puddle fades after petStay`
  - `-1 never leaves`
  - `0 behaves like the old petsStay off`
  - `a roll by the owner before the timer resets it`
  - `changing petStay mid-wait re-arms the timer`
  - `dispose clears the timer (no wake after dispose)`
  - `the timer fires through a held loop (deps.wake called)`
  - Settings key list gains `petStay` and loses `petsStay`.
  - Main: migration of a stored `petsStay=false` to `petStay=0`, and the change wakes the box.
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement.** Use injected `deps.setTimer`/`deps.clearTimer` (default `setTimeout`/`clearTimeout`) so tests stay deterministic.
- [ ] **Step 4: Run** `npm run build`, then the full suite. World start must be ≤ `4_102_587 + 512`; report the bytes.
- [ ] **Step 5: Commit** `feat(pet): pets leave after a chosen idle time`

### Task 2: Dodge the cursor

**Files:**
- Modify: `src/pet/chunk/pets.js`, `src/pet/chunk/resting.js` (`restSpot(..., avoid, away?: {x, z, min})`), `src/throw/dice-box.js` only if `activeRolls` must reach the layer through `deps` (it can be passed from `main.js`; prefer `deps.activeRolls = () => box?.activeRolls ?? 0`)
- Modify: the creatures (`'move'` pose), `dev/pets.js` (a move row per kind), `tests/visual/pets.mjs`
- Test: `tests/unit/pet-layer.test.js`, `tests/unit/pet-resting.test.js`, `tests/unit/pet-creatures.test.js`

**Interfaces:**
- Consumes: Task 1's resting and leave state; the existing page-to-stage mapping used by `uiRects()`.
- Produces:
  - `restSpot(area, height, taken, rand, avoid, away)`: `away` rejects spots closer than `away.min` to `(away.x, away.z)`; the best-candidate fallback prefers the farthest.
  - Layer: a passive `pointermove` listener on `window`, added at creation and removed in `dispose`, which stores the latest pointer in stage units (or null when outside the stage).
  - `update` checks the dodge, only when the pointer moved since the last check and `deps.activeRolls() === 0`. For each pet in `rest` within footprint + 2 of the pointer, past its cooldown, it starts a `'move'` to `restSpot(..., away: {pointer, min: 4})` and calls `deps.wake()`.
  - `obstaclesFor` reports a moving pet at its destination.
  - Creatures: a `pose('move', t, …)` phase as in the Global Constraints. The layer adds a raised arc for the dragonling (peak about 1.2 units) and a low slide for the mimic and the slime.

- [ ] **Step 1: Write failing tests:**
  - `pointer near a resting pet → it moves to a spot ≥ 4 away; wake called`
  - `no dodge while activeRolls > 0, dodges after`
  - `still pointer on the new spot → no second dodge within the cooldown; a corner with no far spot → farthest spot, no ping-pong`
  - `puddles never dodge`
  - `pointer outside the stage ignored`
  - `obstaclesFor reports a moving pet at its destination`
  - `dispose removes the listener`
  - `restSpot honours away.min over 200 seeds, with the farthest fallback`
  - `each creature's 'move' pose is NaN-free for t in {0, .5, 1, NaN, -1, 2}`
- [ ] **Step 2: Run** them. They fail.
- [ ] **Step 3: Implement.** Render the move row in `dev/pets`, and Read the strip to check each kind reads in character (the dragonling clearly flying, the slime boinging, the mimic scuttling).
- [ ] **Step 4: Run** the full suite, lint and `npm run test:visual:pets`. All pass.
- [ ] **Step 5: Commit** `feat(pet): pets dodge the cursor`

### Task 3: README and checks

- [ ] **Step 1:** In the README pet section, replace "Pets stay on the table" with "How long pets stay" and its choices, and say that pets move out of your cursor's way.
- [ ] **Step 2:** Run `npm run test:visual`, `test:visual:pets` and `test:visual:editors`: zero errors.
- [ ] **Step 3: Commit** `docs: pet dodge and idle leave in the README`
