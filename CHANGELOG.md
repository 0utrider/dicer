# Changelog

## Unreleased

- **Damage dice over your dice set.** If your dice are a module dice set with 3D models (The Rollsmith's sets and the like), damage dice now set it aside and roll in their damage look, instead of the set's models hiding it. Turn it off with **Damage dice over your dice set** to keep the set's models on damage dice.
- **Importing a 3D model set takes its colours.** A dice set that is all 3D models (no colours of its own) now imports as a Dicer theme in the models' own colours (a gold body with red numbers for Gold Red Armored), instead of Dicer's default look under the set's name.
- **Your pet has its own window.** Pick your pet and its colour in **Your pet** (Configure Settings, Dicer, or the theme browser's My pet button), with all your pet settings (size, where pets rest, how long they stay, splats, petting, reactions, moods, cheering, sounds). It was in the dice editor, but it was never part of a theme: it is yours, whatever dice you roll.
- **Pets react to every damage type.** Each element now has its own reaction: acid fizzes green bubbles, poison leaves it queasy in a green haze, void sinks dark motes into it, vitality makes it wiggle happily under golden motes, sonic rings spread around it, force knocks shards off it, mental leaves pink swirls circling its head, spirit wisps rise off it, bleed drips, a slash sweeps past, needles dart in, and a blow kicks up dust (fire, frost and storm as before). An elemental die that hits a resting pet now sets it off instead of splatting it; weapon dice (slashing, piercing, bludgeoning) still splat it on a direct hit.
- **Cute pet noises.** Pets purr when petted, go "hmph" when they huff, and every damage type has its own voice: a cough for smoke, chattering teeth for cold, a buzzing squeak for electricity, a fizz for acid, a queasy "bleh" for poison, a spooked "ooo" for void, a happy coo when healed, ringing ears for sonic, an "oof" for force, a warble for mental, a ghostly "wooo" for spirit, an "ow-ow" for bleed, a "whoa!" for slashing, a "yip!" for piercing and a "bonk" for bludgeoning. **Pet sounds** (in Your pet) mutes them.
- **Tidier settings.** Dicer's settings are grouped under headings (General, Graphics, Sound, Effects, Damage dice, Pets, Rolling by hand, Roll areas, Chat and dice trays). The **Dice theme** and **World default theme** dropdowns are gone: the theme browser picks both.

## 0.2.0

A big one: a chat dice tray, roll filters, Dice So Nice module dice sets with their 3D models and art, your own images on dice, and pets you can pet.

- **Flat checks in the dice tray (Pathfinder 2e, Starfinder 2e).** DC 5 and DC 11 buttons after the dice: one click rolls a flat check (with Fortune or Misfortune if on) and posts it as the system's own check card, the result coloured by its degree of success. Hide them in the tray's Customize panel.
- **Face images for coins, Fate dice and the d100.** Themes can picture heads and tails, the Fate die's +, blank and −, and the d100's tens (10 to 00); the dice editor has preview buttons and face slots for them.
- **Importing a module dice set keeps its images.** Import as theme now carries a set's image faces (a natural 20 icon, full face art, coins, Fate dice, d100 tens) into your theme; only 3D models and word or symbol faces stay with the set, and the note says so. Plain numbered faces are no longer reported as lost.
- **Throw shows the real set.** The theme browser's Throw button rolls a module dice set with its own models and faces, not just its colours.
- **A better-looking dice tray.** A solid panel (the chat no longer shows through), dice tiles that glow when picked, a joined modifier, a Fortune / Misfortune switch and a Roll button with a rocking d20 (the formula is in its tooltip). It lines up with the chat box exactly.
- **Fixed:** pets set to rest in a top corner rested at the bottom instead (Foundry v14's empty interface boxes were taken for buttons).
- **Roll filters.** Choose which rolls you see as 3D dice: initiative, roll tables, rolls during combat, damage, other players' rolls, blind and private rolls, and big rolls. Each can show, show only your own, or skip; the GM sets a world default (Configure Settings, Dicer, Roll filters).
- **Bigger dice.** Dice size (and Pet size) now go up to 3x.
- **Pet size.** Pets have their own **Pet size** setting, so bigger dice no longer mean bigger pets.
- **Crit and fumble text stays sharp and on screen.** The JB2A CRITICAL / MISS text keeps one screen size whatever the dice size, and a die landing at the edge of the screen no longer pushes it out of view.
- **Theme and effect sounds** can be turned off on their own (the zap, chime, fanfare and the rest), leaving dice impacts and pet sounds as they are.
- **Dice above windows.** A new setting draws the dice over open windows and character sheets: never (as before), only while your own roll is on screen, or for every roll.
- **Grab and toss.** Once dice land, pick one up with the mouse and fling it: it bounces off the other dice and pets and settles again, still showing the same number. Purely for fun: the result never changes. Turn it off with **Grab and toss dice**.
- **Chat dice tray.** A dice tray docked under the chat input, tinted in your dice theme: click a die to add it, right-click to remove, hold for quick counts, set a modifier and roll. It fits the world's system: the dice it uses, and its own two-d20 helper where the rules have one (advantage and disadvantage in D&D 5e, fortune and misfortune in Pathfinder 2e, advantage and disadvantage in Daggerheart, where Roll with no dice picked (or exactly 2d12) makes a real Duality roll through the system's own roll dialog, edges and banes in Draw Steel, none elsewhere). If you may roll by hand, drag a die out onto the table to throw it. Each player can customize their own tray with the gear button (which dice show, the helper buttons, the modifier; saved with their user, so it follows them to any device). It uses the chat's own roll-mode buttons, and hides itself while the Dice Tray module is active. Turn it off with **Chat dice tray**.
- **Number size and thickness.** Two new sliders in the dice editor's Numbers section.
- **More than one thing inside resin.** Resin dice can now hold a second, suspended layer over their inside: foil flakes, glitter, sand or bubbles, with its own colour and amount (resin blobs with foil flakes, at last).
- **Living insides per look.** Each look can turn its moving inside on or off; the global setting still turns them all off.
- **Module dice sets in the theme browser.** Dice sets other modules add through the Dice So Nice API appear under a new "Module dice" filter: use one as your dice, or import it as a theme you can edit.
- **3D dice models on every die.** Model dice sets (The Rollsmith's TRS sets and others made for Dice So Nice) now show their models on the d8, d10, d12 and d20 too, not only the d2 and d6, always with the rolled number on top. d4 and d100 models (the d100's tens die) show too, and so do dice thrown by hand, which land on the model's own number.
- **Dice So Nice module textures.** Dice from modules that bring texture art (Paizo adventure modules, RealDark) now show that art on every face, fitted as Dice So Nice fits it, in the module's font. Importing such a set as a theme keeps both.
- **Body images.** Themes can put a picture on the die itself: wrapped across the whole die (patterns, photos) or on every face (a crest), with scale, rotation and strength. Pick it in the dice editor's Body section.
- **Face images.** Themes can put your own images on any face of any die (a logo on the 20, say), in their own colours or tinted like the numbers. Pick them in the dice editor's Numbers section.
- **Electronic dice (Pixels).** A die type set to Pixels (or another electronic dice module that uses Foundry's own form) stays with it, and Dicer rolls the other dice by hand, even within one roll. Before, any electronic dice switched rolling by hand off entirely.
- **Rolls from physical dice.** A new per-player setting: rolls from physical dice (Pixels, other electronic dice, manual entry) are animated and get a dice mark on their chat card (the default), or are only animated, or only marked with no 3D dice.
- **Fixed:** the dice editor offered a second colour for resin bodies that had no effect; it is gone.
- **Fixed:** damage dice in PF2e and D&D 5e came out as flat coloured plastic (fire as plain red) instead of their damage look. The system labels each damage die with its type, and that label matched a plain colour set of the same name first; the damage look now wins.
- **Pets rest where you choose.** Resting pets no longer move out of your cursor's way. Instead they wait at the spot you pick in **Where pets rest**: near the dice in their owner's roll area (the default), in one of the four corners, or at the bottom centre. The choice is per player and applies to every pet on your screen.
- **Click to pet.** Click a resting pet and it wiggles happily, with a few hearts and a chirp. Click it too often and it huffs, hops off and ignores you for a few seconds. Only clicks right on a pet on the open table are caught; everything else, including clicks on a window over a pet, goes to Foundry. Turn it off with **Click to pet**.
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
