"""The visual project document: the file the user edits. Code is derived from it."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

# Literal port values as stored in the document. The catalogue parameter type
# decides how a value is written as Manim source.
JsonValue = str | float | int | bool | list[float] | None

# Port name for the object a method node is called on.
SELF_PORT = "self"


class Node(BaseModel):
    id: str
    catalogue: str
    values: dict[str, JsonValue] = {}
    label: str | None = None
    position: tuple[float, float] = (0.0, 0.0)
    collapsed: bool = True


class Edge(BaseModel):
    source: str
    target: str
    port: str
    live: bool = False


class PlayStep(BaseModel):
    kind: Literal["play"] = "play"
    animations: list[str]


class WaitStep(BaseModel):
    kind: Literal["wait"] = "wait"
    duration: float = 1.0


class AddStep(BaseModel):
    kind: Literal["add"] = "add"
    mobjects: list[str]


class RemoveStep(BaseModel):
    kind: Literal["remove"] = "remove"
    mobjects: list[str]


Step = Annotated[
    PlayStep | WaitStep | AddStep | RemoveStep, Field(discriminator="kind")
]


class SceneDocument(BaseModel):
    name: str = "Scene1"
    nodes: list[Node] = []
    edges: list[Edge] = []
    steps: list[Step] = []


class Settings(BaseModel):
    pixel_width: int = 1920
    pixel_height: int = 1080
    frame_rate: float = 60
    background_color: str = "BLACK"


class Document(BaseModel):
    version: Literal[1] = 1
    settings: Settings = Settings()
    scenes: list[SceneDocument] = [SceneDocument()]
