import {
  CloudFrontClient,
  CreateInvalidationCommand,
  waitUntilInvalidationCompleted,
} from "@aws-sdk/client-cloudfront";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

export function contentTypeFor(key) {
  return (
    CONTENT_TYPES.get(extname(key).toLowerCase()) ?? "application/octet-stream"
  );
}

export function cacheControlFor(key) {
  if (key === "api-config.json" || key === "version.json") return "no-store";
  if (key === "card-art-sw.js" || key === "site.webmanifest") return "no-cache";
  if (key.endsWith(".html")) return "public, max-age=0, s-maxage=300";
  if (/^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/.test(key))
    return "public, max-age=31536000, immutable";
  if (
    key.startsWith("cards/") ||
    /\.(?:otf|png|svg|webmanifest|woff2?)$/.test(key)
  )
    return "public, max-age=604800";
  return "public, max-age=3600";
}

async function filesUnder(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
    else if (entry.isFile()) {
      const key = relative(root, path).split(sep).join("/");
      if (key !== "CNAME") files.push({ key, path });
    }
  }
  return files;
}

async function concurrently(items, limit, action) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await action(item);
      }
    }),
  );
}

async function existingKeys(s3, bucket) {
  const keys = [];
  let continuationToken;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    keys.push(
      ...(page.Contents ?? []).flatMap(({ Key }) => (Key ? [Key] : [])),
    );
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return keys;
}

function output(stack, key) {
  const value = stack?.Outputs?.find(
    ({ OutputKey }) => OutputKey === key,
  )?.OutputValue;
  if (!value) throw new Error(`Stack did not return ${key}`);
  return value;
}

async function expectResponse(url, check) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`${url} returned HTTP ${response.status}`);
      const body = await response.text();
      if (!check(body)) throw new Error(`${url} returned unexpected content`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 6)
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
    }
  }
  throw lastError;
}

export async function main() {
  const env = await loadEnv(resolve(repoRoot, ".env")).catch(() => ({}));
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) process.env[key] = value;
  }

  const region = process.env.AWS_REGION;
  const stackName = process.env.ELIXIR_DROP_STACK_NAME;
  if (!region) throw new Error("Missing deployment setting AWS_REGION");
  if (!stackName)
    throw new Error("Missing deployment setting ELIXIR_DROP_STACK_NAME");

  const distRoot = resolve(repoRoot, "apps/web/dist");
  await writeFile(
    resolve(distRoot, "api-config.json"),
    `${JSON.stringify({ apiBaseUrl: "/api" }, null, 2)}\n`,
  );
  const files = await filesUnder(distRoot);
  if (!files.some(({ key }) => key === "index.html"))
    throw new Error("The website build is missing apps/web/dist/index.html");

  const cloudformation = new CloudFormationClient({ region });
  const stack = (
    await cloudformation.send(
      new DescribeStacksCommand({ StackName: stackName }),
    )
  ).Stacks?.[0];
  const bucket = output(stack, "WebBucketName");
  const distributionId = output(stack, "WebDistributionId");
  const distributionDomain = output(stack, "WebDistributionDomainName");
  const s3 = new S3Client({ region });

  await concurrently(files, 16, async ({ key, path }) => {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: await readFile(path),
        CacheControl: cacheControlFor(key),
        ContentType: contentTypeFor(key),
      }),
    );
  });

  const desired = new Set(files.map(({ key }) => key));
  const stale = (await existingKeys(s3, bucket)).filter(
    (key) => !desired.has(key),
  );
  for (let offset = 0; offset < stale.length; offset += 1_000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: stale.slice(offset, offset + 1_000).map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }

  const cloudfront = new CloudFrontClient({ region: "us-east-1" });
  const invalidation = await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `${process.env.GITHUB_SHA ?? "local"}-${randomUUID()}`,
        Paths: { Quantity: 1, Items: ["/*"] },
      },
    }),
  );
  if (!invalidation.Invalidation?.Id)
    throw new Error("CloudFront did not return an invalidation ID");
  const wait = await waitUntilInvalidationCompleted(
    { client: cloudfront, maxWaitTime: 600 },
    {
      DistributionId: distributionId,
      Id: invalidation.Invalidation.Id,
    },
  );
  if (wait.state !== "SUCCESS")
    throw new Error(`CloudFront invalidation ended in ${wait.state}`);

  const preview = `https://${distributionDomain}`;
  await Promise.all([
    expectResponse(`${preview}/`, (body) => body.includes("Elixir Drop")),
    expectResponse(`${preview}/games/`, (body) => body.includes("Elixir Drop")),
    expectResponse(`${preview}/api-config.json`, (body) => {
      try {
        return JSON.parse(body).apiBaseUrl === "/api";
      } catch {
        return false;
      }
    }),
    expectResponse(`${preview}/api/health`, (body) => {
      try {
        return JSON.parse(body).ok === true;
      } catch {
        return false;
      }
    }),
  ]);
  console.log(
    `Uploaded ${files.length} web files to ${bucket}; CloudFront preview passed at ${preview}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
