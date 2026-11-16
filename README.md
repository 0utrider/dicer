# Dicer

Lightweight 3D dice for Foundry VTT v14 (three.js rendering, Rapier physics in a worker).

## What Plan 1 delivers

- 3D dice for chat rolls: d2, d3, d4, d5, d6, d7, d8, d10, d12, d14, d16, d20 and d100 (tens d10 plus ones d10), plus Fate/Fudge dice (dF, `4dF`).
- A rolled message stays hidden (`dsn-hide`) until its dice land, then `diceSoNiceRollComplete` fires exactly once (15 s watchdog).
- A minimal Dice So Nice compatible `game.dice3d` (`isEnabled`, `showForRoll`, `waitFor3DAnimationByMessageID`, `messageHookDisabled`).
- Zero idle cost: no render loop and a hidden canvas when no dice are on screen.
- Looks, themes and the full DSN API arrive in later plans.

## Build

```bash
npm i && npm run build
```

Foundry loads `dist/dicer.js`; the physics worker and the Rapier wasm are emitted next to it.
Enable the module in a world.

**Dice So Nice must be disabled.** If it is active, Dicer registers nothing and shows the GM a one-time notice.

## Dev preview page

```bash
npm run dev
```

Opens `/dev/preview.html`: no Foundry needed. Pick a body (opaque, metal, resin) and press **Throw** to throw one of each die type at a random target. The value each die actually shows is printed under the canvas next to its target.

## Live smoke test

Runs Playwright (Chromium) against your local Foundry. Prerequisites:

1. `npm run build`
2. Foundry running, a world launched with Dicer enabled and Dice So Nice disabled.
3. A GM account in that world. Install the browser once with `npx playwright install chromium`.

Credentials come only from the environment (nothing is stored in the repo):

| Variable            | Meaning                                       |
| ------------------- | --------------------------------------------- |
| `DICER_FOUNDRY_URL` | Foundry URL, default `http://localhost:30000` |
| `DICER_GM_USER`     | GM user name (required)                       |
| `DICER_GM_PASSWORD` | GM password (required)                        |

```bash
DICER_GM_USER=Gamemaster DICER_GM_PASSWORD=secret npm run test:live
```

PowerShell: `$env:DICER_GM_USER='Gamemaster'; $env:DICER_GM_PASSWORD='secret'; npm run test:live`

It rolls `1d20`, `3d6+2`, `1d100` and `1d7`, prints `smoke: 4/4 passed` and exits 0 on success, and writes `artifacts/live/smoke.json`. Missing variables or an unreachable Foundry exit non-zero with a one-line message.

## Sounds

Dice click and clatter as they land. The sound depends on the die's material (plastic, metal, wood, glass or stone) and on the table surface (felt, wood, stone or metal). Result sounds, such as a fanfare on a natural 20, come from trigger rules (see Effects and triggers).

Impacts are real recorded dice hits (`assets/sounds/`: one 56 KB audio sprite of 33 hits, fetched the first time sounds are used). Loud impacts pick a heavy hit, soft settling taps a light one, preferring hits recorded with the same kind of die; the die's material and the table surface only tint the recording (a metal die is brighter, a wood die duller, felt softer). If the recording cannot be loaded, Dicer falls back to synthesized impacts. Result sounds are still made by code the first time they are needed. Dice hit recordings: SFX Pack - Rolling Dice by Halfwits & Failed Crits, CC0 (see `assets/sounds/CREDITS.md`). Browsers keep audio locked until your first click in the window; after that sounds play normally. No audio is set up until a sound is due, and it is switched off again after 30 seconds of quiet.

Settings: **Dice sounds** (on/off), **Dice sound volume**, **Effects volume**, **Quieter when the window is unfocused**, **Table surface** (world) and **My table surface** (this client). Impact sounds play for any die you can see, including ghost dice, because they say nothing about the result.

## Effects and triggers

A trigger rule says "when a die matches this, play an effect, a sound, or run a macro". Rules match on die type, face value, roll outcome (such as a critical success), damage type or flavor text. Ready-made effects include celebrate, fumble, sparkles, embers, frost, lightning, smoke, shatter, shockwave, light burst, glow pulse, color shift, number flare and shake. The default rules celebrate a natural 20 and mark a natural 1.

Open **Configure Settings, Dicer, Trigger rules** (the trigger editor) to edit them. The GM edits the world rules; each player can add personal rules. The roller's rules decide what plays. Each viewer chooses whether to see other players' effects with **Show other players' effects**.

A macro runs on the roller's own client, once per rule, when the matching die's animation lands. So it does not run when the roller has 3D dice turned off, when their browser tab is hidden, or for dice beyond the maximum dice limit (those are not drawn).

