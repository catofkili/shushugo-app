import { CapybaraMascot } from "../../src/components/CapybaraMascot";

/**
 * 主页 = 把原来的「工具箱」改成布局化的 Home。
 * 不再把功能竖着一条条堆,而是便当式(bento)网格:一眼看到今日 + 各入口。
 * 组队被放在这里的显眼位置。各格子点了跳到对应功能。
 */

export type HomeView = "loop" | "team" | "map" | "spring" | "gacha" | "fish";

export function Home({ onOpen }: { onOpen: (v: HomeView) => void }) {
  const hour = new Date().getHours();
  const greet = hour < 5 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

  return (
    <div>
      {/* 问候条 */}
      <div className="hm-greet">
        <div className="hm-greet-capy">
          <CapybaraMascot size={64} mood="happy" />
        </div>
        <div className="hm-greet-text">
          <p className="hm-greet-hi">{greet}，继续加油 🌿</p>
          <p className="hm-greet-sub">今天还有 24 个词等你，松鼠已经在路口了</p>
        </div>
        <div className="hm-greet-streak">
          🔥<b>23</b>
        </div>
      </div>

      {/* 便当网格 */}
      <div className="bento">
        {/* 继续学习(通栏) */}
        <button className="tile tile-hero" onClick={() => onOpen("loop")}>
          <div className="tile-hero-l">
            <span className="tile-kick">今日复习</span>
            <b className="tile-hero-num">24 词</b>
            <span className="tile-hero-sub">走一趟捡松子的小路</span>
          </div>
          <div className="tile-hero-r">
            <span className="tile-hero-emoji">🐿️</span>
            <span className="tile-cta">开始 →</span>
          </div>
        </button>

        {/* 组队(竖向大格,显眼) */}
        <button className="tile tile-team" onClick={() => onOpen("team")}>
          <span className="tile-kick">我的队伍</span>
          <b className="tile-team-name">N3 冲刺组</b>
          <div className="tile-team-avatars">
            <i>🦫</i>
            <i>🐰</i>
            <i>🦊</i>
            <i>🐿️</i>
            <i className="npc">🦫</i>
          </div>
          <span className="tile-team-status">今天 3 / 5 已下水</span>
          <span className="tile-cta soft">看看队友 →</span>
        </button>

        {/* 进度地图 */}
        <button className="tile tile-sm" onClick={() => onOpen("map")}>
          <span className="tile-emoji">🗺️</span>
          <b>进度地图</b>
          <span className="tile-sub">N3 鸟舍 · 64%</span>
          <div className="tile-bar">
            <i style={{ width: "64%" }} />
          </div>
        </button>

        {/* 温泉打卡 */}
        <button className="tile tile-sm" onClick={() => onOpen("spring")}>
          <span className="tile-emoji">♨️</span>
          <b>温泉打卡</b>
          <span className="tile-sub">连续 23 天 · 今天已泡</span>
        </button>

        {/* 扭蛋 + 图鉴 */}
        <button className="tile tile-sm" onClick={() => onOpen("gacha")}>
          <span className="tile-emoji">🥚</span>
          <b>柚子扭蛋</b>
          <span className="tile-sub">🍊 9 可抽 · 图鉴 3 / 15</span>
        </button>

        {/* 钓鱼 */}
        <button className="tile tile-sm" onClick={() => onOpen("fish")}>
          <span className="tile-emoji">🎣</span>
          <b>つりぼり</b>
          <span className="tile-sub">今天 0 匹 · 図鑑 0 / 14</span>
        </button>

        {/* 工具 */}
        <button className="tile tile-sm tile-tools">
          <span className="tile-emoji">🧰</span>
          <b>工具箱</b>
          <span className="tile-sub">导出 · 预设 · 模型下载</span>
        </button>
      </div>

      <p className="lab-note" style={{ marginTop: 16 }}>
        原型说明：这就是「工具箱 → 主页」的布局思路——今日 + 各功能入口一屏铺开，组队放在显眼处。点任意格子进入对应功能。
      </p>
    </div>
  );
}
