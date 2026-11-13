# Manual live checks

Unit tests use fakes for Foundry. These checks need a real Foundry v14 world with Dicer enabled and Dice So Nice disabled. Run them once before a release. `npm run test:live:compat` covers the privacy and initiative checks (items 7 and 8); everything else here is manual.

For each check, note the result: pass, or what you saw.

## 1. `Roll.fromData` on the legacy `show()` payload

1. As the GM, run `game.dice3d.showForRoll(await new Roll('2d6+3').evaluate(), game.user, true)`.
2. On the player's client, confirm dice fly. Look for a console error about `Roll.fromData`.
3. Pass: the roll rebuilds from the payload and the dice animate.

## 2. `Roll.fromData` on the allow-list ghost payload

The ghost payload has an empty formula and Die-only terms.

1. Turn `showGhostDice` on. As a player, roll blind (`/blindroll 1d20`).
2. On the GM's client the dice are real. On the player's client, confirm neutral ghost dice fly (no numbers).
3. Pass: no console error, and ghost dice with the right face count. In the player's console, `game.dice3d._debug.lastRollViews` shows `ghost` for that message.
4. Repeat with a custom die (a coin or Fate die). Expect plain dice with the same face count.

## 3. World-settings storage reads during migration

The migration reads `game.settings.storage.get('world')` and the raw user flags.

1. Use a copy of a world that ran Dice So Nice (it has `dice-so-nice.*` world settings and a `dice-so-nice` appearance flag on a user).
2. Enable Dicer with DSN disabled. Reload as the GM.
3. Pass: the "migrated" notice shows, `game.settings.get('dicer', 'dsnWorldMigrated')` is true, the mapped values are copied, and DSN's own data is untouched.

## 4. `ForcedReplacement` in `loadSaveFile`

1. Pick a name from the DSN saves on a user (`game.user._source.flags['dice-so-nice'].saves`).
2. Give the user a Dicer look scope that the save does not have.
3. Run `await game.dice3d.loadSaveFile('<name>')`.
4. Pass: `game.user.getFlag('dicer', 'appearance')` has exactly the save's scopes (the extra scope is gone, not merged), and there is no console error.

## 5. `modelFile` routing under a route prefix

1. Set `routePrefix` in Foundry's `options.json` (for example `vtt`) and restart.
2. Enable a module with GLB model presets (for example a trs dice set). Turn `presetModels` on.
3. Roll a d6 and watch the Network tab.
4. Pass: the model file loads from `/vtt/modules/...` with status 200, and the die shows the model.

## 6. Draco GLB models

1. Enable `daggerheart-duality-dice` (its GLB files use Draco compression). Turn `presetModels` on.
2. Roll a d2 and a d6.
3. Pass: the models load (no decoder error in the console) and show the right face up. Other die types show Dicer's own die; that is expected (see the README known gaps).

## 7. Initiative hiding in the real v14 tracker

Also automated in `npm run test:live:compat` (scenario 5). By eye:

1. Start a combat with one combatant. Open the combat tracker.
2. Roll initiative. While the dice fly, the initiative number must not show.
3. Pass: it appears when the dice land. With `hideInitiative` off, or with `immediatelyDisplayChatMessages` on, it shows at once.

## 8. Privacy matrix

Also automated in `npm run test:live:compat` (scenarios 2 and 3). With `showGhostDice` off, a player must never see a GM whisper or a blind roll's dice, nor its result before the message is revealed.

## 9. `chatCommandsReady` timing

Dicer listens for `chatCommandsReady` from module load, not from its `init` hook, so the commands register whenever the chat-commands module fires it.

1. Enable the chat-commands module next to Dicer. Reload.
2. Type `/dice3d`, then `/d3d` and `/dsn`, in chat.
3. Pass: all three autocomplete and open the settings on the Dicer tab, and no chat message is posted.
4. Enable Dice So Nice too (Dicer goes dormant) and reload. Pass: Dicer registers none of the three; `/dsn` belongs to DSN.

## 10. Sound unlock on the first click

1. Reload the world and do not click anything. Roll a die by chat command.
2. Pass: no console error about the audio context. Click anywhere in the window, then roll again: the dice click and clatter.

## 11. Quieter when unfocused

1. With **Quieter when the window is unfocused** on, start a roll and click another window right away.
2. Pass: the landing sounds are clearly quieter. Turn the setting off and repeat: they are at full volume.

## 12. PF2e fire strike shows ember dice

1. In a PF2e world with **Damage dice themes** on, roll a fire strike's damage.
2. Pass: the damage dice look like fire dice (dark resin with orange liquid), and embers rise where they land. With the `fire` entry set to `none` in **Damage type map**, the dice use the normal look.

## 13. dnd5e radiant damage

