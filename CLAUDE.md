# Master Nihongo — Claude 工作须知

## ⚠️ 我的真实学习数据在哪：http://localhost:5173

**每次新开聊天先看这里，不要再去仓库里翻 .db 文件。**

- 用户日常在 **自己的 Chrome** 打开 `http://localhost:5173`（`cd frontend && npm run dev`）背单词。
- 学习记录存在**那个浏览器的 IndexedDB** 里，不在仓库任何文件里：
  - DB 名 `master-nihongo-storage` → store `databases` → key `study-database`
  - 内容是一整份 SQLite blob（约 7.8 MB）
- **仓库里的 .db 都不是实时数据**：
  - `frontend/public/nihongo.db` = 干净种子库（reviews 表为空，有白名单守卫）
  - `记忆数据合并/*.db`、`nihongo-import-*.db` = 历史导出快照，会停在很早的日期
  - Cloudflare D1 只存整库 blob，SQL 查不出学习记录
- **应用内浏览器（Browser pane）里的那份也是空种子**，必须用 `claude-in-chrome` 连到用户真实 Chrome。

### 查实时数据的方法（只读，不动用户会话）

在真实 Chrome 的 `localhost:5173` 标签页里执行：

```js
const mod = await import("/node_modules/.vite/deps/sql__js.js");   // 版本号 ?v= 可从 curl localhost:5173/src/lib/database.ts 取
const initSqlJs = mod.default.__esModule ? mod.default.default : mod.default;
const SQL = await initSqlJs({ locateFile: () => "/node_modules/sql.js/dist/sql-wasm.wasm" });
const bytes = await new Promise((res) => {
  const r = indexedDB.open('master-nihongo-storage', 1);
  r.onsuccess = () => {
    const g = r.result.transaction('databases', 'readonly').objectStore('databases').get('study-database');
    g.onsuccess = () => res(new Uint8Array(g.result));
  };
});
const db = new SQL.Database(bytes);   // 独立副本，不碰应用自己的实例
db.exec("SELECT reviewed_on, COUNT(DISTINCT word_id) FROM reviews GROUP BY reviewed_on ORDER BY reviewed_on DESC LIMIT 14");
```

注意：IndexedDB 里是**上次保存的快照**，当天的量可能还没落盘。

## 仓库速记

- 主应用：`frontend/`（React 19 + TS + Vite + Tailwind，SQLite 走 sql.js/WASM，Capacitor 打 iOS）
- 云同步：`cloudflare-sync/`（Worker + D1 + KV，目前是整库覆盖）

## 复习算法：只有 FSRS（2026-08-01 起）

**单词、汉字、语法三个阶段统一由 `ts-fsrs`（Anki 同款 FSRS）调度。自研的 score / 连胜梯子 / 回归模式已整体删除，别再往回加分数。**

- `fsrs-scheduler.ts` — 算法本体（与实体无关）：评分映射、学习步骤、leech 阈值、`isMastered`
- `fsrs-store.ts` — 状态持久化，泛化成可挂任意表：`WORD_FSRS`(progress) / `KANJI_FSRS`(kanji_memory) / `GRAMMAR_FSRS`(grammar_progress)
- `word-api/stage1.ts` — 当日任务表生成；`scheduler/priority.ts` — 出题优先级
- `review-budget.ts` — 每日复习上限、续杯批量、疲劳检测

口径速查：

| 概念 | 判据 |
|---|---|
| 到期 / 薄弱 | `fsrs_due <= studyDayEnd()` |
| 顽固词 | `fsrs_lapses >= 8` |
| 已掌握 | 间隔（`fsrs_due − fsrs_last_review`）≥ 180 天 |
| 当天是否再出 | 是否毕业（下次到期越过本学习日边界） |

**保留的不是分数**：stage2/汉字的 `temp_score`、`mistake_streak` 是会话内计数器（这一轮过没过、要不要贴脸重复），`sessionScoreDelta` 只服务它们。`progress.score`、`low_history`、`mastered_on`、`reviews.score_after` 是遗留列，**不再读写**。

坑：SQL 模板字符串里注释用 `--` 不能用 `//`；`ensureFsrsColumns` 按 (db, 表名) 记忆化，测试里 DROP/CREATE 同名表要自带 `fsrs_*` 列。
