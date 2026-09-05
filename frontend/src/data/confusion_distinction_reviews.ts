/**
 * 疑难辨析的人工区别稿。
 *
 * 只有真正存在用法差异的组才进入这里：
 * - interchangeable: 黑色，通常可以互换，说明语体、搭配或语感差别；
 * - major: 红色，不能随意互换，说明会改变句法角色或核心意思。
 *
 * 同音异义、同字异读和纯音形相近不写区别句；它们的词形、读音、释义和例句已经
 * 足够，避免给学习者制造“这些词还有一条隐藏规则”的错觉。
 */

export type DistinctionLevel = "interchangeable" | "major";

export interface DistinctionReview {
  groupKey: string;
  level: DistinctionLevel;
  summary: string;
}

export const DISTINCTION_REVIEWS: readonly DistinctionReview[] = [
  {
    groupKey: "pair:始まる / 始める",
    level: "major",
    summary: "始まる表示事情自己开始；始める表示某人主动开始做某事。"
  },
  {
    groupKey: "pair:終える / 終わる",
    level: "major",
    summary: "終わる表示事情结束；終える表示某人把事情做完。"
  },
  {
    groupKey: "pair:開く / 開ける",
    level: "major",
    summary: "開く（あく）表示东西自己打开或处于打开状态；開ける表示人为打开。"
  },
  {
    groupKey: "pair:閉まる / 閉める",
    level: "major",
    summary: "閉まる表示东西自己关上；閉める表示人为把东西关上。"
  },
  {
    groupKey: "pair:入る / 入れる",
    level: "major",
    summary: "入る表示主体自己进入；入れる表示把东西或人放进某处。"
  },
  {
    groupKey: "pair:出す / 出る",
    level: "major",
    summary: "出る表示主体自己出来或出去；出す表示把东西拿出、提交或发出。"
  },
  {
    groupKey: "pair:変える / 変わる",
    level: "major",
    summary: "変わる表示状态自己发生变化；変える表示人为改变某物或某事。"
  },
  {
    groupKey: "pair:休む / 休める",
    level: "major",
    summary: "休む表示自己休息或请假；休める表示让人、身体或物品休息。"
  },
  {
    groupKey: "pair:決まる / 決める",
    level: "major",
    summary: "決まる表示事情被决定、定下来；決める表示某人主动作出决定。"
  },
  {
    groupKey: "pair:受かる / 受ける",
    level: "major",
    summary: "受かる专指考试等通过、考上；受ける表示参加考试或接受某事，不等于通过。"
  },
  {
    groupKey: "pair:売る / 売れる",
    level: "major",
    summary: "売る表示主动出售；売れる表示商品卖得出去或畅销。"
  },
  {
    groupKey: "pair:立つ / 立てる",
    level: "major",
    summary: "立つ表示主体自己站立或竖起；立てる表示把东西竖起来，也可表示制定计划。"
  },
  {
    groupKey: "pair:飛ばす / 飛ぶ",
    level: "major",
    summary: "飛ぶ表示主体自己飞或飞走；飛ばす表示使某物飞、跳过或吹走。"
  },
  {
    groupKey: "pair:聞く / 聞こえる",
    level: "major",
    summary: "聞く是主动听或询问；聞こえる是声音自然传入耳中、听得见。"
  },
  {
    groupKey: "pair:止まる / 止める",
    level: "major",
    summary: "止まる表示运动或事情自己停下；止める表示人为使其停止或阻止。"
  },
  {
    groupKey: "pair:無くす / 無くなる",
    level: "major",
    summary: "無くなる表示东西自己消失或不再存在；無くす表示把东西弄丢、弄没。"
  },
  {
    groupKey: "pair:直す / 直る",
    level: "major",
    summary: "直る表示错误或物品自己恢复正常；直す表示人为修理或改正。"
  },
  {
    groupKey: "pair:並ぶ / 並べる",
    level: "major",
    summary: "並ぶ表示人或物自己排成一列；並べる表示人为把它们排列起来。"
  },
  {
    groupKey: "pair:付く / 付ける",
    level: "major",
    summary: "付く表示东西附着、接通或自己带上；付ける表示人为装上、打开或加上。"
  },
  {
    groupKey: "pair:乗せる / 乗る",
    level: "major",
    summary: "乗る表示自己乘坐或登上；乗せる表示让人乘坐，或把东西载到上面。"
  },
  {
    groupKey: "pair:掛かる / 掛ける",
    level: "major",
    summary: "掛かる表示东西挂着、事情花费时间金钱或事情开始；掛ける表示挂上、花费或施加。"
  },
  {
    groupKey: "pair:起きる / 起こす",
    level: "major",
    summary: "起きる表示自己起床或事情发生；起こす表示叫醒某人或使事情发生。"
  },
  {
    groupKey: "pair:見える / 見る",
    level: "major",
    summary: "見る是主动去看；見える是自然看得见或映入眼帘。"
  },
  {
    groupKey: "pair:取る / 取れる",
    level: "major",
    summary: "取る表示主动拿取、取得；取れる表示东西自己脱落，或某事可以取得。"
  },
  {
    groupKey: "pair:消える / 消す",
    level: "major",
    summary: "消える表示火、灯光或痕迹自己消失；消す表示人为消除或关掉。"
  },
  {
    groupKey: "pair:上がる / 上げる",
    level: "major",
    summary: "上がる表示位置、数值自己上升；上げる表示把东西抬高、提高或提交。"
  },
  {
    groupKey: "pair:晴らす / 晴れる",
    level: "major",
    summary: "晴れる表示天气放晴；晴らす表示消除疑虑、怨气等抽象情绪。"
  },
  {
    groupKey: "pair:生まれる / 生む",
    level: "major",
    summary: "生まれる表示人或事物诞生；生む表示生育，或造成某种结果。"
  },
  {
    groupKey: "pair:切る / 切れる",
    level: "major",
    summary: "切る表示主动切断；切れる表示东西断开、用尽，或刀具锋利。"
  },
  {
    groupKey: "pair:渡す / 渡る",
    level: "major",
    summary: "渡る表示自己渡过道路、桥或河；渡す表示把东西交给别人或使其通过。"
  },
  {
    groupKey: "pair:曲がる / 曲げる",
    level: "major",
    summary: "曲がる表示东西自己弯曲或方向转弯；曲げる表示把它弄弯或改变方向。"
  },
  {
    groupKey: "pair:込む / 込める",
    level: "major",
    summary: "込む表示里面拥挤或深入其中；込める表示把东西装入，也可表示注入心意。"
  },
  {
    groupKey: "pair:伝える / 伝わる",
    level: "major",
    summary: "伝わる表示信息自然传到对方或流传开；伝える表示主动把信息传达给对方。"
  },
  {
    groupKey: "pair:負かす / 負ける",
    level: "major",
    summary: "負ける表示自己输给对方；負かす表示击败对方。"
  },
  {
    groupKey: "pair:返す / 返る",
    level: "major",
    summary: "返る表示人或物返回原处；返す表示把东西归还，或使其返回。"
  },
  {
    groupKey: "pair:濡[ぬ]らす / 濡[ぬ]れる",
    level: "major",
    summary: "濡[ぬ]れる表示东西自己变湿；濡[ぬ]らす表示把东西弄湿。"
  },
  {
    groupKey: "pair:育つ / 育てる",
    level: "major",
    summary: "育つ表示人或植物自己成长；育てる表示培养、养育某个对象。"
  },
  {
    groupKey: "pair:汚す / 汚れる",
    level: "major",
    summary: "汚れる表示东西自己变脏；汚す表示把东西弄脏。"
  },
  {
    groupKey: "pair:下がる / 下げる",
    level: "major",
    summary: "下がる表示位置、价格或程度自己下降；下げる表示人为降低或放下。"
  },
  {
    groupKey: "pair:過ぎる / 過ごす",
    level: "major",
    summary: "過ぎる表示时间经过、超过界限；過ごす表示度过时间或以某种方式生活。"
  },
  {
    groupKey: "pair:回す / 回る",
    level: "major",
    summary: "回る表示东西自己旋转或绕行；回す表示转动某物，或让其轮流进行。"
  },
  {
    groupKey: "pair:壊す / 壊れる",
    level: "major",
    summary: "壊れる表示东西自己坏掉；壊す表示人为弄坏或破坏。"
  },
  {
    groupKey: "pair:慣らす / 慣れる",
    level: "major",
    summary: "慣れる表示自己习惯；慣らす表示使人或动物逐渐适应。"
  },
  {
    groupKey: "pair:起こす / 起こる",
    level: "major",
    summary: "起こる表示事情发生；起こす表示使事情发生或叫醒某人。"
  },
  {
    groupKey: "pair:驚かす / 驚く",
    level: "major",
    summary: "驚く表示自己感到惊讶；驚かす表示使别人吃惊。"
  },
  {
    groupKey: "pair:建つ / 建てる",
    level: "major",
    summary: "建つ表示建筑物建成或竖立起来；建てる表示建造建筑物。"
  },
  {
    groupKey: "pair:見つかる / 見つける",
    level: "major",
    summary: "見つかる表示东西被找到；見つける表示某人找到东西。"
  },
  {
    groupKey: "pair:残す / 残る",
    level: "major",
    summary: "残る表示东西留下来；残す表示主动留下、保留某物。"
  },
  {
    groupKey: "pair:似せる / 似る",
    level: "major",
    summary: "似る表示两个对象本来相像；似せる表示人为仿造得像某物。"
  },
  {
    groupKey: "pair:治す / 治る",
    level: "major",
    summary: "治る表示疾病或伤病痊愈；治す表示把疾病或伤病治好。"
  },
  {
    groupKey: "pair:写す / 写る",
    level: "major",
    summary: "写す表示主动抄写、拍摄或转写；写る表示影像自己映在照片或表面上。"
  },
  {
    groupKey: "pair:集まる / 集める",
    level: "major",
    summary: "集まる表示人或物聚集起来；集める表示把分散的对象收集到一起。"
  },
  {
    groupKey: "pair:助かる / 助ける",
    level: "major",
    summary: "助かる表示自己获救或得到帮助；助ける表示主动帮助、救助对方。"
  },
  {
    groupKey: "pair:焼く / 焼ける",
    level: "major",
    summary: "焼く表示烤、烧某物；焼ける表示食物或物品自己烤熟、烧成。"
  },
  {
    groupKey: "pair:進む / 進める",
    level: "major",
    summary: "進む表示主体或事情向前进展；進める表示推进事情或让某物前进。"
  },
  {
    groupKey: "pair:生かす / 生きる",
    level: "major",
    summary: "生きる表示自己活着或生活；生かす表示让某物发挥作用、活用经验。"
  },
  {
    groupKey: "pair:増える / 増やす",
    level: "major",
    summary: "増える表示数量自然增加；増やす表示人为增加数量。"
  },
  {
    groupKey: "pair:続く / 続ける",
    level: "major",
    summary: "続く表示事情持续下去；続ける表示主动继续做某事。"
  },
  {
    groupKey: "pair:通す / 通る",
    level: "major",
    summary: "通る表示人或物通过、穿过；通す表示让其通过，或把某物贯穿、执行到底。"
  },
  {
    groupKey: "pair:倒す / 倒れる",
    level: "major",
    summary: "倒れる表示人或物自己倒下；倒す表示把人或物弄倒、击倒。"
  },
  {
    groupKey: "pair:当たる / 当てる",
    level: "major",
    summary: "当たる表示自己命中、碰到或猜中；当てる表示使其对准、命中或猜中。"
  },
  {
    groupKey: "pair:逃がす / 逃げる",
    level: "major",
    summary: "逃げる表示自己逃跑；逃がす表示放走、让某人或某物逃走。"
  },
  {
    groupKey: "pair:動かす / 動く",
    level: "major",
    summary: "動く表示主体自己移动或运转；動かす表示使某物移动、运转或采取行动。"
  },
  {
    groupKey: "pair:届く / 届ける",
    level: "major",
    summary: "届く表示物品、消息自己送达；届ける表示把物品或消息送到对方处。"
  },
  {
    groupKey: "pair:泊まる / 泊める",
    level: "major",
    summary: "泊まる表示自己住宿或停泊；泊める表示让别人住宿，或把船停靠。"
  },
  {
    groupKey: "pair:分かれる / 分ける",
    level: "major",
    summary: "分かれる表示整体自己分开或分成几组；分ける表示主动分配、分开或分类。"
  },
  {
    groupKey: "pair:片付く / 片付ける",
    level: "major",
    summary: "片付く表示事情或房间自己整理好、解决；片付ける表示主动收拾或处理。"
  },
  {
    groupKey: "pair:暮らす / 暮れる",
    level: "major",
    summary: "暮らす表示生活、过日子；暮れる表示天黑，或一天、季节结束。"
  },
  {
    groupKey: "pair:迷う / 迷わす",
    level: "major",
    summary: "迷う表示自己迷路、犹豫；迷わす表示使别人迷路或困惑。"
  },
  {
    groupKey: "pair:戻す / 戻る",
    level: "major",
    summary: "戻る表示人或物返回原处；戻す表示把人或物放回、恢复原状。"
  },
  {
    groupKey: "pair:落ちる / 落とす",
    level: "major",
    summary: "落ちる表示东西自己掉落或下降；落とす表示使东西掉下，或不慎遗失。"
  },
  {
    groupKey: "pair:流す / 流れる",
    level: "major",
    summary: "流れる表示液体、信息等自己流动或传播；流す表示使其流走、冲走或播放。"
  },
  {
    groupKey: "pair:映す / 映る",
    level: "major",
    summary: "映る表示影像映在屏幕、镜子或照片中；映す表示把影像拍摄、投射或映照出来。"
  },
  {
    groupKey: "pair:外す / 外れる",
    level: "major",
    summary: "外れる表示东西自己脱落、偏离或不中；外す表示主动取下、避开或错过。"
  },
  {
    groupKey: "pair:閉ざす / 閉じる",
    level: "major",
    summary: "閉じる多用于把书、眼睛或开口合上；閉ざす强调封闭、封锁或关闭通道。"
  },
  {
    groupKey: "pair:減らす / 減る",
    level: "major",
    summary: "減る表示数量自然减少；減らす表示人为减少数量或削减内容。"
  },
  {
    groupKey: "pair:移す / 移る",
    level: "major",
    summary: "移る表示人、物或状态自己转移；移す表示把它移到别处，或转移内容。"
  },
  {
    groupKey: "pair:下りる / 下ろす",
    level: "major",
    summary: "下りる表示人自己下车、下楼或下来；下ろす表示让人下车，或把东西放下、取下。"
  },
  {
    groupKey: "pair:割る / 割れる",
    level: "major",
    summary: "割れる表示东西自己裂开、破碎或分裂；割る表示主动打破、切开或分割。"
  },
  {
    groupKey: "pair:乾かす / 乾く",
    level: "major",
    summary: "乾く表示东西自己变干；乾かす表示把东西弄干。"
  },
  {
    groupKey: "pair:勤まる / 勤める",
    level: "major",
    summary: "勤まる表示某人能够胜任职位；勤める表示任职、工作于某处。"
  },
  {
    groupKey: "pair:済ます / 済む",
    level: "major",
    summary: "済む表示事情结束、解决或无需更多；済ます表示主动办完、了结某事。"
  },
  {
    groupKey: "pair:折る / 折れる",
    level: "major",
    summary: "折れる表示东西自己折断、弯折；折る表示主动折断、折叠。"
  },
  {
    groupKey: "pair:超える / 超す",
    level: "interchangeable",
    summary: "两者都可表示超过界限或数量；超える较常用，超す也常用于超过时间、数量。"
  },
  {
    groupKey: "pair:燃える / 燃やす",
    level: "major",
    summary: "燃える表示东西自己燃烧；燃やす表示点燃或烧掉某物。"
  },
  {
    groupKey: "pair:表す / 表れる",
    level: "major",
    summary: "表れる表示情感、结果等显现出来；表す表示主动表达、表示某种内容。"
  },
  {
    groupKey: "pair:捕まえる / 捕まる",
    level: "major",
    summary: "捕まる表示人或动物被抓住；捕まえる表示主动抓住、逮捕。"
  },
  {
    groupKey: "pair:鳴らす / 鳴る",
    level: "major",
    summary: "鳴る表示声音自己响起；鳴らす表示使乐器、铃或警报发出声音。"
  },
  {
    groupKey: "pair:冷える / 冷やす",
    level: "major",
    summary: "冷える表示东西自己变冷；冷やす表示把东西冷却、冰镇。"
  },
  {
    groupKey: "pair:挙がる / 挙げる",
    level: "major",
    summary: "挙がる表示手、名字或成果自己被举出；挙げる表示举起、列举或提出。"
  },
  {
    groupKey: "pair:ぶつかる / ぶつける",
    level: "major",
    summary: "ぶつかる表示主体撞上或遇到冲突；ぶつける表示把某物撞向对象，或把问题直接提出来。"
  },
  {
    groupKey: "pair:まとまる / まとめる",
    level: "major",
    summary: "まとまる表示意见、资料等自己归拢成形；まとめる表示主动整理、汇总或达成一致。"
  },
  {
    groupKey: "pair:隠す / 隠れる",
    level: "major",
    summary: "隠れる表示人或物自己藏起来；隠す表示把人、物或事实隐藏起来。"
  },
  {
    groupKey: "pair:延ばす / 延びる",
    level: "major",
    summary: "延びる表示期限、长度等自己延长；延ばす表示主动延长、推迟或拉长。"
  },
  {
    groupKey: "pair:加える / 加わる",
    level: "major",
    summary: "加わる表示自己加入或增加到整体中；加える表示把人、物或影响加入其中。"
  },
  {
    groupKey: "pair:解く / 解ける",
    level: "major",
    summary: "解ける表示结、问题等自己解开或得到解决；解く表示主动解开、解答或解除。"
  },
  {
    groupKey: "pair:現す / 現れる",
    level: "major",
    summary: "現れる表示人、现象自己出现；現す表示使隐藏的东西显现，或表现出来。"
  },
  {
    groupKey: "pair:固まる / 固める",
    level: "major",
    summary: "固まる表示物质、想法或队伍自己固定成形；固める表示使其凝固、巩固或确定。"
  },
  {
    groupKey: "pair:向く / 向ける",
    level: "major",
    summary: "向く表示方向朝向某处或适合某用途；向ける表示把方向、注意力或对象转向某处。"
  },
  {
    groupKey: "pair:広がる / 広げる",
    level: "major",
    summary: "広がる表示范围、面积或传播自然扩大；広げる表示主动展开、扩大或传播。"
  },
  {
    groupKey: "pair:載せる / 載る",
    level: "major",
    summary: "載る表示东西被放上去或内容被刊登；載せる表示把东西放上、刊登或登载。"
  },
  {
    groupKey: "pair:重なる / 重ねる",
    level: "major",
    summary: "重なる表示多个对象自己重叠或时间重合；重ねる表示把对象一层层叠放，或反复进行。"
  },
  {
    groupKey: "pair:伸ばす / 伸びる",
    level: "major",
    summary: "伸びる表示长度、能力等自然增长；伸ばす表示主动拉长、延伸或提高。"
  },
  {
    groupKey: "pair:痛む / 痛める",
    level: "major",
    summary: "痛む表示身体自己疼痛或物品损坏；痛める表示使身体受伤，或损伤物品。"
  },
  {
    groupKey: "pair:締まる / 締める",
    level: "major",
    summary: "締まる表示绳带、气氛等自己收紧；締める表示系紧、拧紧或使纪律严明。"
  },
  {
    groupKey: "pair:点[つ]く / 点[つ]ける",
    level: "major",
    summary: "点[つ]く表示灯、火等自己点着；点[つ]ける表示人为点燃或打开灯、火。"
  },
  {
    groupKey: "pair:悩ます / 悩む",
    level: "major",
    summary: "悩む表示自己烦恼、苦恼；悩ます表示使别人烦恼或困扰。"
  },
  {
    groupKey: "pair:抜く / 抜ける",
    level: "major",
    summary: "抜ける表示东西自己脱落、漏掉或离开；抜く表示主动拔出、抽取或省略。"
  },
  {
    groupKey: "pair:埋まる / 埋める",
    level: "major",
    summary: "埋まる表示空处自己被填满或埋上；埋める表示把东西埋入、填入空处。"
  },
  {
    groupKey: "pair:離す / 離れる",
    level: "major",
    summary: "離れる表示人或物自己离开、分离；離す表示把对象放开、分开或拉开距离。"
  },
  {
    groupKey: "pair:冷ます / 冷める",
    level: "major",
    summary: "冷める表示热度、兴趣等自己变冷淡；冷ます表示使食物变凉，或让热情冷却。"
  },
  {
    groupKey: "pair:こぼす / こぼれる",
    level: "major",
    summary: "こぼれる表示液体、物品自己洒出或掉出；こぼす表示把它洒出，或无意中说出。"
  },
  {
    groupKey: "pair:越える / 越す",
    level: "interchangeable",
    summary: "两者都可表示超过、越过界限；越える较中性，越す也常用于越过时间、山或数量。"
  },
  {
    groupKey: "pair:混ざる / 混ぜる",
    level: "major",
    summary: "混ざる表示不同东西自己混在一起；混ぜる表示主动把它们混合。"
  },
  {
    groupKey: "pair:早まる / 早める",
    level: "major",
    summary: "早まる表示时间或行动自己提前，或判断失误而过早；早める表示主动提前。"
  },
  {
    groupKey: "pair:溶かす / 溶ける",
    level: "major",
    summary: "溶ける表示固体自己融化或溶解；溶かす表示使其融化、溶解。"
  },
  {
    groupKey: "pair:詰まる / 詰める",
    level: "major",
    summary: "詰まる表示通道自己堵塞，或内容挤满；詰める表示把东西塞入、填满或缩短间隔。"
  },
  {
    groupKey: "pair:浮かべる / 浮く",
    level: "major",
    summary: "浮く表示东西自己浮在水面或空中；浮かべる表示使其浮起，也可表示浮现念头。"
  },
  {
    groupKey: "pair:生える / 生やす",
    level: "major",
    summary: "生える表示植物、毛发等自己长出；生やす表示让其生长，或蓄出胡子等。"
  },
  {
    groupKey: "pair:沸かす / 沸く",
    level: "major",
    summary: "沸く表示液体自己沸腾；沸かす表示把液体烧开。"
  },
  {
    groupKey: "pair:孵[かえ]す / 孵[かえ]る",
    level: "major",
    summary: "孵[かえ]る表示蛋自己孵化；孵[かえ]す表示孵蛋使其孵化。"
  },
  {
    groupKey: "pair:挟まる / 挟む",
    level: "major",
    summary: "挟まる表示东西自己夹在中间；挟む表示把东西夹住、夹入或插话。"
  },
  {
    groupKey: "pair:欠く / 欠ける",
    level: "major",
    summary: "欠ける表示一部分自己缺损、缺口出现；欠く表示缺少某物或缺乏某种必要条件。"
  },
  {
    groupKey: "pair:広まる / 広める",
    level: "major",
    summary: "広まる表示消息、习惯等自然传播开；広める表示主动传播、推广或扩大范围。"
  },
  {
    groupKey: "pair:高まる / 高める",
    level: "major",
    summary: "高まる表示程度、气氛或意识自己高涨；高める表示主动提高、增强。"
  },
  {
    groupKey: "pair:刺さる / 刺す",
    level: "major",
    summary: "刺さる表示尖物自己刺入、扎在某处；刺す表示主动刺、扎或戳。"
  },
  {
    groupKey: "pair:就く / 就ける",
    level: "major",
    summary: "就く表示自己就任、开始从事某职位；就ける表示让某人就任或安排其职位。"
  },
  {
    groupKey: "pair:縮む / 縮める",
    level: "major",
    summary: "縮む表示长度、规模自己缩小；縮める表示主动缩短、缩小或缩减。"
  },
  {
    groupKey: "pair:縮まる / 縮める",
    level: "major",
    summary: "縮まる表示距离、差距等自己缩短；縮める表示主动缩短距离、时间或差距。"
  },
  {
    groupKey: "pair:深まる / 深める",
    level: "major",
    summary: "深まる表示关系、理解或程度自己加深；深める表示主动加深关系、理解或讨论。"
  },
  {
    groupKey: "pair:積む / 積もる",
    level: "major",
    summary: "積もる表示雪、经验等自己积累起来；積む表示把东西堆上，或积累经验。"
  },
  {
    groupKey: "pair:潰す / 潰れる",
    level: "major",
    summary: "潰れる表示东西自己压坏、倒闭或泡汤；潰す表示压坏、挤碎，或使计划落空。"
  },
  {
    groupKey: "pair:浮かぶ / 浮かべる",
    level: "major",
    summary: "浮かぶ表示物体浮起或想法自己浮现；浮かべる表示使物体浮起，或主动想起、浮现表情。"
  },
  {
    groupKey: "pair:崩す / 崩れる",
    level: "major",
    summary: "崩れる表示建筑、平衡或计划自己崩坏；崩す表示主动拆散、打乱或破坏。"
  },
  {
    groupKey: "pair:役立つ / 役立てる",
    level: "major",
    summary: "役立つ表示某物本身有用；役立てる表示把知识、经验等加以利用。"
  },
  {
    groupKey: "pair:立ち上がる / 立ち上げる",
    level: "major",
    summary: "立ち上がる表示人自己站起来，或系统启动；立ち上げる表示使其启动，或创建项目。"
  },
  {
    groupKey: "pair:留まる / 留める",
    level: "major",
    summary: "留まる表示人或物停留、不离开；留める表示把对象留住、固定或记下。"
  },
  {
    groupKey: "pair:欠かす / 欠ける",
    level: "major",
    summary: "欠かす表示省略、缺席某个本应做的事项；欠ける表示物体缺损或条件不完整。"
  },
  {
    groupKey: "pair:整う / 整える",
    level: "major",
    summary: "整う表示条件、外形或秩序自己变得齐备；整える表示主动整理、调整或准备好。"
  },
  {
    groupKey: "pair:染まる / 染める",
    level: "major",
    summary: "染まる表示颜色自己染上或受到影响；染める表示给布、头发等染色。"
  },
  {
    groupKey: "pair:荒らす / 荒れる",
    level: "major",
    summary: "荒れる表示天气、皮肤或场面自己变得恶劣；荒らす表示破坏、糟蹋或扰乱。"
  },
  {
    groupKey: "pair:混じる / 混ぜる",
    level: "major",
    summary: "混じる表示某物混入整体或不同成分夹杂；混ぜる表示主动把几种东西混合。"
  },
  {
    groupKey: "pair:当てはまる / 当てはめる",
    level: "major",
    summary: "当てはまる表示规则、条件适用于对象；当てはめる表示把规则套用到对象上。"
  },
  {
    groupKey: "pair:ずらす / ずれる",
    level: "major",
    summary: "ずれる表示位置、时间自己偏离；ずらす表示主动挪开、错开或推迟。"
  },
  {
    groupKey: "pair:改まる / 改める",
    level: "major",
    summary: "改まる表示态度、场合自己变正式或重新开始；改める表示主动改正、重新做或检查。"
  },
  {
    groupKey: "pair:甘える / 甘やかす",
    level: "major",
    summary: "甘える表示自己撒娇、依赖对方的好意；甘やかす表示过分纵容、娇惯别人。"
  },
  {
    groupKey: "pair:傾く / 傾ける",
    level: "major",
    summary: "傾く表示物体自己倾斜，或局势偏向一方；傾ける表示把物体倾斜，或倾注精力。"
  },
  {
    groupKey: "pair:収まる / 収める",
    level: "major",
    summary: "収まる表示东西进入容器、事情平息或归位；収める表示把东西收进，或取得、缴纳成果。"
  },
  {
    groupKey: "pair:振り向く / 振り向ける",
    level: "major",
    summary: "振り向く表示自己回头或转向；振り向ける表示把视线、资源或对象转向某处。"
  },
  {
    groupKey: "pair:納まる / 納める",
    level: "major",
    summary: "納まる表示东西妥善归位、事情平息；納める表示缴纳费用、交付成果或收好。"
  },
  {
    groupKey: "pair:薄まる / 薄める",
    level: "major",
    summary: "薄まる表示味道、颜色或印象自己变淡；薄める表示主动稀释或减弱。"
  },
  {
    groupKey: "pair:備える / 備わる",
    level: "major",
    summary: "備わる表示能力、设备等本身具备；備える表示事先准备，或给场所配备设备。"
  },
  {
    groupKey: "pair:捕らえる / 捕らわれる",
    level: "major",
    summary: "捕らわれる表示被捕，或被观念束缚；捕らえる表示抓住、捕获或准确把握。"
  },
  {
    groupKey: "pair:膨らます / 膨らむ",
    level: "major",
    summary: "膨らむ表示气球、期待等自己膨胀或扩大；膨らます表示使其膨胀，或夸大想象。"
  },
  {
    groupKey: "pair:満たす / 満ちる",
    level: "major",
    summary: "満ちる表示空间、时间或感情自己充满；満たす表示填满容器，或满足条件、愿望。"
  },
  {
    groupKey: "pair:叶[かな]う / 叶[かな]える",
    level: "major",
    summary: "叶[かな]う表示愿望自己实现；叶[かな]える表示使某人的愿望实现。"
  },
  {
    groupKey: "pair:果たす / 果てる",
    level: "major",
    summary: "果たす表示主动完成责任、目标或作用；果てる表示事情走到尽头、耗尽。"
  },
  {
    groupKey: "pair:及ぶ / 及ぼす",
    level: "major",
    summary: "及ぶ表示范围、程度达到某处；及ぼす表示给对象带来影响、损害或作用。"
  },
  {
    groupKey: "pair:強まる / 強める",
    level: "major",
    summary: "強まる表示力量、风势或倾向自己增强；強める表示主动加强、加重或强化。"
  },
  {
    groupKey: "pair:思い浮かぶ / 思い浮かべる",
    level: "major",
    summary: "思い浮かぶ表示想法、画面自己浮现在脑中；思い浮かべる表示主动想起或想象。"
  },
  {
    groupKey: "pair:傷む / 傷める",
    level: "major",
    summary: "傷む表示食物、物品自己变坏或受损；傷める表示损伤物品、身体或感情。"
  },
  {
    groupKey: "pair:尽きる / 尽くす",
    level: "major",
    summary: "尽きる表示资源、机会等自己用尽；尽くす表示把资源用尽，或竭尽全力。"
  },
  {
    groupKey: "pair:積み重なる / 積み重ねる",
    level: "major",
    summary: "積み重なる表示事情、经验等逐渐累积；積み重ねる表示主动一层层堆放或积累。"
  },
  {
    groupKey: "pair:絶える / 絶つ",
    level: "major",
    summary: "絶える表示联系、生命或供应自己中断；絶つ表示主动切断、断绝。"
  },
  {
    groupKey: "pair:はまる / はめる",
    level: "major",
    summary: "はまる表示东西自己嵌入、合适或陷入；はめる表示把东西嵌入，或使人陷入圈套。"
  },
  {
    groupKey: "pair:遠ざかる / 遠ざける",
    level: "major",
    summary: "遠ざかる表示人或物自己远离；遠ざける表示使对象远离、排斥或疏远。"
  },
  {
    groupKey: "pair:凝らす / 凝る",
    level: "major",
    summary: "凝る表示兴趣、身体部位等变得专注或僵硬；凝らす表示集中注意力、心思或视线。"
  },
  {
    groupKey: "pair:極まる / 極める",
    level: "major",
    summary: "極まる表示程度自己达到极点；極める表示主动达到顶点，或钻研到极致。"
  },
  {
    groupKey: "pair:交う / 交わす",
    level: "major",
    summary: "交う表示双方交错、往来；交わす表示双方互相交换、交谈或履行约定。"
  },
  {
    groupKey: "pair:弱まる / 弱める",
    level: "major",
    summary: "弱まる表示力量、效果或风势自己减弱；弱める表示主动减弱、缓和。"
  },
  {
    groupKey: "pair:浸す / 浸る",
    level: "major",
    summary: "浸る表示自己浸泡在液体中，或沉浸于气氛；浸す表示把东西浸入液体。"
  },
  {
    groupKey: "pair:定まる / 定める",
    level: "major",
    summary: "定まる表示规则、方针或位置确定下来；定める表示主动规定、决定或确立。"
  },
  {
    groupKey: "pair:逃す / 逃れる",
    level: "major",
    summary: "逃す表示放走、错过机会或漏掉；逃れる表示自己逃脱危险、责任或困境。"
  },
  {
    groupKey: "pair:惑う / 惑わす",
    level: "major",
    summary: "惑う表示自己困惑、犹豫；惑わす表示使别人迷惑、误判或受诱导。"
  },
  {
    groupKey: "pair:澄ます / 澄む",
    level: "major",
    summary: "澄む表示水、空气或声音自己变清澈；澄ます表示使其清澈，或集中精神。"
  },
  {
    groupKey: "pair:携える / 携わる",
    level: "major",
    summary: "携える表示随身携带某物；携わる表示参与、从事某项工作。"
  },
  {
    groupKey: "pair:膨らます / 膨れる",
    level: "major",
    summary: "膨れる表示身体、袋子等自己鼓起，也可表示生气；膨らます表示人为使其膨胀或鼓起。"
  },
  {
    groupKey: "pair:励ます / 励む",
    level: "major",
    summary: "励ます表示鼓励别人；励む表示自己努力从事某事。"
  },
  {
    groupKey: "pair:緩む / 緩める",
    level: "major",
    summary: "緩む表示绳带、警惕等自己变松或放松；緩める表示主动放松、放宽或拧松。"
  },
  {
    groupKey: "pair:潤う / 潤す",
    level: "major",
    summary: "潤う表示水分、收入等自己得到充足；潤す表示使其湿润，或使生活得到滋养。"
  },
  {
    groupKey: "pair:滅びる / 滅ぼす",
    level: "major",
    summary: "滅びる表示国家、种族等自己灭亡；滅ぼす表示使其毁灭、消灭。"
  },
  {
    groupKey: "pair:揺らぐ / 揺るがす",
    level: "major",
    summary: "揺らぐ表示信念、地位等自己动摇；揺るがす表示动摇、撼动某人的信念或基础。"
  },
  {
    groupKey: "pair:和らぐ / 和らげる",
    level: "major",
    summary: "和らぐ表示疼痛、气氛等自己缓和；和らげる表示主动缓和、减轻。"
  },
  {
    groupKey: "pair:狭まる / 狭める",
    level: "major",
    summary: "狭まる表示宽度、范围或选择自己变窄；狭める表示主动缩小、限制。"
  },
  {
    groupKey: "pair:ほぐす / ほぐれる",
    level: "major",
    summary: "ほぐれる表示结、紧张等自己松开；ほぐす表示主动解开、揉松或缓和。"
  },
  {
    groupKey: "pair:埋める / 埋もれる",
    level: "major",
    summary: "埋もれる表示人或物被埋在里面、被忽视；埋める表示把东西埋入或填入空处。"
  },
  {
    groupKey: "pair:切らす / 切れる",
    level: "major",
    summary: "切れる表示绳、联系或库存自己断开、用尽；切らす表示使其断掉，或把库存用到没有。"
  },
  {
    groupKey: "kanji-choice:さがす",
    level: "major",
    summary: "探す偏寻找想要的东西、目标或答案；捜す偏寻找丢失、隐藏或逃跑的对象。现代常按这个语义选择汉字。"
  },
  {
    groupKey: "kanji-choice:おりる",
    level: "major",
    summary: "降りる偏从交通工具、楼梯等下来；下りる偏向下移动、下山或下车，也可按词义和固定搭配选择。"
  },
  {
    groupKey: "kanji-choice:あたたかい",
    level: "major",
    summary: "温かい偏体感、食物和气氛的温暖；暖かい偏天气、气候和整体环境的暖和。"
  },
  {
    groupKey: "kanji-choice:あたためる",
    level: "major",
    summary: "温める偏把食物、饮料或身体加热；暖める偏使房间、气氛或关系变暖。"
  },
  {
    groupKey: "kanji-choice:ふよう",
    level: "major",
    summary: "不要偏正式地表示不需要、没有必要；不用偏日常地表示不用、不必或不使用。"
  },
  {
    groupKey: "kanji-choice:はいふ",
    level: "interchangeable",
    summary: "两者都表示分发、发放；配布较常见，配付多见于正式文件或强调逐人发给。"
  },
  {
    groupKey: "kanji-choice:しゅぎょう",
    level: "major",
    summary: "修行偏修炼技艺、宗教或精神上的修行；修業偏完成学业、学习训练或修业。"
  },
  {
    groupKey: "kanji-choice:きざい",
    level: "interchangeable",
    summary: "两者都可表示设备器材；器材偏工具、器具本身，機材偏机器、设备及其配套材料。"
  },
  {
    groupKey: "reading-register:何",
    level: "interchangeable",
    summary: "何读なに较完整、清楚；读なん常出现在数量词、助词前和口语连读中，意思基本不变。"
  },
  {
    groupKey: "reading-register:上",
    level: "interchangeable",
    summary: "上读うえ是一般的‘上面、上方’；读かみ常用于上游、上级或较正式的固定说法。"
  },
  {
    groupKey: "reading-register:色",
    level: "interchangeable",
    summary: "色读いろ是日常说颜色；读しょく多出现在复合词或分类、色调等书面词中。"
  },
  {
    groupKey: "reading-register:明日",
    level: "interchangeable",
    summary: "あした是最日常的‘明天’；あす较简洁、正式，新闻和通知中更常见。"
  },
  {
    groupKey: "reading-register:良い",
    level: "interchangeable",
    summary: "いい是口语中最常用的读法；よい较正式，也常用于书面语和复合表达。"
  },
  {
    groupKey: "reading-register:皆",
    level: "interchangeable",
    summary: "みんな偏口语、亲切；みな较简洁正式，演讲、通知和书面语中更常见。"
  },
  {
    groupKey: "reading-register:行き",
    level: "interchangeable",
    summary: "行き读いき是日常说法；读ゆき常用于列车、航班等方向标识或固定词。"
  },
  {
    groupKey: "reading-register:十",
    level: "interchangeable",
    summary: "じゅう用于数数和复合词；とお用于单独数十个、十岁等日常数法。"
  },
  {
    groupKey: "reading-register:品",
    level: "interchangeable",
    summary: "しな是单独说物品、货品的训读；ひん多用于复合词，常带品质、品类或品格的书面语感。"
  },
  {
    groupKey: "reading-register:一昨日",
    level: "interchangeable",
    summary: "おととい是日常口语的‘前天’；いっさくじつ较正式，多用于书面、新闻或正式说明。"
  },
  {
    groupKey: "reading-register:〜通り",
    level: "interchangeable",
    summary: "〜とおり是单独说‘按照……’或‘……通’的常见读法；〜どおり多见于接在词后表示照样、如同。"
  },
  {
    groupKey: "reading-register:明後日",
    level: "interchangeable",
    summary: "あさって是日常口语的‘后天’；みょうごにちは正式、书面或日程说明中的读法。"
  },
  {
    groupKey: "reading-register:紅葉",
    level: "interchangeable",
    summary: "もみじ偏指红叶这种树叶或观赏对象；こうよう偏指秋天树叶变红这一现象、季节景观。"
  },
  {
    groupKey: "reading-register:描く",
    level: "interchangeable",
    summary: "かく是日常的‘画、描写’；えがく较强调描绘形象、场景或心中的画面，书面感更强。"
  },
  {
    groupKey: "reading-register:年月",
    level: "interchangeable",
    summary: "ねんげつ是年月、岁月的音读，较书面；としつき偏日常，常带经历了很长时间的语感。"
  },
  {
    groupKey: "reading-register:脅かす",
    level: "major",
    summary: "おどかす表示吓唬、使人吃惊；おびやかす表示威胁安全、地位或秩序，不能随意互换。"
  },
  {
    groupKey: "stem:閉",
    level: "major",
    summary: "闭合词根下，閉まる是自己关上，閉める是人为关上；閉じる偏合上开口、书本或眼睛，閉ざす偏封闭、封锁，閉じ込める是关进里面。"
  },
  {
    groupKey: "stem:入",
    level: "major",
    summary: "入る是进入，入れる是放入；入り込む强调进入内部，入れ替える是替换，入れ替わる是互相替换，入り交じる是混杂，入り組む是结构错综。"
  },
  {
    groupKey: "stem:貸",
    level: "major",
    summary: "貸す是借给别人；貸し出す强调把物品正式借出、出借。"
  },
  {
    groupKey: "stem:手",
    level: "major",
    summary: "手渡す是亲手交给；手放す是放手、出售或不再持有；手がける是亲自负责、制作。"
  },
  {
    groupKey: "stem:教",
    level: "major",
    summary: "教える是教别人知识或方法；教わる是向别人学习、受教。"
  },
  {
    groupKey: "stem:考",
    level: "major",
    summary: "考える是思考、考虑；考え直す是重新考虑；考え込む是陷入沉思，常带长时间深入思考。"
  },
  {
    groupKey: "stem:決",
    level: "major",
    summary: "決まる是事情定下来，決める是主动决定；決めつける是在未经充分确认时擅自断定。"
  },
  {
    groupKey: "stem:受",
    level: "major",
    summary: "受ける是接受或承受；受け取る是收到并拿到手，受け入れる是接纳，受け付ける是受理，受け止める是接住或正面理解。"
  },
  {
    groupKey: "stem:使",
    level: "major",
    summary: "使う是使用；使い分ける是按情况区别使用，使い果たす是用尽，使いこなす是熟练驾驭，使い込む是长期使用到熟透或用旧。"
  },
  {
    groupKey: "stem:作",
    level: "major",
    summary: "作る是制作、创造；作り直す强调把已有成果重新做一遍。"
  },
  {
    groupKey: "stem:買",
    level: "major",
    summary: "買う是购买；買い求める偏郑重地寻购，買い取る是买下并取得所有权，買い与える是买来给别人，買い占める是大量买断。"
  },
  {
    groupKey: "stem:売",
    level: "major",
    summary: "売る是出售；売れる是卖得出去或畅销，売り切れる是全部售罄，売れ残る是卖剩，売り出す是开始销售或推出。"
  },
  {
    groupKey: "stem:待",
    level: "major",
    summary: "待つ是等待；待ち受ける强调预先等候某事发生或某人到来，带有迎接、守候意味。"
  },
  {
    groupKey: "stem:持",
    level: "major",
    summary: "持つ是拿、拥有；持ち帰る是带回，持ち歩く是随身携带，持ち込む是带入，持ち出す是带出或提出。"
  },
  {
    groupKey: "stem:立",
    level: "major",
    summary: "立つ是站立，立てる是竖起或制定；立ち上がる是站起或启动，立ち並ぶ是并排，立ち去る是离开，立ち退く是搬离，立ち返る／立ち戻る是返回。"
  },
  {
    groupKey: "stem:走",
    level: "major",
    summary: "走る是跑或行驶；走り回る强调到处跑、来回奔走。"
  },
  {
    groupKey: "stem:歩",
    level: "major",
    summary: "歩く是走路；歩き回る强调四处走动、走来走去。"
  },
  {
    groupKey: "stem:読",
    level: "major",
    summary: "読む是阅读；読み取る是读懂、读取信息，読み上げる是朗读，読み返す是重读，読み込む是读入或深入理解。"
  },
  {
    groupKey: "stem:話",
    level: "major",
    summary: "話す是说话、讲述；話しかける是主动搭话、向某人开口。"
  },
  {
    groupKey: "stem:聞",
    level: "major",
    summary: "聞く是听或询问；聞こえる是自然听见，聞かせる是讲给别人听，聞き取る是听懂，聞き直す是再问，聞き出す是问出信息，聞きつける是听到消息。"
  },
  {
    groupKey: "stem:行",
    level: "major",
    summary: "行き着く是最终到达某处或结论；行き届く是照顾周到、达到细节。"
  },
  {
    groupKey: "stem:止",
    level: "major",
    summary: "止まる是停下，止める是使停下；止む是雨、风等停止；止める（やめる）是停止做某事或戒掉。"
  },
  {
    groupKey: "stem:知",
    level: "major",
    summary: "知る是得知、知道；知らせる是把信息通知给别人。"
  },
  {
    groupKey: "stem:探",
    level: "major",
    summary: "探す是寻找；探し出す强调终于找出，探し回る强调到处寻找。"
  },
  {
    groupKey: "stem:選",
    level: "major",
    summary: "選ぶ是从候选中选择；選び取る强调经过筛选后选出并取得。"
  },
  {
    groupKey: "stem:着",
    level: "major",
    summary: "着る是穿上衣服，着く是到达；たどり着く强调经过过程终于到达，着替える是换衣服。"
  },
  {
    groupKey: "stem:並",
    level: "major",
    summary: "並ぶ是排成一列，並べる是排列；並べ立てる强调把多个事例或理由接连列举出来。"
  },
  {
    groupKey: "stem:降",
    level: "major",
    summary: "降りる是人下车、下来；降る是雨雪下；降り出す是开始下，降り続く是持续下，降り注ぐ是大量倾泻而下。"
  },
  {
    groupKey: "stem:乗",
    level: "major",
    summary: "乗る是乘坐；乗り換える是换乘，乗り継ぐ是衔接换乘，乗り越える是克服，乗り切る是坚持度过、完成。"
  },
  {
    groupKey: "stem:起",
    level: "major",
    summary: "起きる是起床或发生；起き上がる强调从躺、坐的状态站起身。"
  },
  {
    groupKey: "stem:言",
    level: "major",
    summary: "言う是说；言い出す是说出口，言い切る是断言或说完，言い聞かせる是劝说，言い換える是换说法，言い残す是留下话，言い放つ是直截了当地说出。"
  },
  {
    groupKey: "stem:呼",
    level: "major",
    summary: "呼ぶ是叫、邀请；呼び止める是叫住，呼び込む是招进来，呼び寄せる是叫到身边。"
  },
  {
    groupKey: "stem:住",
    level: "major",
    summary: "住む是居住；住み着く强调在某处安定下来、定居或扎根。"
  },
  {
    groupKey: "stem:消",
    level: "major",
    summary: "消える是消失；消え去る强调完全消失、远去，语气比单独的消える更彻底。"
  },
  {
    groupKey: "stem:笑",
    level: "major",
    summary: "笑う是自己笑；笑わせる是逗得别人笑、使别人发笑。"
  },
  {
    groupKey: "stem:上",
    level: "major",
    summary: "上がる表示上升或提高，のぼる表示向高处攀登；くみ上げる表示把液体、数据等抽取上来。"
  },
  {
    groupKey: "stem:食",
    level: "major",
    summary: "食べる是普通、中性的吃；食う是粗俗或男性化的口语，正式场合不要替换。"
  },
  {
    groupKey: "stem:寝",
    level: "major",
    summary: "寝転がる是自己躺倒、横躺；寝かせる是让人或物躺下，也可让婴儿入睡。"
  },
  {
    groupKey: "stem:晴",
    level: "major",
    summary: "晴れる是放晴；晴れ渡る强调天空完全晴朗、视野开阔。"
  },
  {
    groupKey: "stem:切",
    level: "major",
    summary: "切る是切；切り替える是切换，切り捨てる是舍弃，切り取る是切下，切り開く是开拓，切り出す是开始提出，切り離す是分离，切り落とす是切掉。"
  },
  {
    groupKey: "stem:分",
    level: "major",
    summary: "分ける是主动分开或分配，分かれる是自己分开；分け与える强调把东西分给某人。"
  },
  {
    groupKey: "stem:間",
    level: "major",
    summary: "間違える是弄错，間違う也可表示弄错但较口语或固定；不要把两者与表示时间间隔的間混同。"
  },
  {
    groupKey: "stem:通",
    level: "major",
    summary: "通る是通过，通す是使通过；通りかかる是路过，通り過ぎる是走过、超过，通じる是相通、通晓或有效。"
  },
  {
    groupKey: "stem:押",
    level: "major",
    summary: "押す是按、推；押さえる是按住或控制，押し込む是塞入，押し出す是推出，押し切る是顶住坚持，押しやる是推开，押し込める是关进、塞进。"
  },
  {
    groupKey: "stem:吸",
    level: "major",
    summary: "吸う是吸；吸い込む是吸入或吸进去，吸い取る是吸取液体、利益等，吸い上げる是抽吸上来。"
  },
  {
    groupKey: "stem:込",
    level: "major",
    summary: "込む是拥挤或深入；込み合う强调人或交通等挤在一起、拥堵。"
  },
  {
    groupKey: "stem:差",
    level: "major",
    summary: "差し伸べる是伸出手帮助；差し出す是伸出、递出或提交，重点是把对象交到对方面前。"
  },
  {
    groupKey: "stem:信",
    level: "major",
    summary: "信じる是相信；信じ込む强调深信不疑，甚至带有过度相信的语感。"
  },
  {
    groupKey: "stem:弾",
    level: "major",
    summary: "弾く（ひく）是弹奏或弹开；弾む（はずむ）是弹起、跳动，也可表示气氛活跃或心情兴奋。"
  },
  {
    groupKey: "stem:頼",
    level: "major",
    summary: "頼む是请求、拜托；頼み込む强调反复、低头恳求，语气更强。"
  },
  {
    groupKey: "stem:育",
    level: "major",
    summary: "育てる是养育、培养，育つ是成长；育む偏长期培育感情、能力，育て上げる强调终于培养成人或完成培养。"
  },
  {
    groupKey: "stem:下",
    level: "major",
    summary: "下がる是下降， 下げる是降低；下りる是下来、下车，下ろす是放下、取下；下回る是低于某个基准。"
  },
  {
    groupKey: "stem:過",
    level: "major",
    summary: "過ぎる是经过、超过，過ごす是度过；過ぎ去る强调离去，やり過ごす是设法熬过、应付过去。"
  },
  {
    groupKey: "stem:感",
    level: "major",
    summary: "感じる是感到、感觉；感じ取る强调从细节、气氛中察觉并领会。"
  },
  {
    groupKey: "stem:建",
    level: "major",
    summary: "建つ是建筑物建成、立起；建てる是建造；建て直す是拆后重建或重新建立。"
  },
  {
    groupKey: "stem:似",
    level: "major",
    summary: "似る是相像；似合う是与人、场合相称，似通う是彼此相似、相近。"
  },
  {
    groupKey: "stem:集",
    level: "major",
    summary: "集まる是聚集，集める是收集；かき集める强调费力、到处搜集；集う是人们聚集在一起，较书面。"
  },
  {
    groupKey: "stem:助",
    level: "major",
    summary: "助ける是帮助某人；助け合う强调双方或多人互相帮助。"
  },
  {
    groupKey: "stem:勝",
    level: "major",
    summary: "勝つ是获胜；勝ち抜く强调连续战胜对手并晋级、胜出到底。"
  },
  {
    groupKey: "stem:増",
    level: "major",
    summary: "増える是自然增加，増やす是人为增加；増す表示程度、力量等进一步增强，书面感更强。"
  },
  {
    groupKey: "stem:打",
    level: "major",
    summary: "打つ是打、敲或输入；打ち直す是重新打、重做，打ち込む是打入、投入或专心投入。"
  },
  {
    groupKey: "stem:投",
    level: "major",
    summary: "投げる是投掷；投げ捨てる是扔掉，投じる是投入资金、力量或投票，投げ出す是扔出或半途放弃，投げかける是向对方提出、投向。"
  },
  {
    groupKey: "stem:逃",
    level: "major",
    summary: "逃げる是逃跑，逃がす是放跑；逃す是错过或放走，逃れる是逃脱危险、责任或困境。"
  },
  {
    groupKey: "stem:動",
    level: "major",
    summary: "動く是移动或运转，動かす是使移动；動じる是因冲击而动摇，不能按‘移动’替换。"
  },
  {
    groupKey: "stem:包",
    level: "major",
    summary: "包む是包裹；包み込む强调从外面完整包住、笼罩进去。"
  },
  {
    groupKey: "stem:訪",
    level: "major",
    summary: "訪ねる是拜访某人或询问某事；訪れる是访问、到来，常用于季节、机会等抽象事物。"
  },
  {
    groupKey: "stem:落",
    level: "major",
    summary: "落ちる是掉落或下降，落とす是弄掉；落ち込む是陷入低落、凹陷或深入其中。"
  },
  {
    groupKey: "stem:流",
    level: "major",
    summary: "流れる是流动，流行る是流行；流れ着く是随流漂到，流し込む是灌入，流れ込む是流入。"
  },
  {
    groupKey: "stem:映",
    level: "major",
    summary: "映る是影像映入，映す是映照、拍摄；映し出す强调清楚呈现、投射出某种形象或内容。"
  },
  {
    groupKey: "stem:触",
    level: "major",
    summary: "触る是触摸，触れる是接触、提及或触犯；触れ合う是双方互相接触、交流。"
  },
  {
    groupKey: "stem:組",
    level: "major",
    summary: "組む是组合；組み立てる是组装，組み合わせる是搭配组合，組み込む／組み入れる是编入整体。"
  },
  {
    groupKey: "stem:断",
    level: "major",
    summary: "断つ是切断、断绝；断ち切る强调彻底切断联系、习惯或来源。"
  },
  {
    groupKey: "stem:咲",
    level: "major",
    summary: "咲く是开花；咲き乱れる强调花朵繁多、盛开得杂乱，咲き誇る强调开得灿烂、引以为傲。"
  },
  {
    groupKey: "stem:張",
    level: "major",
    summary: "張る是张开、拉紧或坚持；張り詰める强调拉到紧绷状态，也可形容气氛紧张。"
  },
  {
    groupKey: "stem:嚙",
    level: "major",
    summary: "嚙み合う是双方咬合、配合或意见吻合；嚙み付く是咬住、扑咬或强烈反驳。"
  },
  {
    groupKey: "stem:割",
    level: "major",
    summary: "割る是打破、分割，割れる是裂开；割り引く是打折，割り当てる是分配，割り振る是分派，割り切る是彻底分清或想开。"
  },
  {
    groupKey: "stem:向",
    level: "major",
    summary: "向かう是朝向、前往，向く是方向朝向或适合；向ける是把方向转向，向かい合う／向き合う是面对面或正面面对。"
  },
  {
    groupKey: "stem:済",
    level: "major",
    summary: "済む是事情办妥、结束；済ます是主动办完；済ませる是让某人办完，或把事情尽快处理掉。"
  },
  {
    groupKey: "stem:植",
    level: "major",
    summary: "植える是种植，植え付ける强调栽种、定植，植え替える是把植物移栽到别处。"
  },
  {
    groupKey: "stem:折",
    level: "major",
    summary: "折る是折断、折叠，折れる是自己折断；折り畳む强调把物品折叠收拢。"
  },
  {
    groupKey: "stem:痩",
    level: "major",
    summary: "痩せる是变瘦；痩せ衰える强调因病弱、营养不良等逐渐瘦弱衰败。"
  },
  {
    groupKey: "stem:塗",
    level: "major",
    summary: "塗る是涂抹、上色；塗り替える是把原有颜色重新涂换。"
  },
  {
    groupKey: "stem:踏",
    level: "major",
    summary: "踏み込む是踏入、深入；踏み入れる也是进入，但更直接强调把脚或人踏进某处。"
  },
  {
    groupKey: "stem:捕",
    level: "major",
    summary: "捕まえる是抓住，捕らえる是捕获或把握；捕まる／捕らわれる是被抓住，其中捕らわれる还可表示被观念束缚。"
  },
  {
    groupKey: "stem:褒",
    level: "major",
    summary: "褒める是称赞；褒めたたえる强调极力赞美、反复称颂。"
  },
  {
    groupKey: "stem:冷",
    level: "major",
    summary: "冷える是自己变冷，冷ます是使冷却，冷める是热度或热情变凉，冷え込む强调突然、明显变冷。"
  },
  {
    groupKey: "stem:破",
    level: "major",
    summary: "破れる表示纸、布等自己破裂；破る表示主动撕破，也可表示违反规则、约定。"
  },
  {
    groupKey: "stem:結",
    level: "major",
    summary: "結びつく表示双方自己联系、关联；結びつける表示主动把双方联系起来。"
  },
  {
    groupKey: "stem:成",
    level: "major",
    summary: "成る表示变成、组成；成し遂げる是完成目标，成り立つ是成立、构成或说得通。"
  },
  {
    groupKey: "stem:囲",
    level: "major",
    summary: "囲む是围住、包围；囲う是围起来保护、圈养或遮挡，常有设置围栏的意味。"
  },
  {
    groupKey: "stem:干",
    level: "major",
    summary: "干す是晾干、晒干；干からびる是水分耗尽而干枯、干瘪。"
  },
  {
    groupKey: "stem:掘",
    level: "major",
    summary: "掘る是挖掘；掘り下げる是向深处挖，也可深入探讨；掘り起こす是挖出、重新发掘。"
  },
  {
    groupKey: "stem:経",
    level: "major",
    summary: "経つ表示时间经过；経る表示经过某个地点、阶段或过程。"
  },
  {
    groupKey: "stem:語",
    level: "major",
    summary: "語る是讲述、谈论；語り継ぐ强调把故事、传统代代传下去。"
  },
  {
    groupKey: "stem:広",
    level: "major",
    summary: "広がる表示范围、影响自己扩大；広める表示主动传播、推广或扩大范围。"
  },
  {
    groupKey: "stem:支",
    level: "major",
    summary: "支払う是支付费用；支える是支撑物体、维持生活或支持某人。"
  },
  {
    groupKey: "stem:煮",
    level: "major",
    summary: "煮る是煮熟；煮詰める是把液体煮浓，也可引申为把方案讨论到具体、成熟。"
  },
  {
    groupKey: "stem:畳",
    level: "major",
    summary: "畳む是折叠、收起；畳み込む强调把折叠后的东西收进内部，或把多个因素纳入。"
  },
  {
    groupKey: "stem:拭",
    level: "major",
    summary: "拭く是擦拭；拭き取る强调把污渍、水分等擦掉、除去。"
  },
  {
    groupKey: "stem:伸",
    level: "major",
    summary: "伸びる是自己伸长、增长；伸ばす是拉长、延伸；伸び悩む是增长停滞；伸べる是伸出手等。"
  },
  {
    groupKey: "stem:振",
    level: "major",
    summary: "振る是挥动、摇摆；振る舞う是表现、行动；振り向く是回头，振り返る是回头看或回顾，振り回す是挥舞或任意支使，振るう是发挥、施展。"
  },
  {
    groupKey: "stem:締",
    level: "major",
    summary: "締まる是自己收紧、关紧；締める是系紧、拧紧；締めつける强调勒紧、压迫或严格限制。"
  },
  {
    groupKey: "stem:吐",
    level: "major",
    summary: "吐く是吐出、呕吐或说出；吐き出す强调从内部用力吐出、倾诉出来。"
  },
  {
    groupKey: "stem:剝",
    level: "major",
    summary: "剝く是剥开外皮；剝ける是外皮自己剥落；剝がす是主动剥下，剝がれる是外层自己脱落。"
  },
  {
    groupKey: "stem:抜",
    level: "major",
    summary: "抜ける是脱落、遗漏或穿过；抜く是拔出、抽取；抜け落ちる强调掉落遗漏，抜き出す是抽出，抜きん出る是出类拔萃。"
  },
  {
    groupKey: "stem:抱",
    level: "major",
    summary: "抱く（だく）是抱住、拥抱；抱える是抱着、承担问题；抱え込む强调把问题、责任等独自揽在身上。"
  },
  {
    groupKey: "stem:放",
    level: "major",
    summary: "放る是随手扔；放す是放开；放っておく是放任不管；放り出す是扔出去或把人赶出去。"
  },
  {
    groupKey: "stem:埋",
    level: "major",
    summary: "埋まる是被填满、埋上；埋める是填埋；埋め込む是嵌入、埋入；埋もれる是被埋没或被忽视。"
  },
  {
    groupKey: "stem:混",
    level: "major",
    summary: "混ざる是不同东西混在一起；混ぜる是主动混合；混じる是混入、夹杂；混じり合う强调双方充分混合。"
  },
  {
    groupKey: "stem:奪",
    level: "major",
    summary: "奪う是夺走；奪い取る强调从对方手中抢夺、夺取到手。"
  },
  {
    groupKey: "stem:縛",
    level: "major",
    summary: "縛る是捆绑、束缚；縛り付ける强调把对象牢牢捆在某处，或强行束缚。"
  },
  {
    groupKey: "stem:溶",
    level: "major",
    summary: "溶ける是融化、溶解；溶かす是使其融化；溶け込む是融入环境、群体或液体内部。"
  },
  {
    groupKey: "stem:詰",
    level: "major",
    summary: "詰まる是堵塞、挤满；詰める是塞入、填紧或缩短间隔；詰め込む强调大量塞进、灌输。"
  },
  {
    groupKey: "stem:浮",
    level: "major",
    summary: "浮く是浮起或脱离；浮かぶ是浮起、想法浮现；浮かべる是使浮起或浮现表情；浮かび上がる强调清楚显现出来。"
  },
  {
    groupKey: "stem:揺",
    level: "major",
    summary: "揺れる是来回摇晃；揺さぶる是用力摇动或震撼；揺らぐ是基础、信念动摇；揺れ動く是反复摇摆、变动。"
  },
  {
    groupKey: "stem:跳",
    level: "major",
    summary: "跳ぶ是跳跃、飞越；跳ねる是跳起、弹跳；跳ね上がる强调突然向上跳起或猛涨。"
  },
  {
    groupKey: "stem:駆",
    level: "major",
    summary: "駆ける是奔跑；駆け込む是跑进，駆け抜ける是飞奔穿过，駆け上がる是跑上去，駆けつける是赶到，駆け寄る是跑到近旁，駆け巡る是到处奔走。"
  },
  {
    groupKey: "stem:指",
    level: "major",
    summary: "指す是指向、指示；指差す是用手指指；指し示す是明确指出、展示方向或含义。"
  },
  {
    groupKey: "stem:悔",
    level: "interchangeable",
    summary: "悔やむ和悔いる都表示后悔；悔いる较书面，常带对过错自责的语气。"
  },
  {
    groupKey: "stem:巻",
    level: "major",
    summary: "巻く是卷、缠绕；巻き込む是把对象卷进去，也可表示使人卷入事件。"
  },
  {
    groupKey: "stem:含",
    level: "major",
    summary: "含む是包含、含有；含める是把某人或某项计入、包括在内。"
  },
  {
    groupKey: "stem:寄",
    level: "major",
    summary: "寄せる是使靠近、寄托或聚集；寄り掛かる是倚靠；寄り添う是贴近陪伴、依偎。"
  },
  {
    groupKey: "stem:近",
    level: "major",
    summary: "近づく是自己靠近；近づける是使对象靠近；近寄る强调人或物主动向近处靠拢。"
  },
  {
    groupKey: "stem:刻",
    level: "major",
    summary: "刻む是刻、切碎或铭记；刻み込む强调深深刻入表面、记忆或心中。"
  },
  {
    groupKey: "stem:失",
    level: "major",
    summary: "失う是失去、丧失；失[う]せる是消失、离去，常用于人或事物不见了。"
  },
  {
    groupKey: "stem:縮",
    level: "major",
    summary: "縮む是自己缩小；縮める是主动缩短；縮まる是距离、差距等缩小；三者不能按‘缩小’随意替换。"
  },
  {
    groupKey: "stem:省",
    level: "major",
    summary: "省く是省略、节省；省みる是回顾并反省自己的行为，方向完全不同。"
  },
  {
    groupKey: "stem:譲",
    level: "major",
    summary: "譲る是让给、转让；譲り合う是双方互相礼让、相互让步。"
  },
  {
    groupKey: "stem:積",
    level: "major",
    summary: "積む是堆放或积累；積もる是自然堆积；積み重ねる是反复累积，積み重なる是层层累积，積み立てる是定期积攒资金。"
  },
  {
    groupKey: "stem:染",
    level: "major",
    summary: "染める是给东西染色，染まる是颜色或影响染上；染みる是液体、味道渗入或刺痛，染み込む是深入渗入，染み付く是牢牢沾上、留下习惯。"
  },
  {
    groupKey: "stem:問",
    level: "major",
    summary: "問い合わせる是向机构询问、查询；問う是正式追问或问责；問いかける是向对方提出问题；問い詰める是逼问、追问到底。"
  },
  {
    groupKey: "stem:擦",
    level: "major",
    summary: "擦れ違う是擦肩而过或意见错开；擦り抜ける是擦身穿过、设法逃脱。"
  },
  {
    groupKey: "stem:占",
    level: "major",
    summary: "占う是占卜、预测；占める是占据位置、比例或地位。"
  },
  {
    groupKey: "stem:突",
    level: "major",
    summary: "突っ込む是冲入、插入或深入追问；突っ走る是猛冲、鲁莽推进；突き刺す是刺入、刺穿。"
  },
  {
    groupKey: "stem:薄",
    level: "interchangeable",
    summary: "薄れる和薄まる都可表示颜色、印象等变淡；薄れる偏影响、记忆和感觉逐渐减弱，薄まる偏浓度、味道降低。"
  },
  {
    groupKey: "stem:膨",
    level: "major",
    summary: "膨らむ是自己膨胀，膨らます是使其膨胀；膨れる也可指身体鼓起或闹情绪，膨れ上がる强调大幅膨胀。"
  },
  {
    groupKey: "stem:湧",
    level: "major",
    summary: "湧く是水、感情等涌出；湧き出る强调从内部大量涌到外面。"
  },
  {
    groupKey: "stem:応",
    level: "major",
    summary: "応える是回应期待、要求或感情；応じる是根据请求、条件作出应对或接受。"
  },
  {
    groupKey: "stem:強",
    level: "major",
    summary: "強まる是力量、倾向自己增强，強める是主动加强；強いる是强迫别人做不愿意的事。"
  },
  {
    groupKey: "stem:試",
    level: "interchangeable",
    summary: "試す和試みる都表示尝试；試す偏实际试用、验证，試みる较正式，常指尝试做某项行动。"
  },
  {
    groupKey: "stem:襲",
    level: "major",
    summary: "襲う是袭击、突然侵袭；襲いかかる强调向对象猛扑、扑上去攻击。"
  },
  {
    groupKey: "stem:傷",
    level: "major",
    summary: "傷つける是弄伤或伤害别人、感情；傷つく是自己受伤；傷む是物品损坏或身体疼痛；傷める是使其受损。"
  },
  {
    groupKey: "stem:先",
    level: "major",
    summary: "先立つ是先于、领先；先走る是抢先行动、过于积极；先んじる是抢在前面，书面感更强。"
  },
  {
    groupKey: "stem:力",
    level: "major",
    summary: "力む是用力、紧张使劲；力尽きる是力量耗尽、筋疲力竭。"
  },
  {
    groupKey: "stem:弱",
    level: "major",
    summary: "弱まる是力量、风势等变弱；弱る是身体衰弱或因困难而无力；弱める是主动减弱。"
  },
  {
    groupKey: "stem:推",
    level: "major",
    summary: "推し進める是推进计划、改革等；推し量る是推测、揣度未知情况。"
  },
  {
    groupKey: "stem:耐",
    level: "major",
    summary: "耐える是忍受、承受；耐え抜く强调坚持到底、熬过艰难。"
  },
  {
    groupKey: "stem:絡",
    level: "major",
    summary: "絡む是缠绕、纠缠或牵涉；絡まる是自己缠在一起；絡み合う强调双方或多方互相缠绕、交织。"
  },
  {
    groupKey: "stem:練",
    level: "major",
    summary: "練る是推敲、锻炼或揉制；練り上げる是反复推敲完成；練り直す是重新推敲、修改方案。"
  },
  {
    groupKey: "stem:適",
    level: "major",
    summary: "適[かな]う表示符合条件、要求或道理；適[かな]える表示使某物符合、满足要求。"
  },
  {
    groupKey: "stem:潜",
    level: "major",
    summary: "潜る是潜入水中、地下或某处；潜む是隐藏、潜伏在内部，重点是‘藏着’而非‘进入’。"
  },
  {
    groupKey: "stem:織",
    level: "major",
    summary: "織る是织布、编织；織り込む是把内容编入、纳入；織り成す是交织形成复杂的景象或关系。"
  },
  {
    groupKey: "stem:根",
    level: "major",
    summary: "根付く表示习惯、文化等扎根形成；根差す表示以某事为基础、根源在于某处。"
  },
  {
    groupKey: "stem:存",
    level: "interchangeable",
    summary: "存じる和存じ上げる都是‘知道’的谦让语；存じ上げる更郑重，通常用于知道对方或其姓名。"
  },
  {
    groupKey: "stem:呆",
    level: "interchangeable",
    summary: "呆れる是惊呆、无语；呆れ果てる进一步强调彻底无语、失望到极点。"
  },
  {
    groupKey: "stem:遂",
    level: "interchangeable",
    summary: "遂げる是完成、实现；やり遂げる强调克服困难后坚持完成，语气更有‘做到底’的感觉。"
  },
  {
    groupKey: "stem:脅",
    level: "major",
    summary: "脅す是威胁、恐吓某人；脅かす（おびやかす）是威胁安全、地位或秩序，不能按‘吓唬’替换。"
  },
  {
    groupKey: "stem:報",
    level: "major",
    summary: "報じる是报道、公布消息；報う是报答或报应，意义方向完全不同。"
  },
  {
    groupKey: "stem:和",
    level: "major",
    summary: "和らげる是主动缓和，和らぐ是状态缓和；和む是气氛、心情变得温和放松。"
  }
];

