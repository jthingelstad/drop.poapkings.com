#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(serviceRoot, "../..");
const label = "com.poapkings.elixir-drop-admin";
const plistPath = resolve(homedir(), "Library/LaunchAgents", `${label}.plist`);
const node = process.execPath;
const program = resolve(serviceRoot, "dist/index.mjs");
const logs = resolve(homedir(), "Library", "Logs", "ElixirDrop");
mkdirSync(logs, { recursive: true });

const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(node)}</string><string>${escape(program)}</string></array>
<key>WorkingDirectory</key><string>${escape(repoRoot)}</string>
<key>EnvironmentVariables</key><dict>
<key>NODE_ENV</key><string>production</string>
<key>PATH</key><string>${escape(`${dirname(node)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
<key>AWS_PROFILE</key><string>referee-read</string>
<key>AWS_REGION</key><string>us-east-1</string>
<key>DROP_ADMIN_HOST</key><string>127.0.0.1</string>
<key>DROP_ADMIN_PORT</key><string>8780</string>
<key>DROP_ADMIN_ALLOWED_LOGIN</key><string>jthingelstad@github</string>
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${escape(resolve(logs, "drop-admin.log"))}</string>
<key>StandardErrorPath</key><string>${escape(resolve(logs, "drop-admin.error.log"))}</string>
</dict></plist>`;
mkdirSync(dirname(plistPath), { recursive: true });
writeFileSync(plistPath, plist, { mode: 0o600 });
try {
  execFileSync("launchctl", ["bootout", `gui/${process.getuid()}`, plistPath], {
    stdio: "ignore",
  });
} catch {}
execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath]);
process.stdout.write(`Installed ${label} at ${plistPath}\n`);
