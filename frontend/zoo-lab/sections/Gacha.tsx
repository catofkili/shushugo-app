import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { playPronunciation, SYSTEM_VOICE_ID } from "../../src/lib/speech";
import { playCrank, playCapsuleDrop, playCapsuleCrack, playReveal, playDupe } from "../sounds";
import { CnToggle, FxLayer, JaName, Say, jaText, pickFrom, useFx, type Line, type Ruby } from "../ambient";

/**
 * 柚子扭蛋机 —— 「养」的闭环第一环(原型)。
 * 学习产出柚子 → 扭蛋换动物摆件 → 摆件进园区 / 图鉴。
 *
 * 三条规则在这里的体现:
 *   1. 单局 ≤ 15 秒:拧 → 落 → 点开 → 看一眼,四步结束。
 *   2. 柚子只能靠学习赚,这里只负责花掉——所以没有「买柚子」入口。
 *   3. 没有失败:重复也返柚子,保底兜住脸黑,文案永远是好消息。
 *
 * 日语按 ambient.tsx 那套三层出现:拟声词 / 水豚台词 / 物品名。
 */

type Rarity = "n" | "r" | "sr";
type Prize = { id: string; icon: string; name: string; ja: Ruby[]; kana: string; rarity: Rarity };

const RARITY: Record<Rarity, { label: string; ja: string; refund: number; color: string }> = {
  n: { label: "普通", ja: "ふつう", refund: 1, color: "#9C6B3F" },
  r: { label: "稀有", ja: "レア", refund: 2, color: "#3E8FCB" },
  sr: { label: "传说", ja: "でんせつ", refund: 5, color: "#E0900B" }
};

/** 奖池:全是园区里看得见的东西,词也都是 N5~N3 的日常名词,不挑生僻词 */
const POOL: Prize[] = [
  { id: "stump", icon: "🪵", name: "木桩凳", kana: "きりかぶ", rarity: "n",
    ja: [{ t: "切", r: "き" }, { t: "り" }, { t: "株", r: "かぶ" }] },
  { id: "bucket", icon: "🪣", name: "洗澡木桶", kana: "ゆおけ", rarity: "n",
    ja: [{ t: "湯", r: "ゆ" }, { t: "桶", r: "おけ" }] },
  { id: "dandelion", icon: "🌼", name: "蒲公英丛", kana: "たんぽぽ", rarity: "n",
    ja: [{ t: "たんぽぽ" }] },
  { id: "lantern", icon: "🏮", name: "石灯笼", kana: "いしどうろう", rarity: "n",
    ja: [{ t: "石", r: "いし" }, { t: "灯", r: "どう" }, { t: "籠", r: "ろう" }] },
  { id: "bamboo", icon: "🎋", name: "竹篱笆", kana: "たけがき", rarity: "n",
    ja: [{ t: "竹", r: "たけ" }, { t: "垣", r: "がき" }] },
  { id: "stone", icon: "🪨", name: "庭园石", kana: "にわいし", rarity: "n",
    ja: [{ t: "庭", r: "にわ" }, { t: "石", r: "いし" }] },
  { id: "rabbit", icon: "🐰", name: "白兔住客", kana: "しろうさぎ", rarity: "r",
    ja: [{ t: "白", r: "しろ" }, { t: "兎", r: "うさぎ" }] },
  { id: "duck", icon: "🦆", name: "池边鸭子", kana: "かも", rarity: "r",
    ja: [{ t: "鴨", r: "かも" }] },
  { id: "hedgehog", icon: "🦔", name: "刺猬一家", kana: "ハリネズミ", rarity: "r",
    ja: [{ t: "ハリネズミ" }] },
  { id: "squirrel", icon: "🐿️", name: "送信松鼠", kana: "リス", rarity: "r",
    ja: [{ t: "リス" }] },
  { id: "yuzutree", icon: "🍊", name: "柚子树", kana: "ゆずのき", rarity: "r",
    ja: [{ t: "柚子", r: "ゆず" }, { t: "の" }, { t: "木", r: "き" }] },
  { id: "deer", icon: "🦌", name: "白鹿", kana: "しろいしか", rarity: "sr",
    ja: [{ t: "白", r: "しろ" }, { t: "い" }, { t: "鹿", r: "しか" }] },
  { id: "owl", icon: "🦉", name: "夜行馆猫头鹰", kana: "ふくろう", rarity: "sr",
    ja: [{ t: "梟", r: "ふくろう" }] },
  { id: "sakura", icon: "🌸", name: "夜樱月见台", kana: "よざくら", rarity: "sr",
    ja: [{ t: "夜", r: "よ" }, { t: "桜", r: "ざくら" }] },
  { id: "goldcapy", icon: "🦫", name: "金色水豚", kana: "きんのカピバラ", rarity: "sr",
    ja: [{ t: "金", r: "きん" }, { t: "の" }, { t: "カピバラ" }] }
];

