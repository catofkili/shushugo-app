import type { ReactNode } from "react";
import { subgroupRuns } from "../lib/confusion-subgroups";
import type { Transitivity } from "../lib/transitivity";

/**
 * 辨析成员按手写小组分框显示。三处（辨析卡答案面、疑难辨析页大卡、学习页辨析气泡）共用 ——
 * 框和自他标签的样式只有 styles.css 里 .sg-* 这一份，靠 currentColor 适配深浅两套皮。
 *
 * 没有小组标题的组照旧平铺，不套框：两个词的组再画一个框只是多一层线。
 */
export const VoiceTag = ({ voice }: { voice: Transitivity | null }) => {
  if (!voice) return null;
  const tone = voice === "自" ? "vi" : voice === "他" ? "vt" : "both";
  // 写全「自动词」：只写「自动」在中文里读成「自动化」的自动
  return <span className={`sg-voice sg-voice-${tone}`}>{voice === "自他" ? "自他两用" : `${voice}动词`}</span>;
};

export const SubgroupedMembers = <T extends { subgroup: string }>({
  items,
  className,
  render,
  wordOf
}: {
  items: readonly T[];
  /** 成员列表容器原来的 class（cf-members / wd-members / …），小组内照用 */
  className: string;
  render: (item: T) => ReactNode;
  /** 给了就在最上面摆一张速览：一行一个小组、只列词形。七八个词的组要先看见全貌，
   *  否则往下翻到第三个框时已经忘了第一个框分的是什么 */
  wordOf?: (item: T) => string;
}) => {
  const runs = subgroupRuns(items);
  if (runs.every((run) => !run.title)) return <div className={className}>{items.map(render)}</div>;
  return (
    <div className="sg-list">
      {wordOf && (
        <div className="sg-map">
          {runs.filter((run) => run.title).map((run, runIndex) => (
            <p key={run.title} className="sg-map-row">
              <span className="sg-index">{String.fromCharCode(65 + runIndex)}</span>
              <b>{run.title}</b>
              <span className="jp sg-map-words">{run.items.map(wordOf).join("・")}</span>
            </p>
          ))}
        </div>
      )}
      {runs.map((run, runIndex) => {
        if (!run.title) return <div key={`rest-${runIndex}`} className={className}>{run.items.map(render)}</div>;
        return (
          <section key={run.title} className="sg-group">
            <p className="sg-head">
              <span className="sg-index">{/* 无标题的那段只会排在最后（placeMembers），所以序号直接用位置 */}
              {String.fromCharCode(65 + runIndex)}</span>
              <span>{run.title}</span>
            </p>
            <div className={className}>{run.items.map(render)}</div>
          </section>
        );
      })}
    </div>
  );
};
