# Dicer Plan 4 — execution notes

Rulings, deferred findings and what is not verified, kept from the execution ledger.

## Not verified (owner)

- Live tests never run against a real Foundry world: npm run test:live:effects (and Plan 3's test:live, test:live:compat); docs/live-checks.md items 10-15.
- Look and sound of every effect, damage theme and synthesized sound: owner sign-off on dev/effects.html (npm run dev). docs/signoff/plan-4/effects.png shows celebrate only.
- Real frame times and first-use shader compile hitch at landing (watch the 30d6 sparks and first nat-20 checks).
- Editors (Trigger rules, Damage type map) never opened in Foundry; FilePicker/DialogV2/selectOptions untested live.
- A real third-party DiceSFX module (e.g. daggerheart-duality-dice imports DSN's api.js by path — documented gap).

## Ledger

Spec: docs/superpowers/specs/2026-11-10-dicer-design.md (G7, G8, G9). Branch feat/plan-4-sounds-effects from main f9a3db5.

## Pre-flight scan

| Pair / task   | Produces vs consumes                                                                | Finding                      |
| ------------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| T1→T4         | Playback.takeEvents {die,other,speed} → DiceBox onImpact                            | consistent                   |
| T2→T3         | renderAll keys impact:/surface:/result: → engine buffers                            | consistent                   |
| T3→T7         | engine.result(sound) at landing                                                     | consistent                   |
| T4↔T11        | DieSpec.soundMaterial override                                                      | consistent                   |
| T5→T7         | matchRule die ctx {type,dsnType,value,faces,...}; d100 faces 100 + ones-die-only fx | consistent                   |
| T5→T10        | dsnDefaultsToRules emits result.kind 'label'; normalizeRule rejects unknown kinds   | CONFLICT → P4-R1             |
| T6→T7/T11     | outcomeOf/roleOf/damageTypesByTerm(knownTypes)                                      | consistent                   |
| T7→T8         | onLandedFx(die,fx); roll.slowMotion → setSpeedRamp                                  | consistent                   |
| T7↔T8         | `effects` setting (T7) used by flagsFor (T8)                                        | consistent                   |
| T8→T9         | library/index.js + effect module contract; catalogue lists T8 die effects           | consistent                   |
| T8→T10        | effect layer resolves dsn: ids via dsnSfx.effectFor                                 | consistent                   |
| T7/T11→T13    | damageTypeSounds read by fx resolver, but T13 Files omit fx-resolver.js             | GAP → P4-R2                  |
| T4,T8,T12,T13 | each edits build.test lazy list                                                     | sequential, fine             |
| T12           | Preview needs a local test-die path not defined elsewhere                           | GAP → P4-R3                  |
| T14           | live test reads _debug counters no task creates                                     | GAP → P4-R4                  |
| T1            | tests vs code: events pooled + capped 64/chunk; tests don't exceed cap              | self-consistent              |
| T2            | pure DSP, tests structural                                                          | self-consistent              |
| T3            | constants MIN/LOUD from T1 measurements                                             | self-consistent (depends T1) |
| T4–T13        | each task's tests match its interfaces                                              | self-consistent              |
| T14           | dev page + docs                                                                     | self-consistent              |

Ruling: P4-R1 normalizeRule accepts result.kind 'label' (with string `label`) only for source 'module'; user/world rules with 'label' are rejected — the plan's Task 5 defines 'label' as module-only — cost if wrong: editor can't offer label rules to users (Task 12 offers label choices for addSFXTrigger dice; then T12 must allow 'label' for world/user too, a one-line change).
Ruling: P4-R2 Task 13 may modify src/effects/fx-resolver.js to apply damageTypeSounds — the test it specifies requires it — cost if wrong: none beyond file scope.
Ruling: P4-R3 Task 12's Preview may add a non-enumerable `_preview(fxSpec)` helper on the dice3d api (or a main.js export) that throws one local die with fx; never broadcast — cost if wrong: a small internal API to rename.
Ruling: P4-R4 Task 14 adds `_debug.fxPlays` / `_debug.resultSounds` counters (dice3d `_debug`, incremented in main.js onLandedFx) — needed by its live test — cost if wrong: two debug fields.

## Tasks

Task 1: dispatched (BASE f9a3db5, implementer sonnet)
Task 1: implemented de4db9a; measured speeds first floor ~20/24/28, settle ~0.8/1.8/3.9 (sim units/s); review dispatched
Task 1: complete (commits f9a3db5..de4db9a, review clean)
Task 1: minor (deferred): 64/chunk cap + events-buffer pool untested; takeEvents drops events in the landing hop (quiet taps) and bursts events held during 'waiting'; recycle skips empty events buffers; per-event array allocs; misleading `floor` var in fade-out test
Task 1: ⚠️ resolved: nothing in src calls PhysicsClient.recycle (pre-existing since Plan 1, frames too) — not a Task 1 gap; flagged for final review
Task 2: dispatched (BASE de4db9a, sonnet)
Task 2: implemented 03ffced; review: 1 Important (8 ms slice budget not enforced) → fix round 1 sent to implementer
Task 2: minor (deferred): saw-harmonics expr duplicated (note/sweep); untested unknown-material RangeError, default scheduler, budgetMs; renderAll ignores idle deadline (engine must pass timeout); variant unvalidated
Task 2: fix round 1/5 (1 addressed, 0 open — 8 ms budget now enforced via resumable generators; commits 03ffced..a31ebef)
Task 2: minor (deferred): budget test counts now() calls not blocks (wouldn't catch regression); final slice unchecked; addModes yield cadence uses absolute index (crackle stretches); no RED shown for new tests
Task 2: complete (commits de4db9a..a31ebef, review clean)
Task 3: dispatched (BASE a31ebef, sonnet)
Ruling: P4-R5 impact gain constants MIN_IMPACT_SPEED=4, LOUD_IMPACT_SPEED=24 sim units/s (squared curve) — from Task 1 measurements: first floor impact 20-28 → 0.64-1.0, settling taps p90 3.9 → 0 — cost if wrong: retune two constants by ear on the dev page
Task 3: minor (deferred): resume after own idle-suspend relies on gesture hook (gestured flag); sound.volume unvalidated (NaN); catch-all warns per call not once; admit() can evict then drop; AudioBuffer wrap + context creation on first hit frame; dispose leaves pointerdown listener + spurious warn on in-flight decode; result() awaits preload; idle-suspend test one-sided
Task 3: ⚠️ resolved: renderAll uses budgetMs/now, not IdleDeadline (Task 2 fix) — fine. Colorset material never reaches appearance → Task 4 dispatch told to pass registry colorset material hint as preset when available.
Task 3: complete (commits a31ebef..6fcf6e7, review clean)
Task 4: dispatched (BASE 6fcf6e7, sonnet)
Ruling: P4-R6 the lazy audio chunk is named synth-_.js (Vite names it after src/audio/synth.js) rather than audio-_.js — only the name differs; build.test lists it — cost if wrong: rename via manualChunks, trivial
Task 4: implemented 3a15a9d; review: 1 Important (ghost-impact test doesn't exercise ghost die) → fix round 1 sent
Task 4: minor (deferred): landing-hop impacts dropped (#impacts only while 'playing'); no test for DSN preset material hint / spec.soundMaterial on ghost / main.js onImpact wiring; effectsVolume unread until Task 7; onSoundChange doc vs quietWhenUnfocused registration
Task 4: fix round 1/5 (1 addressed, 0 open — ghost impact test now discriminates; commits 3a15a9d..83e030f)
Task 4: complete (commits 6fcf6e7..83e030f, review clean)
Task 5: dispatched (BASE 83e030f, sonnet); P4-R1 carried
Task 5: implemented 57efc95; review: 1 Important (silent skip of malformed DSN entries) + controller-confirmed gap (effect options dropped by normalizeEffect, needed by Task 10) → fix round 1 sent
Task 5: minor (deferred): malformed die/context fields widen rule silently; malformed effect with sound dropped silently; auto ids unstable; numeric trigger label case untested; regex cache unbounded/ReDoS; normalizeRules dedupe + d100 min untested; matchRule assumes normalized input (callers must normalize)
Task 5: fix round 1/5 (2 addressed, 0 open — DSN malformed entries warn; effect options preserved; commits 57efc95..60d6ed2)
Task 5: minor (deferred): malformed-entry warn dedupe collapses same-diceType entries; jsonSafe no node budget on cyclic options; DSN-path option clamp untested
Task 5: complete (commits 83e030f..60d6ed2, review clean)
Task 6: dispatched (BASE 60d6ed2, sonnet)
Task 6: implemented 3fbbad4; review: 1 Important (PF2e untyped instance default flavor 'damage,healing' → tagged healing) → fix round 1 sent
Task 6: minor (deferred): isDie true for pool terms with results; raw PF2e instance type accepted outside knownTypes (Task 11 must treat unknown type as no theme); dnd5e options.types single-element only; depth-boundary test weak
Task 6: fix round 1/5 (1 addressed, 0 open — untyped PF2e instance ignores own flavor; commits 3fbbad4..76d9b9a)
Task 6: complete (commits 60d6ed2..76d9b9a, review clean)
Task 7: dispatched (BASE 76d9b9a, opus — privacy-critical integration)
Ruling: P4-R7 damageType must not be gated by `effects`/`showOthersEffects` (it drives damage-theme looks, gated only by `damagePresets`) — Task 7 gated it per brief text; Task 11 dispatch must split it out — cost if wrong: damage looks vanish when effects are off.
Ruling: P4-R8 for showForRoll the rule-owner/macro roller is the verified sender id (socket senderUserId / local user), not the payload's authorId (unverified); decorateFor gains a 4th arg rollerId — anti-spoofing (P3-R15 spirit) — cost if wrong: a module calling showForRoll(roll, otherUser) gets the caller's rules instead of otherUser's; one-line revert in dice3d.js.
Task 7: minor (deferred, FINAL SHOULD TRIAGE): discarded/inactive results (2d20kl) trigger effects/macros; client `effects` off silently disables roller's macros; dice-box landing test uses stub not createLandedFx; fx.effect/sound share refs with cached rules (freeze); redundant ghost check in #fireFx
Ruling: P4-R9 "once per rule per roll" for macros = once per DiceBox roll (one rollOrder group); a rule matching in two groups of one message runs twice — groups are separate throws; cost if wrong: dedupe key moves to message id (small).
Task 7: complete (commits 76d9b9a..5c96888, review clean)
Task 8: dispatched (BASE 5c96888, opus)
Task 8: implemented 0d1ed7e; world start 3972.7/4096 KiB (123 KiB left); lazy chunk effects-*.js via src/effects/library/effects.js; review dispatched (opus)
Task 8: minor (deferred): effect layer ignores safe-mode flags.effects (die effects isolate/glow shell under safe); glow shell ignores fade; layer doesn't clamp duration (rules clamp 100-5000 but DSN/other paths); shake replaces transform not composes; ramp comment wrong; isolate scans all rolls
Task 8: ⚠️ resolved: RollComplete is later on clients that slow down (they see the real result) — per-client animation only, ghost viewers unaffected; consistent with "never the timing another client sees". Tint visual check → Task 14 dev page.
Task 8: complete (commits 5c96888..0d1ed7e, review clean)
Task 9: dispatched (BASE 0d1ed7e, sonnet)
Ruling: P4-R10 composite effects (celebrate, fumble) degrade with the tier instead of being dropped: declared cost = cheapest essential part, extra parts start only while the tier budget allows — plan table cost 4/3 would make the layer drop a nat-20 celebration entirely on low (budget 2) — cost if wrong: low-tier composites look slightly richer/poorer than the strict budget; adjust declared costs.
Task 9: implemented 013a445 (no RED; effects chunk 15.3 kB + shared Points chunk 5.5 kB lazy; dicer.js unchanged); review dispatched
Task 9: review: 1 Important (stale particles replay after idle) → fix round 1 sent
Task 9: minor (deferred): clear() marks full-capacity ranges every teardown; overlapping shatters can leave die hidden (released at finish anyway); color/intensity test asserts nothing; countFor scales by particleScale twice (pool cap also scaled); lightning per-segment array alloc
Task 9: fix round 1/5 (1 addressed, 0 open — stale slots killed on idle; commits 013a445..3727fdf)
Task 9: complete (commits 0d1ed7e..3727fdf, review clean)
Task 10: dispatched (BASE 3727fdf, sonnet)
Task 10: implemented 22a4777 (tests after draft; dicemesh = die.outer with type/result temporarily set, refcounted restore); review dispatched
Task 10: review: 1 Important (DSN effects unbound → keep running after releaseDie) → fix round 1 sent
Task 10: minor (deferred): no clear-mid-play / concurrency tests; once-per-mesh WeakMap never cleared (fine unless dice pooled); timeout includes init time; timed-out play() keeps running on destroyed instance; registry-name test lives in dsn-sfx.test not registry.test
Task 10: fix round 1/5 (1 addressed, 0 open — DSN effects bindsDie; commits 22a4777..c70aa57)
Task 10: complete (commits 3727fdf..c70aa57, review clean)
Task 11: dispatched (BASE c70aa57, sonnet); carries P4-R7
Task 11: implemented 4435d89; review dispatched
Task 11: minor (deferred): brief-listed "landing fx absent for ghost views" test not added (covered by Task 7 mutation-verified gate pin); build.test library marker 'uAlpha' brittle; theme appearance shallow-frozen; leftover comment in test; resolveDamageTheme moduleDefaults param dead
Task 11: ⚠️ resolved: ghost path confirmed by Task 7 review (gate never calls decorateFor for ghost/none, mutation-tested); landing ids exist in Task 9 catalogue; {builtin} sound shape matches engine.result
Task 11: complete (commits c70aa57..4435d89, review clean)
Ruling: P4-R11 amends P4-R1 — normalizeRule accepts result.kind 'label' for any source (world/user too), because Task 12's editor must offer label results for addSFXTrigger dice — cost if wrong: a label rule on a die without labels never matches (harmless).
Task 12: dispatched (BASE 4435d89, sonnet); carries P4-R3, P4-R11
Ruling: P4-R12 disabled module (DSN) rules persist as world setting disabledModuleTriggers (Array of rule ids, config:false), honoured by the fx resolver — Task 12 says module rules can be disabled but not edited and no task named the storage — cost if wrong: a setting rename.
Task 12: implemented 22446bd (world start 3982.5/4096 KiB); review dispatched
Task 12: review: 2 Important (duplicate/missing lang keys → raw keys in UI; invalid stored rules silently dropped on save) → fix round 1 sent
Task 12: minor (deferred): FilePicker render(true) legacy form; moduleRulesOf instantiated twice (double warn); d100 preview type mismatch; world save two writes no rollback; no template/context test
Task 12: fix round 1/5 (2 addressed, 0 open — lang keys + raw unreadable rules kept; commits 22446bd..35585fe)
Task 12: minor (deferred): lang test hardcodes kinds/outcomes lists; non-array stored value warned but overwritten; raw rules reordered to end on save; delete-drops-raw test weak
Task 12: complete (commits 4435d89..35585fe, review clean)
Task 13: dispatched (BASE 35585fe, sonnet); carries P4-R2
Task 13: implemented 97caa85; review dispatched
Task 13: review: 2 Important (malformed stored map/sound entries silently dropped on save; editor class untested) + ⚠️ confirmed gap (editor idle prefetch after ready missing, Tasks 12+13) → fix round 1 sent
Task 13: minor (deferred): previewSpec duplicates resolver landing-fx shape (volume clamp differs); stale draft overwrite on concurrent GM edits; long line; icon buttons lack aria-label; menu proxy render() not asserted
Task 13: ⚠️ dice-box honours spec appearance/soundMaterial/fx keys — confirmed: makeDie copies appearance (Plan 3), soundMaterial (Task 4), fx (Task 7)
Task 13: fix round 1/5 (3 addressed, 0 open — unreadable entries kept, behavioural tests, preloadEditors; commits 97caa85..55db237)
Task 13: minor (deferred): non-object stored setting not preserved; ready-hook call verified by source regex only
Task 13: complete (commits 35585fe..55db237, review clean)
Task 14: dispatched (BASE 55db237, sonnet); carries P4-R4
Task 14: implemented f986b12..3255e65 (incl. additive blend black-box fix found via screenshot; screenshot produced); review dispatched
Task 14: review: 1 Important (live privacy scenario never reaches a ghost view) → fix round 1 sent
Task 14: minor (deferred): glow-pulse duplicates ADDITIVE_PREMULTIPLIED blend fields; debug counter maps unbounded (by distinct ids); fixed settle time; rollNat20 mutation unverified until owner run
Task 14: fix round 1/5 (1 addressed, 0 open — player blind ghost scenario + polling; commits 3255e65..b3b2ccb)
Task 14: minor (deferred): grace anchored to GM landing; convoluted Promise.all; observe doc wording
Task 14: complete (commits 55db237..b3b2ccb, review clean)
Final review: dispatched (opus) over f9a3db5..b3b2ccb
Final review: With fixes — Important: (1) discarded/inactive results trigger fx/macros; (2) client effects off kills roller's macros. Minor chosen for the wave: safe-mode gate in effect layer; README note macros run only when the roller's animation lands. Others can wait. Fix wave dispatched (BASE b3b2ccb, sonnet)
Final fix wave: re-review clean (4 addressed; commits b3b2ccb..b624b15)
