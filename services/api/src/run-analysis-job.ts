import { ScanCommand, type ScanCommandOutput } from "@aws-sdk/lib-dynamodb";
import { required } from "./config.js";
import { client } from "./dynamo.js";
import {
  analysisRunFromEvidence,
  analyzeRuns,
  historyRunFromItem,
  type AnalysisOutput,
  type AnalysisRun,
  type HistoryRun,
  withHistoryEpoch,
} from "./run-analysis.js";

// The only attributes the analysis reads. RunAnalysisRole's IAM allowlist
// (infra/template.yaml) names exactly these, so the job cannot read an email,
// a name, a CR tag, or the owning sub even by mistake.
export const ANALYSIS_ATTRIBUTES = [
  "pk",
  "sk",
  "runId",
  "mode",
  "seasonId",
  "runType",
  "reviewSignals",
  "timing",
  "score",
  "completedAt",
  "boardEpoch",
  "correlation",
  "transcript",
] as const;

type Item = Record<string, unknown>;
type Send = (
  command: ScanCommand,
) => Promise<Pick<ScanCommandOutput, "Items" | "LastEvaluatedKey">>;

// One read-only pass over the table: every PLAYER# evidence item and run
// history row, projected to the allowlist above. Each page is reduced to the
// numbers the rules need before the next is read, so memory tracks runs, not
// transcripts.
export async function readRunData(
  send: Send,
  tableName: string,
): Promise<{
  runs: AnalysisRun[];
  history: HistoryRun[];
  unscoredRead: number;
}> {
  const names = Object.fromEntries(
    [...ANALYSIS_ATTRIBUTES, "inputEvents"].map((name) => [`#${name}`, name]),
  );
  const evidence: AnalysisRun[] = [];
  const historyItems = new Map<string, Item>();
  let unscoredRead = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await send(
      new ScanCommand({
        TableName: tableName,
        Select: "SPECIFIC_ATTRIBUTES",
        ProjectionExpression: ANALYSIS_ATTRIBUTES.map((name) =>
          name === "transcript" ? "#transcript.#inputEvents" : `#${name}`,
        ).join(", "),
        FilterExpression:
          "begins_with(#pk, :player) AND (begins_with(#sk, :evidence) OR begins_with(#sk, :run))",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: {
          ":player": "PLAYER#",
          ":evidence": "EVIDENCE#",
          ":run": "RUN#",
        },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      if (String(item.sk).startsWith("EVIDENCE#")) {
        if (item.runType !== "ranked") unscoredRead += 1;
        // The transcript reduces to first reads here and is not kept.
        const run = analysisRunFromEvidence(item);
        if (run) evidence.push(run);
      } else if (typeof item.runId === "string") {
        const { pk, runId, mode, score, completedAt, boardEpoch } = item;
        historyItems.set(runId, {
          pk,
          runId,
          mode,
          score,
          completedAt,
          boardEpoch,
        });
      }
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  const runs = evidence.map((run) =>
    withHistoryEpoch(run, historyItems.get(run.runId)?.boardEpoch),
  );
  const history = [...historyItems.values()]
    .map(historyRunFromItem)
    .filter((row): row is HistoryRun => row !== undefined);
  return { runs, history, unscoredRead };
}

export async function runAnalysis(
  send: Send,
  tableName: string,
  now = new Date(),
): Promise<AnalysisOutput> {
  const { runs, history, unscoredRead } = await readRunData(send, tableName);
  const output = analyzeRuns(runs, history, {
    analysisRunAt: now.toISOString(),
    unscoredRead,
  });
  // The summary goes last so a dashboard that sees it knows the run's flag
  // and distribution lines are all written. Every daily run re-emits every
  // current flag: the log keeps 30 days and the board can change.
  for (const line of output.distributions) console.info(line);
  for (const line of output.flags) console.info(line);
  console.info(output.summary);
  return output;
}

// EventBridge Scheduler invokes this once a day. It only reads and logs, so a
// retry or a second run is harmless; the payload is ignored.
export async function runAnalysisHandler(): Promise<void> {
  await runAnalysis((command) => client.send(command), required("TABLE_NAME"));
}
