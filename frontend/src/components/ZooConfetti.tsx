import { useEffect, useState } from "react";

/**
 * 完成今日计划时的纸屑。2026-09-16 动物园主题退场后换成通用彩带,动物列队删掉。
 * CSS 彩纸片只用 transform/opacity,飘完自己卸载,闲时零开销。
 * 动效档位为 off 或系统开了「减少动态效果」时,CSS 会把它压成一瞬(见 app.css)。
 */

const SHAPES = ["rect", "circle", "strip"] as const;

/** 飘完就卸载,比留着一堆不动的节点干净 */
const LIFETIME_MS = 3200;

interface Piece {
  id: number;
  shape: typeof SHAPES[number];
  left: number;
  delay: number;
  duration: number;
  drift: number;
  size: number;
  rotation: number;
  color: number;
}

interface Burst {
  pieces: Piece[];
}

/**
 * 随机只在 effect 里摇一次。
 * 不放 useMemo:useMemo 只是缓存提示,React 允许丢弃重算,重算就会中途换一批纸屑。
 */
const rollBurst = (count: number): Burst => ({
  pieces: Array.from({ length: count }, (_, index) => ({
    id: index,
    shape: SHAPES[index % SHAPES.length],
    left: Math.round(Math.random() * 92 + 4),
    delay: Math.random() * 0.9,
    duration: 1.9 + Math.random() * 1.1,
    drift: Math.round((Math.random() - 0.5) * 120),
    size: 7 + Math.round(Math.random() * 7),
    rotation: Math.round(Math.random() * 360),
    color: Math.floor(Math.random() * 5)
  }))
});

export function ZooConfetti({ count = 16 }: { count?: number }) {
  const [burst, setBurst] = useState<Burst | null>(null);

  useEffect(() => {
    const rolled = rollBurst(count);
    setBurst(rolled);
    const timer = window.setTimeout(() => setBurst(null), LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [count]);

  if (!burst) return null;

  return (
    <div className="zoo-confetti" aria-hidden="true">
      {burst.pieces.map((piece) => (
        <span
          key={piece.id}
          style={{
            left: `${piece.left}%`,
            width: piece.shape === "strip" ? "3px" : `${piece.size}px`,
            height: `${Math.round(piece.size * (piece.shape === "strip" ? 1.8 : 1.15))}px`,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            ["--zoo-drift" as string]: `${piece.drift}px`,
            ["--zoo-rotation" as string]: `${piece.rotation}deg`
          }}
          className={`zoo-confetti-piece zoo-confetti-${piece.shape} zoo-confetti-color-${piece.color}`}
        />
      ))}
    </div>
  );
}
