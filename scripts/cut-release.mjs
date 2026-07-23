#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releasesPath = resolve(repoRoot, "RELEASES.md");
const stampPath = resolve(repoRoot, "apps/web/src/data/release.json");
const releaseHeading = "# Elixir Drop Releases";
const manifestPrefix = "elixir-drop-release:";
const channels = ["github", "email"];

export function optionsFor(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "announce-only": { type: "string" },
      channel: { type: "string", multiple: true },
      days: { type: "string" },
      draft: { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      "no-email": { type: "boolean" },
      prepare: { type: "boolean" },
      since: { type: "string" },
    },
  });
  const days = values.days === undefined ? undefined : Number(values.days);
  if (
    days !== undefined &&
    (!Number.isInteger(days) || days < 1 || days > 365)
  ) {
    throw new Error("--days must be an integer from 1 through 365");
  }
  if (days && values.since) {
    throw new Error("--days and --since are mutually exclusive");
  }
  const selectedChannels = values.channel ?? channels;
  if (selectedChannels.some((channel) => !channels.includes(channel))) {
    throw new Error("--channel must be github or email");
  }
  if (values.channel && !values["announce-only"]) {
    throw new Error("--channel is only valid with --announce-only");
  }
  if (
    values["announce-only"] &&
    (days || values.since || values.draft || values.prepare)
  ) {
    throw new Error("--announce-only cannot select or draft a new release");
  }
  if (
    values.prepare &&
    (values.draft || values["dry-run"] || values["no-email"])
  ) {
    throw new Error("--prepare cannot be combined with release actions");
  }
  return {
    announceOnly: values["announce-only"],
    channels: selectedChannels.filter(
      (channel) => !(values["no-email"] && channel === "email"),
    ),
    days,
    draft: values.draft,
    dryRun: Boolean(values["dry-run"]),
    help: Boolean(values.help),
    prepare: Boolean(values.prepare),
    since: values.since,
  };
}

function slug(name) {
  const value = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!value) throw new Error("Release name does not produce a tag slug");
  return value;
}

function requiredString(source, key) {
  const value = source?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`LLM draft is missing ${key}`);
  }
  return value.trim();
}

function releaseName(name, cards) {
  const normalized = name.replace(/\s+/g, " ");
  const card = [...cards]
    .sort((left, right) => right.name.length - left.name.length)
    .find(
      (candidate) =>
        normalized.toLowerCase() === candidate.name.toLowerCase() ||
        normalized.toLowerCase().endsWith(` ${candidate.name.toLowerCase()}`),
    );
  if (!card) {
    throw new Error(
      "LLM release name must end with a canonical Clash Royale card name",
    );
  }
  const lead = normalized.slice(0, -card.name.length).trim();
  if (lead[0]?.toLowerCase() !== card.name[0]?.toLowerCase()) {
    throw new Error("LLM release name must be alliterative");
  }
  return { name: normalized, card: card.name, tag: slug(normalized) };
}

export function validateDraft(draft, material, cards, date) {
  if (!draft || typeof draft !== "object") {
    throw new Error("LLM draft must be a JSON object");
  }
  if (draft.sourceHead !== material.head || draft.range !== material.range) {
    throw new Error("LLM draft does not match the selected release material");
  }
  const named = releaseName(requiredString(draft, "name"), cards);
  const detailed = requiredString(draft, "detailed");
  for (const heading of [
    "### The story",
    "### Features",
    "### Release Notes",
  ]) {
    if (!detailed.includes(heading)) {
      throw new Error(`LLM detailed notes must include ${heading}`);
    }
  }
  const email = draft.email;
  const subject = requiredString(email, "subject");
  const body = requiredString(email, "body");
  const inApp = requiredString(draft, "inApp");
  if (inApp.length > 160) {
    throw new Error("LLM in-app blurb must be 160 characters or fewer");
  }
  const build = material.head.slice(0, 12);
  return {
    schemaVersion: 1,
    ...named,
    date,
    build,
    range: material.range,
    detailed: [
      `## ${named.name} — ${date} (${build})`,
      "",
      detailed,
      "",
      `_Release range: ${material.range}._`,
    ].join("\n"),
    email: { subject, body },
    inApp,
  };
}

