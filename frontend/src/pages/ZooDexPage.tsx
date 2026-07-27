import { useEffect, useMemo, useState } from "react";
import { getWordStats, type ProgressOverview } from "../lib/api";
import { PROGRESS_UPDATED_EVENT } from "../lib/progress-events";
import { computeBadges, GROUP_LABELS, type Badge, type BadgeGroup } from "../lib/zoo-badges";
import type { WordStats } from "../types/vocabulary";

/**
 * 饲养员图鉴 —— 徽章收集。
 * 全部由本地真实进度算出(见 lib/zoo-badges.ts),没有额外存档,也不需要美术资源:
 * 未解锁的徽章去色 + 显示还差多少,解锁的上色。
 */

const GROUP_ORDER: BadgeGroup[] = ["habitat", "streak", "words", "days"];

export function ZooDexPage({ overview }: { overview: ProgressOverview }) {
  const [stats, setStats] = useState<WordStats | null>(null);

  useEffect(() => {
    const refresh = () => {
      try {
        setStats(getWordStats());
      } catch {
        // 词库没就绪时先空着,进度事件会再触发
      }
    };
    refresh();
    window.addEventListener(PROGRESS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PROGRESS_UPDATED_EVENT, refresh);
  }, []);

  const badges = useMemo(
    () =>
      computeBadges({
        overview,
        checkins: stats?.checkins ?? [],
        studyDate: stats?.studyDate ?? ""
      }),
    [overview, stats]
  );

  const unlocked = badges.filter((badge) => badge.unlocked).length;

  const renderBadge = (badge: Badge) => {
    const percent = badge.target > 0 ? Math.min(100, (badge.current / badge.target) * 100) : 0;
    return (
      <div key={badge.id} className={`zoo-dex-item${badge.unlocked ? " on" : ""}`}>
        <span className="zoo-dex-emoji">{badge.emoji}</span>
        <b>{badge.title}</b>
        {badge.unlocked ? (
          <span className="zoo-dex-got">已点亮</span>
        ) : (
          <>
            <span className="zoo-dex-req">{badge.requirement}</span>
            <span className="zoo-dex-bar">
              <i style={{ width: `${percent}%` }} />
            </span>
            <span className="zoo-dex-num">
              {badge.current} / {badge.target}
            </span>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="zoo-page">
      <p className="zoo-panel-kick">DEX · 饲养员图鉴</p>
      <h2 className="zoo-panel-title">慢慢点亮，不用赶</h2>

      <div className="zoo-panel zoo-dex-head">
        <div>
          <b>
            {unlocked} / {badges.length}
          </b>
          <small>已点亮的徽章</small>
        </div>
        <div className="zoo-dex-head-bar">
          <i style={{ width: `${badges.length ? (unlocked / badges.length) * 100 : 0}%` }} />
        </div>
      </div>

      {GROUP_ORDER.map((group) => {
        const items = badges.filter((badge) => badge.group === group);
        if (!items.length) return null;
        return (
          <div key={group}>
            <p className="zoo-sec">{GROUP_LABELS[group]}</p>
            <div className="zoo-dex-grid">{items.map(renderBadge)}</div>
          </div>
        );
      })}

      <p className="zoo-panel-note">
        徽章不是任务，只是回头看看走过多少路。断签不会让已点亮的徽章熄灭。
      </p>
    </div>
  );
}
