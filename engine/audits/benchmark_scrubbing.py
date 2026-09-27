"""Measure the sine example's scrubbing path, independently of playback.

PYTHONPATH=engine/src .venv/bin/python engine/audits/benchmark_scrubbing.py \
    --output /tmp/scrubbing.json
Add --revision 0a62efb to run the same harness against the previous engine source.
Run serially, without simultaneous GPU tests. The working checkout is unchanged.
"""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from statistics import median
from time import perf_counter


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix="mnw-seek-benchmark-") as temp:
        directory = Path(temp)
        source = root / "engine/src"
        if args.revision:
            archive = subprocess.check_output(
                ["git", "archive", args.revision, "engine"], cwd=root
            )
            with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                tar.extractall(directory, filter="data")
            source = directory / "engine/src"
        sys.path.insert(0, str(source))
        from engine.catalogue import get_catalogue
        from engine.document import Document
        from engine.render import RenderService
        from engine.render.device import detect_device

        catalogue = get_catalogue()
        doc = Document.model_validate_json(
            (root / "examples/7.sine-curve-unit-circle.mnw").read_text()
        )
        rows = []
        for sample in range(args.samples):
            service = RenderService(directory / f"cache-{sample}", binary=True)

            def frame(
                time: float, service: RenderService = service
            ) -> tuple[float, float]:
                start = perf_counter()
                result = service.frame(
                    doc.scenes[0],
                    catalogue,
                    doc.settings,
                    time,
                    width=960,
                    groups=doc.groups,
                )
                return (perf_counter() - start) * 1000, result.render_ms

            def clear(service: RenderService = service) -> None:
                if hasattr(service, "close_seek"):
                    service.close_seek()
                if service.frames is not None:
                    for key in list(service.frames.records):
                        service.frames._remove(key)

            try:
                opening, _ = frame(1e6)
                warm = None
                if hasattr(service, "close_seek"):
                    start = perf_counter()
                    service.sequence(
                        doc.scenes[0],
                        catalogue,
                        doc.settings,
                        0,
                        9.5,
                        width=960,
                        groups=doc.groups,
                    )
                    warm = (perf_counter() - start) * 1000
                after_open = {str(t): frame(t) for t in [8, 4, 1]}
                clear()
                cold, _ = frame(8)
                clear()
                frame(4)
                drag = [frame(4 + index / 60)[0] for index in range(1, 11)]
                row = dict(
                    sample=sample,
                    opening_ms=opening,
                    background_warm_ms=warm,
                    after_open_ms=after_open,
                    uncached_8s_ms=cold,
                    forward_drag_ms=drag,
                    forward_drag_median_ms=median(drag),
                )
                rows.append(row)
                print(json.dumps(row), flush=True)
            finally:
                service.close()
        report = dict(
            revision=args.revision or "working tree",
            device=detect_device().model_dump(),
            width=960,
            height=540,
            fps=doc.settings.frame_rate,
            method=(
                "Three samples by default; warm text/shader caches; engine request "
                "latency, excluding HTTP/UI. After-open pairs: wall ms, reported "
                "render ms. Cold seek explicitly clears frames and live scene. "
                "Drag advances by one frame per request."
            ),
            rows=rows,
            medians=dict(
                opening_ms=median(r["opening_ms"] for r in rows),
                uncached_8s_ms=median(r["uncached_8s_ms"] for r in rows),
                forward_drag_ms=median(r["forward_drag_median_ms"] for r in rows),
                after_open_ms={
                    str(t): median(r["after_open_ms"][str(t)][0] for r in rows)
                    for t in [8, 4, 1]
                },
            ),
        )
        args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
