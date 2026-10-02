import { rowsFor, today } from "../study-core";
import { ensureSpellingTables } from "./store";

export const spellingErrorStats = (days = 14): Array<{ code: string; count: number }> => {
  if (!Number.isFinite(days) || days < 1) return [];
  ensureSpellingTables();
  const end = today();
  const start = new Date(`${end}T12:00:00`);
  start.setDate(start.getDate() - Math.floor(days) + 1);
  const firstDay = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return rowsFor(`
    SELECT problem AS code, COUNT(*) AS count FROM spelling_reviews
    WHERE reviewed_on >= ? AND reviewed_on <= ? AND problem NOT IN ('', 'gave_up')
    GROUP BY problem ORDER BY count DESC, problem ASC
  `, [firstDay, end]).map((row) => ({ code: String(row.code), count: Number(row.count) }));
};
