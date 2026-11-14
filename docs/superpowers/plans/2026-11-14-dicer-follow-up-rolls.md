# Follow-up Rolls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hand roll starting within 3 s of the same user's last overlay throw landing is thrown automatically, with no throw screen and no ask prompt.

**Architecture:** `throwByHand` (`src/hand/chunk/resolve.js`) keeps a module-level `lastLanded` time, set when an overlay throw's values arrive. Inside `queued()` a follow-up skips the ask and the overlay and runs a bounded free throw. The free throw's recording is stored as the roll's own hand throw, so send and replay are unchanged. `dicerHand.follow = true` changes the card tooltip.

**Tech Stack:** Foundry v14 module, Vitest.

**Spec:** docs/superpowers/specs/2026-11-14-dicer-follow-up-rolls-design.md

## Global Constraints

- `FOLLOW_MS = 3000`, exported from resolve.js.
- Client setting `handFollowUps`, Boolean, default `true`, config true. It is read as `getSetting('handFollowUps') === true`, so an unset value in tests means off.
- No follow-up when `handRollsRequired === true`.
- Only an overlay throw that returned values sets `lastLanded`. A follow-up, a fallback and a tray throw never set it.
- World-start ceiling unchanged (4,115,308 B); the code lives in the lazy hand chunk except the setting and the tooltip.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A follow-up whose dice never settle must not hold the queue. Bound it at `HAND_GRACE_MS`; on expiry, fall back with `'timeout'`.
2. Blind and secret rolls: a follow-up's dice are ghosts for the roller (`ghostFor`), as in an overlay throw.
3. Chains: a follow-up must not extend the window. A third roll 2 s after a follow-up that landed 4 s after the hand throw gets the overlay.
4. Ask mode: a follow-up skips the prompt, and its "rest" state is untouched.
5. A closed resolver (`_closed`) before the follow-up starts falls back with `'cancel'`.

---

### Task 1: Follow-ups throw themselves

**Files:**
- Modify: `src/hand/chunk/resolve.js` (throwByHand, new `lastLanded` and `FOLLOW_MS`, a free-throw helper that returns `{values, recording, handle}`)
- Modify: `src/hand/gate-hand.js` (`markFor`: `h.follow` and a full throw → `DICER.Hand.MarkFollow`)
- Modify: `src/settings.js` (`handFollowUps` in the `hand` list, after `handReplay`, not among the first four)
- Modify: `lang/en.json` (`DICER.Settings.handFollowUps.Name/Hint`, `DICER.Hand.MarkFollow`)
- Modify: `README.md` (one line in the rolling-by-hand section)
- Test: `tests/unit/hand-resolve.test.js` (new `describe('follow-up rolls')`), `tests/unit/settings.test.js`, and the existing gate-hand mark test file

- [ ] **Step 1: Write the failing tests.** All use fake timers with a far-future `now`, and `settings.handFollowUps = true`:
  - `a roll 1 s after a hand throw lands is thrown free: no overlay, values from DiceBox, dicerHand.follow, stored recording`. Expect `overlay.open` once, `diceBox.roll` called with `free: true`, results equal `boxValues`, `handThrows.get(id).recording` defined, and `fallback` undefined.
  - `a roll 3.5 s after is not a follow-up`. Expect the overlay twice.
  - `a follow-up does not extend the window` (Review Focus 3).
  - `handFollowUps false, or handRollsRequired, opens the overlay`.
  - `ask mode: a follow-up is not asked`. Expect `deps.ask` called once.
  - `a follow-up that never settles falls back 'timeout' after HAND_GRACE_MS` (Review Focus 1).
  - `a blind follow-up throws ghost dice` (Review Focus 2).
  - In the mark tests: `markFor` with `{follow: true, n: 1}` returns `DICER.Hand.MarkFollow`.
  - In the settings test: `handFollowUps: { scope: 'client', type: Boolean, default: true, config: true }`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/hand-resolve.test.js tests/unit/settings.test.js`. Expect the new tests to fail.
- [ ] **Step 3:** Implement the changes listed under Files.
- [ ] **Step 4:** Run `npm test`, `npm run lint` and `npm run build`. Expect all to pass, and the world-start size test under its ceiling.
- [ ] **Step 5:** Commit `feat(hand): follow-up rolls throw themselves`.
