# External-display playback regression

Measured on the connected Apple M3 Pro, built-in Retina display and Dell U4025QW,
using `examples/00000.mnw`: 14 groups of Circle, Square and Triangle, arranged in
a grid, animated together with Write at 60 fps for two seconds. Both displays
report 120 Hz and scale factor 2. The Dell desktop is 3840 × 1620 logical pixels.
The example remains the user's local file; its SHA-256 is recorded in the results.

The comparison uses baseline `2284d99` (before this fix), an isolated copy of
pre-OpenGL `24c2511`, and the fixed working tree. The user's checkout was not
switched. Each build ran alone, in 1400 × 850 windows on both screens and a
larger window on each screen (1728 × 1084 internal; 3200 × 1450 external).
Moving/resizing changes preview resolution, so the first pass at a new size can
include preparation. Later passes test cached playback.

## What changed and why it matters

The regression was in delivery of rendered frames, not evidence that this scene
requires a different GPU. At the larger Dell window size, the app requests
1920 × 1080 previews. One uncompressed RGBA frame is 8,294,400 bytes. The newer
path transferred these through HTTP into JavaScript, even during cached replay.
It also requested frames on each screen refresh, fetching some 60 fps frames
twice on a 120 Hz display. The older app delivered compressed PNG images.

The fixed playback clock requests each source frame at most once, while keeping
wall-clock timing independent of monitor refresh rate. An already displayed
frame URL is not fetched again. This follows the documented behavior that
[requestAnimationFrame normally follows display refresh rate](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).

The engine now prepares lossless PNG delivery variants on one background worker.
The queue holds at most 16 keys and the encoded cache at most 32 MiB, in addition
to the existing raw-frame budgets. Neither rendering nor an HTTP request waits
for encoding: a missing variant is delivered as raw RGBA immediately. Images
that compress poorly retain the raw path. The browser negotiates PNG, decodes it
using [createImageBitmap](https://developer.chrome.com/blog/createimagebitmap-in-chrome-50),
draws it to the preview canvas, and releases the bitmap. This removes the large
raw-pixel transfer for prepared frames without changing Manim's renderer.

Encoding does not acknowledge future frames or release playback backpressure.
Evicting/replacing a raw frame also invalidates its encoded variant. Clearing
the disk cache closes the worker and clears both caches. HTTP responses remain
`no-store`; this change does not introduce a persistent browser disk cache.
The working buffers used by encoding/decoding are additional transient memory.

## Results on the Dell, large window

These are the last of three passes at that size, after previous passes prepared
frames. They are not cold-render measurements or physical scanout measurements.

| Measurement | Before | After | Cairo `24c2511` |
|---|---:|---:|---:|
| Distinct preview frames delivered | 110 | 119 | 120 image loads |
| Payload transferred during replay | 1,152 MB | 16.3 MB | Not instrumented |
| Median HTTP payload delivery | 12.9 ms | 1.0 ms | Not instrumented |
| 95th percentile HTTP payload delivery | 27.4 ms | 1.7 ms | Not instrumented |
| 95th percentile interval between canvas updates/image loads | 27.5 ms | 22.3 ms | 20.9 ms |

The raw baseline included duplicate canvas writes, so its update interval alone
understates the loss of distinct animation frames. The fixed run delivered all
119 sampled frame URLs. Request timing and the final preview refresh can make
the count differ by one between passes. On the same-size 1400 × 850 window,
both displays used 960 × 540 previews; there was no comparable throughput drop.
This isolates window/preview size as a material part of the measured regression,
without claiming it explains every possible display configuration.

Preparation still costs time. The first fixed pass after resizing to the large
Dell window used mostly raw delivery (929 MB); the next used 171 MB; the third
used 16.3 MB. No promise is made that an uncached expensive scene renders at
60 fps. This fix specifically reduces the repeated-playback regression, without
reducing preview resolution or changing export settings.

Raw samples: [display-playback.json](display-playback.json).

```sh
cd app
pnpm build
cd ..
node engine/audits/benchmark_display.cjs examples/00000.mnw /tmp/display.json
```

The benchmark moves its own temporary app window across connected displays and
closes it afterward. It does not change display settings. Desktop activity can
affect these timings; run without concurrent benchmarks or tests.

## Validation

Tests cover source-rate playback on 120/144 Hz clocks, raw and decoded bitmap
presentation, duplicate suppression, exact lossless pixels including alpha,
bounded delivery storage, eviction, incompressible-frame fallback, nonblocking
requests, shutdown, and preserving playback backpressure during preparation.
Electron checks verify displayed pixels against the engine's raw output and
exercise playback, scrubbing after playback, and clearing/rebuilding caches.

Validation completed: 223 engine tests, 128 frontend tests, five Electron checks,
Python/TypeScript checks, lint and production build. The strengthened Electron
pixel comparison was rerun after explicitly revisiting a PNG-prepared frame.
