from __future__ import annotations

from enum import Enum

from engine.catalogue.annotations import TypeContext, map_annotation, parse
from engine.catalogue.model import PortType


class Joint(Enum):
    AUTO = 0
    ROUND = 1


def context() -> TypeContext:
    return TypeContext(
        classes={
            "Mobject": PortType.MOBJECT,
            "VMobject": PortType.MOBJECT,
            "VGroup": PortType.MOBJECT,
            "Surface": PortType.MOBJECT,
            "Vector": PortType.MOBJECT,
            "Point": PortType.MOBJECT,
            "Axes": PortType.COORDINATE_SYSTEM,
            "Animation": PortType.ANIMATION,
            "ValueTracker": PortType.LIVE_NUMBER,
        },
        namespace={"LineJointType": Joint},
    )


def test_parse_nested_union_and_brackets() -> None:
    members = parse(
        "Iterable[ParsableManimColor, float] | Callable[[float], float] | None"
    )
    assert [m.name for m in members] == ["Iterable", "Callable", "None"]
    assert [a.name for a in members[0].args] == ["ParsableManimColor", "float"]
    assert members[1].args[0].name == "[]"
    assert members[1].args[0].args[0].name == "float"


def test_optional_number() -> None:
    ref = map_annotation("float | None", context())
    assert ref.type is PortType.NUMBER
    assert ref.optional is True
    assert ref.accepts == []


def test_color_alias() -> None:
    assert map_annotation("ParsableManimColor | None", context()).type is PortType.COLOR


def test_exported_class_names_win_over_alias_patterns() -> None:
    assert map_annotation("Vector", context()).type is PortType.MOBJECT
    assert map_annotation("Point", context()).type is PortType.MOBJECT
    assert map_annotation("Vector3DLike", context()).type is PortType.VECTOR


def test_vector_aliases() -> None:
    assert map_annotation("Point3DLike", context()).type is PortType.VECTOR
    ref = map_annotation("Point3DLike_Array", context())
    assert ref.type is PortType.VECTOR
    assert ref.collection is True


def test_callable_signature() -> None:
    ref = map_annotation("Callable[[float], float]", context())
    assert ref.type is PortType.FUNCTION
    assert ref.signature == "(float) -> float"
    ref = map_annotation(
        "Callable[[float, float, float, float], tuple[float, float, float]]", context()
    )
    assert ref.signature == "(float, float, float, float) -> tuple[float, float, float]"


def test_collection_of_numbers() -> None:
    ref = map_annotation("Sequence[float] | None", context())
    assert ref.type is PortType.NUMBER
    assert ref.collection is True
    assert ref.optional is True


def test_self_takes_owner_type() -> None:
    assert map_annotation("Self", context(), PortType.MOBJECT).type is PortType.MOBJECT


def test_opengl_names_map_to_plain_classes() -> None:
    ref = map_annotation("VMobject | OpenGLVMobject | OpenGLSurface", context())
    assert ref.type is PortType.MOBJECT
    assert ref.accepts == []


def test_union_of_different_types_keeps_alternatives() -> None:
    ref = map_annotation("Point3DLike | Mobject", context())
    assert ref.type is PortType.MOBJECT
    assert ref.accepts == [PortType.MOBJECT, PortType.VECTOR]


def test_enum_and_literal_become_choices() -> None:
    ref = map_annotation("LineJointType | None", context())
    assert ref.type is PortType.TEXT
    assert ref.choices == ["LineJointType.AUTO", "LineJointType.ROUND"]
    ref = map_annotation("Literal['rectangle', 'window']", context())
    assert ref.choices == ["'rectangle'", "'window'"]


def test_unknown_member_does_not_pollute_accepts() -> None:
    ref = map_annotation("Mobject | SomethingElse", context())
    assert ref.type is PortType.MOBJECT
    assert ref.accepts == []


def test_class_reference_is_a_text_field() -> None:
    ctx = context()
    ref = map_annotation("type[Rectangle] | type[Circle]", ctx)
    assert ref.type is PortType.TEXT
    assert ctx.unknown == set()


def test_dict_is_config_and_unknown_is_recorded() -> None:
    ctx = context()
    assert map_annotation("dict | None", ctx).type is PortType.CONFIG
    assert map_annotation("SomethingElse", ctx).type is PortType.ANY
    assert ctx.unknown == {"SomethingElse"}
