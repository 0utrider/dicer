# Dicer — Design

*Module id `dicer`.* Date: 2026-11-10.

## 1. Intent

Build a Foundry VTT 3D dice module that **replaces Dice So Nice (DSN) as a drop-in** and beats it, from the first release, on two things:

1. **Performance:** no lag on laptops or integrated GPUs, and no cost at all when no dice are on screen.
2. **Looks:** dice that look like product photos of real boutique dice, not "game dice".

Customization comes right after those two. It's built from the same material system that makes the dice look good.

**Why:** DSN is the de facto standard, but it's heavy. Users routinely switch off its effects by hand, and a third-party module exists just to set lower-quality profiles for it. Its dice also look like CG plastic next to real dice. The owner wants a module that is faster *and* prettier, without asking anyone to give up the systems and modules that already integrate with DSN.

**Reference research** (DSN 6.4.5 source analysis plus a survey of user complaints, done 2026-11-10). Key facts this design relies on:
- DSN uses three.js r184 with cannon-es physics in a Web Worker. The whole throw is pre-simulated, then played back. The result is forced by rotating the inner mesh so Foundry's actual result faces up.
- It draws on a second full-screen WebGL canvas over Foundry's canvas, with `logarithmicDepthBuffer: true` (which defeats early-Z) and an uncapped pixel ratio.
- **Heavy rendering:** default "realistic" mode has full-screen post-processing (bloom drawn twice, SMAA, MSAA, a gamma pass and an OutlinePass per remote user), plus a 4096² PCF shadow map with a frustum twice the play area.
- **Per-appearance textures:** face labels are drawn into canvases up to 2048² for every new appearance, then turned into normal maps on the CPU via `getImageData` blur and Sobel. This causes a first-roll hitch.
- **Physics cost:** O(n²) naive broadphase, up to 1000 steps simulated before the first frame, and fresh Float32Arrays per die per throw.
- **Rendering when idle:** the renderer runs every PIXI tick while interactivity or persistent dice are active.
- **Resize:** resizing the window rebuilds the whole renderer, and the old worker is probably leaked.
- **Biggest user complaints:** a different animation on every screen (open since 2020); slowness; unreliable hooks and secret-roll leaks (PF2e Toolbelt dropped DSN support over this); chat revealing the result before the dice land; no dice tray or table surface; no per-player roll areas; no GM-pushed settings.

## 2. Goals (v1)

### G1. Drop-in DSN compatibility
Any system or module that works with DSN 6.x should work with Dicer without changes, as far as is technically possible (see risks in §8).

- **`game.dice3d`:** expose it with the same public surface.
  - Registration: `addSystem`, `addDicePreset`, `addDiceShape`, `addColorset`, `addTexture`, `addDamageTypeDefaults`, `addRole`, `getRole`, `getRoles`.
  - SFX: `addSFXTrigger`, `addSFXDefaults`, `addSFXMode`, `getSFXModes`.
  - Loading: `preloadPresets`, `loadSaveFile`, `getLoadedDiceSystems`.
  - Message handling: `setMessageUpdateHideSelector`, `messageHookDisabled` (get/set).
  - Showing dice: `showForRoll(roll, user, synchronize, users, blind, messageID, speaker, {ghost, secret})`, `animateRoll`, `show`.
  - Utilities: `showExtraDiceByDefault`, `waitFor3DAnimationByMessageID`, `getScreenPosition`, `isEnabled`, `enableDebugMode`.
  - Fields: `DiceFactory`, `box` and `uniforms` exist as compatibility objects, with only the members known integrations touch.
- **Hooks:** fire the same hooks with the same arguments and timing.
  - Lifecycle: `diceSoNiceInit`, `diceSoNiceReady`.
  - Rolls: `diceSoNiceRollStart(messageId, context)` (honour `context.blind` and `context.dsnRoll` replacement), `diceSoNiceRollComplete(messageId, companionIds)`.
  - Messages: `diceSoNiceMessagePreProcess`, `diceSoNiceMessageProcessed(messageId, {willTrigger3DRoll})`.
  - Materials and models: `diceSoNiceOnMaterialReady`, `diceSoNiceModelLoaded`.
  - Pending throws: `diceSoNicePendingThrowOpened`, `diceSoNicePendingThrowClosed` and `diceSoNicePendingSlotsBound` are optional (see non-goals).
