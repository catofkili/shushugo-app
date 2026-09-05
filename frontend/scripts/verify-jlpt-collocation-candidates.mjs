#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const reviewPath = path.join(scriptDir, 'jlpt-collocation-manual-review.json')
const productPath = path.join(frontendDir, 'src/data/jlpt_collocation_candidates.json')
const globalAuditPath = path.join(scriptDir, 'jlpt-collocation-audit-findings.json')
const idiomAuditPath = path.join(scriptDir, 'jlpt-idiom-audit-findings.json')
const dbPath = path.join(frontendDir, 'public/nihongo.db')

if (/live\.db$|\.local/.test(dbPath)) throw new Error('refusing to inspect a live/user database')

const [review, product, globalAudit, idiomAudit] = await Promise.all([
  readFile(reviewPath, 'utf8').then(JSON.parse),
  readFile(productPath, 'utf8').then(JSON.parse),
  readFile(globalAuditPath, 'utf8').then(JSON.parse),
  readFile(idiomAuditPath, 'utf8').then(JSON.parse),
])

const countBy = (entries, key) => Object.fromEntries(
  [...new Set(entries.map((entry) => entry[key]))]
    .sort()
    .map((value) => [value, entries.filter((entry) => entry[key] === value).length]),
)
const sortedObject = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
const sameCounts = (actual, expected) => JSON.stringify(sortedObject(actual)) === JSON.stringify(sortedObject(expected))
const flattenNumbers = (value) => {
  if (Array.isArray(value)) return value.flatMap(flattenNumbers)
  if (value && typeof value === 'object') return Object.values(value).flatMap(flattenNumbers)
  return Number.isSafeInteger(value) ? [value] : []
}
const normalize = (value) => value.normalize('NFKC').replace(/\[[^\]]*\]/g, '').replace(/[\s・〜]/g, '')
const secondRound = globalAudit.second_round_905
const secondRoundKinds = new Map()
for (const id of [
  ...secondRound.reclassify.routine_expression_to_idiom_or_construction,
  ...secondRound.reclassify.proverb_to_idiom,
  ...secondRound.reclassify.yojijukugo_to_idiom_or_ordinary_metaphorical_term,
  ...secondRound.reclassify.collocation_to_idiom,
]) secondRoundKinds.set(id, 'idiom')
for (const id of secondRound.reclassify.routine_expression_to_collocation) secondRoundKinds.set(id, 'collocation')
const secondRoundLevels = new Map()
for (const id of secondRound.relevel.to_N3) secondRoundLevels.set(id, 'N3')
for (const id of secondRound.relevel.to_N2) secondRoundLevels.set(id, 'N2')
for (const id of secondRound.relevel.to_N1_if_retained) secondRoundLevels.set(id, 'N1')

if (review.status !== 'complete' || review.pending.length !== 0) throw new Error('manual review is incomplete')
if (review.selection_summary.pending !== 0) throw new Error('selection_summary.pending must be 0')
if (review.selection_summary.accepted !== review.accepted.length) throw new Error('selection summary count mismatch')
if (product.entries.length !== review.accepted.length) throw new Error('product count differs from manual review')
if (JSON.stringify(review.accepted) !== JSON.stringify(product.entries)) throw new Error('product entries differ from manual review')
if (!sameCounts(countBy(product.entries, 'level'), review.selection_summary.level_counts)) throw new Error('JLPT level distribution differs from review summary')
if (!sameCounts(countBy(product.entries, 'kind'), review.selection_summary.kind_counts)) throw new Error('entry kind distribution differs from review summary')

const ids = product.entries.map((entry) => entry.jmdict_ent_seq)
const acceptedIds = new Set(ids)
if (new Set(ids).size !== ids.length) throw new Error('duplicate JMdict ent_seq')
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
  if (!entry.selection_evidence || typeof entry.selection_evidence !== 'object' || Array.isArray(entry.selection_evidence)) {
    throw new Error(`${entry.surface} lacks structured selection evidence`)
  }
  if (entry.selection_evidence.review_status !== 'explicit_accept' || !entry.selection_evidence.decision_basis) {
    throw new Error(`${entry.surface} lacks an explicit acceptance decision or decision basis`)
  }
}
if (JSON.stringify(product).toLowerCase().includes('moji')) throw new Error('MOJi provenance is forbidden')
if (product.source.license !== 'CC BY-SA 4.0') throw new Error('unexpected source licence')

const globalRemoved = new Set(flattenNumbers(globalAudit.remove))
const leakedGlobalRemovals = ids.filter((id) => globalRemoved.has(id))
if (leakedGlobalRemovals.length) throw new Error(`entries rejected by global audit remain: ${leakedGlobalRemovals.join(', ')}`)

const idiomAuditById = new Map(idiomAudit.entries.map((entry) => [entry.jmdict_ent_seq, entry]))
for (const entry of product.entries) {
  const audited = idiomAuditById.get(entry.jmdict_ent_seq)
  if (!audited) continue
  if (audited.decision !== 'retain') throw new Error(`idiom audit removal remains: ${entry.surface}`)
  const expectedLevel = secondRoundLevels.get(entry.jmdict_ent_seq) ?? audited.recommended_level
  const expectedKind = secondRoundKinds.get(entry.jmdict_ent_seq) ?? audited.recommended_kind
  if (entry.level !== expectedLevel || entry.kind !== expectedKind) {
    throw new Error(`idiom audit recommendation not applied: ${entry.surface}`)
  }
  const evidence = entry.selection_evidence.manual_audit
  if (!evidence || evidence.decision !== 'retain' || evidence.recommended_level !== audited.recommended_level || evidence.recommended_kind !== audited.recommended_kind) {
    throw new Error(`idiom audit evidence not recorded: ${entry.surface}`)
  }
  if ((secondRoundLevels.has(entry.jmdict_ent_seq) || secondRoundKinds.has(entry.jmdict_ent_seq)) && !entry.selection_evidence.second_round_audit) {
    throw new Error(`second-round audit evidence not recorded: ${entry.surface}`)
  }
}

