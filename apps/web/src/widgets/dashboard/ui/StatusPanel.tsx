import type { HealthResponse } from "../../../shared/api/types";
import { PlaceholderPanel } from "./shared";

type StatusPanelProps = {
  health: HealthResponse | null;
  isLoading: boolean;
};

export function StatusPanel({ health, isLoading }: StatusPanelProps) {
  if (isLoading) {
    return <PlaceholderPanel title="Backend status" subtitle="Проверяем health endpoint..." />;
  }

  return (
    <article className="panel-card">
      <div className="panel-label">Backend</div>
      <h2>Контур FastAPI</h2>
      <dl className="metrics-list">
        <div>
          <dt>Статус</dt>
          <dd>{health?.status || "unknown"}</dd>
        </div>
        <div>
          <dt>Версия</dt>
          <dd>{health?.version || "n/a"}</dd>
        </div>
        <div>
          <dt>Redis</dt>
          <dd>{health?.redis_backend || "n/a"}</dd>
        </div>
        <div>
          <dt>Сессии</dt>
          <dd>{health?.session_backend || "n/a"}</dd>
        </div>
      </dl>
      <div className="status-row">
        <span className={health?.structured_logs ? "status-chip is-good" : "status-chip"}>
          structured logs
        </span>
        <span className={health?.metrics_enabled ? "status-chip is-good" : "status-chip"}>
          metrics
        </span>
        <span className={health?.client_telemetry_enabled ? "status-chip is-good" : "status-chip"}>
          telemetry
        </span>
      </div>
    </article>
  );
}
