import { CheckCircle2, Layers3, Star } from "lucide-react";
import { CheckInCalendar } from "../components/CheckInCalendar";
import { ProgressOverviewPanel } from "../components/ProgressOverviewPanel";
import { ProgressOverview } from "../lib/api";
import { Page } from "../types/app";

interface ToolboxPageProps {
  overview: ProgressOverview;
  onNavigate: (page: Page) => void;
  onOpenFill: () => void;
  onRefreshOverview: () => void;
  onCompleteTodayWords: () => void;
}

const toolItems = [
  { page: "study-modes" as Page, title: "学习模式", description: "选择经典、词汇、反向或汉字学习", icon: Layers3 },
  { page: "favorites" as Page, title: "收藏", description: "单词和语法的收藏夹", icon: Star }
];

export function ToolboxPage({
  overview,
  onNavigate,
  onOpenFill,
  onRefreshOverview,
  onCompleteTodayWords
}: ToolboxPageProps) {
  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/55">Tools</p>
        <h1 className="mt-1 text-2xl font-semibold">工具箱</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {toolItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.page}
              onClick={() => onNavigate(item.page)}
              className="focus-ring flex items-center gap-4 rounded-2xl border border-white/15 bg-[#464949] p-4 text-left hover:bg-[#4d5151]"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#81D8CF]/16 text-[#81D8CF]">
                <Icon size={25} />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-bold text-white">{item.title}</span>
                <span className="mt-1 block text-sm text-white/58">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <button
        onClick={onCompleteTodayWords}
        className="focus-ring mt-3 flex w-full items-center gap-4 rounded-2xl border border-[#81D8CF]/30 bg-[#81D8CF]/12 p-4 text-left hover:bg-[#81D8CF]/18"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#81D8CF]/35 bg-[#81D8CF]/18 text-[#81D8CF]">
          <CheckCircle2 size={25} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold text-white">一键完成今日单词</span>
          <span className="mt-1 block text-sm text-white/58">把当天单词计划标记完成并进入今日完成页</span>
        </span>
      </button>

      <ProgressOverviewPanel
        overview={overview}
        onRefresh={onRefreshOverview}
        onOpenFill={onOpenFill}
      />

      <div className="mt-5">
        <CheckInCalendar />
      </div>
    </section>
  );
}
