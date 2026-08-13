from __future__ import annotations

import os
import platform
import shutil
from importlib.metadata import version

from pydantic import BaseModel


class EngineInfo(BaseModel):
    python: str
    manim: str
    latex: bool
    dvisvgm: bool


def engine_info(path: str | None = None) -> EngineInfo:
    """Describe the runtime. `path` overrides the PATH searched for TeX tools."""
    search = os.environ.get("PATH", "") if path is None else path
    return EngineInfo(
        python=platform.python_version(),
        manim=version("manim"),
        latex=shutil.which("latex", path=search) is not None,
        dvisvgm=shutil.which("dvisvgm", path=search) is not None,
    )
