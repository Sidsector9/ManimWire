"""JSON-RPC 2.0 over a byte stream pair, framed with Content-Length headers.

The framing is the one vscode-jsonrpc uses by default, so the Electron side
needs no custom reader.
"""

from __future__ import annotations

import inspect
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
Notify = Callable[[str, Any], None]


class Dispatcher:
    def __init__(self) -> None:
        self._methods: dict[str, tuple[Method, bool]] = {}
        self.notify: Notify = lambda method, params: None

    def register(self, name: str, method: Method, notifies: bool = False) -> None:
        """Register a method. With ``notifies`` it receives ``notify`` as a keyword."""
        self._methods[name] = (method, notifies)

    def handle(self, request: Any) -> dict[str, Any] | None:
        """Return the response for a request, or None for a notification."""
        notification = isinstance(request, dict) and "id" not in request
        response = self._respond(request)
        return None if notification else response

    def _respond(self, request: Any) -> dict[str, Any]:
        if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
            return _error(None, INVALID_REQUEST, "invalid request")
        request_id = request.get("id")
        method_name = request.get("method")
        if not isinstance(method_name, str):
            return _error(request_id, INVALID_REQUEST, "method must be a string")
        registered = self._methods.get(method_name)
        if registered is None:
            return _error(request_id, METHOD_NOT_FOUND, f"unknown method {method_name}")
        method, notifies = registered
        params = request.get("params", {})
        if isinstance(params, list):
            args, kwargs = params, {}
        elif isinstance(params, dict):
            args, kwargs = [], dict(params)
        else:
            return _error(request_id, INVALID_PARAMS, "params must be a list or object")
        if notifies:
            kwargs["notify"] = self.notify
        try:
            inspect.signature(method).bind(*args, **kwargs)
        except TypeError as exc:
            return _error(request_id, INVALID_PARAMS, str(exc))
        try:
            result = method(*args, **kwargs)
        except RpcError as exc:
            return _error(request_id, exc.code, str(exc), exc.data)
        except Exception as exc:
            return _error(request_id, INTERNAL_ERROR, str(exc), traceback.format_exc())
        return {"jsonrpc": "2.0", "id": request_id, "result": result}


class RpcError(Exception):
    """An error with a code and structured data the client can act on."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


def _error(
    request_id: Any, code: int, message: str, data: Any = None
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

    def notify(method: str, params: Any) -> None:
        write_message(stdout, {"jsonrpc": "2.0", "method": method, "params": params})

    dispatcher.notify = notify
    while True:
        try:
            request = read_message(stdin)
        except (ValueError, UnicodeDecodeError) as exc:
            # The stream position is unknown after a framing error; stop here.
            write_message(stdout, _error(None, PARSE_ERROR, str(exc)))
            return
        if request is None:
            return
        response = dispatcher.handle(request)
        if response is not None:
            write_message(stdout, response)
