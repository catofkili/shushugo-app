import { useCallback, useEffect, useRef, useState } from "react";
import {
  cheerCloudTeamMember,
  createCloudTeam,
  getCloudSession,
  getCloudTeamOverview,
  joinCloudTeam,
  leaveCloudTeam,
  regenerateCloudTeamInvite,
  reportCloudTeam,
  reportCloudTeamActivity,
  updateCloudTeam,
  takeCloudTeamLeave,
  type CloudTeam,
  type CloudTeamPlazaItem
} from "../lib/sync-api";
import { Check, RefreshCw } from "lucide-react";
import { CapybaraWalk, Sticker } from "../components/CapybaraMascot";
import { MascotSay } from "../components/MascotSay";
import { playKnow, playSave, playStreakChirp } from "../lib/zoo-sounds";
import { confirmDialog, promptDialog } from "../lib/platform-dialogs";
import { copyText, shareText } from "../lib/share-text";
import { pageShareButtonProps, usePageShare } from "../lib/page-share";
import { claimTeamCheckin, collectTeamRewards, localActivity, readTeamCache, rememberTeamActivity, teamCheckedIn, writeTeamCache } from "../lib/team-activity";
import { shiftTeamDay, teamDayPassed, type TeamDayStatus } from "../lib/team-rules";
import { triggerTeamCheckinHaptic } from "../lib/haptics";
import { jsMotionAllowed } from "../lib/studyPreferences";
import { YUZU_EVENT } from "../lib/yuzu";
import { PROGRESS_UPDATED_EVENT } from "../lib/progress-events";
import { ZooConfetti } from "../components/ZooConfetti";
import "./team-duel.css";

const EMOJIS = ["🌱", "🐿️", "🐦", "🚃", "🦉", "🍊", "📚", "⛩️"];
const TARGETS = ["N5", "N4", "N3", "N2", "N1", "全部"];

type TeamDraft = {
  name: string;
  targetLevel: string;
  emoji: string;
  visibility: "public" | "invite";
};

const defaultDraft: TeamDraft = { name: "", targetLevel: "N3", emoji: "🌱", visibility: "public" };

const messageFor = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后再试。";
const CELL_LABELS: Record<TeamDayStatus, string> = { passed: "过关", leave: "请假", failed: "没过关", today: "进行中", future: "未开始", "not-joined": "未入队" };

