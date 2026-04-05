import { startTransition, useEffect, useState } from "react";

import { ApiClient, ApiError } from "../../../shared/api/client";
import type { BootstrapResponse, HealthResponse } from "../../../shared/api/types";

type SystemOverview = {
  bootstrap: BootstrapResponse;
  health: HealthResponse;
};

type State = {
  data: SystemOverview | null;
  error: ApiError | Error | null;
  isLoading: boolean;
  isRefreshing: boolean;
};

const initialState: State = {
  data: null,
  error: null,
  isLoading: true,
  isRefreshing: false,
};

export function useSystemOverview() {
  const [state, setState] = useState<State>(initialState);

  async function load({ initial = false }: { initial?: boolean } = {}) {
    setState((current) => ({
      ...current,
      error: null,
      isLoading: initial && current.data === null,
      isRefreshing: !initial,
    }));

    try {
      const [health, bootstrap] = await Promise.all([
        ApiClient.getHealth(),
        ApiClient.getBootstrap(),
      ]);

      startTransition(() => {
        setState({
          data: { health, bootstrap },
          error: null,
          isLoading: false,
          isRefreshing: false,
        });
      });
    } catch (error) {
      startTransition(() => {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error : new Error("Unexpected error"),
          isLoading: false,
          isRefreshing: false,
        }));
      });
    }
  }

  useEffect(() => {
    void load({ initial: true });
  }, []);

  return {
    ...state,
    refresh: () => void load(),
  };
}
