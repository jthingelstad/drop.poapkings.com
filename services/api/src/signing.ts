import { createHmac, timingSafeEqual } from "node:crypto";
import type { SignedClaims } from "./types.js";

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signToken(claims: SignedClaims, secret: string): string {
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyToken<T extends SignedClaims["type"]>(
  token: string,
  expectedType: T,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Extract<SignedClaims, { type: T }> {
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra) throw new Error("Invalid token");
  const expectedSignature = signature(payload, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    throw new Error("Invalid token");

  let claims: SignedClaims;
  try {
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as SignedClaims;
  } catch {
    throw new Error("Invalid token");
  }
  if (
    claims.type !== expectedType ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= nowSeconds
  ) {
    throw new Error("Expired or invalid token");
  }
  return claims as Extract<SignedClaims, { type: T }>;
}
