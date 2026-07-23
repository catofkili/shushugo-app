import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

// sql-wasm.wasm 由 database.ts 的 `?url` import 交给 Vite 打包(带内容哈希),
// 不需要再静态拷贝一份到 assets/node_modules/。
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
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
