import assert from "node:assert/strict";
import test from "node:test";

import {
  createButtondownDraft,
  optionsFor,
  preparePayload,
  rangeFor,
  runRelease,
  validateDraft,
} from "./cut-release.mjs";

const target = "1234567890abcdef1234567890abcdef12345678";
const material = {
  head: target,
  range: "v-old..1234567890ab",
  repository: "jthingelstad/drop.poapkings.com",
  commits: [
    {
      sha: target,
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
};

const manifest = validateDraft(
  draft,
  material,
  [{ name: "Musketeer" }],
  "2026-07-23",
);

void test("parses range and channel controls", () => {
  const options = optionsFor([
    "--days",
    "14",
    "--draft",
    "draft.json",
    "--channel",
    "email",
  ]);
  assert.equal(options.days, 14);
  assert.equal(options.draft, "draft.json");
  assert.deepEqual(options.channels, ["email"]);
  assert.deepEqual(optionsFor(["--draft", "draft.json"]).channels, [
    "github",
    "email",
  ]);
  assert.throws(
    () => optionsFor(["--days", "7", "--since", "v-old"]),
    /mutually exclusive/,
  );
  assert.throws(() => optionsFor(["--days", "0"]), /1 through 365/);
  assert.throws(
    () => optionsFor(["--prepare", "--channel", "github"]),
    /cannot be combined/,
  );
});

void test("selects explicit, recent, tagged, and full-history remote ranges", () => {
  assert.deepEqual(
    rangeFor(
      { since: "v-old" },
      target,
      () => "",
      (ref) => ref === "v-old",
      () => true,
    ),
    {
      label: "v-old..1234567890ab",
      args: [`v-old..${target}`],
    },
  );
  assert.deepEqual(rangeFor({ days: 7 }, target), {
    label: "last 7 days through 1234567890ab",
    args: ["--since=7 days ago", target],
  });
  assert.deepEqual(
    rangeFor({}, target, () => "mighty-musketeer"),
    {
      label: "mighty-musketeer..1234567890ab",
      args: [`mighty-musketeer..${target}`],
    },
  );
  assert.deepEqual(
    rangeFor({}, target, () => ""),
    {
      label: "repository history through 1234567890ab",
      args: [target],
    },
  );
  assert.throws(
    () =>
      rangeFor(
        { since: "missing" },
        target,
        () => "",
        () => false,
        () => false,
      ),
    /Unknown --since ref/,
  );
  assert.throws(
    () =>
      rangeFor(
        { since: "sideways" },
        target,
        () => "",
        () => true,
        () => false,
      ),
    /not an ancestor/,
  );
});

void test("requires an LLM-authored alliterative canonical card name", () => {
  assert.equal(manifest.name, "Mighty Musketeer");
  assert.equal(manifest.card, "Musketeer");
  assert.equal(manifest.tag, "mighty-musketeer");
  assert.equal(manifest.build, material.head.slice(0, 12));
  assert.equal(manifest.sourceHead, material.head);
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
  assert.match(payload.instruction, /Buttondown draft/);
  assert.equal(payload.outputSchema.email.body, "Warm player-facing Markdown");
  assert.equal("inApp" in payload.outputSchema, false);
});

function fakeActions(overrides = {}) {
  return {
    preflight: async () => material.head,
    gather: async () => material,
    readDraft: async () => draft,
    readCards: async () => ({ cards: [{ name: "Musketeer" }] }),
    date: () => "2026-07-23",
    output: () => {},
    confirmTarget: async () => {
      throw new Error("unexpected target confirmation");
    },
    ensureTag: async () => {
      throw new Error("unexpected tag");
    },
    announce: async () => {
      throw new Error("unexpected announcement");
    },
    ...overrides,
  };
}

void test("dry-run prints both tiers and exact actions without mutation", async () => {
  const output = [];
  const result = await runRelease(
    optionsFor(["--draft", "draft.json", "--dry-run"]),
    fakeActions({ output: (line) => output.push(line) }),
  );
  assert.equal(result.dryRun, true);
  assert.match(output.join("\n"), /=== Buttondown draft ===/);
  assert.match(output.join("\n"), /=== Target ===/);
  assert.match(output.join("\n"), /annotated tag mighty-musketeer/);
  assert.match(output.join("\n"), /GitHub release/);
  assert.match(output.join("\n"), /Buttondown draft \(never sent\)/);
});

void test("real cut confirms the live target, tags it, and creates both channels", async () => {
  const calls = [];
  const result = await runRelease(
    optionsFor(["--draft", "draft.json"]),
    fakeActions({
      confirmTarget: async (head) => calls.push(["confirm", head]),
      ensureTag: async (stored, head) => calls.push(["tag", stored.tag, head]),
      announce: async (stored, selected) => {
        calls.push(["announce", stored.tag, selected]);
        return { github: "https://example.test/release", emailDraftId: "em_1" };
      },
    }),
  );
  assert.equal(result.released, true);
  assert.deepEqual(calls, [
    ["confirm", material.head],
    ["tag", manifest.tag, material.head],
    ["announce", manifest.tag, ["github", "email"]],
  ]);
});

void test("a saved draft can retry only one failed channel", async () => {
  const calls = [];
  await runRelease(
    optionsFor(["--draft", "draft.json", "--channel", "email"]),
    fakeActions({
      confirmTarget: async () => {},
      ensureTag: async () => {},
      announce: async (_stored, selected) => calls.push(selected),
    }),
  );
  assert.deepEqual(calls, [["email"]]);
});

void test("creates one idempotent Buttondown draft in the explicit newsletter", async () => {
  let request;
  const email = await createButtondownDraft(manifest, {
    apiKey: "secret",
    newsletterId: "news_2d3heqk1789vyatbxaeg4b2c91",
    request: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({ id: "em_release", status: "draft" }),
        {
          status: 201,
        },
      );
    },
  });
  assert.equal(email.id, "em_release");
  assert.equal(request.url, "https://api.buttondown.com/v1/emails");
  assert.equal(
    request.options.headers["Buttondown-Context"],
    "news_2d3heqk1789vyatbxaeg4b2c91",
  );
  assert.equal(
    request.options.headers["X-Idempotency-Key"],
    "elixir-drop-release-draft-mighty-musketeer",
  );
  assert.equal(request.options.headers["X-API-Version"], "2026-04-01");
  const body = JSON.parse(request.options.body);
  assert.equal(body.status, "draft");
  assert.equal(body.slug, "mighty-musketeer");
  assert.match(body.body, /Play Elixir Drop/);
  assert.equal("recipients" in body, false);
});

void test("Buttondown draft fails closed without an explicit newsletter", async () => {
  await assert.rejects(
    createButtondownDraft(manifest, {
      apiKey: "secret",
      newsletterId: "drop-newsletter",
      request: async () => {
        throw new Error("request should not run");
      },
    }),
    /newsletter ID/,
  );
});

void test("Buttondown must confirm the created email remains a draft", async () => {
  await assert.rejects(
    createButtondownDraft(manifest, {
      apiKey: "secret",
      newsletterId: "news_2d3heqk1789vyatbxaeg4b2c91",
      request: async () =>
        new Response(
          JSON.stringify({ id: "em_release", status: "about_to_send" }),
          { status: 201 },
        ),
    }),
    /not a draft email/,
  );
});
