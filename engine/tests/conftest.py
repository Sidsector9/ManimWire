from __future__ import annotations

import pytest

from engine.catalogue import Catalogue, get_catalogue
from engine.document import Edge, Node, PlayStep, SceneDocument


@pytest.fixture(scope="session")
def catalogue() -> Catalogue:
    return get_catalogue()


def make_simple_scene() -> SceneDocument:
    """Circle -> set_fill(BLUE) -> Create, the first milestone scene."""
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


@pytest.fixture
def simple_scene() -> SceneDocument:
    return make_simple_scene()
