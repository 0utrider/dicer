[![Latest Version](https://img.shields.io/github/v/release/roileaf/dicer?display_name=tag&sort=semver&label=Latest%20Version)](https://github.com/roileaf/dicer/releases/latest)

[![GitHub all releases](https://img.shields.io/github/downloads/roileaf/dicer/total)](https://github.com/roileaf/dicer/releases)

[![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https%3A%2F%2Fforge-vtt.com%2Fapi%2Fbazaar%2Fpackage%2Fdicer)](https://forge-vtt.com/bazaar)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/roileaf)
[![Patreon](https://c5.patreon.com/external/logo/become_a_patron_button.png)](https://www.patreon.com/roileaf)


# Dicer

Physics-simulated 3D dice for Foundry VTT v14, in sync for every player. Dicer is a lightweight
alternative to Dice So Nice: dice that roll, bounce and land on the real result, themes you design
yourself, damage dice in their element, effects for big moments, and dice pets that watch your rolls.

**[Read the wiki](https://github.com/roileaf/dicer/wiki)** for guides to every feature.

## Built on Dice So Nice

Dicer would not exist without [Dice So Nice](https://gitlab.com/riccisi/foundryvtt-dice-so-nice),
the module that brought 3D dice to Foundry and that its authors and contributors have refined
since 2020. Dicer deliberately mirrors the Dice So Nice API, hooks and flags so existing worlds,
modules and macros keep working when you switch. That compatibility only exists because Dice So
Nice designed an API worth being compatible with. Huge thanks to everyone who built it.

If you like 3D dice in Foundry, please consider supporting Dice So Nice too.

## Highlights

- **Real 3D dice for every roll**: d2 to d100, Fate dice and coins, rolled by Rapier physics and
  drawn with three.js. Nothing runs while no dice are on screen.
- **Themes and a dice editor**: resin with living insides (fire, storm, frost, lava and more),
  metal, marble, pearl, gem, wood and more, your own fonts, face images and body images, with a live
  preview. Pick looks per die type, kind of roll, character or damage type.
- **Damage dice in their element**: fire, cold, acid, force and every other damage type get their
  own look, landing effect and sound, with elemental trails in flight and a burst on a natural 20
  (Pathfinder 2e, Starfinder 2e, D&D 5e, or a tag like `2d6[fire]` in any system).
- **Effects and trigger rules**: celebrations for natural 20s and 1s, built-in effects, JB2A
  animations, sounds and macros, fired by rules you set.
- **Dice pets**: a mimic, slime or dragonling that watches your rolls, cheers, sulks, reacts to
  every damage type, can be splatted, petted, dragged anywhere and follows your cursor with its eyes.
- **A chat dice tray** that fits your system: advantage and disadvantage, fortune and misfortune,
  flat checks, Daggerheart duality rolls and Draw Steel edges and banes.
- **Roll by hand**, grab and toss landed dice, **roll areas** per player, **roll filters**, and
  electronic dice such as Pixels.
- **Dice So Nice compatible**: modules and systems that call the Dice So Nice API keep working,
  including module dice sets with their 3D models and textures.

## Installation

Dicer needs **Foundry VTT v14**.

1. In Foundry's **Add-on Modules** tab, choose **Install Module** and search for **Dicer**, or paste
   this manifest URL:
   `https://github.com/roileaf/dicer/releases/latest/download/module.json`
2. Enable **Dicer** in your world's **Manage Modules**.
3. **Disable Dice So Nice.** Dicer replaces it; while Dice So Nice is active, Dicer stays off and
   tells the GM.

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

## License

Dicer is free software under the [GNU General Public License v3](LICENSE).
