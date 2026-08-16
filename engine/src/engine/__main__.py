from __future__ import annotations

import atexit
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from engine.catalogue import get_catalogue
from engine.codegen import ManimCodeGenerator
from engine.document import Document, SceneDocument, validate_document
from engine.info import engine_info
from engine.render import RENDER_ERROR, CairoRenderService, RenderError
from engine.rpc import Dispatcher, Notify, RpcError, serve


def build_dispatcher(cache_dir: Path | None = None) -> Dispatcher:
    if cache_dir is None:
        cache_dir = Path(tempfile.mkdtemp(prefix="mnw-"))
        atexit.register(shutil.rmtree, cache_dir, True)
    render = _RenderMethods(CairoRenderService(cache_dir))
    dispatcher = Dispatcher()
    dispatcher.register("ping", lambda: "pong")
    dispatcher.register("engine.info", _info)
    dispatcher.register("catalogue.list", _catalogue_list)
    dispatcher.register("catalogue.get", _catalogue_get)
    dispatcher.register("document.validate", _document_validate)
    dispatcher.register("document.generate", _document_generate)
    dispatcher.register("render.frame", render.frame)
    dispatcher.register("render.export", render.export, notifies=True)
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
    generated = ManimCodeGenerator().generate(_scene(parsed, scene), get_catalogue())
    return generated.model_dump()


def _scene(document: Document, name: str) -> SceneDocument:
    for candidate in document.scenes:
        if candidate.name == name:
            return candidate
    raise KeyError(f"no scene named {name}")


class _RenderMethods:
    def __init__(self, service: CairoRenderService) -> None:
        self.service = service

    def frame(
        self,
        document: dict[str, Any],
        scene: str,
        time: float,
        width: int | None = None,
    ) -> dict[str, Any]:
        parsed = Document.model_validate(document)
        try:
            result = self.service.frame(
                _scene(parsed, scene), get_catalogue(), parsed.settings, time, width
            )
        except RenderError as exc:
            raise RpcError(RENDER_ERROR, str(exc), exc.data()) from exc
        return result.model_dump()

    def export(
        self,
        document: dict[str, Any],
        scene: str,
        directory: str,
        format: str = "mp4",
        notify: Notify = lambda method, params: None,
    ) -> dict[str, Any]:
        parsed = Document.model_validate(document)
        last = -1.0

        def progress(time: float) -> None:
            nonlocal last
            if time - last >= 0.5:
                last = time
                notify("render.progress", {"scene": scene, "time": time})

        try:
            result = self.service.export(
                _scene(parsed, scene),
                get_catalogue(),
                parsed.settings,
                Path(directory),
                format,
                progress,
            )
        except RenderError as exc:
            raise RpcError(RENDER_ERROR, str(exc), exc.data()) from exc
        return result.model_dump()


def main() -> None:
    # The protocol owns the real stdout. Anything a library prints goes to stderr.
    rpc_out = sys.stdout.buffer
    sys.stdout = sys.stderr
    serve(build_dispatcher(), sys.stdin.buffer, rpc_out)


if __name__ == "__main__":
    main()
