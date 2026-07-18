import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
} from "@aws-sdk/client-cloudformation";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const env = await loadEnv(resolve(repoRoot, ".env"));
for (const [key, value] of Object.entries(env)) {
  if (!process.env[key]) process.env[key] = value;
}

const requiredNames = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "ELIXIR_DROP_CFN_ROLE_ARN",
  "ELIXIR_DROP_CODE_BUCKET",
  "ELIXIR_DROP_STACK_NAME",
  "FASTMAIL_JMAP_TOKEN",
  "SESSION_SECRET",
  "APP_URL",
  "ELIXIR_DROP_DISCORD_WEBHOOK_URL",
];
for (const name of requiredNames) {
  if (!process.env[name])
    throw new Error(`Missing ${name}; run npm run bootstrap:aws first`);
}

execFileSync("npm", ["run", "build", "--workspace=@elixir-drop/api"], {
  cwd: repoRoot,
  stdio: "inherit",
});
const bundlePath = resolve(repoRoot, "services/api/dist/handler.cjs");
const bundle = await readFile(bundlePath);
const digest = createHash("sha256").update(bundle).digest("hex").slice(0, 16);
const tempRoot = await mkdtemp(resolve(tmpdir(), "elixir-drop-deploy-"));
const zipPath = resolve(tempRoot, "api.zip");
execFileSync("zip", ["-q", "-j", zipPath, bundlePath]);

try {
  const region = process.env.AWS_REGION;
  const bucket = process.env.ELIXIR_DROP_CODE_BUCKET;
  const stackName = process.env.ELIXIR_DROP_STACK_NAME;
  const codeKey = `lambda/${Date.now()}-${digest}.zip`;
  const s3 = new S3Client({ region });
  const cloudformation = new CloudFormationClient({ region });
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: codeKey,
      Body: await readFile(zipPath),
      ContentType: "application/zip",
      ServerSideEncryption: "AES256",
    }),
  );

  const parameters = [
    ["CodeBucket", bucket],
    ["CodeKey", codeKey],
    ["SessionSecret", process.env.SESSION_SECRET],
    ["FastmailJmapToken", process.env.FASTMAIL_JMAP_TOKEN],
    ["AppUrl", process.env.APP_URL],
    ["DiscordWebhookUrl", process.env.ELIXIR_DROP_DISCORD_WEBHOOK_URL],
    ["EmailFrom", process.env.ELIXIR_DROP_EMAIL_FROM || "elixir@poapkings.com"],
    ["NameModelId", process.env.NAME_MODEL_ID || "amazon.nova-micro-v1:0"],
  ].map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }));
  const common = {
    StackName: stackName,
    TemplateBody: await readFile(
      resolve(repoRoot, "infra/template.yaml"),
      "utf8",
    ),
    Parameters: parameters,
    Capabilities: ["CAPABILITY_NAMED_IAM"],
    RoleARN: process.env.ELIXIR_DROP_CFN_ROLE_ARN,
    Tags: [{ Key: "application", Value: "elixir-drop" }],
  };

  let exists = true;
  try {
    await cloudformation.send(
      new DescribeStacksCommand({ StackName: stackName }),
    );
  } catch (error) {
    if (error?.name === "ValidationError") exists = false;
    else throw error;
  }

  if (exists) {
    await cloudformation.send(new UpdateStackCommand(common));
    const wait = await waitUntilStackUpdateComplete(
      { client: cloudformation, maxWaitTime: 1_200 },
      { StackName: stackName },
    );
    if (wait.state !== "SUCCESS")
      throw new Error(`Stack update ended in ${wait.state}`);
  } else {
    await cloudformation.send(
      new CreateStackCommand({ ...common, OnFailure: "ROLLBACK" }),
    );
    const wait = await waitUntilStackCreateComplete(
      { client: cloudformation, maxWaitTime: 1_200 },
      { StackName: stackName },
    );
    if (wait.state !== "SUCCESS")
      throw new Error(`Stack creation ended in ${wait.state}`);
  }

  const stack = (
    await cloudformation.send(
      new DescribeStacksCommand({ StackName: stackName }),
    )
  ).Stacks?.[0];
  const apiUrl = stack?.Outputs?.find(
    (output) => output.OutputKey === "ApiUrl",
  )?.OutputValue;
  if (!apiUrl) throw new Error("Stack did not return an API URL");
  await writeFile(
    resolve(repoRoot, "apps/web/public/api-config.json"),
    `${JSON.stringify({ apiBaseUrl: apiUrl }, null, 2)}\n`,
  );
  console.log(`Elixir Drop API deployed successfully to ${apiUrl}`);
  console.log("apps/web/public/api-config.json was updated for the web build.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
