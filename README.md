# Dicer

Lightweight 3D dice for Foundry VTT v14 (three.js rendering, Rapier physics in a worker).

## What Plan 1 delivers

- 3D dice for chat rolls: d2, d4, d6, d8, d10, d12, d20 and d100 (tens d10 plus ones d10).
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

## Chat commands

With the chat-commands module installed, `/dice3d`, `/d3d` and `/dsn` open the Foundry settings on the Dicer tab. Dicer's own settings dialog comes in a later plan, so for now this is the generic settings window. Without the chat-commands module the commands are not registered.

## Dice So Nice compatibility

Dicer replaces Dice So Nice (DSN). It gives other packages a `game.dice3d` with the DSN API and fires the same hooks. Do not run both: if DSN is active, Dicer stays dormant.

### Compatibility table

Status is Works, Works with gaps or Not supported. One row per package surveyed in `docs/research/dsn-integration-survey.md` (section 3).

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
| pf2e-toolbelt                                                                                                | Works           | Hooks and `animateRoll`.                                                                                |
| pf2e-visioner                                                                                                | Works with gaps | Reads `dice3d.box`, which is empty. Dice work. The feature that reads `box` does not.                   |
| pf2e-auto-action-tracker                                                                                     | Works           | `waitFor3DAnimationByMessageID`.                                                                        |
| aoe-easy-resolve, draw-steel-combat-tools, pf2e-aztecs-template-wizard, pf2e-combater, pf2e-flatcheck-helper | Works           | `showForRoll` only.                                                                                     |
| automated-conditions-5e                                                                                      | Works           | `diceSoNiceRollStart` hook.                                                                             |
| draw-steel-target-damage, storyframe                                                                         | Works           | `diceSoNiceRollComplete` hook.                                                                          |
| pf2e-ap200, pf2e-ap222, pf2e-ap223, sf2e-murder-in-metal-city, phils-pf2e-realdark                           | Works with gaps | Dice content. Presets, colorsets and textures register. GLB models show for d2 and d6 only.             |
| trs-black-marble-dice-set, trs-gold-red-armored-dice-set, trs-norse-dd-boneyard                              | Works with gaps | Dice sets. Faces and colours work. GLB models show for d2 and d6 only.                                  |

"Works" means the surveyed calls and hooks are supported. Some behaviour needs a real world to confirm. See `docs/live-checks.md`.

### Known gaps

- Path imports of `/modules/dice-so-nice/api.js` and of DSN's bundled three.js do not work. Dicer does not ship those files.
- `game.modules.get('dice-so-nice')` checks fail by design, because Dicer has no stub package with that id. Version gates, such as CoC7's, fail too.
- DSN-scoped user flags and settings that other packages read directly return nothing. Dicer keeps its own under the `dicer` scope.
- `box`, `pipeline`, `persistent` and `pendingThrows` internals are not supported. Pending and interactive throws come in Plan 6.
- GLB model presets: only the d2 and d6 orientations are verified. Other die types show Dicer's own die with the preset's faces and colours. The reasons are in `docs/research/dsn-model-orientation.md`.
- Ghost payloads for synced rolls send dice shapes only. Custom die classes, such as coins and Fate dice, arrive as plain dice with the same face count. Dice whose count comes from another roll show as zero ghost dice.
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
2. a GM whisper roll sends the player no message element and no dice (ghost dice off), while the GM sees dice;
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

It prints `compat: N/N passed`, writes `artifacts/live/compat.json` and exits 0 on success. It changes `showGhostDice` while it runs and restores it at the end. It creates and deletes one temporary combat. Missing variables or an unreachable Foundry exit 1 with a one-line message.

Unit tests cannot check some things. The manual list is in `docs/live-checks.md`.

## Development

`npm test`, `npm run lint`, `npm run format:check`.
