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

if (review.status !== 'complete') throw new Error('manual review status must be complete')
if (!Array.isArray(review.pending) || review.pending.length !== 0) throw new Error('manual review must have pending=[]')
if (!Array.isArray(review.accepted) || review.accepted.length !== 1200) {
  throw new Error(`expected 1200 accepted entries, got ${review.accepted?.length ?? 'missing'}`)
}

const ids = new Set()
const pairs = new Set()
for (const [index, entry] of review.accepted.entries()) {
  const label = `accepted[${index}]`
  for (const key of ['surface', 'kana', 'level', 'kind', 'jmdict_ent_seq', 'selection_reason']) {
    if (entry[key] === undefined || entry[key] === '') throw new Error(`${label}.${key} is required`)
  }
  if (!allowedLevels.has(entry.level)) throw new Error(`${label}.level is invalid`)
  if (!allowedKinds.has(entry.kind)) throw new Error(`${label}.kind is invalid`)
  if (!Number.isSafeInteger(entry.jmdict_ent_seq)) throw new Error(`${label}.jmdict_ent_seq must be an integer`)
  if (ids.has(entry.jmdict_ent_seq)) throw new Error(`duplicate JMdict ent_seq ${entry.jmdict_ent_seq}`)
  ids.add(entry.jmdict_ent_seq)
  const pair = `${entry.surface.normalize('NFKC').replaceAll(' ', '')}\0${entry.kana.normalize('NFKC').replaceAll(' ', '')}`
  if (pairs.has(pair)) throw new Error(`duplicate surface/kana pair: ${entry.surface} / ${entry.kana}`)
  pairs.add(pair)
  for (const forbidden of ['meaning', 'meaning_zh', 'example', 'example_jp', 'example_meaning']) {
    if (Object.hasOwn(entry, forbidden)) throw new Error(`${label} must not contain ${forbidden}`)
  }
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
