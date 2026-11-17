# Changelog

## Unreleased

- **The tray shows while you edit it.** With **Show the dice tray: Only while rolling**, the tray now stays on screen while the Dice tray window is open.
- **The tray fades with the dice.** A tray that shows only while rolling now fades out together with the dice, not a moment after.
- **Fixed: big rolls spilled out of the tray.** A roll with more dice than the tray holds lying flat used to widen its landing area past the tray, so dice came to rest outside it. Now the dice pile up inside the tray.
- **Rolling by hand uses the tray.** Hand-thrown dice now start and land in your tray, and a tray that shows only while rolling appears as soon as the hand dice load.
- **Saved trays.** A GM can save trays (a party crest, say) in the Dice tray window, and each player can pick one as their own tray.
- **Pets sit on the tray's rim.** With a dice tray on screen, your dice pets now sit along its top edge, out of the dice's way. They still react to every roll (cheering a 20, shivering at cold dice and so on), and a die slamming into the wall beside one makes it wobble. A tray that shows only while rolling takes its pets with it when it slides away, and brings them back for the next roll. The new **Pets and the dice tray** setting can put them back in the tray, where the dice can hit them, or keep them in the roll area instead.
- **Dice bag favourites.** Star the looks you like and the bag shows only those, with a switch to show them all.
- **Shortcuts in the themes window.** A **Dice tray** button sits next to **My pet**, and a gear opens all Dicer settings.
- **Coloured light from dice is now a setting, off by default.** Turn on **Coloured light from dice** to have clear dice cast light in their colour onto the table. Glowing dice then light it too, in their glow colour and brighter the stronger the glow.
- **Easier to see:** dice shadows are darker, and the coloured light (when on) is much stronger. With **Dice lighting: Scene**, a dark scene no longer dims the dice as far, nor tints them so deeply blue, so a resin die's inside still shows at night.
- **Many more Animater moments, where you want them.** Trigger rules now offer 16 of Animater's moments, up from 6: new are Lean, Smear, Close in, Grain, Speed lines, Glow, Shockwave, Dust falls, Token sways and Token bobs. Each plays on the whole screen, where the dice landed, or on the roller's token (whichever that moment allows), at Animater's own strength or Gentle, Medium, Strong or Full. A crit can send a shockwave out from the d20, or a fumble make your token wobble.
- **Animater moments:** the trigger editor offers moments only when your Animater version can play them, and the console says so when a moment is skipped. **Fixed:** a rule's **Preview** now plays its moment too. It used to leave the moment out, and with more than one GM online it only played for the active GM.
- **Fixed: Glow pulse was nearly invisible.** It only drew a thin rim, which was lost on light maps and among many dice, then flashed solid as the dice faded, so it looked as if it played at the end. The glowing die now takes the glow's colour too, with a wider rim, as soon as it lands.

## 0.3.2

- **Dice trays look real.** Surfaces and rims are now textured: wood grain with planks, rough stone, pebbled leather, fine felt and brushed metal, each in the colour you pick. Rims have a lit bevel and drop into the floor, metal rims have rivets and leather rims have stitching.
- **Tray shapes.** A tray can be a **Rectangle**, **Round**, a **Hexagon** or an **Octagon**. Dice always land inside the shape.
- **A new Dice tray window.** A live preview of your tray at the top, then Shape, Surface, Rim and Floor design, each as picture buttons, with sliders that show their values.
- **Fixed:** a tray with no floor design was covered in a gold tint.
- **The Dice bag shows the looks.** It is now the first tab of the chat dice tray's gear panel (next to Customize), with a picture of each look on the die you are changing. Pick All dice or one die type at the top.
- **Fixed:** the chat dice tray's Roll button had shrunk to a sliver (on PF2e, for example). It keeps its full size now, and Fortune / Misfortune become arrows when the bar is tight. Their tooltips still name them.

## 0.3.1

