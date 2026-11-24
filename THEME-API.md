# Dicer theme API for other modules

Dicer 1.4.0 and later give other modules a small API to ship dice themes and default them onto
actors, without writing to Dicer's settings or flags.

```js
Hooks.once('dicer.ready', (api) => {
  // api === game.modules.get('dicer').api
});
```

`dicer.ready` fires once in Dicer's `ready` hook. A module whose own `ready` runs later can also
check `game.modules.get('dicer')?.api` directly.

## Themes

```js
api.registerTheme(theme, { moduleId }); // true when registered
api.unregisterTheme(themeId);
api.listThemes(moduleId); // copies of a module's registered themes
```

- `theme` is the same shape as an entry of Dicer's world theme list:
  `{ id, name, appearance, perType?, rules?, soundMaterial?, damage? }`. Export a theme from
  Dicer's theme browser to get one.
- The id must start with `<moduleId>.` (for example `necromancer-thrall-helper.necromancer`).
- Registered themes live for the session only and are read-only. Register them every load: every
  player's client runs your module, so every player sees them, with no GM involved.
- Registering an id again replaces it (a module update can change its theme). Each change fires
  `dicer.themesChanged`.
- In Dicer's theme browser they show among all themes, tagged with your module's title. Players can
  duplicate one into their own themes to change it; the GM can make one the world default.

## Fonts

```js
api.registerFont(moduleId, { id: 'my-module.lexend', label: 'Lexend', file: 'modules/my-module/fonts/Lexend-Bold.woff2' });
api.unregisterFont(id);
api.listFonts(moduleId); // copies of a module's registered fonts
```

Registered fonts show in the appearance editor's **Numbers** section as a row of buttons under the
module's title. Picking one sets the font to `file:<file>`, the same value a theme can already store
in `numbers.font`, so a theme made from it works without the module's registration (as long as the
file is served). `id` starts with `<moduleId>.`; `file` follows the rules of a `file:` font (a
relative path, no `..`, a font file extension). Registering an id again replaces it, and
`dicer.fontsChanged` fires on every change.

## Actors

```js
api.hasActorChoice(actor);   // has anybody picked dice for this actor? (theme, look, appearance, colorset or system)
api.getActorTheme(actor);    // the actor's own theme id, else a default provider's; null when neither
await api.setActorTheme(actor, themeId, { ifUnset: true }); // writes a choice (needs ownership); ifUnset: only when none
await api.clearActorTheme(actor); // removes the choice, so a default provider applies again
```

Pass a token's actor (`token.actor`) to read or set what that token itself carries: an unlinked
token keeps its own choice.

## Default providers (recommended)

```js
api.registerDefaultProvider(moduleId, (actor) => themeId | null);
```

Dicer asks providers, in registration order, only when the rolling actor has no dice choice. The
answer is never written to the actor, so removing your module removes the defaults and leaves no
flags behind. A choice made by a player or the GM always wins.

When a roll comes from a token, Dicer passes the provider that token's actor (an unlinked token's
synthetic actor, with its own flags), so a provider can tell a summoned thrall token apart.

## Preloading

The first roll of a look compiles its shaders, which can freeze the canvas for a moment. Dicer
compiles ahead the looks it expects: every player's, and those of the actors likely to roll (each
player's character, the actors players own, the tokens on the viewed scene). That covers an actor's
theme and a provider's default, and only the themes in use: a provider that hands out one of eight
themes per actor gets the ones its actors resolve to, not all eight. Nothing to do on your side.

```js
api.warmThemes([themeId, ...]); // -> how many of the ids name a theme
```

Call it only for themes you apply some other way (a roll's own `appearance`, a theme you set just
before rolling). Be selective: each theme is a compile on every client. Nothing is stored.

## Example: necromancer and thralls (Necromancer Thrall Helper)

```js
const MODULE = 'necromancer-thrall-helper';

Hooks.once('dicer.ready', async (api) => {
  // the two inverse themes, kept in the module as JSON (the world theme list format)
  const themes = await (await fetch(`modules/${MODULE}/dicer-themes.json`)).json();
  for (const theme of themes) api.registerTheme(theme, { moduleId: MODULE });

  // defaults for actors nobody picked dice for; never written, so players' choices always win
  api.registerDefaultProvider(MODULE, (actor) => {
    if (!game.settings.get(MODULE, 'dicerDefaults')) return null; // the module's own off switch
    if (isThrall(actor)) return `${MODULE}.thralls`;
    if (isNecromancer(actor)) return `${MODULE}.necromancer`;
    return null;
  });
});
```

`isThrall` and `isNecromancer` are the module's own tests (a flag it sets on a thrall token, a class
or feat on the necromancer). Without Dicer active, `dicer.ready` never fires and nothing is written.
