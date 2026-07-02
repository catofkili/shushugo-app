import { ExampleSentence as Example } from "../types/grammar";
import { JapaneseRuby } from "./JapaneseRuby";

interface ExampleSentenceProps {
  example: Example;
}

export const ExampleSentence = ({ example }: ExampleSentenceProps) => (
  <div className="dictionary-card rounded-2xl p-5">
    <p className="jp text-2xl font-semibold leading-relaxed text-[#343838] dark:text-[#f4efe4]">
      <JapaneseRuby text={example.jp ?? example.japanese} />
    </p>
    <p className="jp mt-2 text-sm text-[#81D8CF]">{example.reading}</p>
    <p className="mt-3 text-[#f9faf7] dark:text-zinc-300">{example.cn ?? example.chinese}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      {example.breakdown.map((note) => (
        <span
          key={`${example.jp ?? example.japanese}-${note.word ?? note.text}`}
          title={note.note}
          className="jp cursor-help rounded-sm border border-[#81D8CF] bg-[#81D8CF] px-3 py-1.5 text-sm text-[#f9faf7] dark:border-zinc-700 dark:bg-[#171611] dark:text-zinc-300"
        >
          <JapaneseRuby text={note.word ?? note.text} />
        </span>
      ))}
    </div>
  </div>
);
