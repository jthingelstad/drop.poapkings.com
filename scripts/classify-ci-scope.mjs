import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const EMPTY_SCOPE = Object.freeze({
  browser: false,
  deployApi: false,
  deployWeb: false,
  ships: false,
});

function isDocumentation(path) {
  return (
    path.endsWith(".md") ||
    path.startsWith(".claude/") ||
    path.startsWith("AGENT-TEAM/") ||
    path.startsWith("docs/")
  );
}

function isTest(path) {
  return (
    /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(path) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
  );
}

function marksWebRelease(path) {
  if (!path.startsWith("apps/web/")) return false;
  if (
    isDocumentation(path) ||
    isTest(path) ||
    path === "apps/web/playwright.config.ts"
  )
    return false;
  return true;
}

function marksApiRelease(path) {
  if (!path.startsWith("services/api/") && !path.startsWith("infra/"))
    return false;
  if (isDocumentation(path) || isTest(path)) return false;
  return true;
}

function marksWebDeployment(path) {
  return path === "infra/scripts/deploy-web.mjs";
}

/**
 * Classify a commit by the production surfaces and deployment tests it can
 * affect. Unknown paths fail safe to the complete web + API path.
 *
 * A web release also updates the API. WEB_VERSION is part of persisted referee
 * evidence, so the public build and Lambda configuration keep one release
 * boundary even though the stale-tab check itself is served by the web origin.
 */
export function classifyPaths(inputPaths) {
  const paths = [
    ...new Set(
      inputPaths.map((path) => path.replace(/^\.\//, "")).filter(Boolean),
    ),
  ];
  if (paths.length === 0) return { ...EMPTY_SCOPE };

  let browser = false;
  let deployApi = false;
  let deployWeb = false;

  for (const path of paths) {
    if (isDocumentation(path)) continue;

    if (path.startsWith(".github/")) {
      browser = true;
      deployApi = true;
      deployWeb = true;
      continue;
    }

    if (path.startsWith("scripts/")) continue;

    if (
      path === ".gitignore" ||
      path === ".oxlintrc.json" ||
      path === ".prettierignore" ||
      path === ".prettierrc" ||
      path === "CODEOWNERS"
    ) {
      continue;
    }

    if (
      path === "package.json" ||
      path === "package-lock.json" ||
      path.startsWith("packages/")
    ) {
      browser = true;
      deployApi = true;
      deployWeb = true;
      continue;
    }

    if (
      path.startsWith("apps/web/tests/e2e/") ||
      path === "apps/web/playwright.config.ts"
    ) {
      browser = true;
      continue;
    }

    if (marksWebRelease(path)) {
      browser = true;
      deployApi = true;
      deployWeb = true;
      continue;
    }

    if (path.startsWith("apps/web/")) continue;

    if (marksWebDeployment(path)) {
      deployApi = true;
      deployWeb = true;
      continue;
    }

    if (marksApiRelease(path)) {
      deployApi = true;
      continue;
    }

    if (path.startsWith("services/api/") || path.startsWith("infra/")) continue;

    // The bridge and Control Room have their own fixed-host operations. Their
    // tests still run in non-browser verification, but this pipeline does not
    // pretend to deploy them by republishing unrelated public surfaces.
    if (
      path.startsWith("services/cr-api-bridge/") ||
      path.startsWith("services/admin/") ||
      path.startsWith("apps/admin/")
    ) {
      continue;
    }

    // A path the classifier does not understand gets the safest treatment.
    browser = true;
    deployApi = true;
    deployWeb = true;
  }

  return { browser, deployApi, deployWeb, ships: deployApi || deployWeb };
}

function changedPaths(base, head) {
  return execFileSync("git", ["diff", "--name-only", base, head], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function githubOutputs(scope) {
  return [
    `browser=${scope.browser}`,
    `deploy_api=${scope.deployApi}`,
    `deploy_web=${scope.deployWeb}`,
    `ships=${scope.ships}`,
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const outputIndex = args.indexOf("--github-output");
  const outputPath = outputIndex === -1 ? undefined : args[outputIndex + 1];
  const jsonIndex = args.indexOf("--json-output");
  const jsonPath = jsonIndex === -1 ? undefined : args[jsonIndex + 1];
  const baseIndex = args.indexOf("--base");
  const headIndex = args.indexOf("--head");

  const paths = all
    ? [".github/workflows/deploy.yml"]
    : changedPaths(
        baseIndex === -1 ? "HEAD^" : args[baseIndex + 1],
        headIndex === -1 ? "HEAD" : args[headIndex + 1],
      );
  const scope = classifyPaths(paths);
  const output = githubOutputs(scope);

  process.stdout.write(`${JSON.stringify({ paths, ...scope }, null, 2)}\n`);
  if (outputPath) appendFileSync(outputPath, `${output}\n`);
  if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(scope, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
