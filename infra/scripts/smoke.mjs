import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const env = await loadEnv(resolve(repoRoot, ".env")).catch(() => ({}));
for (const [key, value] of Object.entries(env)) {
  if (!process.env[key]) process.env[key] = value;
}

const identity = await new STSClient({ region: process.env.AWS_REGION }).send(
  new GetCallerIdentityCommand({}),
);
if (!identity.Arn?.endsWith(":user/elixir-drop")) {
  throw new Error(
    `Routine AWS identity is not the elixir-drop user: ${identity.Arn}`,
  );
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

const stats = await fetch(`${apiBaseUrl}/stats`);
if (!stats.ok) throw new Error("Stats check failed");
const statsBody = await stats.json();

const leaderboard = await fetch(`${apiBaseUrl}/leaderboards?mode=surge`);
if (!leaderboard.ok) throw new Error("Leaderboard check failed");
const leaderboardBody = await leaderboard.json();
if (
  !leaderboardBody.currentSeason?.id ||
  !Array.isArray(leaderboardBody.entries)
) {
  throw new Error("Leaderboard response is incomplete");
}

const started = await fetch(`${apiBaseUrl}/runs/start`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "practice" }),
});
const unauthenticatedStart = await started.json();
if (
  started.status !== 401 ||
  unauthenticatedStart.error?.code !== "authentication_required"
) {
  throw new Error("Unauthenticated run start was not rejected");
}

const rejectedCompletion = await fetch(`${apiBaseUrl}/runs/complete`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ runToken: "unsigned", transcript: {} }),
});
const unauthenticatedCompletion = await rejectedCompletion.json();
if (
  rejectedCompletion.status !== 401 ||
  unauthenticatedCompletion.error?.code !== "authentication_required"
) {
  throw new Error("Unauthenticated run completion was not rejected");
}

let fastmailJmap = "not checked";
if (process.env.FASTMAIL_JMAP_TOKEN) {
  const jmap = await fetch("https://api.fastmail.com/jmap/session", {
    headers: { authorization: `Bearer ${process.env.FASTMAIL_JMAP_TOKEN}` },
  });
  if (!jmap.ok)
    throw new Error(`Fastmail JMAP token check failed with ${jmap.status}`);
  const jmapSession = await jmap.json();
  if (!jmapSession.primaryAccounts?.["urn:ietf:params:jmap:mail"]) {
    throw new Error("Fastmail JMAP session has no mail account");
  }
  fastmailJmap = "verified";
}

console.log(
  JSON.stringify({
    api: "healthy",
    cors: "verified",
    deploymentIdentity: identity.Arn,
    fastmailJmap,
    anonymousPlay: "rejected",
    leaderboard: "verified",
    totalGames: statsBody.totalGames,
  }),
);
