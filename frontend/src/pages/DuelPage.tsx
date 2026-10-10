import { useCallback, useEffect, useRef, useState } from "react";
import { Play, RefreshCw, Share2 } from "lucide-react";
import { CapybaraWalk, Sticker } from "../components/CapybaraMascot";
import { MascotSay } from "../components/MascotSay";
import { TimerRing } from "../components/TimerRing";
import { QuestionCard } from "../features/vocab-test/QuestionCard";
import { buildDuelQuestions, duelDuration, duelShareTitle, ensureDuelToken, readDuelToken } from "../lib/duel";
import { duelSharePath } from "../lib/duel-links";
import { compareDuelScores, type DuelAnswer, type DuelQuestion, type DuelScore } from "../lib/team-rules";
import {
  claimCloudDuel, createCloudDuel, getCloudDuel, getMyCloudDuels, submitCloudDuel,
  type CloudDuel, type CloudSession
} from "../lib/sync-api";
import { collectTeamRewards } from "../lib/team-activity";
import { shareText } from "../lib/share-text";
import { pageShareButtonProps, usePageShare } from "../lib/page-share";
import { VOCAB_TEST_LEVELS, type VocabTestAnswerState } from "../lib/vocab-test";
import { useStudyActivity } from "../hooks/useStudyActivity";
import "./team-duel.css";

type Run = { levels: string[]; questions: DuelQuestion[]; answers: DuelAnswer[] };
type Feedback = { question: DuelQuestion; state: VocabTestAnswerState; selected: number | null };
const messageFor = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后再试。";

