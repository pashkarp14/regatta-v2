const items = [
  "Frontend ходит только в /api/v1 и не знает о Flask-шаблонах.",
  "FastAPI держит версионирование, CORS, схемы и внешний контракт.",
  "Legacy Flask остается временным внутренним доменным адаптером.",
  "Realtime переносится отдельным этапом без блокировки REST-миграции.",
];

export function ArchitecturePanel() {
  return (
    <article className="panel-card panel-card-wide">
      <div className="panel-label">Architecture</div>
      <h2>Целевой модульный контур</h2>
      <ul className="plain-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}
