import { useCallback, useEffect, useState } from "react";
import {
  getKanjiUnitDailyQuota,
  getKanjiUnitTargetLevelRank,
  kanjiUnitEta,
  setKanjiUnitDailyQuota,
  setKanjiUnitTargetLevelRank,
  KANJI_UNIT_QUOTA_MAX,
  KANJI_UNIT_QUOTA_MIN,
  type KanjiUnitEtaRow
} from "../lib/kanji-unit-scheduler";
import { kanjiUnitIndexLoaded, loadKanjiUnitIndex } from "../lib/kanji-unit-index";
import { notifyProgressUpdated } from "../lib/progress-events";
import { yieldToPaint } from "../lib/yield-to-paint";

/**
 * 汉字读音模式的每日量与目标级别。
 *
 * 和词的「学习强度」是**两个量,分开存**(`kanji_unit_daily_quota`),因为两个模式
 * 的节奏本来就不一样 —— 共用一个的话改一个动全部。
 *
 * 这里选的是**总题量**(复习 + 新单位),不是新单位数。选新单位数的话,界面上写的
 * 「每天 20」在稳态下实际是六七十张,那就是另一种形式的说话不算数。
 */

const QUOTA_ANCHORS = [
  { value: 15, label: "轻" },
  { value: 30, label: "常规" },
  { value: 60, label: "多" },
  { value: 100, label: "冲刺" }
];

const LEVEL_LABELS = ["N5", "N4", "N3", "N2", "N1"];

const formatDays = (days: number): string => {
  if (!Number.isFinite(days) || days <= 0) return "已完成";
  if (days > 365) return `${(days / 365).toFixed(1)} 年`;
  if (days > 45) return `${Math.round(days / 30)} 个月`;
  return `${days} 天`;
};

export function KanjiUnitPlanSettings() {
  const [quota, setQuota] = useState(30);
  const [targetRank, setTargetRank] = useState(4);
  const [eta, setEta] = useState<KanjiUnitEtaRow[]>([]);
  const [ready, setReady] = useState(kanjiUnitIndexLoaded());

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      await loadKanjiUnitIndex();
      // 设置页主体先出现,估算表稍后补上 —— 同 GoalEstimation 的做法
      await yieldToPaint();
      if (!alive) return;
      setReady(true);
      setQuota(getKanjiUnitDailyQuota());
      setTargetRank(getKanjiUnitTargetLevelRank());
    };
    void boot();
    return () => { alive = false; };
  }, []);

  const refreshEta = useCallback((nextQuota: number) => {
    if (!kanjiUnitIndexLoaded()) return;
    try {
      setEta(kanjiUnitEta(nextQuota));
    } catch {
      setEta([]);
    }
  }, []);

  useEffect(() => {
    if (ready) refreshEta(quota);
  }, [ready, quota, refreshEta]);

  const applyQuota = (value: number) => {
    setQuota(value);
    setKanjiUnitDailyQuota(value);
    // 当天计划已经按旧额度排好了,改额度要让首页重读
    notifyProgressUpdated();
  };

  const applyTarget = (rank: number) => {
    setTargetRank(rank);
    setKanjiUnitTargetLevelRank(rank);
    notifyProgressUpdated();
  };

  if (!ready) {
    return (
      <div className="border-b border-white/10 p-4">
        <p className="text-sm font-bold text-white">汉字读音</p>
        <p className="mt-1 text-xs text-white/45">正在读取字音索引…</p>
      </div>
    );
  }

  const target = eta[targetRank];

  return (
    <div className="border-b border-white/10 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">汉字读音 · 每日题量</p>
          <p className="mt-0.5 text-xs text-white/50">
            这是<b className="text-white/70">总题量</b>(复习 + 新字音)。复习先占额，剩下的名额自动补新字音。
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold text-[#81D8CF]">{quota} 题/天</span>
      </div>
      <input
        type="range"
        min={KANJI_UNIT_QUOTA_MIN}
        max={KANJI_UNIT_QUOTA_MAX}
        step={5}
        value={quota}
        onChange={(event) => applyQuota(Number(event.target.value))}
        aria-label="汉字读音每日题量"
        className="w-full accent-[#81D8CF]"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {QUOTA_ANCHORS.map((anchor) => (
          <button
            key={anchor.value}
            onClick={() => applyQuota(anchor.value)}
            className={`focus-ring h-8 rounded-full px-3 text-xs font-bold ${
              quota === anchor.value
                ? "bg-[#81D8CF] text-[#2f3333]"
                : "border border-white/15 bg-white/8 text-white/70"
            }`}
          >
            {anchor.label} {anchor.value}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <p className="text-sm font-bold text-white">目标级别</p>
        <p className="mt-0.5 text-xs text-white/50">
          只影响排序权重，<b className="text-white/70">不排除</b>更高级的字音——真会撞上的高频读音照样会教。
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {LEVEL_LABELS.map((label, rank) => (
            <button
              key={label}
              onClick={() => applyTarget(rank)}
              className={`focus-ring h-8 rounded-full px-3 text-xs font-bold ${
                targetRank === rank
                  ? "bg-[#81D8CF] text-[#2f3333]"
                  : "border border-white/15 bg-white/8 text-white/70"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {eta.length > 0 && (
        <div className="mt-4 rounded-xl border border-white/10 bg-[#3c3f3f] p-3">
          <p className="mb-2 text-xs font-bold text-white/60">按这个题量，读得下来的时间</p>
          <div className="space-y-1 text-xs">
            {eta.map((row) => (
              <div
                key={row.level}
                className={`flex justify-between ${row.levelRank === targetRank ? "text-[#81D8CF]" : "text-white/80"}`}
              >
                <span>
                  {row.level}
                  <span className="ml-1 text-white/40">还欠 {row.unitsRemaining} 字音</span>
                </span>
                <span className="font-bold tabular-nums">{formatDays(row.days)}</span>
              </div>
            ))}
          </div>
          {target && (
            <p className="mt-2 text-xs text-white/45">
              目标 {target.level}：共 {target.unitsNeeded} 个字音，按每天 {quota} 题约需 {formatDays(target.days)}。
              估算按稳态复习占比折算，错得多会更慢。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
