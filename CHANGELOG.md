# Changelog

## Unreleased

- **Pet size.** Pets have their own **Pet size** setting, so bigger dice no longer mean bigger pets.
- **Crit and fumble text stays sharp and on screen.** The JB2A CRITICAL / MISS text keeps one screen size whatever the dice size, and a die landing at the edge of the screen no longer pushes it out of view.
- **Theme and effect sounds** can be turned off on their own (the zap, chime, fanfare and the rest), leaving dice impacts and pet sounds as they are.
- **Dice above windows.** A new setting draws the dice over open windows and character sheets: never (as before), only while your own roll is on screen, or for every roll.
- **Grab and toss.** Once dice land, pick one up with the mouse and fling it: it bounces off the other dice and pets and settles again, still showing the same number. Purely for fun: the result never changes. Turn it off with **Grab and toss dice**.
- **Chat dice tray.** A dice tray docked under the chat input, tinted in your dice theme: click a die to add it, right-click to remove, hold for quick counts, set a modifier and roll. It fits the world's system: the dice it uses, and its own two-d20 helper where the rules have one (advantage and disadvantage in D&D 5e, fortune and misfortune in Pathfinder 2e, the advantage d6 in Daggerheart, edges and banes in Draw Steel, none elsewhere). If you may roll by hand, drag a die out onto the table to throw it. It uses the chat's own roll-mode buttons, and hides itself while the Dice Tray module is active. Turn it off with **Chat dice tray**.
- **Number size and thickness.** Two new sliders in the dice editor's Numbers section.
- **More than one thing inside resin.** Resin dice can now hold a second, suspended layer over their inside: foil flakes, glitter, sand or bubbles, with its own colour and amount (resin blobs with foil flakes, at last).
- **Living insides per look.** Each look can turn its moving inside on or off; the global setting still turns them all off.
- **Module dice sets in the theme browser.** Dice sets other modules add through the Dice So Nice API appear under a new "Module dice" filter: use one as your dice, or import it as a theme you can edit.
- **Fixed:** the dice editor offered a second colour for resin bodies that had no effect; it is gone.

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
