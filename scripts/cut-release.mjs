#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const channels = ["github", "email"];
const buttondownApiVersion = "2026-04-01";

export function optionsFor(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      channel: { type: "string", multiple: true },
      days: { type: "string" },
      draft: { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
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
  if (values.prepare && (values.draft || values["dry-run"] || values.channel)) {
    throw new Error("--prepare cannot be combined with release actions");
  }
  return {
    channels: [...new Set(selectedChannels)],
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
  const build = material.head.slice(0, 12);
  return {
    schemaVersion: 2,
    ...named,
    date,
    build,
    sourceHead: material.head,
    range: material.range,
    repository: material.repository,
    detailed: [
      `## ${named.name} — ${date} (${build})`,
      "",
      detailed,
      "",
      `_Release range: ${material.range}._`,
    ].join("\n"),
    email: { subject, body },
  };
}

export function preparePayload(material, cards) {
  return {
    schemaVersion: 2,
    sourceHead: material.head,
    range: material.range,
    repository: material.repository,
    commits: material.commits,
    issues: material.issues,
    canonicalCards: cards.map((card) => card.name),
    instruction:
      "In one LLM call, coin an apt alliterative name ending in a canonical Clash Royale card and write honest detailed GitHub notes plus a warm player-facing Buttondown draft. Return only the output schema.",
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
    },
  };
}

function printPlan(manifest, selectedChannels, output) {
  output(`${manifest.detailed}\n`);
  output(
    `=== Buttondown draft ===\n${manifest.email.subject}\n\n${manifest.email.body}\n`,
  );
  output(`=== Target ===\n${manifest.sourceHead}\n`);
  output(
    `=== Actions ===\n- annotated tag ${manifest.tag}\n${selectedChannels
      .map((channel) =>
        channel === "github"
          ? "- GitHub release"
          : "- Buttondown draft (never sent)",
      )
      .join("\n")}`,
  );
}

export async function runRelease(options, actions) {
  if (options.help) return actions.output(help());
  if (!options.channels.length) throw new Error("No release channel selected");

  const target = await actions.preflight();
  const material = await actions.gather(options, target);
  if (!material.commits.length) throw new Error("Release range has no commits");

  if (options.prepare) {
    const cards = await actions.readCards();
    actions.output(
      JSON.stringify(preparePayload(material, cards.cards), null, 2),
    );
    return { prepared: true, target };
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
  printPlan(manifest, options.channels, actions.output);
  if (options.dryRun) return { manifest, dryRun: true };

  await actions.confirmTarget(material.head);
  await actions.ensureTag(manifest, material.head);
  const announced = await actions.announce(manifest, options.channels);
  return { manifest, released: true, announced };
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

function commandOk(executable, args) {
  try {
    execFileSync(executable, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
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
      "100",
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
  target,
  latestTag = () =>
    command("git", ["describe", "--tags", "--abbrev=0", target], {
      allowFailure: true,
    }),
  refExists = (ref) =>
    Boolean(
      command("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
        allowFailure: true,
      }),
    ),
  isAncestor = (ref) =>
    commandOk("git", ["merge-base", "--is-ancestor", ref, target]),
) {
  const shortTarget = target.slice(0, 12);
  if (options.since) {
    if (!refExists(options.since)) {
      throw new Error(`Unknown --since ref: ${options.since}`);
    }
    if (!isAncestor(options.since)) {
      throw new Error(`--since ref is not an ancestor of ${shortTarget}`);
    }
    return {
      label: `${options.since}..${shortTarget}`,
      args: [`${options.since}..${target}`],
    };
  }
  if (options.days) {
    return {
      label: `last ${options.days} days through ${shortTarget}`,
      args: [`--since=${options.days} days ago`, target],
    };
  }
  const tag = latestTag();
  return tag
    ? {
        label: `${tag}..${shortTarget}`,
        args: [`${tag}..${target}`],
      }
    : {
        label: `repository history through ${shortTarget}`,
        args: [target],
      };
}

async function gather(options, target) {
  const range = rangeFor(options, target);
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
    head: target,
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

export async function createButtondownDraft(
  manifest,
  {
    apiKey = process.env.BUTTONDOWN_API_KEY,
    newsletterId = process.env.BUTTONDOWN_NEWSLETTER_ID,
    request = fetch,
  } = {},
) {
  if (!apiKey?.trim()) {
    throw new Error("BUTTONDOWN_API_KEY is required for the release draft");
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
      "X-API-Version": buttondownApiVersion,
      "X-Idempotency-Key": `elixir-drop-release-draft-${manifest.tag}`,
    },
    body: JSON.stringify({
      subject: manifest.email.subject,
      body: buttondownBody(manifest),
      slug: manifest.tag,
      status: "draft",
      canonical_url: `https://github.com/${manifest.repository}/releases/tag/${manifest.tag}`,
      metadata: { elixir_drop_release: manifest.tag },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Buttondown release draft failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const email = await response.json();
  if (typeof email.id !== "string" || email.status !== "draft") {
    throw new Error("Buttondown response is not a draft email");
  }
  return email;
}

function remoteTagCommit(tag) {
  const refs = command(
    "git",
    [
      "ls-remote",
      "--tags",
      "origin",
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ],
    { allowFailure: true },
  );
  if (!refs) return undefined;
  const lines = refs.split("\n");
  const peeled = lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`));
  const direct = lines.find((line) => line.endsWith(`refs/tags/${tag}`));
  return (peeled ?? direct)?.split(/\s+/)[0];
}

async function announce(manifest, selectedChannels) {
  const result = {};
  const temp = await mkdtemp(resolve(tmpdir(), "elixir-drop-release-"));
  try {
    if (selectedChannels.includes("github")) {
      const existing = command(
        "gh",
        ["release", "view", manifest.tag, "--json", "url", "--jq", ".url"],
        { allowFailure: true },
      );
      if (existing) {
        result.github = existing;
      } else {
        const notes = resolve(temp, "notes.md");
        await writeFile(notes, `${manifest.detailed}\n`);
        command("gh", [
          "release",
          "create",
          manifest.tag,
          "--verify-tag",
          "--title",
          `${manifest.name} (${manifest.date})`,
          "--notes-file",
          notes,
        ]);
        result.github = command("gh", [
          "release",
          "view",
          manifest.tag,
          "--json",
          "url",
          "--jq",
          ".url",
        ]);
      }
    }
    if (selectedChannels.includes("email")) {
      const email = await createButtondownDraft(manifest);
      result.emailDraftId = email.id;
      console.log(`Buttondown release draft created (${email.id})`);
    }
    return result;
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
      command("git", ["fetch", "origin", "main", "--tags"]);
      const head = command("git", ["rev-parse", "origin/main"]);
      await assertLive(head);
      return head;
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
    async confirmTarget(head) {
      command("git", ["fetch", "origin", "main", "--tags"]);
      const current = command("git", ["rev-parse", "origin/main"]);
      if (current !== head) {
        throw new Error(
          `origin/main moved from ${head.slice(0, 12)} to ${current.slice(0, 12)}; prepare a new draft`,
        );
      }
      await assertLive(head);
    },
    async ensureTag(manifest, head) {
      const remote = remoteTagCommit(manifest.tag);
      if (remote && remote !== head) {
        throw new Error(`Tag ${manifest.tag} points to a different commit`);
      }
      if (remote === head) return;

      const local = command(
        "git",
        ["rev-parse", "--verify", `refs/tags/${manifest.tag}^{commit}`],
        { allowFailure: true },
      );
      if (local && local !== head) {
        throw new Error(
          `Local tag ${manifest.tag} points to a different commit`,
        );
      }
      if (!local) {
        command("git", [
          "tag",
          "-a",
          manifest.tag,
          head,
          "-m",
          `${manifest.name} (${manifest.date})`,
        ]);
      }
      command("git", ["push", "origin", `refs/tags/${manifest.tag}`]);
    },
    announce,
  };
}

export function help() {
  return `Usage:
  node scripts/cut-release.mjs --prepare [--since <ref> | --days <n>]
  node scripts/cut-release.mjs --draft <llm-output.json> --dry-run [--since <ref> | --days <n>]
  node scripts/cut-release.mjs --draft <llm-output.json> [--since <ref> | --days <n>] [--channel github|email]`;
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