- **No more look-alike themes.** Three built-in themes looked like others in the theme browser. **Verdant** is now green malachite (it was Jade Marble's look with a wood sound) and sounds like stone. **Dragon Hoard**'s d20 is now amber resin full of gold, like the rest of the set, no longer a copy of Polished Gold. **Celestial**'s d20 is now midnight-blue resin with a gold star and sparkles inside, no longer a copy of Starlit Glitter.

## 0.3.0

- **More module dice sets keep their faces.** Sets whose face pictures come with bump or glow maps (for example **Daggerdice** and some of **Nice More Dice**) now show their pictures in the theme browser and keep them in **Save to My themes**. Only the bump and glow are left out.
- **Dice So Nice atlases.** Sets that pack all their face pictures, or their texture, into one sheet (Dice So Nice's `atlas` option, used by **Dice Soup**) now show those pictures instead of plain numbers.
- **Fixed:** a module set's d100 pictures landed on the wrong faces, and its ones die wore the tens die's pictures. The tens die now shows the set's d100 faces in order, and the ones die shows the set's d10.
- **New materials.** In the dice editor: **Stone** (granite, slate, sandstone, rough rock and brick), **Bone** (bone, ivory and fossil), **Jelly** (a soft, gummy see-through die) and a **Mirror** finish for metal. For a hollow see-through die, pick Clear resin with nothing inside.
- **New dice shapes.** Next to the crystal d4: a **bullet d6** and **crystal d8 and d10**, long dice that land on their sides. Pick them per die type in the dice editor.
- **Turn the preview die right over.** Drag the preview die up or down to see its bottom faces and its 1; it holds the view a few seconds when you let go.
- **Dice bag.** A bag button on the chat dice tray swaps the look of all your dice, or of one die type, from your themes, the world's or the built-in ones.
- **Dice lighting.** A new setting: Studio (as before), **Scene light** (your dice take the scene's light, darker at night and tinted by its colours) or **Sunlight**.
- **Coloured light.** Clear dice cast a pool of light in their own colour on the table beside their shadow.
- **Glint.** A new effect: a band of light sweeps across the die as it lands. Attack d20s glint by default (the **Attack dice glint** trigger; a GM can switch it off in the trigger editor).
- **Dice trays.** Your dice can land in a tray on the table: felt, wood, stone, leather, metal or your own picture, with a wooden, stitched leather, stone, metal or plain rim, rounded corners and a design on its floor (a sigil, a triangle and moon, a compass, a skull seal, or your own picture, in any colour). The GM sets a table tray for everyone; each player can use it, make their own, or turn trays off. Drag the rim to move it, drag the corner to resize it; keep it on the table or let it slide in only while dice roll. Your dice sound like its surface. Set it up under Configure Settings, Dicer, **Dice tray**.
- **Animater moments.** With Animater active, trigger rules can also play an Animater screen moment (a pulse of colour, a shake, a rumble and more) for everyone, and two ready-made triggers pulse the screen gold on a critical success and shake it on a critical failure. Moments play from the GM's view, so a GM must be online.

## 0.2.6

- **Eight new themes by Sherp:** Against the Grain, All-Seeing, Ebony & Ivory, Eruption, Nautilus, Sandalwood Sense, Scarborough and Wonderland, now built in. Their details in the theme browser say **Theme by Sherp**.
- **Fixed:** a GM had no way to set the world default theme since the settings dropdown was removed in 0.2.1, so **Lock player looks** could not be set up either. Select a built-in or world theme in the theme browser and press **Use as world default**; **Stop** clears it.
- **Fixed:** module dice sets with both a body texture and picture faces showed no numbers, for example Pathfinder 2e's own **Dicefinder Campaign** dice. The texture was drawn over the face pictures. It now stays behind them.
- **Test throws show above windows.** Dice thrown from the dice editor, the theme browser and the effect and damage previews are always drawn above Foundry's windows, whatever **Dice above windows** is set to, so you can see them with the editors open.
- **Fixed:** in a short dice editor or theme browser window, the preview die was squashed flat. It stays square now and the panel scrolls instead.
- **A wiki.** Guides to every feature, a settings reference and troubleshooting at [github.com/roileaf/dicer/wiki](https://github.com/roileaf/dicer/wiki); the README is now a short overview, and building and testing Dicer moved to CONTRIBUTING.md.

## 0.2.5

- **Pets look at your cursor.** A resting pet turns its head, then its body, to watch the cursor as it moves over the table, and holds still once it faces it.

## 0.2.4

- **Only d20s splat pets.** A check's or attack's d20 still splats a pet it hits hard; damage dice and every other die only knock it about.
- **Dice hitting a pet mid-roll set it off.** A die with an element that hits a pet while it watches its owner's dice fly now sets it off right there (it used to react only to dice landing next to it, or while resting).

## 0.2.3

- **Put your pets where you want them.** Drag a resting pet anywhere on the table and drop it: that is where pets rest on your screen from then on, the others lining up beside it, and it watches its owner's rolls from there instead of hopping over to the dice. **Where pets rest** is now **Near the dice** or **Where you put them**; the four corners and bottom centre are gone, and a corner you had picked becomes your placed spot. Dragging needs **Click to pet** on; a click without moving still pets.

## 0.2.2

- **Fixed:** the Your pet window could grow taller than the screen with no way to scroll to its last settings. It now stays within the screen, its settings scroll, and it can be resized.

## 0.2.1

Pets get a reaction and a voice for every damage type, your pet gets its own window, and damage dice win over 3D model sets.

- **Damage dice over your dice set.** If your dice are a module dice set with 3D models (The Rollsmith's sets and the like), damage dice now set it aside and roll in their damage look, instead of the set's models hiding it. Turn it off with **Damage dice over your dice set** to keep the set's models on damage dice.
- **Importing a 3D model set takes its colours.** A dice set that is all 3D models (no colours of its own) now imports as a Dicer theme in the models' own colours (a gold body with red numbers for Gold Red Armored), instead of Dicer's default look under the set's name.
- **Your pet has its own window.** Pick your pet and its colour in **Your pet** (Configure Settings, Dicer, or the theme browser's My pet button), with all your pet settings (size, where pets rest, how long they stay, splats, petting, reactions, moods, cheering, sounds). It was in the dice editor, but it was never part of a theme: it is yours, whatever dice you roll.
- **Pets react to every damage type.** Each element now has its own reaction: acid fizzes green bubbles, poison leaves it queasy in a green haze, void sinks dark motes into it, vitality makes it wiggle happily under golden motes, sonic rings spread around it, force knocks shards off it, mental leaves pink swirls circling its head, spirit wisps rise off it, bleed drips, a slash sweeps past, needles dart in, and a blow kicks up dust (fire, frost and storm as before). An elemental die that hits a resting pet now sets it off instead of splatting it; weapon dice (slashing, piercing, bludgeoning) still splat it on a direct hit.
- **Cute pet noises.** Pets purr when petted, go "hmph" when they huff, and every damage type has its own voice: a cough for smoke, chattering teeth for cold, a buzzing squeak for electricity, a fizz for acid, a queasy "bleh" for poison, a spooked "ooo" for void, a happy coo when healed, ringing ears for sonic, an "oof" for force, a warble for mental, a ghostly "wooo" for spirit, an "ow-ow" for bleed, a "whoa!" for slashing, a "yip!" for piercing and a "bonk" for bludgeoning. **Pet sounds** (in Your pet) mutes them.
- **Tidier settings.** Dicer's settings are grouped under headings (General, Graphics, Sound, Effects, Damage dice, Pets, Rolling by hand, Roll areas, Chat and dice trays). The **Dice theme** and **World default theme** dropdowns are gone: the theme browser picks both.
- **Fixed:** clicking a pet did nothing where it rested over part of Foundry's interface (the scene controls, players list, hotbar or scene navigation edges); a click right on the pet now pets it.
- **Fixed:** an elemental die hitting a resting pet splatted it instead of setting off its reaction.

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
