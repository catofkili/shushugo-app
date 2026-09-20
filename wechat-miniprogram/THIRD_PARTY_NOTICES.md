# Third-party notices

本目录随代码包携带三个运行时：

- `src/vendor/sql-wasm.js` 与 `src/assets/sql-wasm.wasm` 来自 sql.js，MIT License。
- `src/vendor/ts-fsrs.umd.js` 来自 ts-fsrs，MIT License。
- `src/vendor/fflate.umd.js` 来自 fflate 0.8.2（<https://github.com/101arrowz/fflate>），MIT License。
  用于同步快照的 gzip 压缩/解压；不在 `frontend/node_modules` 里，许可证正文见上游仓库。

对应上游项目和完整许可文本保留在开发依赖的 `frontend/node_modules/sql.js`、
`frontend/node_modules/ts-fsrs` 中；发布包应一并保留本说明。
