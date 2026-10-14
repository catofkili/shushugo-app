import { useEffect, useState } from "react";
import { StreakFlame } from "./streak/StreakFlame";

export function ComboBadge({ combo }: { combo: number }) {
  const [shown, setShown] = useState(combo >= 3 ? combo : 0);
  if (combo >= 3 && combo !== shown) setShown(combo);
  useEffect(() => {
    if (combo >= 3 || shown < 3) return;
    const timer = setTimeout(() => setShown(0), 220);
    return () => clearTimeout(timer);
  }, [combo, shown]);
  if (shown < 3) return null;
  const milestone = [5, 10, 20].includes(shown);
  return <span className={`combo-badge${combo < 3 ? " combo-badge-leaving" : ""}`} aria-live="polite">
    <span key={shown} className={`combo-badge-content${milestone ? " combo-badge-milestone" : ""}`}>
      <StreakFlame state="lit" tier={shown >= 5 ? 2 : 1} size={20} />
      <span className="combo-badge-number">{shown}</span><span> 连对</span>
    </span>
  </span>;
}
