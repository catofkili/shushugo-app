#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const reviewPath = path.join(scriptDir, 'jlpt-collocation-manual-review.json')
const outputPath = path.join(frontendDir, 'src/data/jlpt_collocation_candidates.json')

const importFlag = process.argv.indexOf('--import-review')
const inputPath = importFlag >= 0 ? process.argv[importFlag + 1] : reviewPath
if (!inputPath) throw new Error('--import-review requires a JSON path')

const review = JSON.parse(await readFile(path.resolve(inputPath), 'utf8'))
const allowedLevels = new Set(['N5', 'N4', 'N3', 'N2', 'N1'])
const allowedKinds = new Set(['collocation', 'idiom', 'routine_expression', 'proverb', 'yojijukugo'])
const forbiddenFields = new Set(['meaning', 'meaning_zh', 'example', 'example_jp', 'example_meaning'])
const normalize = (value) => value.normalize('NFKC').replace(/\[[^\]]*\]/g, '').replace(/[\s・〜]/g, '')
const countBy = (entries, key) => Object.fromEntries(
  [...new Set(entries.map((entry) => entry[key]))]
    .sort()
    .map((value) => [value, entries.filter((entry) => entry[key] === value).length]),
)
const sortedObject = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
const sameCounts = (actual, expected) => JSON.stringify(sortedObject(actual)) === JSON.stringify(sortedObject(expected))

if (review.status !== 'complete') throw new Error('manual review status must be complete')
if (!Array.isArray(review.pending) || review.pending.length !== 0) throw new Error('manual review must have pending=[]')
if (!Array.isArray(review.accepted) || review.accepted.length === 0) throw new Error('manual review accepted[] must not be empty')
if (review.selection_summary?.accepted !== review.accepted.length) throw new Error('selection_summary.accepted does not match accepted[]')
if (review.selection_summary?.pending !== 0) throw new Error('selection_summary.pending must be 0')

const ids = new Set()
const pairs = new Set()
for (const [index, entry] of review.accepted.entries()) {
  const label = `accepted[${index}]`
  for (const key of ['surface', 'kana', 'level', 'kind', 'jmdict_ent_seq', 'selection_reason', 'selection_evidence']) {
    if (entry[key] === undefined || entry[key] === '') throw new Error(`${label}.${key} is required`)
  }
  if (!allowedLevels.has(entry.level)) throw new Error(`${label}.level is invalid`)
  if (!allowedKinds.has(entry.kind)) throw new Error(`${label}.kind is invalid`)
  if (!Number.isSafeInteger(entry.jmdict_ent_seq)) throw new Error(`${label}.jmdict_ent_seq must be an integer`)
  if (typeof entry.selection_reason !== 'string' || !entry.selection_reason.endsWith('。')) {
    throw new Error(`${label}.selection_reason must be a complete sentence`)
  }
  if (!entry.selection_evidence || typeof entry.selection_evidence !== 'object' || Array.isArray(entry.selection_evidence)) {
    throw new Error(`${label}.selection_evidence must be an object`)
  }
  if (entry.selection_evidence.review_status !== 'explicit_accept' || !entry.selection_evidence.decision_basis) {
    throw new Error(`${label}.selection_evidence must record an explicit decision and basis`)
  }
  if (ids.has(entry.jmdict_ent_seq)) throw new Error(`duplicate JMdict ent_seq ${entry.jmdict_ent_seq}`)
  ids.add(entry.jmdict_ent_seq)
  const pair = `${normalize(entry.surface)}\0${normalize(entry.kana)}`
  if (pairs.has(pair)) throw new Error(`duplicate surface/kana pair: ${entry.surface} / ${entry.kana}`)
  pairs.add(pair)
  for (const key of Object.keys(entry)) {
    if (forbiddenFields.has(key)) throw new Error(`${label} must not contain ${key}`)
  }
}

const actualLevelCounts = countBy(review.accepted, 'level')
const actualKindCounts = countBy(review.accepted, 'kind')
if (!sameCounts(actualLevelCounts, review.selection_summary.level_counts)) {
  throw new Error('selection_summary.level_counts does not match accepted[]')
}
if (!sameCounts(actualKindCounts, review.selection_summary.kind_counts)) {
  throw new Error('selection_summary.kind_counts does not match accepted[]')
}

const product = {
  schema_version: review.schema_version,
  status: 'candidate_only_not_runtime',
  scope: review.scope,
  source: review.source,
  selection_summary: review.selection_summary,
  entries: review.accepted,
}

if (importFlag >= 0) {
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`)
}
await writeFile(outputPath, `${JSON.stringify(product, null, 2)}\n`)

console.log(`validated ${review.accepted.length} manually selected entries`)
console.log(`review: ${reviewPath}`)
console.log(`candidate product: ${outputPath}`)
