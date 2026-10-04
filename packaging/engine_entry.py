"""Standalone engine entry point, including an isolated GPU probe and build check."""

import argparse
import sys


def smoke_test(with_tex=False):
    import faulthandler

    faulthandler.dump_traceback_later(60)
    print("Checking bundled imports...", flush=True)
    import tempfile
    from pathlib import Path

    import typst
    from engine.catalogue import get_catalogue
    from engine.info import engine_info

    from manim import Circle, Create, MathTex, Scene, Text, tempconfig

    print("Checking renderer and bundled tools...", flush=True)
    info = engine_info()
    print(
        f"Optional system tools: latex={info.latex}, dvisvgm={info.dvisvgm}", flush=True
    )
    if with_tex:
        assert info.latex and info.dvisvgm, (
            "System LaTeX and dvisvgm are required for this check"
        )
    print("Checking catalogue discovery...", flush=True)
    names = {entry.name for entry in get_catalogue().entries}
    assert {"Circle", "Create", "Expression", "Surface"} <= names
    print("Checking text and export...", flush=True)
    with tempfile.TemporaryDirectory(prefix="manimwire-package-check-") as directory:
        with tempconfig(
            {
                "media_dir": directory,
                "pixel_width": 128,
                "pixel_height": 72,
                "frame_rate": 5,
                "write_to_movie": True,
                "format": "mp4",
                "disable_caching": True,
                "renderer": "cairo",
            }
        ):

            class Check(Scene):
                def construct(self):
                    self.add(Text("ManimWire"))
                    if with_tex:
                        self.add(MathTex(r"x^2"))
                    self.play(Create(Circle()), run_time=0.2)

            Check().render()
            assert list(Path(directory).rglob("*.mp4")), "Video export failed"
        assert typst.compile(b"Hello ManimWire", format="svg")
    faulthandler.cancel_dump_traceback_later()
    print("Bundled engine, catalogue, text, Typst, and MP4 export passed.")


def entrypoint(argv=None):
    parser = argparse.ArgumentParser(description="ManimWire engine helper; normally launched by the desktop app.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--stdio', action='store_true', help='Serve JSON-RPC over pipes')
    mode.add_argument('--probe-device', choices=['default', 'egl'])
    mode.add_argument('--self-test', action='store_true')
    mode.add_argument('--self-test-tex', action='store_true')
    args = parser.parse_args(argv)
    if args.probe_device:
        from engine.render.device import probe

        probe(args.probe_device)
    elif args.self_test or args.self_test_tex:
        smoke_test(with_tex=args.self_test_tex)
    else:
        if sys.stdin.isatty():
            parser.error('--stdio requires a piped input stream. Open the ManimWire app instead.')
        from engine.__main__ import main

        main()


if __name__ == "__main__":
    from multiprocessing import freeze_support

    freeze_support()
    entrypoint()