export function DuelPage({ id, session, onRequireAccount, onOpen }: {
  id: string | null;
  session: CloudSession;
  onRequireAccount: () => void;
  onOpen: (id: string | null) => void;
}) {
  const [levels, setLevels] = useState<string[]>(["N3"]);
  const [count, setCount] = useState(20);
  const [duel, setDuel] = useState<CloudDuel | null>(null);
  const [list, setList] = useState<CloudDuel[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const runRef = useRef<Run | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const startedAt = useRef(0);
  const hiddenAt = useRef<number | null>(null);
  const answerLocked = useRef(false);
  const shareCard = duel && !run ? { title: duelShareTitle(duel), path: duelSharePath(duel.id) } : null;
  usePageShare(shareCard);

  const beginRun = useCallback((next: Run) => {
    runRef.current = next;
    setRun(next);
    setFeedback(null);
    answerLocked.current = false;
    startedAt.current = Date.now();
    hiddenAt.current = pausedRef.current ? Date.now() : null;
    setRemaining(next.questions[0].limitMs / 1000);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!id) {
          if (session.token) {
            const duels = await getMyCloudDuels();
            if (active) setList(duels);
          }
          return;
        }
        const token = readDuelToken(id);
        let current = await getCloudDuel(id, token);
        if (active) setDuel(current);
        if (session.token && current.role === "opponent" && !current.opponentLinked && token) {
          current = await claimCloudDuel(id, token);
        }
        if (!active) return;
        setDuel(current);
        if (current.available && current.role !== "creator" && !runRef.current) {
          ensureDuelToken(id);
        }
      } catch (error) {
        if (active) setNotice(messageFor(error));
      } finally {
        if (active) setLoading(false);
        if (active && session.token) void collectTeamRewards().catch(() => undefined);
      }
    })();
    return () => { active = false; };
  }, [id, session.token]);

  useStudyActivity({
    onInteraction: () => undefined,
    onVisibilityChange: (visible) => {
      pausedRef.current = !visible;
      setPaused(!visible);
      if (!visible && hiddenAt.current === null) hiddenAt.current = Date.now();
      if (visible && hiddenAt.current !== null) {
        startedAt.current += Date.now() - hiddenAt.current;
        hiddenAt.current = null;
      }
    },
    onLeave: () => undefined
  });

  const choose = useCallback((selected: number | "unknown" | "timeout") => {
    const current = runRef.current;
    if (!current || answerLocked.current || busyRef.current || pausedRef.current) return;
    const question = current.questions[current.answers.length];
    if (!question) return;
    answerLocked.current = true;
    const elapsed = Math.max(0, Date.now() - startedAt.current);
    const choice = elapsed >= question.limitMs ? "timeout" : selected;
    const answer: DuelAnswer = { selected: choice, responseMs: choice === "timeout" ? question.limitMs : Math.min(question.limitMs, elapsed) };
    const next = { ...current, answers: [...current.answers, answer] };
    runRef.current = next;
    setRun(next);
    setFeedback({ question, state: typeof choice === "number" ? choice === question.answerIndex ? "correct" : "wrong" : choice, selected: typeof choice === "number" ? choice : null });
  }, []);

  useEffect(() => {
    if (!run || feedback || paused || busy) return;
    const question = run.questions[run.answers.length];
    if (!question) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((question.limitMs - (Date.now() - startedAt.current)) / 1000));
      setRemaining(seconds);
      if (!seconds) choose("timeout");
    };
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [run, feedback, paused, busy, choose]);

  useEffect(() => {
    if (!run || feedback) return;
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement)?.tagName ?? "")) return;
      if (event.key.toLowerCase() === "u") { event.preventDefault(); choose("unknown"); }
      else if (/^[1-4]$/.test(event.key)) { event.preventDefault(); choose(Number(event.key) - 1); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [run, feedback, choose]);

  const start = () => {
    if (!session.token) { onRequireAccount(); return; }
    setNotice("");
    try { beginRun({ levels, questions: buildDuelQuestions(levels, count), answers: [] }); }
    catch (error) { setNotice(messageFor(error)); }
  };

  const startAnswering = async () => {
    if (!id || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    try {
      const current = await getCloudDuel(id, readDuelToken(id));
      setDuel(current);
      if (!current.available || current.role === "creator") return;
      ensureDuelToken(id);
      beginRun({ levels: current.levels, questions: current.questions, answers: [] });
    } catch (error) { setNotice(messageFor(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const finish = async () => {
    const current = runRef.current;
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    try {
      const result = id
        ? await submitCloudDuel(id, current.answers, ensureDuelToken(id))
        : await createCloudDuel({ levels: current.levels, questionCount: current.questions.length, questions: current.questions, answers: current.answers });
      setDuel(result);
      runRef.current = null;
      setRun(null);
      setFeedback(null);
      if (!id) onOpen(result.id);
      if (session.token) await collectTeamRewards().catch(() => undefined);
    } catch (error) {
      setNotice(messageFor(error));
      // A concurrent responder can take the slot while this device is answering.
      if (id) {
        const currentDuel = await getCloudDuel(id, readDuelToken(id)).catch(() => null);
        if (currentDuel && !currentDuel.available) {
          setDuel(currentDuel);
          runRef.current = null;
          setRun(null);
          setFeedback(null);
        }
      }
    } finally { busyRef.current = false; setBusy(false); }
  };

  const next = () => {
    if (!run) return;
    if (run.answers.length === run.questions.length) { void finish(); return; }
    // The next clock starts after dismissing feedback, so reading the answer costs no time.
    startedAt.current = Date.now();
    hiddenAt.current = pausedRef.current ? Date.now() : null;
    setRemaining(run.questions[run.answers.length].limitMs / 1000);
    setFeedback(null);
    answerLocked.current = false;
  };

  const share = async (current: CloudDuel) => {
    try {
      const path = duelSharePath(current.id);
      const link = new URL(path, window.location.origin).href;
      await shareText("收集日单词挑战", `${duelShareTitle(current)}\n${link}`);
      setNotice("挑战链接已准备好。");
    } catch (error) { setNotice(messageFor(error)); }
  };

  const refreshResult = async () => {
    if (!id || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    try {
      const token = readDuelToken(id);
      let current = await getCloudDuel(id, token);
      if (session.token && current.role === "opponent" && !current.opponentLinked && token) {
        current = await claimCloudDuel(id, token);
      }
      setDuel(current);
      if (session.token) await collectTeamRewards();
    } catch (error) { setNotice(messageFor(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const noticeView = notice ? <MascotSay sticker="mood-puzzled" tone="warn" className="ds-say-onbg" size={44}><span role="status">{notice}</span></MascotSay> : null;
  if (loading) return <div className="duel-page"><CapybaraWalk size={48} /><p>正在打开挑战…</p></div>;

  if (run) {
    const question = feedback?.question ?? run.questions[run.answers.length];
    return <div className="duel-page">
      <div className="vt-quiz-top">
        <div className="min-w-0 flex-1"><p className="vt-count"><b>{run.answers.length}</b> / {run.questions.length}</p><div className="ds-bar mt-1.5"><i style={{ width: `${run.answers.length / run.questions.length * 100}%` }} /></div></div>
        <TimerRing remaining={remaining} total={question.limitMs / 1000} paused={paused || Boolean(feedback)} />
        <button className="ds-chip focus-ring" disabled={busy} onClick={() => void finish()}>{busy ? "交卷中…" : "提前交卷"}</button>
      </div>
      <QuestionCard question={question} disabled={Boolean(feedback) || paused || busy} feedback={feedback} onChoose={(selected) => choose(selected ?? "unknown")} next={{ label: busy ? "交卷中…" : run.answers.length === run.questions.length ? "交卷" : "下一题", onClick: next }} />
      {feedback && <MascotSay sticker={feedback.state === "correct" ? "mood-yay" : "mood-puzzled"} tone={feedback.state === "correct" ? "good" : "warn"} className="ds-say-onbg" size={52}>
        {feedback.state === "correct" ? "答对了！" : feedback.state === "unknown" ? "记为不认识" : feedback.state === "timeout" ? "超时了" : "这题选错了"}
        {feedback.state !== "correct" && <> · 答案是「{question.answer}」</>}
      </MascotSay>}
      {paused && <MascotSay sticker="mood-sleep" className="ds-say-onbg" size={44}>回来就继续。</MascotSay>}
      {noticeView}
    </div>;
  }

  if (id) {
    if (!duel) return <div className="duel-page">{noticeView}<button className="ds-btn-soft" onClick={() => onOpen(null)}>发起新对战</button></div>;
    if (duel.role === "spectator" && !duel.available) return <div className="duel-page">
      <section className="ds-card duel-unavailable">
        <Sticker name="mood-puzzled" size={104} />
        <h2>这局已经有人应战了</h2>
        <button className="ds-btn" onClick={() => onOpen(null)}>自己发起一局</button>
      </section>
      {noticeView}
    </div>;
    if (duel.role !== "creator" && duel.available) return <div className="duel-page">
      <section className="ds-card duel-intro">
        <Sticker name="mood-cheer" size={112} />
        <h2>{duel.creatorName} 向你发起挑战</h2>
        <p className="duel-meta">{duel.levels.join(" / ")} · {duel.questionCount} 题</p>
        <p className="duel-intro-score">答对 {duel.creatorScore.correct} · 用时 {duelDuration(duel.creatorScore.totalMs)}</p>
        <button className="ds-btn" disabled={busy} onClick={() => void startAnswering()}>开始应战</button>
      </section>
      {noticeView}
    </div>;
    const result = duel.opponentScore ? duel.winner ?? compareDuelScores(duel.creatorScore, duel.opponentScore) : null;
    const won = result && result !== "draw" && result === duel.role;
    const label = !result ? "挑战已发出" : result === "draw" ? "平局" : won ? "你赢了" : "这次输了";
    return <div className="duel-page">
      <section className="ds-card duel-result">
        <Sticker name={won ? "mood-yay" : result === "draw" ? "mood-default" : result ? "mood-cheer" : "mood-proud"} size={90} />
        <h2>{label}</h2><p className="duel-meta">{duel.levels.join(" / ")} · {duel.questionCount} 题</p>
        <div className="duel-scoreboard"><Score label={duel.role === "creator" ? "你" : duel.creatorName} score={duel.creatorScore} /><Score label={duel.role === "opponent" ? "你" : "对手"} score={duel.opponentScore} /></div>
        {!duel.opponentScore && <p className="duel-meta">等一个人来应战</p>}
        {duel.opponentScore && !duel.winner && duel.role === "creator" && <p className="duel-meta">等对方登录确认</p>}
        {duel.winner && won && <p className="duel-reward">每周首胜 +150 柚子</p>}
        {duel.role === "opponent" && !duel.opponentLinked && <button className="ds-btn" disabled={busy} onClick={() => session.token ? void refreshResult() : onRequireAccount()}>{session.token ? "确认结果" : won ? "登录领取奖励" : result === "draw" ? "登录确认结果" : "登录，帮 ta 拿到奖励"}</button>}
        {duel.role === "creator" && duel.available && shareCard && <button className="ds-btn" {...pageShareButtonProps(shareCard, () => void share(duel))}><Share2 size={16} /> 分享挑战</button>}
        <div className="duel-actions"><button className="ds-btn-soft" onClick={() => onOpen(null)}>再开一局</button><button className="ds-btn-soft" disabled={busy} onClick={() => void refreshResult()}><RefreshCw size={14} /> 刷新结果</button></div>
      </section>
      {noticeView}
    </div>;
  }

  return <div className="duel-page">
    <section className="ds-card duel-setup">
      <div className="duel-heading"><div><h2>同一套词，来比一场</h2><p className="duel-meta">选级别，答完就能发出挑战</p></div><Sticker name="mood-cheer" size={76} /></div>
      <div role="group" aria-label="对战级别" className="duel-settings"><b>级别</b><div className="duel-actions">{VOCAB_TEST_LEVELS.map((level) => <button key={level} className="ds-chip" aria-pressed={levels.includes(level)} onClick={() => setLevels((current) => current.includes(level) ? current.filter((item) => item !== level) : [...current, level])}>{level}</button>)}</div></div>
      <div role="group" aria-label="对战题数" className="duel-settings"><b>题数</b><div className="duel-actions">{[10, 20, 30].map((value) => <button key={value} className="ds-chip" aria-pressed={count === value} onClick={() => setCount(value)}>{value} 题</button>)}</div></div>
      <button className="ds-btn" disabled={!levels.length} onClick={start}><Play size={16} /> {session.token ? "开始答题" : "登录发起对战"}</button>
    </section>
    {noticeView}
    {list.length > 0 && <section className="ds-card duel-list"><h2>我的对战</h2>{list.map((item) => <button key={item.id} className="duel-list-item" onClick={() => onOpen(item.id)}><span>{item.levels.join(" / ")} · {item.questionCount} 题</span><b>{item.available ? "待应战" : !item.winner ? "待登录" : item.winner === "draw" ? "平局" : item.winner === item.role ? "赢了" : "输了"}</b></button>)}</section>}
  </div>;
}

function Score({ label, score }: { label: string; score: DuelScore | null }) {
  return <div className="duel-score"><span>{label}</span><b>{score ? `${score.correct} 题` : "—"}</b>{score && <small>{score.answered} 题已答 · {score.answered ? Math.round(score.correct / score.answered * 100) : 0}% · {duelDuration(score.totalMs)}</small>}</div>;
}
