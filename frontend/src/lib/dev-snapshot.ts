/**
 * 把整库镜像给 vite dev server(见 vite.config.ts 的 live-db-snapshot 插件)。
 *
 * 学习记录只存在于浏览器的 IndexedDB,命令行读不到,于是每次问「某个词我现在什么状态」
 * 都要去真实 Chrome 里现场取数。这里让 App 自己把库送出来,落成 frontend/.local/live.db,
 * 命令行/Claude 直接 sqlite3 读文件即可。
 *
 * 只在 `npm run dev` 下生效:调用点包在 `import.meta.env.DEV` 里,生产构建整段被摇掉;
 * 原生(iOS)走 Filesystem 分支,根本不经过这里。
 */

const ENDPOINT = "/__live-snapshot";

// 答题时 saveDatabase 大约每 2 秒一次,整库 ~8MB。快照是给人看的,不需要那么新,
// 节流到 20 秒,避免把磁盘写成流水账。
const MIN_INTERVAL_MS = 20_000;

let lastSentAt = 0;
let inFlight = false;

export async function mirrorLiveSnapshot(
  data: Uint8Array,
  options: { force?: boolean } = {}
): Promise<void> {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  if (import.meta.env.MODE === "test") return;

  const now = Date.now();
  if (inFlight) return;
  if (!options.force && now - lastSentAt < MIN_INTERVAL_MS) return;

  inFlight = true;
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: data.slice().buffer,
    });
    lastSentAt = Date.now();
  } catch {
    // 镜像失败不影响学习,静默即可(比如没跑 dev server、或者页面是 preview 产物)。
  } finally {
    inFlight = false;
  }
}