1. In a dnd5e world, roll radiant damage (for example Guiding Bolt).
2. Pass: the dice use the pale gold vitality theme, with a light burst where they land.

## 14. 30d6 with a "6 gives sparks" rule

1. In **Trigger rules**, add a rule: die d6, value 6, effect sparkles.
2. Roll `/r 30d6` and watch the animation.
3. Pass: no stutter or freeze while the sparks play, and the dice settle and fade as usual. A few seconds later `game.dice3d._debug.isLooping` is false.

## 15. Reduced motion suppresses screen shake

1. Turn on the operating system's reduced motion setting (Windows: Settings, Accessibility, Visual effects, Animation effects off). Reload.
2. Roll a natural 20 with a shake effect in the matching rule.
3. Pass: the dice canvas does not shake. With the OS setting off and **Screen shake** on, it does.

The privacy of effects and sounds for blind rolls, and **Show other players' effects**, are also automated in `npm run test:live:effects`.

## 16. Roll area editor on a real screen

1. As the GM, open **Roll areas** (the button "Edit roll areas"). Pick the default area and drag the rectangle, then resize it by each edge and corner.
2. Try to shrink it to nothing and to drag it off the screen.
3. Pass: it never gets smaller than about 240 by 180 pixels and never leaves the window. **Reset** brings back the default area. Roll a die: it lands inside the rectangle.
4. Check that the editor sits above Foundry's own windows (a character sheet, the settings window) and can be reached, and that a window left open does not hide its buttons.

## 17. Sidebar collapse with an area set

1. Set a custom area that reaches the right edge. Collapse the sidebar, then expand it again.
2. Roll a die each time.
3. Pass: the dice land inside the area as it looks after each change, and nothing is left behind when the sidebar moves. No console error.

## 18. A theme from the browser shows on another player's screen

1. As player A, open **Theme browser** and use "Ruby Classic" (or any distinct theme) as your default.
2. As player B (another client), watch A roll a public d20.
3. Pass: A's die looks like the theme on B's screen, and the theme's celebration plays when B has **Show other players' effects** on.

## 19. Import and export a theme file

1. In **Theme browser**, duplicate a theme into **My themes**, change its name, then choose **Export my themes**. A file downloads.
2. Delete the theme, then **Import** the file.
3. Pass: the theme comes back with the same look. Importing a damaged file (edit it by hand) shows a warning and changes nothing.

## 20. A themed blind roll stays neutral for others

1. With a themed default (see check 18), roll `/blindroll 1d20` as player A.
2. On player B's screen, with **Show ghost dice** on, see a neutral ghost die. With it off, see nothing.
3. Pass: B never sees A's theme, celebration or sound. The GM sees the real themed die.

## 21. Configure Settings, Save keeps a custom default theme

1. Make a theme in **My themes** and use it as your default. Open **Configure Settings**, change any other Dicer setting and press **Save Changes**.
2. Pass: **Dice theme** still shows your custom theme afterwards and your dice still use it. The settings list shows it too (it is not replaced by a built-in).

## 22. Theme thumbnails render on real WebGL

1. Open **Theme browser** on a real GPU (not a remote desktop or software rendering).
2. Pass: all themes show a lit die picture within a few seconds, the pictures match what the dice look like when rolled, and the dice canvas does not flicker. Close the browser: `game.dice3d._debug.isLooping` stays false and no extra WebGL context remains in the browser's task manager or `chrome://gpu`.

## 23. Design a theme, use it as default, see it on another player's screen

1. Open **Theme browser**, press **New theme** and design a look in the appearance editor: a body type, colours, a number fill and some edge sharpness. Name it, press **Save as my theme**, then use it as your default.
2. As player B (another client), watch you roll a public d20 and a d6.
3. Pass: your dice look like the editor's preview on B's screen. The first roll with the new look shows no visible hitch.

## 24. A font from the computer and a font file

1. In the appearance editor, set **Font** to **On this computer**, type a font you have (for example Georgia) or pick a chip, and check that the preview die shows the new digits within a moment.
2. Set **Font** to **Font file**, pick a `.ttf`, `.otf`, `.woff` or `.woff2` file on the Foundry server, and check the preview again.
3. Type a family that does not exist, or a path to a file that is not a font. Pass: the die keeps the default digits and the console shows one warning, never an error loop. On another player's computer that lacks your font, your dice also show the default digits.

## 25. Edge steps on every die

1. Edit a theme and press each of the five **Sharpness** steps (sharp to very round).
2. Click each die type (d4, d6, d8, d10, d12, d20, d100) under the preview for at least the first and last step.
3. Pass: every die changes shape with the step, none shows holes, gaps or flickering faces, and a roll with the saved theme matches.

## 26. GM push, with and without "Replace everything"

