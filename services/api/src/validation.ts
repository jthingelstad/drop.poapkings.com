import { createHash } from "node:crypto";
import { emailValidationMessage } from "@elixir-drop/contracts";

const PLAYER_TAG_PATTERN = /^#[0289PYLQGRJCUV]{3,15}$/;
const GAME_RETURN_PATHS = new Set([
  "/practice",
  "/surge",
  "/higher-lower",
  "/trade",
  "/survival",
]);

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
  if (!PLAYER_TAG_PATTERN.test(tag))
    throw new Error("Enter a valid Clash Royale player tag");
  return tag;
}

export function normalizeGameReturnPath(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return typeof value === "string" && GAME_RETURN_PATHS.has(value)
    ? value
    : undefined;
}

export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Request body must be an object");
  return value as Record<string, unknown>;
}
