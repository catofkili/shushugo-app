import { defineConfig, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "./package.json";

// 真实学习数据只活在浏览器的 IndexedDB 里,命令行/Claude 谁都摸不到。
// dev server 开一个只收本机请求的收件口:App 每次写盘顺手把整库 POST 过来,
// 落成 .local/live.db(已 gitignore),之后 `npm run db -- 単語` 直接读文件。
// apply: "serve" ⇒ 只存在于 vite dev,生产构建里没有这段。
const LIVE_SNAPSHOT_ENDPOINT = "/__live-snapshot";
const LIVE_SNAPSHOT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".local/live.db");

const isLoopback = (address?: string | null) =>
  !address || address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";

const liveSnapshotPlugin = () => ({
  name: "live-db-snapshot",
  apply: "serve" as const,
  configureServer(server: ViteDevServer) {
    server.middlewares.use(LIVE_SNAPSHOT_ENDPOINT, (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }
      // 即便有人 `vite --host`,也只收本机的:这是完整的个人学习库。
      if (!isLoopback(req.socket.remoteAddress)) {
        res.statusCode = 403;
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const body = Buffer.concat(chunks);
          // 认 SQLite 文件头,挡住半截/空 body 覆盖掉上一份好快照。
          if (body.length < 4096 || body.subarray(0, 15).toString("latin1") !== "SQLite format 3") {
            res.statusCode = 422;
            res.end();
            return;
          }
          mkdirSync(dirname(LIVE_SNAPSHOT_FILE), { recursive: true });
          // 先写 tmp 再 rename:读快照的脚本永远看到完整文件。
          writeFileSync(`${LIVE_SNAPSHOT_FILE}.tmp`, body);
          renameSync(`${LIVE_SNAPSHOT_FILE}.tmp`, LIVE_SNAPSHOT_FILE);
          res.statusCode = 204;
          res.end();
        } catch (error) {
          server.config.logger.warn(`[live-db-snapshot] 写快照失败: ${String(error)}`);
          res.statusCode = 500;
          res.end();
        }
      });
    });
  },
});

// sql-wasm.wasm 由 database.ts 的 `?url` import 交给 Vite 打包(带内容哈希),
// 不需要再静态拷贝一份到 assets/node_modules/。
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    liveSnapshotPlugin(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    // ⚠️ **最低支持系统是 iOS 16.4,三处必须一起说同一个数**:这里、
    // ios/App/Podfile 的 platform、Xcode 的 IPHONEOS_DEPLOYMENT_TARGET。
    // 不写这一行的话 Vite 7 默认按 baseline(Safari 16)编译,而工程当时写着
    // 允许 iOS 15 —— 那种设备连 JS 都解析不了,却仍然装得上。
    // 16.4 而不是 16.0 是因为云备份的 gzip 解压直接用 DecompressionStream
    // (Compression Streams,Safari/iOS 16.4 才有):低于它的设备本地能学,
    // 但恢复不了云备份,而那正是换设备时唯一要它工作的一刻。
    target: "safari16.4",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          sqljs: ["sql.js"],
        },
      },
    },
  },
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
    // 生产构建剥离 console.log/debug(保留 warn/error 供排障);dev 不受影响。
    ...(command === "build" ? { pure: ["console.log", "console.debug"] } : {})
  },
  server: {
    port: 5173,
    // 端口固定:被占用时直接报错,绝不"漂移"到 5174/5175…。端口一变,浏览器
    // 的 IndexedDB(按端口隔离)就换成空库,会导致学习进度看起来"丢失/重来"。
    strictPort: true,
  },
}));
