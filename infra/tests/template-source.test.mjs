import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deploymentTemplateSource,
  MAX_INLINE_TEMPLATE_BYTES,
} from "../scripts/template-source.mjs";

void describe("CloudFormation template source", () => {
  void it("keeps templates at the inline limit in TemplateBody", () => {
    const body = "a".repeat(MAX_INLINE_TEMPLATE_BYTES);

    assert.deepEqual(
      deploymentTemplateSource({
        body,
        bucket: "private-code-bucket",
        region: "us-east-1",
      }),
      { request: { TemplateBody: body } },
    );
  });

  void it("uploads oversized templates and deploys from the private bucket", () => {
    const body = "a".repeat(MAX_INLINE_TEMPLATE_BYTES + 1);
    const result = deploymentTemplateSource({
      body,
      bucket: "private-code-bucket",
      region: "us-east-1",
    });

    assert.deepEqual(result, {
      request: {
        TemplateURL:
          "https://private-code-bucket.s3.us-east-1.amazonaws.com/cloudformation/d33d829d1d98413e.yaml",
      },
      upload: {
        Bucket: "private-code-bucket",
        Key: "cloudformation/d33d829d1d98413e.yaml",
        Body: body,
        ContentType: "application/yaml",
        ServerSideEncryption: "AES256",
      },
    });
  });
});
