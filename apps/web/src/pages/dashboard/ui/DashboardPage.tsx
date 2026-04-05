import { useSystemOverview } from "../../../widgets/dashboard/model/useSystemOverview";
import { ActionPanel } from "../../../widgets/dashboard/ui/ActionPanel";
import { ArchitecturePanel } from "../../../widgets/dashboard/ui/ArchitecturePanel";
import { RoomPanel } from "../../../widgets/dashboard/ui/RoomPanel";
import { StatusPanel } from "../../../widgets/dashboard/ui/StatusPanel";
import { env } from "../../../shared/config/env";

export function DashboardPage() {
  const { data, error, isLoading, isRefreshing, refresh } = useSystemOverview();

  return (
    <main className="shell">
      <section className="hero-card">
        <div className="eyebrow">React Frontend</div>
        <div className="hero-grid">
          <div>
            <h1>{env.appTitle}</h1>
            <p className="hero-copy">
              Новый SPA-слой уже ориентирован на версионированный API и может
              развиваться независимо от серверного рантайма и шаблонов Flask.
            </p>
          </div>
          <ActionPanel
            isRefreshing={isRefreshing}
            apiDocsUrl={env.apiDocsUrl}
            onRefresh={refresh}
          />
        </div>
      </section>

      {error ? (
        <section className="error-banner" role="alert">
          <strong>Не удалось получить данные backend.</strong>
          <span>{error.message}</span>
        </section>
      ) : null}

      <section className="panel-grid">
        <StatusPanel health={data?.health ?? null} isLoading={isLoading} />
        <RoomPanel bootstrap={data?.bootstrap ?? null} isLoading={isLoading} />
        <ArchitecturePanel />
      </section>
    </main>
  );
}
