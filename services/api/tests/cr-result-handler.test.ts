import type { SQSEvent } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  saveCrProfileResult: vi.fn(),
  saveCrWarClock: vi.fn(),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    saveCrProfileResult = repository.saveCrProfileResult;
    saveCrWarClock = repository.saveCrWarClock;
  },
}));

import { crResultHandler } from "../src/cr-results.js";

describe("CR result queue handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.saveCrWarClock.mockResolvedValue(true);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("routes a war clock result to the singleton clock record", async () => {
    const body = {
      version: 1,
      type: "war-clock-result",
      clock: {
        crSeasonId: 134,
        sectionIndex: 1,
        periodIndex: 12,
        periodType: "warDay",
        seasonStartsAt: "2026-07-06T10:00:00.000Z",
        observedAt: "2026-07-18T19:00:00.000Z",
        sourceClanTag: "#J2RGCRVG",
      },
    };
    const response = await crResultHandler({
      Records: [
        {
          messageId: "message-1",
          body: JSON.stringify(body),
        },
      ],
    } as SQSEvent);

    expect(response.batchItemFailures).toEqual([]);
    expect(repository.saveCrWarClock).toHaveBeenCalledWith(body.clock);
    expect(repository.saveCrProfileResult).not.toHaveBeenCalled();
  });
});
