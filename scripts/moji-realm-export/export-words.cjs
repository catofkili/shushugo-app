// Read only the portable word fields from a MOJi Realm backup. The source is
// copied before opening because MOJi may still hold the live backup lock.
const fs = require("fs");
const os = require("os");
const path = require("path");
const Realm = require("realm");

const source = process.argv[2];
if (!source || !fs.existsSync(source)) {
  throw new Error("Usage: node export-words.cjs /path/to/core-mojidict-sc.backup.realm");
}

const copy = path.join(os.tmpdir(), `master-nihongo-moji-${Date.now()}.realm`);
fs.copyFileSync(source, copy);
try {
  const realm = new Realm({ path: copy });
  const schema = realm.schema.find((item) => item.name === "Wort");
  if (!schema) throw new Error("The MOJi backup does not contain the Wort table.");
  const words = Array.from(realm.objects("Wort")).map((word) => ({
    objectId: String(word.objectId ?? ""),
    spell: String(word.spell ?? ""),
    pron: String(word.pron ?? ""),
    briefInfo: String(word.briefInfo ?? ""),
    excerpt: String(word.excerpt ?? ""),
    tags: String(word.tags ?? "")
  })).filter((word) => word.objectId && word.spell);
  realm.close();
  process.stdout.write(JSON.stringify(words));
} finally {
  fs.rmSync(copy, { force: true });
}