type SynonymReviewRow = readonly [string, DistinctionLevel, string];

const SYNONYM_REVIEW_ROWS: readonly SynonymReviewRow[] = [
  ["synonym:以前", "major", "以前表示过去某时或从前；前々表示很早以前，也常修饰‘事先’。"],
  ["synonym:经济", "major", "経済是经济及经济状况；エコノミー多指经济舱或低价、简约档次。"],
  ["synonym:警察", "major", "警察是警察这一机构或警察人员的统称；警察官明确指警察官，警官偏向正式称呼。"],
  ["synonym:健康的", "major", "健康是健康、身体状况良好；健やか带有身心健全、成长平稳的书面或温和语气。"],
  ["synonym:原因", "major", "原因直接指原因；ため还可表示目的或理由；ゆえん是偏书面的原因、理由，不能互换所有用法。"],
  ["synonym:遗憾的", "major", "残念是遗憾、可惜；無念强调未能如愿的悔恨；遺憾偏正式书面语，不能按语气随意替换。"],
  ["synonym:时间", "major", "時期是时期、阶段；時間是持续的时间或时刻；タイム常指计时、比赛成绩或外来语场合。"],
  ["synonym:住所", "major", "住所是登记或实际住址；住まい强调居所、生活之处；住居偏正式地指住宅或居住处。"],
  ["synonym:资料", "major", "資料是供参考的资料、材料；データ是可记录、分析的数值或数据，范围不完全相同。"],
  ["synonym:报纸", "major", "新聞通常指报纸或新闻；新聞紙特指报纸这种纸张或纸面，不能在所有新闻语境替换。"],
  ["synonym:重要的", "major", "大切偏重珍惜和重要；大事偏口语的重视；重要较客观正式；肝要是书面语的关键、要紧。"],
  ["synonym:途中", "major", "途中指进行中的中途或路上；途上偏书面，强调尚在过程、尚未到达目标。"],
  ["synonym:普通的", "major", "普通是一般、通常；ありきたり常带老套、缺乏新意的贬义，不能随意替换。"],
  ["synonym:文化", "interchangeable", "文化和カルチャー都指文化；カルチャー更口语或商业化，常见于流行文化和课程名称。"],
  ["synonym:拿出", "major", "出す泛指拿出、提出、提交；持ち出す强调从某处带出，或把话题、主张提出来。"],
  ["synonym:坐下", "major", "座る是坐下或处于坐姿；腰掛ける强调坐到椅子等有支撑物上，不能替换所有坐姿表达。"],
  ["synonym:来", "major", "来る只表示来；いらっしゃる和おいでになる是尊敬语，还可表示去、在，使用对象和方向不同。"],
  ["synonym:做", "major", "する是中性通用的做；やる较口语且可表示给予；いたす是する的谦让语，不能混用敬语等级。"],
  ["synonym:消失", "major", "無くなる表示不再存在或用尽；消える可指消失、熄灭；消え去る、失せる更强调彻底离去，语气和搭配不同。"],
  ["synonym:够用", "interchangeable", "足りる和事足りる都表示够用；事足りる更书面，强调达到所需而无须更多。"],
  ["synonym:会议", "interchangeable", "会議和ミーティング都可译为会议；ミーティング更口语，常指规模较小或目的明确的碰头会。"],
  ["synonym:会场", "major", "会場是活动、比赛等的会场；式場特指仪式场地，尤其婚礼、葬礼等正式仪式。"],
  ["synonym:医生", "major", "医者是日常称呼医生；医師是资格和职业的正式称谓；ドクター是外来语，也可指博士或医生称号。"],
  ["synonym:护士", "interchangeable", "看護師是正式职业名称；ナース是口语或外来语称呼，正式文件中通常用看護師。"],
  ["synonym:学生", "major", "学生泛指学生；生徒多指中小学等受学校教育者；教え子特指某位教师教过的学生。"],
  ["synonym:丈夫", "major", "夫是中性、正式的丈夫；主人是对自己丈夫的传统称呼且还可指主人；亭主较口语，不能无条件互换。"],
  ["synonym:妻子", "major", "妻是中性正式的妻子；家内是对自己妻子的传统谦称；女房较口语或旧式，语气和使用对象不同。"],
  ["synonym:～先生", "interchangeable", "〜さん和さん都是接在人名后的普通敬称；前者是完整标记写法，后者多作为词尾说明，实际称呼基本相同。"],
  ["synonym:～君", "interchangeable", "〜君和～くん都是接在人名后的君；差别主要是表记格式，实际敬称功能相同。"],
  ["synonym:你", "major", "あなた是一般的你；君多用于对晚辈、亲近者或男性，带有上下关系和语气限制。"],
  ["synonym:不太", "interchangeable", "あまり和あんまり都表示不太、不很，通常接否定；あんまり更口语，正式表达用あまり。"],
  ["synonym:吵闹的", "major", "うるさい可指声音大、烦人或碍事；やかましい更强硬；騒々しい、騒がしい主要描述喧闹嘈杂，不能完全互换。"],
  ["synonym:前年", "interchangeable", "おととし和一昨年都表示前年；おととし偏日常口语，一昨年可用于较正式书面表达。"],
  ["synonym:爸爸", "major", "お父さん是对父亲的称呼或礼貌说法；パパ是家庭口语、儿童语，不能用于所有正式场合。"],
  ["synonym:妈妈", "major", "お母さん是对母亲的称呼或礼貌说法；ママ是家庭口语、儿童语，使用场合明显更窄。"],
  ["synonym:杯子", "interchangeable", "カップ通常指有把手或用于饮品、计量的杯；コップ泛指饮水杯，日常场景常可互换但形状侧重点不同。"],
  ["synonym:包", "major", "かばん、バッグ都可指携带物品的包；袋是袋子，通常没有硬挺的包体和背提结构，不能完全替换。"],
  ["synonym:外套", "major", "コート是较厚、覆盖在外层的外套，也可指球场；上着泛指穿在上身外面的衣服，范围更宽。"],
  ["synonym:这边", "major", "こちら是礼貌的这边、这位；こっち是其口语缩略，正式度和指人时的礼貌程度不同。"],
  ["synonym:复印", "interchangeable", "コピー和複写都可表示复印、复制；コピー更日常且范围更宽，複写更正式或强调照原样复制。"],
  ["synonym:米饭", "major", "ご飯可指米饭、饭或一餐；ライス主要指作为菜品的米饭，不能替换吃饭等表达。"],
  ["synonym:于是", "major", "そして是然后、并且的连接；すると强调前件发生后出现后件或于是发现；不能按中文‘于是’全部替换。"],
  ["synonym:因此", "major", "だから、ですから偏口语结论；それで可承接结果；そこで强调因而采取行动；そのため、したがって更书面，功能不同。"],
  ["synonym:很多", "major", "たくさん表示数量多；多く偏书面，常作名词修饰或表示多数，不能替换所有副词用法。"],
  ["synonym:只", "major", "だけ是范围限定的只、仅；たった强调数量少、仅仅，常带意外或轻视语气，不能完全互换。"],
  ["synonym:票", "major", "チケット和切符主要是乘车、入场等票券；票是选票、票数或票据等，不能统称所有票券。"],
  ["synonym:桌子", "major", "テーブル是桌面较大的桌子、餐桌等；机是书桌、办公桌，功能和形状有明确侧重。"],
  ["synonym:教材", "major", "テキスト可指教材，也可指一般文本、课本；教材专指教学材料，范围更窄、更正式。"],
  ["synonym:考试", "major", "テスト常指测验、测试，也可泛指考试；試験更正式，常指资格、入学或能力考试。"],
  ["synonym:门", "major", "ドア通常是房间、建筑的门；扉可指门扇、书页等较书面或文学的开合物，不能完全互换。"],
  ["synonym:请", "major", "どうぞ用于请做、请用或请先；どうか、何とぞ用于恳请、务必，带请求强度和正式度，不能互换所有场景。"],
  ["synonym:哪个", "interchangeable", "どちら和どっち都可表示哪个、哪边；どっち是口语形式，どちら更礼貌正式。"],
  ["synonym:很", "major", "とても是很、非常；だいぶ表示相当、大大地，常含程度已有明显变化，语气和搭配不同。"],
  ["synonym:谁", "major", "どなた是礼貌的哪位；だれ是普通的谁，不能忽略对听话人的礼貌等级。"],
  ["synonym:笔记", "major", "ノート是笔记本或笔记内容；筆記是书写记录这一行为或书面记录，不能替换所有名词用法。"],
  ["synonym:聚会", "major", "パーティー偏娱乐、庆祝性质的聚会；集い是聚集、集会的书面或温和说法，目的和语体不同。"],
  ["synonym:已经", "major", "もう表示已经或不再，口语且可带变化感；すでに是客观的已经；もはや含如今已不再的语气。"],
  ["synonym:更加", "major", "もっと是口语的更加；より用于比较；一層、なおさら偏书面并强调程度递进，句法不能互换。"],
  ["synonym:第一", "major", "一番表示最、第一名或最为；第一还可表示首先、最重要，搭配和语法功能不同。"],
  ["synonym:饮料", "major", "飲み物是日常泛称饮料；ドリンク偏商品、口语；飲料是正式或分类用语，不能所有场景互换。"],
  ["synonym:车站", "major", "駅是铁路、地铁车站；ステーション是外来语站点；停留所多指公交等车辆停靠处，不能混用。"],
  ["synonym:水果", "interchangeable", "果物和フルーツ都指水果；フルーツ更口语、商品化或偏西式语境，基本可互换。"],
  ["synonym:各位", "major", "皆さん是对在场或听众的亲切称呼；方々是礼貌的各位、那些人；各位是正式书面称谓，使用对象不同。"],
  ["synonym:学校", "interchangeable", "学校和スクール都可指学校；スクール更常用于特定课程、培训班或品牌名称。"],
  ["synonym:脸", "major", "顔是脸、表情以及脸面；顔面只指面部，偏医学或客观书面，不能替换表情、面子等用法。"],
  ["synonym:牛奶", "interchangeable", "牛乳和ミルク都可指牛奶；ミルク也可泛指奶类饮品或配料，牛乳更明确正式。"],
  ["synonym:去年", "interchangeable", "去年和昨年都表示去年；去年较口语常用，昨年更正式书面。"],
  ["synonym:金钱", "major", "金是日常的金钱、钱；金銭是正式概念，强调货币或金钱本身，语体和搭配不同。"],
  ["synonym:天空", "interchangeable", "空和大空都可表示天空；大空带有广阔、仰望天空的语感，普通事实陈述多用空。"],
  ["synonym:后面", "major", "後是后、以后或之后；後ろ是空间上的后面、背后，时间和空间用法不能互换。"],
  ["synonym:对面", "major", "向こう指那边、对面或对方一侧；向かい是正对面的对象；向こう側明确指另一侧，视点不同。"],
  ["synonym:国家", "major", "国可指国家、国土或故乡；国家是政治意义上的国家，偏正式且不能替代国的故乡等用法。"],
  ["synonym:黑色", "major", "黒是颜色黑色，也可引申黑暗；ブラック是外来语，常指黑色商品、黑心或负面标签，语感不同。"],
  ["synonym:今晚", "interchangeable", "今晩和今夜都表示今晚；今夜更书面或文学，今晩更日常。"],
  ["synonym:时候", "major", "時是时间、时候；際是某个时机、之际，常用于正式固定搭配，不能替换所有时候表达。"],
  ["synonym:有时", "interchangeable", "時々和時折都表示有时、偶尔；時折稍书面，频率通常比时々更低的感觉。"],
  ["synonym:词典", "major", "辞書是查词义、读音的词典；辞典常指按领域编纂的辞典，也可作正式书名用语，范围略不同。"],
  ["synonym:问题", "major", "質問是向人提出的问题、疑问；問題是需要解决的难题、题目或问题本身，不能互换。"],
  ["synonym:年轻的", "major", "若い是年龄小或新；若々しい强调年轻感、活力和朝气，不能用于所有年龄事实。"],
  ["synonym:周", "major", "週是一个星期这一时间单位；週間强调持续几周的期间或周数，句法搭配不同。"],
  ["synonym:出口", "major", "出口是进出的出口；はけ口是液体、情绪或积压物的排出口、发泄渠道，不能混用。"],
  ["synonym:场所", "major", "所、場所是地点；場还指场合、氛围或活动现场；スポット常指特定景点、地点，范围和语感不同。"],
  ["synonym:女性", "major", "女是日常的女人、女性且语气依上下文变化；女性是中性正式分类词，不能在称呼等场景替换。"],
  ["synonym:擅长的", "major", "上手是技能好；得意是擅长也可表示得意、自鸣得意；得手是擅长某项且偏书面，语感不同。"],
  ["synonym:食物", "major", "食べ物是日常的食物；食物是正式、分类或生物学语境的食物，语体和搭配不同。"],
  ["synonym:父母", "major", "親是父母、双亲也可泛指亲属或养育者；父母明确指父亲和母亲，正式且范围更窄。"],
  ["synonym:人", "major", "人是人、某人或别人；人間强调人类或作为人的存在；者多用于书面指某类人，不能完全替换。"],
  ["synonym:前面", "major", "前是空间前面也可指以前；先是前方、先前或目的地一带；前方、前面更专指空间前侧。"],
  ["synonym:全部", "interchangeable", "全部和全て都表示全部；全て稍书面，全部更口语，基本可以互换。"],
  ["synonym:窗户", "major", "窓是窗户或窗口；ウィンドー也可指橱窗、车窗等外来语对象，搭配和语体不同。"],
  ["synonym:身体", "major", "体是日常的身体；身可指自身、身处状态或身体；身体是正式、客观的身体概念。"],
  ["synonym:严重的", "major", "大変可表示严重、辛苦或不得了；深刻专指问题严重、深刻，不能替换辛苦等用法。"],
  ["synonym:男性", "major", "男是日常的男人、男性；男性是中性正式的性别分类词，称呼和统计语境不同。"],
  ["synonym:里面", "major", "中是里面、内部或中间；奥是深处、里面靠里的位置，不能替换所有内部关系。"],
  ["synonym:白天", "interchangeable", "昼和昼間都表示白天；昼可兼指中午，昼間更明确强调白天这一时段。"],
  ["synonym:午饭", "interchangeable", "昼ご飯和昼食都指午饭；昼ご飯日常，昼食正式或用于餐次分类。"],
  ["synonym:早晨", "major", "朝是早晨、早上并可泛指上午；早朝专指很早的清晨，语体也更正式。"],
  ["synonym:天气", "major", "天気是日常天气或晴朗天气；天候是客观天气状况；日和还可指适合某事的天气、形势，不能全换。"],
  ["synonym:交给", "major", "渡す是交给、递给或渡过；引き渡す强调正式移交、交还给对方，动作和责任转移更强。"],
  ["synonym:道路", "interchangeable", "道和道路都可指道路；道更口语且还可指道路以外的路径、方法，道路偏具体正式。"],
  ["synonym:白", "interchangeable", "白和ホワイト都表示白色；ホワイト更常见于商品、颜色名称或引申的白名单语境。"],
  ["synonym:头发", "interchangeable", "髪和髪の毛都指头发；髪可泛指发型或头发本身，髪の毛更具体指发丝。"],
  ["synonym:晚饭", "major", "晩ご飯和夕飯是日常的晚饭；夕食是正式的晚餐、餐次名称，不能替换所有口语场景。"],
  ["synonym:飞机", "major", "飛行機是日常的飞机；航空機是航空器的正式总称，范围可包括飞机以外的航空器。"],
  ["synonym:衣服", "major", "服是日常穿着；衣服是正式的衣物称呼；衣類是分类总称；衣偏书面且可指外层衣物，不能完全互换。"],
  ["synonym:帽子", "major", "帽子是泛指帽子；キャップ特指无帽檐或有帽舌的帽型，也可表示上限，范围和词性搭配不同。"],
  ["synonym:忙碌的", "major", "忙しい是忙、事情多；せわしない还带动作急促、心神不宁或环境忙乱的语气，不能完全替换。"],
  ["synonym:北方", "major", "北是方向北、北方；北側是某物的北侧，必须有参照物，不能替换泛指北方。"],
  ["synonym:书店", "interchangeable", "本屋和書店都表示书店；本屋更日常，書店更正式或用于店名。"],
  ["synonym:每年", "major", "毎年是每年发生；年々是逐年、年复一年地变化，常含递进或趋势，不能完全互换。"],
  ["synonym:名字", "major", "名前是姓名或名称；名可指名字、名声或名义，书面和固定搭配更多，不能替换所有姓名表达。"],
  ["synonym:有趣的", "major", "面白い是有趣、好玩，也可表示奇怪；興味深い是引人兴趣、耐人寻味，通常不表示好笑或好玩。"],
  ["synonym:树木", "major", "木可指树、木材或单棵树；樹木专指树木整体，偏书面、客观，不能替换木材等用法。"],
  ["synonym:药", "major", "薬是日常的药，也可指药效；薬剤是药剂、制剂的正式或专业称呼，不能替换口语固定搭配。"],
  ["synonym:下周", "interchangeable", "来週和翌週都可表示下周；翌週更书面，且常以某一周为基准说下一周。"],
  ["synonym:那样的", "major", "あんな指离说话人和听话人都远或带负面感的那种；そんな指听话人一侧或刚提到的那种，指示距离不同。"],
  ["synonym:随时", "major", "いつでも是任何时候、随时，日常口语；随時是正式的随时、按需要，常用于通知和制度说明。"],
  ["synonym:礼物", "interchangeable", "プレゼント和贈り物都可指礼物；プレゼント更口语和现代，贈り物较正式或带赠送行为感。"],
  ["synonym:终于", "major", "やっと强调经过困难后终于；とうとう常暗示结果终于发生且可能不理想；ついに偏书面结局；いよいよ表示终于到了关键阶段，也可表示越来越。"],
  ["synonym:感觉", "major", "感じ是主观感受、印象；感覚是感官或判断能力；気味是某种倾向、感觉或略带不良意味，不能互换。"],
  ["synonym:简单的", "interchangeable", "簡単和シンプル都可表示简单；シンプル更强调构成简洁、没有多余，且是外来语。"],
  ["synonym:弄错", "major", "間違える是把某事做错、认错；間違う是错误或不正确；誤る偏书面，常指判断失误或犯错。"],
  ["synonym:硬的", "major", "固い可指物理硬、态度拘谨或关系僵；硬い主要指物理坚硬、结实，汉字不同对应的引申范围不同。"],
  ["synonym:想法", "major", "考え是想法、意见或思考；アイデア偏具体创意、主意；考え方是思考方式或观点体系，不能全换。"],
  ["synonym:森林", "major", "森是日常的森林、树林；森林是面积较大的森林或正式分类概念，范围和语体不同。"],
  ["synonym:万一", "interchangeable", "もしも和万が一都可表示万一、假如；万が一更强调概率极低和最坏情况。"],
  ["synonym:手机", "major", "携帯可简称手机，也可表示携带；携帯電話明确指移动电话，不能替换携带等非手机用法。"],
  ["synonym:几个人", "major", "何人是疑问的几人、多少人；数人是几个、数名，表示数量而不是提问，不能互换。"],
  ["synonym:超市", "interchangeable", "スーパー和スーパーマーケット都指超市；スーパー是日常缩略，后者是完整正式名称。"],
  ["synonym:零", "major", "ゼロ和零都表示数字零；ゼロ还可表示没有、起点或归零，零更常用于正式读数和汉字表记。"],
  ["synonym:大概", "major", "たぶん是大概、可能，表示推测；大概是大致、通常或多半，确定性和句法功能不同。"],
  ["synonym:意思", "major", "意味是词语、行为的意义；意思是意志、想法或打算，不能按中文相同字面互换。"],
  ["synonym:不同", "major", "違う是不同、不对，也可作口语判断；異なる是正式的不同、相异，语体和句法搭配不同。"],
  ["synonym:拉", "major", "引く可表示拉、牵、减去或引用；引っ張る强调用力拽、拉长或拖动，不能完全替换。"],
  ["synonym:运动场", "interchangeable", "運動場和グラウンド都可指运动场；グラウンド更口语，常指学校或比赛场地，運動場更泛。"],
  ["synonym:声音", "major", "音是物体发出的声音、声响；声是人的声音或嗓音，也可指动物叫声，不能随意互换。"],
  ["synonym:不擅长的", "major", "下手是技能差；苦手是感到棘手、不喜欢或不擅长；不得手偏书面；不得意强调不擅长，语感和对象不同。"],
  ["synonym:对话", "major", "会話是日常对话、交谈；対話强调双方平等交流、对话解决问题，偏正式且概念更强。"],
  ["synonym:大街", "major", "街是街道、街区或城市；大通り特指宽阔的主要大道，不能替换所有街道。"],
  ["synonym:角落", "major", "角是拐角、角落或角度；コーナー是角落、专区或体育转弯处；隅、片隅强调边角的偏僻位置，不能全换。"],
  ["synonym:季节", "interchangeable", "季節和シーズン都可表示季节；シーズン还常指体育、旅游、销售等特定时期。"],
  ["synonym:讨厌的", "major", "嫌表示讨厌、不愿意的心情或拒绝；嫌い是讨厌、厌恶的性质或对象，词性和句法不同。"],
  ["synonym:节日", "major", "祭り是祭典、庆典或民俗活动；祝日是法律规定的公休日，不能互换。"],
  ["synonym:用法", "major", "使い方是使用方法；使い道是物品、钱等的用途或去处，不能用于所有语言用法。"],
  ["synonym:寂寞的", "interchangeable", "寂しい和さみしい都表示寂寞、冷清；さみしい是较口语的读法，语义基本相同。"],
  ["synonym:种类", "major", "種類是事物的类别、种类；ジャンル是作品、活动等的类型或体裁，范围和搭配不同。"],
  ["synonym:认真的", "major", "真面目是认真、规矩或老实的性格；真剣是严肃、全神贯注；本気是当真、不是开玩笑，不能全换。"],
  ["synonym:难受的", "major", "つらい是痛苦、辛苦、难以忍受；切ない是因思念、悲伤等产生的苦闷难过，情感色彩更强。"],
  ["synonym:座位", "major", "席是座位、席位或参加名额；座席明确指座位；シート偏具体座椅、座席或车内座位，不能全换。"],
  ["synonym:工具", "interchangeable", "道具和工具都可指工具；道具还可指道具、手段，工具较偏实际器具和正式分类。"],
  ["synonym:内容", "major", "内容是文章、事件等的内容；中身是容器里的东西或事物实质；コンテンツ偏数字、媒体或可消费内容。"],
  ["synonym:身高", "major", "背可口语表示身高，也可指背部；身長是正式身高；背丈是身高或物体高度，不能全换。"],
  ["synonym:方面", "major", "方可表示一方、方面或方向；方面专指领域、方面或方向范围，正式且不能替换方的比较用法。"],
  ["synonym:出色的", "major", "立派强调值得称赞、堂堂正正或规模气派；見事强调完成得漂亮、精彩或结果令人佩服，语感不同。"],
  ["synonym:摩托车", "interchangeable", "オートバイ和バイク都指摩托车；バイク更口语，也可泛指自行车等两轮车。"],
  ["synonym:办公室", "major", "オフィス是办公室、办公空间；事務所是办事机构或事务所，也可指律师等专业机构，不能全换。"],
  ["synonym:电脑", "major", "コンピューター是计算机的总称；パソコン特指个人电脑，范围更窄。"],
  ["synonym:而且", "major", "それに是补充而且；そのうえ强调在前项之上再增加；しかも带出超出预期或加强语气，不能全换。"],
  ["synonym:检查", "major", "チェック是核对、确认或简单检查；検査是按标准进行的检验、检查，正式和专业程度更高。"],
  ["synonym:意图", "major", "つもり是主语的打算、意向，也可表示自以为；意図是有目的的意图、企图，不能替换所有打算表达。"],
  ["synonym:清楚地", "major", "はっきり是清楚、明确、听得清；ありあり是情景、样子鲜明地浮现，不能替换声音或立场明确。"],
  ["synonym:视频", "major", "ビデオ偏录像、视频设备或录像带；動画是动态影像、视频内容，现代网络语境更常用，范围侧重点不同。"],
  ["synonym:哎呀", "major", "へえ表示惊讶、感兴趣或佩服的哦；あら表示女性化或柔和的惊讶、发现，语气和使用者形象不同。"],
  ["synonym:当然", "interchangeable", "もちろん和むろん都表示当然、不用说；むろん更书面或郑重，日常多用もちろん。"],
  ["synonym:做法", "major", "やり方、仕方是做事方法；作り是制作方式或构造；仕様是规格、做法或系统设定，不能全换。"],
  ["synonym:以下", "major", "以下是以下、不超过某数或下文；下記是下列、如下文，通常用于引出后面的列举，不能全换。"],
  ["synonym:差异", "major", "違い是一般差别；差是差额、差距；相違、差異偏正式书面且强调不同，搭配和语体不同。"],
  ["synonym:培养", "major", "育てる是养育、培育具体对象；培う是培养能力、习惯或基础，偏书面且不用于所有养育场景。"],
  ["synonym:司机", "major", "運転手专指驾驶车辆的人；ドライバー还可指驱动程序、工具或某类驾驶员，范围更宽。"],
  ["synonym:坏掉", "major", "壊れる是损坏、破裂而不能正常使用；潰れる是被压扁、破产或店铺倒闭，结果类型不同。"],
  ["synonym:外表", "major", "格好是外形、姿态或样子，也可指体面；見た目专指看上去的外观，不能替换体面等引申义。"],
  ["synonym:错误", "major", "間違い、ミス、誤り都是错误但语体不同；錯誤偏书面或专业的偏差；過ちは过失、错误行为，责任色彩更强；誤謬是书面语的谬误，常指逻辑或认识上的错误。"],
  ["synonym:关系", "major", "関係是关系或关联；仲强调人与人的交情；関わり是牵涉、关联；間柄是双方身份关系，不能全换。"],
  ["synonym:情绪", "major", "気分是当下心情或身体状态；情緒是情感、情绪状态或情趣，偏书面且范围不同。"],
  ["synonym:技术", "major", "技術是技术、工艺或技能体系；テクニック是技巧、手法；技法是艺术、专业制作技法，不能全换。"],
  ["synonym:相反的", "major", "逆是相反、倒过来或逆向；反対是相反或反对；裏腹是表面与实际相反，常带表里不一，不能互换。"],
  ["synonym:紧急的", "major", "急可表示急、突然或着急；早急是尽快、赶紧，常修饰处理；緊急是正式的紧急状态，搭配不同。"],
  ["synonym:状况", "major", "具合多指具体状况、进展或身体感觉；コンディション偏身体、设备或状态条件，不能替换所有状况。"],
  ["synonym:空", "major", "空く（あく）是空出来、腾出；空く（すく）是变稀、空隙增多或肚子空，读音相同但用法不同。"],
  ["synonym:负责人", "major", "係是负责某项事务的人或岗位；責任者是承担最终责任的负责人，权限和责任范围更强。"],
  ["synonym:形状", "major", "形是外形、形态，也可指形式；形状是客观形状、状态的正式说法，不能替换形式等抽象用法。"],
  ["synonym:建造", "major", "建てる是建造建筑物；築く是建造、建立关系或基础，偏重长期构筑和抽象对象。"],
  ["synonym:找到", "major", "見つかる是被找到、发现的自动词；見つける是主动找到；見当たる是找到、看见目标，句法和视角不同。"],
  ["synonym:幸福的", "interchangeable", "幸せ和幸福都表示幸福；幸せ更日常主观，幸福更书面或概念化。"],
  ["synonym:这次", "major", "今回明确是这一次；今度可指这次、下次或下一回，必须依上下文判断，不能无条件替换。"],
  ["synonym:留下", "major", "残る是某物留下、剩下的自动词；残す是主动留下、保留；取り残す是把某物落下或使其掉队，不能全换。"],
  ["synonym:想起", "major", "思い出す是回想起记忆；思い浮かぶ是想法或形象浮现；思い浮かべる是使其浮现在脑中；思い当たる是想到线索；思い起こす偏主动回忆。"],
  ["synonym:比赛", "major", "試合是体育比赛；プレー是比赛中的发挥、演奏或表演；レース是竞速赛；コンクール是评比竞赛，不能全换。"],
  ["synonym:事情", "major", "事是事情、事实；用事是要办的事；用件是事项、要事；事柄是某一事项，语体和范围不同。"],
  ["synonym:寺庙", "interchangeable", "寺和寺院都指寺庙；寺日常常用，寺院更正式或指宗教机构、建筑群。"],
  ["synonym:抄写", "major", "写す是抄写、转写，也可拍摄；書き取る是听写、抄录并记录文字，不能替换拍摄等用法。"],
  ["synonym:扔掉", "interchangeable", "捨てる和投げ捨てる都可表示扔掉；投げ捨てる明确带有用力投掷、粗暴抛弃的动作。"],
  ["synonym:周围", "major", "周り是周围、附近，也可指轮流；周囲是包围范围、周边环境，偏正式且不能替换轮流等用法。"],
  ["synonym:聚集", "major", "集まる是人或物聚集的自动词；集う强调人们为共同目的聚集，较书面且常带群体感。"],
  ["synonym:情况", "major", "場合是某种场合、假设条件；ケース是个案、情况或盒子；事情是背景缘故；状況是客观状态，不能全换。"],
  ["synonym:情报", "major", "情報是信息、情报；インフォメーション偏提供给公众的说明、咨询处或信息服务，范围不同。"],
  ["synonym:食品", "major", "食料品是作为食料出售的食品、杂货；食品是食品这一正式分类概念，不能替换所有食料和商品语境。"],
  ["synonym:担心的", "interchangeable", "心配和気がかり都表示担心、挂念；気がかり更强调心中放不下的事项，心配用途更广。"],
  ["synonym:线", "major", "線是线、线路或界线；糸是线、丝线等细长材料；ライン是线、线路或队列，搭配和对象不同。"],
  ["synonym:大致", "major", "大体是大致、基本上或大部分；一通り是从头到尾粗略完成一遍，不能替换基本上等副词用法。"],
  ["synonym:价格", "interchangeable", "値段和価格都可表示价格；値段更日常，価格更正式，常用于商品定价、经济或统计。"],
  ["synonym:地面", "major", "地可指土地、地面或地域；地面明确指地表，不能替换土地、地盘等抽象用法。"],
  ["synonym:害羞的", "major", "恥ずかしい是害羞、丢脸或难为情；照れくさい是因被夸、亲昵等而不好意思，情境更窄。"],
  ["synonym:中心", "interchangeable", "中心和センター都可表示中心；センター更常指设施、机构或服务中心，中心可用于抽象核心。"],
  ["synonym:特产", "major", "土産通常指旅行带回的礼物、土产；特産是某地特有的产品，不能替换赠送给人的礼物。"],
  ["synonym:特别", "major", "特に是特别、尤其；とりわけ强调在同类中格外；取り立てて常用于否定并表示特意提出；殊更带故意、格外之意，不能全换。"],
  ["synonym:表面", "major", "表是外面、正面，也可指公开一面；表面是物体表层；上辺是外表、表面现象，常暗示不真实，不能全换。"],
  ["synonym:商品", "major", "品物是物品、商品的日常说法；商品是用于销售的商品；売り物强调拿来卖；グッズ常指周边商品，范围不同。"],
  ["synonym:瓶子", "interchangeable", "瓶和ボトル都可指瓶子；ボトル更常指饮料、化妆品等特定容器，瓶偏日常和材质形状。"],
  ["synonym:可怕的", "major", "怖い是感到害怕、可怕；恐ろしい更强烈、严重或令人恐惧，也可表示惊人，语气不同。"],
  ["synonym:父亲", "major", "父親是正式、中性的父亲；親父是对父亲或中年男性的口语称呼，粗犷和亲密语气更强。"],
  ["synonym:分开", "major", "分ける是主动分开、分类；分かれる是分开、分成的自动词；切り離す强调切断连接、彻底分离。"],
  ["synonym:文章", "major", "文可指句子、文章或文言文；文章是篇章、作文等完整文章，范围和长度侧重点不同。"],
  ["synonym:方法", "major", "方法是一般方法；方策是为解决问题采取的策略、措施；メソッド是体系化方法或程序，不能全换。"],
  ["synonym:拜访", "major", "訪ねる是拜访或去找；伺う是拜访、询问的谦让语，使用对象和敬语等级不同。"],
  ["synonym:味道", "major", "味是味道、滋味也可指趣味；味わい强调品味后的风味、韵味和情趣，不能完全互换。"],
  ["synonym:生命", "major", "命是生命、性命，日常和情感色彩更强；生命是正式、科学或概念性的生命。"],
  ["synonym:返回", "major", "戻る是回到原处或状态；返る是返回、归还或恢复；引き返す是中途折返；立ち返る、立ち戻る强调回到原点或原状态。"],
  ["synonym:用途", "major", "用是用途、事情或作用的简略词；用途明确指使用目的，正式且不能替换用的其他义项。"],
  ["synonym:背面", "major", "裏是背面、里面，也可指幕后或真相；裏側明确指另一面；裏面偏正式的背面或内部情况，不能全换。"],
  ["synonym:两者", "interchangeable", "両方和両者都可表示两者、双方；両方更常用于选择和两边，両者更书面地指双方对象。"],
  ["synonym:礼貌", "major", "礼是礼节、礼貌或礼物；礼儀是礼仪、规矩和行为规范，不能替换感谢、礼物等用法。"],
  ["synonym:跑步", "major", "ジョギング是轻松慢跑、健身跑；ランニング泛指跑步，也可指跑步运动或跑步训练，强度范围不同。"],
  ["synonym:开关", "major", "スイッチ是开关、切换按钮；開閉是打开和关闭这一动作或开闭状态，不能替换具体开关。"],
  ["synonym:机会", "interchangeable", "チャンス和機会都表示机会；チャンス更口语且常强调好机会，機会更中性正式。"],
  ["synonym:好好地", "major", "ちゃんと和きちんと都可表示好好、整齐；ろくに通常与否定连用表示不充分，不能按正面‘好好地’替换。"],
  ["synonym:礼仪", "major", "マナー是日常礼貌、规矩或行为规范；行儀强调举止是否规矩，常用于评价人的行为。"],
  ["synonym:规则", "interchangeable", "ルール和規則都可表示规则；ルール更口语、范围更宽，規則更正式且常指成文规定。"],
  ["synonym:位置", "major", "位置是地点、位置或位于；ポジション还指职位、阵容位置或立场，不能替换所有位置表达。"],
  ["synonym:一部分", "interchangeable", "一部和一部分都表示一部分；一部更简洁正式，一部分更明确口语。"],
  ["synonym:轻松的", "major", "楽是轻松、不费力或舒服；気楽是没有精神压力；気軽是随意、不拘束，侧重点不同。"],
  ["synonym:景色", "major", "景色是风景、景色；眺め是观看到的景象、眺望，也可指观察视野，不能全换。"],
  ["synonym:事件", "major", "事件是案件、事故或具有问题性质的事件；出来事是发生的事情，通常不必带负面或案件意味。"],
  ["synonym:相称", "major", "似合う是适合、相称，常指外观和人相配；見合う是相互对视或价值、条件相当，不能替换。"],
  ["synonym:自由的", "major", "自由是自由、不受限制；フリー还可表示免费、空闲或自由职业，不能全换。"],
  ["synonym:状态", "major", "状態是客观状态、情况；調子是运转状况、身体感觉或发挥状态，常带好坏和暂时性。"],
  ["synonym:食材", "major", "食料是食物、粮食或供给；食材是用于烹饪的原材料，不能替换粮食储备等用法。"],
  ["synonym:准确的", "major", "正確是正确、无误，强调结果符合事实；的確是确切、可靠、恰当，常修饰判断或措施，不能全换。"],
  ["synonym:绝对", "interchangeable", "絶対和絶対に都表达绝对、一定；后者是副词形式，区别主要在句法位置而非核心意义。"],
  ["synonym:对手", "major", "相手是对方、对象，也可指对手；ライバル明确是竞争对手，不能替换普通交往对象。"],
  ["synonym:他人", "major", "他人是别人、外人，日常使用；他者是他者、其他主体，偏书面和抽象，不能全换。"],
  ["synonym:同伴", "major", "仲間是伙伴、同一群体成员；連れ是同行者或带来的人；同伴是正式的陪同、同伴概念，句法和语体不同。"],
  ["synonym:皮肤", "major", "肌是日常的皮肤，也可指肌肤质感；皮膚是医学、正式的皮肤，不能替换美容和触感等全部用法。"],
  ["synonym:秘密的", "major", "秘密是秘密、不公开的事；ひそか是暗中、私下或悄悄进行的状态，常修饰行为，不能全换。"],
  ["synonym:物品", "major", "品可指物品、品质或品格；物品正式指物件、财物，不能替换品格和商品语境。"],
  ["synonym:不安的", "major", "不安是心里不安或担忧；不穏是局势不稳定、动荡或不平静，不能用于一般个人担心。"],
  ["synonym:平安", "major", "無事是平安、顺利地完成且没有事故；平安是安宁、平稳状态或历史时期，语体和搭配不同。"],
  ["synonym:组", "major", "組是编成的组、班或一套；班是小组、班次或轮班，组织方式和搭配不同。"],
  ["synonym:收件地址", "interchangeable", "宛先和送り先都可指邮件、包裹等的收件地址或收件人；送り先更强调寄送目的地。"],
  ["synonym:确实的", "major", "確か是可靠、确实或记忆中的大概；確実是确定无误、稳妥可保证，确定程度和用法不同。"],
  ["synonym:叶子", "interchangeable", "葉っぱ和葉都表示叶子；葉っぱ更口语具体，葉可用于植物学、书面和抽象的叶状物。"],
  ["synonym:仪式", "major", "式是仪式、式子或形式；儀式专指礼仪性典礼，不能替换数学式和形式等用法。"],
  ["synonym:无", "major", "無是无、没有的书面或概念名词；無し是没有、无某物的口语或固定表达，词性搭配不同。"],
  ["synonym:大门", "major", "門是门、门类或专业领域；ゲート特指入口闸门、检票口或通道，不能全换。"],
  ["synonym:男朋友", "interchangeable", "彼氏和ボーイフレンド都可指男朋友；彼氏是日常常用，ボーイフレンド更外来语、说明性或强调关系。"],
  ["synonym:～们", "major", "〜ら和達都可接人名表示们；〜ら较口语且可带轻微贬义，達较中性常用于亲近或熟悉的人群。"],
  ["synonym:故乡", "major", "ふるさと带有感情和故乡意象；故郷是中性、书面故乡；郷土强调地方乡土；郷里多指出身地，不能全换。"],
  ["synonym:家庭", "major", "家庭是家庭生活、家庭环境；世帯是共同生活并进行经济登记的户，统计和行政含义更强。"],
  ["synonym:单词", "major", "語是词、语言或词语的简略说法；単語明确指单词，不能替换语言、词尾等其他語的用法。"],
  ["synonym:文件", "major", "書類是纸质或正式文件、材料；ファイル是文件档案，也可指文件夹、计算机文件，范围更宽。"],
  ["synonym:新鲜的", "interchangeable", "新鮮和フレッシュ都可表示新鲜；フレッシュ更常用于商品宣传、人或感觉的清新，语体不同。"],
  ["synonym:若干", "major", "いくつか表示几个、若干个；若干是书面数量词，也可表示稍微，不能替换所有‘几个’场景。"],
  ["synonym:零钱", "major", "お釣り是付款后找回的零钱；小銭是小面额硬币、零钱本身，不能替换找零动作。"],
  ["synonym:气体", "major", "ガス是煤气、燃气或气体的日常称呼；気体是物质状态的科学、正式概念，范围不完全相同。"],
  ["synonym:可怜的", "major", "かわいそう是觉得对方可怜、令人同情；気の毒是遗憾、过意不去或同情，常带对受难者的礼貌语气。"],
  ["synonym:同班同学", "major", "クラスメート是同班同学；同級生是同年级同学，不一定同班，不能互换。"],
  ["synonym:刚才", "major", "さっき是刚才、较口语；たった今是就在刚刚；先ほど是礼貌、正式的刚才，时间距离和语体不同。"],
  ["synonym:压力", "major", "ストレス是心理或身体压力；プレッシャー是来自期待、责任的精神压力；圧力是物理压力或施压，不能全换。"],
  ["synonym:类型", "major", "タイプ是类型、型号或人的类型，也可指打字；類型是分类学、抽象的类型，偏书面，不能全换。"],
  ["synonym:一点也不", "interchangeable", "ちっとも和少しも都常与否定连用表示一点也不；ちっとも更口语，少しも较中性。"],
  ["synonym:尽量", "major", "なるべく是尽可能；努めて是尽力、特意努力地，含主动努力意味，不能完全替换。"],
  ["synonym:拼命的", "major", "一生懸命强调努力；懸命是竭尽全力的书面说法；必死可指拼命也可指必死状态；躍起是急于争取；命がけ是冒生命危险。"],
  ["synonym:液体", "major", "液是液体的简略、专业或固定用语；液体是完整的物质状态名称，日常独立使用更自然。"],
  ["synonym:音乐家", "interchangeable", "音楽家和ミュージシャン都可指音乐家；后者更现代、口语，常指流行音乐演奏或创作者。"],
  ["synonym:科学", "interchangeable", "科学和サイエンス都指科学；サイエンス更常用于标题、宣传或泛指科学领域，语体不同。"],
  ["synonym:火灾", "interchangeable", "火事和火災都指火灾；火事日常，火災正式或用于新闻、消防和行政语境。"],
  ["synonym:弄坏", "major", "壊す是弄坏、破坏；損ねる是损坏、错过或使状态变差，常用于机会、健康等抽象对象，不能全换。"],
  ["synonym:突然", "major", "急に是突然、急速地；突然是出乎意料地；いきなり是不经预告直接；ばっと是一下子迅速扩散或动作，不能全换。"],
  ["synonym:工资", "major", "給料是个人领取的工资、薪水；賃金是劳动报酬的正式、法律或统计概念，不能完全互换。"],
  ["synonym:观赏", "major", "見物是观看、游览或看热闹；観賞是欣赏艺术、自然等对象，主动欣赏意味更强。"],
  ["synonym:面积", "major", "広さ是广阔程度、大小，也可用于抽象范围；面積是几何或土地的面积，范围更具体正式。"],
  ["synonym:开头", "major", "始め是开始、开头或首次；冒頭专指文章、讲话、事件等的最前面，不能替换开始动作。"],
  ["synonym:收入", "major", "収入是收入、进账的正式总称；稼ぎ是赚到的钱或谋生所得，口语且更强调赚钱结果。"],
  ["synonym:集合", "major", "集合是集合、聚集，也可作数学概念；会合是人们约定碰面、集会，不能替换数学和聚集动作。"],
  ["synonym:交通工具", "major", "乗り物是乘坐的交通工具，也可指游乐设施；交通機関是交通系统、机构或公共交通工具的正式总称。"],
  ["synonym:亲近的", "interchangeable", "親しい和近しい都表示亲近、熟悉；近しい较书面，常描述关系相近，親しい日常更常用。"],
  ["synonym:婴儿", "major", "赤ちゃん是对婴儿的亲切日常称呼；乳児是医学、行政或年龄分类的正式词。"],
  ["synonym:选手", "major", "選手是参加竞技比赛的选手；プレーヤー也可指球员、演奏者、游戏玩家或设备播放器，范围更宽。"],
  ["synonym:大城市", "major", "大都会强调繁华、都市圈或大都市生活；大都市是人口规模和行政地理意义上的大城市，侧重点不同。"],
  ["synonym:熟人", "major", "知り合い是认识的人、熟人；知人是书面或正式的相识者，也可指知己、朋友，不能全换。"],
  ["synonym:停车", "major", "駐車是车辆停放；停車是车辆停止、停车站停靠或列车停车，不能替换所有停车场景。"],
  ["synonym:超过", "major", "超える是超过界限、数量或时间；追い越す是追上并超过前方对象；上回る是数值超过；超す是超过的书面或固定形式，不能全换。"],
  ["synonym:抓住", "major", "捕まえる是抓住、逮捕；つかむ是用手抓住或掌握要点；捕らえる是捕获或准确把握，视对象和语体不同。"],
  ["synonym:眼前", "major", "目の前是空间上就在眼前；目前是就在面前或当前；寸前是临近某时刻；目先是眼前利益或短期，不能全换。"],
  ["synonym:深夜", "interchangeable", "夜中和深夜都可指深夜、半夜；深夜更正式且常指深夜时段，夜中更日常。"],
  ["synonym:收费", "major", "有料是收费的、有偿的；チャージ是收取费用、充值或充电，动作和对象不同。"],
  ["synonym:样子", "major", "様子是样子、情况或动静；振り是装作、姿态或外表行为；ありよう是应有状态、存在方式，不能全换。"],
  ["synonym:印象", "interchangeable", "イメージ和印象都可表示印象、形象；イメージ还可指想象、图像或品牌形象，范围更宽。"],
  ["synonym:客厅", "major", "居間是家庭客厅；リビング是现代住宅的客厅、起居室；客室是客房或接待室，不能替换。"],
  ["synonym:下坡", "major", "下り是下行、下坡或下段；下り坂明确是下坡路，也可引申衰退，不能替换所有下行用法。"],
  ["synonym:偷懒", "major", "サボる是逃课、旷工或故意偷懒，常带不履行义务；怠ける是懒散、不努力，范围更广。"],
  ["synonym:布料", "major", "布是布料或布块；生地是布料，也可指面团、底子；布地专指织物布料，不能全换。"],
  ["synonym:不由得", "major", "つい是无意中、顺手做了某事；思わず是因情绪或反射而不由得做出，语境侧重不同。"],
  ["synonym:举起", "major", "挙げる是举起、列举或提高；持ち上げる是抬起也可奉承；掲げる是高举旗帜、提出目标；挙がる是被举起或列出，视点和对象不同。"],
  ["synonym:连接", "major", "結ぶ是连接、系结或缔结；つなぐ是接上、连通或维持联系，搭配和动作方式不同。"],
  ["synonym:严密的", "major", "厳重是严加防范、严格处理；厳密是精确、严谨，常用于定义、分析和条件，不能互换。"],
  ["synonym:慌张", "major", "慌てる是慌忙、急着行动；うろたえる是因意外而惊惶失措、没有主意，心理状态更强。"],
  ["synonym:库存", "interchangeable", "在庫和ストック都可表示库存；ストック更口语且也可指储备、备用物，范围更宽。"],
  ["synonym:暂时", "major", "暫く是暂时、一会儿或一段时间；いったん是先暂时做某动作再说；当分是目前一段时间，不能全换。"],
  ["synonym:就业", "major", "就職是获得职位、就职；就業是从事工作或就业状态；就労偏法律、制度用语，不能全换。"],
  ["synonym:设计", "major", "設計是按规格规划、设计；デザイン偏外观、创意设计；考案是构思、发明方案，不能全换。"],
  ["synonym:朴素的", "major", "地味是朴素、不显眼，有时带不起眼的负面感；素朴是质朴、单纯、不矫饰，语感不同。"],
  ["synonym:立刻", "major", "すぐ和すぐに是马上、很快；たちまちは转眼间发生的结果；すかさず是抓住时机立即行动，不能全换。"],
  ["synonym:老人", "major", "年寄り是日常或略随意的老人称呼；老人是正式、客观的老年人，语体和礼貌程度不同。"],
  ["synonym:年长", "major", "年上是比自己年长；年配是上年纪或中老年；年長是年龄较长的正式说法，参照关系不同。"],
  ["synonym:表现", "major", "表現是表达、表现形式；パフォーマンス是演出、表演或表现成绩，也可有作秀意味，不能全换。"],
  ["synonym:赚钱", "major", "稼ぐ是主动赚取钱、时间或分数；もうかる是获得利润、赚钱的状态，主语和句法不同。"],
  ["synonym:出身", "major", "出身是出生地、出身背景；出自是出自某地、家庭或出处，偏书面且不能替换所有经历背景。"],
  ["synonym:宣传", "major", "宣伝是宣传、推广产品或主张；広報是机构对外发布信息、公共关系，目的和主体不同。"],
  ["synonym:果然", "interchangeable", "やっぱり、やはり和案の定都可表示果然；前两者还可表示还是，案の定专指预料中的结果且偏书面。"],
  ["synonym:这样", "major", "こう是这样、如此的指示词；こうして是这样做、如此一来，强调方式或由此产生的结果。"],
  ["synonym:不久", "major", "間もなく是很快、不久即将发生；やがて是过了一段时间后终于；近々是最近、近日，时间视点不同。"],
  ["synonym:再次", "interchangeable", "もう一度、再び和再度都可表示再次；もう一度日常，再び和再度更书面，后两者常用于正式叙述。"],
  ["synonym:如果", "major", "もし是如果、假如的条件副词；もしかして是会不会、莫非，表示对可能性的试探，不是普通条件连接。"],
  ["synonym:有效", "major", "効く是药、措施等有效或起作用；利く是发挥功能、灵敏或能胜任，汉字不同对应的对象不同。"],
  ["synonym:或许", "interchangeable", "もしかしたら和もしかすると都表示或许、说不定；前者更常用，后者略郑重，意义基本相同。"],
  ["synonym:暂且", "interchangeable", "取り敢えず和ひとまず都表示先暂且；取り敢えず更强调先做眼前处理，ひとまず带阶段性收束感。"],
  ["synonym:时髦的", "major", "おしゃれ是时尚、会打扮；スマート是利落、时髦，也可表示聪明或身材苗条，不能全换。"],
  ["synonym:目录", "major", "カタログ是商品、资料的目录册；目次是书、文章、节目等的章节目录，不能全换。"],
  ["synonym:摄影师", "major", "カメラマン是使用相机工作的摄影者，也可泛指摄影工作人员；写真家强调以摄影创作为职业、艺术家的摄影师。"],
  ["synonym:图表", "major", "グラフ偏数据图、曲线图；図是图、图示或地图；図表是图和表的正式总称；図式是结构图、示意图，不能全换。"],
  ["synonym:路线", "major", "コース是路线、课程或比赛赛道；道順是行走路线；ルート是路线、途径；道筋还可指思路和发展脉络。"],
  ["synonym:终点", "major", "ゴール是比赛终点或要达成的目标；終点是线路、过程的终点，不能替换抽象目标等用法。"],
  ["synonym:马上", "interchangeable", "早速和すぐさま都表示立即、马上；早速可表示马上开始，すぐさま更强调毫不延迟，语体较书面。"],
  ["synonym:样品", "major", "サンプル是样品、范例或数据样本；見本是展示用样品或模范，不能替换统计样本等用法。"],
  ["synonym:速度", "interchangeable", "スピード和速度都可表示速度；スピード更口语，也可指处理快慢或节奏，速度更正式客观。"],
  ["synonym:好不容易", "major", "せっかく强调难得、特意却可能被浪费；辛くも是勉强、险些失败后才做到，不能全换。"],
  ["synonym:主题", "major", "テーマ是主题、议题或创作题材；件名是邮件、文件标题；主題是主旨；モチーフ是反复出现的创作母题，不能全换。"],
  ["synonym:总之", "major", "とにかく是总之、反正，先不论细节；ともかく是暂且不说某项；要するに是把内容归纳为简言之，功能不同。"],
  ["synonym:小册子", "major", "パンフレット是宣传、介绍用册子；冊子是装订成册的小册子或册本，未必具有宣传目的。"],
  ["synonym:仿佛", "major", "まるで常与ようだ等搭配表示仿佛，也可表示完全；あたかも是书面、强调恰如其分的仿佛，不能全换。"],
  ["synonym:成员", "major", "メンバー是团队成员，也可泛指参加者；部員是某社团、部门成员；成員是组织成员的正式书面说法。"],
  ["synonym:包围", "interchangeable", "囲む和取り囲む都表示包围；取り囲む更强调从四周完全围住，囲む也可表示围坐、围绕。"],
  ["synonym:隐藏", "major", "隠す是把东西藏起来或掩饰；秘める是把感情、意图等藏在心里，偏抽象和书面。"],
  ["synonym:价值", "major", "価値是价值；かい是值得、意义或效用的口语表达；値打ちは价值、身价或值得程度，不能全换。"],
  ["synonym:科目", "major", "科目是课程科目或分类项目；教科是学校教学科目、学科，范围和教育制度搭配不同。"],
  ["synonym:解开", "major", "解く是主动解开、解答或解除；解ける是自动解开、融化；ほどける是结、缠绕松开；ほぐす、ほぐれる还可指肌肉和紧张放松。"],
  ["synonym:怀念的", "major", "懐かしい是对过去、故地或旧物的怀念；恋しい是想念远方的人或事物、渴望重逢，方向不同。"],
  ["synonym:各国", "interchangeable", "各国和国々都可表示各国；各国更正式概括，国々带有逐个国家、众多国家的语感。"],
  ["synonym:比例", "major", "割合是比例、比率或占比；割り是份额、折扣或分配比例；比例是数学比例或相称；レート是比率、汇率或速度，不能全换。"],
  ["synonym:完结", "major", "完了是工作、手续等完成；完結是故事、连载或过程完整结束，不能替换所有完成动作。"],
  ["synonym:空隙", "major", "間是空间间隔、时间间隙或空档；隙是缝隙、空当或破绽，常指可被利用的漏洞。"],
  ["synonym:关心", "major", "関心是对某事有兴趣、关注；心遣い是为他人着想、照料和关怀，主体心理方向不同。"],
  ["synonym:根基", "major", "基礎是基础、基本知识；基盤是支撑系统、事业或发展的基础平台，抽象范围和搭配不同。"],
  ["synonym:基本", "major", "基本是基本、基础原则；ベース是基础、底座或作为基准的水平，也可表示化妆底，不能全换。"],
  ["synonym:凝固", "major", "固まる是凝固、固定或决定下来；凝り固まる强调完全凝结，也可指思想僵化、固执，语气更强。"],
  ["synonym:彼此", "major", "互い是互相、彼此；同士表示同类或同身份之间，常接名词，不能替换所有相互动作。"],
  ["synonym:讲述", "major", "語る是讲述经历、思想或故事；物語る是讲述，也可从事实显示、说明某种情况，书面色彩更强。"],
  ["synonym:信号", "major", "合図是约定的暗号、手势或行动信号；シグナル是信号、讯号或引申迹象，范围更技术化。"],
  ["synonym:指定", "major", "指定是指定、指名；所定是预定、规定的，常指规定的时间、位置或程序，不是主动指定动作。"],
  ["synonym:果实", "major", "実是果实、种子或内容成果；木の実特指树上果实、坚果；果実是正式的果实或成果概念。"],
  ["synonym:草坪", "major", "芝生是草坪、铺草的地面；芝是草、草皮或某种草本，范围更宽，不能完全替换草坪。"],
  ["synonym:煮", "major", "煮る是用汤汁煮、炖食物；ゆでる是放在沸水中煮熟，通常不强调汤汁，烹调方法不同。"],
  ["synonym:车内", "interchangeable", "車内和車中都可表示车内；車内更常用于交通设施和广播，車中较书面或描述乘车状态。"],
  ["synonym:主要的", "major", "主要是主要、核心的正式词；主是主要、以某人为中心或主导，词性和搭配更灵活，不能全换。"],
  ["synonym:更换", "major", "取り替える是替换成别的东西；換える还可表示兑换、转换或换位置，范围更宽。"],
  ["synonym:顺序", "major", "順番是轮到的次序；オーダー是顺序、命令或点单；順序是次序流程；順是顺序或顺从；序列偏书面排列，不能全换。"],
  ["synonym:消极的", "major", "消極的是不主动、采取保守态度；ネガティブ是负面、悲观或否定，范围更宽且语气不同。"],
  ["synonym:折叠", "major", "畳む是折叠、收起或关闭店铺；折り畳む专指折叠成较小形状，不能替换收店等引申义。"],
  ["synonym:挥动", "major", "振る是挥动、摇动、撒或辞退；振るう是挥舞、施展能力或行使权力，词义和搭配不同。"],
  ["synonym:生物", "major", "生き物是有生命的生物，日常且具体；生物是生物学分类或正式概念，也可指生物学学科。"],
  ["synonym:可恨的", "major", "憎らしい是讨厌得让人恼火，也可带反语可爱；憎い是憎恨、可恶，感情色彩更直接强烈。"],
  ["synonym:追赶", "major", "追う是追赶、追求目标或追究；追いかける是实际跟在后面追，动作画面更具体。"],
  ["synonym:适当的", "major", "適当是合适、适度，也可表示敷衍随便；適正是符合标准、合理适当的正式词，不能替换随便等义。"],
  ["synonym:铁路", "major", "鉄道是铁路系统、铁路交通；線路是轨道线路，也可指电路、线路，范围和对象不同。"],
  ["synonym:分数", "major", "点数是得分、分数；得点强调获得的分数或得分动作；スコア还可指比分、成绩记录，不能全换。"],
  ["synonym:爬山", "interchangeable", "登山和山登り都表示登山、爬山；登山较正式、运动名词，山登り更日常描述活动。"],
  ["synonym:动作", "major", "動作是动作、操作或机械动作；仕草是人的姿势、小动作或举止，不能替换设备动作。"],
  ["synonym:日程", "major", "日程是按日期安排的日程；スケジュール是日程、计划表和进度，范围更宽。"],
  ["synonym:年龄", "major", "年齢是年龄的正式中性说法；齢是年纪、年龄的书面或古雅用语，不能用于所有日常问年龄。"],
  ["synonym:波浪", "major", "波是波浪，也可指波动、潮流；うねり是起伏翻涌的波，也可表示趋势波动，动态感更强。"],
  ["synonym:田地", "major", "畑是旱田、菜地；田んぼ是水田、稻田；田畑是旱田和水田的总称，不能全换。"],
  ["synonym:部分", "major", "部分是整体中的部分；部位是身体、结构或物体的特定位置、部位，不能替换一般部分。"],
  ["synonym:平等的", "major", "平等是无差别、平等的原则；対等是双方地位、力量或条件相等，适用关系不同。"],
  ["synonym:抱住", "major", "抱く是抱住、怀抱，也可表示心怀；抱え込む是把东西抱在怀里或独自承担问题，负担意味更强。"],
  ["synonym:本人", "major", "本人是本人、当事者的正式中性词；当人是该人、当事人，常用于与旁人对比，语体和指称视角不同。"],
  ["synonym:许可", "major", "免許是资格执照或官方许可资格；許可是允许某项行为的许可，不能替换驾照等资格证。"],
  ["synonym:目标", "major", "目標是要达到的目标、指标；狙い是瞄准目标或意图；目当て是目的、奔头；ターゲット是目标对象；めど是预期头绪或期限，不能全换。"],
  ["synonym:道理", "major", "訳是缘故、道理，也可表示翻译；理屈是理论、借口或道理；論理是逻辑；道理是常识道理，不能全换。"],
  ["synonym:理科", "major", "理科是学校课程中的理科；理系是理科、工科等理工科方向或理科系学生，范围更宽。"],
  ["synonym:放开", "major", "離す是使距离拉开、分开或放开手；放す是释放、放走或松手，动作结果不同。"],
  ["synonym:分量", "major", "量是数量、分量或容量；分量专指份量、重量或分配份额；重み是重量也可指分量、影响力，不能全换。"],
  ["synonym:性质", "major", "性是性质、性别或倾向的简略词；性質是事物本性、性质的正式完整词，范围和搭配不同。"],
  ["synonym:～本", "major", "〜通通常用于信件、文件等一套或若干通；〜帳用于本子、账簿；两者不是普遍的书本量词。"],
  ["synonym:暗示", "major", "ヒント是提示、线索或启发；示唆是暗示、启示某种可能，偏书面，不能替换具体提示物。"],
  ["synonym:报名", "major", "応募是报名应征、申请参加；エントリー是登记报名、参赛或求职初步注册，使用场景不同。"],
  ["synonym:画家", "major", "画家是画画为职业的画家；絵描き是画画的人或画师的日常称呼，较口语且不一定强调职业。"],
  ["synonym:解决", "major", "解決是解决问题；決着是事情得到结论、了结或分出胜负，不能替换解决具体问题。"],
  ["synonym:积攒", "major", "たまる是不及物的积存、积累；ためる是主动积攒、积压；積み立てる是按期积存资金等，句法和对象不同。"],
  ["synonym:室内", "interchangeable", "室内和屋内都表示室内、建筑内部；室内更泛，屋内常与屋外成对，语体略正式。"],
  ["synonym:年轻人", "major", "若者是年轻人、青年，范围较宽；若手是年轻一代或年轻新秀，常用于职场、体育和艺术领域。"],
  ["synonym:限制", "major", "制限是限制、限额或自我节制；規制是通过规则、法律进行管制，制度性更强。"],
  ["synonym:专家", "interchangeable", "専門家和エキスパート都可指专家；エキスパート更强调某领域的熟练行家，専門家正式中性。"],
  ["synonym:提前", "major", "早める是主动提前；早まる是时间提前也可表示轻率；繰り上げる是把日期、顺序或款项提前，不能全换。"],
  ["synonym:捆绑", "major", "縛る是捆绑、束缚或限制；縛り付ける强调牢牢绑在某处；くくる是捆扎、归纳，动作和引申义不同。"],
  ["synonym:服装", "major", "服装是穿着、服饰的正式总称；衣装常指特定场合、表演或戏剧服装；なりふり是外表装束和仪态，不能全换。"],
  ["synonym:故事", "interchangeable", "物語和ストーリー都可表示故事、情节；物語更有叙事或文学色彩，ストーリー也常指剧情结构。"],
  ["synonym:泡沫", "major", "泡是水、液体产生的泡；バブル是泡沫经济、泡沫状物或流行泡沫，不能替换普通泡沫的全部用法。"],
  ["synonym:西式", "major", "洋式是西式的样式、结构；洋可指西洋、外国或西式；洋風强调外观风格像西式，不能全换。"],
  ["synonym:碎片", "major", "切れ是切下的一片、碎片或切口；破片是破碎后的片；細切れ是细碎的小块、零散片段，形态侧重不同。"],
  ["synonym:一下子", "major", "どっと是人群、情绪等哗地一涌而出；ぱっと是动作、光线等一下子迅速发生，不能全换。"],
  ["synonym:塞入", "major", "詰める是填满、塞入或缩短间隔；押し込む是用力推进、挤进，常强调外力和狭窄空间。"],
  ["synonym:浮起", "major", "浮く是浮在表面、变得悬空或显得突出；浮かぶ是浮现、浮上水面或想法出现，视对象和自动词搭配不同。"],
  ["synonym:训练", "interchangeable", "訓練和トレーニング都可表示训练；訓練更正式、强调技能和应对能力，トレーニング也常指健身锻炼。"],
  ["synonym:印章", "major", "判子是日常的印章、图章；判是印章的简略或判定、印记，不能替换所有盖章表达。"],
  ["synonym:所有的", "interchangeable", "あらゆる和ありとあらゆる都表示所有、一切；后者是加强语气的固定表达，强调毫无遗漏。"],
  ["synonym:徒步", "major", "ハイキング是以休闲、观光为目的的远足；徒歩是步行这一方式或距离，不能替换徒步旅行活动。"],
  ["synonym:援助", "major", "応援是支持、助威或声援；援助是实际提供帮助、资源或支援，不能替换体育助威等用法。"],
  ["synonym:醒来", "major", "覚める是从睡眠、梦或醉酒状态醒来；目覚める是醒来，也可指意识、兴趣或能力觉醒，范围更宽。"],
  ["synonym:机构", "major", "機関是机构、机关，也可指器官、交通机关；機構是组织结构、机制或机构本身，抽象结构意味更强。"],
  ["synonym:渔民", "major", "漁師是以捕鱼为职业的渔夫；漁民是渔业从业者这一群体或正式分类，范围和语体不同。"],
  ["synonym:缺点", "major", "欠点是人的缺点或事物不足；欠陥是产品、系统等的缺陷、故障，客观严重性更强。"],
  ["synonym:姿势", "major", "姿勢是身体姿势、态度或姿态；構え是摆出的架势、准备姿势或防备态势，不能全换。"],
  ["synonym:生长", "major", "生える是植物、毛发等长出、生长；生まれ育つ是出生并成长，主语和过程不同。"],
  ["synonym:点燃", "major", "点ける是点燃、打开灯或开启设备；燃やす是使燃烧，也可激发感情、焚烧，不能全换。"],
  ["synonym:配送", "major", "配達是把邮件、包裹送到收件人处；配送是物流中的分发、配送过程，范围和主体不同。"],
  ["synonym:本来", "major", "本来是原本、按本质应该；もとより是本来就、从一开始，也可表示更不用说，书面色彩更强。"],
  ["synonym:容器", "interchangeable", "容器和入れ物都可指容器；容器正式、抽象，入れ物更日常且强调装东西的器具。"],
  ["synonym:开朗的", "major", "陽気是性格开朗，也可指天气明朗或气氛热闹；朗らか主要描述人爽朗、明快，不能全换。"],
  ["synonym:系列", "major", "系是体系、系统或系列的书面词；シリーズ是连续作品、商品或节目系列，使用范围和语感不同。"],
  ["synonym:标题", "major", "タイトル是作品、文章、节目等标题；見出し是文章的小标题、版面标题或引导语，不能全换。"],
  ["synonym:多么", "major", "なんと表示多么、竟然并带感叹或惊讶；どれほど是达到什么程度、多少，疑问和感叹功能不同。"],
  ["synonym:何况", "major", "まして是何况、况且的连接副词；いわんや是更书面的‘何况’，常用于固定的递进论证，不能在所有口语替换。"],
  ["synonym:领导", "major", "リーダー是领导者、带队者；リード是领先、引领或带领这一动作，不能替换具体领导人。"],
  ["synonym:后半段", "major", "後半是后半部分；終盤是接近结尾的末段，强调临近结束，不能替换整个后半段。"],
  ["synonym:再三", "interchangeable", "重ねて和再三都可表示再三、反复；重ねて常用于正式再次请求，较强调重复做同一动作。"],
  ["synonym:进展", "major", "進み是进度、前进状态；進展是事情向前发展，偏正式且常用于计划、研究和谈判，不能全换。"],
  ["synonym:跳跃", "major", "跳ぶ是跳跃、飞越或跳起来；躍る是跳动、舞动或心情激动，不能替换实际跳跃动作。"],
  ["synonym:意气", "major", "意地是意气、固执或脾气；意気是气势、志气和精神状态，不能按汉字相近替换。"],
  ["synonym:开店", "major", "開店是开始营业、开店；出店是开设分店、出摊或参展设店，动作范围不同。"],
  ["synonym:行为", "major", "行い是行为、品行，常带道德评价；行為是行为、法律或客观举动的正式词，不能全换。"],
  ["synonym:身边的", "major", "身近是身边、亲近且容易接触；手近是手边、容易取得或处理，不能替换关系亲近。"],
  ["synonym:搭配", "major", "合わせ是组合、配合或调和；組み合わせ是具体组合方式；コーディネート是服饰、色彩或整体搭配，不能全换。"],
  ["synonym:主人", "major", "ホスト是招待客人的主人、主持人或主机；主是所有者、主人或主要人物，指称和语体不同。"],
  ["synonym:察觉", "major", "察し是察觉力、推测或体谅；察知是察觉到信息、情况；感知是感知、感觉到，不能全换。"],
  ["synonym:入学考试", "interchangeable", "入試和入学試験都指入学考试；入試是日常和正式场合都常用的缩略，核心意义相同。"],
  ["synonym:非常", "major", "いとも是非常、极其的书面副词；誠に是确实、非常郑重；何とも是无论如何或非常难以形容，不能全换。"],
  ["synonym:艺术家", "major", "芸術家是从事艺术创作的艺术家；アーティスト还可指流行艺人、歌手或表演者，范围更宽。"],
  ["synonym:说法", "major", "言い方是表达方式、措辞；説是学说、说法或主张；物言い是说话方式也可指异议，不能全换。"],
  ["synonym:积极的", "major", "積極的是主动、积极参与；前向き是面向未来、乐观地考虑，不能替换主动性等所有语境。"],
  ["synonym:急事", "major", "急ぎ是急着处理、急事或赶忙；急用是紧急需要使用的钱、物品或事情，使用对象不同。"],
  ["synonym:首位", "major", "一位是第一名、首位；トップ是顶端、最高位、领头人或顶部，范围更宽。"],
  ["synonym:搅拌", "major", "かき混ぜる是把内容物搅拌均匀；かき回す是搅动、搅乱，也可指扰乱局面，不能全换。"],
  ["synonym:山村", "major", "山村是山地村落的正式称呼；山里是山中、山区乡村的日常或带景物感说法，范围略宽。"],
  ["synonym:神", "major", "神是神、神明的通称；神様是礼貌、敬畏或故事中的神明称呼，不能忽略语气和使用对象。"],
  ["synonym:任性的", "major", "わがまま是只顾自己要求；勝手是任意、擅自也可表示方便；気まま是随心所欲；気まぐれ是反复无常；身勝手强调自私，不能全换。"],
  ["synonym:空间", "major", "空間是空间、空间范围；スペース还可指空位、篇幅、场地或计算机空间，不能全换。"],
  ["synonym:工作人员", "major", "係員是负责某岗位、窗口的工作人员；スタッフ是团队工作人员、职员总称，范围更宽。"],
  ["synonym:用语", "major", "言葉遣い是说话用词、措辞方式；用語是某领域的术语、用语本身，不能替换表达礼貌等用法。"],
  ["synonym:至少", "major", "少なくとも是数量、程度上的至少；せめて是退一步的最低希望、哪怕，含愿望和妥协语气。"],
  ["synonym:世间", "interchangeable", "世の中和世間都可表示社会、世间；世の中较中性地指社会世界，世間还可指周围人的舆论和社会眼光。"],
  ["synonym:传说", "major", "昔話是民间流传的故事；伝説是传说、传奇或历史传承；言い伝え是口头传下来的说法，不能全换。"],
  ["synonym:托付", "major", "任せる是把事情交给对方或任其处理；託す是郑重地托付、寄托愿望或遗志，书面和情感更强。"],
  ["synonym:离开", "major", "離れる是离开、相距或脱离关系；去る是离去、过去或离开某时期；立ち去る强调起身离开现场。"],
  ["synonym:大约", "interchangeable", "およそ和おおよそ都表示大约、大致；およそ也可表示大体、根本不，语体较书面。"],
  ["synonym:契机", "major", "きっかけ是引发事情的契机、机会，日常常用；契機是正式书面的契机、转折因素。"],
  ["synonym:节奏", "major", "テンポ是速度、进展快慢或音乐节拍速度；リズム是规律节拍、节奏感，不能全换。"],
  ["synonym:网络", "major", "ネット是网络、互联网，也可指网状物或网络简写；ネットワーク是网络系统、关系网或连接结构，范围和正式度不同。"],
  ["synonym:壶", "major", "ポット是壶、热水壶或保温壶；つぼ是罐、穴位或要点，物品形状和引申义完全不同。"],
  ["synonym:媒体", "interchangeable", "メディア和媒体都可表示媒体、媒介；メディア更常用于大众传媒和数字媒体，媒体偏正式书面。"],
  ["synonym:模型", "major", "モデル是模型、模特、范例或型号；模型是实体模型、模具或模型概念，不能全换。"],
  ["synonym:灯", "major", "ライト是灯、照明，也可表示轻、右侧等；ランプ是灯具、信号灯或台灯，不能全换。"],
  ["synonym:稳定的", "major", "安定是稳定、不变或安定状态；コンスタント是持续、稳定地保持一定水平，常描述频率和产出。"],
  ["synonym:到底", "interchangeable", "一体和一体全体都表示到底、究竟；后一形式加强疑问或不满语气，核心功能相同。"],
  ["synonym:记号", "major", "印是印记、标志或象征；目印是用来辨认的标记、地标；記号是符号、记号的正式总称，不能全换。"],
  ["synonym:阴影", "major", "陰是阴影、背后或阴暗面；陰影是光影和阴影的正式词，也可指影响、阴暗因素，范围不同。"],
  ["synonym:角度", "major", "角度是几何角度，也可指立场；アングル是拍摄角度、视角或切入点，不能替换数学角度等用法。"],
  ["synonym:设备", "major", "機器是机器、器械、设备本体；設備是建筑、工厂等配备的设施和装置总称，范围不同。"],
  ["synonym:记者", "major", "記者是新闻记者、撰稿记者；レポーター是现场报道员、采访者，也可指报告人，不能全换。"],
  ["synonym:打瞌睡", "interchangeable", "居眠り和うとうと都表示打瞌睡；居眠り是实际睡着，うとうと强调迷迷糊糊的状态和过程。"],
  ["synonym:巨大的", "major", "巨大是体积、规模巨大；莫大是数量、恩惠、损失等极大；多大是程度很大；甚大是影响、损害等非常大，不能全换。"],
  ["synonym:形式", "major", "形式是形式、格式或外在方式；フォーム是表格、姿势或固定样式，不能替换抽象形式和仪式形式。"],
  ["synonym:俯视", "major", "見下ろす是从高处向下看，也可轻视；見下す专指蔑视、小看，不能替换普通俯视。"],
  ["synonym:限度", "major", "限り是限度、范围，也可表示只要、尽可能；限度专指界限、上限，不能替换条件和时间用法。"],
  ["synonym:效率", "major", "効率是投入产出比、效率；能率是工作、生产的办事速度和效率，使用领域侧重不同。"],
  ["synonym:好恶", "major", "好き嫌い是喜欢和讨厌、挑食等日常表达；好悪是好恶、爱憎的书面概念，不能全换。"],
  ["synonym:幸运的", "major", "幸い是幸运、幸亏，也可作副词表示幸好；幸運是幸运这一状态或运气，不能替换幸亏句式。"],
  ["synonym:项目", "major", "項目是清单、表格、章节的项目或条目；事項是应处理的事项、事实或规定事项，不能全换。"],
  ["synonym:装入", "major", "込める是装入、注入，也可倾注感情；積み込む是把货物、行李装上车或堆进去，不能全换。"],
  ["synonym:作者", "major", "作者是作品的创作者；著者特指书籍、论文等著作的作者，范围更窄且更正式。"],
  ["synonym:种子", "major", "種是种子，也可指种类、原因和根源；種子是种子的正式、生物学称呼，不能替换种类等义。"],
  ["synonym:学费", "interchangeable", "授業料和学費都可表示学费；授業料强调课程、授课费用，学費可泛指求学所需费用。"],
  ["synonym:集会", "major", "集まり是聚集的人群或集合；集会是有目的、有组织的集会活动，正式性更强。"],
  ["synonym:居民", "major", "住民是某地居民的正式、中性称呼；住人是住在某处的人，日常且强调居住者，不能全换。"],
  ["synonym:顺利的", "major", "順調是进展顺利；スムーズ是动作、流程流畅；円滑是关系、协商等圆满顺畅；好調是状态、业绩良好，不能全换。"],
  ["synonym:买卖", "major", "商売是做生意、商业活动；売買是买卖交易这一行为，正式且不能替换生意、谋生等用法。"],
  ["synonym:职业", "major", "職業是职业、行业；職是职位、职务或职业的简略词，不能替换所有职业名称和职位场景。"],
  ["synonym:正式的", "major", "正式是正式、官方认可或正规；本格的是正宗、真正进入状态或正式开展，不能替换所有正式场合。"],
  ["synonym:争夺", "major", "争う是争夺也可争论、竞争；取り合う是互相争抢某物，也可表示在意、理睬，不能全换。"],
  ["synonym:杂音", "interchangeable", "騒音和ノイズ都可表示噪声、杂音；騒音偏环境噪声和正式分类，ノイズ也可指电子、数据中的干扰。"],
  ["synonym:短期", "major", "短期是短期、短时间的整体概念；短期間强调持续时间较短的一段期间，不能替换所有短期计划等搭配。"],
  ["synonym:长处", "major", "長所是优点、长处；強み是竞争优势、强项；利点是有利之处、好处，不能全换。"],
  ["synonym:通信", "major", "通信是通信、信息往来或通讯系统；交信是双方通过无线、电信等交换联络，使用更专业。"],
  ["synonym:有利的", "major", "得是划算、有利或值得；有利是对某方有利、优势的正式说法，搭配对象不同。"],
  ["synonym:独特的", "interchangeable", "独特和ユニーク都可表示独特；ユニーク还带有有趣、奇特、与众不同的语感。"],
  ["synonym:能力", "major", "能力是能力、技能或可能性；力量是力量、实力或本领，不能替换抽象资格和体力等所有用法。"],
  ["synonym:演员", "major", "俳優是戏剧、影视演员的正式称呼；タレント是艺人、电视名人；役者是演员，也可比喻善于演戏的人，不能全换。"],
  ["synonym:背负", "major", "背負う是背着、承担责任；しょい込む是把麻烦、责任等全揽到自己身上，口语且带负担感。"],
  ["synonym:销路", "major", "売れ行き是商品卖得如何、销售情况；販路是销售渠道、市场路线，不能替换销量表现。"],
  ["synonym:拔出", "major", "抜く是拔出、去掉或省略；引き抜く是从中拔出或挖走人才，动作和引申义不同。"],
  ["synonym:舞台", "major", "舞台是舞台、场面或活动背景；ステージ是舞台、阶段或等级，外来语引申范围更宽。"],
  ["synonym:风景", "major", "風景是风景、景色；風物是某地具有代表性的自然、人文风物和景致，范围更综合书面。"],
  ["synonym:保存", "major", "保存是保存、保管；セーブ是保存数据、节省或守住，不能替换食物和资料的正式保存。"],
  ["synonym:黄昏", "major", "暮れ是日暮、年末或结束时；夕暮れ专指傍晚日落时分，不能替换年末等用法。"],
  ["synonym:魅力", "major", "魅力是吸引力、魅力；色気是性感、女人味或暧昧吸引力，语义范围更窄且带性别色彩。"],
  ["synonym:名人", "major", "名人是某领域高手、名家；有名人是有名的人、名人，通常强调知名度而非技艺。"],
  ["synonym:明显的", "major", "明らか是清楚、明显或显然；明白是明确易懂；歴然是事实清楚可见；あからさま是露骨、不加掩饰，不能全换。"],
  ["synonym:显眼", "major", "目立つ是突出、引人注意；映える是映衬得好看、在画面中显得亮眼，不能替换单纯引人注意。"],
  ["synonym:任务", "major", "役割是角色、作用或分工；任務是被赋予的任务、职责，正式且责任性更强。"],
  ["synonym:要求", "major", "要求是要求、需要或提出条件；要望是希望得到的请求、愿望，强制性通常较弱。"],
  ["synonym:立场", "major", "立場是立场、处境或所处位置；スタンス是态度、姿态或对问题的立场，外来语语感更主动。"],
  ["synonym:例外", "major", "例外是规则之外的例外；異例是罕见、非同寻常的事例，不一定是规则例外。"],
  ["synonym:论点", "major", "論是论、主张或理论的简略词；論点是争论焦点；論旨是文章论旨、主旨，不能全换。"],
  ["synonym:话题", "major", "話題是谈话话题；トピック是话题、主题或专题，常用于媒体、会议和标题，语体范围不同。"],
  ["synonym:干劲", "major", "やる気是想做事的干劲、动力；意気込み是开始前的热情、决心和气势，不能替换长期动力。"],
  ["synonym:图章", "major", "印鑑是用于登记、证明的正式印章；スタンプ是盖章、印花或橡皮图章，法律正式性不同。"],
  ["synonym:规模", "major", "規模是规模、范围和大小；スケール是规模、尺度或比例尺，也可表示气势，不能全换。"],
  ["synonym:个性", "major", "個性是个人独特性格、特征；キャラクター是人物角色、人物形象或个性，也可指角色本身，范围更宽。"],
  ["synonym:公平的", "major", "公平是公平、公正的原则；フェア是公平、不偏袒，也可指展览会或 fair 的外来语用法。"],
  ["synonym:最低限度", "interchangeable", "最小限和最低限都可表示最低限度；最小限偏最少量，最低限偏底线要求，实际多可互换但侧重点不同。"],
  ["synonym:视野", "major", "視野是视野、眼界或考虑范围；視界是眼睛实际能看到的范围，不能替换知识眼界。"],
  ["synonym:重视", "interchangeable", "重視和重要視都表示重视；重要視是把某事视为重要的正式说法，核心意义相同。"],
  ["synonym:依次", "major", "順に是按顺序地；順々是一个接一个、逐步地，常带过程推进感，不能全换。"],
  ["synonym:上半身", "interchangeable", "上半身和上体都可表示上半身；上半身日常和正式都常用，上体更简洁书面或医学。"],
  ["synonym:生活方式", "interchangeable", "生き方和ライフスタイル都可表示生活方式；生き方更强调人生选择和活法，ライフスタイル偏生活模式。"],
  ["synonym:山顶", "major", "頂上是顶端、山顶或最高点；頂是顶端、山顶的书面词；山頂明确指山的最高处，不能全换。"],
  ["synonym:阳光", "major", "日差し是照射过来的阳光、日晒感；日光是太阳光或日光的正式词；陽光是书面、明亮的阳光，语体不同。"],
  ["synonym:发型", "interchangeable", "髪型和ヘアスタイル都表示发型；后者更时尚、商品化，核心指称相同。"],
  ["synonym:跳起", "major", "飛び上がる是跳起、飞跃或惊跳；跳ねる是弹跳、飞溅；跳ね上がる是猛然跳起或价格暴涨，不能全换。"],
  ["synonym:叫声", "major", "鳴き声是动物的叫声、鸣声；叫び声是人的喊叫、呼喊声，不能替换。"],
  ["synonym:职责", "major", "役目是角色、职责或作用；務め是应履行的职责、义务，也可指任职，责任感更强。"],
  ["synonym:估计", "major", "見当是估计、方向或头绪；目算是预估、盘算或计划，偏主动计算和打算。"],
  ["synonym:羽毛", "major", "羽是羽毛也可指翅膀、羽；羽毛是羽毛、绒毛的正式总称，不能替换翅膀等用法。"],
  ["synonym:简朴的", "major", "質素是生活、服饰等朴素简朴；簡素是构造、装饰等简单朴素，侧重点分别在生活质朴和结构简洁。"],
  ["synonym:过程", "interchangeable", "過程和プロセス都可表示过程、流程；プロセス更常用于工作流程、处理步骤和抽象机制。"],
  ["synonym:要点", "major", "要点是重点、关键；ポイント是要点也可指得分、积分或地点；要所是关键地点、关键环节，不能全换。"],
  ["synonym:弱点", "major", "弱点是弱点、薄弱处；弱み是弱点、弱处，也可指可被利用的软肋，主观和策略色彩更强。"],
  ["synonym:厚脸皮的", "interchangeable", "厚かましい和ずうずうしい都表示厚脸皮、冒昧；后者更口语、更强烈地指不知羞耻。"],
  ["synonym:强硬的", "major", "強引是强行、不讲道理地推进；強硬是态度、立场坚硬不让步，不能替换强行行为。"],
  ["synonym:胡乱的", "major", "でたらめ是胡说八道、胡乱无根据；無闇是盲目、过度、无节制，不能替换虚假说法。"],
  ["synonym:稍微", "major", "やや是稍微、略微；何らか是某种、某些，未必表示程度；いささか是稍微且常带不足、谦逊或书面语气。"],
  ["synonym:替换", "major", "入れ替える是互换、替换位置或内容；置き換える是用另一物替代；差し替える是把文件、零件等换成新版，不能全换。"],
  ["synonym:倚靠", "major", "もたれる是身体靠着，也可表示消化不良；寄り掛かる是靠着或依赖某人、某物，依赖意味更强。"],
  ["synonym:清楚的", "major", "クリア是清晰、通过或清除；明瞭是清楚明白；分明是清楚分明，偏书面，不能全换。"],
  ["synonym:迅速地", "major", "ぐんぐん是快速、大幅持续增长；さっと是迅速、轻快地完成一次动作，过程感不同。"],
  ["synonym:厨师", "major", "コック是厨师的日常或旧式称呼；シェフ通常指餐厅主厨、负责菜单和厨房的高级厨师。"],
  ["synonym:贴纸", "major", "シール是贴纸、封条或贴膜；貼り紙是贴在墙、门等处的纸张告示，也可指张贴物，不能全换。"],
  ["synonym:体系", "interchangeable", "システム和体系都可表示系统、体系；システム更强调运行机制和功能，体系偏理论、知识结构。"],
  ["synonym:挪开", "major", "ずらす是使位置错开、移动一点；どける是把挡路物挪走、让开道路，结果和对象不同。"],
  ["synonym:充分地", "major", "たっぷり是足量、充足地；みっちり是满满地、密集地或严实地，强调密度和训练量，不能全换。"],
  ["synonym:爽快地", "major", "はきはき是说话、动作爽利清楚；すっと是顺畅、笔直或突然轻松地，不能替换人的表达风格。"],
  ["synonym:娱乐", "interchangeable", "レクリエーション和娯楽都可表示娱乐、消遣；前者常指集体活动、休闲项目，娯楽范围更广。"],
  ["synonym:轻率的", "major", "安易是想得简单、轻易或不慎重；軽率是行动、判断轻率，直接强调缺乏考虑，不能全换。"],
  ["synonym:地位", "major", "位是等级、地位或位置的简略词；地位是社会身份、地位；ステータス还可指状态、资格或游戏属性，不能全换。"],
  ["synonym:一致", "interchangeable", "一致和合致都表示一致、符合；合致更正式，强调与条件、事实或标准相符合。"],
  ["synonym:海上", "major", "沖是离岸较远的外海、海面；海上是海面上、海上的正式方位表达，范围更泛。"],
  ["synonym:恩惠", "major", "恩恵是受到的恩惠、利益；恵み是自然、神或他人给予的恩泽；ありがたみ是感受到的价值和可贵，不能全换。"],
  ["synonym:活力", "interchangeable", "活気和活力都可表示生气、活力；活気偏环境、市场热闹，活力偏人或组织的生命力。"],
  ["synonym:直觉", "major", "勘是凭经验的猜测、直觉；直感是瞬间直接感受到的判断，不能替换所有推测。"],
  ["synonym:误会", "interchangeable", "勘違い和思い違い都可表示误会、想错；勘違い更日常，思い違い强调记忆或理解上的错误。"],
  ["synonym:关联", "interchangeable", "関連和連関都表示关联、相互联系；連関更书面、理论化，日常一般用関連。"],
  ["synonym:极其", "major", "極、極めて和至って都可表示极其；極めて最正式中性，至って常表示非常地或极其平常，不能全换。"],
  ["synonym:戏剧", "major", "劇是戏剧、剧烈或戏剧作品的简略；芝居是戏剧、演技，也可指装腔作势，不能全换。"],
  ["synonym:围棋", "interchangeable", "碁和囲碁都指围棋；碁是简略、旧式或固定词中的说法，囲碁是完整正式名称。"],
  ["synonym:情景", "major", "光景是眼前看到的场面、景象；情景是情形、场景或情感背景，偏抽象书面，不能全换。"],
  ["synonym:效力", "major", "効力是法律、规则等的效力或有效性；効き目是药物、措施的效果，不能替换法律效力。"],
  ["synonym:考虑", "major", "考慮是思考并纳入判断；配慮是顾及他人、安排照顾；思慮是深思熟虑，语气和对象不同。"],
  ["synonym:贡献", "major", "貢献是为社会、组织等作出贡献；寄与是正式、书面的贡献、促成作用，使用场合更正式。"],
  ["synonym:伸出", "major", "差し伸べる是伸出手并施以援助；差し出す是伸出、递出、提交；突き出す是向前推出；伸べる是书面伸展，不能全换。"],
  ["synonym:深信", "major", "思い込む是未经充分依据却认定、坚信；信じ込む是深信不疑，强调信念本身，不能全换。"],
  ["synonym:尽情地", "interchangeable", "思い切り和思う存分都表示尽情、尽最大限度；思い切り更口语有力度，思う存分更书面。"],
  ["synonym:线索", "major", "糸口是突破口、着手线索；心当たり是自己想到的相关线索、印象；手がかり是可依靠的线索、依据，不能全换。"],
  ["synonym:事态", "major", "事態是事态、局势，常带问题发展意味；事象是现象、事件，偏客观或科学，不能全换。"],
  ["synonym:获奖", "major", "受賞是获得奖项、正式获奖；入賞是进入获奖名次、得奖，常用于比赛评选，范围略窄。"],
  ["synonym:瞬间", "major", "瞬間是瞬间、片刻；とっさ是面对突发情况的当下、猛然；瞬時是极短时间的书面词，不能全换。"],
  ["synonym:书籍", "interchangeable", "書籍和書物都可表示书籍、图书；書籍较正式分类，書物更书面或文学。"],
  ["synonym:助手", "interchangeable", "助手和アシスタント都可表示助手、助理；アシスタント更常用于职场、节目和服务岗位，助手较正式。"],
  ["synonym:障碍", "major", "障害是障碍、残障或故障；支障是妨碍正常进行的障碍、影响，不能替换残障等用法。"],
  ["synonym:关节", "major", "節可指关节、段落、节气或关键处；関節专指身体关节，不能替换节的抽象用法。"],
  ["synonym:专心", "interchangeable", "専念和専心都表示专心致志；専念更常接某项工作，専心更强调一心不二，语体较书面。"],
  ["synonym:资质", "major", "素質是天分、潜在素质；資質是资质、品质和资格条件，正式且不只限于天分。"],
  ["synonym:装置", "major", "装置是设备、装置或安装动作；仕掛け是装置、机关或设计好的手段、圈套，不能全换。"],
  ["synonym:统一", "major", "統一是统一标准、意见或形式；統合是整合、合并成一个整体，不能替换单纯统一格式。"],
  ["synonym:迫近", "interchangeable", "迫る和差し迫る都可表示迫近、逼近；差し迫る更强调紧迫、已近在眼前。"],
  ["synonym:评价", "major", "評価是评价、估价、评估；評判是口碑、名声或社会评价，不能替换专业评估。"],
  ["synonym:区域", "major", "分野是领域、范围；区域是划定的区域、地理范围，不能按中文‘区域’完全互换。"],
  ["synonym:胡闹", "major", "暴れる是乱闹、暴动或猛烈挣扎；ふざける是开玩笑、胡闹或戏弄，暴力程度和语气不同。"],
  ["synonym:膨胀", "major", "膨らむ是膨胀、鼓起或想法扩大；膨れる是鼓起、闹别扭或金额增加；膨れ上がる强调急剧膨胀、暴增。"],
  ["synonym:民主", "interchangeable", "民主和デモクラシー都与民主、民主主义有关；前者是日语正式词，后者是外来语，常用于概念或标题。"],
  ["synonym:涌出", "major", "湧く是水涌出、兴趣产生；湧き出る强调从某处涌出来；あふれ出す是溢出、喷涌而出，常含超过容量。"],
  ["synonym:多余的", "major", "余計是多余、过分或额外，常带不必要的语气；余分是多出的部分、余量，较客观。"],
  ["synonym:要素", "major", "要素是构成事物的因素、要素；エレメント还可指化学元素、基本单元或网页元素，范围更宽。"],
  ["synonym:东张西望", "major", "きょろきょろ是眼睛不安定地四处张望；よそ見是把视线移向别处、分心，不能全换。"],
  ["synonym:抽签", "interchangeable", "くじ引き和抽選都可表示抽签、抽选；くじ引き更日常也可指抽奖，抽選偏正式制度用语。"],
  ["synonym:领会", "major", "くみ取る是领会、揣摩并汲取含义；心得る是理解、牢记并掌握，常含应知会做的语气。"],
  ["synonym:要领", "major", "コツ是窍门、诀窍；要領是要领、办事方法或概括要点，范围更宽、更正式。"],
  ["synonym:仔细地", "major", "じっくり是花时间慢慢仔细做；よくよく是反复、充分地思考或仔细确认，不能全换。"],
  ["synonym:麻烦", "major", "トラブル是故障、纠纷等麻烦事件；手数是给别人添麻烦或手续、费事，不能替换故障。"],
  ["synonym:特意", "major", "わざわざ是特意花力气去做，也可含不必如此；あえて是明知困难仍敢于、特意选择，主动挑战意味更强。"],
  ["synonym:暂定", "major", "仮是暂时、假定或临时的称呼；暫定是经过暂时决定但尚未最终确定的正式状态。"],
  ["synonym:生计", "interchangeable", "家計和生計都与生活费用、生计有关；家計偏家庭收支，生計偏谋生和生活来源。"],
  ["synonym:外观", "major", "外見是外表、外貌；外観是建筑、物体等外观的正式词；見かけ是看起来的样子；見栄え是视觉上好不好看，不能全换。"],
  ["synonym:顽固的", "major", "頑固是固执、不改变；かたくな是顽固地拒绝或坚持，书面且常带心理态度；頑迷强调顽固愚昧，不能全换。"],
  ["synonym:危机", "major", "危機是危机、危险转折点；ピンチ是陷入困境、眼前难关，口语且未必是宏观危机。"],
  ["synonym:看穿", "major", "見抜く是看穿真相或本质；見通す是看透全局、预见未来；見透かす是看穿隐瞒和内心，不能全换。"],
  ["synonym:当地", "major", "現地是事件、旅行等所处的现场或当地；地元是本人所属、出生或生活的本地，参照视点不同。"],
  ["synonym:辩解", "major", "言い訳是借口、辩解，常带推卸责任的负面意味；弁解是正式解释、申辩，未必不合理。"],
  ["synonym:目的地", "major", "行く先是要去的地方或去向；目的地是明确的目的地点，正式且不能替换‘未来去向’等用法。"],
  ["synonym:如今", "major", "今時是如今这个时代，常带感叹或批评；今や是现在已经，强调与过去相比的变化，不能全换。"],
  ["synonym:毅力", "major", "根気是坚持做一件事的耐性；根性是性格、骨气或拼劲，也可指不服输，范围更宽。"],
  ["synonym:机制", "interchangeable", "仕組み和メカニズム都可表示机制、结构；后者更技术化、抽象，前者也常用于制度和构造。"],
  ["synonym:用尽", "major", "使い果たす是把资源、钱等全部用完；尽きる是自然耗尽或结束；切らす是用完导致断供，主语和结果不同。"],
  ["synonym:视线", "major", "視線是目光、视线方向；目線是视线，也可指观察立场、站在某人角度，不能全换。"],
  ["synonym:简便的", "major", "手軽是做起来方便、不费力；簡便是程序、方法简单便利的正式词，不能替换轻松随意等语气。"],
  ["synonym:写入", "major", "書き込む是写入、填入，也可写进书或留言；書き入れる是把信息记入指定空白处，动作更具体。"],
  ["synonym:弄伤", "major", "傷つける是弄伤身体或伤害感情、名誉；痛める是使身体部位疼痛、损伤，也可炒菜，不能全换。"],
  ["synonym:切掉", "major", "切り捨てる是切掉并舍弃、删掉；切り落とす是切下、削减数量或部分，舍弃判断意味不同。"],
  ["synonym:渗入", "major", "染みる是液体渗入、味道沁入，也可刺痛；染み込む强调充分渗进内部，程度更深。"],
  ["synonym:选拔", "major", "選考是根据标准审查、筛选；選抜是从候选者中选出优秀者，结果性和竞争性更强。"],
  ["synonym:单调的", "interchangeable", "単調和一本調子都可表示单调；后者更形象地指始终一个调子、缺乏变化。"],
  ["synonym:踏实的", "major", "着実是稳步、可靠地推进；地道是脚踏实地、不投机地做事，不能替换可靠进度等全部用法。"],
  ["synonym:平常", "major", "日頃是平日、平时的习惯状态；平常是平常、普通或不异常，不能全换。"],
  ["synonym:认识", "major", "認識是认识、理解或认知；面識是与某人见过面、认识本人，不能替换理解知识。"],
  ["synonym:悲哀", "interchangeable", "悲しみ和悲哀都表示悲伤、悲哀；悲しみ日常，悲哀更书面和沉重。"],
  ["synonym:放着不管", "interchangeable", "放っておく和ほっとく都表示放着不管；ほっとく是口语缩略，正式表达用放っておく。"],
  ["synonym:安排", "major", "アレンジ是安排、调整或改编；段取り是按步骤筹划；手配是安排人、物、手续，不能全换。"],
  ["synonym:不情愿地", "major", "いやいや是勉强、不情愿地，也可表示强烈否定；渋々是虽不情愿但最终接受，不能全换。"],
  ["synonym:冲击", "major", "インパクト是视觉、宣传或心理上的冲击、影响；衝撃是物理冲击或震惊，正式客观。"],
  ["synonym:控制", "major", "コントロール是控制、操纵或调节；制御是机器、系统等按规则控制，技术性更强。"],
  ["synonym:品味", "major", "センス是审美、感觉和品味；賞味是品尝、享用味道，也出现在赏味期限，不能替换审美品味。"],
  ["synonym:时机", "major", "タイミング是时机、配合得是否恰当；折是某个时候、机会的书面表达，不能替换动作节奏。"],
  ["synonym:深切地", "major", "つくづく是深切地、充分感受到或反复思考后；ひしひし是强烈切身地感受到压力、情感逼近，不能全换。"],
  ["synonym:嵌入", "major", "はまる是嵌进去、合适或沉迷；はめる是使嵌入、戴上；食い込む是嵌入并侵入、占据，句法和结果不同。"],
  ["synonym:宽大的", "major", "ぶかぶか是衣物等过于宽松；寛大是心胸宽大、宽容，词义对象完全不同。"],
  ["synonym:步伐", "major", "ペース是速度、进度和节奏；歩み是脚步、进程；足取り是步行脚步、行踪或进展迹象，不能全换。"],
  ["synonym:黑暗", "major", "闇是黑暗、暗处或未知阴暗面；暗闇是没有光的黑暗处，不能替换阴谋、黑市等闇的引申义。"],
  ["synonym:格外的", "major", "格別是格外、特别不同，常含特别好或特别待遇；格段是程度、差距显著，常用于比较，不能全换。"],
  ["synonym:乐观的", "major", "楽観的是对结果抱乐观判断；楽天的是天性乐观、无忧无虑，有时带不切实际的语气。"],
  ["synonym:观点", "major", "観点是观察、分析问题的角度；見地是立场、见解或学识立足点，书面且范围不同。"],
  ["synonym:坚固的", "major", "頑丈是结实耐用；強固是牢固、坚强的正式词；堅牢是结构安全牢靠，技术书面色彩更强。"],
  ["synonym:记下", "major", "記す是记载、写下或留下记录；書き留める是为了不忘而记下来，强调记录动作和用途。"],
  ["synonym:奖品", "major", "景品是购买、促销或活动赠送的奖品、赠品；賞品是比赛、竞赛获胜者得到的奖品。"],
  ["synonym:看漏", "major", "見過ごす是没注意到而放过、忽视；見落とす是看漏文字、错误等具体细节，不能全换。"],
  ["synonym:间隙", "major", "合間是两件事之间的空闲时间或间隔；絶え間是连续事物之间的间隙、间断，常用于不停歇的否定搭配。"],
  ["synonym:根本", "major", "根本是根本、根源或基础；根底是隐藏在深处的基础、底层原因，书面且强调深层。"],
  ["synonym:物产", "major", "産物是产物、成果或某地出产物；物産专指地方物产、特产的正式分类，不能全换。"],
  ["synonym:支援", "major", "支援是提供支持、援助的正式总称；てこ入れ是针对停滞局面进行干预扶持；バックアップ是支持或备份，不能全换。"],
  ["synonym:支持", "major", "支持是支持观点、支撑物体或维持；サポート是帮助、服务支持；後押し是背后推动、声援，不能全换。"],
  ["synonym:实质", "major", "実質是实质、实际内容或本质；正味是扣除包装后的净量、实际有效部分，也可指真正的，范围不同。"],
  ["synonym:变弱", "major", "弱まる是力量、程度自然变弱；弱る是衰弱、困窘或失去活力，常指主体状态变差。"],
  ["synonym:步骤", "major", "手順是操作步骤、程序顺序；ステップ是阶段、步骤，也可指舞步，范围更宽。"],
  ["synonym:被动", "major", "受け身是被动状态、被动态或不主动；後手是行动落后、被对方抢先，不能替换语法被动态。"],
  ["synonym:提出", "major", "申し出る是向对方提出请求、申请或主动告知；打ち出す是提出政策、方针或打出主张，对象和语气不同。"],
  ["synonym:手势", "major", "身振り是身体动作、姿态或手势；手振り是手势、手的动作；ジェスチャー是有意传达意思的姿势，不能全换。"],
  ["synonym:天生", "interchangeable", "生まれつき和生まれながら都表示天生、生来；前者更日常，后者偏书面并强调从出生起。"],
  ["synonym:出示", "major", "提示是出示、提示信息或提醒；呈示是正式呈现、出示文件等，书面和对象不同。"],
  ["synonym:适合", "major", "適応是适应环境、情况或使自身适应；適合是符合条件、适合对象，不能替换适应过程。"],
  ["synonym:讨论", "interchangeable", "討論和ディスカッション都表示讨论；后者更常指会议中的意见交流，討論更正式中性。"],
  ["synonym:读者", "major", "読者是阅读书刊的读者；読み手是读者，也可指解读文字、接收表达的一方，范围更宽。"],
  ["synonym:发芽", "major", "発芽是种子发芽的正式过程；芽生え是萌芽、产生，也可用于感情、意识等抽象事物。"],
  ["synonym:必然的", "major", "必然是必然这一结果或概念；必然的是必然的形容词形式，区别在词性和句法。"],
  ["synonym:部门", "major", "部門是组织、产业中的部门分类；部署是具体单位、岗位配置或部署地点，不能全换。"],
  ["synonym:主要原因", "interchangeable", "要因和主因都可表示主要原因；主因更直接强调主要的一个原因， 要因偏分析和正式用语。"],
  ["synonym:欲望", "major", "欲是欲望、贪欲或想要的简略词；欲望是欲望这一正式、抽象概念，范围和语体不同。"],
  ["synonym:缠绕", "major", "絡む是缠绕、牵涉或纠缠他人；絡まる是自己缠住、纠结的自动词，视点和句法不同。"],
  ["synonym:领域", "major", "領域是领域、范围；域是领域、区域的书面或专业简略；領分是分内领域、本职范围，不能全换。"],
  ["synonym:框", "interchangeable", "枠和フレーム都可表示框、框架；フレーム还可指车架、结构或画面帧，枠也常表示限额范围。"],
  ["synonym:插图", "interchangeable", "イラスト和挿絵都可表示插图；イラスト更泛指插画作品，挿絵强调插在书文中的配图。"],
  ["synonym:差距", "major", "ギャップ是差距、落差或不协调感；格差是社会、收入等结构性差距，不能全换。"],
  ["synonym:喧闹", "major", "ざわざわ是人群窃窃私语、骚动或不安的嘈杂；がやがや是多人高声喧谈、吵嚷，声音状态不同。"],
  ["synonym:渗出", "major", "にじみ出る是液体、感情、特质从内里流露；にじむ是渗开、模糊或逐渐显露，不能全换。"],
  ["synonym:摇摆", "major", "ぶれる是偏离、摇摆不定或镜头偏移；揺れ動く是物理摇晃或心情、立场动摇，过程感更强。"],
  ["synonym:坚持做完", "interchangeable", "やり抜く和やり通す都表示坚持到底完成；やり抜く强调克服困难完成，やり通す强调贯彻始终。"],
  ["synonym:所以", "interchangeable", "ゆえに和それゆえ都表示所以、因此；それゆえ更明确承接前因，二者都偏书面。"],
  ["synonym:修订", "major", "改訂是书籍、文件等修订改版；改定是制度、价格、规则等重新规定，不能全换。"],
  ["synonym:仿造", "major", "似せる是模仿、仿造得像；かたどる是仿照形状、塑造轮廓或象征性表现，不能全换。"],
  ["synonym:深处", "major", "深み是深处、深度或深奥意味；奥底是最深处、内心底层，位置和抽象程度不同。"],
  ["synonym:编入", "interchangeable", "組み込む和組み入れる都表示编入、纳入、嵌入；組み込む更强调嵌进结构，組み入れる更强调纳入构成。"],
  ["synonym:探究", "major", "探究是深入研究、探索真相；詮索是追问、打听细节，常带多管闲事或盘问的负面意味。"],
  ["synonym:变形", "major", "変形是形状改变、变形的中性正式词；ひずみ是扭曲、变形或应变，常带不正常、受力后的意味。"],
  ["synonym:还钱", "major", "返金是退回已收的钱、退款；返済是偿还借款、债务，资金关系不同。"],
  ["synonym:真心", "major", "本心是内心真实想法、本意；真心是诚实真挚的心意、诚意，不能全换。"],
  ["synonym:埋入", "major", "埋め込む是埋入、嵌入内部；うずめる是埋住、填满到看不见，也可埋在人群中，动作范围不同。"],
  ["synonym:陷阱", "major", "落とし穴是陷阱、漏洞或容易失败的盲点；罠是捕捉用圈套、诱骗陷阱，不能全换。"],
  ["synonym:平息", "major", "鎮める是主动使骚乱、情绪平息或镇定；治まる是局势、疼痛等自行平息、恢复，自动词视点不同。"],
  ["synonym:葱", "major", "ねぎ是葱的日常泛称；長ねぎ特指长葱、大葱，不能替换小葱等所有葱类。"],
  ["synonym:热情", "major", "モチベーション是行动动力、动机；熱意是对某事投入的热情、诚意，不能全换。"],
  ["synonym:无力的", "major", "無力是没有力量、能力或无能为力；無気力是没有精神、干劲和动力，不能替换身体能力不足。"],
  ["synonym:塞进", "major", "詰め込む是把大量东西塞满、灌输进脑中；押し込める是把东西推进去或关押、压抑，结果和引申义不同。"],
  ["synonym:最合适的", "interchangeable", "最適和うってつけ都可表示最合适；最適正式客观，うってつけ更口语且强调特别适合某目的。"],
  ["synonym:私人的", "major", "プライベート是私生活、私人性质或非工作时间；私的是个人的、私人的正式词，不能全换。"],
  ["synonym:飞来飞去", "major", "飛び回る是飞来飞去，也可比喻忙碌奔走；飛び交う强调鸟、声音、信息等在空中或双方之间交错来往。"],
  ["synonym:真实的", "major", "リアル是现实感强、逼真或实际的；真実是事实真相、真实本身，不能替换现实体验。"],
  ["synonym:经理", "major", "マネージャー是经理、管理者或艺人经纪人；支配人是负责经营管理店铺、旅馆等机构的负责人。"],
  ["synonym:反效果", "major", "逆効果是结果与目的相反的反效果；裏目是原本打算有利却导致不利结果，常用于具体行动判断。"],
  ["synonym:名门", "major", "名門是有名望的家族、学校或组织；家柄是家世、出身门第，不能替换名校等机构。"],
  ["synonym:农场", "major", "農園是种植果树、作物的农园；農場是农业生产场、农场，范围可包括畜牧等，不能全换。"],
  ["synonym:册数", "major", "部数是印刷品、报刊的份数；冊数是书、册本的数量，不能替换报纸发行份数等用法。"],
  ["synonym:园艺", "interchangeable", "ガーデニング和園芸都与园艺有关；前者偏家庭、休闲园艺，后者是正式、专业的园艺总称。"],
  ["synonym:住处", "major", "居場所是人当前所在、可以待着的位置；住処是居住处、栖身地，不能替换临时所在地点。"],
  ["synonym:英国", "interchangeable", "英国和イギリス都指英国；英国是汉字正式名称，イギリス是日常常用外来语称呼。"],
  ["synonym:路程", "major", "道程是路程、过程或达到目标的历程；道のり是实际距离、路程，也可比喻完成目标所需历程。"],
  ["synonym:往往", "major", "えてして是往往、容易出现某种情况；ともすれば是动辄、稍不注意就会，常带负面倾向，不能全换。"],
  ["synonym:精髓", "major", "神髄是事物最核心的精髓、真谛；エッセンス是精华、要点，也可指香精等具体提取物。"],
  ["synonym:听讲", "major", "受講是参加课程、接受授课；聴講是听课、旁听，强调听而不一定正式注册，不能全换。"],
  ["synonym:深度", "major", "深度是深浅程度的正式概念；奥行き是物体从前到后的深度，也可引申内涵和层次，不能全换。"],
  ["synonym:个人的", "interchangeable", "個人的和パーソナル都可表示个人的；パーソナル更常用于服务、空间、色彩等商品化表达。"],
  ["synonym:结局", "major", "落ち是故事笑点、结尾或下降结果；結末是故事、事情的最终结局，不能替换笑点等用法。"],
  ["synonym:因素", "major", "ファクター是影响因素、要素的外来语；因子是因素、变量或生物遗传因子，专业性更强。"],
  ["synonym:驱使", "major", "突き動かす是内在情感、冲动推动；駆り立てる是催促、驱赶或逼迫去做，外力和紧迫感更强。"],
  ["synonym:含糊的", "major", "うやむや是事情被含糊处理、不追究；あやふや是记忆、判断或信息不确定、不清楚，不能全换。"],
  ["synonym:欺骗", "major", "だます是欺骗、哄骗；欺く是欺骗、蒙蔽也可胜过某人；偽る是伪装、隐瞒真实，手段和对象不同。"],
  ["synonym:犯罪", "major", "罪是罪过、过错或罪行；犯罪是违反法律的犯罪行为，范围更明确正式。"],
  ["synonym:凄惨的", "major", "惨め是处境悲惨、屈辱可怜；無残是惨烈、残酷、毫不留情的状态，不能全换。"],
  ["synonym:尾巴", "major", "尻尾是动物尾巴，也可指末端、尾巴；尾是尾部、尾巴的书面或专业词，不能替换所有口语引申义。"],
  ["synonym:祖先", "interchangeable", "祖先和先祖都表示祖先；先祖较传统、书面或带敬意，祖先更中性概括。"],
  ["synonym:农民", "major", "農民是农民这一社会、职业群体；農夫是务农的男子、农夫，指称范围和语感不同。"],
  ["synonym:加工", "major", "加工是对原材料进行处理；細工是精细手工、加工技艺或小装饰，也可指做手脚，不能全换。"],
  ["synonym:房屋", "major", "家屋是房屋、住宅的正式词；ハウス是房子，也可指店铺、温室或某种场所，范围更宽。"],
  ["synonym:核心", "major", "核是核心、核子或核部分的简略词；核心是核心要点；中核是中心核心、骨干，不能全换。"],
  ["synonym:起点", "major", "起点是开始的位置或时间点；振り出し是起点，也可指回到原点、重新开始，语用范围不同。"],
  ["synonym:灾难", "major", "災難是遭遇的灾难、不幸；災い是灾祸、祸根，也可引申带来祸害的事物，不能全换。"],
  ["synonym:刺入", "major", "刺さる是尖物刺入、卡住，也可打动人心；突き刺す是主动用力刺入或刺痛，自动他动不同。"],
  ["synonym:沉重的", "major", "重たい是物理沉重、气氛沉闷或心情沉重；手痛い是损失、打击等惨重、痛苦，不能全换。"],
  ["synonym:浪费", "major", "無駄遣い是乱花钱、浪费使用；浪費是浪费资源、时间或机会的正式总称；ロス是损耗、损失或未利用部分，不能全换。"],
  ["synonym:不利的", "major", "不利是对某方不利、处于劣势；不利益是造成的损失、利益受损或不利益的正式概念，不能全换。"],
  ["synonym:大树", "interchangeable", "大木和巨木都可表示大树、巨树；巨木更强调巨大和珍稀，二者在普通树木语境大多可互换。"],
  ["synonym:基地", "major", "基地是军事、生产等基地；拠点是活动据点、根据地或中心地点，未必是固定基地设施。"],
  ["synonym:声响", "major", "響き是声音的回响、音色或影响；音響是声响、音响设备和声学现象的正式词，不能全换。"],
  ["synonym:粮食", "major", "食糧是供人吃的粮食、食物储备；糧是粮食、生活所需的比喻书面词，不能替换所有具体食品。"],
  ["synonym:随笔", "interchangeable", "随筆和エッセー都可表示随笔；エッセー是外来语，也可指小论文、短文，随筆更传统书面。"],
  ["synonym:直线", "major", "直線是几何直线；一直線是笔直地、径直朝向或一条直线，不能替换数学概念。"],
  ["synonym:标准", "major", "標準是标准、规范或平均基准；目安是判断、估计用的大致标准、参考目标，精确性和约束力不同。"],
  ["synonym:武士", "interchangeable", "武士和侍都可指日本武士；侍更历史、文学或带古风，武士是中性历史名称。"],
  ["synonym:晚年", "major", "老後是退休后的老年生活；晩年是人生、时代或事业的后期，不只限于退休生活。"],
  ["synonym:触感", "major", "触り是触摸到的感觉、手感，也可指开头部分；感触是触感或心理感受；肌触り专指皮肤接触的手感，不能全换。"],
  ["synonym:愚蠢的", "major", "ばか是笨、傻，也可作骂人语；愚か是愚蠢、缺乏判断的书面词；へま是笨拙失误，不能全换。"],
  ["synonym:桥梁", "major", "架け橋是连接双方的桥梁，也常比喻纽带；橋渡し是中介、牵线或促成沟通的作用，不能全换实体桥。"],
  ["synonym:轻快的", "major", "軽やか是动作、声音、心情轻盈；軽快是动作轻快、文章明快或病情好转，语体和搭配不同。"],
  ["synonym:庄严的", "interchangeable", "厳粛和厳か都可表示庄严、肃穆；厳粛偏正式严肃气氛，厳か更强调仪式感和神圣感。"],
  ["synonym:心里没底的", "major", "心細い是因孤独、无依靠而心里没底；心もとない是对能力、前景或可靠性不放心，不能全换。"],
  ["synonym:举止", "major", "振る舞い是行为、待人举止或表现；素振り是表情、动作流露出的样子或迹象，不能全换。"],
  ["synonym:推移", "major", "推移是事物随时间变化、演变的正式说法；移り変わり是变化、变迁，带有自然流转和文学色彩。"],
  ["synonym:气势", "major", "迫力是冲击力、感染力和压迫感；気合是精神集中、干劲和气势，不能全换视觉冲击。"],
  ["synonym:细致的", "major", "綿密是计划、分析周密细密；細やか是细腻、周到或情感细致；入念是认真仔细、预先周密，不能全换。"],
  ["synonym:体谅", "major", "いたわる是体恤、慰劳弱者或病人；思いやる是设身处地体谅、关怀他人，不能全换身体慰劳。"],
  ["synonym:优雅的", "interchangeable", "エレガント和優雅都可表示优雅；エレガント更时尚、外来语，優雅偏正式书面。"],
  ["synonym:脚本", "interchangeable", "シナリオ和脚本都可指剧本、脚本；シナリオ也可指预想方案、情节，脚本更正式书面。"],
  ["synonym:严峻的", "major", "シビア是严苛、现实、要求高；峻厳是形势、态度或惩罚严峻的书面词，不能全换。"],
  ["synonym:丑闻", "major", "スキャンダル是公众关注的丑闻、绯闻；不祥事是组织、公司等发生的失职违规或坏事，不能全换。"],
  ["synonym:工作室", "major", "スタジオ是摄影、录音、广播等工作室或摄影棚；工房是手工业、艺术家的作坊，不能全换。"],
  ["synonym:合作", "major", "チームワーク是团队协作精神和配合；連携是机构、系统或人员之间联动协作，正式且范围不同。"],
  ["synonym:央求", "interchangeable", "ねだる和せがむ都可表示央求、缠着要；ねだる常带撒娇索取，せがむ强调反复催求。"],
  ["synonym:坏人", "major", "悪人是道德、法律意义上的坏人；悪玉是与善方相对的坏一方、反派或有害因素，常用于比喻。"],
  ["synonym:街头", "major", "街頭是街道、街头的正式词；巷是街巷、民间社会或人们之间，不能替换具体街头位置。"],
  ["synonym:技能", "major", "技能是习得的技术、技能；技量是实际本领、水平和技巧高低，评价能力意味更强。"],
  ["synonym:忌讳", "major", "禁物是应避免、切忌的事物；忌避是有意避开、回避，偏正式和行为过程，不能全换。"],
  ["synonym:经历", "major", "経歴是履历、经历记录；キャリア是职业生涯、发展路径或专业背景，不能替换一般生活经历。"],
  ["synonym:稳妥的", "major", "堅実是稳健可靠、一步一步积累；無難是不会出错、选择保守安全，不能全换。"],
  ["synonym:交易", "major", "交易是贸易、商业交换的正式词；取引是具体买卖、往来或交易关系，范围更日常宽泛。"],
  ["synonym:巧妙的", "interchangeable", "巧み和巧妙都可表示巧妙、高明；巧み更常修饰技艺和手法，巧妙偏正式书面。"],
  ["synonym:收益", "major", "採算是收支核算后是否划算、能否盈利；収益是实际获得的收益、利润，不能全换。"],
  ["synonym:手法", "major", "手際是办事手法、熟练程度和效率；手法是技术方法、操作手段，不能替换效率评价。"],
  ["synonym:色彩", "major", "色彩是颜色、色彩，也可指特色和倾向；彩り是颜色点缀、丰富多彩的装饰，不能全换。"],
  ["synonym:店头", "major", "店頭是店铺前、柜台或零售现场的正式词；店先是店门口、店面前，位置更具体日常。"],
  ["synonym:模糊的", "major", "漠然是笼统、没有明确内容；おぼろげ是记忆、形象或轮廓模糊朦胧，不能全换。"],
  ["synonym:变迁", "major", "変遷是历史、制度等长期演变的正式词；移ろい是季节、感情、景物的流转变化，文学色彩更强。"],
  ["synonym:模拟", "interchangeable", "模擬和アナログ都可与模拟相连；模擬是仿真、模拟某种考试或场景，アナログ是非数字、连续式的模拟技术，不能全换所有模拟义。"],
  ["synonym:猛烈的", "major", "猛烈是强烈、猛烈的中性词；痛烈是打击、批评、痛感等非常强烈，不能替换一般强度。"],
  ["synonym:亲切感", "major", "愛嬌是讨人喜欢的神态、魅力或可爱感；親近感是对人、场所感到亲近熟悉，不能全换。"],
  ["synonym:灵感", "major", "インスピレーション是灵感、启发，也可指艺术灵感；ひらめき是瞬间闪现的点子或领悟，时间感更强。"],
  ["synonym:措辞", "major", "言い回し是某种表达方式、惯用说法；文言是文章中的词句、措辞或言辞，偏书面，不能全换。"],
  ["synonym:大腿", "interchangeable", "もも和太もも都可表示大腿；太もも更明确排除水果桃子等同音义，日常身体部位基本可互换。"],
  ["synonym:财富", "major", "財是财产、财富的书面词；富是财富、富裕或财富本身，不能替换所有财产清单。"],
  ["synonym:磨损", "major", "擦り切れる是不及物地磨破、磨损到断；すり減らす是主动磨损、消耗或削减，句法和结果不同。"],
  ["synonym:字体", "interchangeable", "字体和書体都可表示字体、字形风格；書体更专业地指书写、印刷字体样式，字体也可泛指字形。"],
  ["synonym:意外", "major", "心外是出乎意料且感到遗憾、失望；不慮是没有预料到的意外、不测，不能全换。"],
  ["synonym:趋势", "major", "成り行き是事态自然发展、结果走向；趨勢是整体趋势、动向的正式词，不能全换具体发展过程。"],
  ["synonym:渴望", "interchangeable", "切望和渇望都表示强烈渴望；渇望更强调像口渴一样迫切，切望偏热切盼望，实际常可互换。"],
  ["synonym:肤浅的", "major", "浅はか是思想、判断浅薄且欠考虑；皮相是只停留在表面、没有深入，书面语义不同。"],
  ["synonym:潜水", "interchangeable", "潜水和ダイビング都可表示潜水；ダイビング更常指休闲、运动潜水，潜水也可指潜伏或技术作业。"],
  ["synonym:立即", "interchangeable", "即刻和即時都表示立即；即刻偏正式地指立刻行动，即時还可表示实时、即时状态。"],
  ["synonym:村落", "major", "村落是村庄、聚落的正式地理词；里是乡里、村落也可指故乡和乡间，不能全换。"],
  ["synonym:大规模的", "major", "大がかり是规模大、工程复杂或费力；大規模是规模大的客观正式描述，不能全换复杂程度。"],
  ["synonym:躯干", "major", "胴是身体躯干、腰身或物体中段；胴体是动物、人体躯干或飞机机身的正式具体词。"],
  ["synonym:推开", "major", "突き放す是推开、甩开，也可冷漠拒绝关系；押しやる是推到一边、排挤，不能全换情感拒绝。"],
  ["synonym:周到的", "interchangeable", "念入り和周到都可表示周密、细致；念入り强调事前反复仔细，周到强调考虑全面、照顾周全。"],
  ["synonym:困境", "major", "羽目是落入某种糟糕处境、窘境；苦境是艰苦、困难的处境，书面且不一定强调‘落入’。"],
  ["synonym:发病", "interchangeable", "発病和発症都可表示发病；発病偏疾病开始，発症常用于医学上症状显现，语体更专业。"],
  ["synonym:质感", "major", "風合い是布料、材料的手感和风格；質感是物体表面质地、视觉触觉效果的正式概念。"],
  ["synonym:落选", "major", "没是作品、方案等未被采用或落选；落選是参加选举、选拔后没有当选，使用场景更明确。"],
  ["synonym:涂鸦", "interchangeable", "落書き和いたずら書き都可表示乱写、涂鸦；后者更明确带恶作剧、未经许可的乱写意味。"],
  ["synonym:散布", "major", "散在是分散存在、散布在各处；流布是消息、思想、说法传播流行，不能全换。"],
  ["synonym:指南", "major", "ガイドライン是指导方针、准则或操作指南；指針是指针、方针、指导原则的正式词，不能全换具体说明书。"],
  ["synonym:妖怪", "major", "魔物是魔物、邪恶怪物或恶灵；化け物是怪物、妖怪，也可骂人；物の怪是古典、文学的鬼怪，不能全换。"],
  ["synonym:至高的", "interchangeable", "至上和至高都表示最高、至高；至上更常指地位、价值最高，至高更常指品质、境界最高。"],
  ["synonym:傲慢的", "major", "傲慢是态度骄傲自大；尊大是摆架子、妄自尊大；高慢是高傲自负，语体和侧重点不同。"],
  ["synonym:微小的", "major", "微細是细微、精细或极小的正式词；微々是微小、微薄，常与数量、影响等抽象对象搭配。"],
  ["synonym:猛冲", "major", "突っ走る是猛冲、一味向前也可比喻盲目推进；すっ飛ばす是飞快赶路、跳过步骤或甩掉，不能全换。"],
  ["synonym:活下来", "major", "生き抜く是克服困难坚持活下去；生き延びる是幸存、活过危险或期限，不能全换坚持过程。"],
  ["synonym:炫耀", "major", "てらう是炫耀、卖弄或矫饰自己的才华；見せつける是故意展示给别人看、示威，动作和对象不同。"],
  ["synonym:猛然", "major", "はっと是突然意识到、惊醒或吃惊；かっと是怒气、火势或动作猛然爆发，情绪方向不同。"],
  ["synonym:秘诀", "interchangeable", "極意和秘訣都可表示秘诀、精髓；極意更指某技艺的最高奥义，秘訣更泛指实用诀窍。"],
  ["synonym:报应", "major", "報い是行为带来的报应，也可指回报；罰是惩罚、报应或遭罚，强调处罚性更强。"],
];

