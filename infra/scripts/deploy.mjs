import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
} from "@aws-sdk/client-cloudformation";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";
import { isNoUpdatesError, lambdaCodeKey } from "./deployment-code.mjs";
import { deploymentParameters } from "./parameters.mjs";
import { deploymentTemplateSource } from "./template-source.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const env = await loadEnv(resolve(repoRoot, ".env")).catch(() => ({}));
for (const [key, value] of Object.entries(env)) {
  if (!process.env[key]) process.env[key] = value;
}

const requiredNames = [
  "AWS_REGION",
  "ELIXIR_DROP_CFN_ROLE_ARN",
  "ELIXIR_DROP_CODE_BUCKET",
  "ELIXIR_DROP_STACK_NAME",
];
for (const name of requiredNames) {
  if (!process.env[name]) throw new Error(`Missing deployment setting ${name}`);
}

execFileSync("npm", ["run", "build", "--workspace=@elixir-drop/api"], {
  cwd: repoRoot,
  stdio: "inherit",
});
const bundlePath = resolve(repoRoot, "services/api/dist/handler.cjs");
const bundle = await readFile(bundlePath);
const tempRoot = await mkdtemp(resolve(tmpdir(), "elixir-drop-deploy-"));
const zipPath = resolve(tempRoot, "api.zip");
execFileSync("zip", ["-q", "-j", zipPath, bundlePath]);

try {
  const region = process.env.AWS_REGION;
  const bucket = process.env.ELIXIR_DROP_CODE_BUCKET;
  const stackName = process.env.ELIXIR_DROP_STACK_NAME;
  // Content-addressed objects make an unchanged API bundle a real no-op. The
  // previous timestamped key forced CloudFormation to publish a new Lambda
  // version even when only unrelated repository files had changed.
  const codeKey = lambdaCodeKey(bundle);
  const s3 = new S3Client({ region });
  const cloudformation = new CloudFormationClient({ region });

  let exists = true;
  try {
    await cloudformation.send(
      new DescribeStacksCommand({ StackName: stackName }),
    );
  } catch (error) {
    if (error?.name === "ValidationError") exists = false;
    else throw error;
  }

  const parameters = deploymentParameters({
    bucket,
    codeKey,
    environment: process.env,
    stackExists: exists,
  });
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: codeKey,
      Body: await readFile(zipPath),
      ContentType: "application/zip",
      ServerSideEncryption: "AES256",
    }),
  );
  const template = deploymentTemplateSource({
    body: await readFile(resolve(repoRoot, "infra/template.yaml"), "utf8"),
    bucket,
    region,
  });
  if (template.upload) {
    await s3.send(new PutObjectCommand(template.upload));
  }

  const common = {
    StackName: stackName,
    ...template.request,
    Parameters: parameters,
    Capabilities: ["CAPABILITY_NAMED_IAM"],
    RoleARN: process.env.ELIXIR_DROP_CFN_ROLE_ARN,
    Tags: [{ Key: "application", Value: "elixir-drop" }],
  };

  if (exists) {
    let updated = true;
    try {
      await cloudformation.send(new UpdateStackCommand(common));
    } catch (error) {
      if (isNoUpdatesError(error)) updated = false;
      else throw error;
    }
    if (updated) {
      const wait = await waitUntilStackUpdateComplete(
        { client: cloudformation, maxWaitTime: 1_200 },
        { StackName: stackName },
      );
      if (wait.state !== "SUCCESS")
        throw new Error(`Stack update ended in ${wait.state}`);
    } else {
      console.log("CloudFormation is already at the requested API version.");
    }
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
  console.log(`Elixir Drop API is ready at ${apiUrl}`);
  console.log("apps/web/public/api-config.json was updated for the web build.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
