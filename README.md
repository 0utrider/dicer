[![Latest Version](https://img.shields.io/github/v/release/roileaf/dicer?display_name=tag&sort=semver&label=Latest%20Version)](https://github.com/roileaf/dicer/releases/latest)
[![GitHub all releases](https://img.shields.io/github/downloads/roileaf/dicer/total)](https://github.com/roileaf/dicer/releases)
[![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https%3A%2F%2Fforge-vtt.com%2Fapi%2Fbazaar%2Fpackage%2Fdicer)](https://forge-vtt.com/bazaar)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/roileaf)
[![Patreon](https://c5.patreon.com/external/logo/become_a_patron_button.png)](https://www.patreon.com/roileaf)

# Dicer

Physics-simulated 3D dice for **Foundry VTT v14**, in sync for every player. Dice roll, bounce and
land on the real result; you design how they look; damage dice burn, freeze and crackle in their
element; big moments get effects; and a little pet watches your rolls. Dicer is a lightweight
alternative to Dice So Nice that keeps its API working, so modules and dice sets made for it work
too.

**[Read the wiki](https://github.com/roileaf/dicer/wiki)** for guides to every feature.

## Built on Dice So Nice

Dicer would not exist without [Dice So Nice](https://gitlab.com/riccisi/foundryvtt-dice-so-nice),
the module that brought 3D dice to Foundry and that its authors and contributors have refined
since 2020. Dicer deliberately mirrors the Dice So Nice API, hooks and flags so existing worlds,
modules and macros keep working when you switch. That compatibility only exists because Dice So
Nice designed an API worth being compatible with. Huge thanks to everyone who built it.

If you like 3D dice in Foundry, please consider supporting Dice So Nice too.

## Highlights

### Dice

- **Real 3D dice for every roll**: d2 to d100, Fate dice and coins, thrown by Rapier physics and
  drawn with three.js, the same throw on every screen. Nothing runs while no dice are on screen.
- **Physics decides** (optional): the faces the physics lands up become the result, instead of the
  dice turning to show numbers Foundry already chose.
- **Roll by hand**: pick dice up and throw them yourself, or grab and toss dice that have landed.

### Looks

- **39 built-in themes**, 17 of them by Sherp: resin with living insides (fire, storm, frost, lava
  and more), metal, marble, opal, gem, stone, wood, bone and jelly.
- **A dice editor with a live preview**: your own fonts, face images and body images; a look per die
  type, kind of roll, character or damage type.
- **Damage dice in their element**: fire, cold, acid, force and every other damage type get their
  own look, landing effect and sound, with elemental trails in flight and a burst on a natural 20
  (Pathfinder 2e, Starfinder 2e, D&D 5e, or a tag like `2d6[fire]` in any system).

### Moments

- **Effects and trigger rules**: celebrations for natural 20s and 1s, slow motion, screen shake,
  sounds, macros and JB2A animations, fired by rules you set.
- **Roll stats**: who rolled what, and who's luckiest at the table.

### Pets

- **Eighteen dice pets**: a mimic, slime, dragonling, owl, frog, ghost, mushroom, floating eye, pebble
  golem, cat, fox, paper lantern, imp, clockwork robot, jester doll, raven, jumping spider and floating skull
  (and a drone in Starfinder 2e worlds), each a textured 3D model with a face that blinks, smiles and sulks.
- They throw your dice, cheer natural 20s, sulk at 1s, react to every damage type, grab at dice
  flying past, get splatted by a d20 and pop back, and can be petted, dragged anywhere and given a
  voice pitch.
- Tint them with your colour or keep their natural colours, and see them from above, angled or
  facing you. **Preview your pet** shows it off without rolling.

### Table

- **Dice trays**: a table tray the GM sets for everyone or a tray of your own, in felt, wood,
  leather, stone, metal or your own picture, any shape. Pop one out to a second screen.
- **A chat dice bar** that fits your system: advantage and disadvantage, fortune and misfortune,
  flat checks, Daggerheart duality rolls and Draw Steel edges and banes.
- **Roll areas** per player, **roll filters**, and electronic dice such as Pixels.

### Compatibility

- **Dice So Nice compatible**: modules and systems that call the Dice So Nice API keep working,
  including module dice sets with their 3D models and textures.
- **Dice So Nice add-ons without Dice So Nice**: add-on modules that require Dice So Nice (so
  Foundry won't let you enable them) can stay off. The GM ticks them in the theme browser's
  **Installed dice** window and reloads; Dicer then runs their code and their dice show up in
  the theme browser. Their stylesheets and translations aren't loaded.

## Installation

Dicer needs **Foundry VTT v14**.

1. In Foundry's **Add-on Modules** tab, choose **Install Module** and search for **Dicer**, or paste
   this manifest URL:
   `https://github.com/roileaf/dicer/releases/latest/download/module.json`
2. Enable **Dicer** in your world's **Manage Modules**.
3. **Disable Dice So Nice.** The two can't run at the same time; while Dice So Nice is active, Dicer
   stays off and tells the GM.

After an update, reload Foundry with **Ctrl+F5** so the browser drops its old copy of the module.
See [Installation](https://github.com/roileaf/dicer/wiki/Installation) and
[Getting started](https://github.com/roileaf/dicer/wiki/Getting-Started) in the wiki.

## Links

- [Wiki](https://github.com/roileaf/dicer/wiki): guides, settings reference, troubleshooting
- [Changelog](CHANGELOG.md)
- [Report a bug or ask for a feature](https://github.com/roileaf/dicer/issues)
- For module and macro authors: [Dice So Nice compatibility](https://github.com/roileaf/dicer/wiki/Dice-So-Nice-Compatibility)
  and [API](https://github.com/roileaf/dicer/wiki/API)
- Building Dicer or contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Credits

- [Dice So Nice](https://gitlab.com/riccisi/foundryvtt-dice-so-nice) and its contributors, whose API
  Dicer keeps working (see above).
- **Sherp**, for 17 of the built-in themes.
- [Rapier](https://rapier.rs) (physics) and [three.js](https://threejs.org) (3D), which Dicer is
  built on.
- Everyone who tested Dicer, reported bugs and sent videos.

## License

Dicer is free software under the [GNU General Public License v3](LICENSE).
