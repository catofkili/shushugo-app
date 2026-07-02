import { ArrowLeft, ExternalLink, Github, Heart } from "lucide-react";
import { useState } from "react";

interface AboutPageProps {
  onBack: () => void;
}

export function AboutPage({ onBack }: AboutPageProps) {
  const [message, setMessage] = useState("");

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
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">关于</p>
      </div>

      {/* 应用信息 */}
      <div className="mb-4 rounded-2xl border border-white/15 bg-[#464949] p-6 text-center">
        <div className="mx-auto grid h-20 w-20 place-items-center border-2 border-white/20 bg-[#81D8CF] jp-serif text-3xl font-bold !text-[#343838]">
          語
        </div>
        <h1 className="jp-serif mt-4 text-2xl font-semibold text-white">Master Nihongo</h1>
        <p className="mt-2 text-sm text-white/60">Vocabulary · Grammar</p>
        <p className="mt-3 text-xs font-bold text-white/50">版本 1.0.0</p>
      </div>

      {/* 应用介绍 */}
      <div className="mb-4 rounded-2xl border border-white/15 bg-[#464949] p-4">
        <h2 className="mb-3 text-sm font-bold text-white">应用介绍</h2>
        <p className="text-sm leading-relaxed text-white/70">
          Master Nihongo 是一款离线日语学习应用，提供 11000+ 个 JLPT 词条和 800+ 个语法点的学习内容。
          支持背单词和语法学习，帮助你系统学习日语。
        </p>
      </div>

      {/* 功能特性 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">功能特性</p>
        <div className="space-y-2 rounded-2xl border border-white/15 bg-[#464949] p-4">
          <div className="flex items-start gap-2">
            <span className="text-[#81D8CF]">✓</span>
            <p className="text-sm text-white/70">完全离线使用，无需网络连接</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#81D8CF]">✓</span>
            <p className="text-sm text-white/70">11000+ 个 N5-N1 JLPT 词条</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#81D8CF]">✓</span>
            <p className="text-sm text-white/70">800+ 个语法点详解</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#81D8CF]">✓</span>
            <p className="text-sm text-white/70">智能复习系统（记忆曲线）</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#81D8CF]">✓</span>
            <p className="text-sm text-white/70">本地保存学习进度</p>
          </div>
        </div>
      </div>

      {/* 数据来源 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">数据来源</p>
        <div className="rounded-2xl border border-white/15 bg-[#464949] p-4">
          <p className="text-sm leading-relaxed text-white/70">
            词库和语法数据来自开放的日语学习资源，内容遵循 CC BY-NC 4.0 许可协议。
            仅供个人学习使用，不得用于商业用途。
          </p>
        </div>
      </div>

      {/* 开源信息 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">开源</p>
        <button
          onClick={() => setMessage("公开仓库地址还没有绑定到 App；确定发布地址后这里会直接打开。")}
          className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-white/15 bg-[#464949] p-4 text-left hover:bg-[#4d5151]"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#3b3f3f] text-white/76">
            <Github size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">GitHub 仓库</p>
            <p className="mt-0.5 text-xs text-white/50">查看源代码和贡献</p>
          </div>
          <ExternalLink size={17} className="text-white/40" />
        </button>
        {message && (
          <p className="mt-2 rounded-2xl border border-white/15 bg-white/8 px-3 py-2 text-xs text-white/60">{message}</p>
        )}
      </div>

      {/* 技术栈 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">技术栈</p>
        <div className="rounded-2xl border border-white/15 bg-[#464949] p-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="font-bold text-white/60">前端</p>
              <p className="mt-1 text-white/50">React 19</p>
              <p className="text-white/50">TypeScript</p>
              <p className="text-white/50">Vite</p>
              <p className="text-white/50">Tailwind CSS</p>
            </div>
            <div>
              <p className="font-bold text-white/60">移动端</p>
              <p className="mt-1 text-white/50">Capacitor</p>
              <p className="text-white/50">iOS 15.0+</p>
              <p className="text-white/50">SQLite (sql.js)</p>
            </div>
          </div>
        </div>
      </div>

      {/* 致谢 */}
      <div className="rounded-2xl border border-white/15 bg-[#464949] p-4 text-center">
        <Heart size={24} className="mx-auto text-[#81D8CF]" />
        <p className="mt-3 text-sm text-white/70">
          感谢所有为日语学习资源贡献的开发者和社区
        </p>
        <p className="mt-2 text-xs text-white/50">Made for Japanese learners</p>
      </div>
    </div>
  );
}
