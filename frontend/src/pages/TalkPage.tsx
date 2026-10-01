import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JapaneseRubyText } from "../components/JapaneseRubyText";
import { CapybaraWalk } from "../components/CapybaraMascot";
import { CrossPlatformImage } from "../components/CrossPlatformImage";
import { MascotSay } from "../components/MascotSay";
import * as speech from "../lib/speech";
import { today } from "../lib/study-core";
import {
  TALK_MARKER, createTalkTasks, loadTalkContent, pickTalkNext, recordTalkAnswer,
  talkCard, talkProgress, talkFurigana, canUndoTalk, talkSceneCollection,
  canExtendTalkTasks, extendTalkTasks, undoLastTalkAnswer, type TalkCard
} from "../lib/talk";
import { talkDoneImage, talkImageSrc } from "../lib/talk/image-src";
import { canPlayTalkAudio } from "../lib/talk/audio";
import "./talk.css";

function TalkRuby({ sentence }: { sentence: string }) {
  const annotations = talkFurigana(sentence);
  return <>{annotations.map((annotation, index) => {
    const previous = annotations[index - 1];
    const start = previous ? previous.start + previous.length : 0;
    return <Fragment key={annotation.start}>
      {sentence.slice(start, annotation.start)}
      <JapaneseRubyText base={sentence.slice(annotation.start, annotation.start + annotation.length)} reading={annotation.reading} />
    </Fragment>;
  })}{sentence.slice(annotations.length ? annotations[annotations.length - 1].start + annotations[annotations.length - 1].length : 0)}</>;

}

function TalkNote({ text }: { text: string }) {
  return <>{text.split(/(「[^」]+」)/u).map((part, index) => <Fragment key={index}>
    {part.startsWith("「") ? <>「<TalkRuby sentence={part.slice(1, -1)} />」</> : part}
  </Fragment>)}</>;
}

type SceneCollection = ReturnType<typeof talkSceneCollection>;

function SceneSheet({ scenes, onClose }: { scenes: SceneCollection; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        // 弹层只有关闭按钮可聚焦；把 Tab 留在弹层，关闭后还给入口。
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [onClose]);
  return createPortal(<div className="talk-sheet-backdrop" onClick={onClose}>
    <section className="ds-card talk-sheet" role="dialog" aria-modal="true" aria-labelledby="talk-collection-title"
      onClick={(event) => event.stopPropagation()}>
      <div className="talk-sheet-top">
        <h2 className="talk-title" id="talk-collection-title">收集了 {scenes.filter((scene) => scene.collected).length} / {scenes.length} 个场景</h2>
        <button ref={closeRef} type="button" className="ds-chip focus-ring" onClick={onClose}>关闭</button>
      </div>
      <div className="talk-collection-grid">
        {scenes.map((scene) => <div key={scene.id} className="talk-collection-item">
          <div className={`talk-image ${scene.collected ? "" : "talk-uncollected"}`}>
            <CrossPlatformImage src={talkImageSrc(scene.image)} alt="" className="talk-scene-image"
              weappWidth="100%" weappHeight="100%" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <p className="talk-collection-title">{scene.title}</p>
          {!scene.collected && <p className="talk-collection-remaining">还差 {scene.total - scene.seen} 句</p>}
        </div>)}
      </div>
    </section>
  </div>, document.body);
}