/** 水豚台词:一句 3~8 字,随机轮换,永远只说好消息 */
const LINES: Record<string, Line[]> = {
  idle: [
    { ja: "まわしてみて！", cn: "转一下试试！" },
    { ja: "なにが出るかな？", cn: "会出什么呢？" },
    { ja: "ゆず、あるね。", cn: "柚子还有呢。" }
  ],
  empty: [
    { ja: "ゆずが ないね…", cn: "没柚子了…" },
    { ja: "また あとでね。", cn: "待会儿再来吧。" }
  ],
  crank: [
    { ja: "よいしょ…！", cn: "嘿咻…！" },
    { ja: "まわして まわして！", cn: "转啊转！" }
  ],
  drop: [
    { ja: "きたきた！", cn: "来了来了！" },
    { ja: "おちてくるよ！", cn: "要掉下来了！" }
  ],
  capsule: [
    { ja: "あけて あけて！", cn: "快打开快打开！" },
    { ja: "なかみは なに？", cn: "里面是什么？" }
  ],
  fresh: [
    { ja: "やったー！", cn: "太好了！" },
    { ja: "はじめまして！", cn: "初次见面！" },
    { ja: "かわいい ね！", cn: "好可爱呀！" }
  ],
  dupe: [
    { ja: "また あえたね。", cn: "又见面啦。" },
    { ja: "おかえり！", cn: "欢迎回来！" }
  ],
  sr: [
    { ja: "うわぁ…でんせつだ！", cn: "哇…是传说！" },
    { ja: "すごい！ひかってる！", cn: "好厉害！在发光！" }
  ]
};
const pickLine = (key: string): Line => pickFrom(LINES[key] ?? LINES.idle);

/** 保底:8 抽内必出稀有以上,20 抽内必出传说。脸黑不是玩家的错。 */
const PITY_R = 8;
const PITY_SR = 20;

function rollRarity(sinceR: number, sinceSR: number): Rarity {
  if (sinceSR >= PITY_SR - 1) return "sr";
  if (sinceR >= PITY_R - 1) return Math.random() < 0.2 ? "sr" : "r";
  const x = Math.random() * 100;
  if (x < 7) return "sr";
  if (x < 35) return "r";
  return "n";
}

function rollPrize(sinceR: number, sinceSR: number): Prize {
  const rarity = rollRarity(sinceR, sinceSR);
  const bucket = POOL.filter((p) => p.rarity === rarity);
  return bucket[Math.floor(Math.random() * bucket.length)];
}

/** 玻璃罩里漂浮的小球(纯装饰) */
const BALLS = [
  { left: 14, top: 30, color: "#F5A623", delay: 0 },
  { left: 52, top: 14, color: "#8FCB5E", delay: 0.7 },
  { left: 92, top: 34, color: "#7FC8E8", delay: 1.3 },
  { left: 30, top: 66, color: "#F27F8B", delay: 0.4 },
  { left: 68, top: 60, color: "#FFD98A", delay: 1.6 },
  { left: 104, top: 74, color: "#B39DDB", delay: 0.9 },
  { left: 46, top: 92, color: "#8FCB5E", delay: 2.1 },
  { left: 84, top: 100, color: "#F5A623", delay: 1.1 }
];

type Phase = "idle" | "crank" | "drop" | "capsule" | "open" | "reveal";
type Result = { prize: Prize; dupe: boolean; refund: number };

