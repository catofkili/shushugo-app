import { useState } from "react";
import { playSave, playStreakChirp, playKnow } from "../sounds";

/**
 * 组队面板原型(全假数据,不连后端)。
 * 三块:
 *   1) 我的队伍 —— 今天谁下水了、周进度条、队伍松子总数
 *   2) 邀请 —— 复制密钥(传播路径)
 *   3) 组队广场 —— 可加入的队伍列表
 *
 * ⚠️ 关于「AI 生成队友凑数」:代码里用 npc 字段标了出来,方便随时开关。
 *    但这是把虚构用户展示给真实用户,属于欺骗性设计,上线前请务必想清楚(我在对话里给了替代方案)。
 */

type Member = {
  name: string;
  avatar: string;
  done: boolean;
  nuts: number;
  npc?: boolean;
};

const MY_TEAM = {
  name: "N3 冲刺组",
  key: "CAPY-7K2M-9XQ4",
  members: [
    { name: "你", avatar: "🦫", done: true, nuts: 24 },
    { name: "小兔", avatar: "🐰", done: true, nuts: 31 },
    { name: "阿狐", avatar: "🦊", done: true, nuts: 18 },
    { name: "松松", avatar: "🐿️", done: false, nuts: 12 },
    { name: "豚豚", avatar: "🦦", done: false, nuts: 9, npc: true }
  ] as Member[]
};

const PLAZA = [
  { name: "早鸟 6 点党", tag: "N2", members: 4, cap: 6, streak: 41, emoji: "🐦" },
  { name: "水豚养老院", tag: "N5", members: 5, cap: 6, streak: 12, emoji: "🦫" },
  { name: "通勤 15 分钟", tag: "N3", members: 3, cap: 5, streak: 27, emoji: "🚃" },
  { name: "深夜背单词", tag: "N1", members: 6, cap: 6, streak: 63, emoji: "🦉" }
];

export function TeamPanel() {
  const [copied, setCopied] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const [cheered, setCheered] = useState<string[]>([]);

  const doneCount = MY_TEAM.members.filter((m) => m.done).length;
  const totalNuts = MY_TEAM.members.reduce((s, m) => s + m.nuts, 0);

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(MY_TEAM.key);
    } catch {
      /* 剪贴板不可用时忽略,原型不阻塞 */
    }
    setCopied(true);
    playSave();
    setTimeout(() => setCopied(false), 1800);
  };

  const cheer = (name: string) => {
    if (cheered.includes(name)) return;
    setCheered((c) => [...c, name]);
    playKnow();
  };

  const join = (name: string) => {
    setJoined(name);
    playStreakChirp();
  };

  return (
    <div>
      <p className="kicker">TEAM · 组队学习</p>
      <h2 className="section-title">一起走的路，比较不容易停</h2>

      {/* 我的队伍 */}
      <div className="lab-card tm-card">
        <div className="tm-head">
          <div>
            <b>{MY_TEAM.name}</b>
            <small>今天 {doneCount} / {MY_TEAM.members.length} 已下水</small>
          </div>
          <div className="tm-nuts">
            🌰<b>{totalNuts}</b>
          </div>
        </div>

        {/* 队伍今日进度 */}
        <div className="tm-progress">
          <i style={{ width: `${(doneCount / MY_TEAM.members.length) * 100}%` }} />
        </div>

        {/* 成员列表 */}
        <ul className="tm-members">
          {MY_TEAM.members.map((m) => (
            <li key={m.name} className={m.done ? "done" : ""}>
              <span className="tm-av">
                {m.avatar}
                {m.done && <i className="tm-dot" />}
              </span>
              <span className="tm-name">
                {m.name}
                {m.npc && <em className="tm-npc">NPC</em>}
              </span>
              <span className="tm-mnuts">🌰 {m.nuts}</span>
              {m.done ? (
                <span className="tm-state ok">已泡汤</span>
              ) : (
                <button
                  className={"tm-poke pop" + (cheered.includes(m.name) ? " sent" : "")}
                  onClick={() => cheer(m.name)}
                >
                  {cheered.includes(m.name) ? "已戳 ✓" : "戳一下"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* 邀请密钥 */}
      <div className="lab-card tm-invite">
        <div>
          <span className="tm-invite-label">邀请队友 · 队伍密钥</span>
          <b className="tm-key">{MY_TEAM.key}</b>
        </div>
        <button className={"tm-copy pop" + (copied ? " done" : "")} onClick={copyKey}>
          {copied ? "已复制 ✓" : "复制密钥"}
        </button>
      </div>

      {/* 组队广场 */}
      <p className="kicker" style={{ marginTop: 22 }}>PLAZA · 组队广场</p>
      <h2 className="section-title">找一支正在走的队伍</h2>

      <div className="tm-plaza">
        {PLAZA.map((t) => (
          <div key={t.name} className="lab-card tm-plaza-item">
            <span className="tm-plaza-emoji">{t.emoji}</span>
            <div className="tm-plaza-info">
              <b>{t.name}</b>
              <small>
                <span className="tm-chip">{t.tag}</span>
                {t.members}/{t.cap} 人 · 🔥 {t.streak} 天
              </small>
            </div>
            <button
              className={"tm-join pop" + (joined === t.name ? " done" : "")}
              disabled={t.members >= t.cap && joined !== t.name}
              onClick={() => join(t.name)}
            >
              {joined === t.name ? "已加入" : t.members >= t.cap ? "已满" : "加入"}
            </button>
          </div>
        ))}
      </div>

      <p className="lab-note">
        传播路径：复制密钥 → 发给朋友 → 对方粘贴加入。广场用于没有朋友的用户直接找队伍。
      </p>
    </div>
  );
}
