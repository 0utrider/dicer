# Dicer Roadmap

Spec: `docs/superpowers/specs/2026-11-10-dicer-design.md`

The spec covers eight largely independent subsystems. Each gets its own plan, and each plan ends in working, testable software. A plan is written only after the previous one ships, so it can build on real interfaces rather than guesses.

| # | Plan | Spec sections | Ends with |
|---|---|---|---|
| 1 | **Foundation and first roll** | §8.1–8.2 survey, G1 (core gate and hooks), G2 (lifecycle targets), §5 rendering, physics and geometry | A chat roll in Foundry shows chamfered dice with engraved numbers. The chat message stays hidden until they land, then the hooks fire. No GPU work when idle. |
| 2 | **The look** | G3, §5 interiors, tiers | Studio lighting, the layered material system, metal, resin, marble and pearl bodies, ray-marched interiors, quality tiers with auto-pick and adaptive drop. The owner signs off the look. |
| 3 | **DSN compatibility depth** | G1 (all), §8 risks | The full `game.dice3d` API, all hooks, the privacy matrix, `api.js`, colorsets, systems, presets, image faces, GLB models, migration, appended rolls, initiative, chat commands, and `showForRoll` synchronize. |
| 4 | **Sounds, effects, damage presets** | G7, G8, G9 | Material and surface impact sounds, the trigger rule engine, the effect library, PF2e and dnd5e damage themes. |
| 5 | **Themes and roll areas** | G5, G6 | Theme bundles, a library of 20+ themes, the theme browser, the roll-area editor, per-player areas, the roll-area API. |
| 6 | **Rolling by hand** | G10 | The fulfillment method, grab and throw, trajectory broadcast, result reading, fairness test, privacy for blind rolls, the free-roll tray. |
| 7 | **Customization UI** | G4 | The appearance editor with live preview; per-user, per-type, per-role and per-actor assignment; GM push and locks; preset import and export. |
| 8 | **Hardening** | G2 table, §7 | The full benchmark harness, the head-to-head against DSN 6.4.5 (normal and throttled profiles), the 500-roll soak test, and a benchmark macro users can run. |
