import { ArrowLeft, ChevronRight, HelpCircle, MessageCircle } from "lucide-react";
import { useState } from "react";

interface HelpPageProps {
  onBack: () => void;
}

export function HelpPage({ onBack }: HelpPageProps) {
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const faqs = [
    {
      q: "如何开始学习？",
      a: "点击底部导航的「单词学习」或「语法」开始。建议先学单词，再学语法。",
    },
    {
      q: "学习进度保存在哪里？",
      a: "保存在本机数据库里，不登录也能一直用。登录后会自动备份到云端并在多台设备之间逐行合并：不同的词各自保留，同一条记录冲突时按版本判定。",
    },
    {
      q: "应用是完全离线的吗？",
      a: "是的！所有词汇、语法和学习功能都可以完全离线使用。",
    },
    {
      q: "如何导出学习数据？",
      a: "「我的」>「设置」>「数据管理」>「导出学习数据」，会存成一个 .db 备份文件；同一处的「恢复备份」可以把它读回来。",
    },
    {
      q: "复习是按什么排的？",
      a: "单词、汉字读音和语法都用 FSRS（Anki 同款记忆算法）。每天只需要调「学习强度」里的新词数，复习量由算法按遗忘风险安排；学不完的会顺延，不会丢。",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button
          onClick={onBack}
          className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8 hover:text-white"
        >
          <ArrowLeft size={17} />
          返回
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">帮助和支持</p>
      </div>

      {/* 快速帮助 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">快速帮助</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <button
            onClick={() => setTutorialOpen((value) => !value)}
            className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
              <HelpCircle size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">使用教程</p>
              <p className="mt-0.5 text-xs text-white/50">新手快速入门指南</p>
            </div>
            <ChevronRight size={17} className="text-white/40" />
          </button>

          {tutorialOpen && (
            <div className="border-b border-white/10 bg-[#3c3f3f] px-4 py-3">
              {/* 这三步要对着现在的界面写。上一版说的「在单词学习选 JLPT 等级或学习类型」
                  「到语法用学习/练习切换」都是早就没有的控件 —— 教程写错比没有教程更糟。 */}
              <ol className="space-y-2 text-sm text-white/68">
                <li>1. 点「单词学习」直接就是今天的计划：看题、翻面、按记得的程度评分。一天学几个新词在「设置 · 学习强度」里调。</li>
                <li>2. 点「语法」按等级翻卡；工具条上的「考题」把一个等级洗一遍牌过完，「沉浸学习」连着读。</li>
                <li>3. 主页的「学习工具」里有选词、疑难辨析、一字多音和收藏；进度概览里点任意一根柱子，直接进那个等级的词库。</li>
              </ol>
            </div>
          )}

          {/* 原来这里是「反馈建议」和「获取支持」两行:同一个图标、同一句话、都不可点。
              两条并排只会让人以为它们通向不同的地方,合成一条。 */}
          <div className="flex w-full items-center gap-3 p-4 text-left">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
              <MessageCircle size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">反馈和支持</p>
              <p className="mt-0.5 text-xs text-white/50">请通过 App Store 的应用支持入口提交问题或建议</p>
            </div>
          </div>
        </div>
      </div>

      {/* 常见问题 */}
      <div>
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">常见问题</p>
        <div className="space-y-3">
          {faqs.map((faq, index) => (
            <details
              key={index}
              className="group overflow-hidden rounded-2xl border border-white/15 bg-[#464949]"
            >
              <summary className="focus-ring flex cursor-pointer items-center gap-3 p-4 hover:bg-[#4d5151]">
                <span className="flex-1 text-sm font-bold text-white">{faq.q}</span>
                <ChevronRight
                  size={17}
                  className="text-white/40 transition-transform group-open:rotate-90"
                />
              </summary>
              <div className="border-t border-white/10 bg-[#3c3f3f] p-4">
                <p className="text-sm text-white/70">{faq.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
