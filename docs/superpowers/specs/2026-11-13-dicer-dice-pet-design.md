# Dicer: the dice pet

**Date:** 2026-11-13. **Status:** draft for the owner's review.
**Roadmap:** row 8b (`docs/superpowers/plans/2026-11-10-dicer-roadmap.md`).
**Parent spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md` (G1 privacy, G2 performance and idle, G7 effects, G8 sounds).

## Intent

Owner request: "a pet that rolls the dice for you, waits for the result and reacts to a 20 or a 1."
The owner skipped the design questions (2026-11-13), so every call below not quoted from the owner
is a design call (marked **D-n**) the owner can overturn at plan review.

The pet is charm, not a mechanic. It adds personality to the moment of a roll. It never changes a
result, never delays the chat card, and never shows anything the watcher is not allowed to see.

## Decided by the owner

- The pet rolls the dice, waits for the result, and reacts to a natural 20 or a natural 1.
- Questions skipped: the builder makes the calls.

## Design calls

- **D-1 Built on today's automatic throws, not rolling by hand.** Foundry still picks the number;
  the pet performs the throw Dicer already animates. Rolling by hand (roadmap row 8) is not needed
  and not built here. If it ships later, the pet can throw through it. Cost if wrong: a pet that
  must wait for rolling by hand.
- **D-2 The pet appears only during a roll.** It hops in at the edge the dice come from, makes a
  throwing motion as the dice fly past it, turns to watch them, reacts when they land, and hops off
  before the dice fade. No idle pet on the canvas, so no GPU work when no roll is playing (G2 idle
  rule). Cost if wrong: an always-present pet needs a different idle budget.
- **D-3 The roller's pet.** Each user picks a pet; everyone watching a roll sees the roller's pet.
  Stored as a user flag (`dicer.pet`), like the user's looks. A roll with no user (API) has no pet.
- **D-4 Three pets, built from simple shapes in code, no downloaded art:**
  - **Mimic:** a small chest-like die with eyes and stubby legs.
  - **Slime:** a squashy jelly blob with eyes; squash and stretch carry all its emotion.
  - **Dragonling:** a tiny dragon with wings and a tail.

  Each is tinted by a colour the user picks (default: the user's Foundry colour). Plus **None**.
- **D-5 Reactions:**
  - **Natural 20** on any d20 in the roll: joyful jump and spin, a small sparkle burst, a happy chirp.
  - **Natural 1** on any d20: slump, droop, a sad little sound.
  - **Both a 20 and a 1** (advantage or disadvantage with both kept on screen): a puzzled head-tilt;
    Dicer cannot tell which die counted.
  - **Anything else:** a small satisfied nod.
  - Only d20s count (owner ruling from the designs work: crit/fumble is a d20 thing).
  - The reaction reads each die's own type and value. It does not depend on effect rules being on.
- **D-6 Privacy follows the dice.**
  - A watcher who sees no dice (`view === 'none'`) sees no pet.
  - A watcher who sees ghost dice sees the pet throw, but it gives the neutral nod: no reaction may
    leak a hidden result, in look, sound or timing. The neutral nod is the same length as the other
    reactions.
- **D-7 It never slows anything that matters.**
  - The chat card, `diceSoNiceRollComplete` and every timing stay exactly as without a pet.
  - If the pet's code is not loaded yet when a roll starts, that roll simply has no pet.
  - The pet is not in the physics: dice never bounce off it, and results never depend on it.
  - At most 3 pets on screen. A roller with a pet already on screen re-uses it (it throws again).
- **D-8 Size and loading.** All pet code (shapes, animation, sounds) lives in a lazy chunk, loaded
  on idle after the world starts, only when pets are allowed and shown. World-start growth is the
  loader, the settings and the hook: at most 1,024 bytes.
- **D-9 Where the user picks it.** A "Pet" section in the appearance editor: None / Mimic / Slime /
  Dragonling and a colour. The editor's existing Throw button (it throws the previewed look onto the
  table) throws with the chosen pet, so that is the preview; no separate pet renderer.

## Settings (every part can be switched off)

| Key | Scope | Default | What it does |
| --- | --- | --- | --- |
| `petsAllowed` | world | on | GM switch: no pets at all when off. |
| `showPets` | client | on | This player sees pets (their own and others'). |
| `petSounds` | client | on | The pet's chirps (also follows Dicer's sound setting and volumes). |
| user flag `dicer.pet` | per user | Mimic, user colour | The pet this user rolls with, or None. |

Owner's standing rule: each feature has its own off switch and defaults on.

## Behaviour detail

- **Where it stands.** The physics worker reports which edge of the throw area the dice enter from.
  The pet stands just inside that edge, on the line the dice fly in on, outside the landing zone
  (dice aim at the inner 60% of the area). With a per-player roll area, that area's edge.
- **Timeline.** Enter (about 0.35 s) as the first dice frame shows, throw swing timed to the dice
  passing, watch (head and body turn to follow the dice centre), react on landing (about 1.2 s),
  then exit. The exit always finishes by the time the roll's dice have faded; if the roll ends
  early, the pet leaves quickly (about 0.3 s).
- **Several dice, several rolls.** One pet per roll. Two rolls by different users at once each get
  their own pet, up to 3.
- **Look.** Lit like the dice (the same studio lighting), with a soft contact shadow like the dice.
  The pet is about the height of a d20.
- **Quality tiers.** On the lowest tier the pet keeps its animation but casts no shadow.

## Goals, non-goals, anti-goals

- Goals: delightful, readable reactions on a 20 and a 1; zero cost when off or idle; safe for
  private rolls.
- Non-goals:
  - Rolling by hand.
  - Pets that stay on the table between rolls.
  - Petting or feeding the pet.
  - Pets for non-d20 crits.
  - Custom 3D pet models (GLB).
  - Per-actor pets.
- Anti-goals:
  - A pet that delays the chat card or a hook.
  - A pet that leaks a hidden result.
  - A frame drop on a throttled machine caused by the pet.
  - A pet that stays on screen after its roll.

## Left to the builder

- Exact shapes, proportions and animation curves, within the three pets above.
- Sound design for the two chirps, built with the existing procedural synth.
- How the edge is reported from the worker.
- How the pet chunk warms its material so the first pet does not stutter.
