import { env } from "../config/env";
import type { BootstrapResponse, HealthResponse } from "./types";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: string }).error)
        : "API request failed";
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export const ApiClient = {
  getHealth: () => request<HealthResponse>("/healthz"),
  getBootstrap: () => request<BootstrapResponse>("/bootstrap"),
};
