# webgpu-webgl-benchmarks

A reproducible benchmark of **three.js**, **PlayCanvas**, **Babylon.js** and **PixiJS 3D** on WebGPU and WebGL2, plus **Babylon Lite** on WebGPU, across Chrome, Safari and Firefox.

**Full interactive report:** https://endel.github.io/webgpu-webgl-benchmarks/. The current five-engine comparison is published from `docs/index.html`.

**Fresh five-engine comparison:** [docs/index.html](docs/index.html). A new representative WebGPU session on Apple M4 Pro / 24 GB / macOS 26.6.2, using the in-app Chromium 157 on Apple/Metal. All five engines were remeasured in the same session: 72 of 80 combinations are valid, seven are N/A and one fails. PixiJS 3D has 11 valid combinations and five explicit N/A paths; Babylon Lite has all 16 valid. Every valid combination has three timing repeats and separate counters/captures, with 100% GPU-sample coverage and no GPU validation errors or pipelines compiled during measurement. The report embeds 62 representative images and offers the raw runs for download. No older Chrome 153 or original-reference measurements are mixed in. The browser is display-rate limited, so compare CPU/GPU cost rather than FPS.

To reproduce this report's selection and export a completed session:

```sh
node --import tsx scripts/run.ts --browser manual --profile full --representative --only 'engine=three,playcanvas,babylon,babylon-lite,pixi3d;backend=webgpu' --port 5191 --restart-every 0
# Open the printed OPEN_BROWSER URL; record machine/browser details in the session's environment.json.
node --import tsx scripts/report-four-engines.ts <session-folder>
```

## Results

The published results below predate the Babylon Lite and PixiJS 3D adapters. They do not include measurements of either.

three.js r186, PlayCanvas 2.22.2 and Babylon.js 9.26.0 were measured in Chrome 151, Firefox 150 and Safari 26.6 on an Apple M1 Pro (macOS 26.6), about 2,200 runs in all. Numbers are Chrome on WebGPU unless noted.

| Workload | Winner | Numbers |
|---|---|---|
| Many separate animated meshes | **PlayCanvas** | 12 ms CPU at 5k meshes vs 24 ms (Babylon.js) and 29 ms (three.js); 60 fps up to ~6.3k meshes vs 3.2k and 2.8k. Leads in every browser |
| Many materials | **PlayCanvas** | 13 ms vs 30 ms (three.js) and 41 ms (Babylon.js) at 100 materials |
| Instanced meshes (engine fast paths) | Tie | 1.1–2.3 ms CPU for 50k meshes; all engines hold 60 fps in every browser |
| Mass instancing, 500k | three.js / Babylon.js | ~1.3 ms CPU vs ~5 ms (PlayCanvas); same GPU time |
| Many lights, forward | **PlayCanvas** | 1.3 ms GPU vs 53 ms (three.js) at 32 lights; Babylon.js caps at 8 forward lights on WebGPU |
| Many lights, clustered (512) | PlayCanvas in Chrome | 15 ms vs 115–168 ms; Safari narrows it to 44–62 ms for all three |
| Shadows + post-processing | **PlayCanvas** | 21 ms CPU vs 52 ms (three.js) and 78 ms (Babylon.js) |
| Skinned characters | Tie; PlayCanvas on joint-heavy models | 12–14 ms for 500 Fox; BrainStem ×50: 6.5 ms vs 18–22 ms |
| Skinning fast path | **Babylon.js** (only one) | Baked vertex animation: 500 characters in 0.1 ms CPU, per-character phases kept |
| Compute, 1M particles | Tie | ~7 ms GPU in all three |
| Startup and bundle size | **three.js** | 166 KB brotli, ~100 ms to first frame (PlayCanvas 202 KB, ~100 ms; Babylon.js 279 KB, 330 ms) |
| Consistency across browsers | three.js / PlayCanvas | Babylon.js's per-object path costs ~4× more CPU in Safari |

### Takeaways

