// 今日 ML 任务贴纸（Übersicht 小组件）
// 课表在 plan.json，完成记录写在 ~/.ml-today/log.txt（重装小组件不会丢进度）。
// 课表是一条队列：没做完的那天不会过期，第二天接着显示；做完当天的就显示「今天完成」，明天才放下一天。
import { run } from "uebersicht";

const LOG = '"$HOME/.ml-today/log.txt"';

export const command = `cat ml-today.widget/plan.json; printf '\\n@@@\\n'; cat ${LOG} 2>/dev/null; true`;

export const refreshFrequency = 5 * 60 * 1000;

export const className = `
  top: 40px;
  right: 40px;
  width: 340px;
  font-family: -apple-system, "PingFang SC", sans-serif;
  color: #1f2328;
  background: rgba(255, 248, 225, 0.94);
  border-radius: 16px;
  padding: 16px 18px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  -webkit-user-select: none;

  .head { font-size: 12px; color: #8a6d1f; display: flex; justify-content: space-between; }
  .title { font-size: 17px; font-weight: 600; margin: 4px 0 12px; }
  .task { display: flex; gap: 10px; padding: 8px 0; border-top: 1px dashed rgba(0,0,0,0.12); cursor: pointer; }
  .box { flex: none; width: 18px; height: 18px; border-radius: 5px; border: 2px solid #c79a2b; margin-top: 2px;
         display: flex; align-items: center; justify-content: center; font-size: 13px; color: white; }
  .box.on { background: #c79a2b; }
  .t { font-size: 14px; font-weight: 500; }
  .done .t { text-decoration: line-through; color: #8c8c8c; }
  .d { font-size: 12px; color: #57606a; margin-top: 3px; line-height: 1.45; }
  .meta { font-size: 11px; color: #a08540; margin-top: 3px; }
  .link { color: #0969da; cursor: pointer; margin-left: 6px; }
  .finish { font-size: 14px; padding: 10px 0 2px; color: #2d7a3a; font-weight: 500; }
  .err { font-size: 12px; color: #b42318; white-space: pre-wrap; }
`;

const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function parse(output) {
  const [planText, logText = ""] = output.split("\n@@@\n");
  const plan = JSON.parse(planText);
  const done = new Map(); // 任务 id -> 完成日期
  for (const line of logText.split("\n")) {
    const [id, date] = line.trim().split("\t");
    if (!id) continue;
    if (id.startsWith("-")) done.delete(id.slice(1));
    else done.set(id, date);
  }
  return { plan, done };
}

const dayDone = (day, done) => day.tasks.every((t) => done.has(t.id));
const lastDate = (day, done) => day.tasks.map((t) => done.get(t.id) || "").sort().pop();

function pickDay(plan, done, today) {
  const next = plan.days.findIndex((day) => !dayDone(day, done));
  const prev = next === -1 ? plan.days.length - 1 : next - 1;
  // 今天刚做完一整天的量：停在这一天，不提前放下一天
  if (prev >= 0 && lastDate(plan.days[prev], done) === today) return prev;
  return next;
}

function streak(done, today) {
  const dates = new Set(done.values());
  const d = new Date();
  if (!dates.has(today)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (dates.has(dateKey(d))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

const refresh = (dispatch) =>
  run(command).then((output) => dispatch({ type: "UB/COMMAND_RAN", output }));

function toggle(id, isDone, dispatch) {
  const line = isDone ? `'-${id}'` : `'${id}\\t${dateKey()}'`;
  run(`mkdir -p "$HOME/.ml-today" && printf "%b\\n" ${line} >> ${LOG}`).then(() => refresh(dispatch));
}

export const render = ({ output, error }, dispatch) => {
  if (error) return <div className="err">{String(error)}</div>;
  if (!output) return <div className="d">加载中…</div>;

  let parsed;
  try {
    parsed = parse(output);
  } catch (e) {
    return <div className="err">plan.json 读不出来：{String(e)}</div>;
  }
  const { plan, done } = parsed;
  const today = dateKey();
  const idx = pickDay(plan, done, today);

  if (idx === -1) {
    return <div className="finish">🎓 整份课表做完了！把进度发给 Claude，排下一阶段。</div>;
  }

  const day = plan.days[idx];
  const minutes = day.tasks.reduce((s, t) => s + (done.has(t.id) ? 0 : t.m || 0), 0);
  const allDone = dayDone(day, done);

  return (
    <div>
      <div className="head">
        <span>第 {idx + 1} / {plan.days.length} 天 · {plan.phases[day.phase]}</span>
        <span>🔥 {streak(done, today)}</span>
      </div>
      <div className="title">{day.review ? "复盘日" : "今天要做"}</div>
      {day.tasks.map((t) => {
        const isDone = done.has(t.id);
        return (
          <div key={t.id} className={`task ${isDone ? "done" : ""}`} onClick={() => toggle(t.id, isDone, dispatch)}>
            <div className={`box ${isDone ? "on" : ""}`}>{isDone ? "✓" : ""}</div>
            <div>
              <div className="t">{t.t}</div>
              {t.d ? <div className="d">{t.d}</div> : null}
              <div className="meta">
                约 {t.m} 分钟
                {t.url ? (
                  <span className="link" onClick={(e) => { e.stopPropagation(); run(`open '${t.url}'`); }}>
                    打开 ↗
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
      {allDone ? (
        <div className="finish">✅ 今天完成了，明天见。</div>
      ) : (
        <div className="meta">还剩约 {minutes} 分钟</div>
      )}
    </div>
  );
};