1. Give player A a d6 theme of their own and a default theme of their own.
2. As the GM, select a built-in or world theme in **Theme browser** (a "Mine" theme is refused until published), press **Push to players...** and confirm without ticking **Replace everything**.
3. Pass: A's default is the pushed theme and their d6 choice is kept. A notice shows how many players were updated.
4. Push another theme and tick **Replace everything**. Pass: A's choices for a die type, a kind of roll, a character and a damage type are all cleared; only the default remains.
5. As a player, check that **Push to players...** is not shown.

## 27. Lock player looks

1. As the GM, set **World default theme**, then turn on **Lock player looks**.
2. As a player who chose another theme, roll a d20.
3. Pass: the dice use the world default, the theme browser says "Your GM has set everyone's dice" and its "use" actions are gone. The player can still design and save a theme. The GM's own dice are not affected. Turn the lock off and the player's choice returns.
4. Known limit: a player whose theme is already the built-in default (Sapphire Nebula) and who selects it again does not override the GM's world default, because Foundry fires no change for an unchanged setting. They pick another theme and then Sapphire again.

## 28. The actor-sheet "Dice look" button

1. With **Dice look button on actor sheets** on, open a character sheet you own.
2. Pass: a **Dice look** control shows in the sheet's header controls (the menu) on current sheets, or as a header button on older sheets, and opens the theme browser pointed at that character. Turn the setting off and the button is gone the next time the sheet renders.