When JB2A (Jules & Ben's Animated Assets, the free `JB2A_DnD5e` or the Patreon `jb2a_patreon` module) is installed and active, Dicer plays JB2A's animations at the dice for celebrate, fumble, sparkles, embers, frost, lightning, smoke, shatter, shockwave and light burst. It uses only the JB2A files already installed (Dicer ships none), and an animation that cannot be loaded falls back to the built-in effect. Glow pulse, color shift, number flare, shake and Dice So Nice effects stay built-in. Turn it off with **Use JB2A animations**.

Dice with an element leave a trail of it while they fly (flames, frost mist, sparks, drips and so on), and a natural 20 on such a d20 ends in a burst of its element. A die gets its element from a fire, lava, frost or storm inside, or else from its damage type: fire, cold (frost), electricity (storm), acid, void, vitality, poison, sonic, force, mental, spirit, bleed, slashing, piercing and bludgeoning each have their own. The dnd5e names map onto them: thunder is sonic, psychic is mental, radiant and healing are vitality, necrotic is void and lightning is storm. Untyped damage has no element, and dice with neither an elemental inside nor a damage type leave nothing. The trails stop when the die settles and fade out quickly, so the number stays readable.

Each player turns these on or off with **Elemental trails** and **Elemental critical bursts** (both on by default). Both also follow **Special effects** and **Show other players' effects**. The bursts are also ordinary effects: they appear in the trigger editor's and the celebrations' effect lists as `burst-fire`, `burst-frost` and so on, and a picked burst plays its own element on any die. At most three bursts play at once. Hidden, blind and whispered rolls never show a burst to anyone who cannot see the result. With reduced motion a burst is a single soft swell of colour, and the lowest quality tier turns trails off and gives the same soft burst.

Other settings: **Special effects**, **Screen shake**, **Slow motion** (changes only your own animation speed) and **Trigger macros** (a macro runs once, on the roller's client).

Effects and their sounds never play for someone who cannot see the roll's result: a blind or whispered roll gives other players nothing, not even a celebration. The render loop runs only while an effect plays, and lower quality tiers run lighter effects. Screen shake is off when your operating system asks for reduced motion.

To preview every effect, damage theme and sound, run `npm run dev` and open `/dev/effects.html`, which also has buttons to audition the recorded dice hits by material, surface and loudness.

## Damage themes

With **Damage dice themes** on, damage dice take on the look of their damage type: fire dice glow with embers, cold dice are icy, acid dice are green and so on, for PF2e and dnd5e damage types. Each theme brings a look, an impact sound material and a landing effect, such as embers when a fire die lands.

Open **Configure Settings, Dicer, Damage type map** (the damage map editor) to point a damage type at a different theme, at one of your colorsets, or at `none` to switch it off for that type. A damage theme beats a player's personal dice on damage dice; an explicit colorset from a system or module beats the theme. Turn **Damage dice themes** off to restore personal dice everywhere.

## Themes

A theme is a look for your dice with an impact sound and, optionally, a celebration for a natural 20 or natural 1. Dicer comes with 22 built-in themes.

Open **Configure Settings, Dicer, Theme browser** (the button "Browse dice themes"). You see every built-in, world and personal theme as a picture of a die. From there you can:

- use a theme as your default, for one die type, for a kind of roll, for one of your characters or for a damage type;
- duplicate a theme into **My themes** and edit it (a base look, a look per die type, the impact sound and the celebrations);
- import or export your own themes as a file, to share them or keep a backup;
- as a GM, publish a theme to the world so every player can use it.

The setting **Dice theme** sets your default theme. Other players see your dice in your theme. A theme's celebration replaces the world rule with the same id (`dicer.nat20` or `dicer.nat1`) for that roller's dice only; other rules in the theme are added.

Themes follow the same privacy rule as looks and effects. Someone who cannot see a roll's result (a blind roll, a whisper, or a ghost die) sees a neutral die, never your theme.

To look at all 22 themes and throw each one with its celebration, run `npm run dev` and open `/dev/themes.html`.

## Designing your own dice

In the theme browser press **New theme** (or duplicate a theme and edit it). The appearance editor shows a live die that turns as you edit. You can change:

- **Material**: opaque, clear resin, metal, marble, pearl, **iridescent** (chameleon, opal or dichroic glass: the colour shifts as the die turns), **gemstone** (amethyst, malachite, obsidian or quartz) or **wood** (oak, walnut, cherry or ebony), with colours and roughness. Picking a style fills in matching colours, which you can still change. Metal has a finish: polished, brushed, antique, **copper patina** or **battle-worn**. Any material can **glow in the dark**: it glows faintly in its own colour, most on the sides in shadow. Only clear resin has an **Inside**: a nebula, glitter, swirl, liquid core or floating shape (a star, heart, skull or sphere, or a sword, axe, shield, dragon or glowing magic circle), **foil flakes** that flash as the die turns, a **floating eye** that always looks up, a pressed **flower**, **moss** or **butterfly**, or a **smoke** plume. A liquid core can also have an **air bubble** that floats to the top and **sand** that settles to the bottom. Any inside can also hold a second, lighter layer **suspended** in front of it: **foil flakes**, **glitter**, **sand** or **bubbles**, with their own colour and amount (say a liquid core with gold foil flakes). On the lowest quality setting the suspended layer is left out.
- **Numbers**: paint, gold, silver, enamel, **outline** (only the rim of each number is filled), **holo foil** (a rainbow that shifts as the die turns) or **glow ink** (numbers that light up, best on a dark die), a colour, the depth and a font. Numbers can be **engraved** into the die or **raised** from it. The d6 can show **pips** (dots) instead of numbers, and the d2 coin can show **heads and tails** or a **sun and moon** instead of 1 and 2. A colour that would be hard to read against the die is made lighter or darker automatically.
- **Crit and fumble icons**: a starburst, crown, skull, broken shield, heart or flame in place of the 20 and the 1. Only d20s show icons; every other die keeps its numbers.
- **Edges**: five steps of sharpness, from sharp to very round. Edge strips: Match body, Paint, Metal or Glow, with a colour and strength; rounded edges only. The d4 can be **classic** (the usual pyramid with the numbers at the corners) or **crystal** (a stretched double pyramid, like a crystal).
- **Glow**, a look **per die type**, and the **sound and celebrations**. Each celebration can use a built-in sound or any audio file on the server (the folder button). With JB2A active, the film button picks any JB2A animation (.webm) to play instead of the chosen effect: with Sequencer active it opens a browser over Sequencer's JB2A entries: categories down the side, one tile per animation that plays on hover, its colours as swatches, and a search, otherwise Foundry's file browser. Dicer stores the file path, so playback does not need Sequencer; it plays when **Use JB2A animations** is on, and the chosen effect (light burst if none) plays when it is off or the file cannot load. The play buttons throw a test die with the unsaved choices, only for you.
- **Living insides** (a setting, per player, on by default): the inside of a resin die moves while it rolls and comes to rest about 10 seconds after it lands. Turn it off to keep insides still. With your operating system's reduced motion on, they move more slowly. A look can also keep its own inside still (**Living inside** in the editor's Inside section, per look and so per die type); the setting off keeps every inside still.
- **Effects flare insides** (a setting, per player, on by default): crit and fumble effects (lightning, frost, fumble, celebrate, light burst, shockwave and the number flare) reach into the die they play on: a liquid core boils, glitter scatters, fire roars, a storm strikes more often, frost flashes, lava cracks wide, every other inside brightens (except the four simple floating shapes, star, heart, skull and sphere, which stay as they are). The flare rises in a moment and fades with the effect; with reduced motion it rises softly once and nothing flashes. It needs **Living insides** on: with Living insides off the insides stay still and this setting does nothing. Only the die of an effect you see flares, so hidden and blind rolls never do. JB2A animations, when they replace the built-in effects, do not flare insides.
- **Elemental damage dice** (a setting, per world, on by default): fire, cold and electricity damage dice get flame, frost and storm insides instead of resin ones. Turn it off for the resin look. A damage type you remapped to a colorset or to one of your own themes is left as written; a remap to the built-in fire, cold or electricity theme gets that theme's elemental inside.

Every look is saved as a theme, so it can be your default, be used for one die type, one kind of roll or one character, be exported, and (GM) be published to the world.

### Fonts

- **Serif** is the built-in DM Serif Display and **Sans** is Atkinson Hyperlegible Bold, a clear face made for reading. Both are open fonts and ship with Dicer.
- Six more built-in styles: **Blackletter** (UnifrakturMaguntia), **Norse** (Germania One), **Uncial** (Uncial Antiqua), **Sci-fi** (Orbitron), **Handwritten** (Caveat) and **Art Deco** (Limelight). All are under the SIL Open Font License 1.1 (licences in `assets/fonts/`). Their digits load the first time a die uses them.
- **On this computer** uses a font installed on your computer (or loaded by the page's CSS). Other players see it only if they have it too.
- **Font file** uses a `.ttf`, `.otf`, `.woff` or `.woff2` file in Foundry's data folder, so every player gets the same digits.
- The digits of a computer font or a font file are built in the background the first time they are needed and then kept. Until they are ready the dice show the serif digits. A font that cannot be loaded falls back to the serif digits and writes one warning to the console.

## Dice pet

A small pet can throw your dice. It hops in beside the roll, and when the dice land it reacts to a natural 20 (a cheer) or a natural 1 (a groan), or does something in between when a roll has both (a natural 20 also throws a few sparkles). Your pet watches from where it sits: it does not move for your roll, it just turns toward the dice and throws them from its spot, then stays there until your next roll, or until it has waited as long as **How long pets stay** says. (A pet's very first appearance hops in from the edge of your roll area to its spot.) It never delays the roll, the chat card or anything else: the pet is decided as the dice first show, so if its graphics have not loaded yet when the roll starts, that roll simply has no pet.

- **Pick yours**: open the appearance editor and use the **Pet** section: None, **Mimic** (a treasure chest), **Slime** or **Dragonling**, and a colour. The default is a mimic in your player colour. The choice is saved to you at once; it is not part of a theme, so saving, copying or exporting a look does not include it. Press **Throw** to see your pet with the look you are editing.
- **Everyone sees it**: each player sees every roller's pet, up to three at a time (one pet per roller). If you roll again while your pet is still out, it throws again; when the rolls overlap (an attack and its damage), it reacts once both have landed, so a natural 20 is never lost.
- **The GM's pet**: the GM's pet throws every roll the GM makes, NPC rolls included. A GM who would rather not have one picks **None**.
- **Resting**: a pet sitting on the table waits at a random spot in its owner's roll area (or anywhere on the table when there are no per-player areas), in a ring around the middle where the dice land (not right in the middle, not out at the edges), and away from the other pets. It keeps still, so it costs nothing while it waits. Like the dice, it is fixed on screen: it does not follow the map when you pan or zoom. Up to three pets and puddles stay out; a fourth roller sends the one that has waited longest away.
  - **Out of your way**: bring your cursor near a resting pet and it moves to a fresh spot away from it, each in its own way: the dragonling flies, the slime boings over in two hops, the mimic scuttles. It does not move while dice are rolling (the dice already know where it sits), but gets out of the way once the dice have faded. Puddles stay put, and your cursor moves pets on your screen only.
  - **Leaving**: after a while with no roll by its owner, a resting pet hops off the table (see **How long pets stay**); a puddle fades away 5 seconds after its splat, but never while dice are rolling. On its owner's next roll it hops back in first, then throws as usual.
- **Splat!**: the pets are solid, so dice bump into them. A gentle hit knocks the pet and it wobbles; a hard one (a die thrown at full pace) bursts it into a cartoon splat: a puddle of goo in the pet's colour with its two eyes blinking up at you, a few droplets around it, and the mimic's lid or the dragonling's wing left lying in it. It plays a little "splat". If its owner rolls within 5 seconds, the puddle pulls back together into the pet, which then throws as usual; otherwise it fades away, and the pet hops back in on its owner's next roll. Any die can splat any pet, yours included: your pet watches your roll from its resting spot, in the path of your own dice, so your own roll can splat it (more often the more dice you throw). Other players' dice, and stray bounces, can splat it too. A pet resting between rolls stays clear of Foundry's controls, player list and macro bar. Splats never change a result and never delay anything. Automatic rolls are thrown on each screen separately, so a splat on your screen may be a near miss on another player's (and pets rest at a different spot on each screen). A hand throw is one throw for everyone: the other screens move their pets to the thrower's layout while they replay it, so the same pet splats on every screen (see **Rolling by hand**).
- **Settings**:
  - **Allow dice pets** (world, GM): turn pets off for the whole table. The Pet section is hidden while it is off.
  - **Show dice pets** (per player): hide pets on your own screen. The Pet section tells you they are hidden.
  - **Pet sounds** (per player): mute the pets' chirps (and the splat).
  - **How long pets stay** (per player): how long a pet stays on the table after its owner's last roll: **Leave after the roll** (pets hop away after their reaction, and a puddle fades away instead of waiting), **30 seconds**, **1 minute** (the default), **2 minutes** or **Always**. Pets move out of your cursor's way while they wait. It replaces the old "Pets stay on the table" checkbox: if you had turned that off, you get "Leave after the roll".
  - **Dice can splat pets** (per player): turn it off and pets stay solid, so dice still bump into them and they wobble, but they never splat.
- **Privacy**: a roll that is hidden or blind never shows a reaction. The pet just nods, in silence and for the same time as any other reaction, so nobody can tell a 20 from a 1. A roll nobody can see has no pet at all. The pet still shows whose roll it is: players who see a hidden roll's ghost dice also see the roller's pet.

## Rolling by hand

Instead of letting the computer roll, you can grab your dice, shake them and throw them yourself. The physics decides the result: the face that lands up is the number on your card. Nothing is rotated to a value.

- **Turn it on**:
  - **Roll by hand** (per player, in Dicer's settings): **Off** (the default), **Ask each time** or **Always**. **Ask each time** shows a small dialog on each roll, naming the roll (its flavor and formula): throw by hand, or roll automatically. When several rolls come at once (a GM rolling initiative for a group, say), it also offers **Throw the rest automatically**, which rolls this one and the rest of that group automatically.
  - **Who may roll by hand** (world, GM): **Everyone** (the default), **Trusted players and GMs**, **GMs only** or **Nobody**. **Require rolling by hand** makes everyone allowed throw, whatever their own setting says. **Hand roll time limit** (10 to 300 seconds, 60 by default) is how long a player has to throw.
  - **Dice types**: you pick them in Foundry's own **Dice Configuration** window (Configure Settings, Core, **Dice**). A die whose method is "Dicer: roll by hand" is thrown by hand.
    - With **Ask each time** or **Always**, if no die is set to Dicer yet, Dicer sets every die for you: d4, d6, d8, d10, d12, d20, d100, the coin, Fate dice and the default method. After that the window decides. Set a die back to another method and Dicer leaves it alone. If you set only some dice to Dicer yourself, only those are thrown.
    - **Off** removes only the entries Dicer set for you. A die you set to Dicer yourself stays, and it is still thrown by hand (with no prompt).
    - **Require rolling by hand** sets every die to Dicer, even one set to another method (such as manual entry). The other method comes back when **Require** is turned off.
    - Dicer's `handRollTypes` setting (console only) limits the dice it sets for you, for example `game.settings.set('dicer', 'handRollTypes', ['d20'])`. Empty means all.
  - **Disabling Dicer** leaves its entries in Foundry's dice configuration. They are harmless: a die set to "Dicer: roll by hand" just gets Foundry's random result while Dicer is off. A die that **Require** took from another method (for example a manual d20) gets that method back only when Dicer runs again with **Require** off. To reset by hand, open the **Dice** window and set those dice to another method, or run `game.settings.set('core', 'diceConfiguration', {})` to put every die back to Foundry's default.
- **Throwing**: when a roll starts, the dice float in your roll area. **Grab** them with the mouse (or a finger), **shake** to rattle them (a harder shake gives them more spin) and **flick**: let go while the pointer is moving and the dice fly the way you flicked, as fast as you flicked. A gentle release is a gentle toss. The dice stay inside your roll area while you hold them, so a release never makes them jump.
  - **Throw for me** (or **Space**): the dice leave your hand with a flick made for you. **Escape** cancels: the roll takes Foundry's random result. If you do nothing for the time limit, the dice roll automatically.
  - **Follow-up rolls**: a roll that starts within 3 seconds of your hand throw landing (a flat check for a concealed target, an automatic damage roll) opens no second throw screen: its dice are thrown for you in your roll area, and the chat card's hand mark says "Thrown automatically after your hand throw". Only a throw you made on the throw screen starts the 3 seconds, so rolling fast never turns every roll automatic. **Throw follow-up rolls automatically** (per player, on by default) turns this off. It applies while **Require rolling by hand** is on too: a follow-up is still a real throw.
  - **Live sharing**: the physics settles a hand throw the moment it leaves your hand, so the result is read then and the chat message and the recorded throw go out at once. Other players watch the throw almost together with you instead of after your dice land; your own chat card still waits for your dice, and the next throw screen opens only once they have landed. Because the message now posts while your dice fly, a roll that starts during that flight (an automatic damage roll) counts as a follow-up too, and is thrown once your dice land. Exploding and rerolled dice are thrown after your dice land, as before. Who receives the throw is decided exactly as before, so blind, secret and whispered rolls stay private. **Share hand throws live** (world, on by default) turns this off.
  - A die that lands cocked, leaning on another die or on its edge, is nudged flat before the result is read, so a result is never ambiguous. The d16 is read from below: it counts the top face paired with the face on the table, and that face glows for a moment after it lands.
- **The dice tray**: a **Dice tray** button under the token controls (the **Dice tray** setting, per player, on by default) opens a small window. Pick your dice and a modifier, choose a roll mode (public, GM only, blind or self) and press **Throw**. It posts a normal roll card whose dice are the ones you threw. A free roll never needs a sheet.
- **What other players see**: everyone who can see your roll sees the same throw, replayed from what you did (same path, same bounces, same final faces), in your roll area scaled to fit their window (no smaller than 60% of your size). **Replay hand throws** (per player, on by default) off shows a normal throw of the same result instead. Dice are replayed only for rolls that exist as chat cards: a roll shown again with `showForRoll`, or an automatic roll, is thrown as usual.
- **Privacy**: a hand throw goes only to the players who may see the roll: a whisper only to its recipients and the GMs, a blind roll or a secret check only to the GMs. A roll players may not see is thrown by you as ghost dice (no numbers), and everyone else gets the usual ghost throw or nothing, and their pets never move for it. Blind rolls made from a sheet are never thrown by hand.
- **Fairness**: every die type was thrown 10,000 times through the real physics and the face counts tested against a fair die (a chi-square test): all shapes pass. `npm run test:fairness` repeats the run. A shape that ever failed would be left to Foundry's random roll, and the card would say so.
- **Trust**: a hand roll is as trustworthy as Foundry's own manual entry: the throw happens on the player's computer, which tells the server the result. A modified client could report any number, exactly as it could type one in a manual roll. The GM can switch rolling by hand off entirely (**Who may roll by hand**: **Nobody**).
- **When it falls back**: if the time runs out, the player cancels, a die cannot be read (a custom die whose shape does not match its faces) or more dice are rolled than **Maximum dice per message** allows, Foundry rolls those dice itself and the roll still completes (nothing hangs). Extra dice that appear in the middle of a roll (exploding or rerolled dice) are thrown automatically after yours. The chat card shows a small hand mark: its tooltip says "Rolled by hand", how many dice rolled automatically, or that it rolled automatically.
- **Pets and splats**: your pet watches a hand throw from where it rests, and it is in the way of your own dice, so a hard throw at it splats it. Other screens move their pets to your layout while they replay your throw, so a splat happens on every screen, at the same place. While you hold the dice your pet keeps still. A screen with **Dice can splat pets** off sees the pet wobble but never burst.
- **Not supported**: using Dicer's method together with another module's interactive dice method (for example a Bluetooth dice module): Foundry then picks its generic dialog, and Dicer's hand rolls stay off (one console warning).
- **Review pages and tests**: `npm run dev`, then `/dev/hand.html` is the review page: the throw overlay, **Throw for me**, a cocked die, a d16 read with its glow, a throw at a resting pet, and the last throw replayed from its encoded form at half the area size. `node tests/visual/hand.mjs` drives it with a real mouse and saves screenshots. The owner's live test is `npm run test:live:hand` (a GM and a player; optionally a second player). The benchmark has two hand scenarios, `handReplay10` (a recorded 10-dice throw replayed) and `handSoak100`, which only Dicer runs.

## GM controls

- **World default theme** (a setting): the theme players' dice use until they choose one of their own.
- **Push to players**: in the theme browser, select a built-in or world theme (publish a personal theme first) and click "Push to players...". It becomes every player's default theme. Their other choices are kept, unless you tick "Replace everything", which also clears every player's choices for a die type, a kind of roll, a character and a damage type.
- **Lock player looks** (a setting, needs a world default theme): every player's dice use the world default, whatever they chose, and the browser hides their "use" actions ("Your GM has set everyone's dice"). Players can still design and save themes. GMs are not affected, and a roll, colorset or damage type that names its own look still does.
  - A player whose theme is already Sapphire Nebula (the built-in default) and who selects it again does not override the GM's world default, because Foundry fires no change for an unchanged setting. To keep Sapphire over a world default, they pick another theme and then pick Sapphire again.
- **Dice look button on actor sheets** (a client setting): adds a Dice look control to the sheets of actors you own: in the header controls (the menu) of current sheets, a header button on older sheets.
- The existing world caps stay as they were: **Graphics quality** (the world cap) and **Maximum dice**. No new caps.

## Roll areas

A roll area is the part of the screen where dice land. By default they use the whole window. Open **Configure Settings, Dicer, Roll areas** (the button "Edit roll areas") to drag and resize a rectangle on your screen, or pick a preset: full, centre, bottom or corner. The GM sets a default area, an area for each player and an optional GM private corner. Players can preview their own area but not change it. Reset always brings back the default.

An area is stored as fractions of the window, so it survives resizing and different screen sizes. It can never shrink below 240 by 180 pixels (or the whole window if that is smaller) and can never go off-screen, so it cannot get lost (Dice So Nice #548). A throw's own area also grows beyond the drawn rectangle when many dice are rolled, so they always fit (about four square die sizes per die; `CAPACITY_PER_DIE` in `src/areas/area-model.js`).

Settings:

- **Per-player roll areas** (world, on by default): throw each player's dice in the area the GM gave them, on every screen. Off throws everyone's dice in the default area.
- **Roll area size** (this client): make every area bigger or smaller on your own screen, around its centre. Other screens are not affected.
- **GM private corner** (world, off by default): on the GM's own screen, throw rolls only GMs can see (blind rolls and GM-only whispers) in the GM's own corner, so they stay out of the way of the scene (Dice So Nice #272). Players never see this.

Areas reveal nothing beyond who rolled.

### Roll area API

Other modules can read and set areas through `game.dice3d.rollAreas` (Dice So Nice has no equivalent, #287). Only a GM can write.

```js
game.dice3d.rollAreas.presets; // ['full', 'centre', 'bottom', 'corner']
game.dice3d.rollAreas.get(userId); // the stored area: { preset: 'corner' } (no id: the default)
game.dice3d.rollAreas.rect(userId); // the pixel rect on this screen: { left, top, width, height }
await game.dice3d.rollAreas.set(userId, { preset: 'bottom' }); // null as id sets the default
await game.dice3d.rollAreas.set(userId, { preset: 'custom', x: 0.1, y: 0.5, w: 0.4, h: 0.4 }); // fractions of the window
await game.dice3d.rollAreas.setGmPrivateArea({ preset: 'corner' });
Hooks.on('dicerRollAreasChanged', (areas) => {
  // areas: { default, users: { [userId]: area }, gmPrivate }, a copy
});
```

`set` and `setGmPrivateArea` resolve to `true` when saved and `false` otherwise (not a GM, or the stored data is unreadable). A malformed area becomes the full window. `dicerRollAreasChanged` fires on every client when an area changes.

To see the presets and two throws into different areas at once, run `npm run dev` and open `/dev/areas.html`.

### Flare a die's inside

`game.dice3d.flareInside(target, { die, amount = 1, duration = 900 } = {})` makes the living inside of dice on this screen flare (liquid boils, fire roars, glitter scatters, and so on), like a crit or fumble does. It is for modules that show their own effects for a roll, such as Animater.

```js
game.dice3d.flareInside(message.id); // every die of the roll shown for that chat message
game.dice3d.flareInside(message.id, { die: 0, amount: 0.6, duration: 500 }); // only the first die
```

`target` is a roll id or the id of the ChatMessage whose roll is on screen. `die` is an index into that roll (default: every die), `amount` is 0 to 1 and `duration` is in milliseconds. It returns `true` when at least one die flared. It returns `false`, and does nothing, when the **Effects flare insides** client setting is off, nothing on screen matches `target`, no matched die has a moving inside, or the effects are not loaded yet (they load shortly after the world is ready). A message id finds the dice Dicer shows for a chat message through its normal message flow; dice shown through `showForRoll` directly, and dice you threw yourself from the tray (hand throws), are found by roll id only. It also returns `false` when the **Special effects** setting is off. It is local only: nothing is sent to other clients, so call it on each client that should see it.

## Chat commands

With the chat-commands module installed, `/dice3d`, `/d3d` and `/dsn` open the Foundry settings on the Dicer tab. Dicer's own settings dialog comes in a later plan, so for now this is the generic settings window. Without the chat-commands module the commands are not registered.

## Dice So Nice compatibility

Dicer replaces Dice So Nice (DSN). It gives other packages a `game.dice3d` with the DSN API and fires the same hooks. Do not run both: if DSN is active, Dicer stays dormant.

Dice sets that other modules register through the DSN API (`addColorset`, `addSystem`, `addDicePreset`) show in the theme browser under **Module dice**, which appears once any are registered. Hidden colorsets and the stock DSN colours Dicer maps itself (white, fire, ...) are not listed. **Use as my default** writes the colorset or system to your look flag, like any theme choice, and is locked when the GM locks player dice. A colorset replaces your look. A system adds its faces and models on top of your look, and **Stop using** removes it. **Import as theme** copies the colours into a theme of your own to edit. Faces, models and textures a theme cannot hold are named in a notification. To keep them, use the module set itself.

### Compatibility table

Status is Works, Works with gaps or Not supported. One row per package surveyed.

| Package                                                                                                      | Status          | Note                                                                                                    |
| ------------------------------------------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------- |
| dnd5e                                                                                                        | Works           | No DSN code.                                                                                            |
| sw5e                                                                                                         | Works           | No DSN code.                                                                                            |
| pf2e                                                                                                         | Works with gaps | Presets, colorsets and hooks work. Its `game.modules.get('dice-so-nice')` check fails.                  |
| swade                                                                                                        | Works with gaps | Presets, colorsets and `showForRoll` work. DiceFactory die internals (`modelFile`, `loadModel`) do not. |
| wfrp4e                                                                                                       | Works           | Uses `showForRoll`, `waitFor3DAnimationByMessageID` and the `linkedTo` flag.                            |
| CoC7                                                                                                         | Works with gaps | Presets work. Its version gates and its DSN flag and setting reads fail.                                |
| cyberpunk-red-core                                                                                           | Works           | Presets and colorsets.                                                                                  |
| daggerheart-duality-dice                                                                                     | Not supported   | Imports DSN's `api.js` and three.js by path, and writes shader uniforms.                                |
| natural-roll                                                                                                 | Not supported   | Patches `box` and `pipeline` internals.                                                                 |
| pf2e-dsn-persistent-bridge                                                                                   | Not supported   | Needs `persistent`, `pendingThrows` and `box` internals.                                                |
| pf2e-dice-flavor-fix                                                                                         | Works           | Adds colorsets and reads `exports.COLORSETS`.                                                           |
| ember                                                                                                        | Works with gaps | The hook works. The moon-phase shader uniform has no effect.                                            |
| midi-qol                                                                                                     | Works           | `showForRoll`, `isEnabled` and `config`.                                                                |
| Dice So Nice special effects (DiceSFX) | Works | Classes added through `game.dice3d` (`addSFXMode`, and `DiceSFX` from `/modules/dicer/api.js`) play when a rule matches. Path imports of DSN's own `api.js` remain a gap, see Known gaps. |
| pf2e-toolbelt                                                                                                | Works           | Hooks and `animateRoll`.                                                                                |
| pf2e-visioner                                                                                                | Works with gaps | Reads `dice3d.box`, which is empty. Dice work. The feature that reads `box` does not.                   |
| pf2e-auto-action-tracker                                                                                     | Works           | `waitFor3DAnimationByMessageID`.                                                                        |
| aoe-easy-resolve, draw-steel-combat-tools, pf2e-aztecs-template-wizard, pf2e-combater, pf2e-flatcheck-helper | Works           | `showForRoll` only.                                                                                     |
| automated-conditions-5e                                                                                      | Works           | `diceSoNiceRollStart` hook.                                                                             |
| draw-steel-target-damage, storyframe                                                                         | Works           | `diceSoNiceRollComplete` hook.                                                                          |
| pf2e-ap200, pf2e-ap222, pf2e-ap223, sf2e-murder-in-metal-city, phils-pf2e-realdark                           | Works with gaps | Dice content. Presets, colorsets and textures register. GLB models show for d2 and d6 only.             |
| trs-black-marble-dice-set, trs-gold-red-armored-dice-set, trs-norse-dd-boneyard                              | Works with gaps | Dice sets. Faces and colours work. GLB models show for d2 and d6 only.                                  |

"Works" means the surveyed calls and hooks are supported. Some behaviour needs a real world to confirm.

### Known gaps

- Path imports of `/modules/dice-so-nice/api.js` and of DSN's bundled three.js do not work. Dicer does not ship those files.
- `game.modules.get('dice-so-nice')` checks fail by design, because Dicer has no stub package with that id. Version gates, such as CoC7's, fail too.
- DSN-scoped user flags and settings that other packages read directly return nothing. Dicer keeps its own under the `dicer` scope.
- `box`, `pipeline`, `persistent` and `pendingThrows` internals are not supported. Pending and interactive throws come in Plan 6.
- GLB model presets: only the d2 and d6 orientations are verified. Other die types show Dicer's own die with the preset's faces and colours.
- Ghost payloads for synced rolls send dice shapes only. Custom die classes, such as coins and Fate dice, arrive as plain dice with the same face count. Dice whose count comes from another roll show as zero ghost dice. Dice whose face count comes from another roll, such as `1d(1d20)`, are not sent at all.
- The `diceSoNiceOnMaterialReady` hook is not fired for a GLB model's own material.

### Integration guide

```js
// Detect Dicer next to DSN.
const has3dDice = game.modules.get('dice-so-nice')?.active || game.modules.get('dicer')?.active;

// Import the public API from Dicer (no DSN path needed).
const { DiceSystem, DiceSFX } = await import('/modules/dicer/api.js');
```

Use `game.dice3d` and the `diceSoNice*` hooks as you do with DSN. Feature-detect members, for example `game.dice3d?.addSystem`. Do not read `game.dice3d.box`.

## Live compatibility test

`npm run test:live:compat` logs a GM and a player into your local Foundry (two browser contexts). It checks that:

1. a public roll animates on both clients and fires `diceSoNiceRollComplete` once on each;
2. a GM whisper roll reaches the player as a card with its content hidden (Foundry delivers whispered roll messages to everyone): the card shows no result and the player draws no dice (ghost dice off; with them on, only ghost dice), while the GM sees dice;
3. a blind player roll shows the player ghost dice or none, never real ones (read through `game.dice3d._debug.lastRollViews`, which holds view kinds and never values);
4. `showForRoll(roll, game.user, true)` from the GM animates on the player's client;
5. an initiative roll hides the tracker value until the reveal.

Use a world with Dicer enabled, DSN disabled, a GM and a player account. Scenario 5 needs an active scene.

| Variable                | Meaning                                       |
| ----------------------- | --------------------------------------------- |
| `DICER_FOUNDRY_URL`     | Foundry URL, default `http://localhost:30000` |
| `DICER_GM_USER`         | GM user name (required)                       |
| `DICER_GM_PASSWORD`     | GM password (required)                        |
| `DICER_PLAYER_USER`     | Player user name (required)                   |
| `DICER_PLAYER_PASSWORD` | Player password (required)                    |

It prints `compat: N/N passed`, writes `artifacts/live/compat.json` and exits 0 on success. It changes `showGhostDice` while it runs and restores it at the end. It creates and deletes one temporary combat; creating it may change which combat is active. It leaves its chat messages in the world. Missing variables or an unreachable Foundry exit 1 with a one-line message.

## Live effects test

`npm run test:live:effects` uses the same accounts and variables as the compatibility test. It rolls a forced natural 20 as the GM and reads the counters in `game.dice3d._debug` (`fxPlays` and `resultSounds`: names and counts only). It checks that:

1. a public roll plays `celebrate` and the `fanfare` sound on the GM client;
2. a GM blind roll plays both for the GM and neither for the player (who sees nothing);
   a player blind roll with ghost dice on plays both for the GM and neither on the player, whose client draws a ghost die;
3. a public roll plays both for the player when **Show other players' effects** is on;
4. with that setting off, the player gets neither.

It prints `effects: N/N passed`, writes `artifacts/live/effects.json`, and restores the settings it changed. It leaves its chat messages in the world.

## Live areas test

`npm run test:live:areas` uses the same accounts and variables. The GM gives the player the `corner` area and the player rolls; it reads `game.dice3d._debug.lastRollArea` on both clients: the settled die centres, the area the throw used and the stage. The area a throw uses is the player's resolved rectangle (`game.dice3d.rollAreas.rect`) grown to hold the dice (`CAPACITY_PER_DIE`), so the test checks that this grown area contains the resolved rectangle and lies inside the stage, and that every settled die centre lies inside it. It then turns **GM private corner** on and runs the same check for a GM blind roll against the GM corner on the GM client, and checks that the player's client threw nothing. It sets each client's **Roll area size** to 1 while it runs, prints `areas: N/N passed`, writes `artifacts/live/areas.json`, and restores the settings it changed.

## Live hand test

`npm run test:live:hand` uses the same accounts and variables as the compatibility test (a second player is optional: `DICER_PLAYER2_USER` and `DICER_PLAYER2_PASSWORD`). It turns the player's **Roll by hand** to **Always**, makes the player roll a public `1d20` through `Roll#toMessage` and presses **Throw for me** by script. It checks that:

1. the GM receives one `hand` payload and the throw's final frame reads the same value as the card;
2. a hand roll whispered to the GM never reaches the second player's socket handler (a counter on that client), when there is a second player;
3. a thrower who does not throw falls back after **Hand roll time limit** (set to 10 seconds while it runs) and the card is marked.

A throw at the player's resting pet, which should splat it on the GM's screen too, cannot be driven by a script: do it by hand. It prints `hand: N/N passed`, writes `artifacts/live/hand.json`, restores the settings it changed and deletes the messages it made. A hand scenario can also be added to the benchmark: `handReplay10` and `handSoak100` replay a recorded throw (`tests/fixtures/trajectory-mixed10.json`, recorded with `node scripts/hand-fixture.mjs`) and are judged on the same targets, but never compared with Dice So Nice.

Unit tests cannot check some things, so a few checks are done by hand in a real world.

## Performance and benchmark

Dicer stays cheap: no render loop while no dice are on screen, and the heavy code loads lazily.

- **World start download:** 4,086,989 B raw, 1,451,693 B gzipped. The budget is 4 MiB (4,194,304 B) and a test fails if world start grows past it. Most of it is the 3.1 MB physics WASM, which has no smaller build.
- **In-game benchmark:** press **Run the dice benchmark** in Dicer's settings, or run `game.dice3d.benchmark()` in the console. It throws four test scenarios on your screen only: `d20`, `mixed10`, `pool30` and `burst20`. `pool30` is capped by the world **Maximum dice per message** setting (`maxDice`), and the summary notes when it was.
- **What it reports:** per scenario, the 95th percentile frame time, the longest task, the first-frame time, heap growth and failed rolls, with a pass or fail against the targets, plus your browser and GPU. On a display that refreshes below 60 Hz the frame checks show n/a and the summary says so. When Dicer lowers its quality tier during a scenario, the summary notes it. **Copy summary** puts it on the clipboard as plain text.
- **Privacy:** it creates no chat messages and uploads nothing. The summary leaves your machine only if you paste it somewhere.
- **Limits:** it refuses while dice are rolling or another run is going, and shows a notice when Dicer is disabled. Firefox and Safari are best effort.
- **Testers wanted:** if you have an Intel Iris Xe laptop or an iPad, please run the benchmark and paste the summary into an issue.

The head-to-head against Dice So Nice is `npm run test:live:bench`.

## Development

`npm test`, `npm run lint`, `npm run format:check`.
