export type RoomPlayer = {
  player_id: string;
  name: string;
  seat_index: number | null;
  is_host: boolean;
  is_self: boolean;
  is_observer: boolean;
};

export type RoomSelf = {
  player_id: string | null;
  name: string | null;
  seat_index: number | null;
  is_observer: boolean;
  token_present: boolean;
};

export type RoomView = {
  code: string;
  status: string;
  server_time_ms: number;
  max_players: number;
  max_racers: number;
  max_observers: number;
  joined_count: number;
  joined_racers_count: number;
  joined_observers_count: number;
  capacity: number;
  start_ready: boolean;
  can_start: boolean;
  revision: number;
  play_mode: string;
  host_mode: string;
  is_host: boolean;
  players: RoomPlayer[];
  self: RoomSelf;
  game_state?: Record<string, unknown> | null;
};

export type HealthResponse = {
  status: string;
  version: string;
  redis: boolean;
  redis_backend: string;
  session_backend: string;
  metrics_enabled: boolean;
  structured_logs: boolean;
  client_telemetry_enabled: boolean;
};

export type BootstrapResponse = {
  version: string;
  asset_version: string;
  display_name: string | null;
  observability: {
    client_telemetry_enabled: boolean;
  };
  room: RoomView | null;
};
