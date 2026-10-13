export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: string;
  sourceIp: string;
  requestId: string;
}
export interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  bytes?: Uint8Array;
}
export function json(statusCode: number, body: unknown): HttpResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}
