import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyPolicy, originPolicy } from "../scripts/web-policy.mjs";
const properties = {
  ResourceArn: "function-arn",
  EndpointArn: "endpoint-arn",
  DistributionArn: "distribution-arn",
};
void describe("Web Function origin policy", () => {
  void it("permits our distribution and denies direct or other-origin invocation", () => {
    const policy = originPolicy(properties);
    assert.equal(
      policy.Statement[0].Condition.StringEquals["aws:SourceArn"],
      properties.DistributionArn,
    );
    assert.equal(policy.Statement[1].Effect, "Deny");
    assert.equal(policy.Statement[1].Resource, properties.EndpointArn);
  });
  void it("creates, updates with a conflict guard, and leaves an identical policy alone", async () => {
    for (const current of [
      undefined,
      { policy: "old", revisionId: "revision" },
      {
        policy: JSON.stringify(originPolicy(properties)),
        revisionId: "revision",
      },
    ]) {
      const commands = [];
      const api = {
        send: async (command) => {
          commands.push(command);
          if (commands.length === 1) {
            if (!current)
              throw Object.assign(new Error(), {
                name: "ResourceNotFoundException",
              });
            return current;
          }
          return {};
        },
      };
      await applyPolicy(
        { RequestType: "Update", ResourceProperties: properties },
        api,
      );
      assert.equal(
        commands.length,
        current?.policy === JSON.stringify(originPolicy(properties)) ? 1 : 2,
      );
      if (commands.length === 2)
        assert.equal(commands[1].input.revisionId, current?.revisionId);
    }
  });
  void it("deletes its policy and tolerates an already-removed function", async () => {
    const commands = [];
    await applyPolicy(
      { RequestType: "Delete", ResourceProperties: properties },
      {
        send: async (command) => {
          commands.push(command);
          return { revisionId: "revision" };
        },
      },
    );
    assert.equal(commands[1].constructor.name, "DeleteResourcePolicyCommand");
    assert.equal(commands[1].input.revisionId, "revision");
    await applyPolicy(
      { RequestType: "Delete", ResourceProperties: properties },
      {
        send: async () => {
          throw Object.assign(new Error(), {
            name: "ResourceNotFoundException",
          });
        },
      },
    );
  });
  void it("propagates policy conflicts instead of overwriting concurrent changes", async () => {
    await assert.rejects(
      applyPolicy(
        { RequestType: "Update", ResourceProperties: properties },
        {
          send: async () => {
            throw Object.assign(new Error(), { name: "ConflictException" });
          },
        },
      ),
      { name: "ConflictException" },
    );
  });
});
