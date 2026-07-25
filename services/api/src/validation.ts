import { createHash } from "node:crypto";
import {
  CLASH_ROYALE_TAG_PATTERN,
  emailValidationMessage,
  GAME_MODES,
} from "@elixir-drop/contracts";

// The magic link may carry a player back to the game they were starting.
// Derived from the shipped mode list rather than restated as literals, so a new
// mode's return path can never be forgotten and a retired one cannot linger.
const GAME_RETURN_PATHS = new Set<string>(GAME_MODES.map((mode) => `/${mode}`));

export function normalizeEmail(value: unknown): string {
  const validationMessage = emailValidationMessage(value);
  if (validationMessage) throw new Error(validationMessage);
  if (typeof value !== "string") throw new Error("Enter your email address.");
  const email = value.trim().toLowerCase();
  return email;
}

export function emailSubject(email: string): string {
  return createHash("sha256").update(email).digest("base64url");
}

export function normalizePlayerTag(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Player tag must be a string");
  // Clash Royale tags never contain the letter O; the game itself reads a
  // typed O as a zero, so honor the same canonicalization for players copying
  // tags from screenshots.
  const tag = `#${value.trim().toUpperCase().replaceAll("O", "0").replace(/^#/, "")}`;
  if (!CLASH_ROYALE_TAG_PATTERN.test(tag))
    throw new Error("Enter a valid Clash Royale player tag");
  return tag;
}

export function normalizeGameReturnPath(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return typeof value === "string" && GAME_RETURN_PATHS.has(value)
    ? value
    : undefined;
}

export function requireObject(
  value: unknown,
  label = "Request body",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

// A bounded, non-empty string from untrusted input, trimmed. Shared with the
// bridge-result parser so both boundaries reject the same shapes.
export function requireText(
  value: unknown,
  label: string,
  maxLength = 100,
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength)
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
