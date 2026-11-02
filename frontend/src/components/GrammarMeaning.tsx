import { parseMeaning } from "../lib/grammar-meaning";

/** 中文意。没有表格时和原来的 <p> 一模一样；有表格时用 div 网格画
 *  （⚠️ 不用 <table>：小程序的 Taro 模板没有这个标签，见 GrammarFoundationPage 的注释）。 */
export const GrammarMeaning = ({ meaning, className = "", ...rest }: {
  meaning: string;
  className?: string;
  [attr: `data-${string}`]: string | undefined;
}) => {
  const blocks = parseMeaning(meaning);
  if (!blocks.some((block) => "rows" in block)) return <p className={className} {...rest}>{meaning}</p>;
  return (
    <div className="space-y-2" {...rest}>
      {blocks.map((block, index) => {
        if ("text" in block) return <p key={index} className={className}>{block.text}</p>;
        const columns = Math.max(...block.rows.map((row) => row.length));
        return (
          <div key={index} className="jp grid text-sm sm:text-base" style={{ gridTemplateColumns: `repeat(${columns}, auto)` }}>
            {block.rows.flatMap((row, rowIndex) =>
              Array.from({ length: columns }, (_, col) => (
                <div
                  key={`${rowIndex}-${col}`}
                  className={`min-w-0 break-words border-t border-white/15 px-1.5 py-1.5 text-center leading-6 ${
                    rowIndex === 0 ? "text-xs font-bold text-white/55" : "text-white/90"
                  }`}
                >
                  {row[col] ?? ""}
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
};
