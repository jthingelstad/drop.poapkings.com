import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnv, isDeployIdentity } from "./deploy-identity.mjs";
import { loadEnv } from "./env.mjs";
import { waitForFreshSeasonClock } from "./refresh-readiness.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
applyEnv(await loadEnv(resolve(repoRoot, ".env")).catch(() => ({})));

const identity = await new STSClient({ region: process.env.AWS_REGION }).send(
  new GetCallerIdentityCommand({}),
);
if (!isDeployIdentity(identity.Arn)) {
  throw new Error(
    `AWS identity is neither CI's deploy role nor cloud-engineer: ${identity.Arn}`,
  );
}

const stackName = process.env.ELIXIR_DROP_STACK_NAME;
if (!stackName) throw new Error("ELIXIR_DROP_STACK_NAME is missing");
const stack = (
  await new CloudFormationClient({ region: process.env.AWS_REGION }).send(
    new DescribeStacksCommand({ StackName: stackName }),
  )
).Stacks?.[0];
if (!stack?.StackStatus?.endsWith("_COMPLETE")) {
  throw new Error(`Production stack is not settled: ${stack?.StackStatus}`);
}

const publicConfig = await fetch(
  new URL("../../apps/web/public/api-config.json", import.meta.url),
).catch(() => undefined);
let apiBaseUrl;
if (publicConfig?.ok) {
  apiBaseUrl = (await publicConfig.json()).apiBaseUrl;
} else {
  const { readFile } = await import("node:fs/promises");
  apiBaseUrl = JSON.parse(
    await readFile(
      resolve(repoRoot, "apps/web/public/api-config.json"),
      "utf8",
    ),
  ).apiBaseUrl;
}
if (!apiBaseUrl) throw new Error("Public API URL is missing");
const stackApiUrl = stack.Outputs?.find(
  (output) => output.OutputKey === "ApiUrl",
)?.OutputValue;
if (stackApiUrl !== apiBaseUrl) {
  throw new Error(
    "Public API configuration does not match the production stack",
  );
}

const allowedOrigins = [
  "https://drop.poapkings.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];
for (const origin of allowedOrigins) {
  const health = await fetch(`${apiBaseUrl}/health`, { headers: { origin } });
  if (!health.ok || !(await health.json()).ok)
    throw new Error(`Health check failed for ${origin}`);
  if (health.headers.get("access-control-allow-origin") !== origin) {
    throw new Error(`CORS origin was not returned for ${origin}`);
  }
}

const statsBody = await waitForFreshSeasonClock(async () => {
  const stats = await fetch(`${apiBaseUrl}/stats`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!stats.ok) throw new Error("Stats check failed");
  const statsBody = await stats.json();
  if (
    !Number.isSafeInteger(statsBody.trophyRoadGames) ||
    statsBody.trophyRoadGames < 592 ||
    !statsBody.currentSeason?.id ||
    "totalGames" in statsBody ||
    "completedGames" in statsBody ||
    "authenticatedGames" in statsBody
  ) {
    throw new Error("Stats response does not match the Trophy Road contract");
  }
  return statsBody;
});

const leaderboard = await fetch(`${apiBaseUrl}/leaderboards?mode=surge`);
if (!leaderboard.ok) throw new Error("Leaderboard check failed");
const leaderboardBody = await leaderboard.json();
if (
  !leaderboardBody.currentSeason?.id ||
  !Array.isArray(leaderboardBody.entries)
) {
  throw new Error("Leaderboard response is incomplete");
}

// Drop signs in only with Elixir (2026-10-12): the emailed-code route is
// gone and answers like any unknown route. The body is deliberately not an
// address, so even a regression could not mail anyone.
const removedEmailLogin = await fetch(`${apiBaseUrl}/auth/request`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "not-an-address" }),
});
const removedEmailLoginBody = await removedEmailLogin.json().catch(() => ({}));
if (
  removedEmailLogin.status !== 404 ||
  removedEmailLoginBody.error?.code !== "not_found"
) {
  throw new Error("The retired email sign-in route still answers");
}

// Refusal happens before repository access. Bearer forwarding through OAC
// must distinguish a missing session from an invalid supplied session.
for (const [authorization, expected] of [
  [undefined, "authentication_required"],
  ["Bearer invalid", "invalid_session"],
]) {
  const refused = await fetch(`${apiBaseUrl}/me`, {
    headers: authorization ? { authorization } : {},
  });
  const body = await refused.json();
  if (refused.status !== 401 || body.error?.code !== expected)
    throw new Error("OAC bearer forwarding or session refusal failed");
}
const origin = stack.Outputs?.find(
  (output) => output.OutputKey === "ApiOriginDomain",
)?.OutputValue;
if (!origin) throw new Error("Missing private API origin");
const direct = await fetch(`https://${origin}/health`);
if (direct.status !== 403)
  throw new Error("Unsigned direct origin access was not denied");

const appUrl = process.env.APP_URL || "https://drop.poapkings.com";
const [website, deployedConfig] = await Promise.all([
  fetch(`${appUrl}/`),
  fetch(`${appUrl}/api-config.json`),
]);
if (!website.ok || !(await website.text()).includes("Elixir Drop")) {
  throw new Error("Production website check failed");
}
if (!deployedConfig.ok || (await deployedConfig.json()).apiBaseUrl !== "/api") {
  throw new Error("Production website is not using the same-origin API");
}

console.log(
  JSON.stringify({
    api: "healthy",
    stack: stack.StackStatus,
    cors: "verified",
    deploymentIdentity: identity.Arn,
    bearerForwarding: "verified",
    directOrigin: "denied",
    emailSignIn: "removed",
    leaderboard: "verified",
    clashRoyaleClock: "fresh",
    website: "healthy",
    trophyRoadGames: statsBody.trophyRoadGames,
  }),
);
