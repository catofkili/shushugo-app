import { useEffect, useState } from "react";
import { History, ListChecks, Play } from "lucide-react";
import { CapybaraWalk, Sticker } from "../components/CapybaraMascot";
import { MascotSay } from "../components/MascotSay";
import { DrillSession, MockSession } from "../features/jlpt-practice/Sessions";
import { PracticeResult } from "../features/jlpt-practice/Result";
import { getStudyPreferences } from "../lib/studyPreferences";
import {
  JLPT_LEVELS, JLPT_PRACTICE_MARKER, KIND_LABEL, jlptKindStats, loadJlptBank,
  mistakeQuestions, mockParts, pickDrillQuestions,
  type JlptAnswer, type JlptBank, type JlptKind, type JlptLevel, type JlptMockPart, type JlptQuestion
} from "../lib/jlpt-practice";

type Session =
  | { mode: "drill"; kind: JlptKind; questions: JlptQuestion[]; id: string }
  | { mode: "mistakes"; questions: JlptQuestion[]; id: string }
  | { mode: "mock"; setId: string; parts: JlptMockPart[]; questions: JlptQuestion[]; id: string };

const newSessionId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function JlptPracticePage() {
  const [level, setLevel] = useState<JlptLevel>(() => getStudyPreferences().jlptTarget || "N3");
  const [bank, setBank] = useState<JlptBank | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<JlptAnswer[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await loadJlptBank(level);
        if (!cancelled) { setBank(loaded); setLoading(false); }
      } catch {
        if (!cancelled) { setError("题库没加载好。再试一次。"); setLoading(false); }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [level, reload]);

  const changeLevel = (next: JlptLevel) => {
    if (next === level) return;
    setBank(null);
    setLoading(true);
    setError("");
    setLevel(next);
  };
  const back = () => { setSession(null); setResult(null); setError(""); };
  const start = (mode: "drill" | "mistakes" | "mock", kind?: JlptKind, setId?: string) => {
    if (!bank) return;
    try {
      const id = newSessionId();
      let next: Session;
      if (mode === "mock" && setId) {
        const parts = mockParts(bank, setId).filter(part => part.questions.length > 0);
        next = { mode, setId, parts, questions: parts.flatMap(part => part.questions), id };
      } else if (mode === "drill" && kind) {
        next = { mode, kind, questions: pickDrillQuestions(bank, kind), id };
      } else if (mode === "mistakes") {
        next = { mode, questions: mistakeQuestions(bank), id };
      } else return;
      if (!next.questions.length) { back(); return; }
      setError("");
      setResult(null);
      setSession(next);
    } catch { setError("练习没打开。再试一次。"); }
  };
  const restart = () => {
    if (!session) return;
    start(session.mode, session.mode === "drill" ? session.kind : undefined, session.mode === "mock" ? session.setId : undefined);
  };
  // 切等级后，旧题库不出现一帧，也不会被迟到的加载请求覆盖。
  const activeBank = bank?.level === level ? bank : null;
  const stats = activeBank && !session ? jlptKindStats(activeBank) : [];
  const mistakes = stats.reduce((sum, stat) => sum + stat.mistakes, 0);

  return <div className="jq-page" data-jlpt-practice={JLPT_PRACTICE_MARKER}>
    {session && activeBank ? <>
      {error ? <>
        <MascotSay sticker="mood-puzzled" tone="warn" className="ds-say-onbg">{error}</MascotSay>
        <div className="jq-actions"><button type="button" className="ds-btn jq-grow focus-ring" onClick={restart}>重试</button><button type="button" className="ds-btn-soft jq-grow focus-ring" onClick={back}>回到列表</button></div>
      </> : result ? <PracticeResult key={`${session.id}-result`} bank={activeBank} questions={session.questions} answers={result} mock={session.mode === "mock"} onRestart={restart} onBack={back} />
        : session.mode === "mock" ? <MockSession key={session.id} bank={activeBank} parts={session.parts} sessionId={session.id} onDone={setResult} onBack={back} />
          : <DrillSession key={session.id} bank={activeBank} questions={session.questions} mode={session.mode} sessionId={session.id} onDone={setResult} onBack={back} />}
    </> : <>
      <div className="jq-head"><h1 className="jq-title">JLPT 刷题</h1><span className="jq-muted">实验功能</span></div>
      <div className="jq-levels" aria-label="等级">
        {JLPT_LEVELS.map(item => <button type="button" key={item} className="ds-chip focus-ring" aria-pressed={level === item} onClick={() => changeLevel(item)}>{item}</button>)}
      </div>
      {loading ? <div className="jq-empty" role="status"><CapybaraWalk size={64} /><span>加载题库</span></div>
        : error ? <>
          <MascotSay sticker="mood-puzzled" tone="warn" className="ds-say-onbg">{error}</MascotSay>
          <button type="button" className="ds-btn jq-wide focus-ring" onClick={() => { setError(""); setLoading(true); setReload(reload + 1); }}>重试</button>
        </> : activeBank && (activeBank.questions.length === 0 ? <div className="jq-empty"><Sticker name="empty-box" size={72} /><span>这一级还没有题</span></div> : <>
          <section className="ds-card jq-card jq-stack">
            <h2 className="jq-heading"><ListChecks size={18} />按题型练</h2>
            {stats.map(stat => <button type="button" key={stat.kind} className="jq-list-row focus-ring" onClick={() => start("drill", stat.kind)}>
              <span className="jq-row-title">{KIND_LABEL[stat.kind]}</span>
              <span className="jq-row-meta"><span>答过 {stat.done} / 共 {stat.total}</span><span>正确率 {stat.done ? `${Math.round(stat.correct / stat.done * 100)}%` : "—"}</span></span>
            </button>)}
          </section>
          {mistakes > 0 && <button type="button" className="ds-btn-soft jq-mistakes focus-ring" onClick={() => start("mistakes")}><History size={18} /><span className="jq-grow">错题本</span><span>{mistakes} 题</span></button>}
          <section className="ds-card jq-card jq-stack">
            <h2 className="jq-heading"><Play size={18} />模拟卷</h2>
            {activeBank.sets.map(set => {
              const parts = mockParts(activeBank, set.id);
              const count = parts.reduce((sum, part) => sum + part.questions.length, 0);
              const minutes = parts.reduce((sum, part) => sum + part.minutes, 0);
              return <button type="button" key={set.id} disabled={count === 0} className="jq-list-row focus-ring" onClick={() => start("mock", undefined, set.id)}>
                <span className="jq-row-title">{set.title}</span><span className="jq-row-meta">{count} 题 · 建议 {minutes} 分钟</span>
              </button>;
            })}
          </section>
        </>)}
    </>}
  </div>;
}
