import type { Moment } from "../lib/moments";

/**
 * 时刻的样子:大数字旁边蹦一下的小条,几秒后自己走。
 * 绝对定位,不挤大数字的版 —— 样式见 master-home.css 的 .moment-pop。
 */
export function MomentPop({ moment, leaving }: { moment: Moment | null; leaving: boolean }) {
  if (!moment) return null;
  return (
    <span className={`moment-pop ${leaving ? "leaving" : ""}`} role="status">
      {moment.text}
    </span>
  );
}
