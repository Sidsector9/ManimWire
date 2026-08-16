from __future__ import annotations

import pytest

from engine.catalogue import Catalogue, get_catalogue
from engine.document import (
    Document,
    Edge,
    Node,
    PlayStep,
    SceneDocument,
    validate_document,
    validate_scene,
)


@pytest.fixture(scope="module")
def catalogue() -> Catalogue:
    return get_catalogue()


def simple_scene() -> SceneDocument:
    return SceneDocument(
        name="BlueCircle",
        nodes=[
            Node(id="c", catalogue="Circle", values={"radius": 2.0}),
            Node(
                id="f",
                catalogue="VMobject.set_fill",
                values={"color": "BLUE", "opacity": 1.0},
            ),
            Node(id="a", catalogue="Create", values={"run_time": 2.0}),
        ],
        edges=[
            Edge(source="c", target="f", port="self"),
            Edge(source="f", target="a", port="mobject"),
        ],
        steps=[PlayStep(animations=["a"])],
    )


def codes(scene: SceneDocument, catalogue: Catalogue) -> list[str]:
    return sorted(i.code for i in validate_scene(scene, catalogue))


def test_simple_scene_is_valid(
    catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    assert validate_scene(simple_scene, catalogue) == []


def test_document_round_trips_through_json(simple_scene: SceneDocument) -> None:
    document = Document(scenes=[simple_scene])
    again = Document.model_validate_json(document.model_dump_json())
    assert again == document
    assert again.scenes[0].steps[0].kind == "play"


def test_unknown_catalogue_name_and_port(
    catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    scene = simple_scene
    scene.nodes[0].catalogue = "Circel"
    scene.nodes[2].values["speed"] = 1
    assert codes(scene, catalogue) == ["unknown_catalogue", "unknown_port"]


def test_type_mismatch(catalogue: Catalogue, simple_scene: SceneDocument) -> None:
    scene = simple_scene
    scene.edges[1] = Edge(source="f", target="a", port="run_time")
    issues = validate_scene(scene, catalogue)
    assert [i.code for i in issues] == ["type_mismatch", "missing_required"]
    assert issues[0].port == "run_time"
    assert "expects number" in issues[0].message


def test_missing_required(catalogue: Catalogue, simple_scene: SceneDocument) -> None:
    scene = simple_scene
    scene.edges = []
    issues = validate_scene(scene, catalogue)
    assert {(i.node, i.port) for i in issues} == {("f", "self"), ("a", "mobject")}
    assert all(i.code == "missing_required" for i in issues)


def test_cycle(catalogue: Catalogue, simple_scene: SceneDocument) -> None:
    scene = simple_scene
    scene.edges.append(Edge(source="a", target="c", port="radius"))
    assert "cycle" in codes(scene, catalogue)


def test_bad_literals(catalogue: Catalogue, simple_scene: SceneDocument) -> None:
    scene = simple_scene
    scene.nodes[0].values["radius"] = "big"
    scene.nodes[1].values["color"] = "BLUISH"
    scene.nodes[0].values["arc_center"] = "SIDEWAYS"
    issues = validate_scene(scene, catalogue)
    assert [(i.code, i.port) for i in issues] == [
        ("bad_literal", "radius"),
        ("bad_literal", "arc_center"),
        ("bad_literal", "color"),
    ]


def test_steps_are_checked(catalogue: Catalogue, simple_scene: SceneDocument) -> None:
    scene = simple_scene
    scene.steps = [PlayStep(animations=["c"]), PlayStep(animations=["zzz"])]
    issues = validate_scene(scene, catalogue)
    assert [(i.code, i.step) for i in issues] == [
        ("not_animation", 0),
        ("unknown_node", 1),
    ]


def test_scene_name_must_be_an_identifier_and_not_scene(catalogue: Catalogue) -> None:
    document = Document(
        scenes=[SceneDocument(name="Scene"), SceneDocument(name="my scene")]
    )
    assert [i.code for i in validate_document(document, catalogue)] == [
        "bad_scene_name",
        "bad_scene_name",
    ]
