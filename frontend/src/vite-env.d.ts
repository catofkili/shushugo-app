/// <reference types="vite/client" />

// 构建时由 vite.config.ts 的 define 注入(取 package.json 的 version)
declare const __APP_VERSION__: string;
// 单词拼写实验开关，见 docs/SPELLING_SPEC.md §7
declare const __EXP_SPELLING__: boolean;
declare const __EXP_JLPT__: boolean;
