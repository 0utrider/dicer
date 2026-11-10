# Sign-off measurements (Plan 2, Task 9; spec G2)

## How they were taken
- **Machine:** the owner's gaming PC.
- **GPU path:** `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)`. This is the hardware GPU path; SwiftShader was not used.
- **Browser:** Playwright Chromium, headless, with flags `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist --disable-gpu-vsync --disable-frame-rate-limit`.
  - vsync and the frame-rate limit are off, so the rAF interval shows the real frame cost instead of the 16.7 ms display interval.
- **Script:** `node tests/visual/measure.mjs`. Raw output is in `artifacts/visual/measure.json`. A HiDPI rerun (`DSF=2 THROWS=2`) is in `artifacts/visual/measure-dsf2.json`.
- **Throws** use `dev/preview.html?look=galaxy-nebula&tier=<tier>` with real physics (worker plus wasm).
  - Each throw is 10 dice, cycling d4, d6, d8, d10, d12, d20.
  - One warm-up throw (shader compile) comes first, then 3 measured throws per tier.
  - Each throw runs until it lands, plus a 1 s linger and the fade.
- **Two metrics per throw:**
  - **Frame time:** the renderer's own `onFrameTime`, which is `max(tick + render CPU time, rAF interval capped at 100 ms)` (P2-R10). The adaptive quality controller sees exactly this number.
  - **GPU time:** `EXT_disjoint_timer_query_webgl2` around every `renderer.render`.
- **Reported p95:** the worst p95 of the measured throws, with the mean of the runs' p95 in brackets.

## 1. Full-screen per-pixel interior cost
The die is one galaxy-nebula d20, its bounding sphere filling 70% of the viewport height. Each figure covers 120 frames; GPU time is per frame (timer query), and wall time includes a readback each frame.

| Tier (march steps) | Buffer | GPU p50 | GPU p95 | Wall p50 | Wall p95 |
|---|---|---|---|---|---|
| medium (16) | 1920×1080 (DPR 1) | 0.33 ms | 0.34 ms | 0.70 ms | 1.20 ms |
| high (32) | 1920×1080 (DPR 1) | 0.60 ms | 0.61 ms | 0.90 ms | 1.60 ms |
| ultra (48) | 1920×1080 (DPR 1) | 0.86 ms | 1.28 ms | 1.20 ms | 1.90 ms |
| medium (16) | 2880×1620 (×1.5) | 0.66 ms | 0.67 ms | 1.00 ms | 1.60 ms |
| high (32) | 2880×1620 (×1.5) | 1.20 ms | 1.83 ms | 1.50 ms | 2.30 ms |
| ultra (48) | 2880×1620 (×1.5) | 1.75 ms | 2.23 ms | 2.10 ms | 3.00 ms |

Cost scales roughly linearly with the step count and with the pixel count. Here, ×1.5 is the high tier's pixel ratio, and it is also the default `pixelRatioCap`.

## 2. 10-die galaxy-nebula throw, p95 per tier
Viewport 1920×1080 at deviceScaleFactor 1, so every tier runs at pixel ratio 1.

| Tier | Frames | Frame p50 | Frame p95 | GPU p95 |
|---|---|---|---|---|
| low | 40,167 | 0.40 ms | 0.60 ms (0.60) | 0.15 ms |
| medium | 34,902 | 0.40 ms | 0.60 ms (0.60) | 0.15 ms |
| high | 48,907 | 0.30 ms | 0.50 ms (0.43) | 0.26 ms |
| ultra | 44,108 | 0.20 ms | 2.10 ms (1.80) | 0.37 ms |
| **medium, 4× CPU throttle** | 15,267 | 0.90 ms | **1.30 ms (1.23)** | 0.14 ms |

HiDPI rerun at deviceScaleFactor 2, so each tier's own pixel ratio applies (capped at 1.5):

| Tier | Buffer | Frame p95 | GPU p95 |
|---|---|---|---|
| low | 1920×1080 @1 | 0.70 ms | 0.15 ms |
| medium | 2400×1350 @1.25 | 0.70 ms | 0.18 ms |
| high | 2880×1620 @1.5 | 0.70 ms | 0.49 ms |
| ultra | 2880×1620 @1.5 | 2.80 ms | 0.78 ms |
| medium, 4× CPU throttle | 2400×1350 @1.25 | 1.40 ms | 0.18 ms |

The ultra frame p95 of about 2–3 ms sits above its GPU time. My reading is that it comes from the 512² PMREM environment and the main-thread cost of the larger buffer. I did not profile it, and it is far below every budget.

## 3. Pass / fail against the targets
| Target | Measured | Result |
|---|---|---|
| high p95 ≤ 8 ms on the owner's GPU | 0.50 ms frame p95 (0.70 ms at HiDPI ×1.5); GPU p95 0.26–0.49 ms | **PASS** (about 11× headroom) |
| medium p95 ≤ 16.7 ms at 4× CPU throttle (low-end estimate) | 1.30 ms frame p95 (1.40 ms at HiDPI) | **PASS** |

No tier needed fewer march steps or noise octaves, so the tier table is unchanged.

## Caveats (read before trusting the low-end estimate)
- **The throttle is CPU only.** CDP `Emulation.setCPUThrottlingRate` slows the main thread. It does not slow the GPU, and it does not slow the physics worker in the same way.
  - The 4× medium figure is therefore a CPU-side low-end estimate with a fast GPU behind it.
  - A real iGPU's per-pixel cost needs the full-screen table, scaled by the GPU's relative fill rate.
  - Example: an iGPU about 15× slower than this card would cost about 10 ms GPU at medium full-screen ×1.5, which is still under 16.7 ms. Ultra at ×1.5 would come to about 33 ms, and that is why iGPUs must stay off ultra; the probe already maps them lower.
- **Headless frame times are not presentation times.** With vsync off, headless Chromium runs rAF far faster than a display would, so the many cheap frames dominate the counts. The GPU timer column is the per-render cost a real display would also pay.
- **Die size.** At the in-play die size (about 48 CSS px, 10 dice), the interior covers few pixels, so the throw cost is dominated by fixed per-frame work. The full-screen table is the worst case.
