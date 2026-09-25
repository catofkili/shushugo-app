import type { ComponentType } from "react";
import type { Page } from "../types/app";
import { AboutRoute } from "./about";
import { AccountRoute } from "./account";
import { AchievementsRoute } from "./achievements";
import { ConfusionRoute } from "./confusion";
import { DetailRoute } from "./detail";
import { DistinctionQuizRoute } from "./distinction-quiz";
import { FavoritesRoute } from "./favorites";
import { GrammarFoundationRoute } from "./grammar-foundation";
import { GrammarRoute } from "./grammar";
import { HelpRoute } from "./help";
import { HomeRoute } from "./home";
import { JlptPlanRoute } from "./jlpt-plan";
import { KanjiReadingsRoute } from "./kanji-readings";
import { NotificationsRoute } from "./notifications";
import { PersonalInfoRoute } from "./personal-info";
import { PrivacyPolicyRoute } from "./privacy-policy";
import { PrivacyRoute } from "./privacy";
import { ProfileRoute } from "./profile";
import { ProRoute } from "./pro";
import { QuickStudyRoute } from "./quick-study";
import { SettingsRoute } from "./settings";
import { StudyModesRoute } from "./study-modes";
import { TeamRoute } from "./team";
import { UserAgreementRoute } from "./user-agreement";
import { VocabTestRoute } from "./vocab-test";
import { WeeklyReportRoute } from "./weekly-report";
import { WordListRoute } from "./word-list";
import { WordRoute } from "./word";
import { YuzuShopRoute } from "./yuzu-shop";

export const ROUTES: Record<Page, ComponentType> = {
  home: HomeRoute,
  word: WordRoute,
  team: TeamRoute,
  "quick-study": QuickStudyRoute,
  "vocab-test": VocabTestRoute,
  "weekly-report": WeeklyReportRoute,
  grammar: GrammarRoute,
  "grammar-foundation": GrammarFoundationRoute,
  detail: DetailRoute,
  profile: ProfileRoute,
  pro: ProRoute,
  "yuzu-shop": YuzuShopRoute,
  favorites: FavoritesRoute,
  "word-list": WordListRoute,
  "kanji-readings": KanjiReadingsRoute,
  confusion: ConfusionRoute,
  "distinction-quiz": DistinctionQuizRoute,
  "jlpt-plan": JlptPlanRoute,
  "study-modes": StudyModesRoute,
  account: AccountRoute,
  "personal-info": PersonalInfoRoute,
  notifications: NotificationsRoute,
  settings: SettingsRoute,
  privacy: PrivacyRoute,
  "privacy-policy": PrivacyPolicyRoute,
  "user-agreement": UserAgreementRoute,
  help: HelpRoute,
  achievements: AchievementsRoute,
  about: AboutRoute
};
