/*
 * 小程序共享层的入口：这里列出的每个模块都**原样**来自 frontend/src/lib，
 * 由 scripts/build-shared.mjs 用 esbuild 打成 src/shared/web.js。
 *
 * 规则（用户 2026-09-22 定的）：除了微信自己的机制（登录 / 虚拟支付 / 消息推送）和组队，
 * 小程序的一切逻辑都用网页那份。所以这里收的是整个数据层：建表 + 同步触发器（study-core）、
 * 单词 / 语法 / 混合学习的调度与作答（word-api、grammar-quiz、card-log 一族）、云同步的导出与合并
 * （sync/*）、词库、辨析、收藏、成就、柚子、周报、词汇量、备考、偏好。页面（WXML）仍是手写。
 *
 * 需要平台能力的地方在 shims/ 里替换（库句柄、落盘、权益、正字法数据、出厂内容数据），
 * 见 build-shared.mjs 的 SHIMS 表。
 */
export * as database from "../../../frontend/src/lib/database";
export * as studyCore from "../../../frontend/src/lib/study-core";
export * as dbUtils from "../../../frontend/src/lib/database/db-utils";
export * as wordApi from "../../../frontend/src/lib/word-api";
export * as wordCard from "../../../frontend/src/lib/models/word-card";
export * as wordDistinctions from "../../../frontend/src/lib/models/word-distinctions";
export * as questionMeaningIndex from "../../../frontend/src/lib/models/question-meaning-index";
export * as userQuestionMeanings from "../../../frontend/src/lib/models/user-question-meanings";
export * as studyMode from "../../../frontend/src/lib/studyMode";
export * as fsrsStore from "../../../frontend/src/lib/fsrs-store";
export * as fsrsScheduler from "../../../frontend/src/lib/fsrs-scheduler";
export * as dailyPlan from "../../../frontend/src/lib/daily-plan";
export * as studyLoad from "../../../frontend/src/lib/study-load";
export * as wordLibrary from "../../../frontend/src/lib/word-library";
export * as confusionGroups from "../../../frontend/src/lib/confusion-groups";
export * as distinctionQuiz from "../../../frontend/src/lib/distinction-quiz";
export * as confusionCards from "../../../frontend/src/lib/confusion-cards";
export * as kanjiCharCards from "../../../frontend/src/lib/kanji-char-cards";
export * as kanjiUnitScheduler from "../../../frontend/src/lib/kanji-unit-scheduler";
export * as kanjiUnitIndex from "../../../frontend/src/lib/kanji-unit-index";
export * as grammarQuiz from "../../../frontend/src/lib/grammar-quiz";
export * as grammarApi from "../../../frontend/src/lib/grammar-api";
export * as grammarKeyPoints from "../../../frontend/src/lib/grammar-key-points";
export * as grammarFormation from "../../../frontend/src/lib/grammar-formation";
export * as furigana from "../../../frontend/src/lib/furigana-data";
export * as duplicateMerge from "../../../frontend/src/lib/duplicate-merge";
export * as syncSchema from "../../../frontend/src/lib/sync/schema";
export * as syncSnapshot from "../../../frontend/src/lib/sync/snapshot";
export * as syncMerge from "../../../frontend/src/lib/sync/merge";
export * as syncTables from "../../../frontend/src/lib/sync/tables";
export * as vocabTest from "../../../frontend/src/lib/vocab-test";
export * as yuzu from "../../../frontend/src/lib/yuzu";
export * as yuzuCatalog from "../../../frontend/src/lib/yuzu-catalog";
export * as favorites from "../../../frontend/src/lib/favorites-api";
export * as weekly from "../../../frontend/src/lib/analytics/weekly";
export * as weeklyReports from "../../../frontend/src/lib/analytics/weekly-reports";
export * as analytics from "../../../frontend/src/lib/analytics/stats";
export * as jlptPlan from "../../../frontend/src/lib/jlpt/plan";
export * as jlptStatus from "../../../frontend/src/lib/jlpt/status";
export * as examDates from "../../../frontend/src/lib/jlpt/exam-dates";
export * as preferences from "../../../frontend/src/lib/studyPreferences";
export * as achievements from "../../../frontend/src/lib/achievements/index";
export * as streak from "../../../frontend/src/lib/zoo-streak";
export * as reviewBudget from "../../../frontend/src/lib/review-budget";
export * as studyTotals from "../../../frontend/src/lib/study-totals";
