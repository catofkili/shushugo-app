import {
  BookOpen,
  Brain,
  CheckCircle2,
  Clock3,
  LibraryBig,
  NotebookPen,
  PencilLine,
  Search
} from "lucide-react";
import { ReactNode } from "react";
import { GrammarTermHint } from "../components/GrammarTermHint";
import { JapaneseRuby } from "../components/JapaneseRuby";
import { grammarPoints } from "../data/grammar";
import { ProgressBar } from "../components/ProgressBar";
import { MasteryStatus } from "../types/grammar";

interface DashboardProps {
  levelProgress: { level: string; done: number; total: number }[];
  getMastery: (id: string) => MasteryStatus;
  onOpenGrammar: (id: string) => void;
  onMarkLearned: (id: string) => void;
  onStartSession: () => void;
}

const sampleWords = [
  { kanji: "安心", kana: "あんしん", meaning: "安心，放心", tag: "名・する" },
  { kanji: "以後", kana: "いご", meaning: "以后，将来", tag: "名" },
  { kanji: "案内", kana: "あんない", meaning: "向导，介绍", tag: "名・する" }
];

export const Dashboard = ({
  levelProgress,
  getMastery,
  onOpenGrammar,
  onMarkLearned,
  onStartSession
}: DashboardProps) => {
  const todaysNew = grammarPoints.filter((point) => getMastery(point.id) === "new").slice(0, 5);
  const featured = todaysNew[0] ?? grammarPoints[0];
  const learnedCount = grammarPoints.filter((point) => getMastery(point.id) !== "new").length;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="dictionary-card rounded-md p-5 lg:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#81D8CF]">
                今日の学習
              </p>
              <h1 className="jp-serif mt-3 text-3xl font-semibold leading-tight text-[#343838] dark:text-[#f4efe4] lg:text-4xl">
                用辞典式节奏复习，而不是刷页面。
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[#f9faf7] dark:text-zinc-300">
                先处理到期复习，再看一条语法和三组例句。每个模块都保留足够信息密度，方便扫读、比较和回到薄弱点。
              </p>
            </div>
            <button
              onClick={onStartSession}
              className="focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-[#343838] bg-[#343838] px-4 py-2.5 text-sm font-bold text-[#fff] hover:bg-[#3c3f3f] dark:border-[#f4efe4] dark:bg-[#f4efe4] dark:text-[#181713]"
            >
              <Clock3 size={17} />
              开始十分钟
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Metric icon={<CheckCircle2 size={17} />} label="已接触语法" value={learnedCount} suffix="个" />
            <Metric icon={<LibraryBig size={17} />} label="语法库" value={grammarPoints.length} suffix="条" />
            <Metric icon={<Brain size={17} />} label="今日练习" value={todaysNew.length} suffix="条" />
          </div>
        </div>

        <div className="dictionary-card rounded-md p-5">
          <div className="flex items-center justify-between gap-3 border-b border-[#81D8CF] pb-3 dark:border-zinc-800">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#81D8CF]">Quick Lookup</p>
              <h2 className="jp mt-1 text-lg font-semibold">辞書検索</h2>
            </div>
            <Search size={18} className="text-[#81D8CF]" />
          </div>
          <div className="mt-4 rounded-md border border-[#81D8CF] bg-[#81D8CF] p-3 dark:border-zinc-800 dark:bg-[#171611]">
            <p className="jp-serif text-4xl font-semibold text-[#343838] dark:text-[#f4efe4]"><JapaneseRuby text={featured.title} /></p>
            <p className="mt-2 text-sm text-[#f9faf7] dark:text-zinc-300">{featured.meaning}</p>
            <p className="jp mt-3 border-l-2 border-[#81D8CF] pl-3 text-sm text-[#f9faf7] dark:text-zinc-200">
              {featured.structure}
            </p>
          </div>
          <button
            onClick={() => onOpenGrammar(featured.id)}
            className="focus-ring mt-4 w-full rounded-md border border-[#81D8CF] px-3 py-2 text-sm font-bold text-[#f9faf7] hover:bg-[#81D8CF] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            打开完整条目
          </button>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-5" title="语法进度" label="Grammar">
          <div className="space-y-4">
            {levelProgress.map((item) => (
              <ProgressBar
                key={item.level}
                label={`${item.level} ${item.done}/${item.total}`}
                value={item.total ? (item.done / item.total) * 100 : 0}
              />
            ))}
          </div>
        </Panel>

        <Panel className="xl:col-span-4" title="今日语法条目" label="Entries">
          <div className="divide-y divide-[#81D8CF] dark:divide-zinc-800">
            {todaysNew.slice(0, 4).map((point) => (
              <button
                key={point.id}
                onClick={() => onOpenGrammar(point.id)}
                className="focus-ring grid w-full grid-cols-[56px_1fr] gap-3 py-3 text-left"
              >
                <span className="jp-serif text-2xl font-semibold text-[#343838] dark:text-[#f4efe4]"><JapaneseRuby text={point.title} /></span>
                <span>
                  <span className="block text-sm font-semibold text-[#f9faf7] dark:text-zinc-100">{point.meaning}</span>
                  <span className="jp mt-1 block text-xs text-[#f9faf7] dark:text-zinc-400">
                    <GrammarTermHint text={point.connection ?? point.structure} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Panel>

      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="词汇复习" label="Vocabulary">
          <div className="divide-y divide-[#81D8CF] dark:divide-zinc-800">
            {sampleWords.map((word) => (
              <div key={word.kanji} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 py-3">
                <div>
                  <p className="jp-serif text-2xl font-semibold">{word.kanji}</p>
                  <p className="jp text-xs text-[#81D8CF]">{word.kana}</p>
                </div>
                <p className="text-sm text-[#f9faf7] dark:text-zinc-200">{word.meaning}</p>
                <span className="rounded-sm border border-[#81D8CF] px-2 py-1 text-xs text-[#f9faf7] dark:border-zinc-700 dark:text-zinc-400">
                  {word.tag}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="阅读练习" label="Reading">
          <div className="grid gap-4 md:grid-cols-[1fr_180px]">
            <div className="rounded-md border border-[#81D8CF] bg-[#81D8CF] p-4 dark:border-zinc-800 dark:bg-[#171611]">
              <p className="jp text-lg leading-9 text-[#343838] dark:text-[#f4efe4]">
                日本語の文法は、例文の中で覚えると少しずつ自然になります。
              </p>
              <p className="mt-3 text-sm leading-7 text-[#f9faf7] dark:text-zinc-300">
                日语语法放在例句里记，会慢慢变得自然。阅读模块以后可以接短文、标注、词汇回收。
              </p>
            </div>
            <div className="flex flex-col justify-between rounded-md bg-[#343838] p-4 text-[#fff]">
              <BookOpen size={18} />
              <div>
                <p className="text-2xl font-semibold">12 分</p>
                <p className="text-xs text-[#81D8CF]">本周阅读时间</p>
              </div>
            </div>
          </div>
        </Panel>
      </section>

      <section className="dictionary-card rounded-md p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#81D8CF]">Study Materials</p>
            <h2 className="jp mt-1 text-lg font-semibold">材料化的学习入口</h2>
          </div>
          <NotebookPen size={18} className="text-[#81D8CF]" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <StudyModule icon={<Brain size={17} />} title="语法训练" text="选择、填空、判断三种题型混合出现。" />
          <StudyModule icon={<PencilLine size={17} />} title="例句拆解" text="突出假名、汉字、助词和结构位置。" />
        </div>
      </section>
    </div>
  );
};

const Metric = ({ icon, label, value, suffix }: { icon: ReactNode; label: string; value: number; suffix: string }) => (
  <div className="rounded-md border border-[#81D8CF] bg-[#81D8CF] p-3 dark:border-zinc-800 dark:bg-[#171611]">
    <div className="flex items-center justify-between text-[#81D8CF]">
      {icon}
      <span className="text-[11px] font-bold uppercase tracking-[0.16em]">{label}</span>
    </div>
    <p className="mt-3 text-2xl font-semibold text-[#343838] dark:text-[#f4efe4]">
      {value}
      <span className="ml-1 text-xs font-medium text-[#f9faf7] dark:text-zinc-400">{suffix}</span>
    </p>
  </div>
);

const Panel = ({
  title,
  label,
  className = "",
  children
}: {
  title: string;
  label: string;
  className?: string;
  children: ReactNode;
}) => (
  <article className={`dictionary-card rounded-md p-5 ${className}`}>
    <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#81D8CF] pb-3 dark:border-zinc-800">
      <h2 className="jp text-lg font-semibold text-[#343838] dark:text-[#f4efe4]">{title}</h2>
      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#81D8CF]">{label}</span>
    </div>
    {children}
  </article>
);

const StudyModule = ({ icon, title, text }: { icon: ReactNode; title: string; text: string }) => (
  <div className="rounded-md border border-[#81D8CF] bg-[#81D8CF] p-4 dark:border-zinc-800 dark:bg-[#171611]">
    <div className="text-[#81D8CF]">{icon}</div>
    <h3 className="mt-3 font-semibold text-[#343838] dark:text-[#f4efe4]">{title}</h3>
    <p className="mt-2 text-sm leading-6 text-[#f9faf7] dark:text-zinc-300">{text}</p>
  </div>
);
