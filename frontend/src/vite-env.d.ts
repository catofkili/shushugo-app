/// <reference types="vite/client" />

// 构建时由 vite.config.ts 的 define 注入(取 package.json 的 version)
declare const __APP_VERSION__: string;
// 实验功能「开口练习」的编译期开关，见 vite.config.ts 和 docs/DAILY_TALK_SPEC.md §0
declare const __EXP_TALK__: boolean;
