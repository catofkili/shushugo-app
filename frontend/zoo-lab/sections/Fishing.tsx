import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { CapybaraMascot } from "../../src/components/CapybaraMascot";
import { playPronunciation, SYSTEM_VOICE_ID } from "../../src/lib/speech";
import { playCast, playSplash, playBite, playReelIn, playFishUp, playMiss } from "../sounds";
import { CnToggle, FxLayer, JaName, Say, jaText, pickFrom, useFx, type Line, type Ruby } from "../ambient";

/**
 * 水豚钓鱼 —— 「玩」的那一局。
 *
 * 手感全在节奏上,四步:
 *   按住蓄力(力度左右摆动) → 松手甩竿(蓄得久落点远,远处大鱼多)
 *   → 等(浮标轻轻浮沉,中间夹杂 1~2 次「假动作」) → 咬钩那 0.8 秒点一下。
 *
 * 经济上刻意「零产出」:钓鱼不消耗柚子,也不产柚子——
 * 因为一旦产柚子,它就变成刷子,和「柚子只能靠复习赚」直接冲突。
 * 它的动力来自图鉴和纪录,不来自货币。只有当天第一条给 1 柚子(每天一次,刷不动)。
 *
 * 没有失败:太早是「空振り」,太晚是「逃走了」,两种都不扣任何东西,立刻能再来。
 */

type Tier = "s" | "m" | "l" | "junk";
type Fish = { id: string; icon: string; ja: Ruby[]; kana: string; cn: string; tier: Tier; cm?: [number, number] };

const TIER: Record<Tier, { ja: string; cn: string; color: string }> = {
  s: { ja: "こもの", cn: "小鱼", color: "#7C9A5C" },
  m: { ja: "なかもの", cn: "中鱼", color: "#3E8FCB" },
  l: { ja: "おおもの", cn: "大物", color: "#E0900B" },
  junk: { ja: "ガラクタ", cn: "杂物", color: "#9A8A78" }
};

/** 鱼名都是日常词,汉字给振り仮名;杂物是笑点不是惩罚 */
const FISH: Fish[] = [
  { id: "medaka", icon: "🐟", kana: "めだか", cn: "青鳉", tier: "s", cm: [3, 6], ja: [{ t: "めだか" }] },
  { id: "funa", icon: "🐟", kana: "ふな", cn: "鲫鱼", tier: "s", cm: [12, 25], ja: [{ t: "鮒", r: "ふな" }] },
  { id: "zarigani", icon: "🦐", kana: "ザリガニ", cn: "小龙虾", tier: "s", cm: [8, 14], ja: [{ t: "ザリガニ" }] },
  { id: "kaeru", icon: "🐸", kana: "かえる", cn: "青蛙", tier: "s", cm: [5, 9], ja: [{ t: "蛙", r: "かえる" }] },
  { id: "yamame", icon: "🐟", kana: "やまめ", cn: "樱鳟", tier: "m", cm: [20, 32], ja: [{ t: "山女", r: "やまめ" }] },
  { id: "ayu", icon: "🐟", kana: "あゆ", cn: "香鱼", tier: "m", cm: [18, 28], ja: [{ t: "鮎", r: "あゆ" }] },
  { id: "unagi", icon: "🐍", kana: "うなぎ", cn: "鳗鱼", tier: "m", cm: [40, 70], ja: [{ t: "鰻", r: "うなぎ" }] },
  { id: "koi", icon: "🐠", kana: "こい", cn: "鲤鱼", tier: "m", cm: [35, 60], ja: [{ t: "鯉", r: "こい" }] },
  { id: "namazu", icon: "🐡", kana: "なまず", cn: "鲇鱼", tier: "l", cm: [50, 90], ja: [{ t: "鯰", r: "なまず" }] },
  { id: "nishikigoi", icon: "🎏", kana: "にしきごい", cn: "锦鲤", tier: "l", cm: [60, 100],
    ja: [{ t: "錦", r: "にしき" }, { t: "鯉", r: "ごい" }] },
  { id: "nushi", icon: "🐋", kana: "ぬし", cn: "池之主", tier: "l", cm: [100, 145], ja: [{ t: "主", r: "ぬし" }] },
  { id: "nagagutsu", icon: "🥾", kana: "ながぐつ", cn: "雨靴", tier: "junk", ja: [{ t: "長靴", r: "ながぐつ" }] },
  { id: "akikan", icon: "🥫", kana: "あきかん", cn: "空罐", tier: "junk",
    ja: [{ t: "空", r: "あ" }, { t: "き" }, { t: "缶", r: "かん" }] },
  { id: "megane", icon: "👓", kana: "めがね", cn: "眼镜", tier: "junk", ja: [{ t: "めがね" }] }
];

