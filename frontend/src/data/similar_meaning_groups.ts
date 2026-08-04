import type { WordCard } from "../types/vocabulary";
import { DbRow, rowsFor } from "../lib/database/db-utils";

type SimilarMeaningMember = readonly [kanji: string, kana: string, meaning: string];

export interface SimilarMeaningGroup {
  id: string;
  title: string;
  distinction: string;
  members: readonly SimilarMeaningMember[];
}

/*
 * 这里只放“中文提示容易给出多个合理答案”的高置信度词组。
 * 同中文释义只是发现候选的入口；真正放进来前按自动/他动、敬语方向、
 * 场景和语感人工确认。没有出现在 words 表里的成员不会显示成幽灵词条。
 */
export const similarMeaningGroups: readonly SimilarMeaningGroup[] = [
  {
    id: "honorific-come-go-be",
    title: "来／去／在（尊敬语）",
    distinction: "很多普通“来／去／在”的提示都能对应这些尊敬表达；お見えになる更偏“来到、到场”。",
    members: [
      ["いらっしゃる", "いらっしゃる", "来、去、在（尊敬语）"],
      ["おいでになる", "おいでになる", "来、去、在（尊敬语）"],
      ["お見えになる", "おみえになる", "来到、到场（尊敬语）"]
    ]
  },
  {
    id: "honorific-eat-drink",
    title: "吃／喝（敬语）",
    distinction: "召し上がる抬高对方；いただく是自己谦逊地吃、喝或接受。",
    members: [
      ["食べる", "たべる", "吃（普通说法）"],
      ["召し上がる", "めしあがる", "吃、喝（尊敬语）"],
      ["頂く", "いただく", "吃、喝；得到（谦让语）"]
    ]
  },
  {
    id: "honorific-say",
    title: "说（敬语）",
    distinction: "おっしゃる是对方说；申す是自己谦逊地说。不能互相替代。",
    members: [
      ["おっしゃる", "おっしゃる", "说（尊敬语）"],
      ["申す", "もうす", "说、称为（谦让语）"]
    ]
  },
  {
    id: "honorific-see",
    title: "看（敬语）",
    distinction: "ご覧になる抬高对方；拝見する降低自己。",
    members: [
      ["ご覧になる", "ごらんになる", "看（尊敬语）"],
      ["拝見", "はいけん", "拜见、观看（谦让语）"],
      ["見る", "みる", "看（普通说法）"]
    ]
  },
  {
    id: "open",
    title: "开",
    distinction: "開く（あく）是东西打开；開く（ひらく）常用于书、活动、会议；開ける是人为打开。",
    members: [
      ["開く", "あく", "打开、开着（自动词）"],
      ["開く", "ひらく", "打开；开办（自动词）"],
      ["開ける", "あける", "打开（他动词）"]
    ]
  },
  {
    id: "close",
    title: "关",
    distinction: "閉まる是自己关上；閉める是把某物关上。",
    members: [
      ["閉まる", "しまる", "关上（自动词）"],
      ["閉める", "しめる", "关上（他动词）"]
    ]
  },
  {
    id: "turn-on",
    title: "开／亮／接通",
    distinction: "つく是自己亮、接通或附着；つける是人为打开、接上或附着。",
    members: [
      ["つく", "つく", "亮；接通；附着（自动词）"],
      ["つける", "つける", "打开；接上；附着（他动词）"]
    ]
  },
  {
    id: "disappear",
    title: "消失／关掉",
    distinction: "消える是自己消失；消す是人为消除或关掉。",
    members: [
      ["消える", "きえる", "消失；熄灭（自动词）"],
      ["消す", "けす", "消除；关掉（他动词）"]
    ]
  },
  {
    id: "enter-put-in",
    title: "进入／放入",
    distinction: "入る是进去；入れる是把东西放进去。",
    members: [
      ["入る", "はいる", "进入（自动词）"],
      ["入れる", "いれる", "放入；装入（他动词）"]
    ]
  },
  {
    id: "leave-take-out",
    title: "出去／拿出",
    distinction: "出る是出来、出去；出す是拿出、提交或发出。",
    members: [
      ["出る", "でる", "出去；出来（自动词）"],
      ["出す", "だす", "拿出；提交；发出（他动词）"]
    ]
  },
  {
    id: "start",
    title: "开始",
    distinction: "始まる是事情开始；始める是某人开始某事。",
    members: [
      ["始まる", "はじまる", "开始（自动词）"],
      ["始める", "はじめる", "开始做（他动词）"]
    ]
  },
  {
    id: "decide",
    title: "决定",
    distinction: "決まる是被决定、定下来；決める是主动决定。",
    members: [
      ["決まる", "きまる", "决定下来（自动词）"],
      ["決める", "きめる", "决定（他动词）"]
    ]
  },
  {
    id: "change",
    title: "改变",
    distinction: "変わる是发生变化；変える是改变某物。",
    members: [
      ["変わる", "かわる", "变化（自动词）"],
      ["変える", "かえる", "改变（他动词）"]
    ]
  },
  {
    id: "continue",
    title: "继续",
    distinction: "続く是持续；続ける是继续做某事。",
    members: [
      ["続く", "つづく", "持续（自动词）"],
      ["続ける", "つづける", "继续做（他动词）"]
    ]
  },
  {
    id: "increase",
    title: "增加",
    distinction: "増える是数量自然增加；増やす是人为增加数量。",
    members: [
      ["増える", "ふえる", "增加（自动词）"],
      ["増やす", "ふやす", "增加某物（他动词）"]
    ]
  },
  {
    id: "find",
    title: "找到",
    distinction: "見つかる是被找到；見つける是找到某物。",
    members: [
      ["見つかる", "みつかる", "被找到（自动词）"],
      ["見つける", "みつける", "找到（他动词）"]
    ]
  },
  {
    id: "fix-heal",
    title: "修好／治好",
    distinction: "直る／直す用于物品、错误；治る／治す用于疾病、伤病。",
    members: [
      ["直る", "なおる", "修好；改正（自动词）"],
      ["直す", "なおす", "修理；改正（他动词）"],
      ["治る", "なおる", "痊愈（自动词）"],
      ["治す", "なおす", "治好（他动词）"]
    ]
  },
  {
    id: "remember-recall",
    title: "记得／想起",
    distinction: "覚える是记住、学会；思い出す是从记忆中回想起来。",
    members: [
      ["覚える", "おぼえる", "记住；学会"],
      ["思い出す", "おもいだす", "想起来；回忆起"]
    ]
  },
  {
    id: "know-understand",
    title: "知道／明白",
    distinction: "知る是获得信息；分かる是理解内容或弄明白。",
    members: [
      ["知る", "しる", "知道；得知"],
      ["分かる", "わかる", "明白；理解"]
    ]
  },
  {
    id: "think-consider",
    title: "想／考虑",
    distinction: "思う偏感觉、认为；考える偏思考、考虑。",
    members: [
      ["思う", "おもう", "想；认为"],
      ["考える", "かんがえる", "思考；考虑"]
    ]
  },
  {
    id: "see",
    title: "看／看见／给看",
    distinction: "見る是主动看；見える是自然看得见；見せる是给别人看。",
    members: [
      ["見る", "みる", "看"],
      ["見える", "みえる", "看得见；映入眼帘"],
      ["見せる", "みせる", "给别人看；展示"]
    ]
  },
  {
    id: "hear",
    title: "听／听见",
    distinction: "聞く是主动听或询问；聞こえる是声音自然传入耳中。",
    members: [
      ["聞く", "きく", "听；询问"],
      ["聞こえる", "きこえる", "听得见；听起来"]
    ]
  },
  {
    id: "choose-decide",
    title: "选择／决定",
    distinction: "選ぶ是从候选中选；決める是作出决定。",
    members: [
      ["選ぶ", "えらぶ", "选择"],
      ["決める", "きめる", "决定"]
    ]
  },
  {
    id: "prepare",
    title: "准备",
    distinction: "準備偏为事情做准备；用意偏准备具体物品。",
    members: [
      ["準備", "じゅんび", "准备"],
      ["用意", "ようい", "准备、备好"]
    ]
  },
  {
    id: "explain-introduce",
    title: "说明／介绍",
    distinction: "説明是解释内容；紹介是把人或事物介绍给别人。",
    members: [
      ["説明", "せつめい", "说明；解释"],
      ["紹介", "しょうかい", "介绍"]
    ]
  },
  {
    id: "participate-attend",
    title: "参加／出席",
    distinction: "参加偏参与活动；出席偏出席会议、课程等正式场合。",
    members: [
      ["参加", "さんか", "参加"],
      ["出席", "しゅっせき", "出席"]
    ]
  },
  {
    id: "experience",
    title: "经验／体验",
    distinction: "経験偏累计经历；体験偏亲身经历某件事。",
    members: [
      ["経験", "けいけん", "经验；经历"],
      ["体験", "たいけん", "亲身体验"]
    ]
  },
  {
    id: "plan-promise",
    title: "计划／约定",
    distinction: "予定是预定安排；約束是和别人约好或作出承诺。",
    members: [
      ["予定", "よてい", "预定；计划"],
      ["約束", "やくそく", "约定；承诺"]
    ]
  },
  {
    id: "reason-cause",
    title: "理由／原因",
    distinction: "原因是事情发生的客观原因；理由是人做某事的理由。",
    members: [
      ["原因", "げんいん", "原因"],
      ["理由", "りゆう", "理由"]
    ]
  },
  {
    id: "safe-relieved",
    title: "安全／放心",
    distinction: "安全是客观没有危险；安心是主观感到放心。",
    members: [
      ["安全", "あんぜん", "安全"],
      ["安心", "あんしん", "放心；安心"]
    ]
  },
  {
    id: "always-usually",
    title: "总是／平时",
    distinction: "いつも偏每次、总是；普段偏平常状态。",
    members: [
      ["いつも", "いつも", "总是；一直"],
      ["普段", "ふだん", "平时；平常"]
    ]
  },
  {
    id: "sometimes",
    title: "偶尔／有时",
    distinction: "たまに频率更低；ときどき是中性的“有时”。",
    members: [
      ["たまに", "たまに", "偶尔"],
      ["時々", "ときどき", "有时；时常"]
    ]
  },
  {
    id: "finally",
    title: "终于／最终",
    distinction: "やっと强调困难后实现；とうとう常带结果感；ついに较正式。",
    members: [
      ["やっと", "やっと", "终于；好不容易"],
      ["とうとう", "とうとう", "终于；最终"],
      ["ついに", "ついに", "终于；最终"]
    ]
  },
  {
    id: "gradually-rapidly",
    title: "逐渐／不断",
    distinction: "だんだん是渐变；どんどん是快速、连续地发展。",
    members: [
      ["だんだん", "だんだん", "逐渐"],
      ["どんどん", "どんどん", "不断地；快速地"]
    ]
  },
  {
    id: "probably-surely",
    title: "大概／一定",
    distinction: "たぶん是不确定推测；きっと是较强确信。",
    members: [
      ["たぶん", "たぶん", "大概；可能"],
      ["きっと", "きっと", "一定；想必"]
    ]
  },
  {
    id: "properly",
    title: "好好地／认真地",
    distinction: "ちゃんと偏口语；きちんと偏整齐规范；しっかり偏牢固可靠。",
    members: [
      ["ちゃんと", "ちゃんと", "好好地；确实"],
      ["きちんと", "きちんと", "整齐地；规矩地"],
      ["しっかり", "しっかり", "牢固地；认真地"]
    ]
  },
  {
    id: "for-now",
    title: "姑且／先",
    distinction: "一応是最低限度完成；とりあえず是先做眼前的一步。",
    members: [
      ["一応", "いちおう", "姑且；暂且"],
      ["とりあえず", "とりあえず", "先；暂且"]
    ]
  },
  {
    id: "on-purpose-special-effort",
    title: "故意／特意",
    distinction: "わざと是故意做；わざわざ是特意费力去做。",
    members: [
      ["わざと", "わざと", "故意"],
      ["わざわざ", "わざわざ", "特意；专程"]
    ]
  }
];

