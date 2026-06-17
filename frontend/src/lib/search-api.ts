import { grammarPoints } from "../data/grammar";
import { rowsFor } from "./study-core";

export type SearchResultType = "word" | "grammar";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  meta: string;
}

export function searchContent(query: string, limit = 8): SearchResult[] {
  const text = query.trim();
  if (text.length < 1) return [];
  const like = `%${text}%`;
  const wordLimit = Math.max(1, Math.ceil(limit / 2));
  const grammarLimit = Math.max(1, limit - wordLimit);

  const words = rowsFor(`
    SELECT id, kanji, kana, meaning, pos, jlpt_level
    FROM words
    WHERE kanji LIKE ? OR kana LIKE ? OR meaning LIKE ?
    ORDER BY
      CASE WHEN kanji = ? OR kana = ? THEN 0 ELSE 1 END,
      CASE jlpt_level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END,
      importance DESC,
      id ASC
    LIMIT ?
  `, [like, like, like, text, text, wordLimit]).map((row): SearchResult => ({
    type: "word",
    id: String(row.id ?? ""),
    title: String(row.kanji || row.kana || ""),
    subtitle: String(row.meaning ?? ""),
    meta: [String(row.kana ?? ""), String(row.jlpt_level ?? ""), String(row.pos ?? "")]
      .filter(Boolean)
      .join(" · ")
  }));

  const grammar = grammarPoints
    .filter((point) => (
      point.title.includes(text)
      || point.id.includes(text)
      || point.meaning.includes(text)
      || point.structure.includes(text)
      || point.explanation.includes(text)
      || point.examples.some((example) => example.jp.includes(text) || example.cn.includes(text))
    ))
    .slice(0, grammarLimit)
    .map((point): SearchResult => ({
      type: "grammar",
      id: point.id,
      title: point.title,
      subtitle: point.meaning,
      meta: `${point.level} · 语法`
    }));

  return [...words, ...grammar].slice(0, limit);
}
