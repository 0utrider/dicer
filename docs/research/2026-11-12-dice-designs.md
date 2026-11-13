# Dicer: dice design research (2026-11-12)

## Summary

Research into what boutique and mainstream dice makers sell that Dicer's look system (shapes, bodies, insides, numbers) does not yet cover. Sources are vendor product pages found through web search; availability and prices change. Where a search did not confirm something (glass, bone, horn, specific brand lines such as Level Up Dice or Q-Workshop crit faces) it is marked "unverified" and the WebGL cost reasoning comes from general knowledge of real-time rendering.

Main findings:
- The biggest market trend is **sharp-edge resin** with **inclusions** (foil, glitter, flowers, moss, liquid cores). Dicer already has edge rounding and several insides, so the cheap wins are more *content* in the existing slots (foil flakes, colour-shift, glow, layered tints).
- **Gemstone / stone / wood / real-metal** bodies are a distinct premium tier. Most can be done with procedural noise plus a roughness/colour ramp (medium cost) and no new geometry.
- Real **odd-die shapes** (d3, d5, d7, d14, d16, d24, d30) are mostly a rules-system niche (Dungeon Crawl Classics). The cheap, popular ones are *relabels* of existing shapes (d3 = d6 labelled 1-1-2-2-3-3). Genuinely new shapes (d24 trapezoidal icositetrahedron, d30 rhombic triacontahedron, zocchihedron) need new geometry and collision.
- Numbers: the cheap wins are crit-face symbols, glow ink, outline/raised styles and more fonts. All are texture-level.

WebGL cost key: **cheap** = colour, texture or existing shader params; **medium** = a new shader feature (procedural noise, fake refraction, parallax); **expensive** = new geometry, true refraction, many inclusions, or new physics shapes.

---

## 1. Shapes