export function Gacha() {
  const [yuzu, setYuzu] = useState(9);
  const [owned, setOwned] = useState<Record<string, number>>({ stump: 1, lantern: 2, rabbit: 1 });
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [sinceR, setSinceR] = useState(0);
  const [sinceSR, setSinceSR] = useState(0);
  const [pulls, setPulls] = useState(0);
  const [line, setLine] = useState<Line>(() => pickLine("idle"));
  const [showCn, setShowCn] = useState(true);
  const [peek, setPeek] = useState<Prize | null>(null);
  const { fx, boom } = useFx();

  // 所有定时器集中管理,卸载时清干净(切页面不留悬挂动画)
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => {
    const list = timers.current;
    return () => {
      list.forEach(window.clearTimeout);
      window.speechSynthesis?.cancel();
    };
  }, []);

  const pull = () => {
    if (phase !== "idle" || yuzu < 1) return;
    setYuzu((v) => v - 1);
    setPulls((v) => v + 1);
    setResult(null);
    setPeek(null);
    setPhase("crank");
    setLine(pickLine("crank"));
    playCrank();
    boom("カチッ", 66, 148);
    later(() => boom("カチッ", 78, 128), 190);

    const prize = rollPrize(sinceR, sinceSR);
    setSinceR((v) => (prize.rarity === "n" ? v + 1 : 0));
    setSinceSR((v) => (prize.rarity === "sr" ? 0 : v + 1));

    later(() => {
      setPhase("drop");
      setLine(pickLine("drop"));
      playCapsuleDrop();
      boom("コロコロ", 28, 96, "warm");
    }, 640);
    later(() => boom("ゴトン", -60, 176, "ink"), 1030);
    later(() => {
      // 蛋躺在出口等你点——这一下停顿是期待感的来源,别省
      setPhase("capsule");
      setLine(pickLine("capsule"));
      setResult({
        prize,
        dupe: (owned[prize.id] ?? 0) > 0,
        refund: RARITY[prize.rarity].refund
      });
    }, 1520);
  };

  const openCapsule = () => {
    if (phase !== "capsule" || !result) return;
    setPhase("open");
    playCapsuleCrack();
    boom("パカッ", -44, 146, "warm");
    later(() => {
      const { prize, dupe, refund } = result;
      setPhase("reveal");
      playReveal(prize.rarity);
      boom(prize.rarity === "sr" ? "キラキラ" : prize.rarity === "r" ? "キラッ" : "ぽん", 0, 92,
        prize.rarity === "n" ? "ink" : "gold");
      setLine(pickLine(dupe ? "dupe" : prize.rarity === "sr" ? "sr" : "fresh"));
      if (dupe) {
        later(() => playDupe(), 420);
        setYuzu((v) => v + refund);
      }
      setOwned((prev) => ({ ...prev, [prize.id]: (prev[prize.id] ?? 0) + 1 }));
    }, 430);
  };

  const close = () => {
    setPhase("idle");
    setResult(null);
    setLine(pickLine(yuzu > 0 ? "idle" : "empty"));
  };

  // 「再来一发」:先回到 idle,等状态真的落地(柚子返还也算进去)再自动拧一次。
  // 用 ref 拿最新的 pull,避免定时器里抓到旧闭包的 phase / yuzu。
  const pullRef = useRef(pull);
  pullRef.current = pull;
  const pending = useRef(false);
  useEffect(() => {
    if (phase !== "idle" || !pending.current) return;
    pending.current = false;
    const t = window.setTimeout(() => pullRef.current(), 80);
    return () => window.clearTimeout(t);
  }, [phase]);

  const again = () => {
    pending.current = true;
    close();
  };

  /** 点物品名 → 念给你听(没有音频库时走设备合成) */
  const sayPrize = (prize: Prize) => {
    void playPronunciation(jaText(prize.ja), prize.kana, SYSTEM_VOICE_ID);
  };

  const rarity = result ? RARITY[result.prize.rarity] : RARITY.n;
  const collected = POOL.filter((p) => (owned[p.id] ?? 0) > 0).length;
  const busy = phase !== "idle";

  return (
    <div>
      <p className="kicker">GACHA · 柚子扭蛋</p>
      <h2 className="section-title">学到的柚子，换一只住进园区的动物</h2>

      <div className="lab-card gc-card">
        {/* 柚子余额 */}
        <div className="gc-wallet">
          <span className="gc-wallet-yuzu">🍊 {yuzu}</span>
          <span className="gc-wallet-note">柚子只能靠复习赚</span>
          <CnToggle on={showCn} onToggle={() => setShowCn((v) => !v)} />
          <button className="gc-dev pop" onClick={() => setYuzu((v) => v + 5)}>
            +5
          </button>
        </div>

        {/* 扭蛋机 */}
        <div className="gc-stage">
          <div className={"gc-machine phase-" + phase}>
            <div className="gc-globe">
              {BALLS.map((b, i) => (
                <span
                  key={i}
                  className="gc-ball"
                  style={{
                    left: b.left,
                    top: b.top,
                    background: `radial-gradient(circle at 32% 30%, rgba(255,255,255,.85), transparent 46%), ${b.color}`,
                    animationDelay: `${b.delay}s`
                  }}
                />
              ))}
              <span className="gc-glare" />
            </div>

            <div className="gc-body">
              <span className="gc-collar" />
              <button
                className={"gc-knob" + (yuzu < 1 ? " empty" : "")}
                onClick={pull}
                disabled={busy || yuzu < 1}
                aria-label="拧一下扭蛋机"
              >
                <span className="gc-knob-mark" />
              </button>
              <div className="gc-slot" />
            </div>

            {/* 胶囊:掉落 → 静置等点 → 掰开 */}
            {(phase === "drop" || phase === "capsule" || phase === "open") && result && (
              <button
                key={pulls}
                className={"gc-capsule r-" + result.prize.rarity}
                onClick={openCapsule}
                disabled={phase !== "capsule"}
                aria-label="打开扭蛋"
              >
                <span className="gc-cap-half top" />
                <span className="gc-cap-half bot" />
                {phase === "capsule" && <span className="gc-tap-ring" />}
              </button>
            )}
          </div>

          {/* 漫画式效果音:跟着动作出现,不翻译 */}
          <FxLayer fx={fx} />

          {/* 开奖面板 */}
          {phase === "reveal" && result && (
            <div className={"gc-reveal r-" + result.prize.rarity}>
              <div className="gc-burst">
                {Array.from({ length: 14 }).map((_, i) => (
                  <span
                    key={i}
                    className="gc-spark"
                    style={
                      {
                        "--a": `${(360 / 14) * i + Math.random() * 12}deg`,
                        "--d": `${52 + Math.random() * 34}px`,
                        animationDelay: `${Math.random() * 0.1}s`
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
              <span className="gc-rar" style={{ color: rarity.color }}>
                {rarity.ja}
                {showCn && <i>{rarity.label}</i>}
              </span>
              <span className="gc-prize-icon">{result.prize.icon}</span>
              <button className="gc-prize-ja" onClick={() => sayPrize(result.prize)}>
                <JaName ruby={result.prize.ja} />
                <em>♪</em>
              </button>
              {showCn && <span className="gc-prize-cn">{result.prize.name}</span>}
              <span className="gc-prize-sub">
                {/* 重复也只说好消息:「又来了呀」+ 柚子返还用符号写,不分语言 */}
                {result.dupe ? `また 来たよ！ 🍊+${result.refund}` : "なかまに なった！"}
              </span>
              <div className="gc-reveal-btns">
                <button className="gc-btn ghost pop" onClick={close}>
                  放进园区
                </button>
                <button className="gc-btn pop" onClick={again} disabled={yuzu < 1}>
                  もう一回 🍊1
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 水豚旁白:一直在场,开奖时也在说话 */}
        <Say line={line} showCn={showCn} mood={phase === "reveal" ? "cheer" : "happy"} />

        {/* 保底进度:只说好消息,不说「你已经黑了 N 抽」 */}
        <div className="gc-pity">
          <span>再 {Math.max(1, PITY_SR - sinceSR)} 发内必出传说</span>
          <div className="gc-pity-bar">
            <i style={{ width: `${Math.min(100, (sinceSR / PITY_SR) * 100)}%` }} />
          </div>
        </div>

        {/* 图鉴:点已收集的格子 → 念一遍它的日语名 */}
        <div className="zoo-dex-head">
          <b>饲养员图鉴</b>
          <small>
            {collected} / {POOL.length}
          </small>
        </div>
        <div className="zoo-dex">
          {POOL.map((p) => {
            const count = owned[p.id] ?? 0;
            return (
              <button
                key={p.id}
                className={"zoo-dex-item r-" + p.rarity + (count ? " got" : "") + (peek?.id === p.id ? " peek" : "")}
                disabled={!count}
                onClick={() => {
                  setPeek(p);
                  sayPrize(p);
                }}
              >
                <span className="zoo-dex-icon">{count ? p.icon : "？"}</span>
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
              {showCn && <span>· {peek.name}</span>}
            </>
          ) : (
            <span className="zoo-peek-hint">点已收集的格子，听一遍它的日语名</span>
          )}
        </p>
      </div>

      <p className="lab-note">
        原型说明：柚子只由复习产出，扭蛋只负责花掉——游戏永远不和学习抢时间，而是学习的出口。
        日语只作为环境出现：拟声词不翻译（靠动作和水豚的话就懂），中文注释可一键关掉。
      </p>
    </div>
  );
}