- **Chat message behaviour:** same as DSN.
  - Intercept `createChatMessage`, hide the rendered message with the `dsn-hide` CSS class, and reveal it when the dice land.
  - Handle rolls appended through `updateChatMessage`.
  - Hide initiative until the dice land.
  - **Reliability requirement:** `diceSoNiceRollComplete` *always* fires exactly once per animated message. That includes when dice are cleared mid-roll, the tab is hidden, WebGL is lost, or rendering throws. A watchdog timeout guarantees the reveal.
- **Per-roll controls:** honour DSN's.
  - On rolls: `roll.ghost`, `roll.secret`, `roll.options.rollOrder`.
  - On terms: `options.rollOrder`, `options.colorset`, `options.appearance`, a flavor matching a colorset name, `flavor "die:Name"`, `dsnActorId`.
  - On results: `result.hidden`.
  - On messages: `flags.dice-so-nice.skip|persistent|linkedTo|interactiveThrow|pendingCard`.
- **Privacy:** secret, blind, self and whisper rolls never animate a revealing result to users who can't see the message. Ghost rolls use a neutral die. *Privacy has priority over looks and compatibility:* when a DSN behaviour is ambiguous, choose the one that leaks nothing.
- **`api.js`:** our module ships an `api.js` exporting compatible `DiceSystem` and `DiceSFX` base classes with the same interface. This covers settings types, the `on(DICE_EVENT_TYPE.*)` events, `registerProcessMaterialCallback`, `registerBeforeShaderCompileCallback` and `getCacheString`.
- **Chat commands:** `/dice3d`, `/d3d` and `/dsn` work when chat-commands is installed.
- **Mutual exclusion:** if DSN is also active, Dicer stays dormant and shows the GM a one-time notice.
- **Migration:** on first run, read each user's DSN appearance flags and DSN's world settings, and map them to Dicer equivalents, so a table switching over keeps everyone's dice colours.

### G2. Performance
These are hard targets, measured by the benchmark harness in §7.

| Situation | Target |
|---|---|
| No dice on screen | **Zero** GPU work: no render, no rAF/ticker callback, canvas hidden. |
| Typical roll (≤10 dice), integrated GPU (Intel Iris Xe class), 1080p, default quality, Foundry scene loaded | Steady 60 fps for the whole animation. No main-thread task longer than 50 ms. |
| Big pool (30 dice) | Dice visible within 100 ms of the message arriving. No main-thread task longer than 50 ms. |
| Time from chat message to first dice frame (≤10 dice) | ≤ 50 ms on the reference machine. |
| First roll with a new appearance | No visible hitch: no per-appearance canvas or texture generation on the main thread. |
| 500 consecutive rolls | Stable memory: no growth in JS heap or GPU textures, geometries or programs. |
| Window resize | No renderer rebuild; just resize the drawing buffer. |
| WebGL context loss (iPad backgrounding, GPU reset) | Recover automatically on restore. The chat reveal still happens. |
| Download size | Loaded at world start ≤ 4 MB at default quality. Theme-specific assets (sounds, interior textures, custom fonts) and high-quality environment maps are loaded on demand, only when a theme that uses them is in play. |
| Head-to-head | On the same machine, at the closest matching visual settings, Dicer is never slower than DSN 6.4.5 on any harness scenario. |