| Idea | Looks like | References | WebGL cost | Notes |
|---|---|---|---|---|
| d3 as relabelled d6 (or d6 with 1-2-3 twice) | Cube with each number twice | Common practice; "halve a d6" in [Goodman Games forum thread](https://goodman-games.com/forums/viewtopic.php?p=43598) | Cheap | No new geometry or physics. Fair if each number appears on exactly 2 opposite-free faces. Also real d3 dice exist in [uncommon-shape sets](https://www.gmdice.com/products/uncommon-shapes-polyhedral-dice-set). |
| Fate/Fudge d6 (+ blank -) | Cube with +, blank, - faces, two each | Fate dice sold at [Noble Knight](https://www.nobleknight.com/subcategory/dice) | Cheap | Pure texture on existing d6. Fair by construction (2 faces per symbol). Needs a roll-result mapping (+1/0/-1) in the module logic. |
| Pipped d6 | Classic casino or board-game dots instead of numerals | Pipped d6 sold alongside numbered in [Print Ninja dice options](https://printninja.com/dice-side-options/) | Cheap | Texture or inset spheres. Optional rounded-pip style (concave dimples via normal map). |
| Sharp-edge vs rounded: add "razor" sharp plus per-die chamfer | Crisp, faceted corners with flat faces | Sharp-edge sets from [Rowan Gate](https://riftgate.com/collections/sharp-edge-dice) and [Dispel Dice](https://dispeldice.com/blogs/news/resin-versus-acrylic-dice) | Cheap | Dicer already has 5 rounding steps. Market splits on sharp vs rounded, so only a "razor sharp with tiny bevel" preset may be new. No physics change. |
| Crystal / shard d4 | Elongated crystal, six-sided pencil with pointed ends, often called barrel d4 | [Crystal d4 variants](https://virtual-dreams.org/dice/different-d4-shapes-and-where-to-buy-them); shard d4 widely on Etsy | Expensive (new geometry) | Needs a new convex hull for collision. Fairness: the rolled face is the one that is up (or the lowest tip); needs a custom result-reading rule. Note: a vendor mentions [crystal-dice patents](https://www.gmdice.com/products/10-piece-crystal-hybrid-toxic-dice-set); check before copying exact designs. |
| Crystal d10 / gem-cut d10 | Gem-like d10, numbered in gold | [Crystal Oblivion d10](https://www.gmdice.com/products/crystal-oblivion-10-sided-d10-dice) | Expensive | Different topology to the pentagonal trapezohedron. New hull plus face-to-number map. |
| Barrel / long dice (d6 as a prism, d4 pencil, d8 "stick") | Long bar with numbered sides | [Print Ninja dice types](https://printninja.com/custom-dice), [Hero Time dice guide](https://herotime1.com/pieces/custom-dice-for-board-games) | Expensive | Long dice roll and stop on the long faces only, so they are *not* fair across the end caps. Needs a "ends cannot land" rule; physics hull is a prism. |
| d5 (triangular prism) | Short triangular bar, roll lands on one of three side faces plus ends excluded | Zocchi-style sets, [5-piece Zocchi originals](https://www.gmdice.com/products/5-piece-zocchi-originals-gamescience-dice-set-tan) | Expensive | Fairness depends on aspect ratio. A relabelled d10 (1-5 twice) is the cheap alternative. |
| d7 (pentagonal prism) | Seven-sided drum with 5 sides + ends or 7-sided trapezohedron | [DCC Special 7 set](https://shop.d20pfsrd.com/collections/vendors/products/dcc-special-7-rainbow-set-of-7-rare-and-unusual-rpg-dice-approved-for-use-with-dungeon-crawl-classics) | Expensive | Real d7 is a 7-sided trapezohedron (14 faces, each number twice). New hull. The cheap option is a d8 with reroll-on-8. |
| d14 (heptagonal trapezohedron) | Like d10 but with 7-sided symmetry | [DCC Special 7](https://tabletopbookshelf.com/products/dcc-special-7-dice) | Expensive | New hull. Natural extension of Dicer's existing trapezohedron code (parametric n-gon). Medium to build if d10 is generated parametrically. |
| d16 (octagonal trapezohedron) | Like d10 with 8-fold symmetry | [DCC sets](https://shop.d20pfsrd.com/collections/vendors/products/dcc-special-7-rainbow-set-of-7-rare-and-unusual-rpg-dice-approved-for-use-with-dungeon-crawl-classics) | Medium to expensive | Same parametric trapezohedron family. Face count 16; probability fair by symmetry. |
| d24 (trapezoidal icositetrahedron) | 24 kite-shaped faces, ball-like | [DCC set](https://tabletopbookshelf.com/products/dcc-special-7-dice) | Expensive | New hull with 24 kite faces; fair by symmetry (face-transitive). Small number text on kites. |
| d30 (rhombic triacontahedron) | 30 rhombic faces | [DCC set](https://shop.d20pfsrd.com/collections/vendors/products/dcc-special-7-rainbow-set-of-7-rare-and-unusual-rpg-dice-approved-for-use-with-dungeon-crawl-classics) | Expensive | Face-transitive Catalan solid, so fair. New hull with 30 faces. |
| Zocchihedron d100 | Golf-ball-like sphere with 100 small facets and a stopper mechanism | [Zocchi history](https://skullsinthestars.com/2017/03/09/the-geometry-of-weird-shaped-dice/) | Expensive | Not truly fair (known bias). Physics sphere with fake stops is a poor fit. Only a cosmetic oddity; low priority. |
| Coins with designs (d2 variants) | Coin faces: crown/sword, dragon/shield, game tokens | Coin-style dice in [uncommon-shape sets](https://www.gmdice.com/products/uncommon-shapes-polyhedral-dice-set) | Cheap | Dicer's d2 exists; add face motifs (relief via normal map). |
| d6 with symbol faces (custom faction/icon d6) | Cube with icons in place of numbers | [Hero Time custom dice](https://herotime1.com/pieces/custom-dice-for-board-games) | Cheap | Texture atlas on existing d6; map symbol to result. |

---

## 2. Bodies / materials

| Idea | Looks like | References | WebGL cost | Notes |
|---|---|---|---|---|
| Gemstone: amethyst | Purple, banded or cloudy crystal, slightly translucent | [Norse Foundry amethyst](https://trollandtoad.com/norse-foundry-dice/7-piece-dice-sets/amethyst-7-piece-rpg-set-gemstone-dice/1824691), [MAGISEVEN spotlight](https://arcaneeye.com/product-spotlights/magiseven-dice-spotlight/) | Medium | Procedural noise bands tinted purple + subtle subsurface fake (wrap lighting) + clearcoat. |
| Gemstone: obsidian | Glossy black glass, faint sheen or snowflake flecks | [MAGISEVEN obsidian](https://arcaneeye.com/product-spotlights/magiseven-dice-spotlight/), [Noble Knight mahogany obsidian](https://www.nobleknight.com/P/2148400857/Poly-Set---Mahogany-Obsidian-w-Gold-7) | Cheap to medium | Dark glossy dielectric plus fresnel; mahogany variant adds swirled brown streaks (noise). |
| Gemstone: malachite | Green concentric banding, opaque | [Malachite stone set](https://acceptance.reach.dog/shop/mythicos/products/malachite-stone-dice-set) | Medium | Procedural banded noise (warped rings). Very distinctive; great showcase. |
| Gemstone: opal | Milky body with colour flashes that shift with angle | [Opal dice listing via search results](https://www.dragonstrove.com/collections/all/products/amethyst-pebble-rpg-set-gemstone-dice) (opal set seen on retailer pages, unverified) | Medium | Thin-film or view-dependent hue shift on a milky base. Shares code with colour-shift resin. |
| Quartz / rose quartz / clear crystal | Cloudy or clear, internal fractures | [Gemstone dice buying guide](https://dicecraftlab.pages.dev/buying-guides/gemstone-dice) | Medium | Fake refraction + internal crack lines (noise). |
| Zircon / frosted glass (K9 glass) | Clear frosted glass with sandblasted faces | [Norse Foundry frosted amethyst glass](https://www.norsefoundry.com/collections/zircon/products/raised-frosted-amethyst-k9-glass-7-piece-glass-dice-set) | Medium | Frosted look = rough transmission (blur of back buffer or high-roughness env sample). True refraction is expensive; fake with env-map lookup offset. |
| Dichroic glass | Colours that flip between two hues by angle | [Runic Dice dichroic](https://www.runicdice.com/blogs/news/dichroic-glass-dice-shimmering-colors-for-epic-rolls) | Medium | View-dependent hue ramp driven by N.V. Same shader as opal or chameleon. |
| Wood (bubinga, teak, purpleheart, layered) | Visible grain, matte oil finish | [Bubinga](https://www.norsefoundry.com/collections/all/products/7-piece-wooden-dice-set-bubinga), [African teak](https://www.norsefoundry.com/collections/all/products/african-teak-7-piece-rpg-wooden-dice-set), [layered wood](https://thefourthplaceforgeeks.com/products/red-and-brown-7-piece-layered-wood-dice-set) | Medium | Procedural grain (stretched noise + rings) in object space. Layered wood = a few stripe bands. |
| Stone (granite, opalite, agate, lava) | Speckled or banded matte stone | [Stone dice sets](https://www.walmart.com/c/kp/stone-dice-set) | Cheap to medium | Dicer has marble; extend the same noise code with speckle/granite presets. |
| Bone / horn / ivory-style | Cream, fibrous, slightly translucent with dark streaks | [Core77 on unusual dice materials](https://core77.com/posts/103318/Gaming-Dice-Made-from-Human-Bones), [bone-design hollow metal](https://store.smm.org/products/copy-of-amethyst-gemstone-dice) | Medium | Streaky noise + warm subsurface fake. Wide appeal for fantasy skins. Real bone/horn sets unverified in search. |
| Metal: copper with green patina | Warm copper with verdigris in crevices | [Norse Foundry copper](https://www.norsefoundry.com/products/set-of-7-real-full-copper-rpg-dice-by-norse-foundry-polyhedral-dice), [Dice Dungeons copper](https://dicedungeons.com/products/metal-copper-dice-set) | Medium | Dicer has antique metal; add patina mask by noise + edge/cavity bias. |
| Metal: battleworn / distressed | Scratched, darkened plated zinc | [Die Hard Dice Mythica Battleworn Copper](https://www.dieharddice.com/products/mythica-battleworn-copper) | Medium | Scratch noise in roughness and colour. |
| Metal: hammered | Dimpled hammer marks | Common in metal sets, e.g. [Forged Gaming dice](https://www.gamenerdz.com/forged-gaming-dragon-envy-set-of-7-metal-dice) | Medium | Normal-map dimples via procedural noise. |
| Metal: gunmetal / rainbow anodized / oil-slick | Dark steel or titanium-style rainbow sheen | Rainbow and gradient plating on [metal dice](https://dnddice.com/products/inkblot) (colour-plated sets exist; exact line unverified) | Cheap to medium | Gunmetal = colour preset. Rainbow = thin-film hue ramp as for opal. |
| Iridescent / chameleon / colour-shift resin | Hue flips with viewing angle | [Rowan Gate teal iridescent foil](https://www.opengamingstore.com/products/teal-dice-with-iridescent-foil-sharp-resin), [Rowan Gate Fairy Fire opalescent](https://riftgate.com/products/fairy-fire-opalescent-sharp-edge-dice) | Medium | View-dependent hue ramp on the resin body. High visual payoff. |
| Glow-in-the-dark | Pale glowing body, brighter in dark scenes | [Dispel Dice Death by Ooze](https://www.nobleknight.com/P/2148430378/Poly-Set---Death-by-Ooze-Glow-in-the-Dark-7), [Kraken glow silicone](https://www.KrakenDice.com/products/red-grey-glow-in-the-dark-silicone-8pc-dice-set) | Cheap | Emissive term scaled by scene darkness or a simple "charge" fade. Interacts with bloom. |
| Layered / dual-tone resin | Two or more colour layers, hard or soft boundary | [Layered wood](https://thefourthplaceforgeeks.com/products/red-and-brown-7-piece-layered-wood-dice-set); layered resin common on Etsy | Cheap to medium | Colour gradient along an axis plus noisy boundary. |
| Pearlescent / mica shimmer | Soft sparkle and sheen from mica | [Dispel Dice notes mica and A/B coating](https://dispeldice.com/blogs/news/resin-versus-acrylic-dice) | Cheap to medium | Dicer has pearl; add a sparkle-noise layer for "mica". |
| Galaxy body (opaque, starfield) | Dark body with speckled stars | [Rowan Gate Galaxy](https://www.opengamingstore.com/collections/by-publisher/products/galaxy-sharp-edge-resin-dice-sand-and-glitter-liquid-core) | Cheap to medium | Dicer has nebula inside; a surface-only galaxy is a texture. |
| Frosted / sandblasted resin | Matte, finely grained faces | [Frosted glass dice](https://www.norsefoundry.com/collections/zircon/products/raised-frosted-amethyst-k9-glass-7-piece-glass-dice-set) | Cheap | Roughness plus fine noise bump. |

---

## 3. Insides / inclusions

| Idea | Looks like | References | WebGL cost | Notes |
|---|---|---|---|---|
| Flowers and moss | Pressed petals and green moss floating in clear resin | [Blue Flower and Moss](https://thefourthplaceforgeeks.com/products/blue-flower-and-moss-8-piece-dice-set-copy), [Eternal Spring](https://worldofdice.de/en/products/eternal-spring) | Medium | Billboarded alpha-cut quads (few per die) with parallax; moss = green noise clumps. |
| Butterfly wings | Wings suspended inside | [Monarch Meadows](https://dnddice.com/products/monarch-meadows-handmade-dice-set) | Medium | One or two textured quads with slight drift; extends floating-shape feature. |
| Mushrooms / toadstools and moss | Tiny pink-white mushrooms with moss | [Viridian Dice Toadstool](https://viridiandice.com/products/toadstool-08373) | Medium | Same as floating shape with new meshes. |
| Foil flakes (iridescent or crinkle) | Angular flakes that flash as the die turns | [Rowan Gate teal foil](https://www.opengamingstore.com/products/teal-dice-with-iridescent-foil-sharp-resin), [Nerdgear Pixel Heart foil](https://www.nerdgear.gg/products/premium-colored-pink-orange-7pc-handmade-sharp-edge-resin-dice-set) | Medium | Voronoi cells with per-cell random normal and fresnel flash. Cheaper than real instances. |
| Holographic glitter | Rainbow glints | Prismatic sets from [Dispel Dice Prismatic Light](https://dispeldice.com/products/prismatic-light-7-pc-dnd-dice-set) | Medium | Dicer has glitter; add diffraction hue by view angle. |
| Smoke / ink plume | Drifting dark wisps | [Dice Dungeons StarGlow Smoke](https://dicedungeons.com/products/starglow-smoke-sharp-resin-dice), [Inkblot](https://dnddice.com/products/inkblot) | Medium | Volume noise with slow flow (raymarch few steps) or layered fake planes. Dicer has swirl; smoke is a variant. |
| Liquid core with moving sand and bubble | Hollow sphere with liquid, glitter, air bubble sliding | [Dispel: are liquid core dice balanced](https://dispeldice.com/blogs/news/are-liquid-core-dice-balanced), [Kraken liquid core](https://krakendice.com/products/34mm-clear-liquid-core-single-d20-with-gold-ink) | Medium | Dicer has liquid; the novelty is the **air bubble** that stays up under gravity and sloshes. Cheap spring simulation. |
| Floating eye (eyeball that always looks up) | Eyeball inside a liquid core that rotates to face top | [Floating Eye Dice](https://reach.dog/shop/dark-elf-dice/products/floating-eye-dice-smoke-liquid-core-eyeball-ttrpg-role-playing-game-dice-set) | Medium | Extends floating shapes: a mesh with a gravity-aligned orientation and eased lag. Very memorable. |
| Sand and glitter quicksand | Heavy sand settling at the bottom with glitter | [Siren's Quicksand](https://www.nerdgear.gg/products/sirens-quicksand-7pc-handmade-sharp-edge-resin-dice-set), [Galaxy liquid core](https://www.opengamingstore.com/collections/by-publisher/products/galaxy-sharp-edge-resin-dice-sand-and-glitter-liquid-core) | Medium | Gravity-aligned fill line in shader plus particle noise; reuses the liquid code. |
| Dragon's hoard (coins, gems in liquid) | Gold coins and gems tumbling in a core | [Dragon's Hoard](https://riftgate.com/products/dragons-hoard-liquid-core-dice-set) | Expensive | Many small instanced meshes with physics-lite settling; cap at ~10-20 instances. |
| Layered colour bands inside | Horizontal colour layers inside clear resin | Layered resin dice (common on Etsy; example [Color Spray](https://knightanddaygames.com/products/color-spray-7-piece-polyhedral-dice-set)) | Cheap | Gradient with noise boundary along an axis. |
| Aurora / ombre gradient | Soft glowing bands | [Moonbeam sharp edge](https://shop.app/products/8011938496758/moonbeam-sharp-edged-resin-dice-set) | Medium | Animated gradient noise inside the volume (cheap raymarch or fresnel-blended slices). |
| Bubbles | Small spheres of air | Common artefact; vendors note [minor bubbles occur](https://thefourthplaceforgeeks.com/products/pink-flowers-and-moss-dice-set) | Cheap to medium | A few bright refractive spheres; instanced or shader spheres. |
| Bones / skulls / tiny miniatures | Tiny skeleton or dragon sculpted inside | [Obscura set](https://dispeldice.com/a/s/products/obscura-7pc-dice-set) (inside inclusions; details unverified) | Expensive | Needs meshes; each distinct mini is extra art and triangles. Skull already exists as floating shape; extend the library. |
| Embedded coins / runes | Small coin or rune tiles floating | Inclusion collection at [Riftgate inclusion dice](https://riftgate.com/collections/inclusion-dice?page=3) | Medium | Flat textured quads or tiny cylinders. |

---

## 4. Numbers / markings

| Idea | Looks like | References | WebGL cost | Notes |
|---|---|---|---|---|
| Crit icon on max face (d20 "20") | Skull, star or sun glyph in place of 20 | [Critical Role Champion dice](https://shop.critrole.com/products/critical-role-champion-dice-set-vax-ildan), [Crit stickers](https://www.thediceshoponline.com/products/crit-stickers-custom-sticker-set-for-your-d20) | Cheap | Texture swap per face. Also a crit-fail glyph on the 1. Ship as a setting with glyph choices. |
| Symbols instead of numbers on all faces | Custom icon set per face | [Hero Forge custom dice](https://kicktraq.com/articles/redirect/48579) | Cheap | Needs glyph atlas and a mapping UI. |
| Runic numerals (Elder Futhark / Norse) | Rune-style digits | [Norse Foundry Nidhoggr runic](https://www.norsefoundry.com/products/nidhoggr-norse-themed-metal-dice-set), [Runic dice](https://www.boardgamebliss.com/collections/all/products/dice-set-runic-black-white-7) | Cheap | Font choice only. Runic fonts need numeral mapping. |
| Blackletter / gothic | Old English style digits | [Old Norse blackletter font](https://fontspring.com/fonts/burntilldead/old-norse) | Cheap | Font file; mind licensing. |
| Elvish (Tengwar/Cirth-style) | Tolkien-esque numerals | [Elvish font packages](https://www.ctan.org/recommendations/dice) (LaTeX-oriented, need conversion) | Cheap | Font choice; check licence. |
| Futuristic / sci-fi | Squared, tech digits | [TypeType dice fonts](https://typetype.org/fonts/dice/) | Cheap | Font choice. |
| Handwritten / brush | Hand-drawn digits | Custom font options at [Norse Foundry custom fonts](https://help.norsefoundry.com/support/solutions/articles/66000458153-custom-fonts-and-designs) | Cheap | Font choice. |
| Art Deco / old-west / steampunk | Period display digits | Fonts at [TypeType](https://typetype.org/fonts/dice/) (category only; specific families unverified) | Cheap | Font choice. Bundle 6-10 free OFL fonts. |
| Glow ink numbers | Numbers that glow in the dark | [Dispel Death by Ooze listing](https://www.nobleknight.com/P/2148430378/Poly-Set---Death-by-Ooze-Glow-in-the-Dark-7) (glow body; glow ink sold as separate option on several shops) | Cheap | Emissive on the number fill. Mirrors existing fill options. |
| Outlined numbers | Outline in contrasting colour | Common on [resin dice with coloured inks](https://viridiandice.com/products/pink-flower-resin-dice-set-7-74894) | Cheap | SDF outline in the number shader. |
| Raised numbers (embossed) | Numbers protrude from face | [Raised frosted glass set](https://www.norsefoundry.com/collections/zircon/products/raised-frosted-amethyst-k9-glass-7-piece-glass-dice-set), [Amethyst frosted raised](https://www.dragonstrove.com/collections/all/products/amethyst-frosted-raised-gemstone-dice) | Cheap | Invert displacement via normal map; Dicer has depth so a sign flip. |
| Metallic foil / holographic ink | Numbers in colour-shifting foil | Iridescent foil inks on [Kraken liquid-core d20s](https://krakendice.com/products/34-mm-green-liquid-core-silver-glitter-single-d20-with-silver-ink) (gold/silver exist already) | Cheap to medium | Add hue ramp by view angle to the fill. |
| Face decorations (borders / corner ornaments) | Frame or rune ring around the number | [Runic engraved dice](https://www.boardgamebliss.com/products/dice-set-runic-white-black-7) | Cheap | Extra layer in face texture. |
| Pips for d6 with various styles (round, square, heart) | Different pip shapes | [Print Ninja pip options](https://printninja.com/dice-side-options/) | Cheap | Texture or SDF shapes. |
| Underline for 6/9 | Underscore to tell 6 and 9 apart | Standard on retail d10/d20 | Cheap | Likely already handled; confirm. |

---

## Top picks for Dicer

### Shapes
1. **Fate/Fudge d6**: no geometry, popular system, immediate value for Foundry games.
2. **d3 / d5 / d7 as relabelled existing dice**: gives DCC-style coverage with zero new physics.
3. **Crystal / shard d4**: the most iconic alternative form, and a clear step-up in looks (needs a new hull and a custom face-reading rule).
4. **Parametric trapezohedron (d14 / d16)**: reuses the d10 construction code, so cost is moderate and the shapes are fair by symmetry.
5. **Pipped d6 and coin face motifs**: cheap texture work that makes the base shapes feel complete.

### Bodies / materials
1. **Iridescent / chameleon colour-shift resin**: one view-angle hue ramp also powers opal and dichroic glass.
2. **Gemstone set (amethyst, malachite, obsidian)**: procedural banded noise gives premium looks with no new geometry.
3. **Wood (several grains)**: totally different feel from resin or metal, cheap with procedural grain.
4. **Copper patina / battleworn metal**: extends the existing metal finishes with noise masks.
5. **Glow-in-the-dark**: trivial emissive, large effect in dark scenes.

### Insides / inclusions
1. **Foil flakes (Voronoi flash)**: cheap-ish and the single most common premium look.
2. **Floating eye / gravity-aligned inclusion**: very memorable, builds on the floating-shape feature.
3. **Flowers and moss / butterfly**: the best-selling "real object" family, done with a few textured quads.
4. **Smoke / ink plume**: close to the existing swirl code; strong "premium" feel.
5. **Liquid with air bubble and sand settling**: small addition to the liquid feature that adds believable physics motion.

### Numbers / markings
1. **Crit icon on the max face (and fumble on 1)**: biggest gameplay-readable gain, texture-only.
2. **Glow-ink numbers**: pairs with the glow body.
3. **Raised (embossed) numbers vs engraved**: a sign flip on the existing depth effect.
4. **Font bundle (blackletter, runic, elvish, sci-fi, handwritten, Art Deco)**: the largest "more designs" count for the least work; check font licences.
5. **Outlined numbers / holographic foil fill**: extends the existing fill options.

---

## Sources

Shapes
- https://www.gmdice.com/products/uncommon-shapes-polyhedral-dice-set
- https://goodman-games.com/forums/viewtopic.php?p=43598
- https://www.nobleknight.com/subcategory/dice
- https://printninja.com/dice-side-options/
- https://printninja.com/custom-dice
- https://herotime1.com/pieces/custom-dice-for-board-games
- https://virtual-dreams.org/dice/different-d4-shapes-and-where-to-buy-them
- https://www.gmdice.com/products/10-piece-crystal-hybrid-toxic-dice-set
- https://www.gmdice.com/products/crystal-oblivion-10-sided-d10-dice
- https://shop.d20pfsrd.com/collections/vendors/products/dcc-special-7-rainbow-set-of-7-rare-and-unusual-rpg-dice-approved-for-use-with-dungeon-crawl-classics
- https://tabletopbookshelf.com/products/dcc-special-7-dice
- https://www.gmdice.com/products/5-piece-zocchi-originals-gamescience-dice-set-tan
- https://skullsinthestars.com/2017/03/09/the-geometry-of-weird-shaped-dice/
- https://riftgate.com/collections/sharp-edge-dice
- https://dispeldice.com/blogs/news/resin-versus-acrylic-dice

Bodies
- https://trollandtoad.com/norse-foundry-dice/7-piece-dice-sets/amethyst-7-piece-rpg-set-gemstone-dice/1824691
- https://arcaneeye.com/product-spotlights/magiseven-dice-spotlight/
- https://www.nobleknight.com/P/2148400857/Poly-Set---Mahogany-Obsidian-w-Gold-7
- https://acceptance.reach.dog/shop/mythicos/products/malachite-stone-dice-set
- https://dicecraftlab.pages.dev/buying-guides/gemstone-dice
- https://www.dragonstrove.com/collections/all/products/amethyst-pebble-rpg-set-gemstone-dice
- https://www.dragonstrove.com/collections/all/products/amethyst-frosted-raised-gemstone-dice
- https://www.norsefoundry.com/collections/zircon/products/raised-frosted-amethyst-k9-glass-7-piece-glass-dice-set
- https://www.runicdice.com/blogs/news/dichroic-glass-dice-shimmering-colors-for-epic-rolls
- https://www.norsefoundry.com/collections/all/products/7-piece-wooden-dice-set-bubinga
- https://www.norsefoundry.com/collections/all/products/african-teak-7-piece-rpg-wooden-dice-set
- https://thefourthplaceforgeeks.com/products/red-and-brown-7-piece-layered-wood-dice-set
- https://www.walmart.com/c/kp/stone-dice-set
- https://core77.com/posts/103318/Gaming-Dice-Made-from-Human-Bones
- https://store.smm.org/products/copy-of-amethyst-gemstone-dice
- https://www.norsefoundry.com/products/set-of-7-real-full-copper-rpg-dice-by-norse-foundry-polyhedral-dice
- https://dicedungeons.com/products/metal-copper-dice-set
- https://www.dieharddice.com/products/mythica-battleworn-copper
- https://www.gamenerdz.com/forged-gaming-dragon-envy-set-of-7-metal-dice
- https://www.opengamingstore.com/products/teal-dice-with-iridescent-foil-sharp-resin
- https://riftgate.com/products/fairy-fire-opalescent-sharp-edge-dice
- https://www.nobleknight.com/P/2148430378/Poly-Set---Death-by-Ooze-Glow-in-the-Dark-7
- https://www.KrakenDice.com/products/red-grey-glow-in-the-dark-silicone-8pc-dice-set
- https://dispeldice.com/products/prismatic-light-7-pc-dnd-dice-set

Insides
- https://thefourthplaceforgeeks.com/products/blue-flower-and-moss-8-piece-dice-set-copy
- https://thefourthplaceforgeeks.com/products/pink-flowers-and-moss-dice-set
- https://worldofdice.de/en/products/eternal-spring
- https://dnddice.com/products/monarch-meadows-handmade-dice-set
- https://viridiandice.com/products/toadstool-08373
- https://viridiandice.com/products/pink-flower-resin-dice-set-7-74894
- https://www.nerdgear.gg/products/premium-colored-pink-orange-7pc-handmade-sharp-edge-resin-dice-set
- https://dicedungeons.com/products/starglow-smoke-sharp-resin-dice
- https://dnddice.com/products/inkblot
- https://dispeldice.com/blogs/news/are-liquid-core-dice-balanced
- https://krakendice.com/products/34mm-clear-liquid-core-single-d20-with-gold-ink
- https://krakendice.com/products/34-mm-green-liquid-core-silver-glitter-single-d20-with-silver-ink
- https://reach.dog/shop/dark-elf-dice/products/floating-eye-dice-smoke-liquid-core-eyeball-ttrpg-role-playing-game-dice-set
- https://www.nerdgear.gg/products/sirens-quicksand-7pc-handmade-sharp-edge-resin-dice-set
- https://www.opengamingstore.com/collections/by-publisher/products/galaxy-sharp-edge-resin-dice-sand-and-glitter-liquid-core
- https://riftgate.com/products/dragons-hoard-liquid-core-dice-set
- https://riftgate.com/collections/inclusion-dice?page=3
- https://knightanddaygames.com/products/color-spray-7-piece-polyhedral-dice-set
- https://shop.app/products/8011938496758/moonbeam-sharp-edged-resin-dice-set
- https://dispeldice.com/a/s/products/obscura-7pc-dice-set

Numbers
- https://shop.critrole.com/products/critical-role-champion-dice-set-vax-ildan
- https://www.thediceshoponline.com/products/crit-stickers-custom-sticker-set-for-your-d20
- https://kicktraq.com/articles/redirect/48579
- https://www.norsefoundry.com/products/nidhoggr-norse-themed-metal-dice-set
- https://www.boardgamebliss.com/collections/all/products/dice-set-runic-black-white-7
- https://www.boardgamebliss.com/products/dice-set-runic-white-black-7
- https://fontspring.com/fonts/burntilldead/old-norse
- https://www.ctan.org/recommendations/dice
- https://typetype.org/fonts/dice/
- https://help.norsefoundry.com/support/solutions/articles/66000458153-custom-fonts-and-designs

Limits: no search result confirmed real bone/horn dice sets, glass/marble resin lines, Level Up Dice, Q-Workshop or Chessex crit-face products, or specific Art Deco / old-west dice fonts. Those rows rely on general knowledge and are marked unverified.
