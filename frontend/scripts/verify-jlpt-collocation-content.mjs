#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const candidatePath = path.join(frontendDir, 'src/data/jlpt_collocation_candidates.json')
const contentPath = path.join(frontendDir, 'src/data/jlpt_collocation_content.json')
const reviewPath = path.join(scriptDir, 'jlpt-collocation-translation-review.json')

const [candidate, content, review] = await Promise.all([
  readFile(candidatePath, 'utf8').then(JSON.parse),
  readFile(contentPath, 'utf8').then(JSON.parse),
  readFile(reviewPath, 'utf8').then(JSON.parse),
])

if (content.status !== 'content_ready_runtime_migration') throw new Error('content status is not runtime-ready')
if (content.entries.length !== candidate.entries.length || content.entries.length !== review.entries.length) {
  throw new Error('candidate/content/review counts differ')
}
if (review.status !== 'complete' || review.pending.length !== 0) throw new Error('translation review is incomplete')
if (!Array.isArray(content.sources) || content.sources.length === 0) throw new Error('translation sources are missing')
if (!content.sources.some((source) => source.name === 'Tomoshi open data zh_defs' && source.license === 'CC BY-SA 4.0')) {
  throw new Error('Tomoshi CC BY-SA attribution is missing')
}

const candidateById = new Map(candidate.entries.map((entry) => [entry.jmdict_ent_seq, entry]))
const ids = new Set()
for (const entry of content.entries) {
  if (ids.has(entry.jmdict_ent_seq)) throw new Error(`duplicate content id ${entry.jmdict_ent_seq}`)
  ids.add(entry.jmdict_ent_seq)
  const source = candidateById.get(entry.jmdict_ent_seq)
  if (!source || entry.surface !== source.surface || entry.kana !== source.kana || entry.level !== source.level || entry.kind !== source.kind) {
    throw new Error(`content metadata differs from candidate: ${entry.jmdict_ent_seq}`)
  }
  if (typeof entry.meaning !== 'string' || entry.meaning.trim().length < 2 || !/[\u3400-\u9fff]/u.test(entry.meaning)) {
    throw new Error(`missing Chinese meaning: ${entry.surface}`)
  }
  if (!['tomoshi_zh_defs', 'project_manual'].includes(entry.translation_source)) {
    throw new Error(`unknown translation source: ${entry.surface}`)
  }
  if (/moji/i.test(JSON.stringify(entry))) throw new Error(`forbidden provenance in ${entry.surface}`)
}

console.log(JSON.stringify({
  total: content.entries.length,
  translated: content.entries.length,
  missing: 0,
  tomoshi_derived: content.entries.filter((entry) => entry.translation_source === 'tomoshi_zh_defs').length,
  project_manual: content.entries.filter((entry) => entry.translation_source === 'project_manual').length,
}, null, 2))
