# Changelog

## Unreleased

The dice pets do more between rolls.

- **Pets rest where you choose.** Resting pets no longer move out of your cursor's way. Instead they wait at the spot you pick in **Where pets rest**: near the dice in their owner's roll area (the default), in one of the four corners, or at the bottom centre. The choice is per player and applies to every pet on your screen.

- **Click to pet.** Click a resting pet and it wiggles happily, with a few hearts and a chirp. Click it too often and it huffs, hops off and ignores you for a few seconds. Only clicks right on a pet are caught; everything else goes to Foundry. Turn it off with **Click to pet**.

- **Pets react to elemental dice.** A die with an element that lands next to a resting pet sets it off: it fans away smoke from fire and lava, shivers from frost, bristles at storm, and jumps at anything else. Any player's dice count, even without a pet of their own. Turn it off with **Pet reactions to elemental dice**.

- **Pet moods.** A pet that rests after a run of good d20s stands proud; after a run of bad ones it sulks. The mood comes from its owner's last five d20 results on your screen and resets when Foundry reloads. Turn it off with **Pet moods**.

- **Pets cheer for others.** When another player rolls a natural 20, the other resting pets turn toward the dice and cheer, once per roll. Turn it off with **Pets cheer for others**.

- None of this ever happens for a roll you cannot see, and with reduced motion on the animations are gentler and no sparks flash.

## 0.1.1

Dice now carry their element through the whole throw, and a natural 20 gets a moment of its own.

- **Elemental trails.** A die with an element leaves a trail of it while it flies: flames and embers for fire, mist and ice glints for frost, crackling sparks for storm, molten drips for lava. Every damage type has one too: green drips for acid, dark smoke for void, golden motes for vitality, a green haze for poison, sound rings for sonic, violet shards for force, pink swirls for mental, cyan wisps for spirit, falling blood for bleed, and silver arcs, white needles and dust for slashing, piercing and bludgeoning. The 5e names map onto them (thunder is sonic, psychic is mental, radiant and healing are vitality, necrotic is void, lightning is storm). A die with neither an elemental inside nor a damage type leaves nothing. Turn it off with **Elemental trails**.

- **Elemental critical bursts.** A d20 with an element that lands a natural 20 bursts in its element: a fire explosion, an ice bloom, forked lightning, a molten splash, and one for every damage type. At most three play at once, and with reduced motion a burst is one soft swell. The bursts are also in the trigger and celebration effect lists as `burst-<element>`, so any rule can play one on any die. Turn the automatic ones off with **Elemental critical bursts**.

- **Hidden rolls stay hidden.** Blind and whispered rolls never show a trail or a burst to anyone who cannot see the result, and other players' dice follow **Show other players' effects**.

- **A clearer dice tray.** The tray has clickable die buttons with counts, a live formula of what you are about to throw, and plainer roll modes.

- **Your own celebration sounds and animations.** Each natural 20 and natural 1 celebration can use any audio file on the server, and, with JB2A active, any JB2A animation. With Sequencer installed, the animation picker is a browser with categories, colour swatches and video previews. Play buttons throw a test die with your unsaved choices, only for you.

- If the new effects do not show after updating, reload Foundry with Ctrl+F5 so the browser drops its old copy of the module.

## 0.1.0

First prerelease: physics-simulated 3D dice for Foundry VTT v14, in sync for every player.

- Themes, an appearance editor with a live preview, and looks per die type, kind of roll, character or damage type.
- Resin dice with living insides, including fire, storm, frost and lava, that react to crits.
- Built-in roll effects (celebrate, fumble, sparkles, embers, frost, lightning, smoke, shatter, shockwave, light burst and more), with JB2A animations when JB2A is installed.
- Trigger rules for effects, sounds and macros; damage dice themes for PF2e and D&D 5e.
- Rolling by hand, roll areas per player, dice pets, and Dice So Nice API compatibility.
