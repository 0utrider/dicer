# Dicer: splat the dice pet

**Date:** 2026-11-13. **Status:** draft for the owner's review.
**Builds on:** `docs/superpowers/specs/2026-11-13-dicer-dice-pet-design.md` (the dice pet, merged to main).

## Intent

Request from a player in the owner's group: "If you throw the dice at it hard enough it should turn
into a splatter and then respawn when you roll another dice." The owner agreed to plan it.

It's a playful toy on top of the pet: a die that hits a pet hard bursts it into a cartoon splat,
and the pet comes back on its owner's next roll. A gentle hit only knocks it and makes it wobble.

## Decided by the owner (2026-11-13)

- **Pets stay on the table between rolls,** sitting still at a random spot in their owner's roll
  area. This sits behind its own setting.
- **Real collision.** The pet is a solid obstacle in the dice physics: slow dice bounce off it and
  hard hits splat it. Dice never pass through a solid-looking pet.
- **Accepted consequence:** each screen simulates its own automatic throw today. So a splat seen
  on one screen may be a miss on another, and the resting spot is chosen per screen. Rolling by
  hand, later, sends one throw to everyone and makes it shared.
- **Accepted consequence:** a resting pet is fixed on screen like the dice. It does not follow the
  map when the map is panned or zoomed.

## Design calls (the builder's; the owner can overturn)

- **S-1 Who can splat whom.** Any die on screen can hit any pet on screen, including its own
  roller's pet, mid-roll. Splatting your own pet with your throw is part of the fun.
- **S-2 What a hit is.** The physics reports an impact between a die and a pet, with its speed,
  exactly like die–floor and die–wall impacts today.
  - Above `SPLAT_SPEED` the pet splats.
  - Below it, the pet does a short wobble (a squash and recoil away from the die) and stays.
  - `SPLAT_SPEED` is tuned so a die arriving from a throw at full pace usually splats, and a die
    tumbling to rest only knocks.
- **S-3 The splat.**
  - The pet bursts with a quick squash, then a goo burst: a few droplets fly out and settle.
  - It leaves a flat puddle of its own colour on the table with its two eyes sitting in it,
    blinking once. The mimic leaves its lid lying in the puddle, and the dragonling leaves a wing.
  - Cartoon, coloured like the pet, never red gore.
  - A "splat" sound plays, built in the procedural synth like the pet chirps and quieter than the
    fanfare.
  - The puddle stays until the owner's next roll.
- **S-4 Respawn.** When the owner rolls, the puddle pulls together into the pet, about 0.4 s, at
  the puddle's spot. The pet then does its normal roll routine: hop to the edge the dice come from,
  throw, watch, react. After its exit it rests at a new random spot.
- **S-5 Resting.**
  - After its reaction, instead of hopping off the table, the pet hops to a random spot inside its
    owner's roll area (or the stage when there are no per-player areas) and sits still.
  - The spot keeps away from the area's edges and from the middle, where the dice aim (the inner
    60%), so it is a target, not in the way of results.
  - No idle animation, so a resting pet costs no GPU. The render loop holds the last frame, the
    canvas stays shown, and nothing redraws until something moves.
  - Two resting pets never overlap.
- **S-6 A splat during a roll** (the pet is mid-routine, hit by any die) ends its routine at once.
  There is no reaction, and the puddle stays.
  - The splat reveals nothing about any result: it comes from the physics, not the value. Ghost
    dice can splat a pet too.
  - A pet that was splatted before its own roll landed gives no reaction for that roll.
- **S-7 How many.** At most 3 pets on screen, resting or rolling, as today. A 4th roller's pet
  replaces the resting pet that has been idle the longest; that pet hops off.
- **S-8 When resting pets go away.** A resting pet hops off when:
  - its owner disconnects;
  - the resting setting is turned off;
  - pets are no longer allowed or shown;
  - the roll area changes size, in which case it is re-placed at a new random spot, not removed.

  When the dice engine restarts (rare: a quality change or a lost GPU context), resting pets and
  puddles are cleared, and each comes back on its owner's next roll. This is the builder's call:
  carrying pet state across a rebuilt scene is not worth the code.

  A puddle goes the same way.
