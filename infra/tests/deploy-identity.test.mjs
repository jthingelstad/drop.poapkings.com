import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  applyEnv,
  DEPLOY_ROLE,
  GITHUB_SUBJECTS,
  githubDeployTrustFor,
  isDeployIdentity,
} from "../scripts/deploy-identity.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);

// CI deploys through GitHub OIDC (2026-09-26); these pin who can.
void describe("deploy identity", () => {
  void it("trusts only this repository's production environment", () => {
    const [statement] = githubDeployTrustFor("123456789012").Statement;
    assert.equal(statement.Action, "sts:AssumeRoleWithWebIdentity");
    assert.deepEqual(statement.Condition, {
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": GITHUB_SUBJECTS,
      },
    });
    for (const subject of GITHUB_SUBJECTS) {
      assert.match(subject, /drop\.poapkings\.com.*:environment:production$/);
    }
  });

  void it("accepts the CI role and the local operator, nothing else", () => {
    assert.ok(
      isDeployIdentity(
        `arn:aws:sts::123456789012:assumed-role/${DEPLOY_ROLE}/elixir-drop-deploy-1`,
      ),
    );
    assert.ok(
      isDeployIdentity(
        "arn:aws:sts::123456789012:assumed-role/ProjectsCloudEngineer/projects-cloud-engineer",
      ),
    );
    assert.ok(!isDeployIdentity("arn:aws:iam::123456789012:user/elixir-drop"));
    assert.ok(!isDeployIdentity(undefined));
  });

  void it("never lifts a static AWS key from .env", () => {
    const target = applyEnv(
      {
        AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_SESSION_TOKEN: "token",
        ELIXIR_DROP_STACK_NAME: "from-env-file",
        AWS_REGION: "us-east-1",
      },
      { AWS_REGION: "us-west-2" },
    );
    assert.deepEqual(target, {
      AWS_REGION: "us-west-2",
      ELIXIR_DROP_STACK_NAME: "from-env-file",
    });
  });

  void it("deploys from the production environment with the OIDC role", () => {
    assert.match(workflow, /environment: production/);
    assert.match(workflow, /id-token: write/);
    assert.match(
      workflow,
      /role-to-assume: \$\{\{ vars\.ELIXIR_DROP_DEPLOY_ROLE_ARN \}\}/,
    );
    assert.doesNotMatch(
      workflow,
      /ELIXIR_DROP_AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)/,
    );
  });
});
