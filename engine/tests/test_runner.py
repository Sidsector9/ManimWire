"""Scene-local capture must preserve locals, error locations and profiling tools."""

import sys
from typing import Any

import pytest

from engine.render.runner import compile_scene


@pytest.mark.parametrize("ending", ["return", "raise ValueError('stop')"])
def test_capture_on_return_or_unwind_without_global_profile(ending: str) -> None:
    source = (
        "class Test:\n"
        "    def construct(self):\n"
        "        _mnw_capture_construct_locals = 123\n"
        "        def nested():\n"
        "            return 42\n"
        "        value = nested()\n"
        f"        {ending}\n"
    )
    code, name = compile_scene(source, "Test")
    captured: dict[str, Any] = {}

    def capture() -> None:
        captured.update(sys._getframe(1).f_locals)

    namespace: dict[str, Any] = {name: capture}
    previous = sys.getprofile()
    exec(code, namespace)
    try:
        namespace["Test"]().construct()
    except ValueError as exc:
        assert exc.__traceback__ is not None
        frame = exc.__traceback__.tb_next
        assert frame is not None and frame.tb_lineno == 7
        assert frame.tb_frame.f_code.co_filename == "<scene>"
    assert sys.getprofile() is previous
    assert captured["value"] == 42
    assert captured["_mnw_capture_construct_locals"] == 123
