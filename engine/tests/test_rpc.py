from __future__ import annotations

import io
from typing import Any

from engine.rpc import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    METHOD_NOT_FOUND,
    Dispatcher,
    read_message,
    serve,
    write_message,
)


def request(method: str, params: Any = None, request_id: Any = 1) -> dict[str, Any]:
    message: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        message["params"] = params
    return message


def make_dispatcher() -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.register("add", lambda a, b: a + b)
    dispatcher.register("boom", _boom)
    return dispatcher


def _boom() -> None:
    raise RuntimeError("exploded")


def test_positional_and_keyword_params() -> None:
    dispatcher = make_dispatcher()
    assert dispatcher.handle(request("add", [1, 2])) == {
        "jsonrpc": "2.0",
        "id": 1,
        "result": 3,
    }
    assert dispatcher.handle(request("add", {"a": 2, "b": 5}, "x")) == {
        "jsonrpc": "2.0",
        "id": "x",
        "result": 7,
    }


def test_unknown_method() -> None:
    response = make_dispatcher().handle(request("nope"))
    assert response is not None
    assert response["error"]["code"] == METHOD_NOT_FOUND


def test_wrong_arity_is_invalid_params() -> None:
    response = make_dispatcher().handle(request("add", [1]))
    assert response is not None
    assert response["error"]["code"] == INVALID_PARAMS


def test_exception_is_internal_error_with_traceback() -> None:
    response = make_dispatcher().handle(request("boom", []))
    assert response is not None
    assert response["error"]["code"] == INTERNAL_ERROR
    assert response["error"]["message"] == "exploded"
    assert "RuntimeError" in response["error"]["data"]


def test_notification_has_no_response() -> None:
    message = request("add", [1, 2])
    del message["id"]
    assert make_dispatcher().handle(message) is None


def test_framing_round_trip() -> None:
    buffer = io.BytesIO()
    write_message(buffer, {"jsonrpc": "2.0", "id": 1, "result": "héllo"})
    write_message(buffer, {"jsonrpc": "2.0", "id": 2, "result": None})
    buffer.seek(0)
    assert read_message(buffer) == {"jsonrpc": "2.0", "id": 1, "result": "héllo"}
    assert read_message(buffer) == {"jsonrpc": "2.0", "id": 2, "result": None}
    assert read_message(buffer) is None


def test_serve_answers_until_stream_closes() -> None:
    stdin = io.BytesIO()
    write_message(stdin, request("add", [1, 2], 1))
    write_message(stdin, request("add", [3, 4], 2))
    stdin.seek(0)
    stdout = io.BytesIO()
    serve(make_dispatcher(), stdin, stdout)
    stdout.seek(0)
    assert read_message(stdout) == {"jsonrpc": "2.0", "id": 1, "result": 3}
    assert read_message(stdout) == {"jsonrpc": "2.0", "id": 2, "result": 7}
