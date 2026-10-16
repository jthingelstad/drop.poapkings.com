import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const template = readFileSync(
  new URL("../template.yaml", import.meta.url),
  "utf8",
);

// One top-level resource's text, from its logical id to the next one.
const resource = (name) =>
  template.match(
    new RegExp(`\\n  ${name}:\\n[\\s\\S]*?(?=\\n  [A-Za-z]+:\\n)`),
  )?.[0];

const SECRET_ARN =
  "secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:elixir-drop-runtime-??????";

void describe("runtime secret (infra/README.md, Runtime secret)", () => {
  for (const [fn, role] of [
    ["ApiWebRevision", "ApiRole"],
    ["RefreshFunction", "RefreshRole"],
    ["CrResultFunction", "CrResultRole"],
  ]) {
    void it(`${fn} names the secret and ${role} may read only it`, () => {
      assert.match(
        resource(fn) ?? "",
        /RUNTIME_SECRET_ID: elixir-drop-runtime\n/,
      );
      const policy = resource(role) ?? "";
      assert.ok(policy.includes(`Action: secretsmanager:GetSecretValue`));
      assert.ok(policy.includes(SECRET_ARN));
    });
  }

  void it("no other role can read a secret", () => {
    for (const role of [
      "WebPolicyRole",
      "RefereeReadRole",
      "RunReportsRole",
      "DropControlRole",
      "LeaderboardMaintenanceRole",
    ]) {
      const text = resource(role);
      assert.ok(text, `${role} exists`);
      assert.doesNotMatch(text, /secretsmanager/);
    }
    assert.equal(template.match(/secretsmanager:GetSecretValue/g)?.length, 3);
  });

  void it("never resolves a secret into a function environment", () => {
    assert.doesNotMatch(template, /\{\{resolve:secretsmanager/);
  });
});
