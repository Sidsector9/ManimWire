# Renderer performance investigation — updated 2026-09-28

This records the earlier optimization pass. The subsequent
[pipeline redesign](pipeline-redesign.md) replaces production PNG previews,
per-step playback executions and transient mesh buffers. Its measurements and
remaining limitations supersede the corresponding items below; the historical
measurements here are retained for comparison.

OpenGL is using the Apple M3 Pro GPU. The disappointing performance was largely
caused by editor overhead and Python geometry work around GPU drawing. Several
of those costs are now removed. This does not guarantee that OpenGL will beat
Cairo on every scene or computer.

## Application measurements

All timings below are milliseconds, lower is better. These are uncached engine
requests, including generation, construction, animation, GPU readback, selection
bounds and PNG output. They exclude RPC, Electron and UI scheduling delay.
Sequences cover the first second at 30 fps; previews request t = 0.75 s.

Apple M3 Pro, OpenGL 4.1 Metal, Python 3.12, bundled Manim CE 0.21.0 at
`861cd4849b17db1db3515b531ffe80b297848f93`. Six samples per case, each using a
fresh service and frame cache; median of samples 2–6. The catalogue/probe are
warm; the first OpenGL sample includes context initialization. Subsequent
samples reuse the context and shaders, as the application now does. Manim's
text cache and OS caches may also be warm. This is not a cold-start test.

Latest 960 × 540 run:

| Request | OpenGL before this investigation | OpenGL now | Cairo now |
|---|---:|---:|---:|
| Circle: 30 playback frames | 223.9 | 242.6 | 120.0 |
| 3D surface: preview | 1,014.2 | 167.0 | 328.9 |
| Coordinate-system example: preview | 860.5 | 152.6 | 158.3 |
| Sine-curve example: 30 playback frames | Not measured | 296.2 | 186.6 |
| Opening example: 30 playback frames | Not measured | 877.9 | 1,432.1 |

The surface request improved about **6.1×** and the coordinate-system request
about **5.6×** versus the preceding OpenGL implementation. The surface is about
**2× faster than the updated Cairo path**. Cairo also benefits from shared fixes.
The coordinate comparison between renderers is too close and variable to claim
a reliable OpenGL advantage.

These are developer-desktop measurements, not an isolated lab. A first complete
post-change run measured OpenGL at 153.5 ms for the circle, 166.6 ms for the
surface, 132.6 ms for coordinates, 267.2 ms for sine and 801.8 ms for opening.
The repeat above was materially slower for some cases despite identical code.
Other desktop applications remained active. The circle does **not** show a
reliable improvement against the baseline, and neither circle nor sine beats
Cairo. Both runs are recorded rather than choosing only favorable results.

Latest 1920 × 1080 run:

| Request | OpenGL | Cairo |
|---|---:|---:|
| Circle: 30 playback frames | 477.1 | 394.5 |
| 3D surface: preview | 194.9 | 372.1 |
| Coordinate-system example: preview | 162.4 | 180.3 |

Raw samples, first-sample times, intermediate experiments and preview file sizes
are in [render-performance.json](render-performance.json). The earlier
selection-bounds investigation is retained there too: avoiding redundant Manim
renderer configuration reduced a circle sequence from 396 ms to 213 ms in that
earlier run. Those historical measurements are not substituted for this turn's
baseline.

## What was wrong, and what changed

1. **A global Python profiling callback ran throughout every scene.**
   `run_scene` installed `sys.setprofile` just to capture `construct` locals.
   Our Python callback ran for Python and C call/return events throughout
   geometry building, copying, NumPy operations and animation. The engine now
   injects one `finally` callback into the compiled construct method. It captures
   locals on normal return and early scrub termination, preserves source line
   mappings, and leaves profilers/debuggers alone. Exported source is unchanged.
   Removing this alone measured OpenGL surface 1,014 → 428 ms and coordinates
   861 → 346 ms, before the other changes.

2. **Every request created a context and discarded compiled shaders.**
   `GLResources` now owns one context for the serial engine thread, retaining
   shaders and the framebuffer. Resolution changes replace the framebuffer and
   attachments. Per-scene textures are explicitly owned/released; abandoned
   resources are collected with the context current, including after errors.
   Shutdown releases persistent resources. Cleanup accounts for ModernGL 5.12
   queuing already-released resource sentinels in context GC.

3. **OpenGL previews constructed the entire scene twice.**
   The first pass obtained animation boundaries for skipping. The renderer now
   uses each animation's duration as it begins to skip completed plays during
   the actual run. Static previews likewise avoid the redundant pass. Timeline
   layout is still a separate request.

4. **Surface construction repeatedly traversed an expanding hierarchy.**
   Public Surface added faces one at a time. OpenGL refreshes the group's family
   and updater/bounds information on each insertion: quadratic repeated traversal
   in the number of faces. The scoped adapter inserts faces together, preserving
   points, ordering, indices and styling. It keeps the public vector-face API.
   An exact rendered-pixel test compares both construction paths.

