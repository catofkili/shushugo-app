import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cheerCloudTeamMember,
  createCloudTeam,
  getCloudSession,
  getCloudTeam,
  getCloudTeamPlaza,
  joinCloudTeam,
  leaveCloudTeam,
  regenerateCloudTeamInvite,
  reportCloudTeam,
  reportCloudTeamActivity,
  updateCloudTeam,
  type CloudTeam,
  type CloudTeamPlazaItem
} from "../lib/sync-api";
import { firstValue, today } from "../lib/study-core";
import { playKnow, playSave, playStreakChirp } from "../lib/zoo-sounds";

const EMOJIS = ["🌱", "🐿️", "🐦", "🚃", "🦉", "🍊", "📚", "⛩️"];
const TARGETS = ["N5", "N4", "N3", "N2", "N1", "全部"];

type TeamDraft = {
  name: string;
  targetLevel: string;
  emoji: string;
  visibility: "public" | "invite";
};

const defaultDraft: TeamDraft = { name: "", targetLevel: "N3", emoji: "🌱", visibility: "public" };

const countIfTableExists = (table: string, day: string) => {
  const exists = Number(firstValue("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table], 0)) > 0;
  return exists ? Number(firstValue(`SELECT COUNT(*) FROM ${table} WHERE reviewed_on = ?`, [day], 0)) : 0;
};

const localActivity = () => {
  const studyDay = today();
  const studyCount = countIfTableExists("reviews", studyDay)
    + countIfTableExists("grammar_reviews", studyDay)
    + countIfTableExists("kanji_unit_reviews", studyDay);
  const completed = Number(firstValue("SELECT COUNT(*) FROM checkins WHERE checked_on = ?", [studyDay], 0)) > 0;
  return { studyDay, studyCount, completed };
};

const messageFor = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后再试。";

export function TeamPage() {
  const [team, setTeam] = useState<CloudTeam | null>(null);
  const [plaza, setPlaza] = useState<CloudTeamPlazaItem[]>([]);
  const [draft, setDraft] = useState<TeamDraft>(defaultDraft);
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const activity = useMemo(() => localActivity(), []);

  const refresh = useCallback(async () => {
    const [current, available] = await Promise.all([
      getCloudTeam(activity.studyDay),
      getCloudTeamPlaza(activity.studyDay)
    ]);
    const synced = current ? await reportCloudTeamActivity({ ...activity }) : null;
    setTeam(synced);
    setPlaza(available.filter((item) => item.id !== synced?.id));
  }, [activity]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await getCloudSession();
        if (active) setNickname(session.displayName ?? "");
        await refresh();
      } catch (error) {
        if (active) setNotice(messageFor(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refresh]);

  const run = async (key: string, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setNotice("");
    try { await task(); }
    catch (error) { setNotice(messageFor(error)); }
    finally { setBusy(""); }
  };

  const create = () => run("create", async () => {
    const created = await createCloudTeam({ ...draft, displayName: nickname });
    setTeam(await reportCloudTeamActivity({ ...activity }));
    setPlaza((items) => items.filter((item) => item.id !== created.id));
    playStreakChirp();
    setNotice("队伍创建好了，邀请队友一起学习吧。");
  });

  const join = (input: { teamId?: string; inviteCode?: string }) => run(`join-${input.teamId ?? "invite"}`, async () => {
    await joinCloudTeam({ ...input, displayName: nickname });
    setTeam(await reportCloudTeamActivity({ ...activity }));
    setInviteCode("");
    playStreakChirp();
    setNotice("加入成功，今天的学习进度已经同步到队伍。");
  });

  const cheer = (memberId: string) => run(`cheer-${memberId}`, async () => {
    setTeam(await cheerCloudTeamMember(memberId, activity.studyDay));
    playKnow();
  });

  const copyInvite = () => run("copy", async () => {
    if (!team) return;
    const text = `来「收集日」加入我的学习队伍「${team.name}」：邀请码 ${team.inviteCode}`;
    if (navigator.share) await navigator.share({ title: "收集日组队邀请", text });
    else await navigator.clipboard.writeText(text);
    playSave();
    setNotice("邀请信息已准备好。");
  });

  const saveSettings = () => run("edit", async () => {
    setTeam(await updateCloudTeam(draft));
    setEditing(false);
    setNotice("队伍设置已保存。");
  });

  const regenerateInvite = () => run("regenerate", async () => {
    if (!window.confirm("旧邀请码会立即失效，确定更新吗？")) return;
    const code = await regenerateCloudTeamInvite();
    setTeam((current) => current ? { ...current, inviteCode: code } : current);
    setNotice("已生成新的邀请码。");
  });

  const leave = () => run("leave", async () => {
    if (!window.confirm(team?.isOwner && team.memberCount > 1 ? "退出后会把队长移交给最早加入的队友，确定退出吗？" : "确定退出这支队伍吗？")) return;
    await leaveCloudTeam();
    setTeam(null);
    await refresh();
    setNotice("已经退出队伍。");
  });

  const editTeam = () => {
    if (!team) return;
    setDraft({ name: team.name, targetLevel: team.targetLevel, emoji: team.emoji, visibility: team.visibility });
    setEditing(true);
  };

  const report = (teamId: string) => {
    const reason = window.prompt("举报原因：广告或联系方式 / 不当内容 / 冒充或欺骗 / 其他", "不当内容");
    if (!reason) return;
    void run(`report-${teamId}`, async () => {
      await reportCloudTeam(teamId, reason);
      setPlaza((items) => items.filter((item) => item.id !== teamId));
      setNotice("已收到举报，这支队伍已从你的广场隐藏。");
    });
  };

  if (loading) return <div className="zoo-page"><p className="zoo-panel-note">正在载入队伍…</p></div>;

  return (
    <div className="zoo-page">
      <p className="zoo-panel-kick">TEAM · 组队学习</p>
      <h2 className="zoo-panel-title">一起走的路，比较不容易停</h2>
      {notice && <p className="zoo-panel-note" role="status">{notice}</p>}

      {team ? (
        <>
          <div className="zoo-panel zoo-tm-card">
            <div className="zoo-tm-head">
              <div><b>{team.emoji} {team.name}</b><small>{team.targetLevel} · 连续活跃 {team.streak} 天 · 今天 {team.activeCount}/{team.memberCount} 人学习</small></div>
              <div className="zoo-tm-nuts"><b>{team.totalStudyCount}</b> 学习项</div>
            </div>
            <div className="zoo-tm-progress"><i style={{ width: `${team.memberCount ? team.activeCount / team.memberCount * 100 : 0}%` }} /></div>
            <ul className="zoo-tm-members">
              {team.members.map((member) => (
                <li key={member.memberId} className={member.completed ? "done" : ""}>
                  <span className="zoo-tm-av">{member.avatar}{member.studyCount > 0 && <i className="zoo-tm-dot" />}</span>
                  <span className="zoo-tm-name">{member.name}{member.isMe ? "（你）" : ""}{member.isOwner && <em className="zoo-tm-npc">队长</em>}</span>
                  <span className="zoo-tm-mnuts">{member.studyCount} 项{member.cheersReceived > 0 ? ` · ${member.cheersReceived} 次加油` : ""}</span>
                  {member.isMe ? <span className="zoo-tm-state">{member.completed ? "已完成" : "进行中"}</span> : (
                    <button className={`zoo-pop zoo-tm-poke${member.cheeredByMe ? " sent" : ""}`} disabled={member.cheeredByMe || Boolean(busy)} onClick={() => cheer(member.memberId)}>
                      {member.cheeredByMe ? "已加油 ✓" : "加油"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="zoo-panel zoo-tm-invite">
            <div><span className="zoo-tm-invite-label">邀请队友 · 队伍邀请码</span><b className="zoo-tm-key">{team.inviteCode}</b></div>
            <button className="zoo-pop zoo-tm-copy" disabled={Boolean(busy)} onClick={copyInvite}>分享邀请</button>
          </div>

          <div className="zoo-tm-actions">
            {team.isOwner && <button className="zoo-pop zoo-tm-secondary" onClick={editTeam}>队伍设置</button>}
            {team.isOwner && <button className="zoo-pop zoo-tm-secondary" disabled={Boolean(busy)} onClick={regenerateInvite}>更新邀请码</button>}
            <button className="zoo-pop zoo-tm-danger" disabled={Boolean(busy)} onClick={leave}>退出队伍</button>
          </div>

          {editing && <TeamForm draft={draft} setDraft={setDraft} submitLabel="保存设置" busy={Boolean(busy)} onSubmit={saveSettings} onCancel={() => setEditing(false)} />}
        </>
      ) : (
        <>
          <div className="zoo-panel zoo-tm-onboard">
            <h3>创建自己的队伍</h3>
            <label>你的队友昵称<input value={nickname} maxLength={20} onChange={(event) => setNickname(event.target.value)} placeholder="1–20 个字符" /></label>
            <TeamForm draft={draft} setDraft={setDraft} submitLabel="创建队伍" busy={Boolean(busy)} onSubmit={create} />
          </div>

          <div className="zoo-panel zoo-tm-join-code">
            <label>有邀请码？<input value={inviteCode} maxLength={8} onChange={(event) => setInviteCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} placeholder="输入 8 位邀请码" /></label>
            <button className="zoo-pop zoo-tm-join" disabled={inviteCode.length !== 8 || Boolean(busy)} onClick={() => join({ inviteCode })}>加入队伍</button>
          </div>

          <p className="zoo-panel-kick zoo-panel-kick-spaced">PLAZA · 组队广场</p>
          <h2 className="zoo-panel-title">找一支正在走的队伍</h2>
          <div className="zoo-tm-plaza">
            {plaza.length === 0 && <p className="zoo-panel-note">广场暂时没有可加入的公开队伍，你可以创建第一支。</p>}
            {plaza.map((item) => (
              <div key={item.id} className="zoo-panel zoo-tm-plaza-item">
                <span className="zoo-tm-plaza-emoji">{item.emoji}</span>
                <div className="zoo-tm-plaza-info"><b>{item.name}</b><small><span className="zoo-tm-chip">{item.targetLevel}</span>{item.memberCount}/{item.maxMembers} 人 · 今天 {item.activeCount} 人 · 🔥 {item.streak} 天</small></div>
                <div className="zoo-tm-plaza-buttons"><button className="zoo-pop zoo-tm-report" disabled={Boolean(busy)} onClick={() => report(item.id)}>举报</button><button className="zoo-pop zoo-tm-join" disabled={Boolean(busy)} onClick={() => join({ teamId: item.id })}>{busy === `join-${item.id}` ? "加入中…" : "加入"}</button></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TeamForm({ draft, setDraft, submitLabel, busy, onSubmit, onCancel }: {
  draft: TeamDraft;
  setDraft: (draft: TeamDraft) => void;
  submitLabel: string;
  busy: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="zoo-tm-form">
      <label>队伍名称<input value={draft.name} maxLength={20} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：N3 每日打卡" /></label>
      <div className="zoo-tm-form-row">
        <label>目标<select value={draft.targetLevel} onChange={(event) => setDraft({ ...draft, targetLevel: event.target.value })}>{TARGETS.map((target) => <option key={target}>{target}</option>)}</select></label>
        <label>图标<select value={draft.emoji} onChange={(event) => setDraft({ ...draft, emoji: event.target.value })}>{EMOJIS.map((emoji) => <option key={emoji}>{emoji}</option>)}</select></label>
        <label>加入方式<select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as TeamDraft["visibility"] })}><option value="public">公开</option><option value="invite">仅邀请</option></select></label>
      </div>
      <div className="zoo-tm-actions">
        <button className="zoo-pop zoo-tm-join" disabled={busy || draft.name.trim().length < 2} onClick={onSubmit}>{busy ? "处理中…" : submitLabel}</button>
        {onCancel && <button className="zoo-pop zoo-tm-secondary" onClick={onCancel}>取消</button>}
      </div>
    </div>
  );
}
