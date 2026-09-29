import {
  Angry, Award, Bird, Boxes, Brain, CalendarCheck, CalendarDays, CalendarPlus, Cake, Castle, CloudFog, EyeOff, Flame,
  Footprints, Ghost, GraduationCap, Hash, History, Hourglass, Landmark, Languages, MousePointerClick, Moon, MoonStar,
  Mountain, NotebookPen, PartyPopper, Repeat, Repeat2, RotateCcw, Scissors, ScrollText, Search, Snowflake, Sprout, Star,
  StickyNote, SunMoon, Sword, Swords, Target, ThermometerSnowflake, Timer, TreePalm, TrendingUp, Undo2, Zap,
  type LucideIcon
} from "lucide-react";

/**
 * 成就图标。按 id 查，不放进 catalog：catalog 是纯数据，会被打进原生小程序的共享包，
 * 那边不能出现 lucide-react。⚠️ 只给成就页用 —— Taro 的 lucide 是按路由预生成的 SVG，
 * 主包离 1.9 MB 上限没剩多少，弹窗那种全局组件用这张表会把 47 个图标拖进主包。
 */
export const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  "first-know": Sprout,
  "first-note": NotebookPen,
  "first-confusion": Search,
  "first-kanji": Languages,
  "first-reverse": Repeat,
  "words-100": Sword,
  "words-1000": Swords,
  "words-3000": Castle,
  "reviews-10000": Hash,
  "reviews-50000": Mountain,
  "mastered-10": GraduationCap,
  "mastered-100": TreePalm,
  "hours-100": Hourglass,
  "one-year": Cake,
  "streak-7": CalendarDays,
  "streak-30": CalendarCheck,
  "streak-100": Award,
  "five-minutes": Timer,
  "comeback-7": Undo2,
  "comeback-30": History,
  "day-1000": Flame,
  marathon: Footprints,
  "know-streak-25": TrendingUp,
  "know-streak-50": Zap,
  "accuracy-90": Target,
  "known-forever-20": Scissors,
  "forgot-streak-10": Snowflake,
  "forgot-streak-20": ThermometerSnowflake,
  "leech-1": Angry,
  "leech-100": ScrollText,
  "relapse-forever": RotateCcw,
  "fuzzy-half": CloudFog,
  "thrice-a-day": Repeat2,
  "backlog-500": EyeOff,
  "backlog-1000": Landmark,
  ghosted: Ghost,
  "night-100": Moon,
  "night-1000": MoonStar,
  "early-50": Bird,
  "day-and-night": SunMoon,
  burst: MousePointerClick,
  "new-year": PartyPopper,
  "leap-day": CalendarPlus,
  "notes-50": StickyNote,
  "confusion-100": Brain,
  "favorites-50": Star,
  "all-three": Boxes
};
