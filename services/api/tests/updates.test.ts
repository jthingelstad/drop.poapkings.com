import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  renderUpdateMarkdownHtml,
  updateId,
  validateUpdateEntry,
  type UpdateEntry,
} from "../src/player-updates.js";
import {
  getUpdates,
  publishUpdate,
  renderUpdatesFeed,
  renderUpdatesPage,
} from "../src/routes/updates.js";
import type { RouteContext } from "../src/routes/context.js";

const entry: UpdateEntry = {
  id: "season-137-opening-bell",
  kind: "season",
  publishedAt: "2026-10-05T10:00:00Z",
  title: "Season 137 opens on Higher / Lower",
  body: "The next Free Pass race is live in **Higher / Lower**. [Play now](/#/higher-lower).",
};

function event(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    requestContext: {
      accountId: "123456789012",
      apiId: "api-id",
      domainName: "api.example",
      domainPrefix: "api",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-updates",
      routeKey: `${method} ${path}`,
      stage: "$default",
      time: "05/Oct/2026:10:00:00 +0000",
      timeEpoch: Date.now(),
    },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

function context(
  apiEvent: APIGatewayProxyEventV2,
  repository: Record<string, ReturnType<typeof vi.fn>>,
): RouteContext {
  return {
    event: apiEvent,
    config: {
      tableName: "test-table",
      sessionSecret: "session",
      telemetryPepper: "pepper",
      updatesPublishToken: "test-publish-token",
      appUrl: "https://drop.example",
      jmapToken: "jmap",
      emailFrom: "elixir@example.com",
      emailFromName: "Elixir Drop",
      nameModelId: "model",
      elixirMcpBaseUrl: "https://elixir.example",
      elixirMcpCollectionSlug: "drop",
      warClockClanTag: "#CLAN",
    },
    repository: repository as never,
  };
}

describe("player Update validation", () => {
  it("accepts the bounded inline Markdown vocabulary", () => {
    expect(validateUpdateEntry(entry)).toEqual(entry);
    expect(renderUpdateMarkdownHtml(entry.body)).toContain(
      "<strong>Higher / Lower</strong>",
    );
    expect(renderUpdateMarkdownHtml(entry.body)).toContain(
      '<a href="/#/higher-lower">Play now</a>',
    );
  });

  it("rejects unsupported Markdown, unsafe links, and invalid impact use", () => {
    expect(() =>
      validateUpdateEntry({ ...entry, body: "One.\n\nTwo." }),
    ).toThrow("one paragraph");
    expect(() =>
      validateUpdateEntry({
        ...entry,
        body: "[Bad](javascript:alert(1))",
      }),
    ).toThrow("unsupported destination");
    expect(() => validateUpdateEntry({ ...entry, impact: "gameplay" })).toThrow(
      "Only feature updates",
    );
  });

  it("creates stable date-and-title ids", () => {
    expect(
      updateId("Season 137: Higher / Lower!", new Date("2026-10-05T10:00:00Z")),
    ).toBe("2026-10-05-season-137-higher-lower");
  });
});

describe("player Update routes", () => {
  it("lists newest-first API records through the public read budget", async () => {
    const repository = {
      useRateLimit: vi.fn().mockResolvedValue(undefined),
      updates: vi.fn().mockResolvedValue([entry]),
    };
    const response = await getUpdates(
      context(event("GET", "/updates"), repository),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ entries: [entry] });
    expect(repository.updates).toHaveBeenCalledWith(100);
    expect(repository.useRateLimit).toHaveBeenCalledWith(
      "reads",
      expect.any(String),
      1200,
      3600,
    );
  });

  it("requires the publisher bearer token before writing", async () => {
    const repository = { publishUpdate: vi.fn() };
    await expect(
      publishUpdate(
        context(event("POST", "/admin/updates", entry), repository),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "publisher_required" });
    await expect(
      publishUpdate(
        context(
          event("POST", "/admin/updates", entry, "nope-publish-token"),
          repository,
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "publisher_required" });
    expect(repository.publishUpdate).not.toHaveBeenCalled();
  });

  it("publishes immediately with the bearer token", async () => {
    const repository = {
      publishUpdate: vi.fn().mockResolvedValue({ entry, created: true }),
    };
    const response = await publishUpdate(
      context(
        event("POST", "/admin/updates", entry, "test-publish-token"),
        repository,
      ),
    );

    expect(response.statusCode).toBe(201);
    expect(repository.publishUpdate).toHaveBeenCalledWith(
      entry,
      "updates-bearer",
    );
  });

  it("renders the archive and RSS from the same records", () => {
    const html = renderUpdatesPage([entry]);
    const xml = renderUpdatesFeed([entry]);

    expect(html).toContain('id="season-137-opening-bell"');
    expect(html).toContain("Season 137 opens on Higher / Lower");
    expect(html).toContain("<strong>Higher / Lower</strong>");
    expect(xml).toContain("<title>Elixir Drop Updates</title>");
    expect(xml).toContain(
      "https://drop.poapkings.com/updates/#season-137-opening-bell",
    );
  });
});
