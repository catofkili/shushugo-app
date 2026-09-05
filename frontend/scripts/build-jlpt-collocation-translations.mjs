#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const candidatePath = path.join(frontendDir, 'src/data/jlpt_collocation_candidates.json')
const reviewPath = path.join(scriptDir, 'jlpt-collocation-translation-review.json')
const outputPath = path.join(frontendDir, 'src/data/jlpt_collocation_content.json')

const candidate = JSON.parse(await readFile(candidatePath, 'utf8'))
const review = JSON.parse(await readFile(reviewPath, 'utf8'))

if (review.status !== 'complete' || review.pending.length !== 0) {
  throw new Error('translation review is incomplete')
}
if (!Array.isArray(review.entries) || review.entries.length !== candidate.entries.length) {
  throw new Error('translation count differs from collocation candidates')
}

const byId = new Map(candidate.entries.map((entry) => [entry.jmdict_ent_seq, entry]))
const ids = new Set()
const entries = review.entries.map((translation, index) => {
  const label = `entries[${index}]`
  if (!Number.isSafeInteger(translation.jmdict_ent_seq)) throw new Error(`${label}.jmdict_ent_seq is invalid`)
  if (ids.has(translation.jmdict_ent_seq)) throw new Error(`duplicate translation id ${translation.jmdict_ent_seq}`)
  ids.add(translation.jmdict_ent_seq)
  const source = byId.get(translation.jmdict_ent_seq)
  if (!source) throw new Error(`translation has no candidate ${translation.jmdict_ent_seq}`)
  for (const key of ['surface', 'kana', 'level', 'kind']) {
    if (translation[key] !== source[key]) throw new Error(`${label}.${key} differs from candidate ${translation.jmdict_ent_seq}`)
  }
  if (typeof translation.meaning !== 'string' || translation.meaning.trim().length < 2) {
    throw new Error(`${label}.meaning is empty`)
  }
  if (!/[\u3400-\u9fff]/u.test(translation.meaning)) throw new Error(`${label}.meaning is not Chinese`)
  return {
    // Keep audit-only selection metadata out of the runtime bundle. The
    // candidate/review files remain the provenance and review records.
    jmdict_ent_seq: source.jmdict_ent_seq,
    surface: source.surface,
    kana: source.kana,
    level: source.level,
    kind: source.kind,
    meaning: translation.meaning.trim(),
    translation_source: translation.translation_source,
  }
})

const product = {
  schema_version: 1,
  status: 'content_ready_runtime_migration',
  scope: candidate.scope,
  sources: review.sources,
  translation_policy: review.translation_policy,
  reviewed_at: review.reviewed_at,
  entries,
}

await writeFile(outputPath, `${JSON.stringify(product, null, 2)}\n`)
console.log(`validated and wrote ${entries.length} translated collocation entries`)
console.log(`content: ${outputPath}`)
