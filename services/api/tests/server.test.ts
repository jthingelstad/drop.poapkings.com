import { once } from "node:events";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  httpServer,
  listenAddress,
  MAX_BODY_BYTES,
  type ServerOptions,
} from "../src/server.js";
import { json } from "../src/http.js";
import { dispatch, routeTemplate } from "../src/app.js";

const servers: Server[] = [];
async function serve(options: ServerOptions) {
  const server = httpServer(options);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

describe("native HTTP server", () => {
  it("binds the runtime address and refuses malformed addresses", () => {
    expect(listenAddress("0.0.0.0:8123")).toEqual({
      host: "0.0.0.0",
      port: 8123,
    });
    expect(() => listenAddress("missing")).toThrow();
    expect(() => listenAddress("localhost:99999")).toThrow();
  });
  it("serves the actual health route and errors with allowlisted CORS", async () => {
    const root = await serve({ dispatch });
    const health = await fetch(`${root}/health`, {
      headers: { origin: "http://localhost:5173" },
    });
    expect(await health.json()).toEqual({
      ok: true,
      service: "elixir-drop-api",
    });
    expect(health.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    const cors = await fetch(`${root}/health`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173" },
    });
    expect(cors.status).toBe(204);
    const denied = await fetch(`${root}/health`, {
      headers: { origin: "https://hostile.example" },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("ignores forwarding headers locally and requires a valid viewer in production", async () => {
    const capture = vi.fn(async (request) =>
      json(200, { ip: request.sourceIp, id: request.requestId }),
    );
    const local = await serve({ dispatch: capture });
    const result = await fetch(local, {
      headers: {
        "x-elixir-drop-viewer-ip": "203.0.113.9",
        "lambda-web-request-id": "fake",
      },
    });
    const body = (await result.json()) as { ip: string; id: string };
    expect(body.ip).toBe("127.0.0.1");
    expect(body.id).not.toBe("fake");
    const production = await serve({
      dispatch: capture,
      trustCloudFront: true,
    });
    expect((await fetch(production)).status).toBe(400);
    expect(
      (
        await fetch(production, {
          headers: { "x-elixir-drop-viewer-ip": "bad" },
        })
      ).status,
    ).toBe(400);
    const trusted = await fetch(production, {
      headers: {
        "x-elixir-drop-viewer-ip": "2001:db8::7",
        "lambda-web-request-id": "real",
      },
    });
    expect(await trusted.json()).toEqual({ ip: "2001:db8::7", id: "real" });
  });
  it("preserves bearer headers, query decoding, redirects, bytes, and HEAD", async () => {
    const root = await serve({
      dispatch: async (request) => {
        if (request.path === "/png")
          return {
            statusCode: 200,
            headers: { "content-type": "image/png" },
            bytes: Buffer.from([0, 255, 1]),
          };
        if (request.path === "/redirect")
          return {
            statusCode: 303,
            headers: { location: "/#/auth?token=example" },
          };
        return json(200, {
          authorization: request.headers.authorization,
          query: request.query,
          body: request.body,
        });
      },
    });
    const response = await fetch(`${root}/?value=a%2Bb`, {
      method: "POST",
      headers: { authorization: "Bearer example" },
      body: "hello",
    });
    expect(await response.json()).toEqual({
      authorization: "Bearer example",
      query: { value: "a+b" },
      body: "hello",
    });
    expect(
      Buffer.from(await (await fetch(`${root}/png`)).arrayBuffer()),
    ).toEqual(Buffer.from([0, 255, 1]));
    expect(await (await fetch(`${root}/png`, { method: "HEAD" })).text()).toBe(
      "",
    );
    const redirect = await fetch(`${root}/redirect`, { redirect: "manual" });
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("location")).toBe("/#/auth?token=example");
  });
  it("bounds uploads and keeps concurrent request bodies isolated", async () => {
    const root = await serve({
      dispatch: async (request) => {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            request.headers.authorization === "first" ? 15 : 1,
          ),
        );
        return json(200, {
          who: request.headers.authorization,
          bytes: request.body?.length,
        });
      },
    });
    const responses = await Promise.all(
      ["first", "second"].map((who) =>
        fetch(root, {
          method: "POST",
          headers: { authorization: who },
          body: "x".repeat(2_700_000),
        }).then((r) => r.json()),
      ),
    );
    expect(responses).toEqual([
      { who: "first", bytes: 2_700_000 },
      { who: "second", bytes: 2_700_000 },
    ]);
    const large = await fetch(root, {
      method: "POST",
      body: "x".repeat(MAX_BODY_BYTES + 1),
    });
    expect(large.status).toBe(413);
  });
  it("sanitizes internal failures and route labels", async () => {
    const root = await serve({
      dispatch: async () => {
        throw new Error("secret");
      },
    });
    const response = await fetch(root);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
    expect(
      routeTemplate({
        method: "GET",
        path: "/share/Pprivate/Dprivate",
        headers: {},
        sourceIp: "test",
        requestId: "test",
      }),
    ).toBe("GET /share/{player}/{run}");
    expect(
      routeTemplate({
        method: "GET",
        path: "/private",
        headers: {},
        sourceIp: "test",
        requestId: "test",
      }),
    ).toBe("GET not-found");
  });
});
