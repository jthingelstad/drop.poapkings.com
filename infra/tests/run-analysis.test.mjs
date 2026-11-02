import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const template = readFileSync(
  new URL("../template.yaml", import.meta.url),
  "utf8",
);
const deploy = readFileSync(
  new URL("../scripts/deploy.mjs", import.meta.url),
  "utf8",
);
const job = readFileSync(
  new URL("../../services/api/src/run-analysis-job.ts", import.meta.url),
  "utf8",
);

// One top-level resource's text, from its logical id to the next one.
const resource = (name) =>
  template.match(
    new RegExp(`\\n  ${name}:\\n[\\s\\S]*?(?=\\n  [A-Za-z]+:\\n)`),
  )?.[0] ?? "";

void describe("daily run analysis (docs/FAIR-PLAY.md, Run analysis)", () => {
  void it("runs once a day at 11:15 UTC, straight at its own function", () => {
    const schedule = resource("RunAnalysisSchedule");
    assert.match(schedule, /Name: !Sub \$\{AWS::StackName\}-run-analysis\n/);
    assert.match(schedule, /ScheduleExpression: cron\(15 11 \* \* \? \*\)/);
    assert.match(schedule, /ScheduleExpressionTimezone: UTC/);
    assert.match(schedule, /Arn: !GetAtt RunAnalysisFunction\.Arn/);
    assert.match(schedule, /RoleArn: !GetAtt RunAnalysisScheduleRole\.Arn/);
    const role = resource("RunAnalysisScheduleRole");
    assert.match(
      role,
      /Action: lambda:InvokeFunction\s+Resource: !GetAtt RunAnalysisFunction\.Arn/,
    );
    assert.match(role, /aws:SourceAccount: !Ref AWS::AccountId/);
  });

  void it("can only scan the base table, projected to the attributes it reads", () => {
    const role = resource("RunAnalysisRole");
    assert.match(
      role,
      /RoleName: !Sub \$\{AWS::StackName\}-run-analysis-lambda/,
    );
    // Every action the role names, wherever it is written.
    const actions = [
      ...role.matchAll(/(?:- |Action: )([a-z0-9-]+:[A-Za-z]+)\b/g),
    ]
      .map((match) => match[1])
      .filter((action) => !action.startsWith("sts:"))
      .sort();
    assert.deepEqual(actions, [
      "dynamodb:Scan",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    assert.match(
      role,
      /Action: dynamodb:Scan\s+Resource: !GetAtt DataTable\.Arn\s+Condition:\s+StringEquals:\s+dynamodb:Select: SPECIFIC_ATTRIBUTES/,
    );
    assert.doesNotMatch(role, /index\//);

    // The IAM allowlist and the job's projection are the same list.
    const allowed = [
      ...role
        .match(/dynamodb:Attributes:\n((?:\s+- \w+\n?)+)/)[1]
        .matchAll(/- (\w+)/g),
    ].map((match) => match[1]);
    const projected = [
      ...job
        .match(/ANALYSIS_ATTRIBUTES = \[([\s\S]*?)\] as const/)[1]
        .matchAll(/"(\w+)"/g),
    ].map((match) => match[1]);
    assert.deepEqual(allowed, projected);
    for (const identity of [
      "email",
      "playerSub",
      "playerTag",
      "playerId",
      "publicName",
      "sub",
    ])
      assert.ok(!allowed.includes(identity), `${identity} is not readable`);
  });

  void it("holds no secret, queue, or hub credential", () => {
    const fn = resource("RunAnalysisFunction");
    assert.match(fn, /Handler: run-analysis-job\.runAnalysisHandler/);
    assert.match(fn, /LogGroup: !Ref RunAnalysisLogGroup/);
    assert.match(fn, /ReservedConcurrentExecutions: 1/);
    assert.doesNotMatch(
      fn,
      /RUNTIME_SECRET_ID|TELEMETRY_PEPPER|SESSION_SECRET|ELIXIR_|QUEUE/,
    );
    assert.doesNotMatch(resource("RunAnalysisRole"), /secretsmanager|sqs:/);
    assert.match(
      resource("RunAnalysisLogGroup"),
      /LogGroupName: \/elixir-drop\/run-analysis\s+RetentionInDays: 30/,
    );
  });

  void it("ships its bundle in the event code zip", () => {
    assert.match(deploy, /"run-analysis-job\.cjs"/);
  });
});
