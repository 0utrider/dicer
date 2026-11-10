# Dice So Nice integration survey and licence check

Date: 2026-11-10. Target: DSN 6.4.5 (installed locally). Consumer: Dicer Plan 3 (compatibility layer).
This is research only. No DSN code is copied here.

## 1. Licence finding

- Local install (`Data/modules/dice-so-nice/`): contains `api.js`, `main.js` (+ maps), `module.json`, assets. There is **no LICENSE file** and `module.json` has **no `license` field** (checked).
- Upstream `gitlab.com/riccisi/foundryvtt-dice-so-nice`: the repo page lists `LICENSE.md` as "GNU AGPLv3". The raw `LICENSE.md` was fetched and begins "GNU AFFERO GENERAL PUBLIC LICENSE, Version 3, 19 November 2007". Licence = **AGPL-3.0**. (A `LICENSE` path without `.md` returns 404.)
- Meaning for Dicer: AGPL-3.0 permits reading and studying the source. Copying or adapting DSN code would make Dicer a derivative work that must itself be AGPL-3.0 and offer source, including to network users. The project rule is stricter: **read for API behaviour only, no copying**. Dicer's compat layer is implemented from observed behaviour and the public contract. The local install ships minified `main.js`; any reading of it is for behaviour only.
- Not verified: whether the shipped (non-GitLab) artifact carries a different notice; whether DSN assets (textures, models, sounds) have separate licences. Not legal advice.

## 2. Method and coverage

- Shallow-cloned (read-only grep) and searched for `dice3d`, `diceSoNice`, `dice-so-nice`: dnd5e `6400cb1`, pf2e `2e65a924`, wfrp4e `c8f9fec`, coc7 `acd361f`, cyberpunk-red-core `854736f` (GitLab `cyberpunk-red-team/fvtt-cyberpunk-red-core`), sw5e `beab238` (`sw5e-foundry/sw5e`), swade `ac74ffb` (GitLab `peginc/swade`).
- `gh search code` hit the code-search rate limit (10/min) after the first calls, so cloning was used instead.
- Other packages were found by grepping locally installed modules in `Data/modules`. Those are installed (often built or minified) copies, not necessarily upstream source; line references there are to local files.
- **Not verified / not done:**
  - "5 most-installed dice-set modules on foundryvtt.com": no install-count ranking was reachable (WebSearch returned none). Substituted the dice sets installed locally (TRS x3, daggerheart-duality-dice). Treat as an unverified sample, not a top 5.
  - pf2e-toolbelt: only the local minified build was checked; members are inferred from it. Upstream source not read.
  - sw5e: clone searched, zero hits.
  - Upstream references are repo paths at the commits above, not tested permalinks.
  - DSN's own wiki (API pages) was not read.

## 3. Survey table

`api.js import` means a static or dynamic import of `/modules/dice-so-nice/api.js`. "none" means grep found nothing.

### Game systems

| package | hooks | dice3d members | api.js import | internals |
|---|---|---|---|---|
| dnd5e | none | none | none | none (no DSN code at all) |
| sw5e | none | none | none | none |
| pf2e (`src/scripts/hooks/dice-so-nice-ready.ts`, `dice-so-nice-roll-start.ts`, `module/chat-message/crit-fumble-cards.ts`) | diceSoNiceReady, diceSoNiceRollStart, diceSoNiceRollComplete | addSystem, addDicePreset, addTexture, addColorset, addDamageTypeDefaults (optional; DSN >= 6.2.5, feature-detected) | none | none on dice3d. Duck-types the ready argument (`addSystem/addDicePreset/addTexture/addColorset in obj`). Sets non-public Roll props: `result.hidden = true` (persistent damage) and `roll.ghost = true` from the RollStart context. Reads `game.modules.get("dice-so-nice").active`. |
| swade (`src/module/dice/WildDie.ts`, `apps/DiceSettings.ts`, `swade.ts`) | diceSoNiceInit, diceSoNiceReady, diceSoNiceRollStart | addSystem, addDicePreset, addColorset, showForRoll, waitFor3DAnimationByMessageID, DiceFactory | none | `DiceFactory.systems.get(id).dice.get("dN")` then `.modelFile`, `.modelLoaded`, `.loadModel(DiceFactory.loaderGLTF)`, `.loadTextures()`; `dice3d.exports.Utils.prepareTextureList/prepareFontList/prepareSystemList/prepareColorsetList`. Sets term `options.appearance.system` and `options.colorset`. |
| wfrp4e (`src/system/tables-wfrp4e.js`, `apps/market-wfrp4e.js`, `system/opposed-handler.js`) | none | showForRoll, waitFor3DAnimationByMessageID | none | none on dice3d. Writes message flag `flags["dice-so-nice"].linkedTo` to link chat messages. |
| CoC7 (`coc7/hooks/*`, `apps/utilities.js`, `apps/dice-pool.js`) | diceSoNiceReady (two handlers, one "last"), diceSoNiceRollComplete | addDicePreset, DiceFactory | none | `dice3d.DiceFactory.systems.forEach(...)` clones the d100 preset object into `dt`/`do` via `Object.create(getPrototypeOf(d100))` and `systemData.dice.set`. Reads user flag `dice-so-nice.settings.enabled` and setting `dice-so-nice.immediatelyDisplayChatMessages`. Version-gates on `game.modules.get('dice-so-nice').version` (5.0.5, 5.3.0). |
| cyberpunk-red-core (`src/modules/hooks/external/dice-so-nice-preset.js`) | diceSoNiceReady | addSystem, addColorset, addDicePreset | none | none |

