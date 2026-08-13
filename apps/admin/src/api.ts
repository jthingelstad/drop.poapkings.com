import type { Overview, PlayerDetail, RunDetail } from "./types";

let csrfToken = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set("X-Drop-Admin-CSRF", csrfToken);
  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
  });
  const body = (await response.json()) as T & {
    error?: string;
    detail?: string;
  };
  if (!response.ok)
    throw new Error(
      body.detail || body.error || `Request failed (${response.status})`,
    );
  return body;
}

export async function getOverview(): Promise<Overview> {
  const overview = await request<Overview>("/overview");
  csrfToken = overview.csrfToken;
  return overview;
}

export function getPlayer(playerId: string): Promise<PlayerDetail> {
  return request<PlayerDetail>(`/players/${encodeURIComponent(playerId)}`);
}

export function getRun(runId: string): Promise<RunDetail> {
  return request<RunDetail>(`/runs/${encodeURIComponent(runId)}`);
}

export function decideRun(
  runId: string,
  body: {
    action: string;
    reason: string;
    playerReason?: string;
    visibility?: string;
  },
): Promise<RunDetail> {
  return request<RunDetail>(`/runs/${encodeURIComponent(runId)}/decision`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function setRankedAccess(
  playerId: string,
  body: { status: "allowed" | "restricted"; reason: string },
): Promise<PlayerDetail> {
  return request<PlayerDetail>(
    `/players/${encodeURIComponent(playerId)}/ranked-access`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}
