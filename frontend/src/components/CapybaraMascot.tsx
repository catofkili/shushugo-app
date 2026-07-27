/**
 * 水豚(カピバラ)マスコット — 外部依存なしのインラインSVG。
 * 明るい動物園テーマのブランドキャラクター。頭に柚子を乗せた定番ポーズ。
 * mood でちょっとした表情差分（学習の空/完了状態などで使い分け）。
 */
type Mood = "happy" | "sleepy" | "cheer";

export function CapybaraMascot({
  size = 96,
  mood = "happy",
  className = ""
}: {
  size?: number;
  mood?: Mood;
  className?: string;
}) {
  const eyeRy = mood === "sleepy" ? 0.6 : 3.4;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      role="img"
      aria-label="水豚マスコット"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 柚子(頭のみかん) */}
      <ellipse cx="60" cy="20" rx="12" ry="10.5" fill="#F5A623" />
      <ellipse cx="60" cy="20" rx="12" ry="10.5" fill="url(#yuzuShine)" />
      <path d="M60 10.5c1.6-3.4 5-4.6 8-3.6-1.2 3-3.8 4.6-6.6 4.8z" fill="#8FCB5E" />
      <path d="M60 11c-.4-1.6-.2-3 .8-4.2" stroke="#6FA83E" strokeWidth="1.6" strokeLinecap="round" />

      {/* 耳 */}
      <ellipse cx="34" cy="44" rx="9" ry="8" fill="#9C6B3F" />
      <ellipse cx="86" cy="44" rx="9" ry="8" fill="#9C6B3F" />
      <ellipse cx="34" cy="45" rx="4.5" ry="4" fill="#7A5230" />
      <ellipse cx="86" cy="45" rx="4.5" ry="4" fill="#7A5230" />

      {/* 顔・体 */}
      <path
        d="M26 64c0-19 15-30 34-30s34 11 34 30c0 20-15 33-34 33S26 84 26 64z"
        fill="#C08552"
      />
      <path
        d="M26 64c0-19 15-30 34-30s34 11 34 30c0 20-15 33-34 33S26 84 26 64z"
        fill="url(#bodyShine)"
      />

      {/* 口元(明るいマズル) */}
      <ellipse cx="60" cy="78" rx="22" ry="17" fill="#D9A472" />

      {/* 目 */}
      <ellipse cx="47" cy="63" rx="3.4" ry={eyeRy} fill="#3A2E22" />
      <ellipse cx="73" cy="63" rx="3.4" ry={eyeRy} fill="#3A2E22" />
      {mood !== "sleepy" && (
        <>
          <circle cx="48.2" cy="61.6" r="1.1" fill="#FFF7EA" />
          <circle cx="74.2" cy="61.6" r="1.1" fill="#FFF7EA" />
        </>
      )}

      {/* ほっぺ */}
      <ellipse cx="41" cy="74" rx="5" ry="3.4" fill="#F2A6A0" opacity="0.55" />
      <ellipse cx="79" cy="74" rx="5" ry="3.4" fill="#F2A6A0" opacity="0.55" />

      {/* 鼻 */}
      <ellipse cx="60" cy="74" rx="7" ry="5" fill="#7A5230" />
      <ellipse cx="57" cy="72.5" rx="1.5" ry="1.1" fill="#3A2E22" />
      <ellipse cx="63" cy="72.5" rx="1.5" ry="1.1" fill="#3A2E22" />

      {/* 口 */}
      {mood === "cheer" ? (
        <path d="M52 84c4 5 12 5 16 0" stroke="#7A5230" strokeWidth="2.4" strokeLinecap="round" />
      ) : (
        <path d="M60 78v5m-5 3c3 2.6 7 2.6 10 0" stroke="#7A5230" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      )}

      <defs>
        <linearGradient id="bodyShine" x1="60" y1="34" x2="60" y2="97" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.28" />
          <stop offset="0.4" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="1" stopColor="#7A5230" stopOpacity="0.18" />
        </linearGradient>
        <radialGradient id="yuzuShine" cx="0.35" cy="0.3" r="0.8">
          <stop stopColor="#FFFFFF" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}
