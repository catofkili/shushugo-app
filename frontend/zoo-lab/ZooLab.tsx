import { useEffect, useState } from "react";
import { Home, type HomeView } from "./sections/Home";
import { CoreLoop } from "./sections/CoreLoop";
import { TeamPanel } from "./sections/TeamPanel";
import { ZooMap } from "./sections/ZooMap";
import { HotSpring } from "./sections/HotSpring";
import { Gacha } from "./sections/Gacha";
import { Fishing } from "./sections/Fishing";
import { setMuted, isMuted, suspendAudio } from "./sounds";

type Tab = "home" | "loop" | "team" | "map" | "spring" | "gacha" | "fish";

const NAV: { id: Tab; icon: string; label: string }[] = [
  { id: "home", icon: "🏡", label: "主页" },
  { id: "loop", icon: "🐿️", label: "学习" },
  { id: "gacha", icon: "🥚", label: "扭蛋" },
  { id: "fish", icon: "🎣", label: "钓鱼" },
  { id: "map", icon: "🗺️", label: "地图" },
  { id: "spring", icon: "♨️", label: "温泉" },
  { id: "team", icon: "🤝", label: "组队" }
];

/** 地址栏 hash 直达某一页:#gacha / #spring …,方便把某个原型页的链接直接发出去 */
const tabFromHash = (): Tab => {
  const id = window.location.hash.replace("#", "");
  return NAV.some((n) => n.id === id) ? (id as Tab) : "home";
};

export function ZooLab() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [muted, setMutedState] = useState(isMuted());

  // 前进/后退和手改地址栏都跟着走
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  /**
   * 页面看不见时把循环动画和音频停掉。
   * 循环动画只改 transform/opacity(走合成器),但「永不停」本身就让 GPU 一直醒着;
   * 用户切走的那一刻起,这些帧一帧都不值。
   *
   * 只暂停 iterations === Infinity 的:一次性动画(入场淡入、开奖、顿帧)必须放它们跑完,
   * 否则会被冻在第 0 帧——pageIn 从 opacity:0 起步,冻住就是整页空白。
   *
   * 正式 app 里除了 visibilitychange,还应挂 Capacitor 的 appStateChange
   * (需装 @capacitor/app),两者都要:iOS 进后台不保证触发 visibilitychange。
   */
  useEffect(() => {
    if (typeof document.getAnimations !== "function") return;
    const setLoopsPaused = (paused: boolean) => {
      for (const anim of document.getAnimations()) {
        let infinite = false;
        try {
          infinite = anim.effect?.getTiming().iterations === Infinity;
        } catch {
          /* 拿不到 timing 的就当它不是循环,放着不动 */
        }
        if (!infinite) continue;
        if (paused) anim.pause();
        else anim.play();
      }
    };
    const sync = () => {
      const hidden = document.visibilityState === "hidden";
      setLoopsPaused(hidden);
      if (hidden) suspendAudio();
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", suspendAudio);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", suspendAudio);
    };
  }, []);

  const go = (next: Tab) => {
    setTab(next);
    window.location.hash = next;
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  return (
    <div className="lab-shell has-nav">
      <div className="lab-topbar">
        <span className="lab-brand">🦫 Zoo Lab</span>
        <button className={"lab-mute pop" + (muted ? " off" : "")} onClick={toggleMute}>
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {/* 每次换页重挂载 → 播入场动画 */}
      <div key={tab} className="lab-page">
        {tab === "home" && <Home onOpen={(v: HomeView) => go(v)} />}
        {tab === "loop" && <CoreLoop />}
        {tab === "team" && <TeamPanel />}
        {tab === "map" && <ZooMap />}
        {tab === "spring" && <HotSpring />}
        {tab === "gacha" && <Gacha />}
        {tab === "fish" && <Fishing />}
      </div>

      <nav className="lab-nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={"lab-nav-btn" + (tab === n.id ? " on" : "")}
            onClick={() => go(n.id)}
          >
            <span className="lab-nav-icon">{n.icon}</span>
            <span className="lab-nav-label">{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
