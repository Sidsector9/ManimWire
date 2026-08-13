from __future__ import annotations

import sys
from typing import Any

from engine.info import engine_info
from engine.rpc import Dispatcher, serve


def build_dispatcher() -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.register("ping", lambda: "pong")
    dispatcher.register("engine.info", _info)
    return dispatcher


def _info() -> dict[str, Any]:
    return engine_info().model_dump()


def main() -> None:
    # The protocol owns the real stdout. Anything a library prints goes to stderr.
    rpc_out = sys.stdout.buffer
    sys.stdout = sys.stderr
    serve(build_dispatcher(), sys.stdin.buffer, rpc_out)


if __name__ == "__main__":
    main()
