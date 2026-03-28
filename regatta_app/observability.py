from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
import contextvars
import json
import logging
import threading
import time
import uuid
from typing import Any

from flask import Flask, Response, current_app, g, has_app_context, has_request_context, request
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest


_request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")
_room_status_lock = threading.Lock()
_room_statuses: dict[str, str] = {}

RESERVED_LOG_RECORD_KEYS = {
    "args",
    "asctime",
    "created",
    "exc_info",
    "exc_text",
    "filename",
    "funcName",
    "levelname",
    "levelno",
    "lineno",
    "module",
    "msecs",
    "message",
    "msg",
    "name",
    "pathname",
    "process",
    "processName",
    "relativeCreated",
    "stack_info",
    "thread",
    "threadName",
}

HTTP_REQUESTS_TOTAL = Counter(
    "regatta_http_requests_total",
    "HTTP requests handled by endpoint, method, and status.",
    ("endpoint", "method", "status"),
)
HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "regatta_http_request_duration_seconds",
    "HTTP request duration by endpoint, method, and status.",
    ("endpoint", "method", "status"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.4, 1.0, 2.0, 5.0),
)
HTTP_REQUEST_BYTES_TOTAL = Counter(
    "regatta_http_request_bytes",
    "Inbound HTTP payload bytes by endpoint and method.",
    ("endpoint", "method"),
)
HTTP_RESPONSE_BYTES_TOTAL = Counter(
    "regatta_http_response_bytes",
    "Outbound HTTP payload bytes by endpoint, method, and status.",
    ("endpoint", "method", "status"),
)
SOCKET_EVENTS_TOTAL = Counter(
    "regatta_socket_events_total",
    "Socket.IO events handled by event name and result.",
    ("event", "result"),
)
SOCKET_EVENT_DURATION_SECONDS = Histogram(
    "regatta_socket_event_duration_seconds",
    "Socket.IO event handling duration.",
    ("event", "result"),
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0),
)
SOCKET_PAYLOAD_BYTES_TOTAL = Counter(
    "regatta_socket_payload_bytes",
    "Socket.IO payload bytes by event and direction.",
    ("event", "direction"),
)
SOCKET_CONNECTED_CLIENTS = Gauge(
    "regatta_socket_connected_clients",
    "Connected player socket count observed by this process.",
)
ROOMS_TOTAL = Gauge(
    "regatta_rooms_total",
    "Observed room count by status handled by this process.",
    ("status",),
)
ROOM_PLAYERS_HISTOGRAM = Histogram(
    "regatta_room_players_histogram",
    "Player count per room snapshot/save.",
    buckets=(0, 1, 2, 4, 8, 12, 16, 20, 24),
)
REALTIME_LOOPS_ACTIVE = Gauge(
    "regatta_realtime_loops_active",
    "Realtime room loops currently active in this process.",
)
REALTIME_TICKS_TOTAL = Counter(
    "regatta_realtime_ticks_total",
    "Realtime loop ticks by result.",
    ("result",),
)
REALTIME_TICK_DURATION_SECONDS = Histogram(
    "regatta_realtime_tick_duration_seconds",
    "End-to-end realtime tick duration.",
    buckets=(0.001, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.2, 0.5, 1.0),
)
REALTIME_TICK_DRIFT_SECONDS = Histogram(
    "regatta_realtime_tick_drift_seconds",
    "Realtime loop drift above the tick budget.",
    buckets=(0.0, 0.001, 0.005, 0.01, 0.02, 0.04, 0.08, 0.2, 1.0),
)
REALTIME_TICK_CHANGED_TOTAL = Counter(
    "regatta_realtime_tick_changed_total",
    "Realtime ticks that changed room state.",
)
REALTIME_TICK_NOOP_TOTAL = Counter(
    "regatta_realtime_tick_noop_total",
    "Realtime ticks that did not change room state.",
)
ROOM_STORE_OPERATIONS_TOTAL = Counter(
    "regatta_room_store_operations_total",
    "Room store operations by operation, backend, and result.",
    ("operation", "backend", "result"),
)
ROOM_STORE_DURATION_SECONDS = Histogram(
    "regatta_room_store_duration_seconds",
    "Room store operation duration.",
    ("operation", "backend", "result"),
    buckets=(0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0),
)
ROOM_STORE_PAYLOAD_BYTES = Histogram(
    "regatta_room_store_payload_bytes",
    "Serialized room payload size for room store operations.",
    ("operation", "backend"),
    buckets=(0, 256, 1024, 4096, 16384, 65536, 262144, 524288, 1048576),
)
PUBLIC_ROOM_VIEW_DURATION_SECONDS = Histogram(
    "regatta_public_room_view_duration_seconds",
    "Time spent building a public room snapshot.",
    buckets=(0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25),
)
PUBLIC_ROOM_VIEW_PAYLOAD_BYTES = Histogram(
    "regatta_public_room_view_payload_bytes",
    "Payload size of a public room snapshot.",
    buckets=(0, 512, 2048, 8192, 32768, 131072, 524288),
)
GAME_STATE_VALIDATION_DURATION_SECONDS = Histogram(
    "regatta_game_state_validation_duration_seconds",
    "Time spent validating incoming game state payloads.",
    buckets=(0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25),
)
GAME_STATE_PAYLOAD_BYTES = Histogram(
    "regatta_game_state_payload_bytes",
    "Size of validated game state payloads.",
    buckets=(0, 512, 2048, 8192, 32768, 131072, 524288),
)
ERRORS_TOTAL = Counter(
    "regatta_errors_total",
    "Application errors by source and kind.",
    ("source", "kind"),
)
CLIENT_TELEMETRY_EVENTS_TOTAL = Counter(
    "regatta_client_telemetry_events_total",
    "Client telemetry events accepted by event name.",
    ("event",),
)
CLIENT_TELEMETRY_DURATION_SECONDS = Histogram(
    "regatta_client_telemetry_duration_seconds",
    "Client-reported durations by event name.",
    ("event",),
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0),
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _round_float(value: float) -> float:
    return round(value, 4)


