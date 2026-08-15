from __future__ import annotations

import inspect
import math

import numpy as np
from manim import RED, CapStyleType, ManimColor, MathTex, Rectangle, smooth

from engine.catalogue.defaults import format_default


def test_required_has_no_default() -> None:
    assert format_default(inspect.Parameter.empty) == (None, None)


def test_named_color_and_custom_color() -> None:
    assert format_default(RED)[0] == "RED"
    assert format_default(ManimColor("#123456"))[0] == 'ManimColor("#123456")'


def test_direction_constant_and_plain_array() -> None:
    assert format_default(np.array([0.0, 0.0, 0.0]))[0] == "ORIGIN"
    assert format_default(np.array([-1.0, 1.0, 0.0]))[0] == "UL"
    assert format_default(np.array([2.0, 0.0, 0.0]))[0] == "np.array([2.0, 0.0, 0.0])"


def test_angles_functions_enums_and_classes() -> None:
    assert format_default(math.pi / 2)[0] == "PI / 2"
    assert format_default(math.tau)[0] == "TAU"
    assert format_default(0.25)[0] == "0.25"
    assert format_default(smooth)[0] == "smooth"
    assert format_default(CapStyleType.AUTO)[0] == "CapStyleType.AUTO"
    assert format_default(Rectangle)[0] == "Rectangle"
    assert format_default(MathTex)[0] == "MathTex"


def test_plain_values() -> None:
    assert format_default(None)[0] == "None"
    assert format_default(True)[0] == "True"
    assert format_default(4)[0] == "4"
    assert format_default("align*")[0] == "'align*'"
    assert format_default((24, 24))[0] == "(24, 24)"
    assert format_default([0, 10, 1])[0] == "[0, 10, 1]"
