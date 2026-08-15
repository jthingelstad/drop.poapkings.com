#!/usr/bin/env node

// Applies scripts/buttondown-theme.css to the Drop newsletter's `css` field,
// which themes both the delivered email and the web archive.
//
// Deliberately narrow. It writes exactly one field and reads back exactly one
// field to confirm the write landed. It never prints the newsletter object,
// because that object carries the account API key among its fields — asking
// for everything is how a credential ends up in a log.
//
// It never touches emails, subscribers, or sending.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const themeFile = "scripts/buttondown-theme.css";
const apiVersion = "2026-04-01";

export async function applyButtondownTheme({
  css,
  apiKey = process.env.BUTTONDOWN_API_KEY,
  newsletterId = process.env.BUTTONDOWN_NEWSLETTER_ID,
  request = fetch,
} = {}) {
  if (!apiKey?.trim()) {
    throw new Error("BUTTONDOWN_API_KEY is required to apply the theme");
  }
  if (!newsletterId?.trim()) {
    throw new Error("BUTTONDOWN_NEWSLETTER_ID is required to apply the theme");
  }
  if (!css?.trim()) {
    throw new Error("Refusing to apply an empty theme");
  }
  const url = `https://api.buttondown.com/v1/newsletters/${newsletterId.trim()}`;
  const headers = {
    Authorization: `Token ${apiKey.trim()}`,
    "Content-Type": "application/json",
    "X-API-Version": apiVersion,
  };
  const response = await request(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ css }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `Buttondown theme update failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const updated = await response.json();
  if (updated.css !== css) {
    throw new Error("Buttondown did not store the theme as written");
  }
  return { applied: true, bytes: css.length };
}

export async function main() {
  const css = await readFile(resolve(repoRoot, themeFile), "utf8");
  const { bytes } = await applyButtondownTheme({ css });
  console.log(`Buttondown newsletter theme applied (${bytes} bytes)`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(`buttondown-theme: ${error.message}`);
    process.exitCode = 1;
  });
}
