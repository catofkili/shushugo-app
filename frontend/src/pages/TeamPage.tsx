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
import { RefreshCw } from "lucide-react";
import { CapybaraWalk, Sticker } from "../components/CapybaraMascot";
import { MascotSay } from "../components/MascotSay";
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
  return exists ? Number(firstValue("SELECT COUNT(*) FROM " + table + " WHERE reviewed_on = ?", [day], 0)) : 0;
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

export function TeamPage({ onBack }: { onBack: () => void }) {
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

  const join = (input: { teamId?: string; inviteCode?: string }) => run("join-" + (input.teamId ?? "invite"), async () => {
    await joinCloudTeam({ ...input, displayName: nickname });
    setTeam(await reportCloudTeamActivity({ ...activity }));
    setInviteCode("");
    playStreakChirp();
    setNotice("加入成功，今天的学习进度已经同步到队伍。");
  });

  const cheer = (memberId: string) => run("cheer-" + memberId, async () => {
    setTeam(await cheerCloudTeamMember(memberId, activity.studyDay));
    playKnow();
  });

  const copyInviteCode = () => run("copy-code", async () => {
    if (!team) return;
    await navigator.clipboard.writeText(team.inviteCode);
    playSave();
    setNotice("邀请码已复制。");
  });

  const shareInvite = () => run("share", async () => {
    if (!team) return;
    const text = "来「收集日」加入我的学习队伍「" + team.name + "」：邀请码 " + team.inviteCode;
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
    void run("report-" + teamId, async () => {
      await reportCloudTeam(teamId, reason);
      setPlaza((items) => items.filter((item) => item.id !== teamId));
      setNotice("已收到举报，这支队伍已从你的广场隐藏。");
    });
  };

  const refreshPage = () => run("refresh", async () => {
    await refresh();
    setNotice("队伍信息已更新。");
  });

  return (
    <div className="zoo-page zoo-tm-page">
      {/* 头图和主页今日大卡同一块主色（跟皮肤走）。原来是写死的森林绿 + 三个 emoji 动物，
          换了樱 / 抹茶皮肤、切深色都不跟。英文加宽的小标题（STUDY TOGETHER / TEAM）一起删了 */}
      <header className="zoo-tm-hero">
        <button className="zoo-tm-back" onClick={onBack}>‹ 返回</button>
        <div className="zoo-tm-hero-copy">
          <h1>一起学，会走得更远</h1>
          <p>分享今天的脚步，给认真学习的队友加油</p>
        </div>
        <Sticker name="scene-reading" size={96} className="zoo-tm-hero-art" />
        {!loading && (
          <button className="zoo-tm-refresh" disabled={Boolean(busy)} onClick={refreshPage}>
            <RefreshCw size={13} aria-hidden="true" /> 刷新
          </button>
        )}
      </header>

      <div className="zoo-tm-content">
        {notice && (
          <div role="status">
            <MascotSay sticker="mood-default" size={44} className="ds-say-onbg">{notice}</MascotSay>
          </div>
        )}

        {loading ? (
          <section className="zoo-tm-card-shell zoo-tm-loading">
            <CapybaraWalk size={48} />
            <h2>正在看看队友们…</h2>
          </section>
        ) : team ? (
          <>
            <section className="zoo-tm-summary">
              <div className="zoo-tm-team-topline">
                <span className="zoo-tm-team-mark">{team.emoji}</span>
                <div className="zoo-tm-team-copy">
                  <h2>{team.name}</h2>
                  <p>{team.targetLevel} · {team.visibility === "public" ? "公开队伍" : "仅邀请加入"}</p>
                </div>
                {team.isOwner && <span className="zoo-tm-owner-badge">队长</span>}
              </div>
              <div className="zoo-tm-stats">
                <div><b>{team.activeCount}/{team.memberCount}</b><span>今天学习</span></div>
                <div><b>{team.totalStudyCount}</b><span>学习项</span></div>
                <div><b>{team.streak}</b><span>连续活跃</span></div>
              </div>
              <div className="zoo-tm-summary-progress" role="progressbar" aria-label="今日队友学习进度" aria-valuemin={0} aria-valuemax={team.memberCount} aria-valuenow={team.activeCount}>
                <span style={{ width: String(team.memberCount ? team.activeCount / team.memberCount * 100 : 0) + "%" }} />
              </div>
              <p className="zoo-tm-progress-note">今天已有 {team.activeCount} 位队友留下学习脚步</p>
            </section>

            <section className="zoo-tm-card-shell zoo-tm-members-card">
              <div className="zoo-tm-section-head">
                <h2>今天的队友</h2>
                <span className="zoo-tm-member-count">{team.memberCount} 人</span>
              </div>
              <ul className="zoo-tm-members">
                {team.members.map((member) => (
                  <li key={member.memberId} className={"zoo-tm-member" + (member.isMe ? " is-me" : "")}>
                    <span className="zoo-tm-avatar">{member.avatar}</span>
                    <div className="zoo-tm-member-copy">
                      <div className="zoo-tm-name-line">
                        <b>{member.name}</b>
                        {member.isMe && <span className="zoo-tm-you-badge">你</span>}
                        {member.isOwner && <span className="zoo-tm-captain-badge">队长</span>}
                      </div>
                      <p>今天 {member.studyCount} 项{member.cheersReceived ? " · 收到 " + member.cheersReceived + " 次加油" : ""}</p>
                    </div>
                    {member.isMe ? (
                      <span className={"zoo-tm-member-state" + (member.completed ? " done" : "")}>{member.completed ? "完成 ✓" : "学习中"}</span>
                    ) : (
                      <button className={"zoo-tm-cheer" + (member.cheeredByMe ? " sent" : "")} disabled={member.cheeredByMe || Boolean(busy)} onClick={() => cheer(member.memberId)}>
                        {member.cheeredByMe ? "已加油" : "加油"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="zoo-tm-invite-ticket">
              <div className="zoo-tm-ticket-copy">
                <span className="zoo-tm-card-kicker">邀请码</span>
                <b>{team.inviteCode}</b>
                <small>分享给想一起坚持的人</small>
              </div>
              <div className="zoo-tm-invite-actions">
                <button className="zoo-tm-ghost" disabled={Boolean(busy)} onClick={copyInviteCode}>复制</button>
                <button className="zoo-tm-primary compact" disabled={Boolean(busy)} onClick={shareInvite}>分享邀请</button>
              </div>
            </section>

            <div className="zoo-tm-manage-row">
              {team.isOwner && <button onClick={editTeam}>队伍设置</button>}
              {team.isOwner && <button disabled={Boolean(busy)} onClick={regenerateInvite}>换邀请码</button>}
              <button className="danger" disabled={Boolean(busy)} onClick={leave}>退出队伍</button>
            </div>
            {editing && (
              <section className="zoo-tm-card-shell zoo-tm-edit-card">
                <TeamForm heading="队伍设置" draft={draft} setDraft={setDraft} submitLabel="保存设置" busy={Boolean(busy)} onSubmit={saveSettings} onCancel={() => setEditing(false)} />
              </section>
            )}
          </>
        ) : (
          <>
            <section className="zoo-tm-card-shell zoo-tm-create-card">
              <div className="zoo-tm-create-head">
                <h2>创建自己的学习小队</h2>
                <span className="zoo-tm-create-emoji">{draft.emoji}</span>
              </div>
              <p className="zoo-tm-detail">最多 6 人。公开队伍会出现在广场，仅邀请队伍需要邀请码。</p>
              <label className="zoo-tm-field">你的队友昵称
                <input className="zoo-tm-input" value={nickname} maxLength={20} onChange={(event) => setNickname(event.target.value)} placeholder="例如：每天背十个" />
              </label>
              <TeamForm draft={draft} setDraft={setDraft} submitLabel="创建队伍" busy={Boolean(busy)} disabled={!nickname.trim()} onSubmit={create} />
            </section>

            <section className="zoo-tm-join-ticket">
              <div className="zoo-tm-join-copy"><h2>已经收到邀请？</h2><p>输入队友发来的 8 位邀请码</p></div>
              <div className="zoo-tm-join-form">
                <input className="zoo-tm-input code" value={inviteCode} maxLength={8} onChange={(event) => setInviteCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} placeholder="邀请码" aria-label="8 位邀请码" />
                <button className="zoo-tm-secondary compact" disabled={busy !== "" || inviteCode.length !== 8 || !nickname.trim()} onClick={() => join({ inviteCode })}>加入</button>
              </div>
            </section>

            <div className="zoo-tm-plaza-heading">
              <h2>组队广场</h2>
              <span>公开队伍</span>
            </div>
            <div className="zoo-tm-plaza">
              {plaza.length === 0 && (
                <section className="zoo-tm-card-shell zoo-tm-empty">
                  <Sticker name="empty-box" size={84} /><h3>这里还很安静</h3>
                  <p>创建第一支公开队伍，等同路的人来加入。</p>
                </section>
              )}
              {plaza.map((item) => (
                <article key={item.id} className="zoo-tm-card-shell zoo-tm-plaza-item">
                  <span className="zoo-tm-plaza-emoji">{item.emoji}</span>
                  <div className="zoo-tm-plaza-copy">
                    <b>{item.name}</b>
                    <p><span>{item.targetLevel}</span>{item.memberCount}/{item.maxMembers} 人</p>
                    <small>今天 {item.activeCount} 人学习 · 连续 {item.streak} 天</small>
                  </div>
                  <div className="zoo-tm-plaza-actions">
                    <button className="zoo-tm-report" disabled={Boolean(busy)} onClick={() => report(item.id)}>举报</button>
                    <button className="zoo-tm-secondary compact" disabled={Boolean(busy) || !nickname.trim()} onClick={() => join({ teamId: item.id })}>加入</button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TeamForm({ draft, setDraft, submitLabel, busy, disabled = false, heading, onSubmit, onCancel }: {
  draft: TeamDraft;
  setDraft: (draft: TeamDraft) => void;
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
  heading?: string;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="zoo-tm-form">
      {heading && (
        <div className="zoo-tm-form-head">
          <h3>{heading}</h3>
          {onCancel && <button className="zoo-tm-close" onClick={onCancel} aria-label="取消编辑">×</button>}
        </div>
      )}
      <label className="zoo-tm-field">队伍名称
        <input className="zoo-tm-input" value={draft.name} maxLength={20} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：N3 每日打卡" />
      </label>
      {/* 选项都只有几个，摆成一排胶囊点一下就好。原来是三个原生下拉框，
          「图标」那个在下拉框里挑 emoji，手机上弹一个系统滚轮，看不清也挑不准 */}
      <div className="zoo-tm-field" role="group" aria-label="目标">目标
        <div className="zoo-tm-chips">
          {TARGETS.map((target) => (
            <button key={target} type="button" className="ds-chip" aria-pressed={draft.targetLevel === target} onClick={() => setDraft({ ...draft, targetLevel: target })}>{target}</button>
          ))}
        </div>
      </div>
      <div className="zoo-tm-field" role="group" aria-label="图标">图标
        <div className="zoo-tm-chips">
          {EMOJIS.map((emoji) => (
            <button key={emoji} type="button" className="ds-chip zoo-tm-emoji-chip" aria-pressed={draft.emoji === emoji} onClick={() => setDraft({ ...draft, emoji })}>{emoji}</button>
          ))}
        </div>
      </div>
      <div className="zoo-tm-field" role="group" aria-label="加入方式">加入方式
        <div className="zoo-tm-chips">
          <button type="button" className="ds-chip" aria-pressed={draft.visibility === "public"} onClick={() => setDraft({ ...draft, visibility: "public" })}>公开 · 会出现在广场</button>
          <button type="button" className="ds-chip" aria-pressed={draft.visibility === "invite"} onClick={() => setDraft({ ...draft, visibility: "invite" })}>仅邀请</button>
        </div>
      </div>
      <div className="zoo-tm-form-actions">
        <button className="zoo-tm-primary" disabled={busy || disabled || draft.name.trim().length < 2} onClick={onSubmit}>{busy ? "处理中…" : submitLabel}</button>
        {onCancel && <button className="zoo-tm-secondary" onClick={onCancel}>取消</button>}
      </div>
    </div>
  );
}
