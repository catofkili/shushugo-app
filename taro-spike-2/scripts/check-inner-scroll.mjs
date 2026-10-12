import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = join(root, "frontend/src");
const pattern = /\boverflow-y-auto\b|\boverflow-auto\b|\boverflow-y\s*:\s*(?:auto|scroll)\b|\boverflow\s*:\s*(?:auto|scroll)\b/g;
const exceptions = [
  {
    path: "frontend/src/App.tsx",
    count: 2,
    accepts: (line) => line.includes("app-landscape-main") && line.includes("overflow-y-auto"),
    reason: "The web app root scrolls here; WeappPage supplies the Mini Program root ScrollView."
  },
  {
    path: "frontend/src/main.tsx",
    count: 3,
    accepts: (line) => line.includes("app-boot-loading") && line.includes("overflow-y-auto"),
    reason: "These are temporary boot and error fallback screens, outside interactive page scroll areas."
  },
  {
    path: "frontend/src/pages/Library.tsx",
    count: 1,
    accepts: (line) => line.includes("dictionary-card") && line.includes("overflow-y-auto"),
    reason: "This is the sticky wide-screen grammar detail pane; narrow screens open the dedicated detail page."
  },
  {
    path: "frontend/src/styles.css",
    count: 1,
    accepts: (line) => line.trim() === "overflow-y: auto;",
    reason: "This is the landscape-only navigation rail, not a page content pane."
  },
  {
    path: "frontend/src/pages/weekly-report.css",
    count: 3,
    accepts: (line) => line.includes("overflow:auto"),
    reason: "The weekly report has its own full-screen reader, history dialog, and non-experience fallback."
  }
];

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : /\.(?:ts|tsx|js|jsx|css)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

const failures = [];
const used = new Map(exceptions.map((entry) => [entry.path, 0]));
for (const file of await filesUnder(sourceRoot)) {
  const path = relative(root, file).split("\\").join("/");
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(pattern)) {
    const before = source.slice(0, match.index);
    const line = source.slice(before.lastIndexOf("\n") + 1, source.indexOf("\n", match.index) < 0 ? source.length : source.indexOf("\n", match.index));
    if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;
    const exception = exceptions.find((entry) => entry.path === path && entry.accepts(line));
    if (!exception) {
      failures.push(`${path}: ${match[0]} has no Mini Program ScrollArea`);
      continue;
    }
    used.set(path, used.get(path) + 1);
  }
}

for (const exception of exceptions) {
  const count = used.get(exception.path);
  if (count !== exception.count) failures.push(`${exception.path}: expected ${exception.count} allowlisted scroll rules, found ${count}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Inner-scroll gate passed; ${exceptions.length} documented exceptions remain.`);
for (const exception of exceptions) console.log(`  ${exception.path}: ${exception.reason}`);
