# DSN model orientation (Plan 3, Task 6)

Which way the faces of a DSN-compatible die model (`modelFile` presets) sit relative to Dicer's
face layout (`src/core/dice-shapes.js`). The result is `MODEL_ROTATIONS` in
`src/compat/dsn-orientation.js`.

**Ruling:** a wrong rotation puts the wrong number on top, which is a visible lie. A type gets a
rotation only when every observed model of that type maps onto Dicer's layout by one rotation,
and the renders confirm it. Every other type is `null` and falls back to Dicer's procedural die.

**Result:** verified `d2` and `d6`. `null`: `d4`, `d8`, `d10`, `d12`, `d20`, `d100`.

## Method (observation only)

No Dice So Nice code was read. Its `main.js`, geometry tables and assets were not opened. The
evidence is the third-party model files and what they visibly show.

1. **Find the presets.** Searched `Data/modules/*` (excluding `dice-so-nice` and `dicer`) for
   `modelFile` and for `.glb` / `.gltf` files. Five modules register model presets. Each one
   registers `d2 d4 d6 d8 d10 d100 d12 d20` with `labels: ""`:

   | Module | Version | Files | Notes |
   | --- | --- | --- | --- |
   | daggerheart-duality-dice | 0.0.2 | `assets/models/dice_*.glb` | Draco-compressed (`KHR_draco_mesh_compression`). Its d2 shows symbols, not numbers. |
   | trs-black-marble-dice-set | 1.0.1 | `models/dice_*.gltf` | |
   | trs-gold-red-armored-dice-set | 1.0.2 | `models/dice_*.gltf` | |
   | trs-norse-dd-boneyard | 1.0.1 | `models/dice_*.gltf` | Its d8 is slightly irregular (normal components 0.574 to 0.581). |
   | pf2e-ap200-seven-dooms-for-sandpoint | 14.1.0 | `assets/models/dice_*.gltf` | Its d2 shows symbols. The folder also holds `d*.gltf` files that no preset registers. They are excluded (see the end of this doc). |

   Daggerheart's rhombic d12 presets (`daggerheart.rhombic_d12`) are not a Dicer shape.
   `modelRotationFor` already refuses any DSN type that isn't the Dicer type itself.

2. **Load the models the way Dicer loads them.** `dev/models.html` uses
   `src/render/model-loader.js` (`loadDieModel`, radius 1): it takes the first mesh, bakes in
   the node transform, and recentres. The driver is
   `node tests/visual/model-orientation.mjs <modelsDir> <file>:<faceCount>[:<type>] ...`. It
   serves the files through a Playwright route, so nothing is copied into the repo.

3. **Face normals.** `clusters(n)` groups the triangles by normal direction (cos > 0.995) and
   keeps the `n` largest groups by area. Each group's normal is its area-weighted mean.