**What "matching" means (designer's call):**
- The head-to-head compares **each product's default settings at its own auto-picked tier**, with the same dice and the same scene. This is what a table actually experiences.
- A second comparison pits DSN with every effect off against Dicer at Low.
- Dicer must win both comparisons. Its extra features (interiors, engraving) count against its own budget; they are not excused.

**Interiors at default (designer's call):** the signature look ships on.
- A clear die with an interior must hold 60 fps on the Iris Xe reference at the tier auto-picked for that GPU, with a reduced step budget.
- Only Low falls back to the cheap fake interior.
- If the harness proves this can't be done, the Medium tier swaps to the fake interior. The default appearance stays a clear die with an interior.

**Browsers (designer's call):**
- **First-class:** Chromium-based browsers, meaning the Foundry Electron desktop client, Chrome and Edge. All G2 targets apply here, and the harness runs on these.
- **Supported:** Firefox and Safari/iPadOS. They must work correctly, recover from context loss and keep privacy intact. Performance targets are best-effort, and they may auto-pick a lower tier.
- Don't depend on features missing in Safari: WASM threads are not required, and OffscreenCanvas is used only with a main-thread fallback.
- Cross-browser determinism is checked on all engines but is not required until v2.

**Reference machine (owner's answer: they have only a gaming PC):**
- **Real numbers:** the harness runs on the owner's gaming PC.
- **Simulated low end:** the low-end targets are checked there too, using a throttled profile: Chromium CPU throttling at 4×, the GPU limited by forcing the Low/Medium tier, a 1080p window, and pixel ratio 1. Low-end results from this profile are **estimates**, and the README says so.
- **Real low-end check:** before a public 1.0, ask testers on Iris Xe-class laptops and an iPad to run the bundled benchmark macro and report results. The benchmark must be runnable by any user from a macro or settings button and give a shareable summary.
- **Absolute speed:** on the gaming PC, Dicer must use clearly less frame time than DSN at defaults (p95). The "never slower than DSN" rule applies to both profiles.

### G3. Looks: "boutique dice product photo"
The bar: next to a photo of real premium dice, the rendered dice should read as the same kind of object.

**Reference set:** a Google Images grid for "d20 dice" that the owner shared on 2026-11-10. It has engraved and inked opaque dice, liquid-core and nebula resin, sharp-edge clear resin, gold, copper and brass metal dice with enamel, and marbled dice. The builder should collect 8–12 similar product photos into `docs/reference/` (links only, with no copyrighted images committed) as the anchor for visual review.

**Sign-off:** the owner reviews the look spike and gives the final say. The owner has said they trust the designer's judgement, so the spike should show the strongest version, not a menu of options.

These traits are required:

- **Engraved numbers:** numbers and pips are cut into the face and filled with paint, gold, silver or enamel. The recess catches light and gets a tiny shadow, and the infill has its own material (metallic gold, matte paint).
- **Real edges:** slightly rounded (chamfered) edges by default, plus an optional "sharp-edge" style with crisp edges. Either way, the edges catch a thin highlight.
- **Depth inside clear dice:** see-through resin with something *inside* — liquid core, glitter or mica flakes, swirl or marble, nebula or cloud, a suspended object or shape. This is the signature feature DSN can't do today.
- **Metal dice:** polished, brushed and antique finishes, with raised face borders and enamel-filled numbers.
- **Opaque and marbled resin**, with subsurface-like softness.
- **Studio lighting:** a soft, bright environment with crisp specular highlights and saturated colour. It should work over any Foundry scene background.
- **A grounded table look:** soft contact shadows under each die, so dice sit on the scene and don't float.

### G4. Customization
- An appearance is a stack of layers: **body** (opaque, clear resin, metal, marble, pearl), **interior** (only for clear bodies), **number fill**, **edge style**, **font**, and optional **emissive glow**.
- Settings can be per user, per die type, per role (damage type and so on, as DSN does), and per actor.
- **GM controls:** the GM can push default appearances to players, and can lock quality caps and dice limits for the world.
- **Sharing:** export and import presets as files. Players can share dice sets without the GM installing anything.
- **DSN content:** colorsets, systems and presets registered by other modules through the DSN API all render in Dicer. That includes image-per-face presets and GLB model presets. They map onto the layer system as the "body" or "number" layer.

### G5. Themes
*Added at the owner's request on 2026-11-10. Themes, roll area, special effects, damage presets and sounds (G5–G9) are all v1.*

- **What a theme is:** a named bundle of an appearance (per die type if wanted), a sound set, and a special-effects set. Picking a theme changes how the dice look, sound and celebrate in one click. Every part can still be overridden individually.
- **Built-in library:** v1 ships a curated set of at least 20 themes that show off G3. That means opaque engraved dice, liquid-core and nebula resin, sharp-edge clear resin, gold, copper and brass metal with enamel, marble, pearl and gem dice, plus a few dramatic ones such as an ember core, a frost crystal and a void.
- **Theme browser:** a gallery with live 3D thumbnails of each theme. Thumbnails render on demand, one at a time, and are cached as images, so the gallery itself stays light.
- **Custom themes:** users build their own in the appearance editor, save them, and export or import them as files (same as G4 sharing). The GM can publish world themes that every player can pick.
- **Assignment:** a theme can be the user's default, or be tied to an actor, a die type, a roll role (attack, damage, save, initiative and so on, where the system exposes it), or a damage type (G8).

### G6. Roll area
- **Visual editor:** an on-screen editor where you drag and resize the area dice land in. It has a clear reset, it can't shrink to nothing or get lost off-screen (DSN #548), and it survives window resizes by being stored as fractions of the window.
- **Per-player areas:** the GM can give each player their own roll area, so each player's dice land in a predictable place on every screen, for example the left third for player A. Each client can still override how big the whole area appears on their own screen.
- **Presets:** full canvas minus sidebar (the default), centre of screen, bottom strip, and a corner tray.
- **API:** other modules can read and set roll areas (DSN #287).
- **Off-screen private rolls:** an option to animate the GM's private rolls in a GM-only corner region, so the GM's own screen doesn't block the scene (DSN #272).

### G7. Special effects on results
- **Triggers are user-defined rules** that match any combination of:
  - **die type** (d20, d6 and so on, or any);
  - **result:** a specific value, a range, the die's max or min, or "any";
  - **context:** roll formula pattern, roll role, damage type, actor, or the user who rolled;
  - **outcome:** critical success or failure where the system reports it, such as PF2e degrees of success or dnd5e crits.
- **Built-in defaults:** a natural 20 on a d20 gets a celebration and a natural 1 gets a fumble effect. Both can be edited or turned off. The rule system covers any number, not just 1 and 20; for example, "6 on any d6 → sparks" or "max damage die → glow".
- **Effect library (v1):**
  - **Glow and light:** glow pulse, light burst, flame or ember, frost crack, lightning arc.
  - **Particles and motion:** sparkles and glitter, shatter, smoke puff, shockwave ring on the table, slow-motion landing, camera-free screen shake (subtle, can be turned off).
  - **Die effects:** colour shift of the die, number flare.
- **Effect settings:** every effect has adjustable colour, intensity and duration.
- **Performance:** effects are GPU particles and shader effects. Each one has a frame-cost budget and is scaled down per quality tier, so it obeys G2.
- **Sound and macros:** any trigger can also play a sound and/or run a macro.
- **Scope:** trigger sets can be per user, or set by the GM for the world. Players can choose whether they see other players' effects (as DSN's `showOthersSFX`).
- **Privacy:** effects and their sounds never fire for users who can't see the result. A nat-20 celebration must not leak a hidden roll.
- **DSN compatibility:** DSN `addSFXTrigger`, `addSFXMode` and `DiceSFX` subclasses still work and appear in the same rule editor.

### G8. Damage type presets
- **Built-in damage themes:** for PF2e and dnd5e, v1 ships a theme per damage type, applied automatically to damage dice. That covers fire, cold, acid, electricity or lightning, sonic or thunder, poison, force, vitality or radiant, void or necrotic, mental or psychic, bleed, spirit, and physical (bludgeoning, piercing, slashing).
  - Each theme has its own appearance, impact sound and an optional effect on landing, for example embers for fire.
- **Mapping:** the system's damage type maps to a preset. The GM can edit the map (compatible with DSN's `damageTypeMap` and `addDamageTypeDefaults`) and users can override per type.
- **Other systems:** other systems can register their damage types through the same API.

### G9. Sounds
- **Material-aware impacts:** metal dice clink, resin clacks, wood thuds. The sound depends on the die's body material and the impact speed. There are several variations per material, so repeats don't sound identical.
- **Surface sound:** the table surface (felt, wood, stone, metal tray) changes the impact sound. It's chosen per world, with a per-user override.
- **Result sounds:** optional per trigger (G7) and per damage theme (G8).
- **Mixing:** a master volume and a separate effects volume. Sounds are muted for hidden results (privacy), and quiet when the Foundry window is not focused (optional).
- **Custom sounds:** users and GMs can add their own sound files to themes and triggers.
- **Performance:** WebAudio with pre-decoded audio sprites. Collision events come from the physics worker, with a cap on simultaneous voices so big pools don't turn into noise.

### G10. Rolling by hand (physics decides the result)
*Added at the owner's request on 2026-11-10. The owner decided the number that physically lands face-up **is** the roll result. It is not forced to a number Foundry picked.*

- **How it plugs into Foundry:** Dicer registers as a Foundry **dice fulfillment method**, through `CONFIG.Dice.fulfillment` and the roll resolver, alongside Foundry's own manual entry.
  - When a roll is configured to use Dicer by hand, Foundry waits while the user throws.
  - The landed faces fulfill the dice terms, and only then is the chat message created.
  - System rolls (attacks, saves, damage) therefore work without system-specific code.
- **The throw:**
  - The user grabs the dice with mouse or touch, shakes them and flicks to release. Release speed and direction set the throw, and a short shake adds random spin.
  - There's a "throw for me" button (keyboard: Space) for an automatic throw that still uses real physics.
- **Who rolls by hand:**
  - Per-user setting: Off, Ask each time, or Always, optionally limited to chosen die types (for example only d20s).
  - World settings let the GM allow or forbid hand rolls, and require them for everyone.
- **Free rolling:** a small dice tray button opens a picker. Choose dice (2d6 + 1d20), throw them, and the result posts to chat as a normal roll. No sheet or roll prompt needed.
- **Everyone sees the same throw:** the thrower's client is authoritative.
  - It simulates the throw in the physics worker, then sends the recorded trajectory, compressed and quantized, to the other clients over the module socket.
  - The other clients replay that exact motion before the message is revealed, so it's the "it almost rolled a 20" moment on every screen.
  - This needs no cross-client determinism, so it does not depend on the v2 seed-sync work.
- **Reading the result:** the face whose normal points most nearly up wins.
  - If a die settles cocked (lands on an edge, or leans against another die) beyond a set tolerance, it gets a small automatic nudge and re-settles. The same applies to the d2 coin edge.
  - A die that leaves the roll area is re-thrown automatically.
- **Fairness:** the physics dice must be fair.
  - Verification includes a chi-square test of at least 10,000 simulated throws per die type, mirroring Owlbear Rodeo's published approach.
  - It must pass at p > 0.01 for every shape, including chamfered and custom-model dice. Centre of mass and collider shape must match the visual die.
- **Trust:** hand-rolled results are as trustworthy as Foundry's own manual entry, which also trusts the client. The chat card marks a hand-rolled result with a small icon so the GM can see it. The GM can disable hand rolls for players.
- **Privacy (designer's call):**
  - **Blind rolls:** the thrower throws, but on release the dice turn into neutral ghost dice on the thrower's screen, so the thrower never sees the faces. Only users allowed to see the result get the real trajectory with faces.
  - **Secret and whisper rolls:** only the recipients get the trajectory replay. Everyone else gets nothing, as G1 requires.
- **Timeouts:** if the thrower doesn't throw within a configurable time (default 60 s) or closes the prompt, the roll falls back to an automatic Foundry roll and says so in chat. Nothing hangs, and `diceSoNiceRollComplete` still fires.
- **DSN compatibility:** DSN's interactive-throw and pending-card flags and hooks (`flags.dice-so-nice.interactiveThrow`, `pendingCard`, `diceSoNicePendingThrowOpened/Closed/SlotsBound`) map onto this feature where the semantics match.

## 3. Non-goals for v1 (planned for later; the architecture must not block them)

- **Same throw on every screen** (seeded, synced physics). The physics design (§5) must be deterministic and seedable so this can ship in v2 without a rewrite.
- **Persistent dice** (dice left on the table after the roll), a DSN 6 world feature. v1 accepts and ignores its flags gracefully. Interactive throws are v1 (G10).
- **Automatic throws (not by hand) that every screen sees identically.** Automatic rolls still use Foundry's number and per-client animation in v1. Hand throws (G10) are already shared by sending the trajectory to every client; extending that to automatic rolls is v2.
- **A 3D dice tray model or visible table surface mesh.** v1 dice land on the Foundry scene, with the surface choice affecting sound only. Roll areas are v1 (G6).
- **DSN's Thormund GLB effect and the "celebrate"-module confetti effect.** These depend on other assets or modules. The rest of the effect catalogue is v1 (G7).
- **WebGPU renderer.** WebGL2 only for v1. Keep renderer-specific code contained so WebGPU can be added later.
- Stream view support, and dddice interop.

## 4. Anti-goals: things that make it a failure even if it works

- Slower than DSN on any machine, in any harness scenario.
- Leaking a secret, blind or private result to anyone, whether through animation, sound or timing.
- Chat showing the result before the dice land (unless the world setting says to show it immediately).
- Breaking a system or module that works with DSN, or silently dropping `diceSoNiceRollComplete`.
- Needing an external account or service.
- A huge download, or a long wait at world load.
- Copying DSN code or assets. The API is reimplemented from its documented and observed behaviour. DSN's licence must be checked; nothing gets copied verbatim.

## 5. How it gets made (decided)

The owner delegated the technical choices. Everything in this section is **the designer's call**, not something the owner chose. Change it if the builder finds a better path, but keep the goals.

### Tooling
- Plain JavaScript ES modules, matching the owner's other modules: pf2e-visioner, pf2e-leveler, pf2e-combater.
- jest for unit tests, eslint, prettier, husky.
- Live tests in `tests/live/` following the owner's existing Playwright harness pattern.
- **One difference from the owner's other modules:** a Vite build step that bundles three.js and the physics WASM into `dist/`. This is unavoidable for tree-shaking and WASM loading.
- Target Foundry **v14** (what DSN 6.4.5 targets, and what's installed). v13 support is a builder's decision, based on cost.
- Separate git repo at `modules/dicer`, like the owner's other modules.

### Rendering
- **Library:** three.js (current release), WebGL2.
- **Canvas:** one overlay canvas, created once and never rebuilt. It's hidden, with no render loop, whenever no dice are visible. Rendering is on demand: frames are drawn only while dice move or effects animate, then it stops.
- **Cheap per-pixel defaults:**
  - Pixel ratio capped at 1.5 by default (quality setting).
  - No logarithmic depth buffer.
  - **No full-screen post-processing by default.** Glow comes from emissive materials, plus an optional cheap bloom only at the highest tier.
  - Anti-aliasing via MSAA on the canvas, or FXAA at low tiers.
- **Shadows:** soft contact or blob shadows per die, or a single small shadow map (≤1024²) fitted tightly to the dice bounds each throw. No big fixed shadow frustum.
- **Lighting:** a small prefiltered studio environment map (KTX2 / compressed HDR, ≤512 KB at default) plus one key light. A higher-resolution environment is an optional download.
- **Quality tiers:** Low / Medium / High / Ultra.
  - The tier is auto-picked on first run from a short GPU probe.
  - It adapts at runtime: if frame time goes over budget during rolls, drop a tier for the session and tell the user once.
  - The GM can cap the tier for the world.

### Dice geometry and numbers
- **Geometry:** procedurally generated chamfered polyhedra for d2 (coin), d3, d4, d6, d8, d10, d12, d20, d100 (paired d10s), plus the other DSN shapes, keeping face IDs per triangle.
  - The chamfer radius is a per-appearance parameter; "sharp-edge" = minimal chamfer with a crisp highlight.
  - GLB models are supported for DSN model presets.
- **Numbers:**
  - **Font atlases:** numbers are drawn in the shader from a multi-channel SDF font atlas. Atlases are pre-generated at build time for the bundled fonts, and generated in a worker (OffscreenCanvas) for custom fonts.
  - **Engraving:** depth and normals are derived from the SDF in the shader, so the engraving costs nothing extra and there's no per-appearance texture generation.
  - **DSN-style image-per-face presets:** each image is loaded once into a texture array and used in place of the SDF glyph.
- **Batching:** instanced or merged draws per die type for large pools.

### Interior effects (clear dice)
- Ray-marched in the fragment shader inside the die's convex volume, in the die's local space, so the effect turns with the die.
- The step count is budgeted per quality tier, and only runs on pixels the die covers.
- Built-in interiors: liquid core, glitter or mica, swirl or marble, nebula, and a suspended shape (a simple SDF or a small texture).
- Low tier: interiors fall back to a cheap fake (a refraction-tinted cubemap).

### Physics
- **Rapier3D** (WASM, deterministic build) in a dedicated Web Worker. One worker for the life of the session, terminated on teardown.
- **Streaming results:** the worker streams simulated frames back in chunks over transferable buffers, so playback starts after the first chunk instead of after the whole throw. Buffers are pooled and reused, not reallocated.
- **Forcing the result:** same approach as DSN for v1 — after landing, apply the face rotation to the visual mesh so Foundry's result faces up. Keep the alternative (seeding or pre-steering so the physics lands on the result naturally) open for v2.
- **Deterministic and seedable:** given the same seed and inputs, every client produces the same frames. This is the v2 sync hook.

### Sound
- WebAudio with audio sprites. Collision events come from the worker. Surface sound comes from a per-world setting.

### Settings
- Every major feature has its own world or client on/off setting, so tables can trim cost: interiors, engraving depth, shadows, glow, sounds and so on.
- Settings are migrated from DSN on first run (G1).

## 6. Left to the builder
- Exact module layout, class boundaries and file names.
- How to pick between instancing and merging draws.
- SDF font tooling (e.g. msdf-atlas-gen at build time).
- The exact chamfer generation algorithm.
- How much of `DiceFactory`, `box` and `uniforms` to emulate. Decide this from a survey of real integrations (see §8).
- Visual tuning of every material, and the default appearance.
- UI design of the appearance editor. It must expose the layer stack (§G4) with a live 3D preview, and must load fast.
- Whether to support Foundry v13.

## 7. Verification
- **Benchmark harness** (Playwright, live Foundry world, like the owner's other live tests):
  - Scripted roll scenarios: 1 d20, 10 mixed dice, 30d6, 100 rolls back to back, 500-roll soak, resize mid-roll, context loss mid-roll, tab hidden mid-roll.
  - Records frame times (p50 / p95 / p99), long tasks, time to first dice frame, JS heap and renderer resource counts.
  - Runs the same scenarios against DSN 6.4.5 for the head-to-head targets in G2.
- **Compatibility suite:**
  - Unit tests for every `game.dice3d` method and hook contract.
  - Live tests with pf2e and dnd5e: secret, blind and ghost rolls; inline rolls; roll tables; initiative; appended rolls.
  - Plus the top DSN-integrating modules found in the §8 survey.
- **Privacy tests:** for each roll mode, assert that a non-viewing user gets no animation that reveals the result, no result-specific sound, and no earlier reveal.
- **Looks:** a standalone preview page renders each appearance under fixed lighting and camera. Use it for visual review and screenshot regression.

## 8. Risks and open items
1. **Path imports of `/modules/dice-so-nice/api.js`.** Some systems or modules import DSN's `api.js` by URL. A module with a different id can't serve that path, so those imports will 404 even when Dicer is active.
   - The builder must survey the major systems and DSN-integrating modules (dnd5e, pf2e, swade, wfrp4e, sw5e, CoC7, Cyberpunk RED, PF2e Toolbelt, popular dice-set modules) for how they integrate: hooks only, `game.dice3d` only, or path import.
   - Plan the mitigation from that survey: outreach to authors to also check `dicer`, or another approach the builder finds.
   - This decides how "drop-in" v1 really is.
   - **Decided (designer's call):**
     - **No stub package with id `dice-so-nice`.** That id belongs to DSN's authors, and squatting it would confuse users and break DSN updates.
     - v1 **ships with documented known gaps** for path-import integrations. It includes a clear compatibility table in the README and a short integration guide (a few lines: "also check `game.modules.get('dicer')`") to send to those authors.
     - **The survey moves to the very start** (step 0 in §9), because its result may reshape the `api.js` approach.
2. **DSN licence:** check it before reading DSN source for anything beyond observed API behaviour.
3. **Interior ray-marching on low-end GPUs** is the most likely performance threat. Tier budgets and the low-tier fallback must be proven in the harness early.
4. **Rapier determinism across browsers.** Verify early, even though sync is v2, so the v2 promise holds.
5. **Third-party SFX and DiceSystem subclasses** may reach into DSN internals (three.js objects, materials) beyond the documented interface. Support the documented interface, and log clear warnings for anything else.

## 9. Suggested order (for the plan)
0. **Integration survey:** how the major systems and modules hook into DSN (§8.1). Also check DSN's licence (§8.2).
1. **Look spike:** a standalone page with chamfered dice, SDF engraved numbers, four bodies, two interiors and a studio environment. Owner review of the look.
2. **Engine:** renderer lifecycle (on-demand, tiers, context loss), Rapier worker with streaming, playback and face forcing. Benchmark harness skeleton.
3. **Foundry integration:** message interception and reveal, privacy rules, hooks, `game.dice3d` core, and DSN mutual exclusion.
4. **DSN compatibility depth:** colorsets, systems, presets, image faces, GLB, the `api.js` classes, SFX API and migration. This step includes the integration survey.
   The interior performance proof (§8.3) runs on the reference machine as part of step 2, not at the end.
5. **Sounds and effects:** material and surface sounds, the trigger rule engine, the effect library, damage presets.
5b. **Rolling by hand:** fulfillment method, grab and throw, trajectory broadcast, result reading, fairness test, privacy rules.
6. **Themes and roll areas:** theme bundles and library, theme browser, roll-area editor, per-player areas.
7. **Customization:** appearance editor, per-role and per-actor settings, GM push and locks, preset import/export.
8. **Hardening:** the full harness, head-to-head against DSN, the soak test, and tuning until every G2 target passes.
