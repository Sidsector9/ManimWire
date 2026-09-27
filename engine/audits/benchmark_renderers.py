"""Uncached application requests, including GPU readback, bounds and PNG output.

Run from the repository root, with no tests/exports running concurrently:
PYTHONPATH=engine/src .venv/bin/python engine/audits/benchmark_renderers.py \
    --output /tmp/render-benchmark.json
Use --width 1920 (or 3840) to measure a different resolution without changing
the document. The first sample is reported separately, not hidden in a median.
"""

from __future__ import annotations

import argparse
import json
import platform
import tempfile
from pathlib import Path
from statistics import median
from time import perf_counter

from engine.catalogue import get_catalogue
from engine.document import Document, Settings
from engine.render import CairoRenderService, RenderService
from engine.render.device import detect_device


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--samples", type=int, default=6)
    parser.add_argument("--extended", action="store_true")
    args = parser.parse_args()
    if args.samples < 2 or args.width < 16:
        parser.error("Use at least two samples and a width of at least 16 pixels")
    settings = Settings(
        pixel_width=args.width, pixel_height=args.width * 9 // 16, frame_rate=30
    )
    catalogue = get_catalogue()
    device = detect_device()
    if device.renderer != "opengl":
        parser.error(f"OpenGL unavailable: {device.reason}")
    cases = [
        ("1.animating-a-circle.mnw", "sequence"),
        ("14.three-d-surface-plot.mnw", "frame"),
        ("8.coordinate-system.mnw", "frame"),
    ]
    if args.extended:
        cases += [
            ("7.sine-curve-unit-circle.mnw", "sequence"),
            ("9.opening-manim-example.mnw", "sequence"),
        ]
    examples = Path(__file__).resolve().parents[2] / "examples"
    results = []
    with tempfile.TemporaryDirectory(prefix="mnw-bench-") as temp:
        for filename, operation in cases:
            document = Document.model_validate_json((examples / filename).read_text())
            scene = document.scenes[0]
            for cls in (CairoRenderService, RenderService):
                times = []
                sizes = []
                for sample in range(args.samples):
                    service = cls(Path(temp) / f"{filename}-{cls.__name__}-{sample}")
                    start = perf_counter()
                    if operation == "frame":
                        service.frame(
                            scene, catalogue, settings, 0.75, groups=document.groups
                        )
                    else:
                        service.sequence(
                            scene, catalogue, settings, 0, 1, groups=document.groups
                        )
                    times.append((perf_counter() - start) * 1000)
                    sizes.append(
                        sum(p.stat().st_size for p in service.cache_dir.glob("*.png"))
                    )
                row = {
                    "scene": filename,
                    "operation": operation,
                    "renderer": service.device.renderer,
                    "first_ms": round(times[0], 1),
                    "median_ms": round(median(times[1:]), 1),
                    "samples_ms": [round(t, 1) for t in times],
                    "png_bytes": sizes,
                }
                results.append(row)
                print(json.dumps(row), flush=True)
    args.output.write_text(
        json.dumps(
            {
                "device": device.model_dump(),
                "platform": platform.platform(),
                "settings": settings.model_dump(),
                "method": (
                    "Fresh services/frame caches; first sample separate; "
                    "median of remaining samples. Hardware probe/catalogue warm; "
                    "includes readback, bounds, PNG; excludes RPC/UI."
                ),
                "results": results,
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