4. **Numbers.** `shot(normal)` renders the unrotated model looking straight down each normal,
   from outside. `artifacts/models/<file>-faces.png` puts these renders in a grid tagged with the
   face index. The number on each face was read from these renders.
   - **6 / 9:** the faces carry a bar under the numeral. They were also checked against the
     opposite-face sum. On the daggerheart d12 and d20, the faces whose bar reads them as 9
     are opposite 4 and 12 respectively (sums 13 and 21).
   - **d4:** the face value is the face resting on the table (Dicer's `readMode: 'down'`), so
     it is the number at the top vertex. That is the one number that does not appear on the
     face.

5. **Fit.** A rotation preserves the angles between faces and maps antipodal faces to antipodal
   faces. So two checks can each prove that no rotation exists: a pair of values whose face
   angle differs between the model and Dicer, or a value whose opposite differs. When those
   checks pass, the rotation is solved from two non-parallel face pairs and checked against
   every face.

6. **Render check.** `verify(type, q, value)` applies what DiceBox applies to the inner mesh:
   the face-forcing rotation from `rotationToShow` (from an identity landing), multiplied by
   `q` (model rotation first). It then renders the result from above the table.
   `artifacts/models/<file>-verify.png` shows one cell per value, tagged `v<value>`.

## Observed layouts

All normals are in model axes, after the node transform, with +Y up in glTF.

### d6: verified

- **daggerheart (`dice_6.glb`)**, faces 0 to 5:
  `+X 5`, `-Z 3`, `-Y 1`, `+Z 4`, `-X 2`, `+Y 6`
- **The other four sets agree face for face:**
  - black-marble: `-X 2`, `+X 5`, `+Y 6`, `+Z 4`, `-Y 1`, `-Z 3`
  - gold-red: `+Z 4`, `+Y 6`, `-Z 3`, `+X 5`, `-Y 1`, `-X 2`
  - norse: `+Y 6`, `-Z 3`, `+Z 4`, `-Y 1`, `+X 5`, `-X 2`
  - pf2e `dice_6`: `+X 5`, `-X 2`, `+Z 4`, `-Z 3`, `-Y 1`, `+Y 6`

| value | model normal | Dicer normal |
| --- | --- | --- |
| 1 | [0, -1, 0] | [1, 0, 0] |
| 2 | [-1, 0, 0] | [0, 1, 0] |
| 3 | [0, 0, -1] | [0, 0, 1] |
| 4 | [0, 0, 1] | [0, 0, -1] |
| 5 | [1, 0, 0] | [0, -1, 0] |
| 6 | [0, 1, 0] | [-1, 0, 0] |

The fitted rotation is `[-√½, √½, 0, 0]` (x, y, z, w), which is 180° about (−1, 1, 0)/√2. The
maximum error over all six faces is 0.

**Render check:** in `dice_6.glb-verify.png` (daggerheart) and `dice_6.gltf-verify.png`
(gold-red), every value v1 to v6 shows that number on top.

### d2: verified

- **Coins with numbers:** black-marble, gold-red and norse all show `1` on −Z and `2` on +Z.
  - black-marble: face0 [0, 0, −1] shows 1, face1 [0, 0, 1] shows 2
  - gold-red: same as black-marble
  - norse (a pentagonal coin): face0 [0, 0, 1] shows 2, face1 [0, 0, −1] shows 1
- **Coins with symbols:** the daggerheart and pf2e coins show symbols, not numbers, so they
  give no evidence either way. They share the same Z-axis coin geometry.

| value | model normal | Dicer normal |
| --- | --- | --- |
| 1 | [0, 0, -1] | [0, 1, 0] |
| 2 | [0, 0, 1] | [0, -1, 0] |

The rotation is `[√½, 0, 0, √½]`, which is +90° about X. It takes −Z to +Y and +Z to −Y.

**Render check:** in `dice_2.gltf-verify.png` (gold-red), v1 shows 1 and v2 shows 2. The
collider stays Dicer's coin.

### d4: null (mirror image)

- **daggerheart faces:** `[-,-,-]` shows {4, 2, 3}, so its value is 1. `[-,+,+]` shows
  {4, 1, 3}, value 2. `[+,-,+]` shows {1, 3, 2}, value 4. `[+,+,-]` shows {1, 4, 2},
  value 3. Each normal component is ±0.57735.
- **Dicer:** 1 `[-,-,-]`, 2 `[-,+,+]`, 3 `[+,-,+]`, 4 `[+,+,-]`.
- **Why no rotation exists:** the two layouts differ by swapping 3 and 4, which is an odd
  permutation. Rotations of a tetrahedron only produce even permutations of its faces.

### d8: null

- **daggerheart:** `+++ 5`, `+-+ 3`, `-++ 8`, `++- 7`, `--+ 2`, `-+- 6`, `+-- 1`, `--- 4`
  (components ±0.57735).
- **The other four sets agree face for face** (from the `dice_8` renders).
- **Dicer:** 1 `+++`, 2 `++-`, 3 `+-+`, 4 `+--`, 5 `-++`, 6 `-+-`, 7 `--+`, 8 `---`.
- **Why no rotation exists:** the angle between faces 5 and 3 has cosine +1/3 on the models
  and −1/3 on Dicer.

### d10: null

- **daggerheart `dice_10`:** 0 sits opposite 9. Face 2 shows 0 at
  [0.600, −0.436, −0.670], and face 9 shows 9 at [−0.600, 0.436, 0.670]. The other opposite
  pairs are 4/5, 2/7, 6/3 and 8/1, so opposite faces sum to 9.
- **Dicer:** 10 (labelled "0") sits opposite 1, so opposite faces sum to 11.
- **Why no rotation exists:** rotations keep opposite faces opposite.

### d100: null

- **daggerheart `dice_100`:** the same geometry and layout as `dice_10`, times ten: 00 sits
  opposite 90, and 40 opposite 50.
- **Dicer's tens die:** 00 (value 10) sits opposite 10 (value 1).
- **Why no rotation exists:** rotations keep opposite faces opposite.

### d12: null

- **daggerheart faces 0 to 11:** 9, 1, 3, 7, 2, 8, 5, 11, 6, 12, 4, 10, with normals
  (0, ±0.851, ±0.526) and their cyclic permutations. Opposite faces sum to 13, as on Dicer.
- **Why no rotation exists:** the angle between faces 9 and 1 has cosine −0.447 on the model
  and +0.447 on Dicer.

### d20: null

- **daggerheart faces 0 to 19:** 18, 9, 8, 1, 15, 17, 4, 6, 20, 13, 12, 3, 7, 5, 19, 10, 11,
  2, 16, 14. Opposite faces sum to 21, as on Dicer.
- **Why no rotation exists:** the angle between faces 18 and 9 has cosine −0.333 on the model
  and −0.745 on Dicer.

## Why most types can't be verified, and what would fix it

The registered models share one numbering per type. It looks like a single model pipeline:
every d6 and d8 checked agrees face for face. That numbering differs from Dicer's own value
layout. Dicer pairs opposite faces in the order its shape builder lists them. That order is a
valid die, but it is not the arrangement these models use.

A single rotation can only re-aim the model. It can't renumber it. So for d4, d8, d10, d12, d20
and d100, no rotation is correct, and `null` (the procedural fallback) is the only honest
answer within this task's interface (a quaternion per type).

**Possible follow-up (not done here):** record a per-type table of the model's face normal for
each value, which this doc already has for daggerheart. Then force the model's own face for
value v to the landed direction, using a symmetry of the shape. Every one of these polyhedra is
face-transitive under rotation, so such a symmetry always exists. This would cover every type
whose model geometry matches Dicer's shape. d10 also needs the same kite proportions. The
model's face normals sit 47.9° from its axis and Dicer's sit 48.0°, so this is close, but it is
not exact.

## Unregistered files

`pf2e-ap200-seven-dooms-for-sandpoint/assets/models/d*.gltf` has node rotations and a 1e-4
scale.
- Its d6 numbering is the same die as the others, turned 90° about Y (+X 4, −X 3, −Y 1, +Y 6,
  −Z 5, +Z 2, after the node transform).
- No preset loads these files, so they are not evidence for the DSN layout. They do show that
  model axes are not universal, which is why a type is verified only across the files that
  presets actually register.
