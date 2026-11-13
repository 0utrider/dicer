# Dicer: pets dodge the cursor and leave when idle

**Date:** 2026-11-14. **Status:** approved in chat by the owner ("ok", 2026-11-14).
**Builds on:** `docs/superpowers/specs/2026-11-13-dicer-pet-splat-design.md` (resting pets and splats, merged to main).

## Intent

The owner's complaint: "the pet sticks on the screen all the time". They added that it should
"move/fly out of the way of the cursor". Two changes fix both halves:

1. A resting pet gets out of the way of the player's cursor.
2. A pet leaves the table after a while without a roll.

## Decided with the owner (2026-11-14)

- **Dodge.** When the cursor comes within about two dice of a resting pet, the pet moves to a
  fresh spot at least four dice from the cursor. The spot still follows the resting rules: the
  35–60% ring, the edge margin, spacing from other pets and Foundry's controls.
  - Each pet moves in character: the dragonling flaps up and flies, the slime boings in a couple
    of hops, the mimic scuttles low and fast.
  - Puddles do not dodge; the cursor passes over them.
- **No dodging while dice are rolling.** The physics fixed every pet's spot when the throw
  started, so a pet that moved would make dice bounce off empty air. A pet dodges once no roll
  is in flight.
- **Leave when idle.** After a set time without a roll by its owner, a resting pet hops off the
  table and a puddle fades. On its owner's next roll, the pet hops in to a fresh resting spot
  first and then watches, so own-roll splat odds are unchanged.
- **How long pets stay** becomes a client setting with these choices:
  - Leave after the roll (0)
  - 30 seconds
  - 1 minute (the default)
  - 2 minutes
  - Always

  It replaces the "Pets stay on the table" checkbox. A player who had turned that checkbox off
  gets "Leave after the roll"; everyone else gets the default.
- **Free when idle.** Watching the pointer is a passive listener. The loop runs only while a pet
  moves, and once the last pet leaves, the dice canvas hides again. Each player's cursor moves
  pets on their own screen only, since resting spots are already chosen per screen.

## Builder's calls

- **D-1 Timing.** The idle timer starts when the pet's reaction ends (or it becomes a puddle) and
  restarts on each of its owner's rolls. A loop that is held calls no frames, so the timer is a
  `setTimeout` that wakes the loop. It is cleared on dispose.
- **D-2 Dodge details.**
  - Trigger radius: the pet's footprint plus 2 dice, measured in stage units from the pointer's
    position on the stage.
  - The pointer is ignored outside the stage rectangle, such as over the sidebar.
  - At most one dodge per pet every 0.6 s.
  - The move takes about 450 ms (dragonling 600 ms, flying).
  - If no valid spot is at least 4 dice from the cursor, the pet takes the farthest valid spot
    it finds.
- **D-3 Mid-dodge throws.** If a roll starts while a pet is mid-dodge, `obstaclesFor` reports the
  pet's destination spot. That is where it will stand for the throw.
- **D-4 Touch.** `pointermove` covers mouse and pen. Touch moves dodge too, harmlessly.

## Goals, non-goals, anti-goals

- **Goals:** pets never sit under the cursor; the table empties when nobody rolls; splat odds on
  the owner's rolls are unchanged.
- **Non-goals:** petting or clicking pets (clicks still pass through to the map); pets following
  the cursor; dodging thrown dice.
- **Anti-goals:**
  - The loop running while nothing moves.
  - Dice bouncing off a spot a pet just left.
  - A pet jittering back and forth under a still cursor.
