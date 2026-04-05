type ActionPanelProps = {
  apiDocsUrl: string;
  isRefreshing: boolean;
  onRefresh: () => void;
};

export function ActionPanel({ apiDocsUrl, isRefreshing, onRefresh }: ActionPanelProps) {
  return (
    <div className="action-stack">
      <button className="primary-action" type="button" onClick={onRefresh}>
        {isRefreshing ? "Обновляем..." : "Обновить статус"}
      </button>
      <a className="secondary-action" href={apiDocsUrl} target="_blank" rel="noreferrer">
        Открыть API docs
      </a>
    </div>
  );
}
