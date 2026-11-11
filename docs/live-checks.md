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