export function preparePayload(material, cards) {
  return {
    schemaVersion: 1,
    sourceHead: material.head,
    range: material.range,
    repository: material.repository,
    commits: material.commits,
    issues: material.issues,
    canonicalCards: cards.map((card) => card.name),
    instruction:
      "In one LLM call, coin an apt alliterative name ending in a canonical Clash Royale card and write honest detailed, player-email, and in-app tiers. Return only the output schema.",
    outputSchema: {
      sourceHead: material.head,
      range: material.range,
      name: "Alliterative Card Name",
      detailed:
        "Markdown intro followed by ### The story, ### Features, and ### Release Notes",
      email: {
        subject: "Player-facing subject",
        body: "Warm player-facing Markdown",
      },
      inApp: "At most 160 characters",
    },
  };
}

function embedManifest(existing, manifest) {
  if (!existing.startsWith(releaseHeading)) {
    throw new Error("RELEASES.md is missing its canonical heading");
  }
  const encoded = Buffer.from(JSON.stringify(manifest)).toString("base64url");
  return `${releaseHeading}\n\n<!-- ${manifestPrefix}${encoded} -->\n${manifest.detailed}\n\n${existing.slice(releaseHeading.length).trim()}\n`;
}

function storedManifests(existing) {
  const pattern = new RegExp(
    `<!--\\s*${manifestPrefix}([A-Za-z0-9_-]+)\\s*-->`,
    "g",
  );
  return [...existing.matchAll(pattern)].map((match) =>
    JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")),
  );
}

function printPlan(manifest, selectedChannels, output) {
  output(`${manifest.detailed}\n`);
  output(
    `=== Player email ===\n${manifest.email.subject}\n\n${manifest.email.body}\n`,
  );
  output(`=== In-app ===\n${manifest.inApp}\n`);
  output(
    `=== Actions ===\n${selectedChannels.map((channel) => `- ${channel}`).join("\n")}`,
  );
}

export async function runRelease(options, actions) {
  if (options.help) return actions.output(help());
  await actions.preflight();
  if (!options.channels.length)
    throw new Error("No announcement channel selected");

  if (options.announceOnly) {
    const manifest = storedManifests(await actions.readReleases()).find(
      (item) => item.tag === options.announceOnly,
    );
    if (!manifest) throw new Error("Release manifest not found");
    await actions.assertTag(manifest.tag);
    printPlan(manifest, options.channels, actions.output);
    if (!options.dryRun) await actions.announce(manifest, options.channels);
    return { manifest, dryRun: options.dryRun };
  }

  const material = await actions.gather(options);
  if (!material.commits.length) throw new Error("Release range has no commits");
  if (options.prepare) {
    const cards = await actions.readCards();
    actions.output(
      JSON.stringify(preparePayload(material, cards.cards), null, 2),
    );
    return { prepared: true };
  }
  if (!options.draft) {
    throw new Error(
      "Run --prepare, make one LLM call, then pass --draft <file>",
    );
  }
  const [draft, cards] = await Promise.all([
    actions.readDraft(options.draft),
    actions.readCards(),
  ]);
  const manifest = validateDraft(draft, material, cards.cards, actions.date());
  await actions.assertUnusedTag(manifest.tag);
  printPlan(manifest, options.channels, actions.output);
  if (options.dryRun) return { manifest, dryRun: true };
  const head = await actions.commit(manifest);
  await actions.tag(manifest);
  await actions.waitUntilLive(head);
  await actions.announce(manifest, options.channels);
  return { manifest, released: true };
}

function command(
  executable,
  args,
  { allowFailure = false, inherit = false } = {},
) {
  try {
    const value = execFileSync(executable, args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
      stdio: inherit
        ? ["ignore", "inherit", "inherit"]
        : ["ignore", "pipe", "pipe"],
    });
    return typeof value === "string" ? value.trim() : "";
  } catch (error) {
    if (allowFailure) return "";
    throw new Error(`${executable} ${args.join(" ")} failed`, { cause: error });
  }
}

