"""Nodes the engine provides because Manim has no class for them.

Each one stands for a programming construct goal.md asks for (expressions,
derivatives, time, state, and the ``.animate`` builder) and generates plain
Manim code. They are not Manim API and carry ``kind="builtin"``.
"""

from __future__ import annotations

from engine.catalogue.model import Descriptor, Parameter, PortType, TypeRef

RATE_FUNCTION = "(float) -> float"
MODULE = "engine.builtins"


def _param(
    name: str,
    port: PortType,
    default: str | None,
    annotation: str = "",
    signature: str | None = None,
    accepts: list[PortType] | None = None,
) -> Parameter:
    return Parameter(
        name=name,
        type=TypeRef(
            type=port,
            annotation=annotation or port.value,
            optional=default == "None",
            accepts=accepts or [],
            signature=signature,
        ),
        default=default,
        display=default,
        owner="engine",
    )


def _node(
    name: str, category: str, doc: str, parameters: list[Parameter], returns: TypeRef
) -> Descriptor:
    return Descriptor(
        name=name,
        qualname=name,
        module=MODULE,
        kind="builtin",
        category=category,
        parameters=parameters,
        returns=returns,
        doc=doc,
    )


EXPRESSION = _node(
    "Expression",
    "logic",
    "A mathematical expression such as x^2 or k / t. Each variable is a port; "
    "unconnected variables become the arguments of a function.",
    [_param("expr", PortType.TEXT, None, "str")],
    TypeRef(type=PortType.ANY, annotation="Expression"),
)

DERIVATIVE = _node(
    "Derivative",
    "logic",
    "The derivative of a function of one variable, by central differences.",
    [
        _param(
            "function",
            PortType.FUNCTION,
            None,
            "Callable[[float], float]",
            RATE_FUNCTION,
        )
    ],
    TypeRef(
        type=PortType.FUNCTION,
        annotation="Callable[[float], float]",
        signature=RATE_FUNCTION,
    ),
)

SCENE_TIME = _node(
    "SceneTime",
    "value",
    "Seconds since the scene started (Scene.time). Reading it makes the reader live.",
    [],
    TypeRef(type=PortType.LIVE_NUMBER, annotation="float"),
)

FRAME_DELTA = _node(
    "FrameDelta",
    "value",
    "Seconds since the previous frame (dt). Only meaningful inside an updater.",
    [],
    TypeRef(type=PortType.LIVE_NUMBER, annotation="float"),
)

STATE = _node(
    "State",
    "value",
    "A number kept between frames. Connect next to update it every frame.",
    [
        _param("initial", PortType.NUMBER, "0.0", "float"),
        _param(
            "next",
            PortType.NUMBER,
            "None",
            "float | None",
            accepts=[PortType.LIVE_NUMBER],
        ),
    ],
    TypeRef(type=PortType.LIVE_NUMBER, annotation="float"),
)

ANIMATE = _node(
    "Animate",
    "animation.builder",
    "Animate one or more method calls on an object, Manim's mobject.animate builder.",
    [
        _param(
            "mobject",
            PortType.MOBJECT,
            None,
            "Mobject",
            accepts=[PortType.LIVE_NUMBER, PortType.COORDINATE_SYSTEM],
        ),
        _param("run_time", PortType.NUMBER, "None", "float | None"),
        _param(
            "rate_func",
            PortType.FUNCTION,
            "None",
            "Callable[[float], float] | None",
            RATE_FUNCTION,
        ),
        _param("lag_ratio", PortType.NUMBER, "None", "float | None"),
    ],
    TypeRef(type=PortType.ANIMATION, annotation="Animation"),
)

BUILTINS = [EXPRESSION, DERIVATIVE, SCENE_TIME, FRAME_DELTA, STATE, ANIMATE]

# Builtins whose output changes every frame without any live input.
ALWAYS_LIVE = {SCENE_TIME.name, FRAME_DELTA.name, STATE.name}
