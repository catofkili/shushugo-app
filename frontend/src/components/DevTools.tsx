import { useEntitlements } from "../hooks/useEntitlements";
import { clearEntitlements, grantPro } from "../lib/entitlements";

export function DevTools() {
  const entitlements = useEntitlements();

  if (!import.meta.env.DEV) return null;

  return (
    <div className="mt-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">开发者测试模式</p>
          <p className="mt-0.5 text-xs text-white/60">只在本地开发环境显示</p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={entitlements.isPro}
            onChange={(event) => {
              if (event.target.checked) {
                grantPro("shushugo_pro_lifetime", "development");
              } else {
                clearEntitlements();
              }
            }}
            className="peer sr-only"
          />
          <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5" />
        </label>
      </div>

      <p className="mt-3 text-xs leading-5 text-white/50">
        ⚠️ 这里以前还有「快速完成今日任务 / 重置今日进度 / 模拟记忆力」四个按钮，
        已于 2026-09-09 删除：它们按 <code>score = 9</code> 写进度、直接往
        <code>reviews</code> 里灌模拟流水，而 score 在 FSRS 上线后就不再读写了 ——
        判据对不上，写进去的东西也没法当诊断依据。而且作者本人日常就在 DEV 网页背词，
        这几个按钮改的是他真实的学习库。要造数据请另开一份隔离的库。
      </p>
    </div>
  );
}