- **S-9 Dice see pets as obstacles only while they are on screen.** Each throw tells the physics
  where every pet on screen stands (resting or rolling), as a simple rounded shape the size of the
  pet's body. Puddles are not obstacles.
  - A rolling pet moves during the throw, but the physics treats it as fixed at the spot it stands
    on when the throw starts. The pet hops to that spot first, during its enter.
- **S-10 Results never change.** Foundry picks the number and the dice are made to show it, so a
  bounce off a pet changes where a die lands, not what it shows.

## Settled after the builder check (builder's calls)

- **S-11 Where the physics sees each pet.** A throw's physics is simulated when the throw starts,
  before it plays back, so obstacles are the spots where each pet will stand during that playback:
  - A resting pet is at its resting spot.
  - Another roller's pet that is mid-routine is at the edge spot it hopped to.
  - The roller's own pet is at the edge spot it is about to hop to. That spot is known before the
    throw, from the seed's edge, as today.
  - Puddles are not obstacles.
  - The pet's edge spot stays inside the area, where dice spawn high beyond the stage edge. A
    test checks that dice never spawn inside or get stuck on a pet obstacle.
- **S-12 Splats from another throw.** A throw already simulated keeps treating a pet as solid,
  even if a different throw splats it mid-playback. The worker is not told mid-throw.
  - After a splat, impacts against that pet are ignored.
  - A die may briefly bounce off the empty spot. This is rare and accepted.
- **S-13 Splats happen at playback time,** when the die visibly touches the pet, not when the
  physics computed them.
- **S-14 One pet per user.**
  - An owner who rolls while their pet is resting: the pet hops from its resting spot to the edge.
  - Rolling while it is a puddle: the puddle reforms in place, then hops to the edge.
  - A watcher who sees the owner's roll as ghost dice: the pet does its routine with the neutral
    nod, as today.
  - A watcher who sees no dice for it: the resting pet just stays.
- **S-15 The cap of 3 counts puddles.**
  - Only resting pets and puddles can be replaced, the one idle longest first.
  - A pet mid-routine is never replaced.
  - If all 3 are mid-routine, a 4th roller gets no pet, as today.
- **S-16 `petSplat` off:** pets stay solid (dice bounce off and the pet wobbles) but never splat.
  The only way to make dice ignore pets is to turn pets off.
- **S-17 Resting area:** the owner's roll area, or the whole stage with no per-player areas. When
  the area changes, the pet moves to a new spot inside it.
- **S-18 Impact protocol:** a pet impact gets its own "other" code in the physics impact events
  (floor is -1, wall -2, pet -3 minus the pet's index). Changing the internal worker protocol is
  fine.

## Settings

| Key | Scope | Default | What it does |
| --- | --- | --- | --- |
| `petsStay` | client | on | Pets sit on the table between rolls (off: they hop off after each roll, as today). |
| `petSplat` | client | on | Dice can splat pets (off: dice pass through pets, as today). |

Both follow the owner's standing rule: each feature has its own off switch and defaults on. The
existing `petsAllowed` (world), `showPets` and `petSounds` (client) still apply, and the splat
sound follows `petSounds`.

## Goals, non-goals, anti-goals

- **Goals:**
  - A satisfying, funny splat.
  - A pet that reliably comes back on its owner's next roll.
  - Zero cost while pets rest.
  - Results and chat timing unchanged.
- **Non-goals:**
  - Shared splats across screens (that comes with rolling by hand).
  - Pets that follow the map.
  - Dragging pets around.
  - Splatting with anything other than dice.
  - Pets that react to being knocked beyond the wobble.
- **Anti-goals:**
  - Gore.
  - A resting pet that blocks clicks on the map: the dice canvas already ignores the mouse.
  - A resting pet that keeps the GPU busy.
  - A splat or puddle that delays the chat card or a hook.
  - A pet hiding a die's result: resting spots keep out of the middle.

## Left to the builder

- `SPLAT_SPEED` and the wobble threshold, tuned from real impact speeds.
- The obstacle shape per pet (a capsule or cylinder is fine).
- The puddle and droplet look within S-3, and the splat sound.
- How the resting spot is picked (random with rejection against the edges, the middle and other
  pets).
- How the render loop is told that a resting pet needs the canvas kept shown without frames.
