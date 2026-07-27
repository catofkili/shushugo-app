import { useState } from "react";
import { playKnow, playSave, playStreakChirp } from "../lib/zoo-sounds";

/**
 * 组队面板 —— 界面已完成,后端(D1 teams / team_members + Worker 端点)还没接,
 * 所以下面是示例数据,页面顶部有明确说明,不会让用户以为这些队友是真的。
 *
 * 三块:
 *   1) 我的队伍 —— 今天谁下水了、今日进度条、队伍松子总数
 *   2) 邀请密钥 —— 复制传播
 *   3) 组队广场 —— 没有朋友的用户直接找队伍
 *
 * ⚠️ NPC 字段保留着(带角标),是「用 AI 假队友凑数」那个方案的开关。
 *    展示虚构用户给真实用户属于欺骗性设计,上线前需要明示是陪练 NPC,或换成匿名全球池。
 */

type Member = {
  name: string;
  avatar: string;
  done: boolean;
  nuts: number;
  npc?: boolean;
};

const SAMPLE_TEAM = {
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

const SAMPLE_PLAZA = [
  { name: "早鸟 6 点党", tag: "N2", members: 4, cap: 6, streak: 41, emoji: "🐦" },
  { name: "水豚养老院", tag: "N5", members: 5, cap: 6, streak: 12, emoji: "🦫" },
  { name: "通勤 15 分钟", tag: "N3", members: 3, cap: 5, streak: 27, emoji: "🚃" },
  { name: "深夜背单词", tag: "N1", members: 6, cap: 6, streak: 63, emoji: "🦉" }
];

export function TeamPage() {
  const [copied, setCopied] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const [cheered, setCheered] = useState<string[]>([]);

  const doneCount = SAMPLE_TEAM.members.filter((member) => member.done).length;
  const totalNuts = SAMPLE_TEAM.members.reduce((sum, member) => sum + member.nuts, 0);

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(SAMPLE_TEAM.key);
    } catch {
      // 剪贴板不可用(权限/非安全上下文)时不阻塞交互,仍给出「已复制」以外的视觉反馈
    }
    setCopied(true);
    playSave();
    window.setTimeout(() => setCopied(false), 1800);
  };

  const cheer = (name: string) => {
    if (cheered.includes(name)) return;
    setCheered((list) => [...list, name]);
    playKnow();
  };

  const join = (name: string) => {
    setJoined(name);
    playStreakChirp();
  };

  return (
    <div className="zoo-page">
      <p className="zoo-panel-kick">TEAM · 组队学习</p>
      <h2 className="zoo-panel-title">一起走的路，比较不容易停</h2>

      <p className="zoo-panel-note zoo-panel-note-warn">
        组队还没接后端，下面是界面预览用的示例队伍，不是真实用户。
      </p>

      {/* 我的队伍 */}
      <div className="zoo-panel zoo-tm-card">
        <div className="zoo-tm-head">
          <div>
            <b>{SAMPLE_TEAM.name}</b>
            <small>今天 {doneCount} / {SAMPLE_TEAM.members.length} 已下水</small>
          </div>
          <div className="zoo-tm-nuts">
            🌰<b>{totalNuts}</b>
          </div>
        </div>

        <div className="zoo-tm-progress">
          <i style={{ width: `${(doneCount / SAMPLE_TEAM.members.length) * 100}%` }} />
        </div>

        <ul className="zoo-tm-members">
          {SAMPLE_TEAM.members.map((member) => (
            <li key={member.name} className={member.done ? "done" : ""}>
              <span className="zoo-tm-av">
                {member.avatar}
                {member.done && <i className="zoo-tm-dot" />}
              </span>
              <span className="zoo-tm-name">
                {member.name}
                {member.npc && <em className="zoo-tm-npc">NPC</em>}
              </span>
              <span className="zoo-tm-mnuts">🌰 {member.nuts}</span>
              {member.done ? (
                <span className="zoo-tm-state">已泡汤</span>
              ) : (
                <button
                  className={`zoo-pop zoo-tm-poke${cheered.includes(member.name) ? " sent" : ""}`}
                  onClick={() => cheer(member.name)}
                >
                  {cheered.includes(member.name) ? "已戳 ✓" : "戳一下"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* 邀请密钥 */}
      <div className="zoo-panel zoo-tm-invite">
        <div>
          <span className="zoo-tm-invite-label">邀请队友 · 队伍密钥</span>
          <b className="zoo-tm-key">{SAMPLE_TEAM.key}</b>
        </div>
        <button className={`zoo-pop zoo-tm-copy${copied ? " done" : ""}`} onClick={copyKey}>
          {copied ? "已复制 ✓" : "复制密钥"}
        </button>
      </div>

      {/* 组队广场 */}
      <p className="zoo-panel-kick zoo-panel-kick-spaced">PLAZA · 组队广场</p>
      <h2 className="zoo-panel-title">找一支正在走的队伍</h2>

      <div className="zoo-tm-plaza">
        {SAMPLE_PLAZA.map((team) => (
          <div key={team.name} className="zoo-panel zoo-tm-plaza-item">
            <span className="zoo-tm-plaza-emoji">{team.emoji}</span>
            <div className="zoo-tm-plaza-info">
              <b>{team.name}</b>
              <small>
                <span className="zoo-tm-chip">{team.tag}</span>
                {team.members}/{team.cap} 人 · 🔥 {team.streak} 天
              </small>
            </div>
            <button
              className={`zoo-pop zoo-tm-join${joined === team.name ? " done" : ""}`}
              disabled={team.members >= team.cap && joined !== team.name}
              onClick={() => join(team.name)}
            >
              {joined === team.name ? "已加入" : team.members >= team.cap ? "已满" : "加入"}
            </button>
          </div>
        ))}
      </div>

      <p className="zoo-panel-note">
        传播路径：复制密钥 → 发给朋友 → 对方粘贴加入。广场用于没有朋友的用户直接找队伍。
      </p>
    </div>
  );
}
