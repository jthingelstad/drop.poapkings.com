import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// Each script in src/maintenance is an entry point that npm bundles to one
// CommonJS file and runs. Bundled, `require.main === module` is true for
// every module inside, so a script that imports another script runs both
// mains: the name migration's dry run once ran the avatar export too, which
// failed on its missing --out and left exit code 1 after a good dry run.
// Shared helpers go in a module with no entry guard (cloud-engineer.ts).
const MAINTENANCE = join(import.meta.dirname, "../src/maintenance");
const GUARD = /require\.main\s*===\s*module/g;

async function entryScripts(): Promise<string[]> {
  const files = (await readdir(MAINTENANCE)).filter((f) => f.endsWith(".ts"));
  const scripts: string[] = [];
  for (const file of files) {
    const source = await readFile(join(MAINTENANCE, file), "utf8");
    if (GUARD.test(source)) scripts.push(file);
    GUARD.lastIndex = 0;
  }
  return scripts;
}

describe("maintenance entry points", () => {
  it("each bundles with exactly one entry guard: its own", async () => {
    const scripts = await entryScripts();
    expect(scripts).toContain("migrate-elixir-names.ts");
    expect(scripts).toContain("export-elixir-avatars.ts");
    for (const script of scripts) {
      const result = await build({
        entryPoints: [join(MAINTENANCE, script)],
        bundle: true,
        platform: "node",
        target: "node24",
        format: "cjs",
        write: false,
        logLevel: "silent",
      });
      const bundled = result.outputFiles[0]!.text;
      expect({ script, guards: bundled.match(GUARD)?.length ?? 0 }).toEqual({
        script,
        guards: 1,
      });
    }
  }, 60_000);
});
