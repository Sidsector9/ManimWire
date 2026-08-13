"""JSON-RPC 2.0 over a byte stream pair, framed with Content-Length headers.

The framing is the one vscode-jsonrpc uses by default, so the Electron side
needs no custom reader.
"""

from __future__ import annotations

import json
import traceback
from collections.abc import Callable
from typing import Any, BinaryIO

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

Method = Callable[..., Any]


class Dispatcher:
    def __init__(self) -> None:
        self._methods: dict[str, Method] = {}

    def register(self, name: str, method: Method) -> None:
        self._methods[name] = method

    def handle(self, request: Any) -> dict[str, Any] | None:
        """Return the response for a request, or None for a notification."""
        if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
            return _error(None, INVALID_REQUEST, "invalid request")
        request_id = request.get("id")
        method_name = request.get("method")
        if not isinstance(method_name, str):
            return _error(request_id, INVALID_REQUEST, "method must be a string")
        method = self._methods.get(method_name)
        if method is None:
            return _error(request_id, METHOD_NOT_FOUND, f"unknown method {method_name}")
        params = request.get("params", {})
        try:
            if isinstance(params, list):
                result = method(*params)
            elif isinstance(params, dict):
                result = method(**params)
            else:
                return _error(
                    request_id, INVALID_PARAMS, "params must be a list or object"
                )
        except TypeError as exc:
            return _error(request_id, INVALID_PARAMS, str(exc))
        except Exception as exc:
            return _error(request_id, INTERNAL_ERROR, str(exc), traceback.format_exc())
        if request_id is None:
            return None
        return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(
    request_id: Any, code: int, message: str, data: str | None = None
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def read_message(stream: BinaryIO) -> Any | None:
    """Read one framed message. Returns None at end of stream."""
    length: int | None = None
    while True:
        line = stream.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        name, _, value = line.decode("ascii").partition(":")
        if name.strip().lower() == "content-length":
            length = int(value.strip())
    if length is None:
        raise ValueError("missing Content-Length header")
    body = stream.read(length)
    return json.loads(body.decode("utf-8"))


def write_message(stream: BinaryIO, message: Any) -> None:
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    stream.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii"))
    stream.write(body)
    stream.flush()


def serve(dispatcher: Dispatcher, stdin: BinaryIO, stdout: BinaryIO) -> None:
    """Answer requests until the input stream closes."""
    while True:
        try:
            request = read_message(stdin)
        except (ValueError, UnicodeDecodeError) as exc:
            write_message(stdout, _error(None, PARSE_ERROR, str(exc)))
            continue
        if request is None:
            return
        response = dispatcher.handle(request)
        if response is not None:
            write_message(stdout, response)
