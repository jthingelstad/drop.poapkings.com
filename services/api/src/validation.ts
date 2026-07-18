import { createHash } from "node:crypto";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLAYER_TAG_PATTERN = /^#[0289PYLQGRJCUV]{3,15}$/;

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("Email is required");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email))
    throw new Error("Enter a valid email address");
  return email;
}

export function emailSubject(email: string): string {
  return createHash("sha256").update(email).digest("base64url");
}

export function normalizePlayerTag(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Player tag must be a string");
  const tag = `#${value.trim().toUpperCase().replace(/^#/, "")}`;
  if (!PLAYER_TAG_PATTERN.test(tag))
    throw new Error("Enter a valid Clash Royale player tag");
  return tag;
}

export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Request body must be an object");
  return value as Record<string, unknown>;
}
