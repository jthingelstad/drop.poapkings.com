import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { GameMode } from "./types.js";

// Numeric API id for the same Elixir Drop property whose browser embed uid is
// documented in CLAUDE.md. Keep the full-access key server-only; the browser
// continues to use the public embed uid.
export const TINYLYTICS_SITE_ID = 3445;

export interface TinylyticsConfig {
  apiToken?: string;
}

export type TinylyticsServerEvent =
  | "account.login_requested"
  | "account.login_completed"
  | "account.profile_completed"
  | "game.completed"
  | "game.personal_best";

export type TinylyticsServerValue = GameMode | "new" | "returning";

export interface TinylyticsEvent {
  event: TinylyticsServerEvent;
  value?: TinylyticsServerValue;
  path: "/login" | "/profile" | `/${GameMode}`;
}

type TinylyticsFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

export function tinylyticsEventBody(
  request: APIGatewayProxyEventV2,
  event: TinylyticsEvent,
) {
  const ipAddress = request.requestContext.http.sourceIp?.trim();
  const userAgent =
    request.requestContext.http.userAgent?.trim() ||
    request.headers["user-agent"]?.trim();
  return {
    event: event.event,
    ...(event.value ? { value: event.value } : {}),
    path: event.path,
    // sourceIp is API Gateway's trusted connection value. Never substitute a
    // caller-controlled forwarding header here.
    ...(ipAddress ? { ip_address: ipAddress } : {}),
    ...(userAgent ? { user_agent: userAgent } : {}),
  };
}

// Server events are authoritative outcomes, but analytics is still a side
// channel: one attempt, a short timeout, and no effect on the API response.
export async function publishTinylyticsEvent(
  config: TinylyticsConfig,
  request: APIGatewayProxyEventV2,
  event: TinylyticsEvent,
  fetcher: TinylyticsFetch = fetch,
): Promise<void> {
  if (!config.apiToken) return;
  try {
    const response = await fetcher(
      `https://tinylytics.app/api/v1/sites/${TINYLYTICS_SITE_ID}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tinylyticsEventBody(request, event)),
        signal: AbortSignal.timeout(1_000),
      },
    );
    if (response.ok) return;
    console.warn("Tinylytics event delivery failed", {
      event: event.event,
      statusCode: response.status,
    });
  } catch (error) {
    console.warn("Tinylytics event delivery failed", {
      event: event.event,
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
