import { useMemo, useState } from "react";
import { CapybaraMascot } from "../../src/components/CapybaraMascot";
import { playKnow, playDontKnow, playFlip, playComplete } from "../sounds";

/**
 * 核心学习循环原型:
 *  - 复习队列 = 松鼠捡松子路线。答对捡起松子(前进一步),答错松子掉成空壳并「绕回来再捡」
 *    (把该词重新排到队尾,和 FSRS「答错稍后再出」的机制完全同构)。
 *  - 认识 → 上行两音;不认识 → 柔和下行两音(不惩罚)。
 *  - 水豚随评分做 0.3s 微反应。
 * 符号先占位(🐿️🌰),日后替换为画师素材。
 */

type Word = { prompt: string; word: string; kana: string; meta: string };
type Status = "pending" | "got" | "dropped";
type Station = { word: Word; status: Status; requeued?: boolean };

const DECK: Word[] = [
  { prompt: "时间；钟点", word: "時間", kana: "じかん", meta: "名词 · N5" },
  { prompt: "方便的；便利的", word: "便利", kana: "べんり", meta: "な形容词 · N5" },
  { prompt: "挂；戴；打（电话）", word: "掛ける", kana: "かける", meta: "动词 · N4" },
  { prompt: "约定；约会", word: "約束", kana: "やくそく", meta: "名词 · N4" },
  { prompt: "安静的", word: "静か", kana: "しずか", meta: "な形容词 · N5" },
  { prompt: "习惯", word: "習慣", kana: "しゅうかん", meta: "名词 · N3" }
];

