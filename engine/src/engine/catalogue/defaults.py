"""Format parameter defaults as Manim source expressions and short labels.

Source expressions assume ``from manim import *`` and ``import numpy as np``.
"""

from __future__ import annotations

import inspect
import math
from enum import Enum
from typing import Any

import numpy as np
from manim import constants
from manim.utils.color import ManimColor, manim_colors

DIRECTION_NAMES = [
    "ORIGIN",
    "UP",
    "DOWN",
    "LEFT",
    "RIGHT",
    "IN",
    "OUT",
    "UL",
    "UR",
    "DL",
    "DR",
    "X_AXIS",
    "Y_AXIS",
    "Z_AXIS",
]
_DIRECTIONS = [(name, getattr(constants, name)) for name in DIRECTION_NAMES]

_ANGLES = [
    ("TAU", math.tau),
    ("PI", math.pi),
    ("PI / 2", math.pi / 2),
    ("PI / 3", math.pi / 3),
    ("PI / 4", math.pi / 4),
    ("PI / 6", math.pi / 6),
]

_NAMED_COLORS: dict[str, str] = {}
for _name in dir(manim_colors):
    _value = getattr(manim_colors, _name)
    if isinstance(_value, ManimColor) and not _name.startswith("_"):
        _NAMED_COLORS.setdefault(_value.to_hex().upper(), _name)


def format_default(value: Any) -> tuple[str | None, str | None]:
    """Return (source expression, display text), or (None, None) when required."""
    if value is inspect.Parameter.empty:
        return None, None
    source = _source(value)
    return source, source


def _source(value: Any) -> str:
    if value is None or isinstance(value, bool | str):
        return repr(value)
    if isinstance(value, int):
        return repr(value)
    if isinstance(value, float):
        for name, angle in _ANGLES:
            if math.isclose(value, angle):
                return name
        return repr(value)
    if isinstance(value, ManimColor):
        hex_value = value.to_hex().upper()
        return _NAMED_COLORS.get(hex_value, f'ManimColor("{hex_value}")')
    if isinstance(value, np.ndarray):
        for name, direction in _DIRECTIONS:
            if value.shape == direction.shape and np.array_equal(value, direction):
                return name
        return f"np.array({value.tolist()!r})"
    if isinstance(value, Enum):
        return f"{type(value).__name__}.{value.name}"
    if isinstance(value, type):
        return value.__name__
    if inspect.isfunction(value) or inspect.isbuiltin(value):
        return value.__name__ if value.__name__ != "<lambda>" else "lambda"
    if isinstance(value, list | tuple):
        inner = ", ".join(_source(item) for item in value)
        if isinstance(value, tuple):
            return f"({inner},)" if len(value) == 1 else f"({inner})"
        return f"[{inner}]"
    if isinstance(value, dict):
        inner = ", ".join(f"{k!r}: {_source(v)}" for k, v in value.items())
        return "{" + inner + "}"
    return repr(value)
