import { Camera, ChevronRight, Edit2, User } from "lucide-react";
import { useState, useEffect } from "react";
import {
  loadUserProfile,
  updateBasicInfo,
  updateAvatar,
  updateTargetLevel,
  formatStudyTime,
  normalizeTargetLevel,
  TARGET_LEVEL_OPTIONS,
  UserProfile
} from "../lib/userProfile";
import { refreshUserProfileFromCloud, saveUserProfileToCloud } from "../lib/profile-sync";
import { studyTotals, type StudyTotals } from "../lib/study-totals";
import { achievementSummary, type Achievement } from "../lib/achievements";

interface PersonalInfoProps {
  onBack: () => void;
  onOpenAchievements: () => void;
}

export function PersonalInfo({ onBack: _onBack, onOpenAchievements }: PersonalInfoProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [tempNickname, setTempNickname] = useState("");
  const [tempBio, setTempBio] = useState("");
  const [tempTargetLevel, setTempTargetLevel] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncMessage, setSyncMessage] = useState("正在读取账号资料…");
  // 学习时长和天数问数据库要，不看 profile 里那两个遗留字段（见 study-totals.ts）
  const [totals, setTotals] = useState<StudyTotals>({ minutes: 0, days: 0 });
  const [board, setBoard] = useState<{ unlocked: number; total: number; recent: Achievement[] }>(
    { unlocked: 0, total: 0, recent: [] }
  );

  // 加载用户资料
  useEffect(() => {
    setTotals(studyTotals());
    setBoard(achievementSummary());
    loadUserProfile().then((data) => {
      setProfile(data);
      setTempNickname(data.nickname);
      setTempBio(data.bio);
      setTempTargetLevel(normalizeTargetLevel(data.targetLevel));
      void refreshUserProfileFromCloud().then((synced) => {
        setProfile(synced);
        setTempNickname(synced.nickname);
        setTempBio(synced.bio);
        setTempTargetLevel(normalizeTargetLevel(synced.targetLevel));
        setSyncMessage("账号资料已同步");
      }).catch(() => setSyncMessage("当前离线；修改会先保存在本机，联网后继续同步"));
    });
  }, []);

  const handleSave = async () => {
    if (!profile) return;

    setSaving(true);
    try {
      await updateBasicInfo(tempNickname, tempBio);
      const local = await loadUserProfile();
      setProfile(local);
      try {
        setProfile(await saveUserProfileToCloud(local));
        setSyncMessage("账号资料已同步");
      } catch {
        setSyncMessage("已保存到本机；联网后会继续同步");
      }
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to save profile:", error);
      alert("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (!profile) return;
    setTempNickname(profile.nickname);
    setTempBio(profile.bio);
    setIsEditing(false);
  };

  const handleSaveTarget = async () => {
    if (!profile) return;

    setSaving(true);
    try {
      const nextTarget = normalizeTargetLevel(tempTargetLevel);
      await updateTargetLevel(nextTarget);
      const local = await loadUserProfile();
      setProfile(local);
      try {
        setProfile(await saveUserProfileToCloud(local));
        setSyncMessage("账号资料已同步");
      } catch {
        setSyncMessage("已保存到本机；联网后会继续同步");
      }
      setIsEditingTarget(false);
    } catch (error) {
      console.error("Failed to save target level:", error);
      alert("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelTarget = () => {
    if (!profile) return;
    setTempTargetLevel(profile.targetLevel);
    setIsEditingTarget(false);
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !profile) return;

    // 检查文件大小（限制 2MB）
    if (file.size > 2 * 1024 * 1024) {
      alert("图片大小不能超过 2MB");
      return;
    }

    // 读取并转换为 Base64
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      try {
        await updateAvatar(base64);
        const local = await loadUserProfile();
        setProfile(local);
        try {
          setProfile(await saveUserProfileToCloud(local));
          setSyncMessage("头像已同步");
        } catch {
          setSyncMessage("头像已保存到本机；联网后会继续同步");
        }
      } catch (error) {
        console.error("Failed to update avatar:", error);
        alert("头像更新失败，请重试");
      }
    };
    reader.readAsDataURL(file);
  };

  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl pb-4">
        <div className="mb-4 rounded-2xl border border-white/15 bg-[#474a4a] p-8 text-center">
          <p className="text-sm text-white/50">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-4">

      <div className="mb-4 rounded-2xl border border-[#91C968]/20 bg-[#91C968]/10 px-3 py-2 text-xs font-bold text-[#B7E38D]">
        {syncMessage}
      </div>

      {/* 头像 */}
      <div className="mb-4 rounded-2xl border border-white/15 bg-[#464949] p-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            <label htmlFor="avatar-upload" className="cursor-pointer">
              {profile.avatar ? (
                <img
                  src={profile.avatar}
                  alt="头像"
                  className="h-20 w-20 shrink-0 rounded-full border-2 border-white/20 object-cover"
                />
              ) : (
                <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-2 border-white/20 bg-[#81D8CF] text-[#343838]">
                  <User size={40} />
                </div>
              )}
              <div className="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-[#3c3f3f] text-white hover:bg-[#4d5151]">
                <Camera size={14} />
              </div>
            </label>
            <input
              id="avatar-upload"
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">更换头像</p>
            <p className="mt-1 text-xs text-white/50">点击头像或相机图标选择新头像</p>
            <label htmlFor="avatar-upload" className="mt-2 inline-block cursor-pointer text-xs font-bold text-[#81D8CF] hover:text-white">
              从相册选择
            </label>
          </div>
        </div>
      </div>

      {/* 基本信息 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">基本信息</p>
        <div className="space-y-3 rounded-2xl border border-white/15 bg-[#464949] p-4">
          {!isEditing ? (
            <>
              <div>
                <label className="mb-1 block text-xs text-white/50">昵称</label>
                <p className="text-sm font-bold text-white">{profile.nickname}</p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">个人简介</label>
                <p className="text-sm text-white/80">{profile.bio}</p>
              </div>
              <button
                onClick={() => setIsEditing(true)}
                className="focus-ring inline-flex items-center gap-2 rounded-2xl bg-[#3c3f3f] px-3 py-2 text-sm font-bold text-white hover:bg-[#4d5151]"
              >
                <Edit2 size={14} />
                编辑信息
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs text-white/60">昵称</label>
                <input
                  type="text"
                  value={tempNickname}
                  onChange={(e) => setTempNickname(e.target.value)}
                  className="focus-ring w-full rounded-2xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
                  placeholder="请输入昵称"
                  maxLength={20}
                />
                <p className="mt-1 text-xs text-white/40">{tempNickname.length}/20</p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">个人简介</label>
                <textarea
                  value={tempBio}
                  onChange={(e) => setTempBio(e.target.value)}
                  className="focus-ring w-full rounded-2xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
                  placeholder="介绍一下自己吧"
                  rows={3}
                  maxLength={100}
                />
                <p className="mt-1 text-xs text-white/40">{tempBio.length}/100</p>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="focus-ring flex-1 rounded-2xl bg-[#81D8CF] px-4 py-2 text-sm font-bold text-[#343838] hover:bg-white disabled:opacity-50"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="focus-ring rounded-2xl border border-white/20 px-4 py-2 text-sm font-bold text-white/78 hover:bg-white/8 disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 学习身份 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">学习身份</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          {/* 当前等级目标 */}
          <div className="border-b border-white/10 p-4">
            {!isEditingTarget ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white">当前等级目标</p>
                  <p className="mt-0.5 text-xs text-white/50">{profile.targetLevel}</p>
                </div>
                <button
                  onClick={() => setIsEditingTarget(true)}
                  className="focus-ring rounded-2xl bg-[#3c3f3f] p-2 text-white/70 hover:bg-[#4d5151] hover:text-white"
                >
                  <Edit2 size={14} />
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-xs text-white/60">日语学习目标</label>
                <select
                  value={tempTargetLevel}
                  onChange={(e) => setTempTargetLevel(e.target.value)}
                  className="focus-ring w-full rounded-2xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
                >
                  {TARGET_LEVEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveTarget}
                    disabled={saving}
                    className="focus-ring flex-1 rounded-2xl bg-[#81D8CF] px-3 py-2 text-sm font-bold text-[#343838] hover:bg-white disabled:opacity-50"
                  >
                    {saving ? "保存中..." : "保存"}
                  </button>
                  <button
                    onClick={handleCancelTarget}
                    disabled={saving}
                    className="focus-ring rounded-2xl border border-white/20 px-3 py-2 text-sm font-bold text-white/78 hover:bg-white/8 disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex w-full items-center gap-3 border-b border-white/10 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">学习时长</p>
              <p className="mt-0.5 text-xs text-white/50">累计 {formatStudyTime(totals.minutes)}</p>
            </div>
          </div>

          <div className="flex w-full items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">学习天数</p>
              <p className="mt-0.5 text-xs text-white/50">已学习 {totals.days} 天</p>
            </div>
          </div>
        </div>
      </div>

      {/* 成就 —— 详情在成就页，这里只摆最近拿到的几个 */}
      <div>
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">成就</p>
        <button
          onClick={onOpenAchievements}
          className="focus-ring w-full rounded-2xl border border-white/15 bg-[#464949] p-4 text-left hover:bg-[#4d5151]"
        >
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-white">已解锁 {board.unlocked} / {board.total}</span>
              <span className="mt-0.5 block text-xs text-white/50">
                {board.recent.length ? `最近：${board.recent.map((item) => `${item.emoji} ${item.name}`).join(" · ")}` : "还没有解锁的成就，去学两个词"}
              </span>
            </span>
            <ChevronRight size={17} className="text-white/40" />
          </div>
          <div className="ach-summary-bar mt-3">
            <span style={{ width: `${board.total ? Math.round(board.unlocked / board.total * 100) : 0}%` }} />
          </div>
        </button>
      </div>
    </div>
  );
}
