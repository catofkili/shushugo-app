import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// sql-wasm.wasm 由 database.ts 的 `?url` import 交给 Vite 打包(带内容哈希),
// 不需要再静态拷贝一份到 assets/node_modules/。
export default defineConfig({
  plugins: [
    react(),
  ],
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
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  },
  server: {
    port: 5173,
  },
});
