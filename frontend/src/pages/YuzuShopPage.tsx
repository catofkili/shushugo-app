import { useEffect, useRef, useState, type ComponentType } from "react";
import { AppWindow, Check, ChevronDown, Citrus, LoaderCircle, Mic, Music, PackageCheck, Palette, Play, Shirt, Sparkles, type LucideProps } from "lucide-react";
import { CATEGORY_LABEL, EQUIPPABLE, VOICE_ITEM_PREFIX, YUZU_ITEMS, type YuzuCategory, type YuzuItem } from "../lib/yuzu-catalog";
import { brandIconUrl, Sticker, stickerUrl, useMascotSkin } from "../components/CapybaraMascot";
import { getResolvedTheme, getStudyPreferences, PREFERENCES_EVENT, saveStudyPreferences } from "../lib/studyPreferences";
import { prepareVoice, previewVoice, voiceDeliveryMode } from "../lib/speech";
import { previewTimbre, type SoundTimbre } from "../lib/zoo-sounds";

import {
  buyItem, equipItem, equippedItem, ownsItem, repairableDays, repairDay, repairPrice,
  settleYuzu, unequip, YUZU, YUZU_EVENT, yuzuBalance, yuzuToday
} from "../lib/yuzu";

/**
 * 柚子商店。抄的是三家的骨架:
 *   Duolingo 商店 —— 顶部余额,补签(冻结卡)和外观一起摆在货架上;
 *   Finch 服装店 —— 点一件,「试衣台」立刻换成它,买 / 穿的按钮只长在试衣台上;
 *   Forest 树店 —— 两列方格、价格胶囊、已拥有打勾。
 *
 * 余额条 sticky,选中商品的试衣 / 结账条固定在屏幕底部。
 * 补签是货架上第一件,价格随 30 天内买过几张递增,选中它在底栏列出能补的日子。
 */

const CATEGORY_ORDER: YuzuCategory[] = ["theme", "mascot", "icon", "voice", "sound", "misc"];
/** 补签不在 catalog 里(价格是算出来的、买了就消耗),页面里当一件特殊商品摆 */
const REPAIR_ID = "repair";
const REPAIR_ITEM: YuzuItem = { id: REPAIR_ID, name: "补签", description: `补回最近 ${YUZU.repairWindowDays} 天里断掉的一天,只算进连击。30 天内第 1/2/3 张 ${YUZU.repair.join("/")}`, category: "misc", price: YUZU.repair[0], art: "tool-review" };
const CATEGORY_ICON: Record<YuzuCategory, ComponentType<LucideProps>> = {
  theme: Palette, mascot: Shirt, icon: AppWindow, voice: Mic, sound: Music, misc: Sparkles
};
const KIND_LABEL: Record<string, string> = {
  study: "今天学了 100 词", plan: "清完今日计划", streak: "连击满 7 天", encore: "加餐", achievement: "成就", buy: "购买", repair: "补签"
};
type CheckoutStatus = "paying" | "preparing" | "done" | "deferred" | "failed";

/**
 * 配色 / 皮肤商品的图 = 一张迷你主页:顶栏 + 今日大卡 + 两格 + 工具盘,全用 --zoo-* 变量画,
 * 外层挂上 data-skin / data-theme,styles.css 里那套皮肤变量就落在它身上 —— 所见即买到。
 * 皮肤商品换的是贴纸目录(品牌图标 + 工具盘四格),配色商品换的是变量。
 */
const MiniHome = ({ skinId = "", mascotId = "" }: { skinId?: string; mascotId?: string }) => (
  <div className="yz-mini" data-skin={skinId || undefined} data-theme={getResolvedTheme()}>
    <div className="yz-mini-top"><img src={brandIconUrl(mascotId)} alt="" /><i /><i /></div>
    <div className="yz-mini-hero"><b>15 词</b><i /></div>
    <div className="yz-mini-row"><i /><i /></div>
    <div className="yz-mini-tray">
      {(["icon-study-modes", "icon-vocab", "icon-practice", "icon-favorites"] as const).map((n) => <img key={n} src={stickerUrl(n, mascotId)} alt="" />)}
    </div>
  </div>
);

