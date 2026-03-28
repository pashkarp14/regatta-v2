from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
import json
import math
from pathlib import Path
import re
from typing import Any

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from tools.load.run import summarize_durations
else:
    from .run import summarize_durations


PROMETHEUS_LINE_RE = re.compile(r"^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+eE0-9.]+)$")


@dataclass(slots=True)
class MetricRow:
    name: str
    labels: dict[str, str]
    value: float


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped:
            rows.append(json.loads(stripped))
    return rows


def _parse_ts(value: str | None) -> float:
    if not value:
        return 0.0
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _unwrap_body(payload: Any) -> Any:
    if isinstance(payload, dict) and "body" in payload:
        return payload["body"]
    return payload


def _parse_labels(blob: str | None) -> dict[str, str]:
    if not blob:
        return {}
    labels: dict[str, str] = {}
    for item in blob.split(","):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        labels[key] = value.strip().strip('"')
    return labels


def parse_prometheus_text(text: str) -> list[MetricRow]:
    rows: list[MetricRow] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = PROMETHEUS_LINE_RE.match(line)
        if not match:
            continue
        rows.append(
            MetricRow(
                name=match.group(1),
                labels=_parse_labels(match.group(3)),
                value=float(match.group(4)),
            )
        )
    return rows


def _series_key(name: str, labels: dict[str, str]) -> tuple[str, tuple[tuple[str, str], ...]]:
    return name, tuple(sorted(labels.items()))


def _rows_by_series(rows: list[MetricRow]) -> dict[tuple[str, tuple[tuple[str, str], ...]], float]:
    return {_series_key(row.name, row.labels): row.value for row in rows}


def _label_string(labels: dict[str, str], *, drop: set[str] | None = None) -> str:
    keep = {key: value for key, value in labels.items() if key not in (drop or set())}
    if not keep:
        return "default"
    return ",".join(f"{key}={value}" for key, value in sorted(keep.items()))


def _summarize_http(requests: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[float]] = defaultdict(list)
    errors: Counter[str] = Counter()
    totals: Counter[str] = Counter()
    for row in requests:
        key = f"{row['method']} {row['path']}"
        grouped[key].append(float(row.get("duration_ms", 0.0)))
        totals[key] += 1
        if not row.get("ok", False):
            errors[key] += 1
    summary: dict[str, dict[str, Any]] = {}
    for key, values in grouped.items():
        stats = summarize_durations(values)
        total = totals[key]
        stats["error_rate"] = round(errors[key] / total, 4) if total else 0.0
        summary[key] = stats
    return summary