The roll area rules (a player's area, the GM private corner) are also automated in `npm run test:live:areas`.

## 29. The in-game benchmark, as a player

1. As a player (not the GM), open Dicer's settings and press **Run the dice benchmark**, then **Run**.
2. Pass: the four scenarios (d20, mixed10, pool30, burst20) run on your screen only, the table fills in, and no chat message appears on any client. If the world **Maximum dice per message** is below 30, the summary notes the cap on pool30.

## 30. Copy summary

1. After a benchmark run, press **Copy summary** and paste into a text editor.
2. Pass: a notice says the summary was copied, and the pasted text is plain text with your browser, GPU and one block per scenario.

## 31. The benchmark refuses during a roll

1. Roll a big pool such as `/r 20d20` (anything that stays in the air for a few seconds), and press **Run the dice benchmark** (or run `game.dice3d.benchmark()`) while the dice are still in the air.
2. Pass: a notice says the dice are still rolling, and nothing runs. With Dicer's **Enable 3D dice** off, a notice says 3D dice are turned off.

## 32. The bench harness restores the world on Ctrl+C

1. Note the **Dicer** and **Dice So Nice** module enable states and Dicer's **Maximum dice per message**. Start `npm run test:live:bench` and wait until the first run has started.
2. Press Ctrl+C once.
3. Pass: the harness says it is restoring and exits; the module enable states and **Maximum dice per message** match step 1, none of the run's chat rolls are left in the chat log, a chat message you typed yourself during the run is still there, and `artifacts/bench/restore.json` is gone. If you instead kill the process, the next `npm run test:live:bench` restores the saved state before running: it deletes the saved roll messages, then every GM chat message written since the run started.

Rolling by hand (checks 33 to 44). These need a real Foundry v14 world, a GM and at least one player (two players for check 41), and a real mouse and a touch screen for the first two. `npm run test:live:hand` automates the replay, privacy and fallback checks (see the README, "Rolling by hand"); the rest are by eye. Turn the player's **Roll by hand** setting to **Always** unless a check says otherwise, and leave the GM's **Who may roll by hand** on **Everyone**.

## 33. Real mouse throws

1. As a player, roll `1d20` from the chat (or the dice tray). The dice appear held, floating in your roll area.
2. Grab them with the left button, shake back and forth, and flick. Try a gentle push, a hard flick, and releasing while the pointer is still.
3. Pass: the dice follow the pointer without lag, rattle while you shake, and fly the way you flicked (faster flick, faster throw). A release never makes the dice jump. They stop at the border of your roll area while you drag, and the result is the face that lands up. Press **Escape** before releasing: the roll takes Foundry's random result and the card says it rolled automatically.
4. Press **Space** (or **Throw for me**) instead of throwing: the dice leave your hand with a flick and land. Space does not pause the game or scroll anything.

## 34. Real touch throws

1. On a tablet or a touch laptop, roll `2d6` by hand.
2. Pass: a finger grabs and flicks the dice the same way, the page does not scroll or zoom while you hold them, a second finger does not corrupt the throw, and **Throw for me** is a big enough button to hit.

## 35. PF2e: attack, save and damage, with crit doubling

1. In a PF2e world, make a Strike. Roll the attack, the damage and (on a critical hit) the doubled damage.
2. Roll a saving throw from a sheet.
3. Pass: each roll opens the throw overlay, the dice you threw give the numbers on the card (the card total matches the dice), and a critical hit's doubled damage dice are thrown too. A roll with dice you did not throw (for example the extra dice of a persistent effect) resolves without hanging, and the card notes how many dice rolled automatically.

## 36. dnd5e: attack, save and damage, with crit doubling

1. In a dnd5e world, make an attack roll, a saving throw and a damage roll. Roll damage as a critical hit.
2. Pass: as in check 35. A roll with advantage or disadvantage (two d20s) is thrown as two dice, the card keeps the higher or lower, and the doubled critical damage dice are thrown.

## 37. Pf2e secret checks give the thrower no faces

1. As a player in a PF2e world, make a secret check (for example Recall Knowledge: any check whose roll mode is blind or GM-only).
2. Pass: the dice are thrown, but they show as ghost dice with no numbers while they fly and when they land, and the thrower learns no result. On release, nothing in the throw reveals a face (H-19). The GM sees the real throw and the real result, and a second player sees nothing or ghost dice.
3. Repeat with a blind roll (`/blindroll 1d20`) and a whisper to the GM (`/gmroll 1d20`). Pass: only the GM (and the whisper's recipients) replay the throw.

## 38. Exploding dice and other dynamic terms

1. Roll `4d6x` (or `1d6x`) by hand. Foundry adds a die whenever a 6 comes up.
2. Pass: the dice you throw give the first results; the extra dice are thrown automatically after they land (never held for you), the total includes them, and the roll never hangs or rejects. The card marks the roll as rolled by hand.
3. Roll a term the shape cannot be read for (a custom die with a different number of faces than its shape): Foundry rolls it and the card says some dice rolled automatically.

## 39. The dice tray in each mode

1. With **Dice tray** on, open the tray from the dice tools. Pick `2d6+3`, then throw.
2. Check each roll mode in the tray: public, GM only (whisper), blind, and self.
3. Pass: the tray posts a normal roll card whose dice are the ones you threw, the modifier is applied, and the card is marked as rolled by hand. A blind or self roll shows ghost dice only on your screen and nothing on the others'. **Clear** empties the tray, and an empty tray refuses to throw with a notice. With **Dice tray** off the button is gone.

## 40. Foundry's Dice Configuration

1. Open **Configure Settings, Dice Configuration** (Foundry's own window).
2. Pass: each die denomination lists the Dicer method ("Dicer: roll by hand") next to Foundry's own choices. Pick it for d20 and roll a `1d20`: the throw overlay opens even with Dicer's **Roll by hand** setting **Off**. Set it back to Foundry's method (or Random) and the roll is automatic again.
3. Note: using Dicer's method together with another module's interactive method (for example a Bluetooth dice module) is not supported (H-17); Foundry then picks its own generic dialog.

## 41. What other players see

1. As a player A, throw `1d20` and `4d6` by hand. Watch the GM's screen and a second player B's.
2. Pass: the GM and B see the same throw A made (same path, same bounces, same final faces, no extra delay beyond the throw itself), and the card on every screen matches the dice. With **Replay hand throws** off on B's client, B sees a normal throw of the same result.
3. Whisper the roll to the GM (`/gmroll 1d20` by hand): Pass: only the GM replays it. B sees nothing, and `npm run test:live:hand` shows B's client never received the payload.
4. Turn the GM's **Who may roll by hand** to **GMs only**: Pass: A's rolls are automatic. Turn it to **Nobody**: nobody gets the overlay. Turn **Require rolling by hand** on with A's own setting **Off**: A is made to throw.

## 42. A smaller GM window

1. Shrink the GM's browser window (or give the GM a small **Roll area size**), then have the player (full-size window) throw 10d6.
2. Pass: the replay on the GM's screen is the same throw scaled down to fit (H-11); it never goes below about 60% of the player's size, and when it overruns a very small window it stays on the stage. Dice keep their size, and the final faces match the card.

## 43. Fallbacks and the card mark

1. Let the throw time out: roll by hand and do nothing for the time limit (set **Hand roll time limit** to 10 seconds to speed it up).
2. Pass: Foundry rolls the dice, the roll completes, and the card has a hand mark that says it rolled automatically. A normal hand roll's mark says rolled by hand, and a roll with some automatic dice says how many.
3. Confirm a die type that failed the fairness run is never thrown by hand (none do today: see `docs/research/fairness.md`).

## 44. Pets in hand throws

1. Give two players a pet each, and roll once as player A so the pet rests in A's area.
2. As A, throw `3d6` by hand straight at the resting pet, hard.
3. Pass: while you hold the dice your pet keeps still. On a hard hit the pet splats on A's screen, and also on the GM's and B's screens, at the same place relative to the dice (**Dice can splat pets** on, **Show dice pets** on). A screen with **Dice can splat pets** off still sees the pet bump but not burst. The pet's owner's next roll reforms it as before.
4. Check ghost and blind rolls: a ghost or blind hand throw never moves a pet or splats one on a screen that cannot see the roll.
