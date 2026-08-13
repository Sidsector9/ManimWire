from __future__ import annotations

import stat
from pathlib import Path

from engine.__main__ import build_dispatcher
from engine.info import engine_info


def test_reports_versions() -> None:
    info = engine_info(path="")
    assert info.python.startswith("3.")
    assert info.manim == "0.21.0"
    assert info.latex is False
    assert info.dvisvgm is False


def test_detects_latex_on_path(tmp_path: Path) -> None:
    latex = tmp_path / "latex"
    latex.write_text("#!/bin/sh\n")
    latex.chmod(latex.stat().st_mode | stat.S_IXUSR)
    info = engine_info(path=str(tmp_path))
    assert info.latex is True
    assert info.dvisvgm is False


def test_dispatcher_exposes_ping_and_info() -> None:
    dispatcher = build_dispatcher()
    ping = dispatcher.handle({"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert ping == {"jsonrpc": "2.0", "id": 1, "result": "pong"}
    info = dispatcher.handle({"jsonrpc": "2.0", "id": 2, "method": "engine.info"})
    assert info is not None
    assert info["result"]["manim"] == "0.21.0"
