#!/usr/bin/env node
// Drop's dependency audit gate: `npm audit` at high severity, with dated
// exceptions. CI runs it ahead of the gate, and `npm run check:beta` bundles
// it locally.
//
// An exception names one advisory, the package it is in, why it is accepted,
// and the day it expires. It is only for an advisory with no fixed version
// to move to; anything that can be fixed is fixed instead. An advisory
// matches only while its exception has not expired, so an expired exception
// fails the gate again and someone has to look. An exception that matches
// nothing (the fix has landed) is reported so it can be deleted.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Accepted advisories; the gate fails again on the day after `expires`. */
export const EXCEPTIONS = [
  {
    advisory: "GHSA-vfj7-8cjw-p6xm",
    package: "braces",
    expires: "2026-11-10",
    reason:
      "No fixed release: the advisory covers every braces <=3.0.3 and 3.0.3 " +
      "is the newest. It reaches Drop only through stylelint (micromatch), a " +
      "development-only CSS lint of our own stylesheets that never ships.",
  },
];

const FAILING = new Set(["high", "critical"]);

/**
 * Judge an `npm audit --json` report. Only advisories themselves are judged;
 * the packages that merely depend on one inherit its severity and its
 * exception.
 */
export function judgeAudit(report, exceptions, today) {
  const failures = [];
  const excepted = [];
  const matched = new Set();
  const seen = new Set();
  for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via === "string" || !FAILING.has(via.severity)) continue;
      const advisory = advisoryId(via.url);
      const key = `${name} ${advisory}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const finding = {
        package: name,
        advisory,
        severity: via.severity,
        title: via.title,
      };
      const exception = exceptions.find(
        (e) => e.advisory === advisory && e.package === name,
      );
      if (exception && today <= exception.expires) {
        matched.add(exception);
        excepted.push({ ...finding, expires: exception.expires });
      } else {
        failures.push(
          exception ? { ...finding, expired: exception.expires } : finding,
        );
      }
    }
  }
  const unused = exceptions.filter(
    (e) => !matched.has(e) && today <= e.expires,
  );
  return { failures, excepted, unused };
}

function advisoryId(url = "") {
  return url.split("/").pop() || url;
}

function main() {
  const run = spawnSync("npm", ["audit", "--json"], { encoding: "utf8" });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    process.stderr.write(run.stderr || "npm audit produced no JSON\n");
    return 2;
  }
  if (report.error) {
    process.stderr.write(`npm audit failed: ${JSON.stringify(report.error)}\n`);
    return 2;
  }
  const today = new Date().toISOString().slice(0, 10);
  const { failures, excepted, unused } = judgeAudit(report, EXCEPTIONS, today);
  for (const f of excepted) {
    console.log(
      `excepted until ${f.expires}: ${f.package} ${f.advisory} (${f.severity}) ${f.title}`,
    );
  }
  for (const e of unused) {
    console.log(
      `exception no longer needed, delete it: ${e.package} ${e.advisory}`,
    );
  }
  for (const f of failures) {
    const why = f.expired ? ` (exception expired ${f.expired})` : "";
    console.error(
      `FAIL ${f.package} ${f.advisory} (${f.severity}) ${f.title}${why}`,
    );
  }
  if (failures.length) {
    console.error(
      "Fix with `npm audit fix`, or see scripts/audit.mjs for exceptions.",
    );
    return 1;
  }
  console.log("npm audit: no unexcepted high or critical advisories");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
