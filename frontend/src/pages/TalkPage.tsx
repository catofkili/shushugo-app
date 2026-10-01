import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Mic, Volume2 } from "lucide-react";
import { JapaneseRubyText } from "../components/JapaneseRubyText";
import { CapybaraWalk } from "../components/CapybaraMascot";
import { CrossPlatformImage } from "../components/CrossPlatformImage";
import { MascotSay } from "../components/MascotSay";
import { today } from "../lib/study-core";
import {
  TALK_MARKER, loadTalkContent, materializeTalkCards, recordTalkAnswer,
  talkCard, talkFurigana, canUndoTalk, talkSceneSets, talkDueKeys, sceneSessionKeys,
  createTalkSession, advanceTalkSession, talkSessionProgress,
  undoLastTalkAnswer, talkEverAnswered, type TalkCard, type TalkSession
} from "../lib/talk";
import { listen as listenForSpeech, speechInputAvailable } from "../lib/talk/speech-input";
import { talkDoneImage, talkHeroImage, talkImageSrc } from "../lib/talk/image-src";
import { canPlayTalkAudio, playTalkAudio, stopTalkAudio } from "../lib/talk/audio";
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

type SceneSet = ReturnType<typeof talkSceneSets>;

const LISTEN_ONLY_KEY = "shushugo-talk-listen-only";

