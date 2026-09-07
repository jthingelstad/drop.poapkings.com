import { createHash } from "node:crypto";

export function lambdaCodeKey(bundle) {
  const hash = createHash("sha256");
  for (const bytes of Array.isArray(bundle) ? bundle : [bundle]) {
    hash.update(String(bytes.length)).update(":").update(bytes);
  }
  const digest = hash.digest("hex").slice(0, 16);
  return `lambda/${digest}.zip`;
}

export function isNoUpdatesError(error) {
  return (
    error?.name === "ValidationError" &&
    typeof error.message === "string" &&
    error.message.includes("No updates are to be performed")
  );
}