const LINES: Record<string, Line[]> = {
  idle: [
    { ja: "しずかに…", cn: "安静点…" },
    { ja: "なにか いるかな？", cn: "有东西在吗？" },
    { ja: "きょうは つれるかな。", cn: "今天钓得到吗。" }
  ],
  charge: [
    { ja: "もっと とおくへ！", cn: "再远一点！" },
    { ja: "ためて ためて…", cn: "蓄力，蓄力…" }
  ],
  cast: [{ ja: "とんだ！", cn: "飞出去了！" }],
  wait: [
    { ja: "まだかな…", cn: "还没来吗…" },
    { ja: "じっと まって。", cn: "静静地等。" }
  ],
  feint: [
    { ja: "いまのは にせもの。", cn: "刚才那下是假的。" },
    { ja: "まだ まだ。", cn: "还早还早。" }
  ],
  bite: [{ ja: "きた！いま！", cn: "来了！就现在！" }],
  small: [
    { ja: "かわいい！", cn: "好可爱！" },
    { ja: "つれた つれた！", cn: "钓到啦钓到啦！" }
  ],
  big: [
    { ja: "おおもの だ！", cn: "是大家伙！" },
    { ja: "うわ、おもい！", cn: "哇，好重！" }
  ],
  junk: [
    { ja: "あらら…", cn: "哎呀…" },
    { ja: "これは たべられない ね。", cn: "这个不能吃呢。" }
  ],
  early: [
    { ja: "はやかった ね。", cn: "太早啦。" },
    { ja: "つぎは まって みよう。", cn: "下次等一等看看。" }
  ],
  late: [
    { ja: "にげちゃった…", cn: "跑掉了…" },
    { ja: "また くるよ。", cn: "还会再来的。" }
  ]
};
const pickLine = (key: string): Line => pickFrom(LINES[key] ?? LINES.idle);

/* 舞台坐标(固定 300×236,好让钓线算得准) */
const STAGE_W = 300;
const ROD_X = 118;
const ROD_Y = 40;
const WATER_Y = 138;
const CAST_NEAR = 152;
const CAST_FAR = 268;

type Phase = "idle" | "charge" | "cast" | "wait" | "bite" | "reel" | "catch" | "miss";
type Catch = { fish: Fish; cm: number; fresh: boolean; bonus: boolean };

/** 落点越远,大物越多;杂物固定一成,当笑点用 */
function rollFish(power: number): Fish {
  if (Math.random() < 0.1) return pickOf("junk");
  const score = Math.random() * 100 + power * 22;
  return pickOf(score < 55 ? "s" : score < 92 ? "m" : "l");
}
function pickOf(tier: Tier): Fish {
  const bucket = FISH.filter((f) => f.tier === tier);
  return bucket[Math.floor(Math.random() * bucket.length)];
}

