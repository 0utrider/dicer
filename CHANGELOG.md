# Changelog

## 1.0.18

- **Your Dicer settings follow you to any browser.** Personal settings (theme, dice look, tray look, pets and pet volume, sounds, effects, slow motion, screen shake, damage presets, roll filters, rolling by hand, the chat tray...) are now saved with your Foundry user instead of in the browser, so a new browser or computer no longer starts from scratch. On the first load after updating, each browser's old values are copied over (settings you already have as a user setting are kept).
- **What your machine can draw stays per browser:** Enable 3D dice, Pixel ratio cap, Quality, Interiors, Inside motion, Engraving, Shadows and Glow, so a laptop and a gaming PC can each keep their own.

## 1.0.17

- **Dice So Nice library dice come over.** The dice players designed in Dice So Nice's dice library become themes in their **My themes** (dice sharing a name make one theme, with a look per die type), and the world's library becomes world themes. A player's look that pointed at a library die now gets its colours. Players already imported get one more pass, on their next login or through **Import all players now**; choices made in Dicer are kept.
- **Dicer's theme Import takes Dice So Nice export files** (its settings export or its dice library export): their dice and looks become themes.
- The Dice So Nice migration report counts each player's library dice.
- Not yet imported: a library die's per-face images and labels (its base colours, material and texture come over), and Dice So Nice's per-damage-type looks.

## 1.0.16

- **1.0.15 shipped without its module files** (its build failed on a slow test), so installs and updates from the manifest failed. 1.0.16 is the same release, rebuilt: everything listed under 1.0.15 is in it.
- **The Dice So Nice migration report scrolls**, at a height that fits the screen.
- **Import all players now** says when there is nothing new to import, instead of "Imported: 0 and 0".

## 1.0.15