export function CoreLoop() {
  const [stations, setStations] = useState<Station[]>(
    DECK.map((word) => ({ word, status: "pending" }))
  );
  const [pos, setPos] = useState(0);
  const [shown, setShown] = useState(false);
  const [mood, setMood] = useState<"happy" | "cheer" | "sleepy">("happy");
  const [pulse, setPulse] = useState(0); // 触发松鼠跳跃动画
  // 被点评分按钮的即时反馈:idx=第几个按钮, kind=对/错 → 决定播哪种按钮动效
  const [feedback, setFeedback] = useState<{ idx: number; kind: "good" | "bad" } | null>(null);
  const [busy, setBusy] = useState(false); // 反馈动画播放中,锁住二次点击

  const done = pos >= stations.length;
  const current = done ? null : stations[pos];
  const gotCount = stations.filter((s) => s.status === "got").length;

  // 先播 0.36s 按钮反馈动画(认识=弹一下发光,不认识=轻轻摇头) + 音效 + 水豚表情,
  // 之后再真正翻页。让「按一下」本身有郑重的手感。
  const grade = (know: boolean, idx: number) => {
    if (done || busy) return;
    setBusy(true);
    setFeedback({ idx, kind: know ? "good" : "bad" });
    if (know) {
      playKnow();
      setMood("cheer");
    } else {
      playDontKnow();
      setMood("sleepy");
    }

    window.setTimeout(() => {
      setStations((prev) => {
        const next = prev.slice();
        next[pos] = { ...next[pos], status: know ? "got" : "dropped" };
        if (!know) {
          // 松子掉了 → 绕回来再捡:把这个词重新排到队尾
          next.push({ word: next[pos].word, status: "pending", requeued: true });
        }
        return next;
      });
      const nextPos = pos + 1;
      setPos(nextPos);
      setShown(false);
      setPulse((p) => p + 1);
      setFeedback(null);
      setBusy(false);
      setStations((cur) => {
        if (nextPos >= cur.length) {
          setMood("sleepy");
          playComplete();
        } else {
          setTimeout(() => setMood("happy"), 400);
        }
        return cur;
      });
    }, 360);
  };

  const reset = () => {
    setStations(DECK.map((word) => ({ word, status: "pending" })));
    setPos(0);
    setShown(false);
    setMood("happy");
    setFeedback(null);
    setBusy(false);
  };

  const reveal = () => {
    setShown((s) => !s);
    playFlip();
  };

  const rateClass = (idx: number) =>
    feedback?.idx === idx ? (feedback.kind === "good" ? " flash-good" : " flash-bad") : "";

  return (
    <div>
      <p className="kicker">CORE LOOP · 松鼠捡松子</p>
      <h2 className="section-title">复习一场 = 一条捡松子的小路</h2>

      {/* 松鼠路线 */}
      <SquirrelRoute stations={stations} pos={pos} pulse={pulse} />

      {/* 卡片(每张换词时重挂载 → 播放入场动画) */}
      <div key={done ? "done" : pos} className="lab-card cl-card cl-enter">
        {done ? (
          <div className="cl-done">
            <CapybaraMascot size={92} mood="sleepy" />
            <b>今天这趟走完啦</b>
            <span>
              捡起 {gotCount} 颗松子。掉在路边的，明天路上还在——不用一天硬啃。
            </span>
            <button className="cl-primary pop" onClick={reset}>
              再走一趟
            </button>
          </div>
        ) : (
          <>
            <div className={"cl-capy mood-" + mood}>
              <CapybaraMascot size={72} mood={mood} />
            </div>
            <p className="cl-facelabel">题目</p>
            {current?.requeued && <span className="cl-again">🌰 绕回来的词，再看一次</span>}
            <h3 className="cl-prompt">{current?.word.prompt}</h3>
            {shown ? (
              <div className="cl-answer">
                <b>{current!.word.word}</b>
                <span>{current!.word.kana}</span>
                <small>{current!.word.meta}</small>
              </div>
            ) : (
              <div className="cl-hidden">
                答案已隐藏<small>先回忆假名和汉字</small>
              </div>
            )}
            <button className="cl-reveal pop" onClick={reveal}>
              {shown ? "隐藏答案" : "显示答案"}
            </button>

            {shown && (
              <div className="cl-rates">
                <button className={"pop" + rateClass(0)} disabled={busy} onClick={() => grade(false, 0)}>
                  完全不会<small>松子掉了</small>
                </button>
                <button className={"pop" + rateClass(1)} disabled={busy} onClick={() => grade(false, 1)}>
                  有点模糊<small>差点没抓住</small>
                </button>
                <button className={"pop" + rateClass(2)} disabled={busy} onClick={() => grade(true, 2)}>
                  记得<small>捡起来</small>
                </button>
                <button className={"strong pop" + rateClass(3)} disabled={busy} onClick={() => grade(true, 3)}>
                  很熟练<small>轻松收入</small>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="lab-note">
        试试：点「显示答案」→ 选评分。答对松鼠捡松子前进；答错松子掉成空壳，并在队尾多出一站「绕回来再捡」。
        每次都有对应音效（可用右上角开关静音）。
      </p>
    </div>
  );
}

function SquirrelRoute({
  stations,
  pos,
  pulse
}: {
  stations: Station[];
  pos: number;
  pulse: number;
}) {
  // 计算松鼠水平位置(百分比)
  const total = stations.length;
  const clampedPos = Math.min(pos, total);
  const pct = total <= 1 ? 0 : (clampedPos / (total - 1)) * 100;
  const label = useMemo(() => {
    const got = stations.filter((s) => s.status === "got").length;
    return `${got} / ${stations.length} 松子`;
  }, [stations]);

  return (
    <div className="route">
      <div className="route-head">
        <span>🐿️ 松鼠的路线</span>
        <b>{label}</b>
      </div>
      <div className="route-track">
        <div className="route-line" />
        {/* 松鼠 */}
        <div
          key={pulse}
          className="route-squirrel"
          style={{ left: `calc(${Math.min(pct, 100)}% )` }}
        >
          🐿️
        </div>
        {/* 站点 */}
        <div className="route-stations">
          {stations.map((s, i) => (
            <span
              key={i}
              className={
                "route-node " +
                (s.status === "got"
                  ? "got"
                  : s.status === "dropped"
                    ? "dropped"
                    : i === pos
                      ? "cur"
                      : "pending")
              }
              title={s.word.word}
            >
              {s.status === "got" ? "🌰" : s.status === "dropped" ? "◦" : "•"}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
