import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBridgeLogger } from "../src/logger.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function temporaryLogPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "elixir-drop-bridge-log-"));
  temporaryDirectories.push(directory);
  return join(directory, "bridge.log");
}

describe("bridge logger", () => {
  it("writes one timestamped JSON record per event", () => {
    const path = temporaryLogPath();
    const logger = createBridgeLogger({
      path,
      now: () => new Date("2026-08-02T20:00:00.000Z"),
    });

    logger.warn("CR bridge heartbeat failed", { error: "network down" });

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      timestamp: "2026-08-02T20:00:00.000Z",
      level: "warn",
      message: "CR bridge heartbeat failed",
      error: "network down",
    });
  });

  it("rotates legacy and oversized logs while keeping bounded archives", () => {
    const path = temporaryLogPath();
    writeFileSync(path, "legacy multiline log\n", "utf8");
    const logger = createBridgeLogger({
      path,
      maxBytes: 180,
      archiveCount: 2,
      now: () => new Date("2026-08-02T20:00:00.000Z"),
    });

    logger.info("first structured event", { value: "a".repeat(30) });
    expect(readFileSync(`${path}.1`, "utf8")).toBe("legacy multiline log\n");

    logger.info("second structured event", { value: "b".repeat(30) });
    logger.info("third structured event", { value: "c".repeat(30) });

    expect(readFileSync(path, "utf8")).toContain("third structured event");
    expect(readFileSync(`${path}.1`, "utf8")).toContain(
      "second structured event",
    );
    expect(readFileSync(`${path}.2`, "utf8")).toContain(
      "first structured event",
    );
  });
});
