# 真实学习数据读取

## ⚠️ 查我的真实学习数据：`cd frontend && npm run db -- <词>`

**每次新开聊天先看这里，不要再去仓库里翻 .db 文件，也别一上来就连真实 Chrome。**

```bash
cd frontend && npm run db -- 食べる      # 单词详情：FSRS 状态 + 最近作答 + 笔记
cd frontend && npm run db -- --status    # 快照多新 + 最近 14 天 + 到期池
cd frontend && npm run db -- --sql "SELECT ..."   # 任意只读 SQL
```

读的是 `frontend/.local/live.db`（gitignore，个人数据不入库）。这份文件由 dev server
写入：`vite.config.ts` 的 `live-db-snapshot` 插件挂了个只收本机的 `POST /__live-snapshot`，
`storage.ts` 每次写盘（以及页面加载时）把整库送过去，节流 20 秒一次。
所以**只要用户的 `npm run dev` 开着、页面打开过，命令行就有当天的数据**。
`--status` 第一行会打印快照写于多久前，先看它再下结论。
⚠️ **快照只从 5173 端口的 dev server 收**（`vite.config.ts`）：Claude 自己起的验证服务器（5199）配合应用内 Browser pane 打开的是空种子库，2026-09-16 曾把真实快照覆盖成出厂库。看真实数据前先 `--status` 看 reviews 数，是 0 就是被盖了，让用户在自己的 Chrome 里刷新一次 5173 页面即可恢复。

快照缺失/太旧时的排查顺序：dev server 是否在跑 → 用户是否打开过页面 → 是不是改了
`vite.config.ts` 后没重启 dev server（插件是启动时装载的）。实在要现场取数再走下面的
Chrome 兜底，且**只取一次、不许反复刷用户的学习标签页**。

### 数据到底存在哪（原理，别忘）

- 用户日常在 **自己的 Chrome** 打开 `http://localhost:5173`（`cd frontend && npm run dev`）背单词。
- 学习记录存在**那个浏览器的 IndexedDB** 里，不在仓库任何文件里：
  - DB 名 `master-nihongo-storage` → store `databases` → key `study-database`
    （改名到收集日时**故意没改这个字符串**——改了就找不到已有的真实数据，见 `storage.ts` 的 `BROWSER_DB_NAME`）
  - 内容是一整份 SQLite blob（约 7.8 MB）
- **仓库里的 .db 都不是实时数据**：
  - `frontend/public/nihongo.db` = 干净种子库（reviews 表为空，有白名单守卫）
  - `记忆数据合并/*.db`、`nihongo-import-*.db` = 历史导出快照，会停在很早的日期
  - Cloudflare D1 只存整库 blob，SQL 查不出学习记录
- **应用内浏览器（Browser pane）里的那份也是空种子**，必须用 `claude-in-chrome` 连到用户真实 Chrome。

### 兜底：直接从真实 Chrome 取数（只读，不动用户会话）

只在快照拿不到时用。在真实 Chrome 的 `localhost:5173` 标签页里执行：

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

