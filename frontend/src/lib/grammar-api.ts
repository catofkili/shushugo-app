import { getDatabase } from "./database";
import { oncePerDatabase } from "./database/db-utils";
import {
  ensureUserTables,
  firstValue,
  isFavorite
} from "./study-core";

/**
 * Grammar progress remains content progress, even though the old quiz UI and
 * answer engine have been removed. JLPT planning and bulk progress tools still
 * need one row per grammar point.
 */
export function ensureGrammarProgressInitialized() {
  // 一个库只跑一次:grammar_points 只在种子升版本时变,而那发生在启动阶段。
  // 不加闸门的话每答一次卡要跑 10 遍全表 INSERT OR IGNORE(实测 12ms/次作答)。
  oncePerDatabase("grammar-progress", () => {
    ensureUserTables();
    getDatabase().run(`
      INSERT OR IGNORE INTO grammar_progress (grammar_id)
      SELECT id FROM grammar_points
    `);
  });
}

const grammarState = (key: string, fallback: string) => firstValue<string>(
  "SELECT value FROM grammar_state WHERE key = ?",
  [key],
  fallback
);

const setGrammarState = (key: string, value: string) => {
  getDatabase().run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)", [key, value]);
};

// Kept only so progress reset/migration can safely discard queues left by old
// app versions. No current UI creates or consumes grammar quiz questions.
export const getGrammarQueue = (): { grammar_id: number; due_after: number }[] => {
  try {
    const queue = JSON.parse(grammarState("queue", "[]"));
    if (!Array.isArray(queue)) return [];
    return queue.flatMap((item) => {
      const grammarId = Number(item?.grammar_id);
      if (!Number.isFinite(grammarId)) return [];
      return [{ grammar_id: grammarId, due_after: Math.max(Number(item?.due_after ?? 0), 0) }];
    });
  } catch {
    return [];
  }
};

export const setGrammarQueue = (queue: { grammar_id: number; due_after: number }[]) => {
  setGrammarState("queue", JSON.stringify(queue));
};

export function getGrammarPointFavorite(pattern: string): boolean {
  return isFavorite("grammar", pattern);
}
