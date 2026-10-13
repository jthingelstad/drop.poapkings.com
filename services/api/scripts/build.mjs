import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildApi(outdir = resolve(serviceRoot, "dist")) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  const shared = {
    absWorkingDir: serviceRoot,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    sourcemap: true,
  };
  await build({
    ...shared,
    entryPoints: ["src/index.ts"],
    outfile: resolve(outdir, "index.js"),
  });
  await build({
    ...shared,
    entryPoints: ["src/refresh-worker.ts", "src/cr-results.ts"],
    outdir,
    outExtension: { ".js": ".cjs" },
  });
  await writeFile(
    resolve(outdir, "package.json"),
    JSON.stringify({ type: "commonjs" }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await buildApi();
}
