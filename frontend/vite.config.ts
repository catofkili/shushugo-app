import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/sql.js/dist/sql-wasm.wasm",
          dest: "assets",
        },
      ],
    }),
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
