import { beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";
import type { WordCard } from "../../types/vocabulary";
import type { DbRow } from "../database/db-utils";

let testDb: Database;
vi.mock("../database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { confusionCandidates, resetConfusionCache } from "./confusion";
import { resetConfusionGroups } from "../confusion-groups";
import { similarMeaningCandidates, resetSimilarMeaningCache } from "../../data/similar_meaning_groups";
import { wordDistinctions } from "./word-distinctions";

/**
 * 「音形相近」这一档的体检。
 *
 * 这一档是全部辨析里唯一算出来的（编辑距离），也是唯一会说错原因的：编辑距离对
 * 「假名一模一样」给满分，于是同音异义词、老库里没合并的外来語重复行、纯异写
 * 全被算成最像的那几个，永远霸占前三名 —— 用户看到的就是「インターネット 和
 * インターネット 音形相近」。
 *
 * 所以这里逐条查：出现在音形相近里的词，有没有更准的说法（同音/自他/同词根…），
 * 或者压根就是同一个词的另一行。两样都必须是 0。
 *
 * 默认对种子库抽样跑（跑全库要 30 秒）。查用户真实库：
 *   AUDIT_DB=../../../.local/live.db AUDIT_FULL=1 AUDIT_OUT=/tmp/audit.txt \
 *     npx vitest run src/lib/models/confusion-audit.test.ts
 */
const DB_PATH = process.env.AUDIT_DB ?? "../../../public/nihongo.db";
const STEP = process.env.AUDIT_FULL ? 1 : 10;

const firstSense = (text: string) => text.split(/[；;，,、]/)[0].trim();

describe("音形相近这一档的体检", () => {
  const rows: DbRow[] = [];

  beforeAll(async () => {
    const SQL = await initSqlJs();
    const path = fileURLToPath(new URL(DB_PATH, import.meta.url));
    expect(existsSync(path), `没有 ${path}`).toBe(true);
    testDb = new SQL.Database(new Uint8Array(readFileSync(path)));
    resetConfusionCache();
    resetConfusionGroups();
    resetSimilarMeaningCache();
    const stmt = testDb.prepare("SELECT id, kanji, kana, meaning, pos, verb_type, importance FROM words");
    while (stmt.step()) rows.push(stmt.getAsObject() as DbRow);
    stmt.free();
  });

  it("音形相近里不该有「其实有更准的说法」的词", () => {
    const buckets = new Map<string, string[]>();
    let cards = 0;
    let pairs = 0;

    rows.forEach((row, index) => {
      if (index % STEP) return;
      const card = {
        id: Number(row.id),
        kanji: String(row.kanji ?? ""),
        kana: String(row.kana ?? ""),
        meaning: String(row.meaning ?? ""),
        confusions: confusionCandidates(row),
        similarMeaning: similarMeaningCandidates(row)
      } as WordCard;

      const sections = wordDistinctions(card);
      const sound = sections.find((section) => section.key.startsWith("sound:"));
      if (!sound) return;
      cards += 1;

      // 同一张卡的其它 section 里已经出现过的词
      const elsewhere = new Map<number, string>();
      sections.filter((section) => section !== sound).forEach((section) => {
        section.members.forEach((member) => elsewhere.set(member.id, section.name));
      });

      sound.members.filter((member) => !member.isCurrent).forEach((member) => {
        pairs += 1;
        const label = `${card.kanji || card.kana}(${card.kana}｜${firstSense(card.meaning)})`
          + ` ↔ ${member.word}(${member.kana}｜${firstSense(member.meaning)})`;
        const bucket = member.kana === card.kana
          ? "假名完全相同 —— 那不是形近，是同音（或者干脆是同一个词的另一行）"
          : elsewhere.has(member.id)
            ? `同一张卡的「${elsewhere.get(member.id)}」里已经说过`
            : "真·音形相近";
        const list = buckets.get(bucket) ?? [];
        list.push(label);
        buckets.set(bucket, list);
      });
    });

    if (process.env.AUDIT_OUT) {
      const out = [`词条 ${rows.length}（每 ${STEP} 个取 1）· 出音形相近的卡 ${cards} · 词对 ${pairs}`, ""];
      [...buckets.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([name, list]) => {
        out.push(`${String(list.length).padStart(6)}  ${(list.length / pairs * 100).toFixed(1).padStart(5)}%  ${name}`);
        list.slice(0, 5).forEach((label) => out.push(`                       · ${label}`));
      });
      writeFileSync(process.env.AUDIT_OUT, out.join("\n"));
    }

    expect(pairs).toBeGreaterThan(100);
    [...buckets.keys()].filter((name) => name !== "真·音形相近").forEach((name) => {
      expect(`${name}: ${buckets.get(name)!.slice(0, 5).join(" / ")}`).toBe("");
    });
  }, 900_000);
});