### Other packages (installed locally; sampled, not exhaustive)

| package | hooks | dice3d members | api.js import | internals |
|---|---|---|---|---|
| daggerheart-duality-dice (`dist/index.js` ~L288, L752, L1271-1274, L1333) | diceSoNiceInit, diceSoNiceReady | addSystem, addDicePreset, addColorset, addTexture, addDiceShape, addSFXMode, addSFXDefaults | **dynamic**, via `foundry.utils.getRoute("modules/dice-so-nice/api.js")`; also imports `modules/dice-so-nice/libs/three.module.min.js` | `uniforms.*` writes (custom shader glow), `DiceFactory.systems.has`, three.js `registerBeforeShaderCompileCallback` on materials, shader string replacement |
| natural-roll (`src/DSNPatcher.js`, `engines/DsnEngine.js`, `DSNUtils.js`, ...) | diceSoNiceReady | almost none public | none | **Heavy**: `dice3d.box` (31 refs, `box.animateThrow`), `canvas`, `pipeline`, `constructor` (patching), `_currentLocalRoll`, `_activeReplayResolves/_activeReplayPromises`, `_isLocalRollInitiation`, plus its own private props on dice3d |
| pf2e-dsn-persistent-bridge (`scripts/dsn-adapter.js`, `main.js`, `pf2e-colorsets.js`) | diceSoNiceReady, diceSoNiceMessagePreProcess | addColorset, addRole | none; dynamic import of `libs/three.module.min.js` | **Heavy**: `persistent` (`spawn`, `remove`, `_emitPersistentEvent`, `_persistentRoleContext`), `pendingThrows` (`claimThrow`, `shouldStampInteractive`), `DiceFactory`, `exports.Utils` (`contrastOf`, `sanitizeAppearance`, `sanitizeRoleScopes`), `exports.COLORSETS`, `diceLibrary.constructor.getLibraryForUser`, `box.diceScene.raycaster`, `canvas`; wraps/patches several of these |
| pf2e-dice-flavor-fix | diceSoNiceReady, diceSoNiceRollStart | addColorset (x34) | none | reads `exports.COLORSETS` |
| ember | diceSoNiceReady | none | none | reads `uniforms.moonPhase` |
| midi-qol | none | showForRoll, isEnabled, `config` (outside the documented surface) | none | reads `dice3d.config` |
| pf2e-toolbelt (minified local build) | diceSoNiceRollComplete, diceSoNiceMessageProcessed | animateRoll | none seen | none seen |
| pf2e-visioner | none seen | none seen | none | `dice3d?.box` (14 refs across 7 files) |
| pf2e-auto-action-tracker | none | waitFor3DAnimationByMessageID | none | none |
| aoe-easy-resolve, draw-steel-combat-tools, pf2e-aztecs-template-wizard, pf2e-combater, pf2e-flatcheck-helper | none | showForRoll | none | none |
| automated-conditions-5e | diceSoNiceRollStart | none | none | none |
| draw-steel-target-damage, storyframe | diceSoNiceRollComplete | none | none | none |
| pf2e-ap200 / ap222 / ap223, sf2e-murder-in-metal-city, phils-pf2e-realdark (content modules shipping dice) | diceSoNiceReady (ap222, ap223, sf2e also diceSoNiceInit) | addSystem, addDicePreset, addColorset, addTexture (ap200 only addSystem and addDicePreset) | none | none |
| trs-black-marble-dice-set, trs-gold-red-armored-dice-set, trs-norse-dd-boneyard (stand-ins for "top 5 dice sets", see section 2) | diceSoNiceReady | addSystem, addDicePreset (x8 each) | none | none |

## 4. Must-support list for Plan 3

Ranked by the number of surveyed packages (both tables above) that use the member. Counts come from a small sample that leans toward PF2e and locally installed modules, so treat rank as a floor, not market share.

### game.dice3d members