for (const family of globalAudit.duplicate_family) {
  const retained = family.filter((id) => acceptedIds.has(id))
  if (retained.length > 1) throw new Error(`duplicate family retained more than once: ${retained.join(', ')}`)
}

for (const id of globalAudit.reclassify.collocation_to_idiom) {
  const entry = product.entries.find((candidate) => candidate.jmdict_ent_seq === id)
  if (entry && entry.kind !== 'idiom') throw new Error(`global reclassification not applied: ${entry.surface}`)
}
for (const id of globalAudit.reclassify.routine_to_idiom_or_other) {
  const entry = product.entries.find((candidate) => candidate.jmdict_ent_seq === id)
  if (entry?.kind === 'routine_expression') throw new Error(`invalid routine classification remains: ${entry.surface}`)
}

const globalLevelRecommendations = new Map()
for (const [level, recommendedIds] of Object.entries(globalAudit.relevel.routine_expression)) {
  for (const id of recommendedIds) globalLevelRecommendations.set(id, level)
}
for (const [level, recommendedIds] of Object.entries(globalAudit.relevel.common_proverbs_currently_overconcentrated_in_N1)) {
  for (const id of recommendedIds) globalLevelRecommendations.set(id, level)
}
for (const entry of product.entries) {
  const expected = globalLevelRecommendations.get(entry.jmdict_ent_seq)
  if (expected && entry.level !== expected) throw new Error(`global level recommendation not applied: ${entry.surface}`)
}

const secondRoundRemoved = new Set()
for (const [group, values] of Object.entries(secondRound.remove_or_replace)) {
  if (Array.isArray(values)) for (const id of values) secondRoundRemoved.add(id)
  else if (group === 'noncanonical_surface_repairs') for (const id of Object.keys(values)) secondRoundRemoved.add(Number(id))
}
for (const overlap of secondRound.semantic_or_register_overlap_with_seed) secondRoundRemoved.add(overlap.candidate_ent_seq)
const leakedSecondRoundRemovals = ids.filter((id) => secondRoundRemoved.has(id))
if (leakedSecondRoundRemovals.length) throw new Error(`second-round removals remain: ${leakedSecondRoundRemovals.join(', ')}`)

const supportedSurfaceReplacements = [
  { replacedEntSeq: 1535240, replacementEntSeq: 2611610, surface: '目を丸くする' },
  { replacedEntSeq: 2260770, replacementEntSeq: 2419530, surface: '夫婦喧嘩は犬も食わない' },
]
for (const replacement of supportedSurfaceReplacements) {
  const entry = product.entries.find((candidate) => candidate.jmdict_ent_seq === replacement.replacementEntSeq)
  if (!entry || entry.surface !== replacement.surface) throw new Error(`missing canonical surface replacement for ${replacement.replacedEntSeq}`)
}
for (const [id, expectedKind] of secondRoundKinds) {
  const entry = product.entries.find((candidate) => candidate.jmdict_ent_seq === id)
  if (entry && entry.kind !== expectedKind) throw new Error(`second-round reclassification not applied: ${entry.surface}`)
}
for (const [id, expectedLevel] of secondRoundLevels) {
  const entry = product.entries.find((candidate) => candidate.jmdict_ent_seq === id)
  if (entry && entry.level !== expectedLevel) throw new Error(`second-round relevel not applied: ${entry.surface}`)
}
for (const family of secondRound.new_candidate_duplicate_or_overlap_families) {
  const retained = family.filter((id) => acceptedIds.has(id))
  if (retained.length !== 1) throw new Error(`second-round duplicate family must retain exactly one representative: ${family.join(', ')}`)
}

const retainedAuditedIds = new Set(idiomAudit.entries.filter((entry) => entry.decision === 'retain').map((entry) => entry.jmdict_ent_seq))
const retainedFromIdiomAudit = ids.filter((id) => retainedAuditedIds.has(id)).length
const removedFromIdiomAudit = idiomAudit.entries.filter((entry) => entry.decision === 'remove').length

console.log('JLPT collocation candidate verification passed')
console.log(JSON.stringify({
  total: product.entries.length,
  levels: countBy(product.entries, 'level'),
  kinds: countBy(product.entries, 'kind'),
  seed_collisions: 0,
  pending: 0,
  explicit_acceptance_decisions: product.entries.filter((entry) => entry.selection_evidence.review_status === 'explicit_accept').length,
  global_audit_removals_leaked: 0,
  second_round_removals_or_replacements_checked: secondRoundRemoved.size,
  second_round_removals_leaked: 0,
  second_round_reclassifications_checked: secondRoundKinds.size,
  second_round_relevels_checked: secondRoundLevels.size,
  second_round_overlap_families_with_multiple_entries: 0,
  seed_semantic_or_register_overlaps_leaked: 0,
  idiom_audit_removals_checked: removedFromIdiomAudit,
  retained_entries_backed_by_idiom_audit: retainedFromIdiomAudit,
  duplicate_families_with_multiple_entries: 0,
}, null, 2))
