import {
  CreateAccessKeyCommand,
  CreateRoleCommand,
  CreateUserCommand,
  GetRoleCommand,
  GetUserCommand,
  IAMClient,
  ListAccessKeysCommand,
  PutRolePolicyCommand,
  PutUserPolicyCommand,
} from "@aws-sdk/client-iam";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { chmod, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, serializeEnv } from "./env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const envPath = resolve(repoRoot, ".env");
const sourceEnvPath = resolve(repoRoot, "..", "elixir-bot", ".env");
const region = process.env.AWS_REGION || "us-east-1";
const userName = "elixir-drop";
const executionRoleName = "elixir-drop-cloudformation-execution";
const stackName = "elixir-drop-prod";

const iam = new IAMClient({ region });
const s3 = new S3Client({ region });
const sts = new STSClient({ region });

async function ensureUser() {
  try {
    return (await iam.send(new GetUserCommand({ UserName: userName }))).User;
  } catch (error) {
    if (error?.name !== "NoSuchEntityException") throw error;
    return (
      await iam.send(
        new CreateUserCommand({
          UserName: userName,
          Tags: [{ Key: "application", Value: "elixir-drop" }],
        }),
      )
    ).User;
  }
}

async function ensureRole(accountId, bucketName) {
  let role;
  try {
    role = (await iam.send(new GetRoleCommand({ RoleName: executionRoleName })))
      .Role;
  } catch (error) {
    if (error?.name !== "NoSuchEntityException") throw error;
    role = (
      await iam.send(
        new CreateRoleCommand({
          RoleName: executionRoleName,
          Description: "CloudFormation execution role for Elixir Drop",
          AssumeRolePolicyDocument: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Service: "cloudformation.amazonaws.com" },
                Action: "sts:AssumeRole",
              },
            ],
          }),
          Tags: [{ Key: "application", Value: "elixir-drop" }],
        }),
      )
    ).Role;
  }
  await iam.send(
    new PutRolePolicyCommand({
      RoleName: executionRoleName,
      PolicyName: "elixir-drop-stack-management",
      PolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["dynamodb:*", "lambda:*", "apigateway:*"],
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: ["s3:GetObject", "s3:GetObjectVersion"],
            Resource: `arn:aws:s3:::${bucketName}/*`,
          },
          {
            Effect: "Allow",
            Action: [
              "iam:CreateRole",
              "iam:DeleteRole",
              "iam:DeleteRolePolicy",
              "iam:GetRole",
              "iam:PassRole",
              "iam:PutRolePolicy",
              "iam:TagRole",
              "iam:UntagRole",
            ],
            Resource: `arn:aws:iam::${accountId}:role/elixir-drop-*`,
          },
        ],
      }),
    }),
  );
  return role;
}

async function ensureBucket(bucketName) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound")
      throw error;
    await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
  }
  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: bucketName,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
}

async function accessKey(existingEnv) {
  if (existingEnv.AWS_ACCESS_KEY_ID && existingEnv.AWS_SECRET_ACCESS_KEY) {
    return {
      AccessKeyId: existingEnv.AWS_ACCESS_KEY_ID,
      SecretAccessKey: existingEnv.AWS_SECRET_ACCESS_KEY,
    };
  }
  const keys =
    (await iam.send(new ListAccessKeysCommand({ UserName: userName })))
      .AccessKeyMetadata ?? [];
  if (keys.length) {
    throw new Error(
      `IAM user ${userName} already has an access key, but ${envPath} does not contain its secret. Refusing to create another key.`,
    );
  }
  const key = (
    await iam.send(new CreateAccessKeyCommand({ UserName: userName }))
  ).AccessKey;
  if (!key?.AccessKeyId || !key.SecretAccessKey)
    throw new Error("AWS did not return a complete access key");
  return key;
}

const identity = await sts.send(new GetCallerIdentityCommand({}));
if (!identity.Account)
  throw new Error("AWS caller identity did not include an account ID");
const accountId = identity.Account;
const bucketName = `elixir-drop-deploy-${accountId}-${region}`;
const [existingEnv, sourceEnv] = await Promise.all([
  loadEnv(envPath).catch(() => ({})),
  loadEnv(sourceEnvPath).catch(() => ({})),
]);
const jmapToken =
  existingEnv.FASTMAIL_JMAP_TOKEN || sourceEnv.FASTMAIL_JMAP_TOKEN;
if (!jmapToken)
  throw new Error(`FASTMAIL_JMAP_TOKEN was not found in ${sourceEnvPath}`);

await ensureUser();
const role = await ensureRole(accountId, bucketName);
if (!role?.Arn) throw new Error("CloudFormation execution role has no ARN");
await ensureBucket(bucketName);

await iam.send(
  new PutUserPolicyCommand({
    UserName: userName,
    PolicyName: "elixir-drop-deployment",
    PolicyDocument: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "cloudformation:CreateStack",
            "cloudformation:DescribeStackEvents",
            "cloudformation:DescribeStacks",
            "cloudformation:UpdateStack",
          ],
          Resource: `arn:aws:cloudformation:${region}:${accountId}:stack/${stackName}/*`,
        },
        {
          Effect: "Allow",
          Action: [
            "s3:GetObject",
            "s3:GetObjectVersion",
            "s3:ListBucket",
            "s3:PutObject",
          ],
          Resource: [
            `arn:aws:s3:::${bucketName}`,
            `arn:aws:s3:::${bucketName}/*`,
          ],
        },
        {
          Effect: "Allow",
          Action: "iam:PassRole",
          Resource: role.Arn,
          Condition: {
            StringEquals: {
              "iam:PassedToService": "cloudformation.amazonaws.com",
            },
          },
        },
      ],
    }),
  }),
);

const key = await accessKey(existingEnv);
const values = {
  ...existingEnv,
  APP_URL: existingEnv.APP_URL || "https://drop.poapkings.com",
  AWS_ACCESS_KEY_ID: key.AccessKeyId,
  AWS_REGION: region,
  AWS_SECRET_ACCESS_KEY: key.SecretAccessKey,
  ELIXIR_DROP_CFN_ROLE_ARN: role.Arn,
  ELIXIR_DROP_CODE_BUCKET: bucketName,
  ELIXIR_DROP_EMAIL_FROM:
    existingEnv.ELIXIR_DROP_EMAIL_FROM || "elixir@poapkings.com",
  ELIXIR_DROP_STACK_NAME: stackName,
  FASTMAIL_JMAP_TOKEN: jmapToken,
  NAME_MODEL_ID: existingEnv.NAME_MODEL_ID || "amazon.nova-micro-v1:0",
  SESSION_SECRET:
    existingEnv.SESSION_SECRET || randomBytes(48).toString("base64url"),
};
await writeFile(envPath, serializeEnv(values), { mode: 0o600 });
await chmod(envPath, 0o600);

console.log(`AWS bootstrap is ready for IAM user ${userName}.`);
console.log(
  `Deployment configuration was written to ${envPath} with mode 0600; no secret values were printed.`,
);
