import { createHash } from "node:crypto";

export function lambdaCodeKey(bundle) {
  const digest = createHash("sha256").update(bundle).digest("hex").slice(0, 16);
  return `lambda/${digest}.zip`;
}

export function isNoUpdatesError(error) {
  return (
    error?.name === "ValidationError" &&
    typeof error.message === "string" &&
    error.message.includes("No updates are to be performed")
  );
}