5. **Cairo's timing-only pass sometimes drew a static scene.**
   `TimingRenderer.scene_finished` now does nothing. This fixes unnecessary work
   and keeps the Cairo comparison honest rather than retaining a slow baseline.

6. **Disposable previews used default PNG compression.**
   Preview files now use compression level 1: still lossless, with larger files
   in exchange for lower encoding cost. Export encoding is separate. This is a
   modest improvement, not the main source of the surface speedup.

7. **Scrubbing incurred an unconditional 150 ms UI debounce.**
   An unchanged scene now requests its preview on the next display frame.
   Existing request coalescing still keeps only the latest pending request.
   Document edits retain their debounce. This removes scheduling delay; it does
   not promise that a complex uncached frame can render in one display frame.

## Why a GPU cannot guarantee a faster complete request

OpenGL is an API, not a promise that all work runs on a GPU. Python graph
execution, text layout, object copies, path preparation, animation updates and
image encoding still use the CPU. GPU drawing also entails CPU submission and
synchronization costs. Cairo can win when its drawing workload is small enough
that GPU pipeline costs exceed rasterization savings. Software OpenGL further
precludes a universal hardware-independent guarantee.

This matches NVIDIA's guidance to find the limiting pipeline stage first,
including CPU draw-call overhead, rather than assume rasterization is the limit.
[NVIDIA: Graphics Pipeline Performance](https://developer.nvidia.com/gpugems/gpugems/part-v-performance-and-practicalities/chapter-28-graphics-pipeline-performance)

In an intermediate profiled circle sequence after context reuse, PNG encoding
occupied about 84 ms of 164 ms, readback about 22 ms, and OpenGL draw calls about
22 ms. These are instrumented wall-clock costs, not isolated GPU kernel timings;
they precede the PNG compression change. Instantaneous GPU drawing would still
leave most of that request.

OpenGL queues work asynchronously. Timing submission alone would make the GPU
look deceptively fast; our request timer includes completed pixel readback and
PNG files. GPU-specific measurements would require timer queries.
[Khronos: Performance](https://wikis.khronos.org/opengl/Performance),
[Khronos: Query Objects](https://wikis.khronos.org/opengl/Query_Object)

## Remaining work, ranked by architectural impact

1. **Keep scene state between scrub requests.** An uncached scrub still rebuilds
   geometry and simulates part of the current animation. Reuse compiled timings
   and safe scene checkpoints, invalidating them for graph, asset, camera and
   updater changes. Caching mutable objects without those rules risks stale output.
2. **Replace PNG file transport for playback.** GPU pixels travel to CPU memory,
   through PNG encoding/files, and through browser decoding. Shared-memory/video
   transport and asynchronous readback merit measurement. A pixel buffer read
   immediately still stalls; it needs a pipelined producer/consumer design.
   [Khronos: Pixel Buffer Objects](https://wikis.khronos.org/opengl/Pixel_Buffer_Object)
3. **Retain GPU geometry buffers where safe.** The bundled
   `manim/renderer/shader.py:Mesh.render` allocates, uploads and releases buffers
   and a vertex array per draw. Context/shader reuse does not cache these buffers.
   Static and animated points, indices and styles require correct invalidation.
   [Khronos: Buffer Object Streaming](https://wikis.khronos.org/opengl/Buffer_Object_Streaming)
4. **Investigate native surfaces and object-copy costs.** Public Surface remains
   many Python vector faces; coordinate/text animations spend considerable time
   in deep copies. Native mesh representations could help, but must preserve face
   access, checkerboards, strokes, opacity, transforms and supported animations.

A prior experiment skipped intermediate GPU draws while retaining CPU animation
updates. It failed exact comparisons for filled paths because Manim's lazy draw
caches are stateful. That shortcut remains rejected: preview and playback must
agree.

Resource lifetime follows ModernGL's guidance to collect GPU resources with the
proper context/thread rather than rely on its default lack of automatic collection.
[ModernGL: Object Lifecycle](https://moderngl.readthedocs.io/en/latest/topics/gc.html)

## Reproduction and validation

Run serially from the repository root with other rendering work idle:

```sh
PYTHONPATH=engine/src .venv/bin/python engine/audits/benchmark_renderers.py --extended --output /tmp/render-540.json
PYTHONPATH=engine/src .venv/bin/python engine/audits/benchmark_renderers.py --width 1920 --output /tmp/render-1080.json
```

Validation: 198 engine tests; 50 additional breadth/live-expression/camera checks
run through the selected OpenGL renderer; 117 UI tests; three Electron integration
tests covering renderer selection, input parity and scrub-after-play. Python and
TypeScript checks, lint and application build pass. New regressions cover local
capture/error lines, context/shader reuse, resizing, texture isolation, fresh
versus reused context pixels, surface pixels, skipping without a timing pass,
and immediate scrub scheduling.

GPU execution was validated on this Mac. These data are not a cross-platform
performance guarantee, a pure GPU throughput comparison, an export-speed claim,
or proof that every Cairo/OpenGL scene has identical visual output.
