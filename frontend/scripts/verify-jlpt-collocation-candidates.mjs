#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const reviewPath = path.join(scriptDir, 'jlpt-collocation-manual-review.json')
const productPath = path.join(frontendDir, 'src/data/jlpt_collocation_candidates.json')
const dbPath = path.join(frontendDir, 'public/nihongo.db')

if (/live\.db$|\.local/.test(dbPath)) throw new Error('refusing to inspect a live/user database')

const [review, product] = await Promise.all([
  readFile(reviewPath, 'utf8').then(JSON.parse),
  readFile(productPath, 'utf8').then(JSON.parse),
])

const expectedLevels = { N5: 20, N4: 80, N3: 200, N2: 400, N1: 500 }
const expectedKinds = { routine_expression: 60, collocation: 300, idiom: 740, yojijukugo: 70, proverb: 30 }
const countBy = (entries, key) => Object.fromEntries(
  [...new Set(entries.map((entry) => entry[key]))]
    .sort()
    .map((value) => [value, entries.filter((entry) => entry[key] === value).length]),
)
const sortedObject = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
const sameCounts = (actual, expected) => JSON.stringify(sortedObject(actual)) === JSON.stringify(sortedObject(expected))

if (review.status !== 'complete' || review.pending.length !== 0) throw new Error('manual review is incomplete')
if (review.selection_summary.pending !== 0) throw new Error('selection_summary.pending must be 0')
if (review.accepted.length !== 1200 || product.entries.length !== 1200) throw new Error('candidate count must be 1200')
if (JSON.stringify(review.accepted) !== JSON.stringify(product.entries)) throw new Error('product entries differ from manual review')
if (!sameCounts(countBy(product.entries, 'level'), expectedLevels)) throw new Error('JLPT level distribution changed')
if (!sameCounts(countBy(product.entries, 'kind'), expectedKinds)) throw new Error('entry kind distribution changed')

const ids = product.entries.map((entry) => entry.jmdict_ent_seq)
if (new Set(ids).size !== ids.length) throw new Error('duplicate JMdict ent_seq')
const normalize = (value) => value.normalize('NFKC').replace(/\[[^\]]*\]/g, '').replace(/[ ・〜]/g, '')
const pairs = product.entries.map((entry) => `${normalize(entry.surface)}\0${normalize(entry.kana)}`)
if (new Set(pairs).size !== pairs.length) throw new Error('duplicate normalized surface/kana pair')

const dbRows = JSON.parse(execFileSync('sqlite3', ['-json', dbPath, 'SELECT kanji, kana FROM words'], { encoding: 'utf8' }) || '[]')
const dbPairs = new Set(dbRows.map((row) => `${normalize(row.kanji)}\0${normalize(row.kana)}`))
const collisions = product.entries.filter((entry) => dbPairs.has(`${normalize(entry.surface)}\0${normalize(entry.kana)}`))
if (collisions.length) throw new Error(`current seed collisions: ${collisions.map((entry) => entry.surface).join(', ')}`)

const forbiddenKeys = new Set(['meaning', 'meaning_zh', 'example', 'example_jp', 'example_meaning'])
for (const entry of product.entries) {
  for (const key of Object.keys(entry)) {
    if (forbiddenKeys.has(key)) throw new Error(`${entry.surface} contains forbidden field ${key}`)
  }
  if (!entry.selection_reason.endsWith('。')) throw new Error(`${entry.surface} has an incomplete selection reason`)
}
if (JSON.stringify(product).toLowerCase().includes('moji')) throw new Error('MOJi provenance is forbidden')
if (product.source.license !== 'CC BY-SA 4.0') throw new Error('unexpected source licence')

console.log('JLPT collocation candidate verification passed')
console.log(JSON.stringify({ total: product.entries.length, levels: countBy(product.entries, 'level'), kinds: countBy(product.entries, 'kind'), seed_collisions: 0, pending: 0 }, null, 2))
