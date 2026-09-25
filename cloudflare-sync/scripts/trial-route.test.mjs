import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-trial-test-"));
const built = spawnSync(join(root, "node_modules", ".bin", "wrangler"), ["deploy", "--dry-run", "--outdir", outdir], { cwd: root, encoding: "utf8" });
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);

try {
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
  const response = await worker.fetch(new Request("https://worker.test/api/entitlements/trial", { method: "POST" }), {}, {});
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { code: "TRIAL_DISABLED" });
  console.log("OK disabled plan trial route");
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
