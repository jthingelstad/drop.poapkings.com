import assert from "node:assert/strict";
import test from "node:test";
import { classifyPaths } from "./classify-ci-scope.mjs";

void test("documentation and local operator changes do not ship", () => {
  assert.deepEqual(
    classifyPaths([
      "README.md",
      "docs/offline.md",
      "AGENT-TEAM/run-drop.md",
      "scripts/report.mjs",
    ]),
    {
      browser: false,
      deployApi: false,
      deployWeb: false,
      ships: false,
    },
  );
});

void test("API implementation changes deploy only the API", () => {
  assert.deepEqual(
    classifyPaths(["services/api/src/routes/runs-complete.ts"]),
    {
      browser: false,
      deployApi: true,
      deployWeb: false,
      ships: true,
    },
  );
});

void test("API and infrastructure tests validate without redeploying", () => {
  assert.deepEqual(
    classifyPaths([
      "services/api/tests/runs.test.ts",
      "infra/tests/deploy.test.ts",
    ]),
    {
      browser: false,
      deployApi: false,
      deployWeb: false,
      ships: false,
    },
  );
});

void test("web deployment changes publish both production surfaces", () => {
  assert.deepEqual(classifyPaths(["infra/scripts/deploy-web.mjs"]), {
    browser: false,
    deployApi: true,
    deployWeb: true,
    ships: true,
  });
});

void test("web implementation changes run browsers and preserve the API evidence boundary", () => {
  assert.deepEqual(classifyPaths(["apps/web/src/screens/Practice.tsx"]), {
    browser: true,
    deployApi: true,
    deployWeb: true,
    ships: true,
  });
});

void test("browser tests run browsers without republishing production", () => {
  assert.deepEqual(
    classifyPaths(["apps/web/tests/e2e/gameplay-practice.spec.ts"]),
    {
      browser: true,
      deployApi: false,
      deployWeb: false,
      ships: false,
    },
  );
});

void test("web unit tests stay in non-browser verification", () => {
  assert.deepEqual(classifyPaths(["apps/web/tests/unit/version.test.ts"]), {
    browser: false,
    deployApi: false,
    deployWeb: false,
    ships: false,
  });
});

void test("shared packages and workflow changes take the fail-safe full path", () => {
  for (const path of [
    "packages/contracts/src/index.ts",
    "packages/game-data/cards.json",
    ".github/workflows/deploy.yml",
  ]) {
    assert.deepEqual(classifyPaths([path]), {
      browser: true,
      deployApi: true,
      deployWeb: true,
      ships: true,
    });
  }
});

void test("fixed-host applications do not republish the unrelated public surfaces", () => {
  assert.deepEqual(
    classifyPaths([
      "services/cr-api-bridge/src/index.ts",
      "apps/admin/src/App.tsx",
    ]),
    {
      browser: false,
      deployApi: false,
      deployWeb: false,
      ships: false,
    },
  );
});

void test("unknown paths fail safe to complete verification and deployment", () => {
  assert.deepEqual(classifyPaths(["new-surface/config.toml"]), {
    browser: true,
    deployApi: true,
    deployWeb: true,
    ships: true,
  });
});
