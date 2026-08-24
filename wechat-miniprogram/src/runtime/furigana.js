function exampleSegments(sentence, annotation) {
  const text = String(sentence || '');
  if (!text) return [];
  let rows = [];
  try { rows = JSON.parse(annotation || '[]'); } catch { rows = []; }
  const valid = Array.isArray(rows)
    ? rows.map((row) => ({ start: Number(row?.[0]), length: Number(row?.[1]), reading: String(row?.[2] || '') }))
      .filter((row) => Number.isInteger(row.start) && row.start >= 0 && row.length > 0 && row.start < text.length)
      .sort((a, b) => a.start - b.start)
    : [];
  if (!valid.length) return [{ text, reading: '' }];
  const segments = [];
  let cursor = 0;
  valid.forEach((row) => {
    const start = Math.min(row.start, text.length);
    const end = Math.min(start + row.length, text.length);
    if (start < cursor || end <= start) return;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), reading: '' });
    segments.push({ text: text.slice(start, end), reading: row.reading });
    cursor = end;
  });
  if (cursor < text.length) segments.push({ text: text.slice(cursor), reading: '' });
  return segments;
}

module.exports = { exampleSegments };
