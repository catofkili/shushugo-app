import { describe, expect, it } from "vitest";
import { SYNCED_TABLES, STUDY_TIME_TABLE } from "./tables";
import {
  USER_DATA_TABLES,
  STATE_TABLES,
  SYNC_INFRA_TABLES,
  FACTORY_CONTENT_TABLES,
  unregisteredTables
} from "../../../scripts/user-data-tables.mjs";

/**
 * 出厂词库泄漏守卫的清单，必须覆盖每一张同步表。
 *
 * 这条测试是替一整类静默事故立的：那份清单原来在**五个**构建脚本里各抄一份，
 * 于是它们互相之间就已经对不上（有的漏 word_question_meanings、有的漏
 * dictionary_discovered_words），而五份**全都**漏掉了 achievements、
 * content_favorites、reverse_memory、kanji_reading_memory、moments、
 * grammar_highlights 等 16 张同步表 —— 成就、收藏、反向记忆、汉字读音记忆
 * 从来就不在这道防线里。
 *
 * 「同步的」和「属于用户的」是同一件事：一张表要跨设备跟着人走，它就装着用户数据，
 * 就不能跟着出厂词库发出去。所以清单只要不是 SYNCED_TABLES 的超集，这里就红。
 */
describe("出厂词库泄漏守卫", () => {
  const guarded = new Set<string>([...USER_DATA_TABLES, ...STATE_TABLES, ...SYNC_INFRA_TABLES]);

  it("覆盖每一张同步表", () => {
    const missing = SYNCED_TABLES.map((entry) => entry.table).filter((table) => !guarded.has(table));
    expect(missing).toEqual([]);
  });

  it("覆盖按设备分表的学习时长", () => {
    expect(guarded.has(STUDY_TIME_TABLE)).toBe(true);
  });

  it("清单里没有重复项", () => {
    const all = [...USER_DATA_TABLES, ...STATE_TABLES, ...SYNC_INFRA_TABLES, ...FACTORY_CONTENT_TABLES];
    expect(all.length).toBe(new Set(all).size);
  });

  // ⚠️ 「守卫 ⊇ 同步表」漏得掉同步机制自己的表:`sync_tombstones` 活库里有 4,741 行
  // 删除记录(带 word_id)、`sync_device` 有设备标识,它们都不在 SYNCED_TABLES 里。
  it("同步基础设施表也在守卫里", () => {
    for (const table of ["sync_device", "sync_tombstones", "sync_context"]) {
      expect(guarded.has(table)).toBe(true);
    }
  });

  // 真正封死这一类的是这条:每张表要么是出厂内容、要么被守卫,没有第三种。
  // verify-release-db.mjs 会拿真实出厂库跑同一个判据,出现没登记的表就拒绝构建。
  it("认不出的表会被判为未登记", () => {
    expect(unregisteredTables(() => ["words", "progress", "sync_tombstones"])).toEqual([]);
    expect(unregisteredTables(() => ["words", "some_future_table"])).toEqual(["some_future_table"]);
  });
});
