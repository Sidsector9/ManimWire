"""Write the JSON Schema of every RPC model: ``python -m engine.schema <directory>``."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from engine.catalogue.coverage import CoverageReport
from engine.catalogue.model import Catalogue, PortType, TypeRef
from engine.codegen import GeneratedCode
from engine.document import Document, Issue
from engine.document.validate import compatible
from engine.info import EngineInfo
from engine.render import ExportResult, FrameResult
from engine.timeline import TimelineLayout

MODELS: dict[str, type[BaseModel]] = {
    "catalogue": Catalogue,
    "engine_info": EngineInfo,
    "document": Document,
    "issue": Issue,
    "generated_code": GeneratedCode,
    "frame_result": FrameResult,
    "export_result": ExportResult,
    "timeline_layout": TimelineLayout,
    "coverage_report": CoverageReport,
}


def compatibility_table() -> list[dict[str, Any]]:
    """Every source and target port type pair with the engine's verdict.

    The renderer mirrors the rule for instant drag feedback; its test reads this
    table so the two cannot drift apart silently.
    """
    table: list[dict[str, Any]] = []
    for source in PortType:
        for target in PortType:
            ok = compatible(
                TypeRef(type=source, annotation=""), TypeRef(type=target, annotation="")
            )
            table.append({"source": source.value, "target": target.value, "ok": ok})
    table.append(
        {
            "source": "vector",
            "target": "mobject",
            "accepts": ["vector"],
            "ok": compatible(
                TypeRef(type=PortType.VECTOR, annotation=""),
                TypeRef(
                    type=PortType.MOBJECT, annotation="", accepts=[PortType.VECTOR]
                ),
            ),
        }
    )
    return table


def write_schemas(directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    fixture = directory / "compatibility.json"
    fixture.write_text(json.dumps(compatibility_table(), indent=2) + "\n")
    written.append(fixture)
    for name, model in MODELS.items():
        path = directory / f"{name}.json"
        schema = model.model_json_schema()
        schema["title"] = model.__name__
        path.write_text(json.dumps(schema, indent=2) + "\n")
        written.append(path)
    return written


if __name__ == "__main__":
    for written_path in write_schemas(Path(sys.argv[1])):
        print(written_path)