async function assertLive(head) {
  const runs = JSON.parse(
    command("gh", [
      "run",
      "list",
      "--workflow",
      "deploy.yml",
      "--branch",
      "main",
      "--limit",
      "30",
      "--json",
      "headSha,status,conclusion,databaseId",
    ]),
  );
  const run = runs.find((item) => item.headSha === head);
  if (!run || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(`Build ${head.slice(0, 12)} is not live`);
  }
  const config = await (
    await fetch("https://drop.poapkings.com/api-config.json")
  ).json();
  const stats = await (await fetch(`${config.apiBaseUrl}/stats`)).json();
  if (stats.webVersion !== head.slice(0, 12)) {
    throw new Error("Live API does not report the selected build");
  }
}

export function rangeFor(
  options,
  latestTag = () =>
    command("git", ["describe", "--tags", "--abbrev=0"], {
      allowFailure: true,
    }),
  refExists = (ref) =>
    Boolean(
      command("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
        allowFailure: true,
      }),
    ),
) {
  if (options.since) {
    if (!refExists(options.since)) {
      throw new Error(`Unknown --since ref: ${options.since}`);
    }
    return {
      label: `${options.since}..HEAD`,
      args: [`${options.since}..HEAD`],
    };
  }
  if (options.days) {
    return {
      label: `last ${options.days} days`,
      args: [`--since=${options.days} days ago`, "HEAD"],
    };
  }
  const tag = latestTag();
  return tag
    ? { label: `${tag}..HEAD`, args: [`${tag}..HEAD`] }
    : { label: "repository history through HEAD", args: ["HEAD"] };
}