function PracticeCard({ card, firstToday, showSceneTitle, inputAvailable, listenOnly, onListenOnlyChange, onMicBlocked, onAnswer }: {
  card: TalkCard;
  firstToday: boolean;
  /** 场景练习时顶栏已经写着场景名，卡上不再写一遍；复习混着各个场景，要写。 */
  showSceneTitle: boolean;
  inputAvailable: boolean;
  listenOnly: boolean;
  onListenOnlyChange: (value: boolean) => void;
  onMicBlocked: () => void;
  onAnswer: (hints: number, gaveUp: boolean) => boolean;
}) {
  const [hintsUsed, setHintsUsed] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [audio, setAudio] = useState<{ text: string; available: boolean | null }>({ text: "", available: null });
  // 对方那句放不放得出来单独记：翻面后 audio 换成答案那句，「只听」的判断不能跟着变。
  const [partnerAudio, setPartnerAudio] = useState<boolean | null>(null);
  const recording = useRef(false);
  const audioGeneration = useRef(0);
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [speechNote, setSpeechNote] = useState("");
  const stopInput = useRef<(() => void) | null>(null);
  const inputGeneration = useRef(0);
  const speaking = useRef(false);
  const stopSpeaking = () => {
    inputGeneration.current += 1;
    stopInput.current?.();
    stopInput.current = null;
    speaking.current = false;
    setListening(false);
  };
  useEffect(() => () => {
    inputGeneration.current += 1;
    stopInput.current?.();
    stopTalkAudio();
  }, []);
  const speak = () => {
    if (flipped || !inputAvailable) return;
    if (speaking.current) { stopInput.current?.(); return; }
    stopTalkAudio();
    audioGeneration.current += 1;
    setTranscript("");
    setSpeechNote("");
    setListening(true);
    speaking.current = true;
    const generation = ++inputGeneration.current;
    stopInput.current = listenForSpeech((value) => {
      if (generation === inputGeneration.current) setTranscript(value);
    }, () => {
      if (generation !== inputGeneration.current) return;
      speaking.current = false;
      setListening(false);
      stopInput.current = null;
    }, (error) => {
      if (generation !== inputGeneration.current) return;
      if (error === "not-allowed" || error === "service-not-allowed") {
        // 拒了权限之后这颗按钮每点必败：这一页里不再出现，只在这张卡上说一句。
        setSpeechNote("没有麦克风权限，直接出声说也可以");
        onMicBlocked();
      } else if (error === "no-speech") setSpeechNote("没听到，再说一次");
    });
  };
  const flip = () => { stopSpeaking(); setFlipped(true); };
  const text = flipped ? card.answer.ja : card.partnerLine?.ja ?? "";
  const canListen = audio.text === text && audio.available === true;

  // 接话卡对方那句：「看字」直接摆出来；「只听」先藏着，第 1 条提示才露出来。放不出声音时没法只听，一律摆出来。
  const partner = card.partnerLine;
  const partnerUpfront = Boolean(partner) && (!listenOnly || partnerAudio === false);
  const partnerHint = Boolean(partner) && !partnerUpfront;
  // card.hints[0] 是对方原文；它要么一开始就摆着（不算提示），要么就是「只听」时的第 1 条提示（在对方那块里露出来）。
  const hintLines = partner ? card.hints.slice(1) : card.hints;
  const totalHints = hintLines.length + (partnerHint ? 1 : 0);
  const partnerShown = partnerUpfront || flipped || (partnerHint && hintsUsed >= 1);
  const shownHintLines = hintLines.slice(0, Math.max(0, hintsUsed - (partnerHint ? 1 : 0)));
  const showModeToggle = Boolean(partner) && !flipped && hintsUsed === 0 && partnerAudio === true;
  // 开口说的时候图让位：说完的字和「翻面」要在一屏里。
  const showImage = Boolean(card.image) && !imageFailed && !flipped && !listening && !transcript;

  useEffect(() => {
    if (!text) return;
    const generation = ++audioGeneration.current;
    let active = true;
    const isPartner = !flipped && Boolean(card.partnerLine);
    void canPlayTalkAudio(text).then(async (available) => {
      if (!active) return;
      setAudio({ text, available });
      if (isPartner) setPartnerAudio(available);
      if (available && generation === audioGeneration.current && !speaking.current) await playTalkAudio(text);
    }).catch(() => {
      if (!active) return;
      setAudio({ text, available: false });
      if (isPartner) setPartnerAudio(false);
    });
    return () => {
      active = false;
      audioGeneration.current += 1;
      stopTalkAudio();
    };
  }, [text, flipped, card.partnerLine]);

  const replayAudio = () => {
    if (!canListen) return;
    stopSpeaking();
    const generation = audioGeneration.current;
    void playTalkAudio(text).catch(() => {
      if (generation === audioGeneration.current) setAudio({ text, available: false });
    });
  };
  const hint = () => {
    if (hintsUsed < totalHints) setHintsUsed((count) => Math.min(count + 1, totalHints));
    else flip();
  };
  const answer = (gaveUp: boolean) => {
    if (!flipped || recording.current) return;
    recording.current = true;
    if (!onAnswer(hintsUsed, gaveUp)) recording.current = false;
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey
        || target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === " ") {
        event.preventDefault();
        if (flipped) answer(false); else hint();
      } else if (event.key.toLowerCase() === "r" && canListen) {
        event.preventDefault();
        replayAudio();
      } else if (event.key.toLowerCase() === "m" && !flipped && inputAvailable) {
        event.preventDefault();
        speak();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return <>
    <section className="ds-card talk-card">
      {/* 翻面后收起图：答案和「下一张」要在一屏里，不能每张都往下滚 */}
      {showImage && <div className="talk-image">
        <CrossPlatformImage src={talkImageSrc(card.image!)} alt="" className="talk-scene-image"
          weappWidth="100%" weappHeight="100%" style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImageFailed(true)} />
      </div>}
      <div className="talk-body">
        {showSceneTitle && card.kind === "reply" && card.sceneTitle && <h2 className="talk-title">{card.sceneTitle}</h2>}
        <p className={flipped || partner ? "talk-prompt talk-prompt-small" : "talk-prompt"}>{card.prompt}</p>
        {!flipped && firstToday && <p className="talk-instruction">出声说一遍，说完翻面对照</p>}

        {partner && <div className="talk-line talk-line-partner">
          <div className="talk-partner-head">
            <p className="talk-speaker">{partner.speaker}</p>
            {/* 再听一遍放进这一行而不是单占一行：接话卡在 375×812 上本来就最长，「翻面」不能被挤出屏幕 */}
            {!flipped && canListen && <button type="button" className="talk-replay focus-ring" onClick={replayAudio} aria-label="再听一遍">
              <Volume2 size={16} aria-hidden="true" />
            </button>}
            {showModeToggle && <div className="talk-mode" role="group" aria-label="对方的话">
              <button type="button" className="talk-mode-option focus-ring" aria-pressed={!listenOnly} onClick={() => onListenOnlyChange(false)}>看字</button>
              <button type="button" className="talk-mode-option focus-ring" aria-pressed={listenOnly} onClick={() => onListenOnlyChange(true)}>只听</button>
            </div>}
          </div>
          {partnerShown ? <>
            <p className="talk-japanese" lang="ja"><TalkRuby sentence={partner.ja} /></p>
            <p className="talk-translation">{partner.zh}</p>
          </> : <p className="talk-listen-only">{partnerAudio === null ? "…" : "只听声音。想看原文，点提示"}</p>}
        </div>}

        {!flipped && shownHintLines.length > 0 && <div className="talk-hints" aria-live="polite">
          {shownHintLines.map((line, index) => <p key={index}><TalkRuby sentence={line} /></p>)}
        </div>}
        {transcript && <div className="talk-transcript" aria-live="polite">
          <p className="talk-speaker">你说的</p>
          <p className="talk-japanese" lang="ja">{transcript}</p>
        </div>}
        {flipped && <>
          <div className={`talk-line ${partner ? "talk-line-self" : ""}`}>
            {partner && <p className="talk-speaker">我</p>}
            <p className="talk-answer" lang="ja"><TalkRuby sentence={card.answer.ja} /></p>
            {card.answer.zh !== card.prompt && <p className="talk-translation">{card.answer.zh}</p>}
            {canListen && <button type="button" className="ds-chip focus-ring" onClick={replayAudio}>再听一遍</button>}
          </div>
          {card.note && <p className="talk-note"><TalkNote text={card.note} /></p>}
        </>}

        {!flipped && inputAvailable && <button type="button" className="ds-btn-soft focus-ring talk-mic" onClick={speak} aria-pressed={listening}>
          <Mic size={18} aria-hidden="true" />{listening ? "在听…" : transcript ? "再说一次" : "说一句"}
          {listening && <span className="talk-listening-dot" aria-hidden="true" />}
        </button>}
        {!flipped && speechNote && <p className="talk-instruction talk-speech-note" role="status">{speechNote}</p>}
        <div className="talk-actions">
          {flipped ? <>
            <button type="button" className="ds-btn-soft focus-ring" onClick={() => answer(true)}>没说对</button>
            <button type="button" className="ds-btn focus-ring" onClick={() => answer(false)}>下一张</button>
          </> : <>
            <button type="button" className="ds-btn-soft focus-ring" onClick={hint}>
              提示 <span className="talk-hint-dots" aria-label={`已用 ${hintsUsed} 条提示，共 ${totalHints} 条`}>
                {Array.from({ length: totalHints }, (_, index) => index < hintsUsed ? "●" : "○").join("")}
              </span>
            </button>
            <button type="button" className="ds-btn focus-ring" onClick={flip}>翻面</button>
          </>}
        </div>
      </div>
    </section>
    <p className="talk-keyboard kbd-hint">空格 {flipped ? "下一张" : "提示"}{canListen ? " · R 再听一遍" : ""}{!flipped && inputAvailable ? " · M 说一句 / 停" : ""}</p>
  </>;
}

