import { expect, test } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApi } from "../scripts/build.mjs";

test("the deployment bundle starts locally and serves HTTP", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drop-http-bundle-"));
  let child;
  try {
    await buildApi(dir);
    // Observe an OS-assigned port without reserving/releasing a port or
    // changing the shipped entry point. The exact index.js is then loaded.
    const launcher = join(dir, "launch.cjs");
    await writeFile(
      launcher,
      `
const http = require('node:http');
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function(...args) {
  this.once('listening', () => console.log('BUNDLE_PORT=' + this.address().port));
  return listen.apply(this, args);
};
require('./index.js');
`,
    );
    child = spawn(process.execPath, [launcher], {
      cwd: dir,
      env: {
        ...process.env,
        AWS_LAMBDA_HTTP_ENDPOINT: "127.0.0.1:0",
        AWS_EC2_METADATA_DISABLED: "true",
        AWS_REGION: "us-east-1",
        TABLE_NAME: "isolated-bundle-test",
        SESSION_SECRET: "isolated-bundle-test-secret",
        TELEMETRY_PEPPER: "isolated-bundle-test-pepper",
        APP_URL: "http://127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const port = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("Bundle startup timed out")),
        8_000,
      );
      const fail = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/BUNDLE_PORT=(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.once("error", fail);
      child.once("exit", (code) =>
        fail(new Error(`Bundle exited before listening: ${code}`)),
      );
    });
    const health = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    expect(health.status).toBe(200);
    expect((await health.json()).ok).toBe(true);
    const refusal = await fetch(`http://127.0.0.1:${port}/me`, {
      signal: AbortSignal.timeout(2_000),
    });
    expect(refusal.status).toBe(401);
    expect((await refusal.json()).error.code).toBe("authentication_required");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
