import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serviceDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const label = "com.poapkings.elixir-drop-cr-bridge";
const agentsDir = resolve(homedir(), "Library", "LaunchAgents");
const logsDir = resolve(homedir(), "Library", "Logs");
const plistPath = resolve(agentsDir, `${label}.plist`);
const logPath = resolve(logsDir, "elixir-drop-cr-bridge.log");

function isNode24(path) {
  if (!existsSync(path)) return false;
  try {
    return execFileSync(path, ["--version"], { encoding: "utf8" })
      .trim()
      .startsWith("v24.");
  } catch {
    return false;
  }
}

const nodePath = [
  process.execPath,
  "/opt/homebrew/opt/node@24/bin/node",
  "/usr/local/opt/node@24/bin/node",
].find(isNode24);

if (!nodePath) {
  throw new Error("Node 24 is required to install the CR bridge service.");
}

function xml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(resolve(serviceDir, "dist", "index.cjs"))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(resolve(serviceDir, "..", ".."))}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`;

await Promise.all([
  mkdir(agentsDir, { recursive: true }),
  mkdir(logsDir, { recursive: true }),
]);
await writeFile(plistPath, plist, { mode: 0o644 });
await chmod(plistPath, 0o644);

const domain = `gui/${process.getuid()}`;
try {
  execFileSync("launchctl", ["bootout", domain, plistPath], {
    stdio: "ignore",
  });
} catch {
  // The service was not loaded yet.
}
execFileSync("launchctl", ["bootstrap", domain, plistPath], {
  stdio: "inherit",
});
execFileSync("launchctl", ["kickstart", "-k", `${domain}/${label}`], {
  stdio: "inherit",
});

console.log(`Installed and started ${label}.`);
console.log(`Runtime: ${nodePath}`);
console.log(`Logs: ${logPath}`);