def _summarize_socket(socket_rows: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    durations: dict[str, list[float]] = defaultdict(list)
    event_counts: Counter[str] = Counter()
    for row in socket_rows:
        event = str(row.get("event") or "")
        if not event:
            continue
        event_counts[event] += 1
        duration = float(row.get("duration_ms", 0.0))
        if row.get("direction") == "out" and duration > 0:
            durations[event].append(duration)
    return {event: summarize_durations(values) for event, values in durations.items()}, dict(event_counts)


def _derive_join_socket_to_snapshot(socket_rows: list[dict[str, Any]]) -> dict[str, float]:
    rows = sorted(socket_rows, key=lambda row: _parse_ts(row.get("ts")))
    outbound: dict[tuple[str, str], float] = {}
    values: list[float] = []
    for row in rows:
        key = (str(row.get("user_id") or ""), str(row.get("room_code") or ""))
        event = row.get("event")
        ts = _parse_ts(row.get("ts"))
        if event == "room:join_socket" and row.get("direction") == "out":
            outbound[key] = ts
        elif event in {"room:snapshot", "room:presence"} and row.get("direction") == "in":
            started_at = outbound.get(key)
            if started_at:
                values.append(round((ts - started_at) * 1000.0, 2))
                outbound.pop(key, None)
    return summarize_durations(values)


def _summarize_control_to_revision(revisions: list[dict[str, Any]]) -> dict[str, float]:
    return summarize_durations([float(row.get("latency_since_last_control_ms", 0.0)) for row in revisions])


def _top_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for row in errors:
        if row.get("source") == "http":
            key = f"http {row.get('path')} {row.get('status')} {row.get('error')}"
        else:
            key = f"socket {row.get('event')} {row.get('error')}"
        counts[key] += 1
    return [{"error": name, "count": count} for name, count in counts.most_common(10)]


def _histogram_deltas(initial_rows: list[MetricRow], final_rows: list[MetricRow]) -> dict[str, dict[str, dict[str, float]]]:
    initial_map = _rows_by_series(initial_rows)
    final_map = _rows_by_series(final_rows)
    grouped: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(lambda: {"buckets": {}, "sum": 0.0, "count": 0.0}))

    for row in final_rows:
        base_name = row.name
        if row.name.endswith("_bucket"):
            base_name = row.name[: -len("_bucket")]
            labels = {key: value for key, value in row.labels.items() if key != "le"}
            label_key = _label_string(labels)
            delta = row.value - initial_map.get(_series_key(row.name, row.labels), 0.0)
            grouped[base_name][label_key]["buckets"][row.labels.get("le", "+Inf")] = max(delta, 0.0)
        elif row.name.endswith("_sum"):
            base_name = row.name[: -len("_sum")]
            label_key = _label_string(row.labels)
            delta = row.value - initial_map.get(_series_key(row.name, row.labels), 0.0)
            grouped[base_name][label_key]["sum"] = max(delta, 0.0)
        elif row.name.endswith("_count"):
            base_name = row.name[: -len("_count")]
            label_key = _label_string(row.labels)
            delta = row.value - initial_map.get(_series_key(row.name, row.labels), 0.0)
            grouped[base_name][label_key]["count"] = max(delta, 0.0)

    summaries: dict[str, dict[str, dict[str, float]]] = {}
    for base_name, label_groups in grouped.items():
        summarized_groups: dict[str, dict[str, float]] = {}
        for label_key, payload in label_groups.items():
            count = int(payload["count"])
            if count <= 0:
                continue
            ordered_buckets: list[tuple[float, float]] = []
            for bound, cumulative in payload["buckets"].items():
                upper = float("inf") if bound == "+Inf" else float(bound)
                ordered_buckets.append((upper, cumulative))
            ordered_buckets.sort(key=lambda item: item[0])
            summarized_groups[label_key] = {
                "count": count,
                "avg": round(payload["sum"] / count, 4) if count else 0.0,
                "p50": _histogram_quantile(ordered_buckets, 0.50),
                "p95": _histogram_quantile(ordered_buckets, 0.95),
                "p99": _histogram_quantile(ordered_buckets, 0.99),
                "max": _histogram_max_bound(ordered_buckets),
            }
        if summarized_groups:
            summaries[base_name] = summarized_groups
    return summaries


def _histogram_quantile(buckets: list[tuple[float, float]], ratio: float) -> float:
    if not buckets:
        return 0.0
    target = buckets[-1][1] * ratio
    for upper, cumulative in buckets:
        if cumulative >= target:
            return round(upper if math.isfinite(upper) else buckets[-2][0] if len(buckets) > 1 else 0.0, 4)
    return round(buckets[-1][0] if math.isfinite(buckets[-1][0]) else 0.0, 4)


def _histogram_max_bound(buckets: list[tuple[float, float]]) -> float:
    finite_bounds = [bound for bound, cumulative in buckets if cumulative > 0 and math.isfinite(bound)]
    return round(finite_bounds[-1], 4) if finite_bounds else 0.0


def _counter_deltas(initial_rows: list[MetricRow], final_rows: list[MetricRow]) -> dict[str, dict[str, float]]:
    initial_map = _rows_by_series(initial_rows)
    deltas: dict[str, dict[str, float]] = defaultdict(dict)
    for row in final_rows:
        if row.name.endswith(("_bucket", "_sum", "_count", "_created")):
            continue
        delta = row.value - initial_map.get(_series_key(row.name, row.labels), 0.0)
        if delta <= 0:
            continue
        deltas[row.name][_label_string(row.labels)] = round(delta, 4)
    return dict(deltas)


def _infer_bottleneck(summary: dict[str, Any]) -> str:
    join_stats = summary["runner"]["http"].get("POST /api/rooms/join", {})
    control_stats = summary["runner"]["control_to_revision"]
    join_socket_stats = summary["runner"]["join_socket_to_snapshot"]
    payload_hist = summary["metrics"]["histograms"].get("regatta_public_room_view_payload_bytes", {})
    max_payload = max((group.get("p95", 0.0) for group in payload_hist.values()), default=0.0)

    if join_stats.get("p95", 0.0) >= 500 or join_stats.get("error_rate", 0.0) > 0.01:
        return "Primary bottleneck looks HTTP/store-bound: room create/join latency grows first."
    if control_stats.get("p95", 0.0) >= 1000 or join_socket_stats.get("p95", 0.0) >= 500:
        return "Primary bottleneck looks socket/realtime-bound: control-to-revision and join-to-snapshot latency dominate."
    if max_payload >= 32768:
        return "Payload size is a likely bottleneck: room snapshot/state payloads are already heavy."
    return "No single dominant bottleneck stood out in this run; the system remained mostly balanced at the measured level."