const memberMatches = (member: SimilarMeaningMember, row: DbRow): boolean => {
  const kanji = String(row.kanji ?? "");
  const kana = String(row.kana ?? "");
  return member[0] === kanji && member[1] === kana;
};

const rowMatchesMember = (row: DbRow, member: SimilarMeaningMember): boolean => (
  String(row.kanji ?? "") === member[0] && String(row.kana ?? "") === member[1]
);

export function similarMeaningCandidates(row: DbRow): WordCard["similarMeaning"] {
  const group = similarMeaningGroups.find((candidate) => candidate.members.some((member) => memberMatches(member, row)));
  if (!group) return null;

  const params = group.members.flatMap(([kanji, kana]) => [kanji, kana]);
  const clauses = group.members.map(() => "(kanji = ? AND kana = ?)").join(" OR ");
  const rows = rowsFor(
    `SELECT id, meaning, kana, kanji FROM words WHERE ${clauses}`,
    params
  );
  const items = group.members.flatMap((member) => {
    const match = rows.find((candidate) => rowMatchesMember(candidate, member));
    if (!match || Number(match.id ?? 0) === Number(row.id ?? 0)) return [];
    return [{
      id: Number(match.id ?? 0),
      kana: String(match.kana ?? member[1]),
      kanji: String(match.kanji ?? member[0]),
      meaning: String(match.meaning ?? member[2]),
      note: member[2]
    }];
  });

  return items.length ? { title: group.title, distinction: group.distinction, items } : null;
}
