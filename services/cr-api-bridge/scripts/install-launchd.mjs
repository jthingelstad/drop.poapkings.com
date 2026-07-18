import { execFileSync } from "node:child_process";
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
    <string>${xml(process.execPath)}</string>
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
console.log(`Logs: ${logPath}`);
