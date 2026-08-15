from __future__ import annotations

import sys
from typing import Any

from engine.catalogue import get_catalogue
from engine.info import engine_info
from engine.rpc import Dispatcher, serve


def build_dispatcher() -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.register("ping", lambda: "pong")
    dispatcher.register("engine.info", _info)
    dispatcher.register("catalogue.list", _catalogue_list)
    dispatcher.register("catalogue.get", _catalogue_get)
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


def main() -> None:
    # The protocol owns the real stdout. Anything a library prints goes to stderr.
    rpc_out = sys.stdout.buffer
    sys.stdout = sys.stderr
    serve(build_dispatcher(), sys.stdin.buffer, rpc_out)


if __name__ == "__main__":
    main()
