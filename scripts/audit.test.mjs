import assert from "node:assert/strict";
import test from "node:test";

import { EXCEPTIONS, judgeAudit } from "./audit.mjs";

const URL = "https://github.com/advisories/";
const report = {
  vulnerabilities: {
    braces: {
      via: [
        { url: `${URL}GHSA-aaaa`, severity: "high", title: "nested braces" },
      ],
    },
    micromatch: { via: ["braces"] },
    "fast-uri": {
      via: [{ url: `${URL}GHSA-bbbb`, severity: "moderate", title: "minor" }],
    },
  },
};
const exception = {
  advisory: "GHSA-aaaa",
  package: "braces",
  expires: "2026-11-10",
};

void test("an unexpired exception passes its advisory and nothing else", () => {
  const result = judgeAudit(report, [exception], "2026-11-10");
  assert.deepEqual(result.failures, []);
  assert.equal(result.excepted.length, 1);
  assert.equal(result.excepted[0].package, "braces");
  assert.deepEqual(result.unused, []);
});

void test("the day after expiry the advisory fails again", () => {
  const result = judgeAudit(report, [exception], "2026-11-11");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].expired, "2026-11-10");
});

void test("an advisory with no exception fails; moderate ones never do", () => {
  const result = judgeAudit(report, [], "2026-10-10");
  assert.deepEqual(
    result.failures.map((f) => f.advisory),
    ["GHSA-aaaa"],
  );
});

void test("an exception for another package does not match", () => {
  const other = { ...exception, package: "micromatch" };
  const result = judgeAudit(report, [other], "2026-10-10");
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.unused, [other]);
});

void test("every exception is dated, explained and short-lived", () => {
  for (const e of EXCEPTIONS) {
    assert.match(e.advisory, /^GHSA-/);
    assert.match(e.expires, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.package && e.reason.length > 40);
  }
});
