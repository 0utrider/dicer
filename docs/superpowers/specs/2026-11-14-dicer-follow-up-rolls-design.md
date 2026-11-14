# Follow-up rolls throw themselves — design

## Why

With hand rolls on, a PF2e strike against a concealed target opens the throw screen twice: once
for the attack, then again for the flat check. pf2e-flatcheck-helper rolls its d20 inside the
attack message's `_preCreate`, after the attack roll has fully resolved, so the two rolls never
exist at the same time and Dicer cannot gather them into one throw. The owner wants the second
grab gone.

## What

A dicer hand roll that **starts within 3 s of the same user's last hand throw landing** opens no
throw screen (and no ask prompt). Its dice are thrown automatically in the roller's area, with the
same physics and fairness as a "Throw for me", and read the same way. It covers any module that
rolls right after a hand throw: flat checks, Workbench auto damage, and so on.

## Goals / non-goals / anti-goals

- Goal: one grab per action; the follow-up die still visibly tumbles and its result is real
  physics.
- Goal: other players see the follow-up exactly as with any hand throw (recorded and replayed).
- Non-goal: predicting flat checks or gathering dice into one throw (option 2, rejected).
- Anti-goal: a fast-rolling player never gets locked into automatic throws; a follow-up never
  extends the window.

## Approaches

1. **Follow-ups throw themselves (picked).** Small, works with every module, nothing copied from
   other modules.
2. Spare d20 predicted up front. Rejected: it has to copy pf2e-flatcheck-helper's rules, breaks
   when that module changes, and only helps flat checks.
3. Leave as is. Rejected: Ask mode's "Throw the rest automatically" does not help in Always mode.

## Behaviour

- Window: `FOLLOW_MS = 3000`, measured from when the last overlay throw's values arrived. Only
  overlay (grabbed or "Throw for me") throws open the window; follow-ups and tray throws do not.
- The follow-up uses the existing free throw (`throwFree` path in `src/hand/chunk/resolve.js`):
  roller's area, ghost rules for blind and secret modes, timeout fallback unchanged.
- Its recording is stored as the roll's own hand throw (`storeThrow`), so the replay to allowed
  recipients works as for any hand throw.
- The chat card mark is the normal hand mark; the tooltip says "Thrown automatically after your
  hand throw".
- It applies in Always and Ask modes (Ask mode skips the prompt for a follow-up).
- **Setting:** client setting `handFollowUps`, "Throw follow-up rolls automatically", default on.
  When off, today's behaviour applies.

## Calls made by Claude (owner can override)

- ~~When the GM requires hand rolls, follow-ups still open the throw screen.~~ Changed by the
  owner after live testing: follow-ups apply while `handRollsRequired` is on too, because a
  follow-up is still a real throw.
- Tray throws always open the screen. They are deliberate.
- The 3 s window matches the existing burst window (`BURST_MS`).

## Left to the builder

- Where the last-landing timestamp lives and how it is reset in tests.
- Exact localisation keys.