| rank | member | packages | notes |
|---|---|---|---|
| 1 | addDicePreset | 13 | every dice-set module and every system that ships dice |
| 2 | addSystem | 12 | |
| 3 | addColorset | 10 | pf2e-dice-flavor-fix calls it 34 times; pf2e's bridge-style caller feature-detects it |
| 4 | showForRoll | 8 | argument shapes seen: `(roll)`, `(roll, user, true)`, `(roll, user, true, whisper, blind, undefined, speaker)` |
| 5 | addTexture | 6 | typed as returning a Promise by pf2e |
| 6 | DiceFactory (field) | 4 | `.systems` Map, `.systems.get(id).dice.get("dN")`, preset `.modelFile/.modelLoaded/.loadModel/.loadTextures`, `.loaderGLTF` |
| 7 | waitFor3DAnimationByMessageID | 3 | wfrp4e, swade, pf2e-auto-action-tracker |
| 7 | exports (`Utils.*`, `COLORSETS`) | 3 | NOT in the known public surface. Seen in swade, pf2e-dice-flavor-fix, the persistent bridge |
| 7 | box (field) | 3 | natural-roll, persistent bridge, visioner. Internal |
| 10 | uniforms | 2 | ember, daggerheart-duality-dice |
| 10 | canvas | 2 | NOT in the known surface (internal) |
| 12 | addDamageTypeDefaults, addRole, addDiceShape, addSFXMode, addSFXDefaults, animateRoll, isEnabled | 1 each | addDamageTypeDefaults must stay optional/feature-detectable |
| 12 | config, persistent, pendingThrows, diceLibrary, pipeline, constructor, `_currentLocalRoll`, `_activeReplay*`, `_isLocalRollInitiation` | 1 each | all internal and undocumented; only natural-roll, the persistent bridge and midi-qol |

Not seen in any surveyed package: addSFXTrigger, getSFXModes, getRole/getRoles, preloadPresets, loadSaveFile, getLoadedDiceSystems, setMessageUpdateHideSelector, messageHookDisabled, show, showExtraDiceByDefault, getScreenPosition, enableDebugMode. This is absence of evidence from a small sample, not a reason to drop them.

### Hooks

| rank | hook | packages |
|---|---|---|
| 1 | diceSoNiceReady (argument: the dice3d object) | about 18 (essentially all dice-adding code) |
| 2 | diceSoNiceRollComplete | 5 (pf2e, coc7, draw-steel-target-damage, storyframe, pf2e-toolbelt) |
| 2 | diceSoNiceInit | 5 (swade, daggerheart-duality-dice, ap222, ap223, sf2e-murder-in-metal-city) |
| 4 | diceSoNiceRollStart (arguments `(messageId, context)`; pf2e mutates `context.roll`) | 4 (pf2e, swade, automated-conditions-5e, pf2e-dice-flavor-fix) |
| 5 | diceSoNiceMessagePreProcess | 1 (persistent bridge) |
| 5 | diceSoNiceMessageProcessed | 1 (pf2e-toolbelt) |

Not seen: diceSoNicePendingThrow*, diceSoNiceOnMaterialReady, diceSoNiceModelLoaded.

### Non-method contract points

- Roll-side properties that third parties set and DSN reads: `result.hidden = true` on dice results (pf2e persistent damage; pf2e's source cites a DSN wiki page on hiding dice from a roll animation); `ghost` on the roll in the RollStart context; term `options.appearance.system`, `options.colorset`, `options.appearance.*`.
- Chat message flag `flags["dice-so-nice"].linkedTo` (wfrp4e) to sync messages.
- User flag `dice-so-nice.settings` (`.enabled`) and setting `dice-so-nice.immediatelyDisplayChatMessages`, both read by CoC7. Dicer should expose the same ids if it claims drop-in status.
- Module id checks: `game.modules.get("dice-so-nice")?.active` and `.version` (CoC7 compares against 5.0.5 and 5.3.0), so Dicer's reported version must pass those gates.
- Duck-typing: pf2e requires `addSystem`, `addDicePreset`, `addTexture`, `addColorset` to exist on the object passed to `diceSoNiceReady`.
- `/modules/dice-so-nice/api.js` exports `DiceSystem`, `DiceSFX` (given). One surveyed consumer (daggerheart-duality-dice) imports it dynamically via `getRoute`, and also imports DSN's bundled three.js build. Matching the three.js module path and version is a risk for any consumer that mixes its own material code with DSN's.

## 5. Findings and recommendations for Plan 3

1. Tier 1 (must be exact): `diceSoNiceReady` with the public add* methods (`addSystem`, `addDicePreset`, `addColorset`, `addTexture`), `showForRoll`, `waitFor3DAnimationByMessageID`, and the `RollComplete`, `RollStart`, `Init` hooks.
2. Tier 2 (needed by known consumers): the `DiceFactory.systems` model shape, `exports.Utils`/`COLORSETS`, `uniforms`, `api.js` (DiceSystem, DiceSFX) and the three.js module path, `addDiceShape/addSFXMode/addSFXDefaults`, `addDamageTypeDefaults`, `addRole`, `animateRoll`, `isEnabled`, the flags and settings above.
3. Tier 3 (best effort or declare unsupported): `box`, `canvas`, `pipeline`, `persistent`, `pendingThrows`, `diceLibrary` and underscored fields. They appear in only a few modules (natural-roll, pf2e-dsn-persistent-bridge, visioner, midi-qol), and those patch DSN internals, so they break across DSN versions anyway.
4. dnd5e and sw5e do not integrate with DSN beyond default rolling, so drop-in compatibility there is just rendering ordinary Foundry `Roll`s.
