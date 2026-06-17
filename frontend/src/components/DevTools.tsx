import { useEntitlements } from "../hooks/useEntitlements";
import { clearEntitlements, grantPro } from "../lib/entitlements";
import { checkMemoryStatus, quickCompleteToday, resetTodayProgress, simulateMemoryData } from "../lib/test-utils";

interface DevToolsProps {
  onNotice: (message: string, timeout?: number) => void;
}

export function DevTools({ onNotice }: DevToolsProps) {
  const entitlements = useEntitlements();

  if (!import.meta.env.DEV) return null;

  const run = (action: () => void, success: string, timeout = 2000) => {
    try {
      action();
      onNotice(success, timeout);
    } catch (error) {
      onNotice("操作失败: " + (error as Error).message, 3000);
    }
  };

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
                grantPro("master_pro_lifetime", "development");
              } else {
                clearEntitlements();
              }
            }}
            className="peer sr-only"
          />
          <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5" />
        </label>
      </div>

      <div className="mt-4 space-y-2">
        <button
          onClick={() => run(quickCompleteToday, '测试：今日任务已接近完成，去单词学习点"认识"即可进入完成页面', 3000)}
          className="w-full rounded-xl border border-white/15 bg-[#3c3f3f] px-3 py-2 text-left text-xs text-white hover:bg-[#4a4f4f]"
        >
          <p className="font-bold">快速完成今日任务</p>
          <p className="mt-0.5 text-white/60">开发测试用，正式入口在工具箱</p>
        </button>

        <button
          onClick={() => run(resetTodayProgress, "测试：今日进度已重置")}
          className="w-full rounded-xl border border-white/15 bg-[#3c3f3f] px-3 py-2 text-left text-xs text-white hover:bg-[#4a4f4f]"
        >
          <p className="font-bold">重置今日进度</p>
          <p className="mt-0.5 text-white/60">清除今日任务、复习记录和打卡</p>
        </button>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => run(() => simulateMemoryData("strong"), "已模拟强记忆力数据")}
            className="rounded-xl border border-green-500/30 bg-green-500/10 px-2 py-2 text-xs font-bold text-white hover:bg-green-500/20"
          >
            模拟强记忆
          </button>
          <button
            onClick={() => run(() => simulateMemoryData("normal"), "已模拟正常记忆力")}
            className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-2 py-2 text-xs font-bold text-white hover:bg-blue-500/20"
          >
            模拟正常
          </button>
          <button
            onClick={() => run(() => simulateMemoryData("weak"), "已模拟弱记忆力")}
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-2 py-2 text-xs font-bold text-white hover:bg-red-500/20"
          >
            模拟弱记忆
          </button>
        </div>

        <button
          onClick={() => run(checkMemoryStatus, "已输出到控制台，按 F12 查看")}
          className="w-full rounded-xl border border-white/15 bg-[#3c3f3f] px-3 py-2 text-left text-xs text-white hover:bg-[#4a4f4f]"
        >
          <p className="font-bold">查看记忆力状态</p>
          <p className="mt-0.5 text-white/60">在浏览器控制台查看详细信息</p>
        </button>
      </div>
    </div>
  );
}
