type PlaceholderPanelProps = {
  title: string;
  subtitle: string;
};

export function PlaceholderPanel({ title, subtitle }: PlaceholderPanelProps) {
  return (
    <article className="panel-card">
      <div className="panel-label">{title}</div>
      <h2>{subtitle}</h2>
      <div className="skeleton-grid" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </article>
  );
}