def _log_value(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return f"{value:.4f}".rstrip("0").rstrip(".")
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def current_request_id() -> str:
    if has_request_context():
        request_id = getattr(g, "request_id", "")
        if request_id:
            return request_id
    return _request_id_var.get("")


def make_request_id(prefix: str = "req") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def payload_bytes(payload: Any) -> int:
    if payload is None:
        return 0
    if isinstance(payload, (bytes, bytearray)):
        return len(payload)
    if isinstance(payload, str):
        return len(payload.encode("utf-8"))
    try:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    except TypeError:
        encoded = str(payload)
    return len(encoded.encode("utf-8"))


def app_config_bool(key: str, default: bool = False) -> bool:
    if not has_app_context():
        return default
    return bool(current_app.config.get(key, default))


def metrics_enabled() -> bool:
    return app_config_bool("METRICS_ENABLED", False)


def structured_logs_enabled() -> bool:
    return app_config_bool("STRUCTURED_LOGS", False)


def client_telemetry_enabled() -> bool:
    return app_config_bool("CLIENT_TELEMETRY_ENABLED", False)


def slow_tick_warn_seconds() -> float:
    if not has_app_context():
        return 0.04
    raw_value = current_app.config.get("SLOW_TICK_WARN_MS", 40)
    try:
        return max(float(raw_value) / 1000.0, 0.0)
    except (TypeError, ValueError):
        return 0.04


def realtime_trace_collisions_enabled() -> bool:
    if not has_app_context():
        return False
    if bool(current_app.config.get("TESTING")):
        return True
    return bool(
        current_app.config.get("REALTIME_TRACE_COLLISIONS")
        or current_app.config.get("REALTIME_DEBUG_LOGS")
    )


def http_endpoint_label() -> str:
    rule = getattr(request, "url_rule", None)
    if rule is not None and getattr(rule, "rule", None):
        return str(rule.rule)
    return request.path or "unknown"


def remote_addr_label() -> str:
    if not has_request_context():
        return "-"
    forwarded_for = request.headers.get("X-Forwarded-For", "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.remote_addr or "-"


def log_event(
    logger: logging.Logger,
    event_name: str,
    *,
    level: int = logging.INFO,
    message: str | None = None,
    **fields: Any,
) -> None:
    request_id = fields.pop("request_id", None) or current_request_id()
    if message is None:
        message = event_name
        if fields:
            parts = " ".join(f"{key}={_log_value(value)}" for key, value in fields.items())
            if parts:
                message = f"{event_name} {parts}"
    extra = {
        "event_name": event_name,
        "event_fields": fields,
        "request_id": request_id,
    }
    logger.log(level, message, extra=extra)


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        event_name = getattr(record, "event_name", None)
        payload: dict[str, Any] = {
            "ts": _utc_now_iso(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if event_name:
            payload["event"] = event_name
        request_id = getattr(record, "request_id", None)
        if request_id:
            payload["request_id"] = request_id

        extra_fields = getattr(record, "event_fields", None) or {}
        payload.update(extra_fields)

        for key, value in record.__dict__.items():
            if key in RESERVED_LOG_RECORD_KEYS or key in {"event_name", "event_fields", "request_id"}:
                continue
            payload.setdefault(key, value)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_json_logging(app: Flask) -> None:
    if not bool(app.config.get("STRUCTURED_LOGS")):
        return
    formatter = JsonLogFormatter()
    if not app.logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        app.logger.addHandler(handler)
    for handler in app.logger.handlers:
        handler.setFormatter(formatter)


def register_observability(app: Flask) -> None:
    @app.before_request
    def _before_request() -> None:
        request_id = request.headers.get("X-Request-Id", "").strip() or make_request_id("req")
        g.request_id = request_id
        g.request_started_at = time.perf_counter()
        g.request_id_token = _request_id_var.set(request_id)
        content_length = int(request.content_length or 0)
        if metrics_enabled():
            HTTP_REQUEST_BYTES_TOTAL.labels(endpoint=http_endpoint_label(), method=request.method).inc(content_length)
        log_event(
            app.logger,
            "http.request",
            method=request.method,
            endpoint=http_endpoint_label(),
            remote_addr=remote_addr_label(),
            payload_bytes=content_length,
        )

    @app.after_request
    def _after_request(response: Response) -> Response:
        request_id = current_request_id() or make_request_id("req")
        response.headers["X-Request-Id"] = request_id
        started_at = getattr(g, "request_started_at", None)
        duration_seconds = max(time.perf_counter() - started_at, 0.0) if started_at else 0.0
        endpoint = http_endpoint_label()
        method = request.method
        status = str(response.status_code)
        response_bytes = response.calculate_content_length()
        if response_bytes is None:
            response_bytes = len(response.get_data(as_text=False) or b"")
        if metrics_enabled():
            HTTP_REQUESTS_TOTAL.labels(endpoint=endpoint, method=method, status=status).inc()
            HTTP_REQUEST_DURATION_SECONDS.labels(endpoint=endpoint, method=method, status=status).observe(duration_seconds)
            HTTP_RESPONSE_BYTES_TOTAL.labels(endpoint=endpoint, method=method, status=status).inc(max(response_bytes, 0))
        log_event(
            app.logger,
            "http.response",
            method=method,
            endpoint=endpoint,
            status=response.status_code,
            duration_ms=_round_float(duration_seconds * 1000.0),
            payload_bytes=max(response_bytes, 0),
        )
        return response

    @app.teardown_request
    def _teardown_request(_exc: BaseException | None) -> None:
        token = getattr(g, "request_id_token", None)
        if token is not None:
            _request_id_var.reset(token)

    @app.get("/metrics")
    def metrics() -> Response:
        return Response(generate_latest(), mimetype=CONTENT_TYPE_LATEST)


def observe_room_store_operation(
    operation: str,
    backend: str,
    started_at: float,
    *,
    result: str = "ok",
    payload_size: int = 0,
) -> None:
    if not metrics_enabled():
        return
    duration_seconds = max(time.perf_counter() - started_at, 0.0)
    ROOM_STORE_OPERATIONS_TOTAL.labels(operation=operation, backend=backend, result=result).inc()
    ROOM_STORE_DURATION_SECONDS.labels(operation=operation, backend=backend, result=result).observe(duration_seconds)
    if payload_size > 0:
        ROOM_STORE_PAYLOAD_BYTES.labels(operation=operation, backend=backend).observe(payload_size)


def observe_public_room_view(duration_seconds: float, payload_size: int, player_count: int) -> None:
    if not metrics_enabled():
        return
    PUBLIC_ROOM_VIEW_DURATION_SECONDS.observe(max(duration_seconds, 0.0))
    PUBLIC_ROOM_VIEW_PAYLOAD_BYTES.observe(max(payload_size, 0))
    ROOM_PLAYERS_HISTOGRAM.observe(max(player_count, 0))


def observe_game_state_validation(duration_seconds: float, payload_size: int) -> None:
    if not metrics_enabled():
        return
    GAME_STATE_VALIDATION_DURATION_SECONDS.observe(max(duration_seconds, 0.0))
    GAME_STATE_PAYLOAD_BYTES.observe(max(payload_size, 0))


def observe_socket_event(
    event_name: str,
    *,
    started_at: float,
    result: str,
    payload_size: int,
    room_code: str | None = None,
    player_token_present: bool | None = None,
    error_kind: str | None = None,
    revision: int | None = None,
    snapshot_sent: bool | None = None,
) -> None:
    duration_seconds = max(time.perf_counter() - started_at, 0.0)
    if metrics_enabled():
        SOCKET_EVENTS_TOTAL.labels(event=event_name, result=result).inc()
        SOCKET_EVENT_DURATION_SECONDS.labels(event=event_name, result=result).observe(duration_seconds)
        SOCKET_PAYLOAD_BYTES_TOTAL.labels(event=event_name, direction="in").inc(max(payload_size, 0))
    logger = current_app.logger if has_app_context() else logging.getLogger(__name__)
    log_level = logging.WARNING if result != "ok" else logging.INFO
    event_type = "socket.event.failed" if result != "ok" else "socket.event.handled"
    fields: dict[str, Any] = {
        "socket_event": event_name,
        "result": result,
        "duration_ms": _round_float(duration_seconds * 1000.0),
        "payload_bytes": max(payload_size, 0),
        "room_code": room_code or "-",
        "player_token_present": player_token_present if player_token_present is not None else False,
    }
    if revision is not None:
        fields["revision"] = revision
    if snapshot_sent is not None:
        fields["snapshot_sent"] = snapshot_sent
    if error_kind:
        fields["error_kind"] = error_kind
    log_event(logger, event_type, level=log_level, **fields)


def observe_socket_outbound(event_name: str, payload_size: int) -> None:
    if metrics_enabled():
        SOCKET_PAYLOAD_BYTES_TOTAL.labels(event=event_name, direction="out").inc(max(payload_size, 0))


def observe_error(source: str, kind: str) -> None:
    if metrics_enabled():
        ERRORS_TOTAL.labels(source=source, kind=kind).inc()


def set_connected_clients(count: int) -> None:
    if metrics_enabled():
        SOCKET_CONNECTED_CLIENTS.set(max(count, 0))


def set_realtime_loops_active(count: int) -> None:
    if metrics_enabled():
        REALTIME_LOOPS_ACTIVE.set(max(count, 0))


def observe_realtime_tick(
    *,
    tick_budget_seconds: float,
    started_at: float,
    changed: bool,
    room_code: str,
    revision: int | None,
) -> None:
    duration_seconds = max(time.perf_counter() - started_at, 0.0)
    drift_seconds = max(duration_seconds - max(tick_budget_seconds, 0.0), 0.0)
    if metrics_enabled():
        REALTIME_TICK_DURATION_SECONDS.observe(duration_seconds)
        REALTIME_TICK_DRIFT_SECONDS.observe(drift_seconds)
        REALTIME_TICKS_TOTAL.labels(result="changed" if changed else "noop").inc()
        if changed:
            REALTIME_TICK_CHANGED_TOTAL.inc()
        else:
            REALTIME_TICK_NOOP_TOTAL.inc()
    logger = current_app.logger if has_app_context() else logging.getLogger(__name__)
    if logger.isEnabledFor(logging.DEBUG):
        log_event(
            logger,
            "realtime.loop.tick",
            level=logging.DEBUG,
            room_code=room_code,
            revision=revision,
            changed=changed,
            duration_ms=_round_float(duration_seconds * 1000.0),
            drift_ms=_round_float(drift_seconds * 1000.0),
        )
    if duration_seconds >= slow_tick_warn_seconds():
        log_event(
            logger,
            "realtime.loop.tick.slow",
            level=logging.WARNING,
            room_code=room_code,
            revision=revision,
            duration_ms=_round_float(duration_seconds * 1000.0),
            drift_ms=_round_float(drift_seconds * 1000.0),
            tick_budget_ms=_round_float(tick_budget_seconds * 1000.0),
        )


def update_room_status(room_code: str, status: str) -> None:
    with _room_status_lock:
        previous_status = _room_statuses.get(room_code)
        if previous_status == status:
            return
        if previous_status:
            ROOMS_TOTAL.labels(status=previous_status).dec()
        _room_statuses[room_code] = status
        ROOMS_TOTAL.labels(status=status).inc()


def remove_room_status(room_code: str) -> None:
    with _room_status_lock:
        previous_status = _room_statuses.pop(room_code, None)
        if previous_status:
            ROOMS_TOTAL.labels(status=previous_status).dec()


def observe_client_telemetry_batch(events: list[dict[str, Any]]) -> int:
    accepted = 0
    for entry in events:
        event_name = entry.get("event")
        if not isinstance(event_name, str) or not event_name:
            continue
        accepted += 1
        if metrics_enabled():
            CLIENT_TELEMETRY_EVENTS_TOTAL.labels(event=event_name).inc()
            duration_ms = entry.get("duration_ms")
            if isinstance(duration_ms, (int, float)) and duration_ms >= 0:
                CLIENT_TELEMETRY_DURATION_SECONDS.labels(event=event_name).observe(float(duration_ms) / 1000.0)
    return accepted


@contextmanager
def correlation_scope(prefix: str = "req") -> Iterator[str]:
    correlation_id = make_request_id(prefix)
    token = _request_id_var.set(correlation_id)
    try:
        yield correlation_id
    finally:
        _request_id_var.reset(token)
