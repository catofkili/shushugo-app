import type { ComponentType } from "react";
import { lazyPage } from "./lazy-page";
import type { Page } from "../types/app";
import { HomeRoute } from "./home";

// 仅网页 App 使用此索引；Taro 各页直接 import 单个 route，继续由自己的分包接管。
export const ROUTES = {
  home: HomeRoute,
  word: lazyPage(() => import("./word").then((module) => ({ default: module.WordRoute }))),
  team: lazyPage(() => import("./team").then(async (module) => { await module.preload(); return ({ default: module.TeamRoute }); })),
  invite: lazyPage(() => import("./invite").then(async (module) => { await module.preload(); return ({ default: module.InviteRoute }); })),
  duel: lazyPage(() => import("./duel").then(async (module) => { await module.preload(); return ({ default: module.DuelRoute }); })),
  "quick-study": lazyPage(() => import("./quick-study").then(async (module) => { await module.preload(); return ({ default: module.QuickStudyRoute }); })),
  "vocab-test": lazyPage(() => import("./vocab-test").then(async (module) => { await module.preload(); return ({ default: module.VocabTestRoute }); })),
  talk: lazyPage(() => import("./talk").then(async (module) => { await module.preload(); return ({ default: module.TalkRoute }); })),
  "jlpt-practice": lazyPage(() => import("./jlpt-practice").then(async (module) => { await module.preload(); return ({ default: module.JlptPracticeRoute }); })),
  "weekly-report": lazyPage(() => import("./weekly-report").then(async (module) => { await module.preload(); return ({ default: module.WeeklyReportRoute }); })),
  grammar: lazyPage(() => import("./grammar").then(async (module) => { await module.preload(); return ({ default: module.GrammarRoute }); })),
  "grammar-foundation": lazyPage(() => import("./grammar-foundation").then(async (module) => { await module.preload(); return ({ default: module.GrammarFoundationRoute }); })),
  detail: lazyPage(() => import("./detail").then(async (module) => { await module.preload(); return ({ default: module.DetailRoute }); })),
  profile: lazyPage(() => import("./profile").then(async (module) => { await module.preload(); return ({ default: module.ProfileRoute }); })),
  pro: lazyPage(() => import("./pro").then(async (module) => { await module.preload(); return ({ default: module.ProRoute }); })),
  "yuzu-shop": lazyPage(() => import("./yuzu-shop").then((module) => ({ default: module.YuzuShopRoute }))),
  favorites: lazyPage(() => import("./favorites").then(async (module) => { await module.preload(); return ({ default: module.FavoritesRoute }); })),
  "word-list": lazyPage(() => import("./word-list").then(async (module) => { await module.preload(); return ({ default: module.WordListRoute }); })),
  "kanji-readings": lazyPage(() => import("./kanji-readings").then(async (module) => { await module.preload(); return ({ default: module.KanjiReadingsRoute }); })),
  confusion: lazyPage(() => import("./confusion").then(async (module) => { await module.preload(); return ({ default: module.ConfusionRoute }); })),
  "distinction-quiz": lazyPage(() => import("./distinction-quiz").then(async (module) => { await module.preload(); return ({ default: module.DistinctionQuizRoute }); })),
  "jlpt-plan": lazyPage(() => import("./jlpt-plan").then(async (module) => { await module.preload(); return ({ default: module.JlptPlanRoute }); })),
  account: lazyPage(() => import("./account").then(async (module) => { await module.preload(); return ({ default: module.AccountRoute }); })),
  "personal-info": lazyPage(() => import("./personal-info").then(async (module) => { await module.preload(); return ({ default: module.PersonalInfoRoute }); })),
  notifications: lazyPage(() => import("./notifications").then(async (module) => { await module.preload(); return ({ default: module.NotificationsRoute }); })),
  settings: lazyPage(() => import("./settings").then(async (module) => { await module.preload(); return ({ default: module.SettingsRoute }); })),
  privacy: lazyPage(() => import("./privacy").then(async (module) => { await module.preload(); return ({ default: module.PrivacyRoute }); })),
  "privacy-policy": lazyPage(() => import("./privacy-policy").then(async (module) => { await module.preload(); return ({ default: module.PrivacyPolicyRoute }); })),
  "user-agreement": lazyPage(() => import("./user-agreement").then(async (module) => { await module.preload(); return ({ default: module.UserAgreementRoute }); })),
  help: lazyPage(() => import("./help").then(async (module) => { await module.preload(); return ({ default: module.HelpRoute }); })),
  achievements: lazyPage(() => import("./achievements").then((module) => ({ default: module.AchievementsRoute }))),
  streak: lazyPage(() => import("./streak").then((module) => ({ default: module.StreakRoute }))),
  about: lazyPage(() => import("./about").then(async (module) => { await module.preload(); return ({ default: module.AboutRoute }); })),
} satisfies Record<Page, ComponentType>;

export async function prefetchRoute(page: Page) {
  if (page !== "home") await ROUTES[page].preload().catch(() => undefined);
}

export function prefetchHomeRoutes() {
  // 只预热首页主入口，其他页面等点击；不在 idle 把整个应用下载一遍。
  const queue: Page[] = ["word", "grammar", "quick-study", "profile"];
  let active = true;
  let frame = 0;
  let idle = 0;
  const schedule = () => {
    if (!active || !queue.length) return;
    idle = typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(next)
      : window.setTimeout(next, 200);
  };
  const next = () => {
    if (!active) return;
    const page = queue.shift();
    if (page) void prefetchRoute(page).then(schedule);
  };
  // 先让首页真正画出一帧，再逐个空闲片段预取，离开首页就停止后续任务。
  frame = window.requestAnimationFrame(() => {
    frame = window.requestAnimationFrame(schedule);
  });
  return () => {
    active = false;
    window.cancelAnimationFrame(frame);
    if (typeof window.requestIdleCallback === "function") window.cancelIdleCallback(idle);
    else window.clearTimeout(idle);
  };
}
