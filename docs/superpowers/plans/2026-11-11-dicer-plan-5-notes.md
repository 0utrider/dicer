# Dicer Plan 5 — execution notes

Rulings, deferred findings and what is not verified, kept from the execution ledger.

## Not verified (owner)

- Live tests never run against a real Foundry world: npm run test:live:areas (and earlier test:live, test:live:compat, test:live:effects); docs/live-checks.md items 16-22.
- Visual sign-off: dev/themes.html (22 themes; docs/signoff/plan-5/themes.png shows thumbnails only, no throw) and dev/areas.html; the area editor in a real client (z-index vs Foundry windows).
- The live theme-choices getter in Foundry's Configure Settings form (checked against client code, not run).
- Dice crossing the stage into far areas (P5-R5) seen live.

## Ledger

Spec: docs/superpowers/specs/2026-11-10-dicer-design.md (G5, G6). Branch feat/plan-5-themes-areas from main 496351f.

## Pre-flight scan

| Pair / task | Produces vs consumes                                                                               | Finding                            |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| T1→T2       | toDieArea {cx,cz,halfWidth,halfDepth} → sim/playback/DiceBox                                       | consistent                         |
| T1→T3       | resolveArea, normalizeAreaDef → resolver                                                           | consistent                         |
| T3→T4       | settings rollAreas/gmPrivateArea → API set/get                                                     | consistent                         |
| T4→T5       | rollAreas.set/setGmPrivateArea → editor save                                                       | consistent                         |
| T2↔T3       | DiceBox.roll(specs,{area}) px rect; resolver returns null for full stage                           | consistent                         |
| T6→T7       | findTheme(id,{worldThemes,userThemes}); sources defined in T7                                      | consistent                         |
| T6          | asserts theme table size in build.test.js, but Files omit build.test.js                            | GAP → P5-R1                        |
| T7          | `look` setting → `theme`; getSetting('look') used in main getAppearance/warmup/mirror/onLookChange | must update all call sites → P5-R2 |
| T7→T8       | resolver themeId → fx decorate look param                                                          | consistent                         |
| T9          | ports resting-orientation helper into src/core, Files omit                                         | GAP → P5-R3                        |
| T9→T10      | thumbnailer imported only by browser (same lazy chunk)                                             | consistent                         |
| T11         | live test reads last roll area via _debug; no task adds it                                         | GAP → P5-R4                        |
| T5,T10      | both edit build.test lazy list + preloadEditors                                                    | sequential, fine                   |
| each task   | tests match interfaces                                                                             | self-consistent                    |

Ruling: P5-R1 Task 6 may modify tests/unit/build.test.js to assert the theme-table size budget — required by its own interface — cost if wrong: none.
Ruling: P5-R2 Task 7 renames the `look` setting to `theme` and must update every getSetting('look') / onLookChange('look') call site (main getAppearance, warmup, mirrorLook, dice3d preload release) keeping a one-time migration — cost if wrong: broken fallback look.
Ruling: P5-R3 Task 9 may create src/core/resting.js (resting orientation helper ported from dev/looks.js) and update dev/looks.js to import it — cost if wrong: none.
Ruling: P5-R4 Task 11 adds a `_debug.lastRollArea` getter (die-unit area + px rect of the most recent DiceBox roll) for the live test — cost if wrong: one debug field.

## Tasks