def _next_steps(summary: dict[str, Any]) -> list[str]:
    steps = [
        "Compare `public_room_view` payload size against the measured socket latency and trim repeated room fields before increasing concurrency again.",
        "Profile `room_store.get_room` and `room_store.save_room` under the same scenario, because join/start flows depend on them directly.",
        "Re-run the same scenario after any change and compare the new `/metrics` histogram deltas against this baseline instead of relying on single-run intuition.",
    ]
    join_stats = summary["runner"]["http"].get("POST /api/rooms/join", {})
    control_stats = summary["runner"]["control_to_revision"]
    if join_stats.get("p95", 0.0) >= 500:
        steps[0] = "Instrument room create/join serialization and Redis round-trips first, because `/api/rooms/join` p95 is already elevated."
    if control_stats.get("p95", 0.0) >= 1000:
        steps[1] = "Investigate Socket.IO fanout and revision broadcast cadence first, because `control -> revision` latency is the first external signal of degradation."
    return steps


def generate_report(input_dir: Path | str) -> dict[str, Any]:
    input_path = Path(input_dir)
    scenario_config = _read_json(input_path / "scenario_config.json", {})
    environment = _read_json(input_path / "environment.json", {})
    requests = _read_jsonl(input_path / "requests.jsonl")
    socket_rows = _read_jsonl(input_path / "socket_events.jsonl")
    revisions = _read_jsonl(input_path / "room_revisions.jsonl")
    errors = _read_json(input_path / "errors.json", [])
    metrics_initial = parse_prometheus_text((input_path / "metrics_initial.txt").read_text(encoding="utf-8") if (input_path / "metrics_initial.txt").exists() else "")
    metrics_final = parse_prometheus_text((input_path / "metrics_final.txt").read_text(encoding="utf-8") if (input_path / "metrics_final.txt").exists() else "")

    runner_socket, socket_event_counts = _summarize_socket(socket_rows)
    summary = {
        "scenario": scenario_config.get("scenario"),
        "base_url": environment.get("base_url") or scenario_config.get("base_url"),
        "rooms": scenario_config.get("rooms") or scenario_config.get("result", {}).get("rooms") or 0,
        "users": scenario_config.get("users") or scenario_config.get("result", {}).get("users") or 0,
        "duration_seconds": scenario_config.get("duration_seconds"),
        "started_at": scenario_config.get("started_at"),
        "finished_at": scenario_config.get("finished_at"),
        "runner": {
            "http": _summarize_http(requests),
            "socket": runner_socket,
            "socket_event_counts": socket_event_counts,
            "join_socket_to_snapshot": _derive_join_socket_to_snapshot(socket_rows),
            "control_to_revision": _summarize_control_to_revision(revisions),
            "disconnect_rate": round(socket_event_counts.get("disconnect", 0) / max(runner_socket.get("connect", {}).get("count", 0), 1), 4),
            "error_rate": round(len(errors) / max(len(requests) + len(socket_rows), 1), 4),
            "errors_total": len(errors),
            "top_errors": _top_errors(errors),
        },
        "metrics": {
            "used_metric_names": _read_json(input_path / "metrics_expected_and_found.json", []),
            "expected_but_missing": _read_json(input_path / "metrics_expected_but_missing.json", []),
            "found_but_undocumented": _read_json(input_path / "metrics_found_but_undocumented.json", []),
            "histograms": _histogram_deltas(metrics_initial, metrics_final),
            "counters": _counter_deltas(metrics_initial, metrics_final),
        },
    }
    summary["bottleneck"] = _infer_bottleneck(summary)
    summary["next_steps"] = _next_steps(summary)
    _write_summary_and_report(input_path, summary, environment)
    return summary