- **Saved Dice So Nice looks come over as themes.** Every look a player saved in Dice So Nice is added to their **My themes**, once, when they next load the world (a look that uses another module's dice set comes over once that module is active).
- **The GM can import every player at once.** The Dice So Nice migration report (in Dicer's settings) has an **Import all players now** button: every player's dice colours and saved looks, and the world settings, without waiting for each player to log in. Choices already made in Dicer are kept.
- **The benchmark can be stopped.** A Stop button while it runs, and closing its window stops it too; the scenarios measured so far stay in the table.
- **The tray's gear panel tabs no longer spill their text** in systems with bigger button text, such as Pathfinder 2e.
- The notice after importing Dice So Nice colours now shows its text instead of a raw key.
- **A cleaner Dice So Nice migration report**: compact status tiles (with a warning when the import is switched off), a world settings table with headings, and tidy player rows, at a normal size in every system.
- Dice So Nice's newer ghost dice choice (none, for all, roller, players) now imports into Dicer's ghost dice setting.

## 1.0.14

- **Pet sound volume.** A new slider in **Your pet** sets how loud the pets are on your screen; at 0 they are silent.
- **No more dice turning after they stop** when physics decides the result. A die that lands leaning on another die, a wall or a pet now topples onto its nearest face the moment it stops, gently, instead of lying still until every die has stopped and then spinning to another number.
- **Slow motion for natural 20s and 1s now works when physics decides the result** on the roller's own screen, not only for everyone else.

## 1.0.13

- **Every pet has its own voice.** The mimic knocks like hollow wood, the slime bubbles, the dragonling growls, the owl hoots, the frog croaks, the ghost whispers with an echo, the mushroom squeaks, the floating eye warbles, the golem grinds and the cat meows. Every sound a pet makes uses it: cheers and sulks, damage reactions, splats, purrs and huffs. Your voice pitch still applies.
- **More things to say.** Natural 20s, natural 1s, ordinary results and mixed results each have four takes, picked at random and never the same one twice in a row.

## 1.0.12

- **Pets talk through the whole roll.** While your dice fly, your pet goes "ooh?" (one of three, a different one each time). When they land it has something to say every time: a satisfied "mm-hm" for an ordinary result and a puzzled "huh?" when a 20 and a 1 land together, on top of the cheer for a natural 20 and the sulk for a 1. Blind rolls stay silent.
- **Your pet shows up for your own rolls again** when physics decides the results, when you throw by hand, and when you roll from the chat dice bar.
- **No old pet flashes on screen.** Pet models now load at the start, so the first roll shows your pet's model straight away.
- **A pet you placed stays put.** On the first roll after a reload, or after it left, it watches from the spot you dragged it to instead of hopping into the tray.

## 1.0.11

- **All ten pets remade as real 3D models.** The mimic, slime, dragonling, owl, frog, ghost, mushroom, floating eye, pebble golem and cat are now smooth, sculpted creatures with painted textures (a tabby cat with a cream muzzle, a feathered owl, a spotted mushroom, a wooden mimic with iron bands and brass, a glossy jelly slime, a chipped stone golem with glowing runes...), real faces that blink, smile, frown and gasp, and bodies that bend. Your pet colour still applies (to the fur, scales, cap or wood, not the eyes or markings), and Natural colours shows each in its own.
- **Winged pets flap when they fly over, front legs no longer dip into the table when a pet leans in to throw, and a huffy pet turns its whole body away.**
- **Dice So Nice model dice sets:** the way Dicer orients them (which face carries which number) is now measured from the dice models themselves.

## 1.0.10

- **Pet view.** A new choice in **Your pet**: see pets **from above** like the dice, **angled**, or **facing you**. The pet leans toward you so you see its face and body; the dice, its shadow and its splat stay on the table. Only on your screen.
- **Pets grab at dice.** A die flying right past a pet makes it turn and grab at it: the frog flicks its tongue, the cat bats a paw, the mimic chomps, the floating eye flings a tendril, the golem swings a fist.
- **Cleaner pet models.** The owl has one smooth face with its eyes open and snug feathered wings; the ghost is one smooth sheet with its arms coming out of it and blushing cheeks; the mushroom has a real stem with gills under its cap; the frog's eye sockets are smooth and its croak is a small throat swell instead of a big balloon; the floating eye has proper eyelids and smooth tendrils.

## 1.0.9

- **Preview your pet.** A button in **Your pet** brings your pet out to throw a d20 on your screen only (no roll, no chat message), so you can see a new pet, colour or voice pitch without rolling.
- **Fixed: the Natural colours and Voice pitch labels in Your pet showed their raw names** (since 1.0.7).

## 1.0.8

- **Fixed: 3D dice didn't start on The Forge** ("3D dice are disabled (startup failed)", with a SecurityError about a physics worker). The Forge serves modules from its own asset server, and browsers won't start a background worker from another site's script. Dicer now starts its physics and font workers in a way that works there too.

## 1.0.7

- **Seven new dice pets, ten in all:** an **Owl** that flies and spins its head on a crit, a **Frog** that croaks, leaps and flicks its tongue, a shy **Ghost** that floats, a **Mushroom** that puffs spores, a **Floating eye** on soft tendrils, a chunky **Pebble golem** with glowing runes, and a **Cat** that bats your dice off the table. Each has its own crit and fumble, reacts to fire, cold and lightning dice, gets squished by a d20 and pops back, and sulks, cheers and purrs like the others. Pick one in **Your pet**.
- **Natural colours.** A new box in **Your pet** gives every pet its own colours (a brown owl, a green frog, a ginger cat...) instead of the colour you pick. Picking a colour turns it off.
- **Voice pitch.** A slider in **Your pet** makes your pet sound higher or lower. The new pets each have a voice of their own too: the golem is deep, the mushroom squeaky.

## 1.0.6

- **Fixed: dice froze as they faded out in Firefox** (and the first roll of a new look froze as it was thrown). Firefox only finishes preparing dice graphics the first time they are drawn, so Dicer's preparation at load never really happened there. Dicer now finishes it while preparing.
- **In browsers like that, the damage dice looks are prepared one at a time in quiet moments after loading**, never while dice are on screen, instead of all at once (or not at all, as in 1.0.5).
- **Removed 1.0.5's pause at the start of a throw**, which added a second freeze instead of fixing the first.

## 1.0.5

- **Loading into the world no longer stutters on some computers** (seen in Firefox on Windows). Where the browser stops everything while it prepares dice graphics, Dicer now prepares only your own dice when the world loads, as it did before 1.0.1, instead of every damage dice look one after another.
- **Fixed: the first roll of a new dice look froze as the dice faded out** (the first Electric Arc, say). The fade's graphics are now prepared as the throw starts, together with the rest of the dice, so on those computers a new look pauses once before the dice appear and then throws and fades smoothly.

## 1.0.4

- **Fixed: loading into the world froze on some computers** (seen in Firefox on Windows). There the browser stops everything while it prepares each piece of dice graphics, and Dicer was preparing all the damage dice looks right after the world loaded. It now prepares them one at a time with a pause between, so the page stays responsive.
- **No more "WEBGL_debug_renderer_info is deprecated" warning in Firefox.** Dicer reads the graphics card's name the way Firefox now asks.

## 1.0.3

- **Fixed: "material warm-up failed" in the console on slower computers.** Since 1.0.1 Dicer prepares every damage dice look when the world loads, all in one go, and on a slow graphics card that could run past its 10-second limit. It now prepares them a few at a time, and a slow one is noted as still preparing in the background rather than as a failure (it never was one: the dice still worked).

## 1.0.2

- **Picture trays: opacity and darkness.** A tray with your own picture as its surface now has a **Picture opacity** slider (the picture fades into the tray colour, which you can pick too) and a **Picture darkness** slider, so a busy or bright picture can sit back behind the dice.
- **Fixed: theme previews left out the symbols on module dice sets.** A set from another module with symbols, words or pictures on its faces (Ponyfinder's pony on the 20) showed plain numbers in the Dicer themes cards and preview, though rolls drew the symbols. The previews now draw them too, unless **Picture and symbol faces** is off.

## 1.0.1

- **Fixed: the canvas froze for a moment on the first roll of a damage type** (an Electric Arc, a fireball). Fire, cold, electricity and the other damage dice have their own looks, and the first roll of each had to prepare its graphics on the spot. Dicer now prepares them in the background when the world loads.
- **Fixed: a short freeze as the dice faded out**, on every roll, worst on resin dice with an inside. It could also stall an animation playing at the same time (Automated Animations, JB2A). The fade's graphics are now kept ready between rolls instead of being rebuilt each time.

## 1.0.0

Dicer 1.0: the first official release. 3D dice that tumble and land on your real roll for everyone at once, with real physics (or let the physics decide), 39 themes, your own dice designs, damage dice, effects and trigger rules with JB2A, dice trays, rolling by hand, dice pets and roll stats, and Dice So Nice modules and dice sets kept working.

- **Nine new themes by Sherp:** Antelope Canyon, Carbon Fiber, Dark Opal, Edgelight, Ivory & Ebony, Jelly Belly, Olympus Heights, Rare Shiny and Vault Floor, made with the newer materials (sandstone, brick, granite, opal, chameleon, mirror and patina metal, bone, jelly). Stone dice sound like stone, metal like metal, and Jelly Belly and Carbon Fiber like plastic.
- **Wonderland's numbers are easier to read, and Eruption's living insides easier to see** (Sherp's updates).

## 0.6.2

- **Fixed: brick dice shimmered.** On some faces (every d8 face, half the d20's) the bricks broke into flickering speckles as the die turned, in the preview and in rolls. Those faces point as much along one direction as another, and the brick pattern kept flipping between the two pixel by pixel. Each face now settles on one.
- **Fixed: the Dice tray window's buttons ran off its edge** in a narrow window; they now wrap onto another row. The GM's **Save for players** button no longer spills its label out of the window.
- **Pop the tray out from the table.** A small button on the tray's top-right corner opens it in a window of its own for a second screen, without going through the settings.
- **Stitched leather rims on hexagon and octagon trays.** The stitching only showed on rectangle and round trays.
- **A taller tray preview** in the Dice tray window.
- **Fixed: a tray sometimes sat under windows** although the dice are set to show over them (it lost that after switching tray modes until the next roll).
- **Clearer names for the three dice trays in the settings.** The **Dice tray** is where your dice land; the row of dice under the chat is now the **Chat dice bar**, and the token-controls button that opens a dice picker to throw by hand is the **Throw by hand tool**.
- **Metallic numbers in any colour.** Gold and silver are one metal finish tinted by the number colour, and the appearance editor now shows that colour for them too: pick gold or silver to start from, then tint it.
- **Glow ink brightness.** A slider for how brightly the **Glow ink** numbers shine (0–200 %).
- **The appearance editor's Glow is now Number glow**, with a note: it is a halo around the numbers, while Glow ink makes the ink itself shine.
- **Fixed: number colours you picked changed by themselves.** Dicer lightens or darkens numbers that would be hard to read on the die, so a blue number on a grey die turned pale as the grey got darker. Now a colour you pick in the appearance editor is kept as picked: picking it turns off the new **Keep numbers readable** option for that look, and you can turn it back on. Built-in themes and your existing looks keep it on.
- **Stone dice judge number contrast with their second colour** (brick's mortar, granite's crystals), so numbers are kept readable against what the die really looks like.

## 0.6.1

- **Dice trays have more depth.** The floor now sits below the walls: the top wall casts a deep shadow on it, the side walls softer ones, the corners darken and the bottom wall catches a little light. The tray casts a fuller shadow on the table, and the rim's bevel is crisper. Hexagon and octagon trays get the same depth.
- **Let the physics decide every roll.** A new setting, **Physics decides the result** (General): every roll is thrown for you, and the faces the physics lands up are the result, instead of Foundry choosing the numbers and the dice turning to show them. With **Roll by hand** on **Ask**, the rolls you let roll automatically are decided by the physics too. The dice are solved in a few milliseconds, so rolls do not wait for the animation, and everyone at the table sees the same throw. The chat card shows an atom for a roll the physics decided. When the GM requires rolling by hand, the throw screen still opens.
- **No more rings where dice hit the table.** **Impact effects** drew a pale ring at every firm bounce, which looked like a little shockwave. Now only a hard hit shows anything: a few sparks, as before.
- **More randomness behind every throw, and a stricter fairness check.** Each throw now starts from a 128-bit random seed from your browser's secure random source (it was 32 bits), run through the xoshiro128\*\* generator, so the number of different throws is no longer limited to about 4 billion. The fairness test now throws every die shape 100,000 times instead of 10,000, and its report shows how far the luckiest face strays from a fair share and how small a bias the run can still catch.
- **Fixed: a tiny d12 bias when the physics rolls.** The stricter fairness test caught the d12 landing on 4 about 3 % less often than it should (8.05 % of rolls instead of 8.33 %). The die's shape and weight were perfect; the physics engine favoured some faces over others by how it stored the die internally. Each throw now gives every die a freshly shuffled internal layout, so no face is favoured.
- **Fixed: rolling by hand did nothing through Foundry's dice settings.** On Foundry v14, Dicer could not put the dice on its own method, so **Ask** and **Always** never opened the throw screen (only the chat dice tray's throw worked). They work again.
- **Every damage type has its own landing sound.** Only fire (a crackle) and electricity (a zap) had one; the rest landed with just the dice clatter. Now cold cracks like ice, acid sizzles, sonic rings, poison bubbles, force hums, vitality rises in a warm shimmer, void swells and is swallowed, mental warbles, spirit sighs like an airy choir, bleed lands with a wet hit and drips, and physical (slashing, piercing, bludgeoning) with a solid knock. They play at the **Effects volume**, and a GM's own sound for a damage type still replaces them. The eleven new sounds can also be picked for trigger rules and theme celebrations.

## 0.6.0

- **Roll stats.** A new **Roll stats** window (a button with the token tools on the left, the theme browser's **Stats** button, or Configure Settings, Dicer; **Roll stats in the token tools** hides that button) shows everyone's d20 luck **Tonight**, over the **Last 30 days** or for **All time**: how many d20s each player rolled, their average, natural 20s and 1s, and whether they run **Hot**, **Cursed** or **Fair** (judged from 10 d20s). Pick a player to see how often each number came up next to a fair die, their longest run of 15 or more, their latest 20 and 1 (named after the roll, like "1 on Reflex save"), and what their pet makes of it. Only rolls everyone can see are counted for everyone. The GM's computer also keeps blind, GM, self and whispered rolls, and **Count private rolls** adds them for the GM alone. Players clear their own stats; the GM can clear anyone's, **Clear all**, or start a **New session** (Tonight otherwise covers the last 12 hours). The GM can turn counting off with **Keep roll stats**.
- **Dice So Nice migration report.** Configure Settings, Dicer, **Dice So Nice migration report** (GM only) shows what Dicer did with this world's Dice So Nice data: each world setting and whether it was copied, kept at the value already chosen in Dicer, or has no Dicer counterpart; each player's dice colours, and which players have not migrated yet (that happens the next time they log in). It also says when **Import Dice So Nice settings** is off and nothing will be copied. The report only reads; it changes nothing.
- **Fixed: unreadable numbers on several built-in themes.** Dicer recolours numbers that would not stand out, but it judged clear resin as brighter than it looks and glitter or a single shape inside as filling the whole die. So it turned good numbers into the die's own colour: Starlit Glitter's and Dragon Hoard's gold went brown over dark resin, Sharp Crystal's white went teal on teal, Stormcaller's went dark blue in a blue storm. Those numbers now keep the colours they were designed with. Five themes whose numbers matched their insides got new number colours: **Ember Core** (dark numbers over the glowing core), **Void Star** (silver over the gold star), **Smoke Swirl** (dark numbers over the white smoke), **Stormcaller** (white, with a fainter glow) and **Celestial**'s d20 (silver over the gold shape).

## 0.5.1

- **Dice from installed modules, without activating them.** In the theme browser, the GM's **Installed dice** button lists the installed modules that add dice but are off in this world. Tick one and its dice load for everyone, under **Module dice**, while the module itself stays off. Only modules that do nothing but add dice can be loaded this way (dice sets like The Rollsmith's). Adventure and system modules that also do other things are listed greyed out: activate those to use their dice. Dice you untick go away at the next reload.

## 0.5.0

- **The dice tray on another screen.** In the Dice tray window, **Show on another screen** opens the tray in a window of its own: drag it to your second monitor and the tray fills it. Every roll on your screen then lands there instead of on the map, pets included, and rolling by hand happens in that window too (grab, shake and flick the dice right there). Close the window to bring the dice back. Your browser must allow pop-ups for Foundry, and keep the main Foundry window open (not minimized) while you use it.
- **Fixed: dice stopped well short of round, hexagon and octagon tray walls.** For those shapes the dice could only use the largest rectangle that fits inside, leaving a wide band of empty floor along the curved or slanted sides. The dice's walls now follow the tray's own outline, so they hit its sides there too.

## 0.4.3

- **Fixed: dice bounced off empty space before the tray's sides.** The dice's walls stood 6 px inside the rim, so dice turned back just short of it. They now hit the rim itself.
- **Fixed: pets reacted to how dice look.** A pet now reacts only to a roll's damage type (fire damage, cold damage and so on). Dice that merely look elemental, like **Eruption**'s lava or a fire, frost or storm inside, no longer make it scorch or shiver. Dice trails and bursts still follow the look.

## 0.4.2

- **Fixed: no insides at Low quality.** On **Low** quality, and on **Auto** when Dicer judged the computer slow at start-up (a judgment it keeps), thrown dice showed only a flat tint where their inside should be, while the theme browser's previews looked right. Low now draws insides too, at the fewest steps they are made for; it stays cheaper than the other tiers in every other way. Only if an inside shader fails to compile do dice fall back to the tint.

## 0.4.1

- **Fixed: clear dice hid their insides when thrown.** Dice on the table are seen from straight above, so each top face mirrored the studio's overhead light, and that glare washed out what is inside a clear die (Eruption's lava barely showed, Nautilus's swirls were faint). The overhead light is dimmer now, so insides look as they do in the theme browser. Metal and solid dice look the same as before.

## 0.4.0

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
