import { JLPTLevel } from "../types/grammar";

interface FillProgressModalProps {
  fillAllWords: boolean;
  fillWordLevels: JLPTLevel[];
  fillGrammarLevels: JLPTLevel[];
  onClose: () => void;
  onConfirm: () => void;
  onToggleAllWords: () => void;
  onToggleLevel: (kind: "word" | "grammar", level: JLPTLevel) => void;
}

const jlptLevels: JLPTLevel[] = ["N5", "N4", "N3", "N2", "N1"];

export function FillProgressModal({
  fillAllWords,
  fillWordLevels,
  fillGrammarLevels,
  onClose,
  onConfirm,
  onToggleAllWords,
  onToggleLevel
}: FillProgressModalProps) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/20 bg-[#3f4343] p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/48">Fill Progress</p>
            <h2 className="mt-1 text-xl font-bold">一键填满</h2>
          </div>
          <button
            onClick={onClose}
            className="focus-ring grid h-9 w-9 place-items-center rounded-2xl border border-white/15 bg-white/5"
          >
            x
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-[#81D8CF]/35 bg-[#81D8CF]/10 p-3">
          <div className="flex items-start gap-2">
            <span className="text-lg leading-none">✓</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#81D8CF]">只管理一键填满标记</p>
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-white/66">
                <li>• 会先恢复上一次一键填满造成的标记</li>
                <li>• 再把本次勾选等级标记为已掌握</li>
                <li>• 不勾选任何等级并确认，可以撤销上次填满</li>
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm leading-6 text-white/62">
          <strong className="text-white">适用场景：</strong>你在其他地方已学完某些等级，想直接标记为已掌握。
        </p>

        <p className="mt-2 text-xs leading-relaxed text-yellow-400/80">
          提示：这个功能适合把你本来就会的等级排到最低优先级。
        </p>
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold text-white/52">单词等级</p>
          <div className="grid grid-cols-5 gap-2">
            {jlptLevels.map((level) => (
              <button
                key={`word-${level}`}
                onClick={() => onToggleLevel("word", level)}
                disabled={fillAllWords}
                className={`focus-ring h-10 rounded-2xl border text-sm font-bold disabled:opacity-35 ${fillWordLevels.includes(level) ? "border-[#81D8CF] bg-[#81D8CF] !text-[#343838]" : "border-white/15 bg-[#81D8CF]/10 text-white/72"}`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <p className="mb-2 text-xs font-bold text-white/52">语法等级</p>
          <div className="grid grid-cols-5 gap-2">
            {jlptLevels.map((level) => (
              <button
                key={`grammar-${level}`}
                onClick={() => onToggleLevel("grammar", level)}
                className={`focus-ring h-10 rounded-2xl border text-sm font-bold ${fillGrammarLevels.includes(level) ? "border-[#81D8CF] bg-[#81D8CF] !text-[#343838]" : "border-white/15 bg-[#81D8CF]/10 text-white/72"}`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={onToggleAllWords}
          className={`focus-ring mt-3 flex w-full items-center justify-between rounded-2xl border p-3 text-left text-sm font-bold ${fillAllWords ? "border-[#81D8CF] bg-[#81D8CF]/18 text-white" : "border-white/15 bg-[#81D8CF]/10 text-white/72"}`}
        >
          <span>全部单词</span>
          <span className={`grid h-5 w-5 place-items-center rounded-md border ${fillAllWords ? "border-[#81D8CF] bg-[#81D8CF] !text-[#343838]" : "border-white/25"}`}>
            {fillAllWords ? "✓" : ""}
          </span>
        </button>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            className="focus-ring h-11 rounded-2xl border border-white/20 bg-white/8 text-sm font-bold text-white/72 hover:bg-white/12"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="focus-ring h-11 rounded-2xl bg-[#81D8CF] text-sm font-bold !text-[#343838]"
          >
            确认同步
          </button>
        </div>
      </div>
    </div>
  );
}