async function gather(options) {
  const range = rangeFor(options);
  const records = command("git", [
    "log",
    ...range.args,
    "--no-merges",
    "--format=%H%x1f%h%x1f%aI%x1f%s%x1f%b%x1e",
  ])
    .split("\x1e")
    .map((item) => item.trim())
    .filter(Boolean);
  const commits = records.map((record) => {
    const [sha, shortSha, date, subject, body = ""] = record.split("\x1f");
    return { sha, shortSha, date, subject, body };
  });
  const numbers = [
    ...new Set(
      commits.flatMap((commit) =>
        [...`${commit.subject}\n${commit.body}`.matchAll(/#(\d+)\b/g)].map(
          (match) => match[1],
        ),
      ),
    ),
  ];
  const issues = numbers
    .map((number) => {
      const issue = command(
        "gh",
        ["issue", "view", number, "--json", "number,title,url,state,labels"],
        { allowFailure: true },
      );
      return issue ? JSON.parse(issue) : undefined;
    })
    .filter(Boolean);
  return {
    head: command("git", ["rev-parse", "HEAD"]),
    range: range.label,
    repository: command("gh", [
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]),
    commits,
    issues,
  };
}

function buttondownBody(manifest) {
  return [
    "<!-- buttondown-editor-mode: plaintext -->",
    manifest.email.body,
    "",
    "[Play Elixir Drop](https://drop.poapkings.com/)",
    "",
    "_Elixir Drop is a fan-made POAP KINGS game. Not affiliated with or endorsed by Supercell._",
  ].join("\n");
}

export async function publishButtondown(
  manifest,
  {
    apiKey = process.env.BUTTONDOWN_API_KEY,
    newsletterId = process.env.BUTTONDOWN_NEWSLETTER_ID,
    request = fetch,
  } = {},
) {
  if (!apiKey?.trim()) {
    throw new Error("BUTTONDOWN_API_KEY is required for release email");
  }
  if (
    !newsletterId?.match(
      /^(?:news_[0-9a-z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
    )
  ) {
    throw new Error(
      "BUTTONDOWN_NEWSLETTER_ID must be a Buttondown newsletter ID",
    );
  }
  const response = await request("https://api.buttondown.com/v1/emails", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey.trim()}`,
      "Buttondown-Context": newsletterId,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `elixir-drop-release-email-${manifest.tag}`,
    },
    body: JSON.stringify({
      subject: manifest.email.subject,
      body: buttondownBody(manifest),
      slug: manifest.tag,
      status: "about_to_send",
      canonical_url: `https://github.com/jthingelstad/drop.poapkings.com/releases/tag/${manifest.tag}`,
      metadata: { elixir_drop_release: manifest.tag },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Buttondown release email failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const email = await response.json();
  if (typeof email.id !== "string") {
    throw new Error("Buttondown response is missing the email id");
  }
  return email;
}

async function announce(manifest, selectedChannels) {
  const temp = await mkdtemp(resolve(tmpdir(), "elixir-drop-release-"));
  try {
    if (selectedChannels.includes("github")) {
      const exists = command(
        "gh",
        ["release", "view", manifest.tag, "--json", "tagName"],
        { allowFailure: true },
      );
      if (!exists) {
        const notes = resolve(temp, "notes.md");
        await writeFile(notes, `${manifest.detailed}\n`);
        command(
          "gh",
          [
            "release",
            "create",
            manifest.tag,
            "--verify-tag",
            "--title",
            `${manifest.name} (${manifest.date})`,
            "--notes-file",
            notes,
          ],
          { inherit: true },
        );
      }
    }
    if (selectedChannels.includes("email")) {
      const email = await publishButtondown(manifest);
      console.log(`Buttondown release email queued (${email.id})`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export function systemActions(output = console.log) {
  return {
    output,
    date: () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    async preflight() {
      if (command("git", ["branch", "--show-current"]) !== "main")
        throw new Error("Release requires main");
      if (command("git", ["status", "--porcelain"]))
        throw new Error("Release requires a clean worktree");
      if (
        command("git", [
          "rev-list",
          "--left-right",
          "--count",
          "HEAD...@{upstream}",
        ]) !== "0\t0"
      ) {
        throw new Error("Release requires HEAD even with upstream");
      }
      await assertLive(command("git", ["rev-parse", "HEAD"]));
    },
    gather,
    readCards: async () =>
      JSON.parse(
        await readFile(
          resolve(repoRoot, "packages/game-data/cards.json"),
          "utf8",
        ),
      ),
    readDraft: async (path) =>
      JSON.parse(await readFile(resolve(repoRoot, path), "utf8")),
    readReleases: () => readFile(releasesPath, "utf8"),
    assertTag: async (tag) => {
      if (
        !command(
          "git",
          ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`],
          { allowFailure: true },
        )
      ) {
        throw new Error(`Tag ${tag} is not published`);
      }
    },
    assertUnusedTag: async (tag) => {
      if (
        command(
          "git",
          ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`],
          { allowFailure: true },
        )
      ) {
        throw new Error(`Tag ${tag} already exists`);
      }
    },
    async commit(manifest) {
      const existing = await readFile(releasesPath, "utf8");
      await Promise.all([
        writeFile(releasesPath, embedManifest(existing, manifest)),
        writeFile(
          stampPath,
          `${JSON.stringify(
            {
              name: manifest.name,
              tag: manifest.tag,
              releasedAt: manifest.date,
              build: manifest.build,
              blurb: manifest.inApp,
            },
            null,
            2,
          )}\n`,
        ),
      ]);
      command("git", ["add", "RELEASES.md", "apps/web/src/data/release.json"]);
      command("git", ["commit", "-m", `Release ${manifest.name}`]);
      command("git", ["push", "origin", "main"], { inherit: true });
      return command("git", ["rev-parse", "HEAD"]);
    },
    async waitUntilLive(head) {
      const runs = JSON.parse(
        command("gh", [
          "run",
          "list",
          "--workflow",
          "deploy.yml",
          "--branch",
          "main",
          "--limit",
          "30",
          "--json",
          "headSha,databaseId",
        ]),
      );
      const run = runs.find((item) => item.headSha === head);
      if (!run) throw new Error("Deploy run has not started; retry shortly");
      command("gh", ["run", "watch", String(run.databaseId), "--exit-status"], {
        inherit: true,
      });
      await assertLive(head);
    },
    tag: async (manifest) => {
      command("git", [
        "tag",
        "-a",
        manifest.tag,
        "-m",
        `${manifest.name} (${manifest.date})`,
      ]);
      command("git", ["push", "origin", `refs/tags/${manifest.tag}`]);
    },
    announce,
  };
}

export function help() {
  return `Usage:
  node scripts/cut-release.mjs --prepare [--since <ref> | --days <n>]
  node scripts/cut-release.mjs --draft <llm-output.json> --dry-run [--no-email]
  node scripts/cut-release.mjs --draft <llm-output.json> [--no-email]
  node scripts/cut-release.mjs --announce-only <tag> [--channel github|email] [--dry-run]`;
}

export async function main(argv = process.argv.slice(2)) {
  return runRelease(optionsFor(argv), systemActions());
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(`cut-release: ${error.message}`);
    process.exitCode = 1;
  });
}
