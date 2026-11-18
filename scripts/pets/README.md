# Pet models built in code

Each pet is one script, `scripts/pets/build-<kind>.js`, exporting `build(options)`. It returns a
`THREE.Group` that follows [the pet model spec](../../docs/reference/pet-model-spec.md): a bone
tree from `root`, a textured skinned `Body`, vertex-coloured `Eyes`, face shape keys. The script
is exported to `assets/pets/<kind>.glb`. Dicer's loader (`src/pet/chunk/model-pet.js`) then moves
the bones and mixes the shape keys in code. `build-cat.js` is the reference: read it first.

The library is `scripts/pets/lib/`. Import it, don't edit it: other pets depend on it. If it lacks
something, add a helper in your own build script.

## The pipeline

1. **Shape as a distance field.** Smooth unions (`smin`) of ellipsoids, round cones and boxes,
   with details carved by `smax(d, -other, k)` (ear hollows, eye sockets). The bottom is cut flat
   with `smax(d, -y, 0.02)`. Keep a `parts(x, y, z)` function that returns each part's distance.
   It drives the skin weights and the painting, as well as the union.
2. **Mesh.** `buildShell(f, { lo, hi, grid, triangles, importance })` runs surface nets, projects
   every vertex onto the surface, decimates (the `importance` field above 1 keeps faces, ears and
   paws denser), relaxes, and takes normals from the field. The result is one fused, seamless
   shell.
3. **Face parts** inside `Body`: eyelid shells, the mouth's inside, a tongue, whiskers. The
   eyeballs go in `Eyes`.
4. **UVs.** `createAtlas` cuts the shell into charts by facing direction (none overlaps itself) and
   gives each extra part a rectangle, then packs everything into one 1024² texture.
5. **Weights and shape keys** per shell vertex (`appendShell` with your callback). Extra parts add
   their own.
6. **Paint from 3D.** Each texel knows its surface point, so the painter is a function of position
   and stripes run across seams. Field AO is baked in. Then `dilate`.
7. **Assemble.** `fitScale` and `assemble` make it 1.5 tall on y = 0 and bind everything to one
   skeleton.
8. **Export** in a browser with GLTFExporter, then `finishGlb` in node fixes the PNG and makes the
   shape keys sparse.

## Lib API (one line each; JSDoc in the files)

`lib/index.js` re-exports everything below except `export.js`, which is node-only.

