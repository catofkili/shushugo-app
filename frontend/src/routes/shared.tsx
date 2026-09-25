import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { CapybaraWalk } from "../components/CapybaraMascot";
import { useApp } from "../app/AppContext";

export function ToolSubpage({ title, children }: { title: string; children: ReactNode }) {
  const { navigate } = useApp();
  return (
    <div className="space-y-4">
      <div className="page-backbar flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button onClick={() => navigate("home")} className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8 hover:text-white">
          <ArrowLeft size={17} />
          主页
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">{title}</p>
      </div>
      {children}
    </div>
  );
}

export function PageLoading() {
  return (
    <div className="grid min-h-[50vh] place-items-center p-6 text-sm font-semibold text-white/55" aria-busy="true">
      <div className="text-center"><CapybaraWalk size={72} className="mb-3" /><p>正在加载…</p></div>
    </div>
  );
}
