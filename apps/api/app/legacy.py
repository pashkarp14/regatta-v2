from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from fastapi import Request
from fastapi.responses import Response
import httpx

from regatta_app.factory import create_app as create_legacy_flask_app


_HOP_BY_HOP_HEADERS = {
    "connection",
    "content-length",
    "cookie",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

_RESPONSE_HEADER_BLACKLIST = {
    "connection",
    "content-encoding",
    "content-length",
    "content-type",
    "transfer-encoding",
}


def build_forward_headers(request: Request) -> dict[str, str]:
    return {
        header_name: header_value
        for header_name, header_value in request.headers.items()
        if header_name.lower() not in _HOP_BY_HOP_HEADERS
    }


def proxy_response(legacy_response: httpx.Response) -> Response:
    media_type = legacy_response.headers.get("content-type")
    response = Response(
        content=legacy_response.content,
        status_code=legacy_response.status_code,
        media_type=media_type,
    )
    for header_name, header_value in legacy_response.headers.multi_items():
        if header_name.lower() in _RESPONSE_HEADER_BLACKLIST:
            continue
        response.raw_headers.append((header_name.encode("latin-1"), header_value.encode("latin-1")))
    return response


class LegacyBridge:
    def __init__(self) -> None:
        self.legacy_app = create_legacy_flask_app()
        self._client = httpx.Client(
            transport=httpx.WSGITransport(app=self.legacy_app, raise_app_exceptions=True),
            base_url="http://legacy.regatta.local",
            follow_redirects=False,
        )

    def close(self) -> None:
        self._client.close()

    def request(
        self,
        request: Request,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        params: Iterable[tuple[str, str]] | None = None,
    ) -> httpx.Response:
        return self._client.request(
            method,
            path,
            headers=build_forward_headers(request),
            cookies=request.cookies,
            json=json_body,
            params=list(params) if params is not None else list(request.query_params.multi_items()),
        )
