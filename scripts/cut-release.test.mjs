import assert from "node:assert/strict";
import test from "node:test";

import {
  appendRelease,
  createButtondownDraft,
  optionsFor,
  playerNotes,
  preparePayload,
  rangeFor,
  releaseEntry,
  releasesFile,
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
    recordRelease: async () => {
      throw new Error("unexpected in-app release record");
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
  assert.match(
    output.join("\n"),
    /apps\/web\/src\/data\/releases\.json entry mighty-musketeer/,
  );
  assert.match(output.join("\n"), /GitHub release/);
  assert.match(output.join("\n"), /Buttondown draft \(never sent\)/);
});

void test("real cut confirms the live target, tags it, records it in-app, and creates both channels", async () => {
  const calls = [];
  const result = await runRelease(
    optionsFor(["--draft", "draft.json"]),
    fakeActions({
      confirmTarget: async (head) => calls.push(["confirm", head]),
      ensureTag: async (stored, head) => calls.push(["tag", stored.tag, head]),
      recordRelease: async (stored) => {
        calls.push(["record", stored.tag]);
        return releasesFile;
      },
      announce: async (stored, selected) => {
        calls.push(["announce", stored.tag, selected]);
        return { github: "https://example.test/release", emailDraftId: "em_1" };
      },
    }),
  );
  assert.equal(result.released, true);
  assert.equal(result.recorded, releasesFile);
  // The app's copy is written once the tag exists, before any channel that
  // might need a retry.
  assert.deepEqual(calls, [
    ["confirm", material.head],
    ["tag", manifest.tag, material.head],
    ["record", manifest.tag],
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
      recordRelease: async () => releasesFile,
      announce: async (_stored, selected) => calls.push(selected),
    }),
  );
  assert.deepEqual(calls, [["email"]]);
});

void test("the in-app entry reuses the authored name and player-facing notes", () => {
  assert.deepEqual(releaseEntry(manifest), {
    id: "mighty-musketeer",
    name: "Mighty Musketeer",
    date: "2026-07-23",
    build: material.head.slice(0, 12),
    headline: "Mighty Musketeer is live",
    notes: ["Drop now has named releases with friendly notes."],
  });
  // The player tier is Markdown for Buttondown; the page prints plain
  // paragraphs, so emphasis, links, and code are flattened.
  assert.deepEqual(
    playerNotes(
      "Meet **Mighty Musketeer**.\n\n## Heading\n\nRead the *notes* or\nvisit [Drop](https://drop.poapkings.com/) and run `surge`.\n\n",
    ),
    [
      "Meet Mighty Musketeer.",
      "Heading",
      "Read the notes or visit Drop and run surge.",
    ],
  );
});

void test("appending the in-app history is newest-first and idempotent", () => {
  const older = {
    id: "radiant-royal-giant",
    name: "Radiant Royal Giant",
    date: "2026-07-24",
    build: "f4209ccfb7e9",
    headline: "Meet Radiant Royal Giant",
    notes: ["Drop's first named release."],
  };
  const seeded = appendRelease({ schemaVersion: 1, releases: [] }, older);
  assert.deepEqual(seeded, { schemaVersion: 1, releases: [older] });

  const entry = releaseEntry(manifest);
  const cut = appendRelease(seeded, entry);
  assert.deepEqual(
    cut.releases.map((release) => release.id),
    ["mighty-musketeer", "radiant-royal-giant"],
  );

  // Re-running the same draft rewrites the same entry in place.
  assert.deepEqual(appendRelease(cut, entry), cut);
  assert.deepEqual(appendRelease(appendRelease(cut, entry), entry), cut);
  // A first cut into a file that does not exist yet still produces the schema.
  assert.deepEqual(appendRelease(undefined, entry), {
    schemaVersion: 1,
    releases: [entry],
  });
});

void test("--at is refused outside a single-channel retry", () => {
  assert.throws(
    () => optionsFor(["--draft", "d.json", "--at", "abc1234"]),
    /only for a single-channel retry/,
  );
  assert.equal(
    optionsFor(["--draft", "d.json", "--channel", "email", "--at", "abc1234"])
      .at,
    "abc1234",
  );
});

void test("creates one idempotent Buttondown draft in the explicit newsletter", async () => {
  let request;
  const requests = [];
  const email = await createButtondownDraft(manifest, {
    apiKey: "secret",
    newsletterId: "news_2d3heqk1789vyatbxaeg4b2c91",
    request: async (url, options) => {
      request = { url, options };
      requests.push({ url, method: options.method });
      // A real create echoes the stored email back, so nothing needs
      // reconciling and no second call goes out.
      const sent = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          id: "em_release",
          status: "draft",
          subject: sent.subject,
          body: sent.body,
        }),
        { status: 201 },
      );
    },
  });
  assert.equal(email.id, "em_release");
  assert.equal(email.reconciled, false);
  assert.deepEqual(
    requests.map((entry) => entry.method),
    ["POST"],
  );
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

void test("rewrites the existing draft when the notes changed", async () => {
  // The idempotency key is the tag, so Buttondown replays the first response:
  // same id, stale copy. Re-running after a rewrite has to move the draft.
  const requests = [];
  const email = await createButtondownDraft(manifest, {
    apiKey: "secret",
    newsletterId: "news_2d3heqk1789vyatbxaeg4b2c91",
    request: async (url, options) => {
      requests.push({ url, method: options.method, body: options.body });
      if (options.method === "POST") {
        return new Response(
          JSON.stringify({
            id: "em_release",
            status: "draft",
            subject: "An older subject",
            body: "An older body that predates the rewrite.",
          }),
          { status: 201 },
        );
      }
      const sent = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          id: "em_release",
          status: "draft",
          subject: sent.subject,
          body: sent.body,
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(email.id, "em_release");
  assert.equal(email.reconciled, true);
  assert.deepEqual(
    requests.map((entry) => entry.method),
    ["POST", "PATCH"],
  );
  const patch = requests[1];
  assert.equal(patch.url, "https://api.buttondown.com/v1/emails/em_release");
  const patched = JSON.parse(patch.body);
  assert.equal(patched.subject, manifest.email.subject);
  assert.match(patched.body, /Play Elixir Drop/);
  // The rewrite never re-declares status or recipients: it edits copy only.
  assert.equal("status" in patched, false);
  assert.equal("recipients" in patched, false);
});

void test("a rewrite that does not take is an error, not a shrug", async () => {
  await assert.rejects(
    createButtondownDraft(manifest, {
      apiKey: "secret",
      newsletterId: "news_2d3heqk1789vyatbxaeg4b2c91",
      request: async (url, options) =>
        new Response(
          JSON.stringify({
            id: "em_release",
            status: "draft",
            subject: "Stale subject",
            body: "Stale body",
          }),
          { status: options.method === "POST" ? 201 : 200 },
        ),
    }),
    /did not accept the rewritten notes/,
  );
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
