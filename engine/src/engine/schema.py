"""Write the JSON Schema of every RPC model: ``python -m engine.schema <directory>``."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pydantic import BaseModel

from engine.catalogue.model import Catalogue
from engine.info import EngineInfo

MODELS: dict[str, type[BaseModel]] = {
    "catalogue": Catalogue,
    "engine_info": EngineInfo,
}


def write_schemas(directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
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