| Module | What |
|---|---|
| `math.js` | `clamp sstep mix add sub scl dot cross len norm lerp3 rotateAbout DEG srgb toLinear hash vnoise fbm band`. Vectors are plain `[x,y,z]`. `sstep(a,b,x)` with a > b gives a falling edge. `band(v, duty)` makes periodic stripes. |
| `sdf.js` | Primitives: `sphere ellipsoid roundCone capsule roundBox torus plane`. Operators: `smin` (union), `smax` (intersect; subtract = `smax(a,-b,k)`). Frames: `frame(origin, up, front)` (with `.local .world .dir`), `inFrame(frame, fn, [sx,sy,sz])` to squash a shape (flat ears, beaks), `tiltFrame(center, tilt)` (the head frame: `fw` face→model, `fdir` vectors, `wf` model→face). Curves: `polyline(points)` (`.param(x,y,z)` arc length, `.lens`, `.total`), `coneChain([[x,y,z,r]...])` for tails and tentacles. Surface: `gradient project trace`. |
| `mesh.js` | `buildShell(f, {lo, hi, grid=0.02, triangles=5600, importance, relax=3})` returns `{pos, tris, nor}`. Lower level: `surfaceNets decimate relax fieldNormals`. `fieldAO(fSolid, pos, nor, {step, count, strength, min})` returns per-vertex 0..1. |
| `uv.js` | `createAtlas({size, pad})` with `.addShell(pos,tris)`, `.addRect(w,h)` (in model units), `.layout()`, `.shellUV(t,p)`, `.rectUV(id,u,v)`, `.rectPixels(id)`, `.chartOf(t)`. Lower level: `makeCharts pack`. |
| `skin.js` | `soft([[group, distance, tau]...])` gives soft shares; `weights()` is an accumulator with `.put(bone, w)` and `.done(boneIndex)` (top 4, normalised); `chain(w, share, s, bones, pivots, blend)` splits along a tail. |
| `rig.js` | `new MeshBuffer(keys)` with `.addVertex(p, n, uv, [[bone,w]], {key: delta}, col)`, `.P(i)`, `.tri`, `.grid(base, rows, cols, outFn)`, `.count`. `appendShell(buf, shell, atlas, (i,p)=>({weights, keys}))` returns the shell's triangles for painting (`buf.src[id]` is the shell vertex). Also `fitScale(buf, count, 1.5)`, `toGeometry`, `boneIndex(table)`, and `assemble({name, bones, body, eyes, map, fit, roughness, eyeRoughness, extra})`. |
| `paint.js` | `createCanvas(N)`, `paintShell(canvas, buf, shellTris, painter(p,n,ao,out), {pos, nor, ao})`, `paintRect(canvas, atlas, id, painter(u,v,out))`, `write(out, rgb, alpha)`, `dilate(canvas, 6)`, `toTexture(canvas, name)`. |
| `parts.js` | `placeEyes(fSolid, head, {r, x, y, yaw, open})` returns eyes. `carveSockets(d, x,y,z, eyes, radius)`. `surfaceAt(f, head)` maps face-local (qx,qy) to `{p,n}`. Parts, each with `.reserve(atlas)`, `.build(buf, atlas, weights)`, `.paint(canvas, atlas)`: `eyelids(eyes, {rUp, rLo, meet, motions, fur, lash})` (`LID_MOTIONS` is the default key table), `mouthInside(face, head, {y, shapes, colors, fangs})`, `tongue(face, head, {y, ...})`, `whiskers(face, head, {y, x, count, length, color})`. `eyeballs(eyes, {bones:{L,R}, irisColor(t,lit), pupil, iris, ...})` returns the `Eyes` MeshBuffer (with a `surprised` key that shrinks the pupils). |
| `export.js` (node) | `finishGlb(glb, {rgba})` returns `{glb, report}`. Also `decodePng encodePng parseGlb buildGlb`. |
| `index.js` | Re-exports, plus `REQUIRED_KEYS` and `ALL_KEYS` (the spec's 7 + `squint_L/R puff tongue`). |

## A minimal pet

```js
import * as L from './lib/index.js';
const { DEG } = L;
const HEAD = L.tiltFrame([0, 1.0, 0.05], 0.5); // face tilted up for the top-down camera
const BONES = [
  ['root', null, [0, 0, 0]], ['body', 'root', [0, 0.35, 0]], ['head', 'body', [0, 0.7, 0.05]],
  ['eye_L', 'head', null], ['eye_R', 'head', null],
];
const BI = L.boneIndex(BONES);

export function build({ texture = 1024, triangles = 5000 } = {}) {
  const head = L.ellipsoid([0, 0, 0], [0.42, 0.38, 0.38]);
  const torso = L.ellipsoid([0, 0.35, 0], [0.32, 0.35, 0.3]);
  const parts = (x, y, z) => ({ head: head(...HEAD.wf(x, y, z)), torso: torso(x, y, z) });
  const solid = (x, y, z) => { const p = parts(x, y, z); return L.smax(L.smin(p.head, p.torso, 0.1), -y, 0.02); };
  const eyes = L.placeEyes(solid, HEAD, { r: 0.13, x: 0.17, y: 0.04, open: 42 * DEG });
  const f = (x, y, z) => L.carveSockets(solid(x, y, z), x, y, z, eyes, 0.13 * 1.13);
  const shell = L.buildShell(f, { lo: [-0.6, -0.04, -0.6], hi: [0.6, 1.5, 0.6], triangles });
  const face = L.surfaceAt(f, HEAD);
  const extras = [L.eyelids(eyes), L.mouthInside(face, HEAD, { y: -0.12 })];
  const atlas = L.createAtlas({ size: texture });
  atlas.addShell(shell.pos, shell.tris);
  extras.forEach((e) => e.reserve(atlas));
  atlas.layout();
  const body = new L.MeshBuffer(L.ALL_KEYS);
  const tris = L.appendShell(body, shell, atlas, (i, [x, y, z]) => {
    const hv = L.sstep(0.62, 0.78, y); // head vs body
    const w = L.weights(); w.put('head', hv); w.put('body', 1 - hv);
    return { weights: w.done(BI), keys: {/* happy, sad, surprised, angry... deltas */} };
  });
  const n = body.count;
  extras.forEach((e) => e.build(body, atlas, [[BI.head, 1]]));
  const canvas = L.createCanvas(texture);
  const ao = L.fieldAO(solid, shell.pos, shell.nor);
  L.paintShell(canvas, body, tris, (p, nrm, a, out) => L.write(out, L.scl([0.8, 0.8, 0.8], a), 1),
    { pos: (i) => body.P(i), nor: (i) => shell.nor[body.src[i]], ao: (i) => ao[body.src[i]] });
  extras.forEach((e) => e.paint(canvas, atlas));
  L.dilate(canvas, 6);
  const bones = BONES.map(([b, par, p]) => [b, par, p ?? (b === 'eye_L' ? eyes[0].E : eyes[1].E)]);
  return L.assemble({ name: 'blob', bones, body, eyes: L.eyeballs(eyes, { bones: { L: BI.eye_L, R: BI.eye_R } }),
    map: L.toTexture(canvas, 'blob_basecolor'), fit: L.fitScale(body, n) });
}
```

## Conventions

- **Axes.** Y up, the pet faces **+Z**, `_L` is the pet's own left (+X). It is built in "design
  units" around 1.5 tall and scaled once at `assemble` (pass `fitScale(body, shellCount)` so the
  hidden lids and tongue don't count). The origin sits on the ground between the feet; nothing goes
  below y = 0.
- **Bones** (exact names): `root` (at the origin), `body` (hips), `head` (base of the skull),
  `eye_L/R` (eyeball centres, under `head`). Optional: `neck jaw ear_L/R tail_1..3 wing_L/R arm_L/R
  leg_*`. The loader turns bones in model space about their pivots, so bone axes don't matter; only
  pivot positions do. Its signs:
  - x is a nod; positive tips +Y toward +Z (a forward nod).
  - `ear > 0` tips ears forward.
  - `tailUp > 0` raises a back-pointing tail. A tail that curls forward on the floor (the cat's)
    dips its tip instead.
  - Arms raise forward.
  - Wings turn about z.
- **Shape keys** (exact names): `blink_L blink_R happy sad surprised mouthOpen angry`, plus optional
  `squint_L squint_R puff tongue`. Each is 0..1 and they must mix. Morphs are linear, so a rotation
  stored as a morph cuts a chord through the eyeball: see the eyelids below.
- **Tint mask.** Texture alpha is 255 where the player's colour applies; paint those areas a neutral
  light grey (about 0.8) with darker detail (stripes about 0.64×). Alpha is 0 where the painted
  colour stays (cream, pink, ink, horn, teeth). Give the pet's natural colour to the coordinator
  (the cat's is ginger `#e08a2c`).
- **Budgets.** At most 10,000 triangles in total (Body about 4–8k, Eyes about 2.3k as the cat
  has). Texture 1024² (one map, painted from 3D). The .glb must be at most 1.5 MB; the cat is
  1.12 MB.
- **Materials.** Body is a `MeshStandardMaterial` with a map, opaque. Eyes use vertex colours (an
  untextured material is never tinted). At most 3 materials.

## Tools (Vite dev server on http://localhost:5317 serving `C:/tmp/pet-gallery`; don't restart it)

- **View:** `node C:/tmp/pet-gallery/shotpage.mjs "pet-view.html?kind=<kind>&set=main" C:/tmp/pet-gallery/out/<kind>-main.png`.
  Then look at the PNG.
  - Sets: `main` (3/4, side, back, top, blue, natural, front, face), `poses` (crit, fumble, pet,
    sulk, huff, head turn, throw, startle), `faces` (face close-ups of the reactions), `more`,
    `mouth`, `tail` (side views of tail poses), `big` and `big2` (add `&s=560` for 2 large panels).
  - `&keys=happy:1,blink_L:1` with `set=one` forces shape keys.
  - `&glb=file` renders `assets/pets/<kind>.glb` instead of the live build; `&glb=<url>` renders any
    .glb (for example `/glb/dicer-pet-owl.glb`, the old code-built references). `&color=#hex` sets
    the tint.
  - It renders through Dicer's real loader (`createModelCreature` + `safe`).
- **Export:** `node C:/tmp/pet-gallery/pet-export.mjs <kind>` writes `assets/pets/<kind>.glb`
  (GLTFExporter in Chromium, then `finishGlb`) and prints the size, triangles, nodes and keys.
- **Texture dump:** `node C:/tmp/pet-gallery/pet-tex.mjs <kind>` writes `out/<kind>-tex.png` and
  `-alpha.png` (the mask) to inspect the atlas.
- **Test:** write `tests/unit/pet-<kind>-model.test.js` using the shared checks (see
  `pet-cat-model.test.js`):
  ```js
  import { build } from '../../scripts/pets/build-owl.js';
  import { petModelChecks } from '../helpers/pet-model-checks.js';
  petModelChecks('owl', build, { bones: ['wing_L', 'wing_R'] });
  ```
  Run `npx vitest run tests/unit/pet-<kind>-model.test.js --reporter=default` and
  `npx eslint scripts/pets/build-<kind>.js`. Don't run the whole suite.
- Build scripts must run under node (vitest), so no DOM: the texture is a `DataTexture`. The cat
  builds in about 2 s.

## Lessons learned (from the cat)

- **The alpha-0 PNG wipe.** GLTFExporter writes textures through a 2D canvas, which premultiplies.
  Every texel with alpha 0 (every untinted, painted area) exports **black**. `finishGlb` detects it
  and re-encodes the PNG losslessly: always export with `pet-export.mjs`. GLTFLoader in Chrome and
  Firefox reads PNGs with `premultiplyAlpha: 'none'`, so the colour survives loading.
- **Sparse morphs.** GLTFExporter writes dense morph targets, about 50 KB each for a 4.5k-vertex
  Body. Most entries are zero; sparse accessors saved 410 KB on the cat. `finishGlb` does this too.
- **Tilt the face up** (`tiltFrame(center, 0.45–0.6)`). Dicer's default camera looks straight down;
  a face looking straight ahead shows only the top of the head and hooded eyes. The cat uses 0.52:
  eyes readable from above, still cute at the angled 3/4 view. Check both (`top`, `top2`, `q`).
- **Eyes = eyeball + socket + lid shells.** Carve a socket (`carveSockets`, radius 1.13× the eye)
  so the lids have room. `placeEyes` sets the depth so about 42° of the eyeball shows above its
  centre. The lids are spherical lunes slightly larger than the eyeball (1.10× upper, 1.065× lower),
  hidden in the socket at rest, that turn about the eye's X to close.
  - Morphs are linear, so a turn of θ moves along a chord whose middle sits at R·cos(θ/2). Keep
    θ ≤ ~55° and R ≥ 1/cos(θ/2) × the eyeball radius, or a half-closed lid sinks into the eye. Both
    lids therefore close to meet near the middle.
  - Lid normals are the closed normals, because the lids are only seen closed.
- **Eyeliner on the eyeball**, not on the skin. A dark band on the eyeball just outside the iris
  shows only round the opening. A dark-painted socket rim made the closed eyes look like goggles.
- **Skin keys near the mouth must slide along the surface** (`project(f, p + d) - p`). Otherwise the
  skin pokes through the mouth's inside when it opens.
- **The mouth's inside is a disc collapsed behind the lips.** Each key gives it a target oval laid
  on the surface, offset about 0.009 outward. The painted mouth line stays on the skin above it.
- **Don't band by distance from a part's centre** on its own surface: every surface point sits at
  the same normalised distance, so you get one huge blotch (the cat's thighs did). Band by height,
  angle or arc length instead.
- **AO from the field** looks dirty if strong. Keep it gentle (`min 0.74`) and compute it on the
  field *without* sockets.
- **Weights:** split head and body with a soft plane at the neck rather than by distance, or the
  chin lags behind head turns. Put the seat and feet on `root` (via `sstep(0.2, 0.05, y)`) so the
  body leaning doesn't push them through the floor.
- **Check every pose from the side** (`set=tail`) for floor penetration: tails, paws, sulk squash.
- Vite caches `/@fs` modules: the tools add `?v=<time>` to the import, so edits show up.
