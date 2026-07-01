"""LSP JSON-RPC 2.0 framer — wire protocol over Content-Length framed streams.

LSP wire format:
    Content-Length: <bytes>\\r\\n
    \\r\\n
    <utf-8 JSON body>

The body is a JSON-RPC 2.0 envelope: request, response, or notification.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional, Tuple

logger = logging.getLogger("pulse.lsp.protocol")

ERROR_CONTENT_MODIFIED = -32801
ERROR_REQUEST_CANCELLED = -32800
ERROR_METHOD_NOT_FOUND = -32601


class LSPProtocolError(Exception):
    """Wire-protocol violation (framing/envelope broken)."""


class LSPRequestError(Exception):
    """LSP server returned a JSON-RPC error response."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(f"LSP error {code}: {message}")
        self.code = code
        self.message = message
        self.data = data


def encode_message(obj: dict) -> bytes:
    """Content-Length framed byte string from a JSON-RPC envelope."""
    body = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    header = f"Content-Length: {len(body)}\\r\\n\\r\\n".encode("ascii")
    return header + body


async def read_message(reader: asyncio.StreamReader) -> Optional[dict]:
    """Read one LSP message. Returns None on clean EOF."""
    headers: dict = {}
    hdr_bytes = 0
    while True:
        try:
            line = await reader.readuntil(b"\\r\\n")
        except asyncio.IncompleteReadError as e:
            if not e.partial and not headers:
                return None
            raise LSPProtocolError(f"unexpected EOF in headers: {e.partial!r}") from e
        hdr_bytes += len(line)
        if hdr_bytes > 8192:
            raise LSPProtocolError("header block exceeded 8 KiB")
        line = line[:-2]
        if not line:
            break
        try:
            key, _, val = line.decode("ascii").partition(":")
        except UnicodeDecodeError as e:
            raise LSPProtocolError(f"non-ASCII header: {line!r}") from e
        headers[key.strip().lower()] = val.strip()

    cl = headers.get("content-length")
    if cl is None:
        raise LSPProtocolError(f"missing Content-Length: {headers!r}")
    try:
        n = int(cl)
    except ValueError as e:
        raise LSPProtocolError(f"bad Content-Length: {cl!r}") from e
    if n < 0 or n > 64 * 1024 * 1024:
        raise LSPProtocolError(f"unreasonable Content-Length: {n}")

    try:
        body = await reader.readexactly(n)
    except asyncio.IncompleteReadError as e:
        raise LSPProtocolError(f"truncated body: expected {n}, got {len(e.partial)}") from e
    try:
        return json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise LSPProtocolError(f"body parse error: {e}") from e


def make_request(req_id: int, method: str, params: Any) -> dict:
    msg: dict = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        msg["params"] = params
    return msg


def make_notification(method: str, params: Any) -> dict:
    msg: dict = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    return msg


def make_response(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def make_error_response(req_id: Any, code: int, message: str, data: Any = None) -> dict:
    err: dict = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


def classify_message(msg: dict) -> Tuple[str, Any]:
    """Return (kind, key) where kind is request/response/notification/invalid."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
        return "invalid", None
    has_id = "id" in msg
    has_method = "method" in msg
    if has_id and has_method:
        return "request", msg["id"]
    if has_id and ("result" in msg or "error" in msg):
        return "response", msg["id"]
    if has_method and not has_id:
        return "notification", msg["method"]
    return "invalid", None


__all__ = [
    "ERROR_CONTENT_MODIFIED", "ERROR_REQUEST_CANCELLED", "ERROR_METHOD_NOT_FOUND",
    "LSPProtocolError", "LSPRequestError",
    "encode_message", "read_message",
    "make_request", "make_notification", "make_response", "make_error_response",
    "classify_message",
]
