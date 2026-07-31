import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 隔离原型:root=zoo-lab,复用上层 frontend/node_modules,独立端口 5273。
// 与正式 app(5173)完全隔离,不共享模块图、不共享 IndexedDB origin,
// 因此你在 5173 的学习会话不受影响。
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5273,
    strictPort: true,
  },
});
