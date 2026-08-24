import { ArrowLeft, Heart } from "lucide-react";

interface AboutPageProps {
  onBack: () => void;
}

export function AboutPage({ onBack }: AboutPageProps) {
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
        <h1 className="jp-serif mt-4 text-2xl font-semibold text-white">收集日</h1>
        <p className="mt-2 text-sm text-white/60">Vocabulary · Grammar</p>
        <p className="mt-3 text-xs font-bold text-white/50">版本 {__APP_VERSION__}</p>
      </div>

      {/* 应用介绍 */}
      <div className="mb-4 rounded-2xl border border-white/15 bg-[#464949] p-4">
        <h2 className="mb-3 text-sm font-bold text-white">应用介绍</h2>
        <p className="text-sm leading-relaxed text-white/70">
          收集日是一款离线日语学习应用，内置 10,919 个 JLPT 词条和 741 个语法点。
          单词、汉字读音和语法三条线都由同一套 FSRS 记忆算法排复习。
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
            <p className="text-sm text-white/70">10,919 个 N5-N1 JLPT 词条，条条带例句</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#81D8CF]">✓</span>
            <p className="text-sm text-white/70">741 个语法点详解（N5 120 · N4 130 · N3 140 · N2 150 · N1 201）</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#81D8CF]">✓</span>
            <p className="text-sm text-white/70">FSRS 记忆算法排复习（Anki 同款）</p>
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
          当前 JLPT 词条与中文释义可追溯到 eggrolls-JLPT10k-v3.5，并适用 CC BY-NC 4.0；10,609 条种子词条均已有逐词手写例句。例句重写不改变词条与释义的来源许可：词条与释义仍仅可用于非商业开发，商业发布前必须取得授权或整体替换。
            汉字表记优先级与部分动词自他标注使用 JMdict（Electronic Dictionary Research and Development Group），适用 CC BY-SA 4.0。
            其他数据的来源、署名和发布条件请以项目 README 的版权合规说明为准。
          </p>
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">音频鸣谢</p>
        <div className="rounded-2xl border border-white/15 bg-[#464949] p-4">
          <p className="text-sm leading-relaxed text-white/70">
            预生成单词音频使用 VOICEVOX:春日部つむぎ、VOICEVOX:雨晴はう 与 VOICEVOX:玄野武宏。请保留准确署名：VOICEVOX:春日部つむぎ、VOICEVOX:雨晴はう、VOICEVOX:玄野武宏(CV:ガロ)。
          </p>
        </div>
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
