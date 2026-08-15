from __future__ import annotations

import sys
from typing import Any

from engine.catalogue import get_catalogue
from engine.codegen import ManimCodeGenerator
from engine.document import Document, validate_document
from engine.info import engine_info
from engine.rpc import Dispatcher, serve


def build_dispatcher() -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.register("ping", lambda: "pong")
    dispatcher.register("engine.info", _info)
    dispatcher.register("catalogue.list", _catalogue_list)
    dispatcher.register("catalogue.get", _catalogue_get)
    dispatcher.register("document.validate", _document_validate)
    dispatcher.register("document.generate", _document_generate)
    return dispatcher


def _info() -> dict[str, Any]:
    return engine_info().model_dump()


def _catalogue_list() -> dict[str, Any]:
    return get_catalogue().model_dump()


def _catalogue_get(qualname: str) -> dict[str, Any]:
    for entry in get_catalogue().entries:
        if entry.qualname == qualname:
            return entry.model_dump()
    raise KeyError(f"no catalogue entry named {qualname}")


def _document_validate(document: dict[str, Any]) -> list[dict[str, Any]]:
    issues = validate_document(Document.model_validate(document), get_catalogue())
    return [issue.model_dump() for issue in issues]


def _document_generate(document: dict[str, Any], scene: str) -> dict[str, Any]:
    parsed = Document.model_validate(document)
    for candidate in parsed.scenes:
        if candidate.name == scene:
            return (
                ManimCodeGenerator().generate(candidate, get_catalogue()).model_dump()
            )
    raise KeyError(f"no scene named {scene}")


def main() -> None:
    # The protocol owns the real stdout. Anything a library prints goes to stderr.
    rpc_out = sys.stdout.buffer
    sys.stdout = sys.stderr
    serve(build_dispatcher(), sys.stdin.buffer, rpc_out)


if __name__ == "__main__":
    main()
