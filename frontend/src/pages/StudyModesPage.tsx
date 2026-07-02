import { BookOpenText, CheckCircle2, Layers3, LetterText, Repeat2 } from "lucide-react";
import { defaultStudyMode, saveStudyMode } from "../lib/studyMode";
import type { StudyMode } from "../types/app";

interface StudyModesPageProps {
  selectedMode: StudyMode;
  onModeChange: (mode: StudyMode) => void;
  onStart: (mode: StudyMode) => void;
}

const modes: {
  id: StudyMode;
  title: string;
  subtitle: string;
  description: string;
  icon: typeof Layers3;
}[] = [
  {
    id: "classic",
    title: "经典模式",
    subtitle: "默认",
    description: "按每日计划自动衔接词汇、反向和汉字阶段。",
    icon: Layers3
  },
  {
    id: "vocabulary",
    title: "词汇学习",
    subtitle: "释义 → 日语",
    description: "看中文释义，回忆假名、汉字和词性。",
    icon: BookOpenText
  },
  {
    id: "reverse",
    title: "反向学习",
    subtitle: "日语 → 释义",
    description: "出日语，回忆中文释义。需要当天已有反向队列。",
    icon: Repeat2
  },
  {
    id: "kanji",
    title: "汉字学习",
    subtitle: "释义 → 汉字",
    description: "生成今日汉字队列后，专门回忆和式汉字。",
    icon: LetterText
  }
];

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
        <p className="mt-2 text-sm leading-6 text-white/58">请选择一个学习模式。这里是单选，默认经典模式，不会出现空选。</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {modes.map((item) => {
          const Icon = item.icon;
          const active = currentMode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => chooseMode(item.id)}
              className={`focus-ring rounded-2xl border p-4 text-left transition ${
                active
                  ? "border-[#81D8CF]/65 bg-[#81D8CF]/18 shadow-[0_0_0_3px_rgba(129,216,207,0.14)]"
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
