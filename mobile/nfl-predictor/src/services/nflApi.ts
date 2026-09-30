import { buildApiUrl } from "../config/api";
import type {
  MobileAlgorithmPerformanceResponse,
  MobileModelSignalsResponse,
  MobileUpcomingResponse,
  MobileWeeklyPerformanceResponse,
  ModelId,
} from "../types/api";

async function fetchJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const response = await fetch(buildApiUrl(path, params), {
    headers: {
      Accept: "application/json",
    },
  });
  const payload = (await response.json()) as T & { success?: boolean; error?: string };
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload as T;
}

export const nflApi = {
  upcoming(params?: { season?: number; week?: number }) {
    return fetchJson<MobileUpcomingResponse>("/api/v1/nfl/mobile/upcoming", params);
  },

  modelSignals(params?: { season?: number; week?: number }) {
    return fetchJson<MobileModelSignalsResponse>("/api/v1/nfl/mobile/model-signals", params);
  },

  weeklyPerformance(params?: { season?: number; week?: number }) {
    return fetchJson<MobileWeeklyPerformanceResponse>("/api/v1/nfl/mobile/weekly-performance", params);
  },

  algorithmPerformance(model: ModelId, params?: { season?: number }) {
    return fetchJson<MobileAlgorithmPerformanceResponse>(
      `/api/v1/nfl/mobile/algorithm-performance/${encodeURIComponent(model)}`,
      params,
    );
  },
};
