import assert from "node:assert/strict";
import test from "node:test";

import {
  optionsFor,
  preparePayload,
  publishButtondown,
  rangeFor,
  runRelease,
  validateDraft,
} from "./cut-release.mjs";

const material = {
  head: "1234567890abcdef1234567890abcdef12345678",
  range: "v-old..HEAD",
  repository: "jthingelstad/drop.poapkings.com",
  commits: [
    {
      sha: "1234567890abcdef1234567890abcdef12345678",
      shortSha: "1234567",
      date: "2026-07-23T12:00:00Z",
      subject: "Add release ceremony",
      body: "Closes #22",
    },
  ],
  issues: [{ number: 22, title: "Build release helper" }],
};

const draft = {
  sourceHead: material.head,
  range: material.range,
  name: "Mighty Musketeer",
  detailed: [
    "Mighty Musketeer brings the release ceremony to life.",
    "",
    "### The story",
    "Drop now tells the story of each meaningful release.",
    "",
    "### Features",
    "- Named releases",
    "",
    "### Release Notes",
    "- Added the release helper",
  ].join("\n"),
  email: {
    subject: "Mighty Musketeer is live",
    body: "Drop now has named releases with friendly notes.",
  },
  inApp: "Named releases now tell you what changed.",
};

const manifest = validateDraft(
  draft,
  material,
  [{ name: "Musketeer" }],
  "2026-07-23",
);

void test("parses range and email controls", () => {
  const options = optionsFor([
    "--days",
    "14",
    "--draft",
    "draft.json",
    "--no-email",
  ]);
  assert.equal(options.days, 14);
  assert.equal(options.draft, "draft.json");
  assert.deepEqual(options.channels, ["github"]);
  assert.throws(
    () => optionsFor(["--days", "7", "--since", "v-old"]),
    /mutually exclusive/,
  );
  assert.throws(() => optionsFor(["--days", "0"]), /1 through 365/);
});

void test("selects explicit, recent, tagged, and full-history ranges", () => {
  assert.deepEqual(
    rangeFor(
      { since: "v-old" },
      () => "",
      (ref) => ref === "v-old",
    ),
    { label: "v-old..HEAD", args: ["v-old..HEAD"] },
  );
  assert.deepEqual(rangeFor({ days: 7 }), {
    label: "last 7 days",
    args: ["--since=7 days ago", "HEAD"],
  });
  assert.deepEqual(
    rangeFor({}, () => "mighty-musketeer"),
    {
      label: "mighty-musketeer..HEAD",
      args: ["mighty-musketeer..HEAD"],
    },
  );
  assert.deepEqual(
    rangeFor({}, () => ""),
    {
      label: "repository history through HEAD",
      args: ["HEAD"],
    },
  );
  assert.throws(
    () =>
      rangeFor(
        { since: "missing" },
        () => "",
        () => false,
      ),
    /Unknown --since ref/,
  );
});

void test("requires an LLM-authored alliterative canonical card name", () => {
  assert.equal(manifest.name, "Mighty Musketeer");
  assert.equal(manifest.card, "Musketeer");
  assert.equal(manifest.tag, "mighty-musketeer");
  assert.equal(manifest.build, material.head.slice(0, 12));
  assert.throws(
    () =>
      validateDraft(
        { ...draft, name: "Radiant Musketeer" },
        material,
        [{ name: "Musketeer" }],
        "2026-07-23",
      ),
    /alliterative/,
  );
  assert.throws(
    () =>
      validateDraft(
        { ...draft, name: "Mighty Made Up Card" },
        material,
        [{ name: "Musketeer" }],
        "2026-07-23",
      ),
    /canonical/,
  );
});

void test("prepares one complete LLM request from the selected material", () => {
  const payload = preparePayload(material, [{ name: "Musketeer" }]);
  assert.equal(payload.sourceHead, material.head);
  assert.equal(payload.range, material.range);
  assert.deepEqual(payload.commits, material.commits);
  assert.deepEqual(payload.canonicalCards, ["Musketeer"]);
  assert.match(payload.instruction, /one LLM call/);
  assert.equal(payload.outputSchema.email.body, "Warm player-facing Markdown");
});

function fakeActions(overrides = {}) {
  return {
    preflight: async () => {},
    gather: async () => material,
    readDraft: async () => draft,
    readCards: async () => ({ cards: [{ name: "Musketeer" }] }),
    readReleases: async () => "# Elixir Drop Releases\n",
    date: () => "2026-07-23",
    output: () => {},
    assertTag: async () => {},
    assertUnusedTag: async () => {},
    commit: async () => {
      throw new Error("unexpected commit");
    },
    tag: async () => {
      throw new Error("unexpected tag");
    },
    waitUntilLive: async () => {
      throw new Error("unexpected deploy wait");
    },
    announce: async () => {
      throw new Error("unexpected announcement");
    },
    ...overrides,
  };
}

void test("dry-run prints all tiers without mutating or announcing", async () => {
  const output = [];
  const result = await runRelease(
    optionsFor(["--draft", "draft.json", "--dry-run", "--no-email"]),
    fakeActions({ output: (line) => output.push(line) }),
  );
  assert.equal(result.dryRun, true);
  assert.match(output.join("\n"), /=== Player email ===/);
  assert.match(output.join("\n"), /=== In-app ===/);
  assert.match(output.join("\n"), /- github/);
  assert.doesNotMatch(output.join("\n"), /- email/);
});

void test("announce-only retries only the requested stored channel", async () => {
  const encoded = Buffer.from(JSON.stringify(manifest)).toString("base64url");
  const calls = [];
  await runRelease(
    optionsFor(["--announce-only", manifest.tag, "--channel", "email"]),
    fakeActions({
      readReleases: async () =>
        `# Elixir Drop Releases\n\n<!-- elixir-drop-release:${encoded} -->\n`,
      announce: async (stored, channels) => calls.push({ stored, channels }),
    }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stored.tag, manifest.tag);
  assert.deepEqual(calls[0].channels, ["email"]);
});

void test("publishes one idempotent Buttondown campaign to the explicit list", async () => {
  let request;
  const email = await publishButtondown(manifest, {
    apiKey: "secret",
    newsletterId: "497f6eca-6276-4993-bfeb-53cbbbba6f08",
    request: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({ id: "em_release", status: "about_to_send" }),
        { status: 201 },
      );
    },
  });
  assert.equal(email.id, "em_release");
  assert.equal(request.url, "https://api.buttondown.com/v1/emails");
  assert.equal(
    request.options.headers["Buttondown-Context"],
    "497f6eca-6276-4993-bfeb-53cbbbba6f08",
  );
  assert.equal(
    request.options.headers["X-Idempotency-Key"],
    "elixir-drop-release-email-mighty-musketeer",
  );
  const body = JSON.parse(request.options.body);
  assert.equal(body.status, "about_to_send");
  assert.equal(body.slug, "mighty-musketeer");
  assert.match(body.body, /Play Elixir Drop/);
  assert.equal("recipients" in body, false);
});

void test("Buttondown delivery fails closed without an explicit newsletter", async () => {
  await assert.rejects(
    publishButtondown(manifest, {
      apiKey: "secret",
      newsletterId: "drop-newsletter",
      request: async () => {
        throw new Error("request should not run");
      },
    }),
    /newsletter UUID/,
  );
});
