#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(serviceRoot, "../..");
const label = "com.poapkings.elixir-drop-admin";
const plistPath = resolve(homedir(), "Library/LaunchAgents", `${label}.plist`);
const program = resolve(serviceRoot, "dist/index.mjs");
const logs = resolve(homedir(), "Library", "Logs", "ElixirDrop");

const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function stableNodeExecutable(executable, version) {
  const cellar = executable.match(/^(.*)\/Cellar\/[^/]+\/[^/]+\/bin\/node$/);
  if (cellar) return resolve(cellar[1], "opt", "node@24", "bin", "node");
  if (!version.startsWith("24.")) {
    throw new Error(
      `The Control Room requires Node 24; installer is running Node ${version}`,
    );
  }
  return executable;
}

export function renderPlist(node) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(node)}</string><string>${escape(program)}</string></array>
<key>WorkingDirectory</key><string>${escape(repoRoot)}</string>
<key>EnvironmentVariables</key><dict>
<key>NODE_ENV</key><string>production</string>
<key>PATH</key><string>${escape(`${dirname(node)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
<key>AWS_PROFILE</key><string>referee-read</string>
<key>DROP_ADMIN_ACCOUNT_PROFILE</key><string>drop-control</string>
<key>AWS_REGION</key><string>us-east-1</string>
<key>DROP_ADMIN_HOST</key><string>127.0.0.1</string>
<key>DROP_ADMIN_PORT</key><string>8780</string>
<key>DROP_ADMIN_ALLOWED_LOGIN</key><string>jthingelstad@github</string>
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${escape(resolve(logs, "drop-admin.log"))}</string>
<key>StandardErrorPath</key><string>${escape(resolve(logs, "drop-admin.error.log"))}</string>
</dict></plist>`;
}

export function installLaunchAgent() {
  const node = stableNodeExecutable(process.execPath, process.versions.node);
  try {
    accessSync(node, constants.X_OK);
  } catch {
    throw new Error(`Stable Node 24 executable is unavailable at ${node}`);
  }
  const installedVersion = execFileSync(node, ["-p", "process.versions.node"], {
    encoding: "utf8",
  }).trim();
  if (!installedVersion.startsWith("24.")) {
    throw new Error(
      `Stable executable ${node} is Node ${installedVersion}; Node 24 is required`,
    );
  }

  mkdirSync(logs, { recursive: true });
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, renderPlist(node), { mode: 0o600 });
  try {
    execFileSync(
      "launchctl",
      ["bootout", `gui/${process.getuid()}`, plistPath],
      { stdio: "ignore" },
    );
  } catch {}
  execFileSync("launchctl", [
    "bootstrap",
    `gui/${process.getuid()}`,
    plistPath,
  ]);
  process.stdout.write(`Installed ${label} at ${plistPath}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  installLaunchAgent();
}
