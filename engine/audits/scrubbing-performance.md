# Scrubbing redesign — 2026-09-28

The previous OpenGL changes did not fix direct timeline scrubbing. On the sine
example, a seek to eight seconds reconstructed a scene and submitted 480 frames
to display one image. Moving forward by one frame repeated that history.

## Implementation

Production OpenGL previews now use a resumable scene on the RPC thread. A
`greenlet` suspends the actual Manim execution stack at the requested frame,
retaining the animation loop, object identities, updater closures, traced paths
and camera state. Forward requests resume this scene. No rendering worker is
added. Manim configuration and compatibility patches are scoped to each request;
the GL context is released between requests and reacquired on resume. Image
textures are retained/rebound, and random-generator state is preserved.

Advancing to an uncached time simulates intervening frames without submitting
their meshes or reading their pixels. Manim shader-data preparation still runs
where needed: skipping it changes partially filled Create animations. Frozen
waits avoid this preparation too. Selection bounds are captured inside the
active renderer configuration, avoiding another pair of global class conversions.

An independent HTTP endpoint accepts newer playhead times while the render RPC
is busy. Per-request tokens expire, and increasing revisions prevent delayed
updates from overriding newer targets. Backward movement interrupts advancement
and either returns a cached frame or reconstructs history without drawing each
intermediate frame. Code/resolution changes, sequences, exports, errors and
shutdown dispose of the appropriate live session.

The requested opening image appears first. After 300 ms idle, the app starts an
interruptible cache-preparation pass without Play. Work is capped at ten seconds
and approximately 1.5 GiB of frame payload, whichever is smaller. The existing
raw cache stays capped at 128 MiB RAM plus a 2 GiB temporary spool. The later
[display-delivery fix](display-playback.md) adds a separate 32 MiB encoded-image
cache. Scrubbing, editing
or starting playback cancels preparation at its next frame boundary. Partial
preparation never marks the entire scene cached. It is attempted once per
code/resolution for an idle end preview, so scrubbing does not repeatedly start
competing background work. Cairo and PNG reference rendering keep their existing
seek path.

## Measurements

`examples/7.sine-curve-unit-circle.mnw`, Apple M3 Pro, hardware OpenGL,
960 × 540, document frame rate 60 fps. Medians of three samples, with potentially
warm text/shader caches. Baseline: commit `0a62efb`, immediately before this fix.
**Engine request times below exclude HTTP and UI delivery.**

| Operation | Before | After |
|---|---:|---:|
| Fully uncached jump to 8 seconds | 1,923 ms | 459 ms |
| Forward drag by one frame near 4 seconds | 1,006 ms/request | 14 ms/request |
| Seek to 8 seconds after opening and idle preparation | 1,743 ms | 1.56 ms |
| Seek to 4 seconds after opening and idle preparation | 948 ms | 1.24 ms |
| Seek to 1 second after opening and idle preparation | 250 ms | 1.16 ms |

The forward-drag test clears frames and the live session, seeks to four seconds,
then requests ten consecutive new frames. Its improvement comes from resuming
state, not a prefilled cache. The cold eight-second test also clears both. The
idle comparison includes background preparation only in the new application,
matching the UI behavior.

A separate real Electron measurement of ten cached timeline clicks took a
median **9.55 ms** (8.5–14 ms) from pointer-down to the requested canvas pixel
update. It verifies the displayed URL against the requested frame and includes
UI scheduling, RPC, HTTP transfer and canvas writing. Each click begins with an
idle engine and a verified cached frame; physical display scanout is excluded.
This is a cached interaction measurement, not a cold-seek measurement.

Preparation has a cost: filling this example's cache took a median **3.49 s** in
the background and can be interrupted. The initial image took **571 ms**. The old
73 ms end preview skipped completed updater-driven waits and did not reconstruct
the full trace history. The new initial image is verified against uninterrupted
rendering, including the 8.5-second wait boundary. These timings must not be
presented as a universal OpenGL advantage or guaranteed frame rate.

Raw samples: [scrubbing-performance.json](scrubbing-performance.json).

Reproduce from the repository root without simultaneous GPU tests:

```sh
PYTHONPATH=engine/src .venv/bin/python engine/audits/benchmark_scrubbing.py \
  --revision 0a62efb --output /tmp/scrubbing-before.json
PYTHONPATH=engine/src .venv/bin/python engine/audits/benchmark_scrubbing.py \
  --output /tmp/scrubbing-after.json
```

The harness extracts old engine source temporarily without changing the checkout.
Both revisions use the same installed Manim/environment.

## Verification and limits

Pixel comparisons against uninterrupted rendering cover filled Create, labelled
axes/Write, Transform, stateful updaters, traced paths across waits, seeded random
updates, 3D camera rotation, images and surfaces. The actual sine example is
compared at 1, 4, 8 and 9.5 seconds and at the completed scene. Other tests cover
errors/recovery, configuration/context cleanup, edits, resolution changes,
out-of-order controls and retargeting a busy seek. Electron tests cover opening
the example and scrubbing backwards without Play, playback-then-scrub, editing
and actual displayed pixels.

There are no arbitrary execution checkpoints. A backward seek missing from the
frame cache still reconstructs history, and long uncached jumps still pay Python
updater/geometry costs. Preparation is bounded; every project is not fully cached.
Expensive object construction before the first frame cannot be interrupted by
the frame-control endpoint.

`greenlet` is declared in the engine package/lockfile (`uv sync` installs it).
Its [documented stack switching API](https://greenlet.readthedocs.io/en/stable/switching.html)
supports suspension and resumption on the same operating-system thread.
