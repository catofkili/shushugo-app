import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Lock } from "lucide-react";
import { achievementBoard, CATEGORY_ORDER, TIER_LABEL, type AchievementView } from "../lib/achievements";

interface AchievementsPageProps {
  onBack: () => void;
}

const TIER_CLASS: Record<string, string> = {
  common: "ach-tier-common",
  rare: "ach-tier-rare",
  epic: "ach-tier-epic"
};

/**
 * 成就页。
 *
 * 隐藏成就没拿到之前只显示 ???，条件也不写 —— 写出来就没有「咦，这也有成就」那一下了。
 * 已解锁的排在各自分类的前面，没拿到的按进度从高到低跟在后面：让人一眼看到「就差一点」的那个。
 */
export const AchievementsPage = ({ onBack }: AchievementsPageProps) => {
  const [board, setBoard] = useState<{ items: AchievementView[]; unlocked: number; total: number } | null>(null);

  useEffect(() => {
    // 统计要扫几万行 reviews，让页面先画出来
    const timer = window.setTimeout(() => setBoard(achievementBoard()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const grouped = useMemo(() => {
    if (!board) return [];
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: board.items
        .filter((item) => item.category === category)
        .sort((left, right) => {
          if (left.unlocked !== right.unlocked) return left.unlocked ? -1 : 1;
          if (left.unlocked) return (right.unlockedOn ?? "").localeCompare(left.unlockedOn ?? "");
          return right.progress / right.goal - left.progress / left.goal;
        })
    })).filter((group) => group.items.length);
  }, [board]);

  const percent = board && board.total ? Math.round(board.unlocked / board.total * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button
          onClick={onBack}
          className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8 hover:text-white"
        >
          <ArrowLeft size={17} />
          返回
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">成就</p>
      </div>

      {!board ? (
        <p className="py-10 text-center text-sm font-bold text-white/45">正在结算…</p>
      ) : (
        <>
          <div className="ach-summary">
            <div>
              <p className="ach-summary-kick">Achievements</p>
              <p className="ach-summary-count"><b>{board.unlocked}</b> / {board.total}</p>
            </div>
            <div className="ach-summary-bar" role="img" aria-label={`完成度 ${percent}%`}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className="ach-summary-percent">{percent}%</p>
          </div>

          {grouped.map((group) => (
            <section key={group.category} className="mt-4">
              <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                {group.category}
                <span className="ml-2 normal-case tracking-normal text-white/30">
                  {group.items.filter((item) => item.unlocked).length}/{group.items.length}
                </span>
              </p>
              <div className="ach-grid">
                {group.items.map((item) => {
                  const secret = item.hidden && !item.unlocked;
                  return (
                    <div
                      key={item.id}
                      className={`ach-card ${item.unlocked ? TIER_CLASS[item.tier] : "is-locked"}`}
                    >
                      <span className="ach-emoji">{secret ? <Lock size={20} /> : item.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="ach-name">
                          {secret ? "???" : item.name}
                          {item.tier !== "common" && !secret && (
                            <span className={`ach-tag ach-tag-${item.tier}`}>{TIER_LABEL[item.tier]}</span>
                          )}
                        </p>
                        <p className="ach-desc">{secret ? "隐藏成就 —— 拿到了才告诉你" : item.description}</p>
                        {item.unlocked ? (
                          <p className="ach-date">{item.unlockedOn} 达成</p>
                        ) : item.goal > 1 && !secret ? (
                          <div className="ach-progress">
                            <span style={{ width: `${Math.min(100, item.progress / item.goal * 100)}%` }} />
                            <b>{item.progress} / {item.goal}</b>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
};
