import type { BootstrapResponse } from "../../../shared/api/types";
import { PlaceholderPanel } from "./shared";

type RoomPanelProps = {
  bootstrap: BootstrapResponse | null;
  isLoading: boolean;
};

export function RoomPanel({ bootstrap, isLoading }: RoomPanelProps) {
  if (isLoading) {
    return <PlaceholderPanel title="Room snapshot" subtitle="Загружаем bootstrap..." />;
  }

  const room = bootstrap?.room;

  return (
    <article className="panel-card">
      <div className="panel-label">Bootstrap</div>
      <h2>Состояние сессии</h2>
      <dl className="metrics-list">
        <div>
          <dt>Пилот</dt>
          <dd>{bootstrap?.display_name || "Шкипер"}</dd>
        </div>
        <div>
          <dt>Комната</dt>
          <dd>{room?.code || "Нет активной комнаты"}</dd>
        </div>
        <div>
          <dt>Статус</dt>
          <dd>{room?.status || "local"}</dd>
        </div>
        <div>
          <dt>Игроков</dt>
          <dd>
            {room ? `${room.joined_count} / ${room.capacity}` : "0 / 0"}
          </dd>
        </div>
      </dl>
    </article>
  );
}
