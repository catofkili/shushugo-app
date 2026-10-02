import type { CSSProperties } from "react";
import type { WeeklyReport } from "../../lib/analytics/weekly";
import { weekday } from "../WeeklyReportStory";

const d = (seconds: number, extra: Record<string, string | number> = {}) => ({ "--d": `${seconds}s`, ...extra }) as CSSProperties;

/** 北斗七星：斗口四颗 + 斗柄三颗，按 周日 → 周六 的顺序排。 */
const DIPPER = [[28, 44], [40, 104], [104, 116], [116, 60], [172, 52], [220, 58], [290, 100]] as const;
const DIPPER_LINKS = [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]] as const;

function Dipper({ daily }: { daily: WeeklyReport["metrics"]["daily"] }) {
  const peak = Math.max(1, ...daily.map((day) => day.reviews));
  // 「亮」和封面那句「点亮了 N 颗星」（metrics.days）同一口径：有作答或有计时都算。
  // 只看作答数会出现「点亮了 1 颗」而七颗全暗 —— 那一天可能只有计时、作答落在边界另一侧。
  const lit = (i: number) => (daily[i]?.reviews ?? 0) > 0 || (daily[i]?.seconds ?? 0) > 0;
  return (
    <svg className="sa-dipper" viewBox="0 0 320 150" role="img" aria-label={daily.map((day, i) => `周${weekday(day.date)}${lit(i) ? (day.reviews ? ` ${day.reviews} 次作答` : " 学过") : " 没学"}`).join("，")}>
      <defs>
        <radialGradient id="sa-glow"><stop offset="0" stopColor="#fff3cf" /><stop offset=".35" stopColor="#ffd88a" stopOpacity=".55" /><stop offset="1" stopColor="#ffd88a" stopOpacity="0" /></radialGradient>
      </defs>
      {DIPPER_LINKS.map(([a, b], i) => (
        <line key={i} x1={DIPPER[a][0]} y1={DIPPER[a][1]} x2={DIPPER[b][0]} y2={DIPPER[b][1]} pathLength={1}
          className={`sa-dipper-link${lit(a) && lit(b) ? " is-lit" : ""}`} style={d(1.9 + i * 0.12)} />
      ))}
      {DIPPER.map(([x, y], i) => {
        const reviews = daily[i]?.reviews ?? 0;
        const on = lit(i);
        const r = on ? 3.5 + 4.5 * Math.sqrt(reviews / peak) : 1.8;
        return (
          <g key={i} className={`sa-dipper-star${on ? " is-lit" : ""}`} style={d(1.1 + i * 0.12, { transformOrigin: `${x}px ${y}px` })}>
            {on && <circle cx={x} cy={y} r={r * 4} fill="url(#sa-glow)" />}
            <circle cx={x} cy={y} r={r} />
            <text x={x} y={y + (i === 0 || i === 3 || i === 4 || i === 5 ? -14 : 22)} textAnchor="middle">{weekday(daily[i]?.date ?? "")}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Rays({ daily }: { daily: WeeklyReport["metrics"]["daily"] }) {
  const peak = Math.max(1, ...daily.map((day) => day.reviews));
  return (
    <svg className="sa-rays" viewBox="0 0 320 320" aria-hidden="true">
      <circle cx="160" cy="160" r="150" className="sa-rays-orbit" />
      <circle cx="160" cy="160" r="112" className="sa-rays-orbit is-inner" />
      {daily.map((day, i) => {
        const angle = (-90 + (i * 360) / daily.length) * (Math.PI / 180);
        // 最长 84：58 + 84 + 标签 14 ≈ 156，收在 viewBox 的 160 半径里；再长会伸出画框压到标题。
        const len = day.reviews ? 22 + 62 * (day.reviews / peak) : 14;
        const x1 = 160 + Math.cos(angle) * 58; const y1 = 160 + Math.sin(angle) * 58;
        const x2 = 160 + Math.cos(angle) * (58 + len); const y2 = 160 + Math.sin(angle) * (58 + len);
        const lx = 160 + Math.cos(angle) * (72 + len); const ly = 160 + Math.sin(angle) * (72 + len) + 4;
        return (
          <g key={day.date} style={d(0.6 + i * 0.1)} className={`sa-ray${day.reviews === peak && day.reviews > 0 ? " is-peak" : ""}${day.reviews ? "" : " is-empty"}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} />
            <text x={lx} y={ly} textAnchor="middle">{weekday(day.date)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export { Dipper, Rays };
