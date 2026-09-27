import path from 'node:path';

export function createSharedShims(root) {
  const frontend = path.resolve(root, '../frontend');
  const lib = path.join(frontend, 'src/lib');
  const data = path.join(frontend, 'src/data');
  const shims = path.join(root, 'scripts/shared/shims');
  const shim = (name) => path.join(shims, name);

  return new Map([
    [`${lib}/database`, shim('database.js')],
    [`${lib}/storage`, shim('storage.js')],
    [`${lib}/entitlements`, shim('entitlements.js')],
    [`${lib}/progress-events`, shim('progress-events.js')],
    [`${lib}/zoo-sounds`, shim('zoo-sounds.js')],
    [`${lib}/models/question-meaning-overrides`, shim('question-meaning-overrides.js')],
    [`${frontend}/src/components/CapybaraMascot`, shim('mascot.js')],
    [`${data}/verb_pair_hints`, shim('verb-pair-hints.js')],
    [`${data}/confusion_distinction_reviews`, shim('distinction-reviews.js')],
    [`${data}/kanji_reading_unit_runtime`, shim('kanji-unit-runtime.js')],
    [`${data}/kanji_reading_usage`, shim('kanji-reading-usage.js')],
    [`${data}/pitch_accent`, shim('pitch-accent-data.js')],
    [`${data}/kanji_variants`, shim('kanji-variants.js')],
    [`${data}/kanji_readings`, shim('kanji-readings.js')],
    [`${data}/grammar_key_points`, shim('grammar-key-points.js')],
    [`${data}/jlpt_words_seed`, shim('seed-guard.js')],
    [`${data}/grammar_seed`, shim('seed-guard.js')],
    [`${data}/jlpt_meaning_overrides`, shim('seed-guard.js')],
    [`${data}/jlpt_example_overrides`, shim('seed-guard.js')],
    [`${data}/jlpt_collocation_content`, shim('seed-guard.js')],
    [`${data}/jlpt_level_overrides`, shim('seed-guard.js')],
    [`${data}/kana_reading_fixes`, shim('seed-guard.js')],
    [`${data}/dictionary_supplement_seed`, shim('seed-guard.js')],
    [`${data}/word_sense_keys`, shim('seed-guard.js')]
  ]);
}
