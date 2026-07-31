import { useState } from "react";

/**
 * 进度总览 = 动物园地图。
 * 五个 JLPT 等级 = 五个栖息地;掌握度百分比决定栖息地处于哪个「成长阶段」:
 *   荒地 → 围栏 → 入住 → 丰容。
 * 现在用 emoji + 符号占位;日后每个栖息地由画师出「一张大图分层」,代码只按阶段换层。
 */

type Habitat = {
  level: string;
  name: string;
  animal: string;
  pct: number;
};

const HABITATS: Habitat[] = [
  { level: "N5", name: "水豚温泉", animal: "🦫", pct: 95 },
  { level: "N4", name: "松鼠林", animal: "🐿️", pct: 82 },
  { level: "N3", name: "鸟舍", animal: "🐦", pct: 64 },
  { level: "N2", name: "熊猫馆", animal: "🐼", pct: 28 },
  { level: "N1", name: "夜行馆", animal: "🦉", pct: 6 }
];

const STAGES = [
  { min: 0, label: "荒地", icon: "🟫", note: "还没开工" },
  { min: 25, label: "围栏搭起", icon: "🪵", note: "围栏立起来了" },
  { min: 55, label: "动物入住", icon: "🌱", note: "有住客啦" },
  { min: 85, label: "热闹丰容", icon: "🌳", note: "生机勃勃" }
];

function stageOf(pct: number) {
  let s = STAGES[0];
  for (const st of STAGES) if (pct >= st.min) s = st;
  return s;
}

export function ZooMap() {
  const [sel, setSel] = useState<Habitat>(HABITATS[0]);
  const stage = stageOf(sel.pct);

  return (
    <div>
      <p className="kicker">PROGRESS · 动物园地图</p>
      <h2 className="section-title">每个等级，是一个慢慢长大的园区</h2>

      {/* 选中园区的大图占位 */}
      <div className="lab-card zm-hero">
        <div className={"zm-scene stage-" + STAGES.indexOf(stage)}>
          <span className="zm-bigicon">{stage.icon}</span>
          <span className="zm-animal" style={{ opacity: sel.pct >= 55 ? 1 : 0.15 }}>
            {sel.animal}
          </span>
        </div>
        <div className="zm-hero-info">
          <div>
            <b>
              {sel.level} · {sel.name}
            </b>
            <small>
              {stage.label} · {stage.note}
            </small>
          </div>
          <div className="zm-pct">{sel.pct}%</div>
        </div>
        <div className="zm-bar">
          <i style={{ width: `${sel.pct}%` }} />
        </div>
      </div>

      {/* 五园区选择 */}
      <div className="zm-grid">
        {HABITATS.map((h) => {
          const st = stageOf(h.pct);
          return (
            <button
              key={h.level}
              className={"zm-tile" + (h.level === sel.level ? " on" : "")}
              onClick={() => setSel(h)}
            >
              <span className="zm-tile-icon">{h.pct >= 55 ? h.animal : st.icon}</span>
              <b>{h.level}</b>
              <small>{h.name}</small>
              <em>{h.pct}%</em>
            </button>
          );
        })}
      </div>

      <p className="lab-note">
        画师主战场：每个园区一张分层大图（荒地/围栏/入住/丰容 4 阶段），代码只做「按掌握度换层」。
        清空一个等级 → 该园区「饲养员认证」徽章。
      </p>
    </div>
  );
}