Task 1: dispatched (BASE 496351f, sonnet)
Task 1: implemented 19b15a5; review dispatched
Task 1: minor (deferred): "4K→800x600" test misnamed; partial custom def keeps preset 'custom'; toDieArea no diePx guard; resolveArea no malformed-usable guard (zero-height window)
Task 1: ⚠️ camera convention (+x right, +z down) to be verified in Task 2 when toDieArea is wired
Task 1: complete (commits 496351f..19b15a5, review clean)
Task 2: dispatched (BASE 19b15a5, opus)
Ruling: P5-R5 visible mid-air spawn for inner areas — choose (b): dice spawn beyond the STAGE edge on the seeded spawn side (perpendicular coordinate within the area's span) and are aimed at the area's inner 60%; the area's spawn-side wall stays open until all dice are inside, as today; full-stage default stays bit-identical — dice should fly in from off-screen, never pop into view mid-air — cost if wrong: longer travel for far areas (more sim steps); revert to area-edge spawn.
Task 2: implemented 3c605ca + e0f423a (P5-R5); convention +x right/+z down confirmed via real camera test; review dispatched (opus)
Ruling: P5-R6 a throw's area must hold its dice — DiceBox grows the die-unit area around its centre (clamped to the stage) so area ≥ n dice × CAPACITY (≈ 1.0 die-unit² per die, implementer measures) before throwing — minimum-size areas hit the 600-step cap with 8-12 d6 — cost if wrong: an area visibly larger than the GM drew for big pools.
Task 2: review Approved with 1 Important (capacity overflow, needs ruling) → resolved by P5-R6; fix round 1 sent
Task 2: minor (deferred): JSDoc long line; settle measurement test not committed (partly addressed in fix)
Task 2: fix round 1/5 (2 addressed, 0 open — fitDieCapacity CAPACITY_PER_DIE=4, ONE_DIE_HALF=1.5; commits e0f423a..f0345f2)
Task 2: minor (deferred): 20x11 stage capacity only measured, not a committed test; docs must say effective area can exceed the drawn rect for big pools (Task 11)
Task 2: complete (commits 19b15a5..f0345f2, review clean)
Task 3: dispatched (BASE f0345f2, opus)
Task 3: implemented d5cbf46; review dispatched. Ruling: P5-R7 secret rolls (roll.secret / s.secret, view real on a GM client) also count as GM-private for the corner — a secret roll is GM-only content just like blind — cost if wrong: one condition.
Task 3: minor (deferred): allReal bolted onto array; GM-only logic duplicated gate vs dice3d; warnOnce keys per user
Task 3: complete (commits f0345f2..d5cbf46, review clean); P5-R7 (secret counts as GM-private) carried into Task 4
Task 4: dispatched (BASE d5cbf46, sonnet)
Task 4: implemented cd925d2 (incl. P5-R7 via src/areas/gm-only.js); review dispatched
Task 4: review: 3 Important (get/snapshot vs resolver fallback mismatch; no hook behaviour test; withArea drops non-object container) → fix round 1 sent (+ sync-throw & **proto** minors)
Task 4: minor (deferred): concurrent set read-modify-write race; before[i].secret OR keeps corner if RollStart clears secret (conservative); snapshotAreas static import small world-start cost
Task 4: ⚠️ resolved: s.secret on API path only matters with view==='real' (gmPrivate = view==='real' && isGmOnly) and resolver enforces GM client — no privacy path
Task 4: fix round 1/5 (4 addressed, 0 open — shared storedDefFor/gmPrivateDef, emitRollAreasChanged, refuse unreadable container; commits cd925d2..54954a4)
Task 4: complete (commits d5cbf46..54954a4, review clean)
Task 5: dispatched (BASE 54954a4, sonnet)
Task 5: implemented e33979f; review dispatched
Task 5: review Approved with 1 Important (editor duplicates stored-def rule) → fix round 1 sent (+ sticky drag, leak test)
Task 5: minor (deferred): partial save across drafts unreported per target; editing user areas with perPlayerAreas off has no effect (no hint); Esc swallowed globally while open; z-index 70 vs Foundry windows unverified live; no mid-drag resize test
Task 5: fix round 1/5 (1+3 addressed, 0 open — shared areaDefFor; sticky drag; spy leak test; commits e33979f..b378a76)
Task 5: complete (commits 54954a4..b378a76, review clean)
Task 6: dispatched (BASE b378a76, sonnet); carries P5-R1
Task 6: implemented 93b2314 (table 2127 B; size test skips until imported — Task 7 must make it enforce); review dispatched
Task 6: minor (deferred): KNOWN_EFFECTS hand-copied from catalogue (no sync test); deepFreeze may freeze shared input sub-objects (unchecked); per-theme warnings not single; no id-prefix check vs source (Task 10 import re-namespaces); code before tests
Task 6: complete (commits b378a76..93b2314, review clean)
Task 7: dispatched (BASE 93b2314, opus); carries P5-R2 + make size test enforce (remove early return)
Task 7: implemented 8995f2e (table 2143 B real dist; themes.js table turned into array so markers survive); review dispatched (opus)
Task 7: ⚠️ resolved: missing theme falls through to the roller's next ref (type → global) rather than straight to default — accepted as intended (better behaviour; same result with only a global ref)
Ruling: P5-R8 a damage override value (client damageThemeOverrides) naming a theme is looked up in the VIEWER's own dicer.themes first, then the roller's; the fx path passes the roller id to damageThemer.forRoll; both paths share the look resolver's die-type helper (DENOMINATION-based) — carried into Task 8 — cost if wrong: small lookup-order change.
Task 7: minor (deferred): damage-map editor preview ignores world/user themes; ready-time mirror/DSN migration race (benign); per-roll JSON.stringify of worldThemes twice
Task 7: complete (commits 93b2314..8995f2e, review clean)
Task 8: dispatched (BASE 8995f2e, sonnet); carries P5-R8
Task 8: implemented 6b578cc; review dispatched. Ruling: P5-R9 when a theme rule replaces a world rule (P5-D4), the replaced world rule's macro is kept (the theme replaces only effect/sound) — a GM's automation on nat 20 must not vanish because a player picked a theme — cost if wrong: a world macro still runs for themed dice.
Task 8: review: 1 Important (fx theme lookup viewer-first contradicts P4-D2) + P5-R9 (keep world macro) + ⚠️ end-to-end themeId → fix round 1 sent
Task 8: minor (deferred): damage path user list shadows built-in id (own1 naming); look path author vs fx roller differ on showForRoll
Task 8: fix round 1/5 (4 addressed, 0 open — roller-only theme lookup on fx path; world macro kept; e2e test; commits 6b578cc..3c8212b)
Task 8: minor (deferred): orphaned JSDoc in resolve-looks.js
Task 8: complete (commits 8995f2e..3c8212b, review clean)
Task 9: dispatched (BASE 3c8212b, sonnet); carries P5-R3
Task 9: implemented 07d5ecc; review dispatched
Task 9: review: 1 Important (dispose mid-render crashes finally cleanup + bogus warn) → fix round 1 sent (+ unhandled rejection, teardown on context loss)
Task 9: minor (deferred): weak disposal assertions; default createRenderer path untested (dev page check Task 11); d100 perType consults d100 not d10
Task 9: fix round 1/5 (3 addressed, 0 open; commits 07d5ecc..42bf64f)
Task 9: minor (deferred): labelTex assertion weak; scene/PMREM release not asserted; material/shadowFor before try (leak on throw)
Task 9: complete (commits 3c8212b..42bf64f, review clean)
Task 10: dispatched (BASE 42bf64f, sonnet)
Task 10: implemented 854815e; review dispatched
Task 10: review: 1 Important (non-built-in default reverted by Configure Settings save — choices only built-ins) → Ruling: P5-R10 keep the `theme` setting's choices live (built-ins + world + current user's themes, refreshed before the settings form renders and on theme-list changes) and resolve world/user themes in getAppearance — cost if wrong: a longer dropdown. Fix round 1 sent (+ ForcedDeletion, merge raw on edit, delete confirm, comment)
Task 10: minor (deferred): every card repeats full target list (N×M options for GM); import warnings joined into one long toast; dangling theme ids after delete (runtime falls back)
Task 10: fix round 1/5 (1+4 addressed, 0 open — live choices getter verified against Foundry client code; commits 854815e..8c2112c)
Task 10: minor (deferred): DialogV2.confirm untested; getAppearance re-reads theme lists per call
Task 10: complete (commits 42bf64f..8c2112c, review clean)
Task 11: dispatched (BASE 8c2112c, sonnet); carries P5-R4 + docs note that big pools grow the effective area (Task 2)
Task 11: implemented 4178cf8 (screenshot produced: 22 thumbnails); review dispatched
Task 11: review: 2 Important (README/live-checks menu name wrong; live test checks requested rect not landing) → fix round 1 sent (+ process.exit skips restore, double areaScale, side channel)
Task 11: minor (deferred): theme throw button never exercised in the sign-off shot (thumbnails only)
Task 11: fix round 1/5 (2+3 addressed, 0 open — menu wording; real landing check; commits 4178cf8..506db9b)
Task 11: complete (commits 8c2112c..506db9b, review clean)
Final review: dispatched (opus) over 496351f..506db9b
Final review: With fixes — Important: actor theme assignment writes {global:{theme}} but resolver reads flat actor ref. Fix wave dispatched with minors 2 (escape), 3 (refuse unreadable theme/damage containers), 4 (group capacity), 5 (viewer damage override theme rules), T6 KNOWN_EFFECTS sync test
Final fix wave: re-review clean (6 addressed; commits 506db9b..37851b3). minor (deferred): #onSaveEdit null deref if list goes bad mid-edit; 'Saved' toast after refused write; gallery open warns on bad data