1. **Instance anything you repeat.** It cuts CPU cost 10–100× and makes the engine choice nearly irrelevant. The engines differ most on per-object meshes.
2. **WebGPU isn't automatically faster.** Without instancing, PlayCanvas and Babylon.js ran faster on WebGL2, and three.js's classic WebGLRenderer (7 ms) beat its WebGPURenderer (29 ms). WebGPU wins on instanced paths.
3. **Past ~8 lights, use clustered lighting.** Babylon.js's forward path stops at 8 lights on WebGPU. three.js's grows with every light and hits Safari's shader limits at 32. PlayCanvas's skips lights that don't reach the pixel.
4. **Test Safari early.** It rejects large shaders, three.js's `compileAsync` can hang there, and Babylon.js is slowest there. It also caps at 60 fps, so compare CPU and GPU time, not fps.
5. **Firefox can't time the GPU.** Firefox 150 loses the device when render passes carry timestamp writes, so use Chrome or Safari for GPU profiling.

**Which to pick:**
- **PlayCanvas** has the best raw WebGPU performance.
- **three.js** is the smallest and fastest to start, with the biggest ecosystem. Instance heavily.
- **Babylon.js** has the richest built-in fast paths (thin instances, baked animation, clustered lighting, snapshot rendering), but it's the heaviest per object and weakest in Safari.

All numbers come from one machine. Other GPUs and operating systems will rank differently.

Every engine renders the same deterministic scenes: identical geometry, transforms, materials, lights and camera, all generated from a seeded RNG. The harness owns the only `requestAnimationFrame` loop, and every page load measures exactly one configuration.

## Quick start

```sh
npm install
npm run fetch-assets                                    # Khronos Sponza, Fox, BrainStem → public/assets
npm run bench -- --browser chrome --profile smoke       # correctness pass, ~5–10 min
npm run bench -- --browser chrome --profile quick       # one repeat, Chrome only
npm run bench -- --browser chrome,firefox,safari --profile full
npm run bundle-size                                     # results/bundle-size.json
npm run report                                          # report/out/index.html
```

`npm run dev` serves `index.html`, which links every scenario in *standalone* mode: the scene renders continuously with a live HUD and nothing is recorded.

### Babylon Lite