const SYNONYM_REVIEWS: readonly DistinctionReview[] = SYNONYM_REVIEW_ROWS.map(
  ([groupKey, level, summary]) => ({ groupKey, level, summary })
);

export const distinctionReviewMap = new Map(
  [...DISTINCTION_REVIEWS, ...SYNONYM_REVIEWS].map((review) => [review.groupKey, review])
);

export const distinctionReviewFor = (groupKey: string): DistinctionReview | null =>
  distinctionReviewMap.get(groupKey) ?? null;

interface DistinctionNoteTarget {
  key: string;
  forms: readonly string[];
}

const plainForm = (text: string): string => text.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, "").trim();
const plainReviewText = (text: string): string => text.replace(/\[[^\]]+\]/g, "").trim();
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 把人工摘要中的每个词条说明拆回它自己的卡片。 */
export const distinctionNotesFor = (
  summary: string,
  targets: readonly DistinctionNoteTarget[]
): Map<string, string> => {
  const cleanSummary = plainReviewText(summary);
  const targetForms = targets.map((target) => ({
    key: target.key,
    forms: [...new Set(target.forms.map(plainForm).filter(Boolean))].sort((a, b) => b.length - a.length)
  }));
  const allForms = [...new Set(targetForms.flatMap((target) => target.forms))].sort((a, b) => b.length - a.length);
  if (!cleanSummary || !allForms.length) return new Map();

  const splitBeforeWord = new RegExp(`[，,](?=\\s*(?:${allForms.map(escapeRegExp).join("|")}))`, "u");
  const notes = new Map<string, string[]>();
  let previousKeys: string[] = [];

  cleanSummary.split("；").flatMap((clause) => clause.split(splitBeforeWord)).forEach((rawClause) => {
    const clause = rawClause.replace(/^[，,]/, "").replace(/[。；]+$/, "").trim();
    let matched = targetForms.filter((target) => target.forms.some((form) => clause.includes(form)));
    const pronoun = clause.match(/^(前者|后者)/)?.[1];
    if (!matched.length && pronoun && previousKeys.length) {
      const key = pronoun === "前者" ? previousKeys[0] : previousKeys[previousKeys.length - 1];
      matched = targetForms.filter((target) => target.key === key);
    }
    if (!matched.length) return;
    previousKeys = matched.map((target) => target.key);

    matched.forEach((target) => {
      let note = clause;
      if (matched.length === 1) {
        const prefixes = [...target.forms, "前者", "后者"].map(escapeRegExp).join("|");
        note = note.replace(new RegExp(`^(?:${prefixes})(?:（[^）]+）)?(?:是|表示)?`, "u"), "");
      }
      if (!note) return;
      notes.set(target.key, [...(notes.get(target.key) ?? []), note]);
    });
  });

  return new Map([...notes].map(([key, parts]) => [key, [...new Set(parts)].join("；")]));
};
