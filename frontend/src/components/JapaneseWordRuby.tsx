import { splitFurigana, useFuriganaReady } from "../lib/furigana";

interface JapaneseWordRubyProps {
  surface: string;
  reading: string;
  className?: string;
}

/**
 * 疑难辨析里的词形：汉字上方标对应假名，表记本身仍保持原样。
 * 读音表是异步加载的，加载前先显示词形，加载后再补 ruby，避免阻塞卡片打开。
 */
export const JapaneseWordRuby = ({ surface, reading, className }: JapaneseWordRubyProps) => {
  const ready = useFuriganaReady();
  const segments = ready ? splitFurigana(surface, reading) : null;

  return (
    <span className={className}>
      {segments
        ? segments.map((segment, index) => (
          segment.isKanji
            ? (
              <ruby className="jp-ruby" key={`${segment.text}-${segment.reading}-${index}`}>
                {segment.text}
                <rt>{segment.reading}</rt>
              </ruby>
            )
            : <span key={`${segment.text}-${index}`}>{segment.text}</span>
        ))
        : surface}
    </span>
  );
};
