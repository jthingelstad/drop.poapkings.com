import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNoUpdatesError,
  lambdaCodeKey,
} from "../scripts/deployment-code.mjs";

void describe("deployment code identity", () => {
  void it("uses one immutable object key for identical Lambda bytes", () => {
    const first = lambdaCodeKey(Buffer.from("same bundle"));
    const second = lambdaCodeKey(Buffer.from("same bundle"));

    assert.equal(first, second);
    assert.match(first, /^lambda\/[a-f0-9]{16}\.zip$/);
  });

  void it("changes the object key when the Lambda bytes change", () => {
    assert.notEqual(
      lambdaCodeKey(Buffer.from("first bundle")),
      lambdaCodeKey(Buffer.from("second bundle")),
    );
  });

  void it("recognizes only CloudFormation's no-op update response", () => {
    assert.equal(
      isNoUpdatesError({
        name: "ValidationError",
        message: "No updates are to be performed.",
      }),
      true,
    );
    assert.equal(
      isNoUpdatesError({
        name: "ValidationError",
        message: "Template invalid",
      }),
      false,
    );
    assert.equal(
      isNoUpdatesError({
        name: "AccessDenied",
        message: "No updates are to be performed.",
      }),
      false,
    );
  });
});
