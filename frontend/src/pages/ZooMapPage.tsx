import { useState } from "react";
import type { ProgressOverview } from "../lib/api";

/**
 * 进度总览 = 动物园地图。
 * 五个 JLPT 等级 = 五个栖息地;**学过的比例**决定栖息地处于哪个「成长阶段」:
 *   荒地 → 围栏 → 入住 → 丰容。
 *
 * ⚠️ **这一页画的是「学过多少」,不是「掌握度」(间隔≥180天)。** 原来用 completed:
 * 首页那格写「N5 92%」,点进来同一个 N5 写 30%、还标着「围栏搭起」—— 同一个按钮
 * 两个口径。而掌握度按月才动一格(全库到 180 天间隔的只有几十个词),
 * 画出来五个园区常年荒地。徽章(zoo-badges)、进度柱状图早就都按 seen 算,这里是最后一处。
 * 现在用 emoji 占位;日后每个园区由画师出一张分层大图,代码只按阶段换层。
 */

const HABITATS = [
  { level: "N5", name: "水豚温泉", animal: "🦫" },
  { level: "N4", name: "松鼠林", animal: "🐿️" },
  { level: "N3", name: "鸟舍", animal: "🐦" },
  { level: "N2", name: "熊猫馆", animal: "🐼" },
  { level: "N1", name: "夜行馆", animal: "🦉" }
] as const;

const STAGES = [
  { min: 0, label: "荒地", icon: "🟫", note: "还没开工" },
  { min: 25, label: "围栏搭起", icon: "🪵", note: "围栏立起来了" },
  { min: 55, label: "动物入住", icon: "🌱", note: "有住客啦" },
  { min: 85, label: "热闹丰容", icon: "🌳", note: "生机勃勃" }
];

const stageOf = (pct: number) => {
  let stage = STAGES[0];
  for (const item of STAGES) if (pct >= item.min) stage = item;
  return stage;
};

export function ZooMapPage({ overview }: { overview: ProgressOverview }) {
  const [selected, setSelected] = useState<string>("N5");

  const parks = HABITATS.map((habitat) => {
    const row = overview.wordsByLevel.find((item) => item.level === habitat.level);
    const total = row?.total ?? 0;
    // 学过 = seen_count > 0 或标了熟知;没有词库数据时按 0 算(荒地)
    const pct = total > 0 ? Math.round(((row?.seen ?? 0) / total) * 100) : 0;
    return { ...habitat, total, seen: row?.seen ?? 0, pct };
  });

  const current = parks.find((park) => park.level === selected) ?? parks[0];
  const stage = stageOf(current.pct);

  return (
    <div className="zoo-page">
      <p className="zoo-panel-kick">PROGRESS · 动物园地图</p>
      <h2 className="zoo-panel-title">每个等级，是一个慢慢长大的园区</h2>

      <div className="zoo-panel zoo-zm-hero">
        <div className={`zoo-zm-scene stage-${STAGES.indexOf(stage)}`}>
          <span className="zoo-zm-bigicon">{stage.icon}</span>
          <span className="zoo-zm-animal" style={{ opacity: current.pct >= 55 ? 1 : 0.15 }}>
            {current.animal}
          </span>
        </div>
        <div className="zoo-zm-hero-info">
          <div>
            <b>
              {current.level} · {current.name}
            </b>
            <small>
              {stage.label} · {stage.note}
              {current.total > 0 && `　学过 ${current.seen} / ${current.total} 词`}
            </small>
          </div>
          <div className="zoo-zm-pct">{current.pct}%</div>
        </div>
        <div className="zoo-zm-bar">
          <i style={{ width: `${current.pct}%` }} />
        </div>
      </div>

      <div className="zoo-zm-grid">
        {parks.map((park) => {
          const parkStage = stageOf(park.pct);
          return (
            <button
              key={park.level}
              className={`zoo-pop zoo-zm-tile${park.level === selected ? " on" : ""}`}
              onClick={() => setSelected(park.level)}
            >
              <span className="zoo-zm-tile-icon">{park.pct >= 55 ? park.animal : parkStage.icon}</span>
              <b>{park.level}</b>
              <small>{park.name}</small>
              <em>{park.pct}%</em>
            </button>
          );
        })}
      </div>

      <p className="zoo-panel-note">
        清空一个等级 → 该园区「饲养员认证」徽章。画师主战场：每个园区一张分层大图（荒地 / 围栏 / 入住 / 丰容），代码只做按学过比例换层。
      </p>
    </div>
  );
}
