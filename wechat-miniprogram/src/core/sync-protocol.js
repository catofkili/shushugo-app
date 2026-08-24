const core = require('./study-core');

const SYNC_PROTOCOL_VERSION = 'sync-v1';
const DEVICE_ID_KEY = 'sync_device_id';

function stableHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function wordKey(kanji, kana) {
  return `${String(kanji)}\u0000${String(kana)}`;
}

function getDeviceId(db) {
  let id = core.getState(db, DEVICE_ID_KEY, '');
  if (!id) {
    id = `wx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    core.setState(db, DEVICE_ID_KEY, id);
  }
  return id;
}

function reviewNaturalKey(row) {
  return `${row.wordKey}\u0000${row.createdAt}\u0000${row.direction || 'forward'}`;
}

function checksumForEnvelope(envelope) {
  return stableHash(JSON.stringify({
    protocol: envelope.protocol,
    deviceId: envelope.deviceId,
    contentVersion: envelope.contentVersion,
    reviews: envelope.reviews,
    progress: envelope.progress,
    directionProgress: envelope.directionProgress || [],
    tombstones: envelope.tombstones || []
  }));
}

function progressFields(row) {
  return {
    seenCount: Number(row.seen_count ?? 0),
    rightCount: Number(row.right_count ?? 0),
    fuzzyCount: Number(row.fuzzy_count ?? 0),
    forgotCount: Number(row.forgot_count ?? 0),
    score: Number(row.score ?? 0),
    knownForever: Number(row.known_forever ?? 0),
    masteredOn: row.mastered_on || null,
    lastSeenOn: row.last_seen_on || null,
    fsrsStability: row.fsrs_stability == null ? null : Number(row.fsrs_stability),
    fsrsDifficulty: row.fsrs_difficulty == null ? null : Number(row.fsrs_difficulty),
    fsrsDue: row.fsrs_due || null,
    fsrsLastReview: row.fsrs_last_review || null,
    fsrsState: row.fsrs_state == null ? null : Number(row.fsrs_state),
    fsrsSteps: row.fsrs_steps == null ? null : Number(row.fsrs_steps),
    fsrsReps: row.fsrs_reps == null ? null : Number(row.fsrs_reps),
    fsrsLapses: row.fsrs_lapses == null ? null : Number(row.fsrs_lapses)
  };
}

function directionRows(db, direction, table, words) {
  return core.rowsFor(db, `
    SELECT d.*, w.kanji, w.kana
    FROM ${table} d JOIN words w ON w.id = d.word_id
    WHERE d.seen_count > 0 OR d.known_forever = 1 OR d.fsrs_due IS NOT NULL
  `).map((row) => ({ direction, wordKey: wordKey(row.kanji, row.kana), ...progressFields(row) }));
}

function buildEnvelope(db, options = {}) {
  core.ensureStudySchema(db);
  const deviceId = getDeviceId(db);
  const words = new Map(
    core.rowsFor(db, 'SELECT id, kanji, kana FROM words')
      .map((row) => [Number(row.id), wordKey(row.kanji, row.kana)])
  );
  const reviews = core.rowsFor(db, `
    SELECT r.word_id, r.answer, r.score_after, r.reviewed_on, r.created_at, r.direction,
           w.kanji, w.kana
    FROM reviews r JOIN words w ON w.id = r.word_id
    ORDER BY r.created_at ASC, r.id ASC
  `).map((row) => ({
    wordKey: wordKey(row.kanji, row.kana),
    answer: String(row.answer),
    scoreAfter: Number(row.score_after ?? 0),
    reviewedOn: String(row.reviewed_on),
    createdAt: String(row.created_at),
    direction: String(row.direction || 'forward')
  }));
  const progress = core.rowsFor(db, `
    SELECT p.*, w.kanji, w.kana,
           COALESCE(n.note, '') AS note,
           COALESCE(n.updated_at, '') AS note_updated_at
    FROM progress p JOIN words w ON w.id = p.word_id
    LEFT JOIN word_notes n ON n.word_id = p.word_id
    WHERE p.seen_count > 0 OR p.known_forever = 1 OR p.fsrs_due IS NOT NULL OR n.word_id IS NOT NULL
  `).map((row) => ({
    wordKey: wordKey(row.kanji, row.kana),
    ...progressFields(row),
    note: String(row.note || ''),
    noteUpdatedAt: String(row.note_updated_at || '')
  }));
  const directionProgress = [
    ...directionRows(db, 'reverse', 'reverse_memory', words),
    ...directionRows(db, 'kanji', 'kanji_reading_memory', words)
  ];
  const payload = {
    protocol: SYNC_PROTOCOL_VERSION,
    deviceId,
    generatedAt: new Date().toISOString(),
    contentVersion: core.getState(db, 'content_version', 'seed'),
    reviews,
    progress,
    directionProgress,
    tombstones: core.rowsFor(db, 'SELECT entity, natural_key, deleted_at FROM sync_tombstones').map((row) => ({
      entity: String(row.entity), naturalKey: String(row.natural_key), deletedAt: String(row.deleted_at)
    }))
  };
  return { ...payload, checksum: checksumForEnvelope(payload), cursor: options.cursor || core.getState(db, 'sync_cursor', '') };
}

function mergeProgress(db, table, localId, remote) {
  const local = core.rowsFor(db, `SELECT * FROM ${table} WHERE word_id = ?`, [localId])[0];
  if (!local) {
    db.run(`INSERT OR IGNORE INTO ${table} (word_id) VALUES (?)`, [localId]);
  }
  const current = local || core.rowsFor(db, `SELECT * FROM ${table} WHERE word_id = ?`, [localId])[0] || {};
  const localLast = current.fsrs_last_review ? new Date(current.fsrs_last_review).getTime() : 0;
  const remoteLast = remote.fsrsLastReview ? new Date(remote.fsrsLastReview).getTime() : 0;
  const useRemoteFsrs = remoteLast > localLast;
  db.run(`
    UPDATE ${table} SET
      seen_count = MAX(seen_count, ?), right_count = MAX(right_count, ?),
      fuzzy_count = MAX(fuzzy_count, ?), forgot_count = MAX(forgot_count, ?),
      score = MAX(score, ?), known_forever = MAX(known_forever, ?),
      mastered_on = CASE WHEN COALESCE(mastered_on, '') >= COALESCE(?, '') THEN mastered_on ELSE ? END,
      last_seen_on = CASE WHEN COALESCE(last_seen_on, '') >= COALESCE(?, '') THEN last_seen_on ELSE ? END
      ${useRemoteFsrs ? ', fsrs_stability = ?, fsrs_difficulty = ?, fsrs_due = ?, fsrs_last_review = ?, fsrs_state = ?, fsrs_steps = ?, fsrs_reps = ?, fsrs_lapses = ?' : ''}
    WHERE word_id = ?
  `, [
    remote.seenCount, remote.rightCount, remote.fuzzyCount, remote.forgotCount,
    remote.score, remote.knownForever,
    remote.masteredOn, remote.masteredOn,
    remote.lastSeenOn, remote.lastSeenOn,
    ...(useRemoteFsrs ? [remote.fsrsStability, remote.fsrsDifficulty, remote.fsrsDue, remote.fsrsLastReview, remote.fsrsState, remote.fsrsSteps, remote.fsrsReps, remote.fsrsLapses] : []),
    localId
  ]);
}

function mergeNote(db, localId, remote) {
  if (!remote.note) return false;
  const local = core.rowsFor(db, 'SELECT note, updated_at FROM word_notes WHERE word_id = ?', [localId])[0];
  if (!local || String(remote.noteUpdatedAt || '') > String(local.updated_at || '')) {
    core.saveNote(db, localId, remote.note, remote.noteUpdatedAt ? new Date(remote.noteUpdatedAt) : new Date());
    return true;
  }
  return false;
}

function applyEnvelope(db, envelope) {
  core.ensureStudySchema(db);
  if (!envelope || envelope.protocol !== SYNC_PROTOCOL_VERSION) {
    throw new Error(`不支持的同步协议：${envelope?.protocol || '(空)'}`);
  }
  if (!Array.isArray(envelope.reviews) || !Array.isArray(envelope.progress)) {
    throw new Error('同步包缺少 reviews/progress');
  }
  if (envelope.checksum && envelope.checksum !== checksumForEnvelope(envelope)) {
    throw new Error('同步包校验和不匹配');
  }
  const localWords = new Map(
    core.rowsFor(db, 'SELECT id, kanji, kana FROM words')
      .map((row) => [wordKey(row.kanji, row.kana), Number(row.id)])
  );
  let insertedReviews = 0;
  let skippedReviews = 0;
  let mergedProgress = 0;
  let mergedNotes = 0;
  db.run('BEGIN TRANSACTION');
  try {
    for (const review of envelope.reviews) {
      const localId = localWords.get(review.wordKey);
      if (!localId) {
        skippedReviews += 1;
        continue;
      }
      const exists = core.firstValue(db, `
        SELECT 1 FROM reviews WHERE word_id = ? AND created_at = ? AND direction = ? LIMIT 1
      `, [localId, review.createdAt, review.direction || 'forward'], 0);
      if (exists) continue;
      db.run(`
        INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [localId, review.answer, review.scoreAfter, review.reviewedOn, review.createdAt, review.direction || 'forward']);
      insertedReviews += 1;
    }
    for (const row of envelope.progress) {
      const localId = localWords.get(row.wordKey);
      if (!localId) continue;
      mergeProgress(db, 'progress', localId, row);
      mergedProgress += 1;
      if (mergeNote(db, localId, row)) mergedNotes += 1;
    }
    for (const row of envelope.directionProgress || []) {
      const localId = localWords.get(row.wordKey);
      const table = row.direction === 'reverse' ? 'reverse_memory' : row.direction === 'kanji' ? 'kanji_reading_memory' : null;
      if (!localId || !table) continue;
      mergeProgress(db, table, localId, row);
      mergedProgress += 1;
    }
    for (const tombstone of envelope.tombstones || []) {
      db.run(
        'INSERT OR REPLACE INTO sync_tombstones (entity, natural_key, deleted_at) VALUES (?, ?, ?)',
        [tombstone.entity, tombstone.naturalKey, tombstone.deletedAt]
      );
    }
    core.setState(db, 'sync_last_device_id', envelope.deviceId || '');
    core.setState(db, 'sync_last_at', new Date().toISOString());
    core.setState(db, 'sync_cursor', envelope.cursor || envelope.generatedAt || '');
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  return { insertedReviews, skippedReviews, mergedProgress, mergedNotes };
}

module.exports = {
  SYNC_PROTOCOL_VERSION,
  DEVICE_ID_KEY,
  buildEnvelope,
  applyEnvelope,
  getDeviceId,
  reviewNaturalKey,
  wordKey,
  stableHash,
  checksumForEnvelope
};
