#!/usr/bin/env node
/* Keep the checked-in content index tied to the exact seed inputs. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("..", import.meta.url));
const indexPath = resolve(frontend, "src/data/kanji_reading_unit_index.json");
const dbPath = resolve(frontend, "public/nihongo.db");
const readingsPath = resolve(frontend, "src/data/kanji_readings.json");
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const index = JSON.parse(readFileSync(indexPath, "utf8"));
if (index.version !== "2026-08-22-kanji-reading-units-v1") throw new Error(`kanji unit index version mismatch: ${index.version}`);
if (index.source?.database !== "public/nihongo.db" || index.source?.liveDatabase !== false) {
  throw new Error("kanji unit index must declare public/nihongo.db and liveDatabase=false");
}
if (index.source.sha256 !== hash(dbPath)) throw new Error("kanji unit index is stale relative to public/nihongo.db; rerun npm run build:kanji-unit-index");
if (index.source.readingsSha256 !== hash(readingsPath)) throw new Error("kanji unit index is stale relative to kanji_readings.json; rerun npm run build:kanji-unit-index");
if (!Array.isArray(index.units) || !Array.isArray(index.occurrences) || !Array.isArray(index.unresolved) || !Array.isArray(index.alignmentTies) || !Array.isArray(index.manualReview) || !Array.isArray(index.manualReviewLog)) {
  throw new Error("kanji unit index arrays are missing");
}
if (index.stats?.unresolvedWords !== index.unresolved.length) throw new Error("kanji unit unresolved count mismatch");
if (index.stats?.ambiguousWords !== index.alignmentTies.length) throw new Error("kanji unit tie count mismatch");
if (index.stats?.tieCases < index.stats?.ambiguousWords) throw new Error("kanji unit tie case total mismatch");
if (index.stats?.manualReviewCount !== index.manualReviewLog.length) throw new Error("kanji unit manual review log count mismatch");
if (index.stats?.manualReviewSampleCount !== index.manualReview.length) throw new Error("kanji unit manual review sample count mismatch");
if (index.stats?.reviewedUnresolvedCandidates !== undefined && index.stats.reviewedUnresolvedCandidates < index.unresolved.length) throw new Error("kanji unit reviewed unresolved count mismatch");
if (index.stats?.reviewedAlignmentTies !== undefined && index.stats.reviewedAlignmentTies < index.alignmentTies.length) throw new Error("kanji unit reviewed tie count mismatch");
if (index.manualReviewLog.some((item) => !item.exampleWordId || !item.surface || !item.reading || !item.decision)) throw new Error("kanji unit manual review log contains an invalid row");
console.log(`✅ kanji unit index verified (${index.units.length} units, ${index.occurrences.length} occurrences)`);