The separate `babylon-lite` adapter pins the official [`@babylonjs/lite`](https://github.com/BabylonJS/Babylon-Lite) package to **1.36.0**. It uses Lite's native engine, scene, PBR, glTF loader, thin instances and clustered lights. It does not wrap Babylon.js. Lite is WebGPU-only; the runner and landing page exclude its WebGL2 combinations.

```sh
npm run bench -- --browser chrome --profile smoke --only "engine=babylon-lite;backend=webgpu"
npm run bench -- --browser chrome --profile full --only "engine=babylon-lite;backend=webgpu"
npm run bundle-size
# Partial sessions must be selected explicitly (use the folder printed by the runner):
npm run report -- --sessions <session-folder>
```

| Scenario | Lite adapter coverage |
|---|---|
| S0 / S1 / S2 | Native mesh clones sharing geometry; S1 optimized groups thin instances by geometry/material |
| S3 | Thin instances; uploads the shared matrices every frame |
| S4 optimized | Native clustered point lights, including the reference range-windowed attenuation |
| S7 | Native glTF loader and the same scripted camera |
| S4 naive | Native forward point lights; inverse-square falloff differs from the clustered/glTF range window |
| S5 / S6 | Four CSM cascades + four PCF spot maps; S6 uses linear HDR with 4× MSAA, native bloom, then ACES |
| S8 / S8b | Independent native skeleton controllers with shared geometry/materials; S8 optimized uses native VAT and per-instance phases |
| S9 | Shared reference compute integration, storage buffers, one instanced billboard draw and hardware MSAA resolve |

All registered WebGPU scenarios now have Lite implementations. Native forward lights use inverse-square attenuation without the glTF smooth range window, and spotlights have no separate inner-angle/penumbra control. Those native shading differences are recorded in the run notes; they are not claimed to be pixel-identical lighting comparisons. The procedural scene is reflected into Lite's left-handed world, with corrected winding, reflected camera/lights and unchanged instance matrix uploads. The glTF loader's X reflection is normalized to that same Z reflection, preserving authored child transforms and character placement. The harness owns the only animation loop.

Lite 1.36.0 drops PCF receivers when a material also receives CSM, while still binding their textures. `server/lite-compat.ts` fixes that composition at build time by merging Lite's native fragments in light order. Both regular builds and bundle measurements apply the same fix; no files under `node_modules` are modified. Regression checks: `node --import tsx --test tests/babylon-lite.test.ts`.

Character clones share the template geometry/materials. Texture-free native GLB loads supply independent skeletons/controllers; their temporary geometry and unused textures are retired before rendering. The optimized path bakes the native bone textures once and supplies every instance's phase explicitly. Compute particles share the exact WGSL integration with the Babylon.js adapter.

Bundle measurements include a separate minimal lit-cube app. `initial` means the static import graph; `total` also includes reachable dynamic imports. Lite loads rendering features lazily, including during scene registration, so `initial` alone is **not** the number of bytes needed for the first frame.

Integration validation (2026-10-22): production builds in Chrome for Testing 153 on Apple/Metal, 1920×1080 and MSAA 4×. All 16 representative Lite combinations passed: 48 timing runs of 240 measured frames each, 100% GPU-sample coverage, no GPU errors and no pipelines compiled during measurement. This includes 32 forward/clustered lights, shadows/bloom with 2,000 objects, 50 Foxes with independent skinning or phased VAT, 50 BrainStems and one million compute particles. Separate counters and frame-60 captures accompany each combination. Native light capacity stays at its default 16 except where the scene requires more forward lights, configured before scene creation. The report uses only the completed session `2026-10-22T09-36-43-manual-full-p5187`; earlier smoke tests and an abandoned configuration are excluded. Firefox, Safari and upper ladder levels still need benchmark sessions.

### PixiJS 3D

The `pixi3d` adapter uses the public npm release **`@pixi/3d` 0.1.0** with **`pixi.js` 8.23.0**, on WebGPU and WebGL2, following the [installation guide](https://pixijs.com/3d/guides/getting-started/installation) and the [current agent guide](https://github.com/pixijs/3d/tree/main/skills/pixijs-3d). Both versions are pinned in `package.json` and resolved from npm in the lockfile. This is the PixiJS team's 3D extension, distinct from the older `pixi3d` package.

```sh
npm run bench -- --browser chrome --profile smoke --representative --only "engine=pixi3d"
npm run bench -- --browser chrome --profile full --only "engine=pixi3d"
npm run bundle-size
npm run report -- --sessions <session-folder>
node --import tsx --test tests/pixi3d.test.ts
```

| Scenario | PixiJS 3D adapter coverage |
|---|---|
| S0 / S1 naive / S2 | Native `Mesh3D` nodes sharing geometry/materials; retains the engine's automatic batching |
| S1 optimized | Native `BatchedMesh3D`, updating the shared scene's transforms in bulk |
| S3 | Native `BatchedMesh3D`, uploading every reference matrix on every frame |
| S4 optimized, 8 / 32 lights | Native tiled lighting: 16×9 screen tiles and 32 depth bins |
| S4 naive / optimized above 32 lights | N/A: no untiled forward path; non-ambient lights are capped at 32 |
| S5 / S6 | N/A: one shadow-map resolution per view; reference requires 2048px CSM maps and 1024px spot maps |
| S7 | Native glTF loader and `Model3D`, with the shared scripted camera |
| S8 naive / S8b | Independent native skeletons and animation states; shared model resources and deterministic per-character phases |
| S8 optimized / S9 | N/A: no adapter path for phased baked animation or the reference compute particle simulation |

The harness owns rendering; the application ticker and automatic animation playback are disabled. Linear scene colors are converted to the API's sRGB inputs, and procedural lights are scaled by π to account for native Lambert normalization. Missing glTF normals (including Fox) are generated as flat face normals once on the shared source, preserving UVs, skin weights and joint indices. Unsupported workloads throw explicit `N/A:` errors before scene allocation, so light or shadow limits never silently reduce a workload. The landing page, run queue, generated report and bundle-size comparison include PixiJS 3D. Published historical reports are unchanged.

Validation (2026-11-13): TypeScript, production builds and regression checks pass. Completed session `2026-11-13T10-10-27-manual-full-p5191` measured all five engines in Chromium 157 on the Apple M4 Pro. PixiJS 3D has 33 valid timing runs over 11 combinations, 11 separate counters runs and frame-60 captures, 100% GPU-sample coverage, no GPU validation errors and no pipelines compiled during measurement. Five unsupported paths are explicitly N/A. The [comparison](docs/index.html) includes its measured CPU/GPU times, draw/upload counters, startup, bundle footprint and representative captures. Larger loads, Firefox, Safari and WebGL2 still require benchmark sessions.

### Runner options

| Flag | Meaning |
|---|---|
| `--browser chrome,firefox,safari` | Sessions run one after another, one results folder each |
| `--profile smoke\|quick\|full` | `smoke` runs every cell once in counters mode and takes screenshots. `quick` is one timing repeat plus counters. `full` is three timing repeats plus counters |
| `--only "engine=three,babylon;scenario=s1;backend=webgpu"` | Filter the matrix by `engine`, `backend`, `scenario`, `variant` or `level` |
| `--opt <name>` | Force a named optimized-path candidate on optimized runs |
| `--repeats N` | Override the profile's repeat count |
| `--port N` | Serve on another port. Each port builds into its own `dist-N`, so runners can run side by side |
| `--representative` | Run S1 at 1k/5k meshes and one representative load per other scenario, retaining all rendering paths |
| `--no-gpu-timing` | Skip timestamp-query injection |
| `--no-build` | Reuse the last build |

**Browser setup.**
- **Manual** (`--browser manual`) prints an `OPEN_BROWSER` URL for an externally managed browser. The runner still controls the queue; open each printed URL when a restart is requested, and close your tab afterwards. Use `--restart-every 0` to keep a single tab for the session. Record browser flags and display-rate limits when comparing results.
- **Chrome** runs from its installed binary with a throwaway profile, with vsync and the frame-rate limit disabled and unquantized WebGPU timestamps enabled.
- **Firefox** runs with a throwaway profile set to `layout.frame_rate=0` and full-resolution timers.
- **Safari** is opened with `open -a Safari`. Keep its window frontmost and dismiss any first-run or automation prompts before a session.

A watchdog restarts the browser if a run goes silent for 150 s (`--timeout`). Cells slower than 250 ms per frame stop measuring after 5 frames.

## Layout

```
bench.html / index.html      run page / landing page
src/harness/                 frame loop, WebGPU + WebGL probes, scene data, matrix, stats
src/engines/<engine>/        one EngineAdapter per engine, one file per scene kind
src/minimal/<engine>.ts      smallest lit-cube app per engine (bundle size only)
server/api.ts                run queue + result sink (Vite middleware)
scripts/                     fetch-assets, run, bundle-size, report
results/<session>/           results.jsonl (one line per run) + screenshots
report/                      template.html, findings.json + generated out/
docs/index.html              published copy of the report (GitHub Pages)
```

## Scenarios

| | Scenario | Ladder | Paths |
|---|---|---|---|
| S0 | Startup: minimal lit cube | — | naive |
| S1 | Unique animated meshes, 8 geometry types | 1k → 50k | naive, optimized |
| S2 | 5k meshes over M materials | 10 → 1000 | naive |
| S3 | Instancing with per-frame matrix upload | 10k → 500k | optimized |
| S4 | PBR + moving point lights | 8 → 512 (forward stops at 32) | naive (forward), optimized (clustered) |
| S5 | 4-cascade sun shadow + 4 spot shadows | — | naive |
| S6 | S5 through bloom + ACES post | — | naive |
| S7 | Sponza load + fly-through | — | naive |
| S8 / S8b | Skinned Fox / BrainStem characters | 10 → 500 / 10 → 50 | naive (+ optimized for S8) |
| S9 | Compute particles (WebGPU only) | 100k → 1M | — |

The ladders stop short of the levels that saturate the GPU for seconds per frame: forward lighting past 32 lights, 4M particles, 200 BrainStems and 1M instances. On a laptop those freeze the whole desktop mid-run, because macOS composites on the same GPU. The levels live in `src/harness/matrix.ts`.

**Paths.**
- *Naive* uses each engine's default scene graph and settings.
- *Optimized* uses the fastest documented fast path for the same visual result. Each run records the path it used.
- A cell whose engine has no such path fails with `N/A: …`, and is reported as not applicable.

## What is measured

- **CPU time:** `performance.now()` around the engine's update and render call. The shared scene simulation is timed separately and excluded.
- **GPU time:** measured by an engine-agnostic probe that patches the WebGPU prototypes before any engine loads.
  - The probe adds `timestamp-query`, writes timestamps around every pass (never mutating the engine's own descriptors) and resolves them asynchronously, so there are no stalls.
  - The probe records two readings per frame. The *span* runs from the first pass start to the last pass end, and it counts idle gaps when an engine submits passes while the CPU is still building the frame. The *sum* adds up individual pass durations, and it double-counts passes that overlap on tile-based GPUs.
  - The report's GPU time is the smaller of the two, since true busy time can't exceed either.
  - With vsync and the frame-rate limit off, Chrome and Firefox let JavaScript run ahead of the GPU (commands queue in the GPU process). Their frame interval then reflects CPU-side throughput, and GPU time is the GPU cost. Safari's capped loop stays coupled to the GPU, which makes it the cross-check for GPU-heavy scenes.
- **Render cross-check:** any run in another browser that issues fewer than half of Chrome's draw calls for the same cell is reported as failed. A shader can fail without raising a GPU error, leaving healthy-looking timings for an empty frame.
- **Load and startup times** use the fastest repeat, since the first load of an asset hits a cold HTTP cache.
- **Frame interval:** real throughput where the browser is uncapped.
- **Frame cost** = max(CPU p95, GPU p95). It's independent of vsync, and it drives the "max N at 60 fps" figure.
- **Counters run:** a separate run that wraps the hot calls (draws, `setPipeline`, `setBindGroup`, `writeBuffer`, submits), tracks live buffer and texture bytes, and cross-checks draw counts against the engine's own stats.
- **Startup:** import, init, load, first frame and time-to-first-frame. Also JS heap and any pipelines created mid-measurement, which flag the run.

**Protocol.**
- Warm-up runs until no new pipeline has appeared for 30 frames (at least 90 frames and 1.5 s).
- Measurement covers at least 240 frames and 3 s (capped at 15 s for very slow levels), repeated as separate page loads; the median is reported.
- Counters runs measure 1 s, since they only need per-frame call medians.
- Engine order is shuffled within each block.
- A canary cell reruns periodically to detect thermal drift.
- A ladder stops climbing once a level takes more than 100 ms per frame.

**Fairness.**
- Every engine renders at 1920×1080 device pixels, with 4× MSAA, ACES tone mapping, sRGB output and an opaque canvas, from production builds.
- Light units are calibrated so screenshots match: three.js and Babylon.js divide Lambert diffuse by π, PlayCanvas does not.

## Known caveats

- Results come from one machine per session; the reference runs are on an Apple M1 Pro under macOS 26. Other GPUs and OSes rank differently.
- Safari cannot be uncapped, so its frame interval is the display rate; CPU and GPU times carry the comparison there.
- Firefox 150 (wgpu on Metal) invalidates the device when render passes carry `timestampWrites`, so Firefox runs without GPU timing.
