import { randomInt } from "node:crypto";

// Share tokens — attributed capabilities behind run, Home, and badge shares.
//
// One token per SHARE ACTION. A run token lets Herald count result reach per
// share rather than per run; Home and badge invitation tokens carry Recruiter
// attribution without counting an open. Six characters, drawn from an alphabet
// with no look-alike glyphs, because a player may end up reading one aloud.
//
// A token is a capability to read one already-public result or destination. It
// carries no private player facts: run details are already on the public
// profile, and invitations expose only Home or a public profile id.

// Crockford-style: no I, L, O, U, or 0/1. 32 symbols, 6 characters, so a little
// over a billion tokens — sparse enough that scanning for one is pointless.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const SHARE_TOKEN_LENGTH = 6;
export const SHARE_TOKEN_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

export function mintShareToken(): string {
  let token = "";
  for (let i = 0; i < SHARE_TOKEN_LENGTH; i += 1) {
    token += ALPHABET[randomInt(ALPHABET.length)];
  }
  return token;
}

export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && SHARE_TOKEN_PATTERN.test(value);
}

// Herald counts DISTINCT opens, capped per token, so one lucky link cannot
// clear a whole ladder. Specced in Badge Set.md against a share function that
// did not exist; this is that function.
export const SHARE_OPEN_CREDIT_CAP = 25;
