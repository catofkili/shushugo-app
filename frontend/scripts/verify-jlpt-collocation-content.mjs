#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const candidatePath = path.join(frontendDir, 'src/data/jlpt_collocation_candidates.json')
const contentPath = path.join(frontendDir, 'src/data/jlpt_collocation_content.json')
const reviewPath = path.join(scriptDir, 'jlpt-collocation-translation-review.json')
const tierReviewPath = path.join(scriptDir, 'jlpt-collocation-tier-review.json')

const [candidate, content, review, tierReview] = await Promise.all([
  readFile(candidatePath, 'utf8').then(JSON.parse),
  readFile(contentPath, 'utf8').then(JSON.parse),
  readFile(reviewPath, 'utf8').then(JSON.parse),
  readFile(tierReviewPath, 'utf8').then(JSON.parse),
])

if (content.status !== 'content_ready_runtime_migration') throw new Error('content status is not runtime-ready')
if (content.entries.length !== candidate.entries.length || content.entries.length !== review.entries.length) {
  throw new Error('candidate/content/review counts differ')
}
if (content.entries.length !== 790) throw new Error('collocation content must contain exactly 790 entries')
if (review.status !== 'complete' || review.pending.length !== 0) throw new Error('translation review is incomplete')
if (!Array.isArray(content.sources) || content.sources.length === 0) throw new Error('translation sources are missing')
if (!content.sources.some((source) => source.name === 'Tomoshi open data zh_defs' && source.license === 'CC BY-SA 4.0')) {
  throw new Error('Tomoshi CC BY-SA attribution is missing')
}

const candidateById = new Map(candidate.entries.map((entry) => [entry.jmdict_ent_seq, entry]))
const translationById = new Map(review.entries.map((entry) => [entry.jmdict_ent_seq, entry]))
const defaults = { routine_expression: 'core', collocation: 'common', idiom: 'optional', proverb: 'optional', yojijukugo: 'optional' }
const promotionLimits = { N3: 20, N2: 50, N1: 30 }
if (tierReview.status !== 'complete' || !Array.isArray(tierReview.pending) || tierReview.pending.length !== 0) {
  throw new Error('tier review is incomplete')
}
for (const [key, expected] of [['default_tier_by_kind', defaults], ['idiom_promotion_limits', promotionLimits]]) {
  const actual = tierReview[key]
  if (!actual || Object.keys(actual).length !== Object.keys(expected).length
    || Object.entries(expected).some(([name, value]) => actual[name] !== value)) {
    throw new Error(`tier review has unexpected ${key}`)
  }
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(tierReview.reviewed_at)) throw new Error('tier review date is missing')
if (!Array.isArray(tierReview.exceptions)) throw new Error('tier exceptions are missing')
const exceptions = new Map()
for (const exception of tierReview.exceptions) {
  const source = candidateById.get(exception.jmdict_ent_seq)
  if (!source || ['surface', 'level', 'kind'].some((key) => exception[key] !== source[key])) {
    throw new Error(`tier exception differs from candidate: ${exception.jmdict_ent_seq}`)
  }
  if (exceptions.has(exception.jmdict_ent_seq)) throw new Error(`duplicate tier exception: ${exception.surface}`)
  if (typeof exception.reason !== 'string' || !exception.reason.trim() || /[\r\n]/.test(exception.reason)) {
    throw new Error(`tier exception needs a one-line reason: ${exception.surface}`)
  }
  const allowed = (exception.tier === 'core' && ['collocation', 'idiom'].includes(source.kind))
    || (exception.tier === 'common' && source.kind === 'routine_expression')
    || (exception.tier === 'common' && source.kind === 'idiom' && Object.hasOwn(promotionLimits, source.level))
  if (!allowed) throw new Error(`unsupported tier exception: ${exception.surface}`)
  exceptions.set(exception.jmdict_ent_seq, exception)
}
const counts = Object.fromEntries(['N5', 'N4', 'N3', 'N2', 'N1'].map((level) => [level, { core: 0, common: 0, optional: 0 }]))
const promotions = { N3: 0, N2: 0, N1: 0 }
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
  const translation = translationById.get(entry.jmdict_ent_seq)
  if (!translation || entry.meaning !== translation.meaning.trim() || entry.translation_source !== translation.translation_source) {
    throw new Error(`content translation differs from review: ${entry.surface}`)
  }
  if (Object.hasOwn(entry, 't') && ![0, 2].includes(entry.t)) throw new Error(`invalid tier code: ${entry.surface}`)
  const tier = entry.t === 0 ? 'core' : entry.t === 2 ? 'optional' : 'common'
  const exception = exceptions.get(entry.jmdict_ent_seq)
  if (['proverb', 'yojijukugo'].includes(entry.kind) && tier !== 'optional') {
    throw new Error(`proverb/yojijukugo must remain optional: ${entry.surface}`)
  }
  if (tier === 'core' && entry.kind !== 'routine_expression' && exception?.tier !== 'core') {
    throw new Error(`non-routine core lacks a reviewed exception: ${entry.surface}`)
  }
  if (tier !== (exception?.tier ?? defaults[entry.kind])) throw new Error(`tier differs from review: ${entry.surface}`)
  if (!Object.hasOwn(counts, entry.level)) throw new Error(`unknown tier level: ${entry.surface}`)
  counts[entry.level][tier]++
  if (entry.kind === 'idiom' && tier === 'common') promotions[entry.level]++
  if (/moji/i.test(JSON.stringify(entry))) throw new Error(`forbidden provenance in ${entry.surface}`)
}
for (const [level, [min, max]] of Object.entries({ N3: [15, 30], N2: [8, 20] })) {
  if (counts[level].core < min || counts[level].core > max) throw new Error(`${level} core count is outside [${min}, ${max}]`)
}
for (const [level, limit] of Object.entries(promotionLimits)) {
  if (promotions[level] > limit) throw new Error(`${level} idiom promotions exceed ${limit}`)
}

console.log(JSON.stringify({
  total: content.entries.length,
  translated: content.entries.length,
  missing: 0,
  tomoshi_derived: content.entries.filter((entry) => entry.translation_source === 'tomoshi_zh_defs').length,
  project_manual: content.entries.filter((entry) => entry.translation_source === 'project_manual').length,
  tiers_by_level: counts,
  idiom_promotions: promotions,
}, null, 2))