export function Fishing() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [line, setLine] = useState<Line>(() => pickLine("idle"));
  const [showCn, setShowCn] = useState(true);
  const [bobX, setBobX] = useState(CAST_NEAR);
  const [feint, setFeint] = useState(0);
  const [ripple, setRipple] = useState(0);
  const [result, setResult] = useState<Catch | null>(null);
  const [missKind, setMissKind] = useState<"early" | "late">("early");
  const [caught, setCaught] = useState<Record<string, number>>({});
  const [best, setBest] = useState(0);
  const [today, setToday] = useState(0);
  const [bonusTaken, setBonusTaken] = useState(false);
  const [peek, setPeek] = useState<Fish | null>(null);
  const [hit, setHit] = useState(false);
  const { fx, boom } = useFx();

  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  }, []);

  const raf = useRef(0);
  const powerRef = useRef(0);
  const meterRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  useEffect(
    () => () => {
      timers.current.forEach(window.clearTimeout);
      cancelAnimationFrame(raf.current);
      window.speechSynthesis?.cancel();
    },
    []
  );

  /** 按住:力度在 0↔1 之间来回摆,松手那一刻的值就是落点 */
  const startCharge = () => {
    if (phase === "cast" || phase === "wait" || phase === "bite" || phase === "reel") return;
    clearTimers();
    setResult(null);
    setPeek(null);
    setPhase("charge");
    setLine(pickLine("charge"));
    const t0 = performance.now();
    const loop = (t: number) => {
      const p = ((t - t0) % 1500) / 1500;
      const v = p < 0.5 ? p * 2 : 2 - p * 2;
      powerRef.current = v;
      // 直接写样式,不走 state:蓄力条每帧都在动,没必要每帧重渲染整棵树。
      // 用 scaleX 而不是 width——后者每帧触发重排
      if (meterRef.current) meterRef.current.style.transform = `scaleX(${v})`;
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    later(() => boom("ぐぐぐ…", -40, 60, "ink"), 420);
  };

  /** 松手:甩竿 → 落水 → 进入等待 */
  const release = () => {
    if (phaseRef.current !== "charge") return;
    cancelAnimationFrame(raf.current);
    clearTimers();
    const power = powerRef.current;
    const x = CAST_NEAR + power * (CAST_FAR - CAST_NEAR);
    setBobX(x);
    setPhase("cast");
    setLine(pickLine("cast"));
    playCast();
    boom("ヒュン！", -30, 26, "warm");

    later(() => {
      setPhase("wait");
      setLine(pickLine("wait"));
      playSplash();
      setRipple((v) => v + 1);
      boom("ポチャン", x - STAGE_W / 2, 108, "ink");

      // 咬钩时机随机,前面塞 1~2 次假动作——「等」的手感全靠它
      const biteAt = 1300 + Math.random() * 2600;
      const feints = Math.random() < 0.55 ? 2 : 1;
      for (let i = 0; i < feints; i++) {
        const at = 500 + Math.random() * (biteAt - 900);
        later(() => {
          if (phaseRef.current !== "wait") return;
          setFeint((v) => v + 1);
          setLine(pickLine("feint"));
          boom("ピクッ", x - STAGE_W / 2, 96, "ink");
        }, at);
      }

      later(() => {
        if (phaseRef.current !== "wait") return;
        setPhase("bite");
        setLine(pickLine("bite"));
        playBite();
        setRipple((v) => v + 1);
        boom("ググッ！", x - STAGE_W / 2, 86, "gold");
        // 合わせ窗口 0.8 秒,过了就是逃走
        later(() => {
          if (phaseRef.current !== "bite") return;
          setPhase("miss");
          setMissKind("late");
          setLine(pickLine("late"));
          playMiss();
          boom("ぷかぷか", x - STAGE_W / 2, 100, "ink");
        }, 800);
      }, biteAt);
    }, 520);
  };

  /** 合わせる:在咬钩那 0.8 秒里点中就上钩 */
  const strike = () => {
    if (phase === "bite") {
      clearTimers();
      // 顿帧:命中那一瞬冻住整个画面 110ms + 一记白闪。
      // 声音不跟着冻——耳朵对停顿比眼睛敏感,音一断就成了卡顿而不是打击感。
      setHit(true);
      later(() => setHit(false), 110);
      setPhase("reel");
      playReelIn();
      later(() => boom("クルクル", bobX - STAGE_W / 2, 70, "warm"), 120);
      const fish = rollFish(powerRef.current);
      const cm = fish.cm
        ? Math.round(fish.cm[0] + Math.random() * (fish.cm[1] - fish.cm[0]))
        : 0;
      later(() => {
        const fresh = (caught[fish.id] ?? 0) === 0;
        setPhase("catch");
        // 当天第一条的柚子要在这里就定下来:setBonusTaken 在同一帧生效,
        // 渲染时再读 bonusTaken 会永远是 true,牌子就永远不出现
        setResult({ fish, cm, fresh, bonus: !bonusTaken });
        playFishUp(fish.tier);
        boom(fish.tier === "junk" ? "ぽちゃん" : "ザバッ！", bobX - STAGE_W / 2, 60,
          fish.tier === "l" ? "gold" : "warm");
        if (fish.tier !== "junk") later(() => boom("ピチピチ", 0, 96, "warm"), 380);
        setLine(pickLine(fish.tier === "junk" ? "junk" : fish.tier === "l" ? "big" : "small"));
        setCaught((prev) => ({ ...prev, [fish.id]: (prev[fish.id] ?? 0) + 1 }));
        setToday((v) => v + 1);
        setBest((v) => Math.max(v, cm));
        setBonusTaken(true);
      }, 620);
      return;
    }
    if (phase === "wait") {
      // 太早:空振り。不扣任何东西,浮标收回,立刻能再来
      clearTimers();
      setPhase("miss");
      setMissKind("early");
      setLine(pickLine("early"));
      playMiss();
      boom("スカッ", bobX - STAGE_W / 2, 92, "ink");
    }
  };

  const sayFish = (fish: Fish) => {
    void playPronunciation(jaText(fish.ja), fish.kana, SYSTEM_VOICE_ID);
  };

  // 钓线:从竿尖拉到浮标,长度和角度按坐标算
  const dx = bobX - ROD_X;
  const dy = WATER_Y - ROD_Y;
  const lineLen = Math.hypot(dx, dy);
  const lineDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const lineVisible = phase === "wait" || phase === "bite" || phase === "reel";

  const collected = FISH.filter((f) => (caught[f.id] ?? 0) > 0).length;
  const tier = result ? TIER[result.fish.tier] : TIER.s;
  const canStrike = phase === "wait" || phase === "bite";

  const actionLabel =
    phase === "charge" ? "はなす → とばす"
      : canStrike ? "合わせる！"
      : phase === "cast" || phase === "reel" ? "…"
      : "押して ためる";

  return (
    <div>
      <p className="kicker">FISHING · 水豚の つりぼり</p>
      <h2 className="section-title">静静地等，咬钩那一下点下去</h2>

      <div className="lab-card fp-card">
        <div className="fp-top">
          <span className="fp-stat">
            きょう <b>{today}</b> 匹
          </span>
          <span className="fp-stat">
            さいだい <b>{best}</b> cm
          </span>
          <CnToggle on={showCn} onToggle={() => setShowCn((v) => !v)} />
        </div>

        {/* 钓场 */}
        <div
          className={"fp-stage phase-" + phase + (hit ? " hit" : "")}
          onClick={() => canStrike && strike()}
          style={{ "--bob-x": `${bobX}px` } as CSSProperties}
        >
          <div className="fp-sky" />
          <div className="fp-far" />
          <div className="fp-water">
            <span className="fp-wave w1" />
            <span className="fp-wave w2" />
          </div>

          {/* 岸边的水豚和竿 */}
          <div className="fp-bank" />
          <div className="fp-angler">
            <span className={"fp-capy" + (phase === "catch" ? " cheer" : "")}>
              <CapybaraMascot size={52} mood={phase === "catch" ? "cheer" : "happy"} />
            </span>
            <span className="fp-rod" />
          </div>

          {/* 钓线 */}
          <span
            className={"fp-line" + (lineVisible ? " on" : "")}
            style={{ width: lineLen, transform: `rotate(${lineDeg}deg)` }}
          />

          {/* 浮标 */}
          {phase !== "idle" && phase !== "charge" && phase !== "catch" && (
            <span
              // 前缀不能省:浮标和涟漪是同一层的兄弟,光用数字会和 ripple 的 key 撞车
              key={"bob-" + feint}
              className={"fp-bobber" + (feint ? " twitch" : "")}
              style={
                {
                  left: bobX,
                  top: WATER_Y,
                  "--dx": `${ROD_X - bobX}px`,
                  "--dy": `${ROD_Y - WATER_Y}px`
                } as CSSProperties
              }
            />
          )}

          {/* 落水/咬钩涟漪 */}
          {ripple > 0 && (
            <span key={"rip-" + ripple} className="fp-ripple" style={{ left: bobX, top: WATER_Y + 4 }} />
          )}

          {/* 咬钩时整片水面提示一下,别让人错过 */}
          {phase === "bite" && <span className="fp-alert" />}

          {/* 顿帧的白闪 */}
          {hit && <span className="fp-hit-flash" />}

          <FxLayer fx={fx} />

          {/* 结果 */}
          {phase === "catch" && result && (
            <div className={"fp-result t-" + result.fish.tier}>
              <span className="fp-result-icon">{result.fish.icon}</span>
              <span className="fp-result-tier" style={{ color: tier.color }}>
                {tier.ja}
                {showCn && <i>{tier.cn}</i>}
              </span>
              <button className="fp-result-ja" onClick={() => sayFish(result.fish)}>
                <JaName ruby={result.fish.ja} />
                <em>♪</em>
              </button>
              {result.cm > 0 && <span className="fp-result-cm">{result.cm} cm</span>}
              {showCn && <span className="fp-result-cn">{result.fish.cn}</span>}
              {result.fresh && <span className="fp-badge">はつ ゲット！</span>}
              {result.bonus && <span className="fp-badge yuzu">きょうの 初もの 🍊+1</span>}
            </div>
          )}

          {phase === "miss" && (
            <div className="fp-result t-miss">
              <span className="fp-result-icon">{missKind === "early" ? "💨" : "🫧"}</span>
              <b className="fp-miss-ja">{missKind === "early" ? "空振り" : "にげられた"}</b>
              <span className="fp-result-cn">
                {missKind === "early" ? "抬竿太早——不扣任何东西，再来" : "晚了半拍——它还会回来"}
              </span>
            </div>
          )}
        </div>

        {/* 蓄力条 + 主按钮 */}
        <div className={"fp-meter" + (phase === "charge" ? " on" : "")}>
          <span ref={meterRef} className="fp-meter-fill" />
          <i className="fp-meter-far">とおく</i>
        </div>
        <button
          className={"fp-action" + (canStrike ? " strike" : "")}
          onPointerDown={() => !canStrike && startCharge()}
          onPointerUp={release}
          onPointerLeave={release}
          onPointerCancel={release}
          onClick={() => canStrike && strike()}
          disabled={phase === "cast" || phase === "reel"}
        >
          {actionLabel}
        </button>

        <Say line={line} showCn={showCn} mood={phase === "catch" ? "cheer" : "happy"} />

        {/* 図鑑 */}
        <div className="zoo-dex-head">
          <b>さかな 図鑑</b>
          <small>
            {collected} / {FISH.length}
          </small>
        </div>
        <div className="zoo-dex fp-dex">
          {FISH.map((f) => {
            const count = caught[f.id] ?? 0;
            return (
              <button
                key={f.id}
                className={"zoo-dex-item r-" + (f.tier === "l" ? "sr" : f.tier === "m" ? "r" : "n") + (count ? " got" : "") + (peek?.id === f.id ? " peek" : "")}
                disabled={!count}
                onClick={() => {
                  setPeek(f);
                  sayFish(f);
                }}
              >
                <span className="zoo-dex-icon">{count ? f.icon : "？"}</span>
                {count > 1 && <i className="zoo-dex-count">×{count}</i>}
              </button>
            );
          })}
        </div>
        <p className="zoo-peek">
          {peek ? (
            <>
              <b>
                <JaName ruby={peek.ja} />
              </b>
              {showCn && <span>· {peek.cn}</span>}
            </>
          ) : (
            <span className="zoo-peek-hint">点钓到过的格子，听一遍它的日语名</span>
          )}
        </p>
      </div>

      <p className="lab-note">
        原型说明：钓鱼不消耗也不产柚子——一旦产柚子它就变成刷子，会和「柚子只能靠复习赚」打架。
        动力来自图鉴和最大纪录；只有当天第一条给 1 柚子。空振り和逃走都不扣任何东西。
      </p>
    </div>
  );
}
