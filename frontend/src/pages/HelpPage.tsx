import { ArrowLeft, ChevronRight, HelpCircle, Mail, MessageCircle } from "lucide-react";
import { useState } from "react";

interface HelpPageProps {
  onBack: () => void;
}

export function HelpPage({ onBack }: HelpPageProps) {
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const openMail = (subject: string) => {
    window.location.href = `mailto:support@masternihongo.app?subject=${encodeURIComponent(subject)}`;
  };

  const faqs = [
    {
      q: "如何开始学习？",
      a: "点击底部导航的「单词学习」或「语法」开始。建议先学单词，再学语法。",
    },
    {
      q: "学习进度保存在哪里？",
      a: "默认保存在本地设备。开启云端同步后可跨设备同步（需部署后端）。",
    },
    {
      q: "如何复习学过的内容？",
      a: "在「工具箱」中打开「复习队列」，系统会根据记忆曲线提醒你复习。",
    },
    {
      q: "错题本在哪里？",
      a: "在「工具箱」中找到「错题本」，可以回顾做错的题目。",
    },
    {
      q: "应用是完全离线的吗？",
      a: "是的！所有词汇、语法和学习功能都可以完全离线使用。",
    },
    {
      q: "如何导出学习数据？",
      a: "进入「我的」>「设置」>「数据管理」>「导出学习数据」。",
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
              <ol className="space-y-2 text-sm text-white/68">
                <li>1. 在「单词学习」选择 JLPT 等级或学习类型，先完成当天词卡。</li>
                <li>2. 到「语法」用学习/练习切换，把错题自动收进错题本。</li>
                <li>3. 在「工具箱」查看复习队列、收藏、辨析表和整体进度。</li>
              </ol>
            </div>
          )}

          <button
            onClick={() => openMail("Master Nihongo 反馈建议")}
            className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
              <MessageCircle size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">反馈建议</p>
              <p className="mt-0.5 text-xs text-white/50">提交问题或改进建议</p>
            </div>
            <ChevronRight size={17} className="text-white/40" />
          </button>

          <button
            onClick={() => openMail("联系 Master Nihongo 支持")}
            className="focus-ring flex w-full items-center gap-3 p-4 text-left hover:bg-[#4d5151]"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
              <Mail size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">联系我们</p>
              <p className="mt-0.5 text-xs text-white/50">support@masternihongo.app</p>
            </div>
            <ChevronRight size={17} className="text-white/40" />
          </button>
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
