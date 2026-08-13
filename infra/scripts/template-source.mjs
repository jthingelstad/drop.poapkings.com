import { createHash } from "node:crypto";

export const MAX_INLINE_TEMPLATE_BYTES = 51_200;

export function deploymentTemplateSource({ body, bucket, region }) {
  if (Buffer.byteLength(body, "utf8") <= MAX_INLINE_TEMPLATE_BYTES) {
    return { request: { TemplateBody: body } };
  }

  const digest = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const key = `cloudformation/${digest}.yaml`;
  return {
    request: {
      TemplateURL: `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
    },
    upload: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/yaml",
      ServerSideEncryption: "AES256",
    },
  };
}
