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
    collection: bool = False,
    choices: list[str] | None = None,
) -> Parameter:
    return Parameter(
        name=name,
        type=TypeRef(
            type=port,
            annotation=annotation or port.value,
            optional=default == "None",
            accepts=accepts or [],
            signature=signature,
            collection=collection,
            choices=choices,
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

CONFIG = _node(
    "Config",
    "logic",
    "A dict of named values for parameters such as axis_config or t2c. "
    "Add keys in the inspector; each key is a port.",
    [],
    TypeRef(type=PortType.CONFIG, annotation="dict"),
)

RANGE = _node(
    "Range",
    "logic",
    "Numbers from start to stop (excluded) in steps, like np.arange.",
    [
        _param("start", PortType.NUMBER, "0", "float"),
        _param("stop", PortType.NUMBER, None, "float"),
        _param("step", PortType.NUMBER, "1", "float"),
    ],
    TypeRef(type=PortType.NUMBER, annotation="list[float]", collection=True),
)

IF = _node(
    "If",
    "logic",
    "One of two values, chosen by a condition (an Expression such as x > 0).",
    [
        _param("condition", PortType.BOOLEAN, None, "bool"),
        _param("then", PortType.ANY, None, "Any"),
        _param("else", PortType.ANY, None, "Any"),
    ],
    TypeRef(type=PortType.ANY, annotation="Any"),
)

MAP = _node(
    "Map",
    "logic",
    "Runs the nodes inside it once per item of a collection and collects the "
    "Result of each run. Item and Index give the current item and its position. "
    "When the Result is an animation, put this on the timeline to play it once "
    "per item.",
    [_param("items", PortType.ANY, None, "Iterable", collection=True)],
    TypeRef(type=PortType.ANY, annotation="list", collection=True),
)

REPEAT = _node(
    "Repeat",
    "logic",
    "Runs the nodes inside it count times and collects the Result of each run. "
    "Index gives the current position. When the Result is an animation, put this "
    "on the timeline to play it count times.",
    [_param("count", PortType.NUMBER, None, "int")],
    TypeRef(type=PortType.ANY, annotation="list", collection=True),
)

ITEM = _node(
    "Item",
    "logic",
    "The current item of the Map this node is inside.",
    [],
    TypeRef(type=PortType.ANY, annotation="Any"),
)

INDEX = _node(
    "Index",
    "logic",
    "The position of the current run of the Map or Repeat this node is inside.",
    [],
    TypeRef(type=PortType.NUMBER, annotation="int"),
)

RESULT = _node(
    "Result",
    "logic",
    "What each run of the Map or Repeat this node is inside contributes.",
    [_param("value", PortType.ANY, None, "Any")],
    TypeRef(type=PortType.NONE, annotation="None"),
)

PORT_TYPE_NAMES = [
    t.value for t in PortType if t not in (PortType.NONE, PortType.SCENE)
]

INPUT = _node(
    "Input",
    "group",
    "An input of the reusable group this node is inside, with its name and type.",
    [
        _param("name", PortType.TEXT, "'input'", "str"),
        _param("type", PortType.TEXT, "'number'", "str", choices=PORT_TYPE_NAMES),
    ],
    TypeRef(type=PortType.ANY, annotation="Any"),
)

OUTPUT = _node(
    "Output",
    "group",
    "The output of the reusable group this node is inside.",
    [_param("value", PortType.ANY, None, "Any")],
    TypeRef(type=PortType.NONE, annotation="None"),
)

SUBMOBJECT = _node(
    "Submobject",
    "query",
    "One part of an object by position (mobject.submobjects[index]).",
    [
        _param("mobject", PortType.MOBJECT, None, "Mobject"),
        _param("index", PortType.NUMBER, "0", "int"),
    ],
    TypeRef(type=PortType.MOBJECT, annotation="Mobject"),
)

SUBMOBJECTS = _node(
    "Submobjects",
    "query",
    "The direct parts of an object (mobject.submobjects), a collection.",
    [_param("mobject", PortType.MOBJECT, None, "Mobject")],
    TypeRef(type=PortType.MOBJECT, annotation="list[Mobject]", collection=True),
)

CAMERA_FRAME = _node(
    "CameraFrame",
    "camera",
    "The camera's frame as an object (MovingCameraScene and ZoomedScene): "
    "move or scale it to pan and zoom.",
    [],
    TypeRef(type=PortType.MOBJECT, annotation="ScreenRectangle"),
)

NUMBER = _node(
    "Number",
    "value",
    "A number you type, to share between ports or feed an If.",
    [_param("value", PortType.NUMBER, "0", "float")],
    TypeRef(type=PortType.NUMBER, annotation="float"),
)

POINT = _node(
    "Coordinates",
    "value",
    "A point or direction from x, y, z (Manim's Point is a point cloud object).",
    [
        _param("x", PortType.NUMBER, "0", "float"),
        _param("y", PortType.NUMBER, "0", "float"),
        _param("z", PortType.NUMBER, "0", "float"),
    ],
    TypeRef(type=PortType.VECTOR, annotation="Point3D"),
)

COLOR = _node(
    "Color",
    "value",
    "A colour from Manim's palette or a hex value, to share or choose with an If.",
    [_param("color", PortType.COLOR, "WHITE", "ParsableManimColor")],
    TypeRef(type=PortType.COLOR, annotation="ManimColor"),
)

BUILTINS = [
    EXPRESSION,
    NUMBER,
    POINT,
    COLOR,
    DERIVATIVE,
    SCENE_TIME,
    FRAME_DELTA,
    STATE,
    ANIMATE,
    CONFIG,
    RANGE,
    IF,
    MAP,
    REPEAT,
    ITEM,
    INDEX,
    RESULT,
    INPUT,
    OUTPUT,
    SUBMOBJECT,
    SUBMOBJECTS,
    CAMERA_FRAME,
]

CONTAINERS = {MAP.name, REPEAT.name}
# Nodes that only mean something inside a Map or Repeat.
CONTAINER_LOCALS = {ITEM.name, INDEX.name, RESULT.name}
# Nodes that only mean something inside a reusable group.
GROUP_PORTS = {INPUT.name, OUTPUT.name}

# Builtins whose output changes every frame without any live input.
ALWAYS_LIVE = {SCENE_TIME.name, FRAME_DELTA.name, STATE.name}
