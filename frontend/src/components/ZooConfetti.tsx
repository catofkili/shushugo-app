import { useEffect, useState } from "react";

/**
 * 完成今日计划时的主题纸屑:柚子瓣 / 松子 / 叶子,不是通用彩带。
 * 纯 emoji + CSS,不需要美术资源;只用 transform/opacity,飘完自己卸载,闲时零开销。
 * 动效档位为 off 或系统开了「减少动态效果」时,CSS 会把它压成一瞬(见 master-home.css)。
 */

const PIECES = ["🍊", "🌰", "🍃", "🌿", "🍂"];

/** 飘完就卸载,比留着一堆不动的节点干净 */
const LIFETIME_MS = 3200;

/**
 * 小概率的「庆祝动物列队」—— 变率强化(Asana 独角兽那套):
 * 每次都有等于没有,偶尔才出现的东西才会让人期待明天再来。
 */
const PARADE_CHANCE = 0.12;
const PARADE = ["🦫", "🐿️", "🐦", "🦊", "🐼"];
const PARADE_MS = 4200;

interface Piece {
  id: number;
  emoji: string;
  left: number;
  delay: number;
  duration: number;
  drift: number;
  size: number;
}

interface Burst {
  pieces: Piece[];
  parade: string[] | null;
}

/**
 * 随机只在 effect 里摇一次。
 * 不放 useMemo:useMemo 只是缓存提示,React 允许丢弃重算,重算就会中途换一批纸屑。
 */
const rollBurst = (count: number): Burst => ({
  pieces: Array.from({ length: count }, (_, index) => ({
    id: index,
    emoji: PIECES[index % PIECES.length],
    left: Math.round(Math.random() * 92 + 4),
    delay: Math.random() * 0.9,
    duration: 1.9 + Math.random() * 1.1,
    drift: Math.round((Math.random() - 0.5) * 120),
    size: 15 + Math.round(Math.random() * 12)
  })),
  parade: Math.random() < PARADE_CHANCE ? PARADE : null
});

export function ZooConfetti({ count = 16 }: { count?: number }) {
  const [burst, setBurst] = useState<Burst | null>(null);

  useEffect(() => {
    const rolled = rollBurst(count);
    setBurst(rolled);
    const timer = window.setTimeout(
      () => setBurst(null),
      rolled.parade ? PARADE_MS : LIFETIME_MS
    );
    return () => window.clearTimeout(timer);
  }, [count]);

  if (!burst) return null;

  return (
    <div className="zoo-confetti" aria-hidden="true">
      {burst.parade && (
        <div className="zoo-parade">
          {burst.parade.map((animal, index) => (
            <span key={animal} style={{ animationDelay: `${index * 0.14}s` }}>
              <i style={{ animationDelay: `${index * 0.07}s` }}>{animal}</i>
            </span>
          ))}
        </div>
      )}
      {burst.pieces.map((piece) => (
        <span
          key={piece.id}
          style={{
            left: `${piece.left}%`,
            fontSize: `${piece.size}px`,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            ["--zoo-drift" as string]: `${piece.drift}px`
          }}
        >
          {piece.emoji}
        </span>
      ))}
    </div>
  );
}
