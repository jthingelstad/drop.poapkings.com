import {
  seasonNumber,
  type PodiumFinalizeResult,
} from "@elixir-drop/contracts";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { loadConfig } from "./config.js";
import { Repository } from "./repository.js";
import { finalizePodiumBadges } from "./podium.js";
import { requireObject as object, requireText as text } from "./validation.js";

function isoDate(value: unknown, label: string): string {
  const result = text(value, label, 40);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error(`${label} must be an ISO date`);
  return result;
}

export function parsePodiumFinalizeResult(
  value: unknown,
): PodiumFinalizeResult {
  const source = object(value, "Result");
  if (source.version !== 1 || source.type !== "podium-finalize")
    throw new Error("Unsupported podium finalization message");
  const seasonId = seasonNumber(source.seasonId);
  if (seasonId === undefined) throw new Error("Season ID is invalid");
  return {
    version: 1,
    type: "podium-finalize",
    seasonId,
    finalizedAt: isoDate(source.finalizedAt, "Finalized at"),
  };
}

export async function crResultHandler(
  event: SQSEvent,
): Promise<SQSBatchResponse> {
  const repository = new Repository(loadConfig().tableName);
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    try {
      const value = JSON.parse(record.body) as unknown;
      const result = parsePodiumFinalizeResult(value);
      const summary = await finalizePodiumBadges(repository, result);
      console.info("Season awards finalized", summary);
    } catch (error) {
      console.error("CR bridge result failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