/**
 * 商品图。配色 / 皮肤画迷你主页;其它按 catalog 的 `art` 取总表上的一格
 * (开心图标 = 开心表情、音效 = 气泡、周报封面 = 每日一句卡…都是总表上本来没用上的格子)。
 * 什么都没有才退回分类图标占位。
 */
const Art = ({ item, size }: { item: YuzuItem; size: "s" | "l" }) => {
  const Icon = CATEGORY_ICON[item.category];
  const currentMascot = useMascotSkin();
  if (item.category === "theme") return <div className={`yz-art yz-art-${size} yz-art-home`}><MiniHome skinId={item.id} mascotId={currentMascot} /></div>;
  if (item.category === "mascot") return <div className={`yz-art yz-art-${size} yz-art-home`}><MiniHome skinId={equippedItem("theme")} mascotId={item.id} /></div>;
  const src = item.art ? stickerUrl(item.art) : null;
  return (
    <div className={`yz-art yz-art-${size}`} data-cat={item.category}>
      {src
        ? <img key={src} src={src} alt="" />
        : <Icon size={size === "l" ? 44 : 26} aria-hidden="true" />}
    </div>
  );
};

export const YuzuShopPage = () => {
  const [, bump] = useState(0);
  const [tab, setTab] = useState<YuzuCategory | "all" | "owned" | "repair">("all");
  const [picked, setPicked] = useState<string>(REPAIR_ID);
  const [confirming, setConfirming] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [checkout, setCheckout] = useState<{ itemId: string; status: CheckoutStatus } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    settleYuzu();
    const refresh = () => bump((n) => n + 1);
    window.addEventListener(YUZU_EVENT, refresh);
    window.addEventListener(PREFERENCES_EVENT, refresh);
    return () => {
      mounted.current = false;
      window.removeEventListener(YUZU_EVENT, refresh);
      window.removeEventListener(PREFERENCES_EVENT, refresh);
    };
  }, []);

  const balance = yuzuBalance();
  const todayRows = yuzuToday();
  const todayIncome = todayRows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0);
  const gaps = repairableDays();
  const price = repairPrice();
  const repair: YuzuItem = { ...REPAIR_ITEM, price };
  const ownedItems = YUZU_ITEMS.filter((i) => ownsItem(i.id));
  const items = tab === "all" ? [repair, ...YUZU_ITEMS]
    : tab === "owned" ? ownedItems
      : tab === "repair" ? [repair]
        : YUZU_ITEMS.filter((i) => i.category === tab);
  const item = picked === REPAIR_ID ? repair : YUZU_ITEMS.find((i) => i.id === picked) ?? repair;
  const isRepair = item.id === REPAIR_ID;
  const owned = !isRepair && ownsItem(item.id);
  const itemInUse = (target: YuzuItem) => target.category === "voice"
    ? getStudyPreferences().voiceId === target.id.replace(VOICE_ITEM_PREFIX, "")
    : EQUIPPABLE.has(target.category) && equippedItem(target.category) === target.id;
  const inUse = owned && itemInUse(item);
  const ownedCount = ownedItems.length;
  const activeCheckout = checkout?.itemId === item.id ? checkout.status : null;
  const busy = activeCheckout === "paying";
  const stageDescription = activeCheckout === "paying" ? "正在结账，同时准备资源…"
    : activeCheckout === "preparing" ? "购买完成 · 正在后台准备声音，可离开此页"
      : activeCheckout === "done" ? "购买完成 · 已自动使用"
        : activeCheckout === "deferred" ? "购买完成 · 联网时会自动加载声音"
          : activeCheckout === "failed" ? "没有完成购买，请再试一次"
            : item.description;
  const pick = (id: string) => { setPicked(id); setConfirming(false); setCheckout(null); };

  const chooseVoice = (id: string) => {
    const preferences = getStudyPreferences();
    saveStudyPreferences({ ...preferences, voiceId: id });
  };

  const purchase = async () => {
    const target = item;
    const voiceId = target.category === "voice" ? target.id.replace(VOICE_ITEM_PREFIX, "") : "";
    let prepared: "done" | "deferred" | undefined;
    const preparation = voiceId
      ? prepareVoice(voiceId).then(() => { prepared = "done"; }, () => { prepared = "deferred"; })
      : Promise.resolve();
    setConfirming(false);
    setCheckout({ itemId: target.id, status: "paying" });
    if (!buyItem(target.id)) {
      if (mounted.current) setCheckout({ itemId: target.id, status: "failed" });
      return;
    }
    if (voiceId) chooseVoice(voiceId);
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    if (!mounted.current) return;
    if (voiceId && voiceDeliveryMode() === "remote" && prepared === undefined) {
      setCheckout({ itemId: target.id, status: "preparing" });
      void preparation.then(() => {
        if (mounted.current) setCheckout({ itemId: target.id, status: prepared ?? "done" });
      });
      return;
    }
    setCheckout({ itemId: target.id, status: prepared ?? "done" });
  };

  const act = () => {
    if (inUse) {
      if (item.category === "voice") chooseVoice("");
      else unequip(item.category);
      setCheckout(null);
      return;
    }
    if (owned) {
      if (item.category === "voice") chooseVoice(item.id.replace(VOICE_ITEM_PREFIX, ""));
      else if (EQUIPPABLE.has(item.category)) equipItem(item.id);
      setCheckout(null);
      return;
    }
    if (!confirming) { setConfirming(true); return; }
    void purchase();
  };

  return (
    <div className="zoo-page yz-page">
      {/* 只有余额固定在顶上;商品货架应当成为首屏主角 */}
      <div className="yz-sticky">
        <section className="yz-wallet">
          <p className="yz-wallet-num"><Citrus size={18} aria-hidden="true" />{balance}</p>
          <b className="yz-wallet-today">{todayIncome > 0 ? `今天 +${todayIncome}` : "今天还没进账"}</b>
          <button className="yz-wallet-how" onClick={() => setRulesOpen((v) => !v)} aria-expanded={rulesOpen}>
            怎么赚 <ChevronDown size={13} className={rulesOpen ? "is-open" : ""} aria-hidden="true" />
          </button>
          {rulesOpen && (
            <ul className="yz-rules">
              <li><span>学 {YUZU.studyWords} 个词</span><b>+{YUZU.study}</b></li>
              <li><span>清完今日计划</span><b>+{YUZU.plan}</b></li>
              <li><span>连击每满 7 天</span><b>+{YUZU.streak7}</b></li>
              <li><span>加餐(每天一次)</span><b>+{YUZU.encore}</b></li>
              <li><span>解锁一个成就</span><b>+{YUZU.achievement}</b></li>
              {todayRows.length > 0 && <li className="yz-rules-today">今天:{todayRows.map((r) => `${KIND_LABEL[r.kind] ?? r.kind} ${r.amount > 0 ? "+" : ""}${r.amount}`).join(" · ")}</li>}
            </ul>
          )}
        </section>

      </div>

      {/* 分类 chip + 两列货架；试衣 / 结账条固定在屏幕底部 */}
      <div className="yz-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "all"} className={tab === "all" ? "is-on" : ""} onClick={() => setTab("all")}>全部 <i>{ownedCount}/{YUZU_ITEMS.length}</i></button>
        <button
          role="tab"
          aria-selected={tab === "owned"}
          className={tab === "owned" ? "is-on" : ""}
          onClick={() => {
            setTab("owned");
            const first = ownedItems[0];
            if (first) pick(first.id);
          }}
        ><PackageCheck size={13} /> 已购入 <i>{ownedCount}</i></button>
        <button role="tab" aria-selected={tab === "repair"} className={tab === "repair" ? "is-on" : ""} onClick={() => setTab("repair")}>补签</button>
        {CATEGORY_ORDER.map((c) => (
          <button key={c} role="tab" aria-selected={tab === c} className={tab === c ? "is-on" : ""} onClick={() => setTab(c)}>{CATEGORY_LABEL[c]}</button>
        ))}
      </div>
      {(tab !== "owned" || ownedItems.length > 0) && <section className="yz-stage">
        <Art item={item} size="l" />
        <div className="yz-stage-text">
          <p className="yz-stage-kick">{isRepair ? "连击" : CATEGORY_LABEL[item.category]}</p>
          <p className="yz-stage-name">{item.name}</p>
          <p className="yz-stage-desc" role={activeCheckout ? "status" : undefined} aria-live={activeCheckout ? "polite" : undefined}>{stageDescription}</p>
        </div>
        {(item.category === "voice" || item.category === "sound") && (
          <button
            className="yz-listen"
            onClick={() => { if (item.category === "voice") void previewVoice(item.id.replace(VOICE_ITEM_PREFIX, "")); else previewTimbre(item.id.replace("sound-", "") as SoundTimbre); }}
          >
            <Play size={14} /> 试听
          </button>
        )}
        {isRepair ? (
          gaps.length ? (
            <div className="yz-repair-days">
              {gaps.map((day) => (
                <button key={day} className="yz-cta" disabled={balance < price} onClick={() => repairDay(day)}>
                  补 {Number(day.slice(5, 7))}/{Number(day.slice(8))} · <Citrus size={14} aria-hidden="true" />{price}
                </button>
              ))}
            </div>
          ) : (
            <button className="yz-cta" disabled>最近 {YUZU.repairWindowDays} 天没断,不用补</button>
          )
        ) : (
          <button
            className={`yz-cta ${inUse ? "is-on" : owned ? "is-owned" : confirming ? "is-confirm" : ""}`}
            disabled={busy || item.soon || (!owned && balance < item.price)}
            onClick={act}
          >
            {busy ? <><LoaderCircle className="yz-spin" size={15} /> 正在结账…</>
              : item.soon ? "即将上架"
              : inUse ? <><Check size={15} /> 使用中 · 点击换回默认</>
                : owned ? (item.category === "voice" || EQUIPPABLE.has(item.category) ? "使用" : <><Check size={15} /> 已拥有</>)
                  : confirming ? `确认花 ${item.price} 买下` : <><Citrus size={15} /> {item.price}{balance < item.price ? ` · 还差 ${item.price - balance}` : ""}</>}
          </button>
        )}
      </section>}
      {tab === "owned" && ownedItems.length === 0 && (
        <div className="yz-owned-empty"><Sticker name="empty-box" size={88} /><b>还没有已购入的商品</b><span>从“全部”里挑一件，买下后会集中出现在这里。</span></div>
      )}
      <div className="yz-grid">
        {items.map((it) => {
          const rep = it.id === REPAIR_ID;
          const has = !rep && ownsItem(it.id);
          const on = has && itemInUse(it);
          return (
            <button key={it.id} className={`yz-card${picked === it.id ? " is-picked" : ""}${has ? " is-owned" : ""}`} onClick={() => pick(it.id)} aria-pressed={picked === it.id}>
              <Art item={it} size="s" />
              <b>{it.name}</b>
              {it.soon ? <span className="yz-tag is-soon">即将上架</span>
                : on ? <span className="yz-tag is-on"><Check size={11} /> 使用中</span>
                : has ? <span className="yz-tag"><Check size={11} /> 已拥有</span>
                  : <span className="yz-price"><Citrus size={11} aria-hidden="true" />{it.price}{rep ? " / 天" : ""}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};
