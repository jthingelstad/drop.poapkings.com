import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";

export type BridgeLogLevel = "info" | "warn" | "error";
export type BridgeLogDetails = Record<string, unknown>;

export interface BridgeLogger {
  info(message: string, details?: BridgeLogDetails): void;
  warn(message: string, details?: BridgeLogDetails): void;
  error(message: string, details?: BridgeLogDetails): void;
}

interface BridgeLoggerOptions {
  path?: string;
  maxBytes?: number;
  archiveCount?: number;
  now?: () => Date;
  output?: (line: string) => void;
}

export const BRIDGE_LOG_MAX_BYTES = 1024 * 1024;
export const BRIDGE_LOG_ARCHIVE_COUNT = 3;

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function rotate(path: string, archiveCount: number): void {
  rmSync(`${path}.${archiveCount}`, { force: true });
  for (let index = archiveCount - 1; index >= 1; index -= 1) {
    try {
      renameSync(`${path}.${index}`, `${path}.${index + 1}`);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
  try {
    renameSync(path, `${path}.1`);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

function startsWithJsonRecord(path: string): boolean {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const buffer = Buffer.alloc(256);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .trimStart()
      .startsWith("{");
  } catch (error) {
    if (isMissingFile(error)) return true;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function createBridgeLogger(
  options: BridgeLoggerOptions = {},
): BridgeLogger {
  const path = options.path;
  const maxBytes = options.maxBytes ?? BRIDGE_LOG_MAX_BYTES;
  const archiveCount = options.archiveCount ?? BRIDGE_LOG_ARCHIVE_COUNT;
  const now = options.now ?? (() => new Date());
  const output =
    options.output ?? ((line: string) => process.stdout.write(line));
  let checkedExistingLog = false;

  function write(
    level: BridgeLogLevel,
    message: string,
    details: BridgeLogDetails = {},
  ): void {
    const line = `${JSON.stringify({
      timestamp: now().toISOString(),
      level,
      message,
      ...details,
    })}\n`;
    if (!path) {
      output(line);
      return;
    }

    try {
      mkdirSync(dirname(path), { recursive: true });
      if (!checkedExistingLog) {
        checkedExistingLog = true;
        if (!startsWithJsonRecord(path)) rotate(path, archiveCount);
      }
      let currentBytes = 0;
      try {
        currentBytes = statSync(path).size;
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      if (currentBytes + Buffer.byteLength(line) > maxBytes)
        rotate(path, archiveCount);
      appendFileSync(path, line, "utf8");
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          timestamp: now().toISOString(),
          level: "error",
          message: "CR bridge log write failed",
          error: error instanceof Error ? error.message : "Unknown error",
          originalLevel: level,
          originalMessage: message,
        })}\n`,
      );
    }
  }

  return {
    info: (message, details) => write("info", message, details),
    warn: (message, details) => write("warn", message, details),
    error: (message, details) => write("error", message, details),
  };
}

export const bridgeLogger = createBridgeLogger({
  path: process.env.ELIXIR_DROP_LOG_PATH,
});
