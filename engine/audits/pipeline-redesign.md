# Preview pipeline redesign — 2026-09-28

Follow-up: the [scrubbing redesign](scrubbing-performance.md) fixes the direct
seeking path left unchanged by this earlier playback/transport work. It adds
resumable scenes, simulation without intermediate drawing, latest-target control
and interruptible background preparation.

The production app now renders a playback pass in one continuous Manim execution,
serves binary pixels to Electron, and reuses OpenGL mesh buffers. Switching the
renderer alone did not remove these surrounding costs.

## Changes

- **One scene execution per playback pass.** Previously the app requested a new
  render for every timeline step. Each request rebuilt the scene and replayed
  earlier state. Playback now sends one interval from the playhead to the end;
  the same scene, objects and renderer survive its play/wait transitions.
- **Binary previews.** The production service caches RGBA bytes and metadata,
  instead of encoding a PNG and writing a JSON file for every frame. A tokenized
  loopback HTTP endpoint with persistent connections transfers pixels independently of the busy rendering
  RPC thread. Electron paints them with `ImageData` / `putImageData`. JSON-RPC
  carries frame metadata, not pixel arrays or base64. The PNG path remains for
  reference tests and direct callers; movie exports keep Manim's file writer.
- **Bounded storage.** Recent pixels occupy at most 128 MiB of cache RAM. Older
  pixels spill to one anonymous temporary file, a ring capped at 2 GiB. Eviction
  removes metadata too. The OS releases the backing file when the process exits,
  including forced termination. These limits exclude scene data, metadata,
  in-flight transfers and browser allocations.
- **Playback backpressure.** Live playback queues at most 60 unread frames and
  at most half the cache's byte budget. Fetching a frame acknowledges it and any
  earlier skipped frames. Rendering waits when the viewer falls behind, so a
  fast producer cannot overwrite unread frames or grow the UI queue indefinitely.
  Offline sequence calls remain unpaced for rendering and benchmarks.
- **Reusable GPU buffers.** Persistent OpenGL resources now include vertex and
  index buffers and vertex-array objects, alongside the existing context,
  framebuffer and shader cache. Each submission compares actual vertex/index
  contents. Unchanged contents avoid upload; changed same-size data uses buffer
  orphaning and upload; size changes allocate new storage. Draw-order slots are
  storage reuse opportunities, not assumptions that object geometry is unchanged.
  Retention is capped at 256 entries / 64 MiB of vertex/index payload, with both
  CPU comparison bytes and GPU storage retained.
- **Cancellation and transfer coalescing.** Stop and graph edits send cancellation
  through the independent endpoint; the engine stops at a frame boundary, including
  while waiting for a reader. Per-run tokens prevent an old cancel request from
  cancelling a new pass. Electron finishes its current transfer and keeps only
  the newest waiting frame, avoiding starvation when display is slower than the
  producer. Frames from an older graph, renderer or resolution are rejected.

## Measurements

Apple M3 Pro, hardware OpenGL 4.1 Metal, bundled Manim CE 0.21.0. Four samples per
case, fresh frame cache each time; discard the first and report the median of
the remaining three. Context/shader and text caches can be warm. These are
engine generation/render/cache timings, including GPU readback, **excluding
HTTP transfer and browser presentation**. Live pacing is disabled to measure
render throughput; an actual 22-second animation still plays for 22 seconds.

| Workload | Previous path | Redesigned path | Improvement |
|---|---:|---:|---:|
| Opening example, all 22 seconds, 480 × 270 at 15 fps: per-step vs continuous, both binary | 15,590 ms / 10 scene runs | 3,667 ms / 1 scene run | 4.25× |
| Circle, first second, 960 × 540 at 30 fps: PNG vs binary, both updated engine | 151.2 ms | 95.8 ms | 1.58× |
| Opening example, first second, 960 × 540 at 30 fps: PNG vs binary, both updated engine | 798.6 ms | 741.0 ms | 1.08× |

These isolate two architectural costs; do not multiply their speedups or compare
the different resolutions as though they were the same workload. They do not
establish that OpenGL beats Cairo for every scene. GPU-buffer reuse is verified
for correctness and avoided allocations/uploads, without a separate claimed
speedup. Desktop load and driver behavior can affect timings.

A separate run includes synchronous consumption of every frame: file reads for
PNG, persistent HTTP reads for binary. The circle measured **155.9 → 128.8 ms**;
the opening example's first second measured **798.0 → 767.2 ms**, at the same
960 × 540 / 30 fps settings. These exclude browser decoding/presentation and are
not a measurement of complete UI latency. An earlier connection-per-frame HTTP
experiment measured approximately equal times for PNG and binary (154 ms for
the circle, 800 ms for the opening); connection reuse recovers part of the
savings. Both sets of raw samples are retained. Binary transport's gain is
smaller once delivery is counted; continuous scene execution provides the larger
measured improvement.

Raw samples: [pipeline-redesign.json](pipeline-redesign.json).

From the repository root:

```sh
PYTHONPATH=engine/src .venv/bin/python engine/audits/benchmark_pipeline.py \
  --output /tmp/pipeline-benchmark.json
```

Add `--consume` to read every produced pixel payload through its transport;
this still excludes browser presentation. `--mode transport` or
`--mode continuous` isolates one comparison. Do not run GPU tests concurrently.

## Verification

- Binary output equals the reference PNG pixels on Cairo and the selected
  OpenGL device; the binary path succeeds with PNG encoding disabled.
- Every captured frame of Create, a color/position change and a shape Transform
  matches upstream mesh submission pixel-for-pixel, including filled paths.
- Cache spill, eviction, missing/wrong-token URLs, cancellation, reader
  backpressure and storage limits have engine tests.
- Frontend tests cover continuous multi-step playback, starting from a scrubbed
  time, incomplete caches, cancellation, obsolete frame rejection and coalescing.
- Electron checks cover the first preview, editing, playback followed by
  scrubbing, renderer reporting and canvas pixels matching binary source pixels.

## Remaining costs and limits

Uncached arbitrary seeks still construct a scene and advance it to the requested
time. This implementation keeps a scene alive within a playback pass, not across
arbitrary rewinds or graph edits. Cached seeks avoid construction. A pass whose
frames exceed the cache is not marked fully cached for subsequent playback.

GPU readback, CPU geometry/shader-data preparation, pixel copies, HTTP delivery
and canvas upload still occur. Raw RGBA saves codec work but uses more bandwidth
and storage than PNG; high-resolution/high-frame-rate playback remains a cost.
This is not shared GPU textures or a zero-copy path. A slow viewer can skip
intermediate frames while the playhead advances; backpressure bounds rendering
ahead. Expensive scene construction can delay cancellation before the next frame.
Video export does not gain hardware encoding from these preview changes.

Implementation API references: [ModernGL buffers](https://moderngl.readthedocs.io/en/stable/reference/buffer.html),
[Canvas pixel presentation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/putImageData).