export function TalkPage() {
  const [day] = useState(today);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [micBlocked, setMicBlocked] = useState(false);
  const [listenOnly, setListenOnly] = useState(() => {
    try { return localStorage.getItem(LISTEN_ONLY_KEY) === "1"; } catch { return false; }
  });
  const changeListenOnly = (value: boolean) => {
    setListenOnly(value);
    try { localStorage.setItem(LISTEN_ONLY_KEY, value ? "1" : "0"); } catch { /* 存不下就只管这一页 */ }
  };
  const [card, setCard] = useState<TalkCard | null>(null);
  const [turn, setTurn] = useState(0);
  const [session, setSession] = useState<TalkSession | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<SceneSet>([]);
  const [due, setDue] = useState<string[]>([]);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [doneArtFailed, setDoneArtFailed] = useState(false);
  const [initialCollection, setInitialCollection] = useState(() => new Set<string>());
  // 撤销同时还原队列（包括刚追加的重来）和原 filler，不重新抽词。
  const history = useRef<{ session: TalkSession; card: TalkCard; sceneId: string | null; collected: Set<string> }[]>([]);
  const refresh = useCallback(() => {
    setScenes(talkSceneSets(day));
    setDue(talkDueKeys(day));
    setUndoAvailable(canUndoTalk(day));
  }, [day]);

  useEffect(() => {
    let active = true;
    void loadTalkContent().then(() => {
      if (!active) return;
      materializeTalkCards();
      setWelcome(!talkEverAnswered());
      refresh();
    }).catch(() => {
      if (active) setError("开口练习加载失败，请重试。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; stopTalkAudio(); };
  }, [attempt, refresh]);

  const start = (id: string | null) => {
    try {
      const nextSession = createTalkSession(id ? sceneSessionKeys(id) : talkDueKeys(day));
      if (!nextSession.keys.length) return;
      const next = talkCard(nextSession.queue[0], { sceneId: id ?? undefined });
      if (!next) throw new Error("卡片内容不可用");
      setInitialCollection(new Set(talkSceneSets(day).filter((scene) => scene.collected).map((scene) => scene.id)));
      setError("");
      setWelcome(false);
      setSceneId(id);
      setSession(nextSession);
      setCard(next);
      setTurn((value) => value + 1);
    } catch { setError("卡片没能加载，请重试。"); }
  };

  const home = () => {
    stopTalkAudio();
    setSession(null);
    setCard(null);
    setError("");
    refresh();
  };

  const sceneOptions = { sceneId: sceneId ?? undefined };
  const record = (hints: number, gaveUp: boolean): boolean => {
    if (!card || !session) return false;
    const nextSession = advanceTalkSession(session, hints, gaveUp);
    const key = nextSession.queue[nextSession.cursor];
    let next: TalkCard | null;
    try {
      next = key ? talkCard(key, sceneOptions) : null;
      if (key && !next) throw new Error("卡片内容不可用");
      recordTalkAnswer(card.key, hints, gaveUp, card.filler);
    } catch { setError("这张没记上，请重试。"); return false; }
    if (key === card.key) {
      // 唯一一张立即重来时，等流水写入后换词；抽词失败仍用已生成的卡，不能把已记账说成失败再记一次。
      try { next = talkCard(key, sceneOptions) ?? next; } catch { /* 保留已验证的下一张。 */ }
    }
    history.current.push({ session, card, sceneId, collected: initialCollection });
    setSession(nextSession);
    setCard(next);
    setError("");
    setTurn((value) => value + 1);
    refresh();
    return true;
  };

  const undo = () => {
    try {
      const key = undoLastTalkAnswer(day);
      if (!key) return;
      const previous = history.current.pop();
      const restored = previous?.card.key === key ? previous : null;
      const next = restored?.card ?? talkCard(key, { sceneId: restored?.sceneId ?? undefined });
      if (!next) throw new Error("卡片内容不可用");
      setSession(restored?.session ?? createTalkSession([key]));
      setSceneId(restored?.sceneId ?? null);
      setInitialCollection(restored?.collected ?? new Set(talkSceneSets(day).filter((scene) => scene.collected).map((scene) => scene.id)));
      setCard(next);
      setWelcome(false);
      setError("");
      setTurn((value) => value + 1);
      refresh();
    } catch { setError("上一张没能撤销，请重试。"); }
  };

  const progress = session ? talkSessionProgress(session) : null;
  const newScenes = scenes.filter((scene) => scene.collected && !initialCollection.has(scene.id));
  const inputAvailable = speechInputAvailable() && !micBlocked;
  const retry = () => { setError(""); setLoading(true); setAttempt((value) => value + 1); };

  return <div className="talk-page" data-exp={TALK_MARKER}>
    {!loading && session && <div className="talk-top">
      <button type="button" className="ds-chip focus-ring talk-back" onClick={home}>← 场景</button>
      <span className="talk-session-title">{sceneId ? scenes.find((scene) => scene.id === sceneId)?.title : "复习"}</span>
      <span className="talk-count">{progress?.current} / {progress?.total}</span>
    </div>}
    {error && <div role="alert" className="talk-error">
      <MascotSay sticker="mood-dizzy" tone="warn" className="ds-say-onbg">{error}</MascotSay>
      {loading === false && scenes.length === 0 && <button type="button" className="ds-btn-soft focus-ring" onClick={retry}>重试</button>}
    </div>}
    {loading ? <div className="talk-loading" aria-busy="true"><CapybaraWalk size={72} /><p>正在加载…</p></div>
      : !session ? <>
        {/* 没答过任何一张时的说明；点进任一场景就不再出现。不放按钮：下面的场景格子本身就是入口。 */}
        {welcome && <section className="ds-card talk-welcome">
          {talkHeroImage && <CrossPlatformImage src={talkHeroImage} alt="" className="talk-welcome-art"
            weappWidth={88} weappHeight={88} style={{ width: 88, height: 88, objectFit: "contain" }} />}
          <div>
            <h2 className="talk-title">看场景，开口说一句</h2>
            <p className="talk-translation">挑一个场景开始</p>
          </div>
        </section>}
        {due.length > 0 && <button type="button" className="ds-btn-soft focus-ring talk-review" onClick={() => start(null)}>复习 {due.length} 张</button>}
        <div className="talk-collection-grid">
          {scenes.map((scene) => <button type="button" key={scene.id} className="ds-btn-soft focus-ring talk-collection-item" onClick={() => start(scene.id)}>
            <div className="talk-image"><CrossPlatformImage src={talkImageSrc(scene.image)} alt="" className="talk-scene-image"
              weappWidth="100%" weappHeight="100%" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
            <p className="talk-collection-title">{scene.title}</p>
            <p className="talk-collection-remaining">
              {scene.collected ? <span className="talk-collected">已收集</span> : scene.seen > 0 ? `练过 ${scene.seen} / ${scene.total} 句` : `${scene.total} 句`}
              {scene.due > 0 && <span> · 待复习 {scene.due}</span>}
            </p>
          </button>)}
        </div>
      </> : <>
        {card ? <PracticeCard key={`${card.key}:${turn}`} card={card} firstToday={session.cursor === 0} showSceneTitle={!sceneId}
          inputAvailable={inputAvailable} onMicBlocked={() => setMicBlocked(true)}
          listenOnly={listenOnly} onListenOnlyChange={changeListenOnly} onAnswer={record} />
          : <div className="talk-done">
            {talkDoneImage && !doneArtFailed
              ? <CrossPlatformImage src={talkDoneImage} alt="" className="talk-done-art" weappWidth={140} weappHeight={140}
                style={{ width: 140, height: 140, objectFit: "contain" }} onError={() => setDoneArtFailed(true)} />
              : <MascotSay sticker="empty-done" tone="good" size={96} className="ds-say-onbg talk-done-fallback">练完了</MascotSay>}
            <p className="talk-done-title">{sceneId ? "这个场景练完了" : "今天的复习做完了"}</p>
            {newScenes.map((scene) => <section key={scene.id} className="ds-card talk-new-scene">
              <div className="talk-new-scene-thumb"><CrossPlatformImage src={talkImageSrc(scene.image)} alt="" className="talk-scene-image"
                weappWidth="100%" weappHeight="100%" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
              <div><p className="talk-kicker">收集到新场景</p><p className="talk-new-scene-title">{scene.title}</p></div>
            </section>)}
            <div className="talk-done-actions">
              {sceneId && <button type="button" className="ds-btn focus-ring" onClick={() => start(sceneId)}>再练一遍</button>}
              <button type="button" className="ds-btn-soft focus-ring" onClick={home}>{sceneId ? "换个场景" : "回到场景"}</button>
            </div>
          </div>}
        {undoAvailable && <button type="button" className="ds-chip focus-ring talk-undo" onClick={undo}>上一张</button>}
      </>}
  </div>;
}