export function TeamPage({ onBack, onOpenDuel, initialInviteCode = "" }: { onBack: () => void; onOpenDuel: () => void; initialInviteCode?: string }) {
  const [team, setTeam] = useState<CloudTeam | null>(null);
  const [plaza, setPlaza] = useState<CloudTeamPlazaItem[]>([]);
  const [draft, setDraft] = useState<TeamDraft>(defaultDraft);
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState(() => initialInviteCode.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8));
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [activity, setActivity] = useState(localActivity);
  const [checkedIn, setCheckedIn] = useState(teamCheckedIn);
  const [celebrating, setCelebrating] = useState(false);
  const [checkinLeaving, setCheckinLeaving] = useState(false);
  const [checkinCount, setCheckinCount] = useState(0);

  const ownerRef = useRef<string | undefined>(undefined);
  const progressCard = { title: `我们队本期第 ${team?.period?.dayNumber ?? 0} 天全员过关`, path: "/study/team/index" };
  const inviteCard = { title: `来「收集日」加入我的学习队伍「${team?.name ?? ""}」`, path: `/study/team/index?invite=${encodeURIComponent(team?.inviteCode ?? "")}` };
  usePageShare(team?.period?.dayNumber && team.members.every((member) => teamDayPassed(member.wordCount, member.activeMinutes)) ? progressCard : null);

  const refresh = useCallback(async () => {
    const currentActivity = localActivity();
    setActivity(currentActivity);
    const overview = await getCloudTeamOverview(currentActivity);
    setTeam(overview.team);
    setPlaza(overview.plaza);
    setLoading(false);
    writeTeamCache(ownerRef.current, overview.team, overview.plaza);
    if (overview.team) rememberTeamActivity(ownerRef.current, currentActivity);
    void collectTeamRewards().catch(() => undefined);
  }, []);

  const acceptTeam = (next: CloudTeam | null) => {
    setTeam(next);
    writeTeamCache(ownerRef.current, next, plaza);
  };

  useEffect(() => {
    const update = () => { setActivity(localActivity()); setCheckedIn(teamCheckedIn()); };
    window.addEventListener(YUZU_EVENT, update);
    window.addEventListener(PROGRESS_UPDATED_EVENT, update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener(YUZU_EVENT, update);
      window.removeEventListener(PROGRESS_UPDATED_EVENT, update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (!celebrating) return;
    const timer = window.setTimeout(() => setCheckinLeaving(true), 2200);
    return () => window.clearTimeout(timer);
  }, [celebrating]);

  useEffect(() => {
    if (!checkinLeaving) return;
    const timer = window.setTimeout(() => {
      setCelebrating(false);
      setCheckinLeaving(false);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [checkinLeaving]);

  useEffect(() => {
    if (!celebrating || !jsMotionAllowed()) return;
    const startedAt = Date.now();
    let frame = 0;
    const tick = () => {
      const progress = Math.min((Date.now() - startedAt) / 600, 1);
      setCheckinCount(Math.round(progress * 20));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [celebrating]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await getCloudSession();
        if (!active) return;
        setNickname(session.displayName ?? "");
        ownerRef.current = session.email;
        const cached = readTeamCache(session.email);
        if (cached) {
          setTeam(cached.team);
          setPlaza(cached.plaza);
          setLoading(false);
        }
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
    acceptTeam(created);
    const currentActivity = localActivity();
    acceptTeam(await reportCloudTeamActivity(currentActivity));
    rememberTeamActivity(ownerRef.current, currentActivity);
    setPlaza((items) => items.filter((item) => item.id !== created.id));
    playStreakChirp();
    setNotice("队伍创建好了，邀请队友一起学习吧。");
  });

  const join = (input: { teamId?: string; inviteCode?: string }) => run("join-" + (input.teamId ?? "invite"), async () => {
    acceptTeam(await joinCloudTeam({ ...input, displayName: nickname }));
    const currentActivity = localActivity();
    acceptTeam(await reportCloudTeamActivity(currentActivity));
    rememberTeamActivity(ownerRef.current, currentActivity);
    setInviteCode("");
    playStreakChirp();
    setNotice("加入成功，今天的学习进度已经同步到队伍。");
  });

  const cheer = (memberId: string) => run("cheer-" + memberId, async () => {
    acceptTeam(await cheerCloudTeamMember(memberId, localActivity().studyDay));
    playKnow();
  });

  const checkin = () => run("checkin", async () => {
    if (!team || !await claimTeamCheckin()) return;
    setCheckedIn(true);
    setCheckinCount(0);
    setCelebrating(true);
    triggerTeamCheckinHaptic();
    playStreakChirp();
  });

  const takeLeave = () => run("take-leave", async () => {
    if (!team?.leaveOpportunity || team.leaveOpportunity.used) return;
    acceptTeam(await takeCloudTeamLeave(team.leaveOpportunity.studyDay));
    playSave();
    setNotice("请假已补上。");
  });

  const shareProgress = () => run("share-progress", async () => {
    if (!team?.period) return;
    await shareText("收集日组队进度", `我们队本期第 ${team.period.dayNumber} 天全员过关 · ${team.name}`);
  });

  const copyInviteCode = () => run("copy-code", async () => {
    if (!team) return;
    await copyText(team.inviteCode);
    playSave();
    setNotice("邀请码已复制。");
  });

  const shareInvite = () => run("share", async () => {
    if (!team) return;
    const text = "来「收集日」加入我的学习队伍「" + team.name + "」：邀请码 " + team.inviteCode;
    await shareText("收集日组队邀请", text);
    playSave();
    setNotice("邀请信息已准备好。");
  });

  const saveSettings = () => run("edit", async () => {
    acceptTeam(await updateCloudTeam(draft));
    setEditing(false);
    setNotice("队伍设置已保存。");
  });

  const regenerateInvite = () => run("regenerate", async () => {
    if (!await confirmDialog("旧邀请码会立即失效，确定更新吗？")) return;
    const code = await regenerateCloudTeamInvite();
    setTeam((current) => current ? { ...current, inviteCode: code } : current);
    setNotice("已生成新的邀请码。");
  });

  const leave = () => run("leave", async () => {
    if (!await confirmDialog(team?.isOwner && team.memberCount > 1 ? "退出后会把队长移交给最早加入的队友，确定退出吗？" : "确定退出这支队伍吗？")) return;
    await leaveCloudTeam();
    acceptTeam(null);
    await refresh();
    setNotice("已经退出队伍。");
  });

  const editTeam = () => {
    if (!team) return;
    setDraft({ name: team.name, targetLevel: team.targetLevel, emoji: team.emoji, visibility: team.visibility });
    setEditing(true);
  };

  const report = (teamId: string) => {
    void promptDialog("举报原因：广告或联系方式 / 不当内容 / 冒充或欺骗 / 其他", "不当内容").then((reason) => {
      if (!reason) return;
      return run("report-" + teamId, async () => {
        await reportCloudTeam(teamId, reason);
        setPlaza((items) => items.filter((item) => item.id !== teamId));
        setNotice("已收到举报，这支队伍已从你的广场隐藏。");
      });
    });
  };

  const refreshPage = () => run("refresh", async () => {
    await refresh();
    setNotice("队伍信息已更新。");
  });

  return (
    <>
    <div className="zoo-page zoo-tm-page">
      {/* 头图和主页今日大卡同一块主色（跟皮肤走）。原来是写死的森林绿 + 三个 emoji 动物，
          换了樱 / 抹茶皮肤、切深色都不跟。英文加宽的小标题（STUDY TOGETHER / TEAM）一起删了 */}
      <header className="zoo-tm-hero">
        <button className="zoo-tm-back" onClick={onBack}>‹ 返回</button>
        <div className="zoo-tm-hero-copy">
          <h1>一起学，会走得更远</h1>
          <p>分享今天的脚步，给认真学习的队友加油</p>
        </div>
        <Sticker name="scene-team" size={96} className="zoo-tm-hero-art" />
        {!loading && (
          <button className="zoo-tm-refresh" disabled={Boolean(busy)} onClick={refreshPage}>
            <RefreshCw size={13} aria-hidden="true" /> 刷新
          </button>
        )}
      </header>

      <div className="zoo-tm-content">
        <button className="ds-btn-soft team-duel-entry" onClick={onOpenDuel}>发起对战 →</button>
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
              {team.period && <>
                <div className="zoo-tm-stats">
                  <div><b>{team.period.dayNumber}/14</b><span>{team.period.dayNumber ? "本期第几天" : "明天开始"}</span></div>
                  <div><b>{team.period.accruedAmount}</b><span>本期已攒柚子</span></div>
                  <div><b>{team.members.filter((member) => teamDayPassed(member.wordCount, member.activeMinutes)).length}/{team.memberCount}</b><span>今天过关</span></div>
                </div>
                <div className="zoo-tm-summary-progress" role="progressbar" aria-label="本期进度" aria-valuemin={0} aria-valuemax={14} aria-valuenow={team.period.dayNumber}>
                  <span style={{ width: `${team.period.dayNumber / 14 * 100}%` }} />
                </div>
                {team.period.broken && <MascotSay sticker="mood-puzzled" tone="warn" size={44}>本期断了 · {team.members.filter((member) => team.period.culprits.includes(member.memberId)).map((member) => member.name).join("、")}</MascotSay>}
                {team.period.dayNumber > 0 && team.members.every((member) => teamDayPassed(member.wordCount, member.activeMinutes)) && (
                  <button className="ds-btn-soft team-progress-share" disabled={Boolean(busy)} {...pageShareButtonProps(progressCard, shareProgress)}>我们队本期第 {team.period.dayNumber} 天全员过关 ↗</button>
                )}
              </>}
              <div className="team-checkin-area">
                <button className="zoo-tm-primary" disabled={Boolean(busy) || checkedIn || !teamDayPassed(activity.wordCount, activity.activeMinutes)} onClick={checkin}>
                  {checkedIn ? <>今天已打卡 <Check size={14} aria-hidden="true" /></> : "组队打卡 · +20 柚子"}
                </button>
                {!checkedIn && !teamDayPassed(activity.wordCount, activity.activeMinutes) && <p className="zoo-tm-progress-note">今天 {activity.wordCount}/30 词 · {activity.activeMinutes}/10 分钟</p>}
                {team.leaveOpportunity && <button className="ds-btn-soft team-leave-button" disabled={Boolean(busy) || team.leaveOpportunity.used} onClick={takeLeave}>
                  {team.leaveOpportunity.used ? "本期请假已用过" : "我昨天没完成 · 请假"}
                </button>}
              </div>
            </section>

            <section className="zoo-tm-card-shell zoo-tm-members-card">
              <div className="zoo-tm-section-head">
                <h2>本期的队友</h2>
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
                      <p>今天 {member.wordCount ?? 0} 词 · {member.activeMinutes ?? 0} 分钟{member.cheersReceived ? " · 收到 " + member.cheersReceived + " 次加油" : ""}</p>
                    </div>
                    {member.isMe ? (
                      <span className={"zoo-tm-member-state" + (teamDayPassed(member.wordCount, member.activeMinutes) ? " done" : "")}>{teamDayPassed(member.wordCount, member.activeMinutes) ? <>过关 <Check size={12} aria-hidden="true" /></> : "学习中"}</span>
                    ) : (
                      <button className={"zoo-tm-cheer" + (member.cheeredByMe ? " sent" : "")} disabled={member.cheeredByMe || Boolean(busy)} onClick={() => cheer(member.memberId)}>
                        {member.cheeredByMe ? "已加油" : "加油"}
                      </button>
                    )}
                    {team.period && <div className="team-period-grid" aria-label={`${member.name}的14天进度`}>
                      {(member.cells ?? []).map((status, index) => <span key={index} className={`team-period-cell ${status}`} title={`${shiftTeamDay(team.period.start, index)} · ${CELL_LABELS[status]}`} aria-label={`第${index + 1}天：${CELL_LABELS[status]}`}>
                        {status === "leave" ? "请假" : status === "passed" ? <Check size={11} aria-hidden="true" /> : status === "failed" ? "×" : status === "not-joined" ? "—" : index + 1}
                      </span>)}
                    </div>}
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
                <button className="zoo-tm-primary compact" disabled={Boolean(busy)} {...pageShareButtonProps(inviteCard, shareInvite)}>分享邀请</button>
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
    {celebrating && <div
      className={`team-checkin-burst${checkinLeaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
      onClick={() => { setCelebrating(false); setCheckinLeaving(false); }}
    >
      {jsMotionAllowed() && <>
        <div className="team-checkin-glow" aria-hidden="true" />
        <div className="team-checkin-rings" aria-hidden="true"><i /><i /><i /></div>
        <ZooConfetti count={60} />
      </>}
      <div className="team-checkin-center" aria-hidden="true">
        <Sticker name="mood-yay" size={160} className="team-checkin-sticker" />
        <b>打卡完成</b>
        <span>+{jsMotionAllowed() ? checkinCount : 20} 柚子</span>
      </div>
      <span className="sr-only">打卡完成。+20 柚子</span>
    </div>}
    </>
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