def _write_summary_and_report(input_path: Path, summary: dict[str, Any], environment: dict[str, Any]) -> None:
    write_path = input_path / "summary.json"
    write_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    healthz = _unwrap_body(environment.get("healthz", {}))
    baseline_source = _read_json(input_path / "baseline_snapshot_source.json", {})
    http_lines = [
        "| Endpoint | Count | P50 ms | P95 ms | P99 ms | Max ms | Error rate |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, stats in sorted(summary["runner"]["http"].items()):
        http_lines.append(
            f"| {name} | {stats['count']} | {stats['p50']} | {stats['p95']} | {stats['p99']} | {stats['max']} | {stats['error_rate']} |"
        )

    socket_lines = [
        "| Metric | Count | P50 ms | P95 ms | P99 ms | Max ms |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        f"| socket connect | {summary['runner']['socket'].get('connect', {}).get('count', 0)} | {summary['runner']['socket'].get('connect', {}).get('p50', 0.0)} | {summary['runner']['socket'].get('connect', {}).get('p95', 0.0)} | {summary['runner']['socket'].get('connect', {}).get('p99', 0.0)} | {summary['runner']['socket'].get('connect', {}).get('max', 0.0)} |",
        f"| join_socket -> snapshot | {summary['runner']['join_socket_to_snapshot'].get('count', 0)} | {summary['runner']['join_socket_to_snapshot'].get('p50', 0.0)} | {summary['runner']['join_socket_to_snapshot'].get('p95', 0.0)} | {summary['runner']['join_socket_to_snapshot'].get('p99', 0.0)} | {summary['runner']['join_socket_to_snapshot'].get('max', 0.0)} |",
        f"| control -> revision | {summary['runner']['control_to_revision'].get('count', 0)} | {summary['runner']['control_to_revision'].get('p50', 0.0)} | {summary['runner']['control_to_revision'].get('p95', 0.0)} | {summary['runner']['control_to_revision'].get('p99', 0.0)} | {summary['runner']['control_to_revision'].get('max', 0.0)} |",
    ]

    metrics_lines = ["Findings from /metrics", ""]
    metrics_lines.append(f"- Used metric names: {', '.join(summary['metrics']['used_metric_names']) or 'none'}")
    metrics_lines.append(f"- Expected but missing: {', '.join(summary['metrics']['expected_but_missing']) or 'none'}")
    metrics_lines.append(f"- Found but undocumented: {', '.join(summary['metrics']['found_but_undocumented']) or 'none'}")
    if summary["metrics"]["histograms"]:
        metrics_lines.append("- Histogram highlights:")
        for metric_name, groups in sorted(summary["metrics"]["histograms"].items()):
            for label_key, stats in sorted(groups.items()):
                metrics_lines.append(
                    f"  {metric_name} [{label_key}] count={stats['count']} p95={stats['p95']} p99={stats['p99']} avg={stats['avg']}"
                )
    else:
        metrics_lines.append("- Histogram highlights: none captured in this window.")

    runner_lines = ["Findings from load runner", ""]
    runner_lines.append(f"- Socket connect count: {summary['runner']['socket'].get('connect', {}).get('count', 0)}")
    runner_lines.append(f"- join_socket -> snapshot p95: {summary['runner']['join_socket_to_snapshot'].get('p95', 0.0)} ms")
    runner_lines.append(f"- control -> revision p95: {summary['runner']['control_to_revision'].get('p95', 0.0)} ms")
    runner_lines.append(f"- Disconnect rate: {summary['runner']['disconnect_rate']}")
    runner_lines.append(f"- Error rate: {summary['runner']['error_rate']}")

    report = "\n".join(
        [
            "# Regatta Load Report",
            "",
            "## Context",
            f"- Stand: {summary['base_url']}",
            f"- Scenario: {summary['scenario']}",
            f"- Started: {summary['started_at']}",
            f"- Finished: {summary['finished_at']}",
            f"- Baseline snapshot source: {baseline_source.get('strategy', 'unknown')}",
            f"- Session backend: {healthz.get('session_backend') if isinstance(healthz, dict) else 'unknown'}",
            f"- Redis enabled: {healthz.get('redis') if isinstance(healthz, dict) else 'unknown'}",
            "",
            "## Short Outcome",
            f"- Rooms: {summary['rooms']}",
            f"- Users: {summary['users']}",
            f"- Bottleneck: {summary['bottleneck']}",
            "",
            "## HTTP",
            *http_lines,
            "",
            "## Socket",
            *socket_lines,
            "",
            "## Findings from /metrics",
            *metrics_lines[2:],
            "",
            "## Findings from load runner",
            *runner_lines[2:],
            "",
            "## Observations",
            f"- Main bottleneck hypothesis: {summary['bottleneck']}",
            "",
            "## Next Steps",
            *[f"- {item}" for item in summary["next_steps"]],
        ]
    )
    (input_path / "report.md").write_text(report + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Aggregate an existing Regatta load-run directory.")
    parser.add_argument("--input", required=True)
    args = parser.parse_args(argv)
    summary = generate_report(Path(args.input))
    print(json.dumps({"summary": str(Path(args.input) / "summary.json"), "scenario": summary.get("scenario")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
