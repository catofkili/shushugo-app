import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import type { WordCard } from "../../types/vocabulary";
import { playPronunciation } from "../../lib/speech";
import { isListeningReverseCard } from "./listening-card";

export function useListeningReverseCard(card: WordCard | null, phase: string, cardKey: string, voiceId: string, promptVisible: boolean) {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const playedKey = useRef<string | null>(null);
  const candidate = Boolean(card && phase === "stage2" && isListeningReverseCard(card));
  const active = candidate && failedKey !== cardKey;
  const replay = useCallback(() => {
    if (!card) return;
    void playPronunciation(card.kanji, card.kana, voiceId).catch(() => {
      // 上一张的迟到失败不能把新题退回看字。
      if (playedKey.current === cardKey) setFailedKey(cardKey);
    });
  }, [card, cardKey, voiceId]);

  useEffect(() => {
    if (!active || !promptVisible || playedKey.current === cardKey) return;
    // 声音就是题目，不受 autoPlay 控制；先记身份，防重渲染和 StrictMode 重播。
    playedKey.current = cardKey;
    replay();
  }, [active, cardKey, promptVisible, replay]);

  return { candidate, active, replay };
}

export function ListeningPrompt({ onReplay }: { onReplay: () => void }) {
  return (
    <div>
      <button
        type="button"
        aria-label="播放读音"
        className="focus-ring control-cyan inline-flex h-16 w-16 items-center justify-center rounded-full"
        onClick={event => { event.stopPropagation(); onReplay(); }}
      >
        <Volume2 size={32} aria-hidden="true" />
      </button>
      <p className="mt-1 text-sm text-white/55">听一听，是哪个词？</p>
    </div>
  );
}
