import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const verifyMigrationDir = (directory) => {
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const db = new DatabaseSync(path.join(directory, "worker.sqlite"), { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integrity !== "ok") throw new Error(`integrity_check failed: ${integrity}`);
    const migrations = Number(db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n);
    if (migrations < 17) throw new Error(`Only ${migrations} migration records are present`);
    const actual = Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(({ name }) => [name, Number(db.prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n)]));
    const entries = (value) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    if (JSON.stringify(entries(actual)) !== JSON.stringify(entries(manifest.rowCounts ?? {}))) {
      throw new Error("Imported table row counts differ from the migration manifest");
    }
    const countObjects = (root, relative = "") => readdirSync(path.join(root, relative), { withFileTypes: true }).reduce((count, entry) => {
      if (!relative && entry.name === ".metadata") return count;
      const child = relative ? path.join(relative, entry.name) : entry.name;
      const info = lstatSync(path.join(root, child));
      if (info.isSymbolicLink()) throw new Error(`R2 import contains a symbolic link: ${child}`);
      if (info.isDirectory()) return count + countObjects(root, child);
      if (!info.isFile()) throw new Error(`R2 import contains a non-file object: ${child}`);
      return count + 1;
    }, 0);
    if (countObjects(path.join(directory, "r2")) !== manifest.r2Objects) throw new Error("Imported R2 object count differs from the migration manifest");
    return { migrations, tables: Object.keys(actual).length };
  } finally {
    db.close();
  }
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const directory = path.resolve(process.argv[2] ?? ".");
  console.log(JSON.stringify(verifyMigrationDir(directory)));
}
