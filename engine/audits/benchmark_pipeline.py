"""Compare transport and per-step versus continuous scene execution.

Run serially from the repository root, without concurrent render tests:
PYTHONPATH=engine/src .venv/bin/python engine/audits/benchmark_pipeline.py \
    --output /tmp/pipeline.json
Timing excludes cache shutdown and browser presentation; --consume includes HTTP
pixel delivery for binary transport, or reading PNG bytes for legacy transport.
"""

from __future__ import annotations

import argparse
import json
import tempfile
from http.client import HTTPConnection
from pathlib import Path
from statistics import median
from time import perf_counter
from urllib.parse import urlsplit

from engine.catalogue import get_catalogue
from engine.document import Document, Settings
from engine.render import FrameResult, RenderService
from engine.render.device import detect_device
from engine.timeline import layout_timeline


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--mode", choices=["transport", "continuous", "all"], default="all"
    )
    parser.add_argument("--samples", type=int, default=4)
    parser.add_argument("--consume", action="store_true")
    args = parser.parse_args()
    if args.samples < 2:
        parser.error("Use at least two samples")
    catalogue = get_catalogue()
    examples = Path(__file__).resolve().parents[2] / "examples"
    results = []
    connection: HTTPConnection | None = None

    def consume(frame: FrameResult) -> None:
        nonlocal connection
        if frame.format == "rgba":
            url = urlsplit(frame.path)
            if connection is None:
                connection = HTTPConnection(url.hostname or "127.0.0.1", url.port)
            connection.request("GET", url.path)
            response = connection.getresponse()
            assert response.status == 200
            assert len(response.read()) == frame.width * frame.height * 4
        else:
            assert Path(frame.path).read_bytes()

    for name in ["1.animating-a-circle.mnw", "9.opening-manim-example.mnw"]:
        doc = Document.model_validate_json((examples / name).read_text())
        scene = doc.scenes[0]
        experiments = []
        if args.mode != "continuous":
            for binary in (False, True):
                experiments.append(("transport", binary, [(0.0, 1.0)], 960, 30))
        if name.startswith("9.") and args.mode != "transport":
            layout = layout_timeline(scene, catalogue, doc.groups)
            steps = [(s.start, s.end) for s in layout.steps if s.end > s.start + 1e-9]
            experiments += [
                ("per_step", True, steps, 480, 15),
                ("continuous", True, [(0.0, layout.total)], 480, 15),
            ]
        for operation, binary, intervals, width, fps in experiments:
            samples = []
            for _ in range(args.samples):
                with tempfile.TemporaryDirectory(prefix="mnw-pipeline-") as temp:
                    service = RenderService(Path(temp), binary=binary)
                    settings = Settings(
                        pixel_width=width, pixel_height=width * 9 // 16, frame_rate=fps
                    )
                    try:
                        started = perf_counter()
                        for start, end in intervals:
                            service.sequence(
                                scene,
                                catalogue,
                                settings,
                                start,
                                end,
                                groups=doc.groups,
                                on_frame=consume if args.consume else None,
                            )
                        samples.append((perf_counter() - started) * 1000)
                        runs = service.render_count
                    finally:
                        if connection is not None:
                            connection.close()
                            connection = None
                        service.close()
            row = dict(
                scene=name,
                operation=operation,
                binary=binary,
                width=width,
                fps=fps,
                duration=intervals[-1][1],
                render_runs=runs,
                samples_ms=samples,
                median_ms=median(samples[1:]),
            )
            results.append(row)
            print(json.dumps(row), flush=True)
    args.output.write_text(
        json.dumps(
            dict(
                device=detect_device().model_dump(),
                consume=args.consume,
                method=(
                    "Fresh frame cache per sample; discard first; median remaining. "
                    "Includes GPU readback; excludes browser presentation."
                ),
                results=results,
            ),
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
