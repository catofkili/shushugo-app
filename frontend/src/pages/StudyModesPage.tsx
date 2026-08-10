import { BookOpenText, Brain, CheckCircle2, Layers3, LetterText, Repeat2 } from "lucide-react";
import { defaultStudyMode, saveStudyMode, STUDY_MODES } from "../lib/studyMode";
import type { StudyMode } from "../types/app";

interface StudyModesPageProps {
  selectedMode: StudyMode;
  onModeChange: (mode: StudyMode) => void;
  onStart: (mode: StudyMode) => void;
}

// 模式的文案在 lib/studyMode 里统一维护(首页的切换器读的是同一份),
// 这里只补一个图标映射 —— 图标是这一页独有的,不值得让 lib 去依赖 lucide。
const MODE_ICONS: Record<StudyMode, typeof Layers3> = {
  classic: Layers3,
  mistakes: Brain,
  quick: BookOpenText,
  reverse: Repeat2,
  kanji: LetterText
};

export function StudyModesPage({ selectedMode, onModeChange, onStart }: StudyModesPageProps) {
  const currentMode = selectedMode || defaultStudyMode;

  const chooseMode = (mode: StudyMode) => {
    onModeChange(saveStudyMode(mode));
  };

  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/55">Study Modes</p>
        <h1 className="mt-1 text-2xl font-semibold">学习模式</h1>
        <p className="mt-2 text-sm leading-6 text-white/58">
          五种方式平级，想练哪种自己挑；当天任务学完后自动进入错题本，凌晨 4 点刷新时恢复原模式。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {STUDY_MODES.map((item) => {
          const Icon = MODE_ICONS[item.id];
          const active = currentMode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => chooseMode(item.id)}
              className={`focus-ring rounded-2xl border p-4 text-left transition ${
                active
                  ? "border-[#81D8CF]/65 bg-[#81D8CF]/18 shadow-[0_0_0_3px_rgba(145,201,104,0.14)]"
                  : "border-white/15 bg-[#464949] hover:bg-[#4d5151]"
              }`}
              aria-pressed={active}
            >
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#81D8CF]/16 text-[#81D8CF]">
                  <Icon size={24} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-lg font-bold text-white">{item.title}</span>
                    {active && <CheckCircle2 size={18} className="shrink-0 text-[#81D8CF]" />}
                  </span>
                  <span className="mt-1 block text-xs font-bold text-[#81D8CF]">{item.subtitle}</span>
                  <span className="mt-2 block text-sm leading-6 text-white/58">{item.description}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <button
        onClick={() => onStart(currentMode)}
        className="focus-ring mt-5 flex h-14 w-full items-center justify-center rounded-2xl bg-[#81D8CF] px-4 text-base font-black !text-[#343838]"
      >
        开始学习
      </button>
    </section>
  );
}