function PracticeCard({ card, firstToday, paused, onAnswer }: {
  card: TalkCard;
  firstToday: boolean;
  paused: boolean;
  onAnswer: (hints: number, gaveUp: boolean) => boolean;
}) {
  const [hintsUsed, setHintsUsed] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [audio, setAudio] = useState<{ text: string; available: boolean | null }>({ text: "", available: null });
  const recording = useRef(false);
  const audioGeneration = useRef(0);
  const text = flipped ? card.answer.ja : card.partnerLine?.ja ?? "";
  const canListen = audio.text === text && audio.available === true;
  const showPartner = Boolean(card.partnerLine && (flipped || (audio.text === text && audio.available === false)));

  useEffect(() => {
    if (!text) return;
    audioGeneration.current += 1;
    let active = true;
    void canPlayTalkAudio().then(async (available) => {
      if (!active) return;
      setAudio({ text, available });
      if (available) await speech.playExample(text);
    }).catch(() => {
      if (active) setAudio({ text, available: false });
    });
    return () => { active = false; audioGeneration.current += 1; };
  }, [text, flipped]);

  const listen = () => {
    if (!canListen) return;
    const generation = audioGeneration.current;
    void speech.playExample(text).catch(() => {
      if (generation === audioGeneration.current) setAudio({ text, available: false });
    });
  };
  const hint = () => {
    if (hintsUsed < card.hints.length) setHintsUsed((count) => Math.min(count + 1, card.hints.length));
    else setFlipped(true);
  };
  const answer = (gaveUp: boolean) => {
    if (!flipped || recording.current) return;
    recording.current = true;
    if (!onAnswer(hintsUsed, gaveUp)) recording.current = false;
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (paused || event.repeat || event.metaKey || event.ctrlKey || event.altKey
        || target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === " ") {
        event.preventDefault();
        if (flipped) answer(false); else hint();
      } else if (event.key.toLowerCase() === "r" && canListen) {
        event.preventDefault();
        listen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return <>
    <section className="ds-card talk-card">
      {/* 翻面后收起图：答案和「下一张」要在一屏里，不能每张都往下滚 */}
      {card.image && !imageFailed && !flipped && <div className="talk-image">
        <CrossPlatformImage src={talkImageSrc(card.image)} alt="" className="talk-scene-image"
          weappWidth="100%" weappHeight="100%" style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImageFailed(true)} />
      </div>}
      <div className="talk-body">
        {card.kind === "reply" && card.sceneTitle && <h2 className="talk-title">{card.sceneTitle}</h2>}
        <p className={flipped ? "talk-prompt talk-prompt-small" : "talk-prompt"}>{card.prompt}</p>
        {!flipped && firstToday && <p className="talk-instruction">出声说一遍，说完翻面对照</p>}

        {showPartner && card.partnerLine && <div className="talk-line talk-line-partner">
          <p className="talk-speaker">{card.partnerLine.speaker}</p>
          <p className="talk-japanese" lang="ja"><TalkRuby sentence={card.partnerLine.ja} /></p>
          <p className="talk-translation">{card.partnerLine.zh}</p>
        </div>}
        {!flipped && canListen && <button type="button" className="ds-chip focus-ring" onClick={listen}>再听一遍</button>}

        {!flipped && hintsUsed > 0 && <div className="talk-hints" aria-live="polite">
          {card.hints.slice(0, hintsUsed).map((line, index) => <p key={index}>{line.split("\n").map((part, index) => <Fragment key={index}>{index > 0 && <br />}<TalkRuby sentence={part} /></Fragment>)}</p>)}
        </div>}
        {flipped && <>
          <div className={`talk-line ${card.partnerLine ? "talk-line-self" : ""}`}>
            {card.partnerLine && <p className="talk-speaker">我</p>}
            <p className="talk-answer" lang="ja"><TalkRuby sentence={card.answer.ja} /></p>
            {card.answer.zh !== card.prompt && <p className="talk-translation">{card.answer.zh}</p>}
            {canListen && <button type="button" className="ds-chip focus-ring" onClick={listen}>再听一遍</button>}
          </div>
          {card.note && <p className="talk-note"><TalkNote text={card.note} /></p>}
        </>}

        <div className="talk-actions">
          {flipped ? <>
            <button type="button" className="ds-btn-soft focus-ring" onClick={() => answer(true)}>没说对</button>
            <button type="button" className="ds-btn focus-ring" onClick={() => answer(false)}>下一张</button>
          </> : <>
            <button type="button" className="ds-btn-soft focus-ring" onClick={hint}>
              提示 <span className="talk-hint-dots" aria-label={`已用 ${hintsUsed} 条提示，共 ${card.hints.length} 条`}>
                {card.hints.map((_, index) => index < hintsUsed ? "●" : "○").join("")}
              </span>
            </button>
            <button type="button" className="ds-btn focus-ring" onClick={() => setFlipped(true)}>翻面</button>
          </>}
        </div>
      </div>
    </section>
    <p className="talk-keyboard kbd-hint">空格 {flipped ? "下一张" : "提示"}{canListen ? " · R 再听一遍" : ""}</p>
  </>;
}

export function TalkPage() {
  const [day] = useState(today);
  const [firstToday] = useState(() => {
    try { return localStorage.getItem("shushugo-talk-instruction-day") !== day; }
    catch { return true; }
  });
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [card, setCard] = useState<TalkCard | null>(null);
  const [turn, setTurn] = useState(0);
  const [progress, setProgress] = useState({ total: 0, done: 0, remaining: 0 });
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [extendAvailable, setExtendAvailable] = useState(false);
  const [scenes, setScenes] = useState<SceneCollection>([]);
  const [showCollection, setShowCollection] = useState(false);
  const closeCollection = useCallback(() => setShowCollection(false), []);
  const [newScenes, setNewScenes] = useState<SceneCollection>([]);
  const [doneArtFailed, setDoneArtFailed] = useState(false);
  const initialCollection = useRef<Set<string> | null>(null);
  const refresh = useCallback(() => {
    const collection = talkSceneCollection();
    initialCollection.current ??= new Set(collection.filter((scene) => scene.collected).map((scene) => scene.id));
    setScenes(collection);
    setNewScenes(collection.filter((scene) => scene.collected && !initialCollection.current?.has(scene.id)));
    setUndoAvailable(canUndoTalk(day));
    setExtendAvailable(canExtendTalkTasks(day));
    setProgress(talkProgress(day));
  }, [day]);
  // 留住刚才那张的替换词：撤销回题面时不能重新抽成另一句话。
  const history = useRef<TalkCard[]>([]);

  useEffect(() => {
    if (!card || !firstToday || turn !== 0) return;
    try { localStorage.setItem("shushugo-talk-instruction-day", day); }
    catch { /* UI 提示标记写不了不影响作答。 */ }
  }, [card, day, firstToday, turn]);

  useEffect(() => {
    let active = true;
    void loadTalkContent().then(() => {
      if (!active) return;
      createTalkTasks(day);
      const key = pickTalkNext(day);
      const next = key ? talkCard(key) : null;
      if (key && !next) throw new Error("卡片内容不可用");
      setCard(next);
      refresh();
    }).catch(() => {
      if (active) setError("开口练习加载失败，请重试。");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [attempt, day, refresh]);

  const record = (hints: number, gaveUp: boolean): boolean => {
    if (!card) return false;
    try {
      recordTalkAnswer(card.key, hints, gaveUp, card.filler);
    } catch {
      setError("这张没记上，请重试。");
      return false;
    }
    history.current.push(card);
    setError("");
    const key = pickTalkNext(day, new Set([card.key])) ?? pickTalkNext(day);
    const next = key ? talkCard(key) : null;
    // 有下一张却拿不到内容（内容没加载上）不能当成「今天做完了」
    if (key && !next) setError("下一张没能加载，请重试。");
    setCard(next);
    refresh();
    setTurn((value) => value + 1);
    return true;
  };

  const undo = () => {
    try {
      const key = undoLastTalkAnswer(day);
      if (!key) return;
      const previous = history.current.pop();
      setCard(previous?.key === key ? previous : talkCard(key));
      refresh();
      setTurn((value) => value + 1);
      setError("");
    } catch {
      setError("上一张没能撤销，请重试。");
    }
  };

  const extend = () => {
    try {
      extendTalkTasks(day, 5);
      const key = pickTalkNext(day);
      const next = key ? talkCard(key) : null;
      if (key && !next) throw new Error("卡片内容不可用");
      setCard(next);
      refresh();
      setTurn((value) => value + 1);
      setError("");
    } catch {
      setError("加餐没能加载，请重试。");
    }
  };

  const retry = () => {
    setError("");
    setLoading(true);
    setAttempt((value) => value + 1);
  };

  return <div className="talk-page" data-exp={TALK_MARKER}>
    {!loading && <div className="talk-top">
      {undoAvailable && <button type="button" className="ds-chip focus-ring" onClick={undo}>上一张</button>}
      <div className="talk-top-status">
        <span className="talk-count">今天 {progress.done} / {progress.total} 张</span>
        <button type="button" className="ds-chip focus-ring" onClick={() => setShowCollection(true)} aria-haspopup="dialog">
          图鉴 {scenes.filter((scene) => scene.collected).length}/{scenes.length}
        </button>
      </div>
    </div>}
    {error && <div role="alert" className="talk-error">
      <MascotSay sticker="mood-dizzy" tone="warn" className="ds-say-onbg">{error}</MascotSay>
      {!card && <button type="button" className="ds-btn-soft focus-ring" onClick={retry}>重试</button>}
    </div>}
    {loading ? <div className="talk-loading" aria-busy="true">
      <CapybaraWalk size={72} /><p>正在加载…</p>
    </div> : card ? <PracticeCard key={`${card.key}:${turn}`} card={card} firstToday={firstToday && turn === 0} paused={showCollection} onAnswer={record} />
      : !error && <div className="talk-done">
        {newScenes.map((scene) => <section key={scene.id} className="ds-card talk-new-scene">
          <div className="talk-image"><CrossPlatformImage src={talkImageSrc(scene.image)} alt="" className="talk-scene-image"
            weappWidth="100%" weappHeight="100%" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
          <p className="talk-title">新收集：{scene.title}</p>
        </section>)}
        {talkDoneImage && !doneArtFailed && <CrossPlatformImage src={talkDoneImage} alt="" className="talk-done-art"
          weappWidth={160} weappHeight={160} style={{ width: 160, height: 160, objectFit: "contain" }} onError={() => setDoneArtFailed(true)} />}
        <MascotSay sticker="empty-done" tone="good" size={96} className={`ds-say-onbg ${talkDoneImage && !doneArtFailed ? "talk-done-with-art" : ""}`}>
          <p className="talk-title">今天做了 {progress.done} 张</p>
          <p className="talk-translation">明天再来</p>
        </MascotSay>
        {extendAvailable && <button type="button" className="ds-btn-soft talk-extend focus-ring" onClick={extend}>再练 5 张</button>}
      </div>}
    {showCollection && <SceneSheet scenes={scenes} onClose={closeCollection} />}
  </div>;
}
