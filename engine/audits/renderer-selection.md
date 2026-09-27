# Automatic renderer selection

ManimWire probes OpenGL once per Python engine process, before reporting ready.
The probe creates an OpenGL 3.3+ context, compiles shaders, draws a triangle,
and verifies pixel readback. It runs in a child process with a ten-second
limit per backend, so a driver crash or hang cannot take down the RPC host.

Selection order:

1. A working OpenGL context reporting a recognized hardware renderer.
2. A working software or unclassified OpenGL context, if hardware was not found.
3. Cairo if neither the platform default backend nor EGL passes the probe.

The app reports this decision in the status bar and `engine.info.rendering`.
Cairo's fallback reason is available in the status tooltip. GPU classification
uses driver vendor/renderer strings; unfamiliar or virtual adapters are marked
unknown rather than claimed to be hardware accelerated. This probes the adapter
selected by the OS/driver. It does not enumerate or force a dedicated GPU on a
multi-GPU computer, install drivers, or bundle a software OpenGL implementation.

## Rendering integration

`RenderService` uses the selected renderer for previews, sequences, and exports.
Timeline compilation uses the same Manim object implementation without creating
a graphics context. The catalogue continues to describe the public Manim CE API.
Renderer changes are scoped to an execution; the RPC host executes requests
serially because Manim's configuration and class conversion are process-global.

The OpenGL adapter maintains the editor's frame clock, including frozen waits,
partial playback, and skipping earlier plays. Production previews use CPU
readback into a binary RGBA cache served over a tokenized loopback endpoint;
Electron presents the pixels on a canvas. The cache retains up to 128 MiB of
pixel data in RAM plus a 2 GiB anonymous temporary spool. Playback uses one scene
execution per pass, with bounded producer lookahead and cancellation independent
of the rendering RPC loop. Video encoding still uses Manim's file writer;
selecting OpenGL does not enable hardware video encoding.

The engine retains one OpenGL context, its compiled shaders, and reusable mesh
buffers/vertex arrays between serial requests. Unchanged mesh data avoids upload;
changed data updates or reallocates storage. The framebuffer is reused until the
resolution changes. Live OpenGL seek sessions retain scene state and textures
between forward requests; sequences, exports, invalidation and shutdown release
them. Regular render executions release textures on completion, including errors.
The persistent resources
are released at engine shutdown. Frame caches distinguish Cairo from OpenGL.
Numeric-text object caches are kept separate because their representations differ.

Direct scrubbing resumes scene state and simulates skipped frames without GPU
submission. Latest-target control interrupts obsolete seeks; idle preparation
provides cached backwards seeks without Play. See the
[scrubbing measurements and limits](scrubbing-performance.md).

## Bundled Manim compatibility

Scoped adapters cover the failures found during migration:

- `Write` / `DrawBorderThenFill` restore full path data before filling.
- `LaggedStartMap` passes a leaf object as one argument under OpenGL.
- 3D illusion rotation uses a removable scene updater for OpenGL's camera.
- `CameraFrame` refers to the OpenGL camera itself.
- Image and point-cloud public names use OpenGL implementations. Images keep
  Cairo's default pixel-based sizing and materialize temporary texture files.
- Public Surface faces are inserted as one batch to avoid repeated family
  traversal; their geometry, order and styling remain the public Manim behavior.

OpenGL preview runs determine which plays to skip while compiling each play,
without a separate timing run. Timeline layout still has a separate execution.
See [the pipeline redesign](pipeline-redesign.md) for current measurements,
remaining bottlenecks and the reproducible benchmark, and
[the earlier investigation](render-performance.md) for the migration history.

These adapters live in the engine; the Manim git submodule is unchanged.
Cairo remains installed because the bundled Manim package imports it regardless
of the selected renderer. A scene error under OpenGL is reported normally rather
than silently re-rendered through Cairo.

## Validation and limits

Validated on Apple M3 Pro / OpenGL 4.1: preview, sequence caching, playback and
scrubbing, MP4/MOV/WebM/GIF/PNG exports, labelled axes, text, image fading,
point-cloud groups, camera animation, and 3D illusion rotation. All 14 checked-in
examples produced final preview frames; the 11 with animation durations also
completed video exports. Static scenes should be exported as PNG or given a Wait
before movie export, as with the existing workflow.

Fallback selection is covered with simulated unavailable, timed-out, software,
and hardware drivers. Actual Linux/Windows software-driver execution remains
to be validated on those platforms. This is not a claim of full Cairo/OpenGL
visual equivalence or complete Manim CE feature parity. GPU acceleration also
does not imply that every scene will be faster; Python, geometry preparation,
text, frame transfer, and encoding can dominate render time.
