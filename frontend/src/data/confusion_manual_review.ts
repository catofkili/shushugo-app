/**
 * 疑难辨析自动分组的人工审校。
 *
 * 这些不是新的辨析数据，而是对 words 表中脚本关系的边界判定：
 * - variant groups: 同一个词的常用/异体/带注音写法，合并后只保留一条词条；
 * - excluded synonym groups: 中文首义碰巧相同，但日语不是可互换的近义词。
 *
 * 锚点用 (kanji, kana)，不写 word_id。词单重建或外来语合并改动 id 后，判定仍然稳定。
 */

export type ReviewedWordKey = readonly [kanji: string, kana: string];

export interface ManualVariantGroup {
  id: string;
  members: readonly ReviewedWordKey[];
  reason: string;
}

export const MANUAL_VARIANT_GROUPS: readonly ManualVariantGroup[] = [
  {
    id: "あなた-kanji-variant",
    members: [["あなた", "あなた"], ["貴方", "あなた"]],
    reason: "现代默认写作假名，貴方是同一词的旧/汉字写法。"
  },
  {
    id: "うるさい-kanji-variant",
    members: [["うるさい", "うるさい"], ["煩い", "うるさい"]],
    reason: "うるさい与煩い是同一形容词的假名/汉字写法。"
  },
  {
    id: "できる-kanji-variant",
    members: [["できる", "できる"], ["出来る", "できる"]],
    reason: "现代默认写作假名，出来る是同一词的汉字写法。"
  },
  {
    id: "どう-kanji-variant",
    members: [["どう", "どう"], ["如何", "どう"]],
    reason: "どう与如何（どう）是同一副词的假名/汉字写法。"
  },
  {
    id: "いかが-kanji-variant",
    members: [["いかが", "いかが"], ["如何", "いかが"]],
    reason: "いかが与如何（いかが）是同一词的假名/汉字写法；如何（どう）是另一读法，保留。"
  },
  {
    id: "どちら-kanji-variant",
    members: [["どちら", "どちら"], ["何方", "どちら"]],
    reason: "现代默认写作假名，何方（どちら）是同一代词的汉字写法。"
  },
  {
    id: "どなた-kanji-variant",
    members: [["どなた", "どなた"], ["何方", "どなた"]],
    reason: "现代默认写作假名，何方（どなた）是同一代词的汉字写法。"
  },
  {
    id: "どれ-kanji-variant",
    members: [["どれ", "どれ"], ["何れ", "どれ"]],
    reason: "现代默认写作假名，何れ是同一代词的汉字写法。"
  },
  {
    id: "まだ-kanji-variant",
    members: [["まだ", "まだ"], ["未だ", "まだ"]],
    reason: "まだ与未だ是同一副词的假名/汉字写法。"
  },
  {
    id: "たまに-kanji-variant",
    members: [["たまに", "たまに"], ["偶に", "たまに"]],
    reason: "现代默认写作假名，偶に是同一副词的汉字写法。"
  },
  {
    id: "しっかり-kanji-variant",
    members: [["しっかり", "しっかり"], ["確り", "しっかり"]],
    reason: "现代默认写作假名，確り是同一副词的汉字写法。"
  },
  {
    id: "しまう-kanji-variant",
    members: [["しまう", "しまう"], ["仕舞う", "しまう"]],
    reason: "しまう与仕舞う是同一动词的假名/汉字写法。"
  },
  {
    id: "うれしい-kanji-variant",
    members: [["うれしい", "うれしい"], ["嬉しい", "うれしい"]],
    reason: "うれしい与嬉しい是同一形容词的假名/汉字写法。"
  },
  {
    id: "すばらしい-kanji-variant",
    members: [["すばらしい", "すばらしい"], ["素晴らしい", "すばらしい"]],
    reason: "すばらしい与素晴らしい是同一形容词的假名/汉字写法。"
  },
  {
    id: "まっすぐ-kanji-variant",
    members: [["まっすぐ", "まっすぐ"], ["真っ直ぐ", "まっすぐ"]],
    reason: "まっすぐ与真っ直ぐ是同一形容动词的假名/汉字写法。"
  },
  {
    id: "ゆうべ-kanji-variant",
    members: [["ゆうべ", "ゆうべ"], ["昨夜", "ゆうべ"]],
    reason: "ゆうべ与昨夜是同一名词的假名/汉字写法。"
  },
  {
    id: "うち-kanji-variant",
    members: [["うち", "うち"], ["内", "うち"]],
    reason: "表示家里/内部的うち与内是同一词的假名/汉字写法。"
  },
  {
    id: "けが-kanji-variant",
    members: [["けが", "けが"], ["怪我", "けが"]],
    reason: "けが与怪我是同一名词的假名/汉字写法。"
  },
  {
    id: "かぶる-kanji-variant",
    members: [["かぶる", "かぶる"], ["被る", "かぶる"]],
    reason: "表示戴上/蒙上的かぶる与被る是同一动词的假名/汉字写法。"
  },
  {
    id: "はく-kanji-variant",
    members: [["はく", "はく"], ["履く", "はく"]],
    reason: "表示穿下装/鞋的はく与履く是同一动词；掃く、吐く不是成员。"
  },
  {
    id: "よる-kanji-variant",
    members: [["よる", "よる"], ["寄る", "よる"]],
    reason: "表示靠近/顺道拜访的よる与寄る是同一动词；夜是另一词，保留。"
  },
  {
    id: "ただし-kanji-variant",
    members: [["但し", "ただし"], ["ただし", "ただし"]],
    reason: "现代默认写作假名，但し与但し是同一接续词。"
  },
  {
    id: "さらに-kanji-variant",
    members: [["さらに", "さらに"], ["更に", "さらに"]],
    reason: "现代默认写作假名，さらに与更には同一副词。"
  },
  {
    id: "たずねる-kanji-variant",
    members: [["尋ねる", "たずねる"], ["訊[たず]ねる", "たずねる"]],
    reason: "表示询问的尋ねる与訊ねる是同一动词的异体写法；寻访义保留在较完整词条。"
  },
  {
    id: "かたづける-kanji-variant",
    members: [["片付ける", "かたづける"], ["片づける", "かたづける"]],
    reason: "片付ける与片づける是同一动词的送り仮名变体。"
  },
  {
    id: "けんか-annotation-duplicate",
    members: [["喧嘩[けんか]", "けんか"], ["喧嘩", "けんか"]],
    reason: "方括号读音标注被清理后是同一词条。"
  },
  {
    id: "うわさ-annotation-duplicate",
    members: [["噂[うわさ]", "うわさ"], ["噂", "うわさ"]],
    reason: "方括号读音标注被清理后是同一词条。"
  },
  {
    id: "たたく-annotation-duplicate",
    members: [["叩く", "たたく"], ["叩[たた]く", "たたく"]],
    reason: "方括号读音标注被清理后是同一词条。"
  },
  {
    id: "そば-annotation-duplicate",
    members: [["蕎麦[そば]", "そば"], ["蕎麦", "そば"]],
    reason: "方括号读音标注被清理后是同一词条；側是另一词，保留。"
  },
  {
    id: "しかし-kanji-variant",
    members: [["しかし", "しかし"], ["然し", "しかし"]],
    reason: "现代默认写作假名，然し是同一接续词的汉字写法。"
  },
  {
    id: "ただいま-kanji-variant",
    members: [["ただ今", "ただいま"], ["只今", "ただいま"]],
    reason: "ただ今与只今是同一副词的表记变体。"
  },
  {
    id: "入口-送り仮名-variant",
    members: [["入口", "いりぐち"], ["入り口", "いりぐち"]],
    reason: "入口与入り口是同一名词的表记变体，不应作为汉字用法辨析。"
  },
  {
    id: "晩ご飯-晩御飯-variant",
    members: [["晩ご飯", "ばんごはん"], ["晩御飯", "ばんごはん"]],
    reason: "晩ご飯与晩御飯是同一名词的表记变体。"
  },
  {
    id: "気を付ける-気をつける-variant",
    members: [["気を付ける", "きをつける"], ["気をつける", "きをつける"]],
    reason: "気を付ける与気をつける是同一惯用表达的表记变体。"
  }
];

/**
 * 同样被人工检查过、但不能合并的同形碰撞。
 * 这些词的显示形态相同，然而词义范围或用法不同；保留它们比丢失词条信息安全。
 */
export interface RetainedSurfaceCollision {
  id: string;
  members: readonly ReviewedWordKey[];
  reason: string;
}

export const RETAINED_SURFACE_COLLISIONS: readonly RetainedSurfaceCollision[] = [
  {
    id: "あまり-余り-polysemy",
    members: [["あまり", "あまり"], ["余り", "あまり"]],
    reason: "あまり主要是‘不太/不很’，余り还包含‘剩余/多余’名词义，不能按纯异写合并。"
  },
  {
    id: "掛かる-罹る-distinct-verb",
    members: [["掛かる", "かかる"], ["罹[かか]る", "かかる"]],
    reason: "掛かる表示花费/挂着等，罹る表示患病，是不同动词。"
  },
  {
    id: "やめる-止める-orthographic-range",
    members: [["やめる", "やめる"], ["止める", "やめる"]],
    reason: "やめる是覆盖面更广的假名写法，止める侧重停止/戒除；源词条释义范围不同，先保留。"
  },
  {
    id: "ホーム-home-platform-homophone",
    members: [["home", "ホーム"], ["platform", "ホーム"]],
    reason: "两条都是片假名ホーム，但分别是‘家/home’和‘站台/platform’的同音异义外来语，不能合并。"
  },
  {
    id: "ミス-miss-Miss-homophone",
    members: [["miss", "ミス"], ["Miss", "ミス"]],
    reason: "ミス分别来自 miss（错误）和 Miss（小姐），是词源不同的同音外来语，不能合并。"
  }
];

export interface ExcludedSynonymGroup {
  id: string;
  members: readonly ReviewedWordKey[];
  reason: string;
}

export const EXCLUDED_SYNONYM_GROUPS: readonly ExcludedSynonymGroup[] = [
  {
    id: "synonym-things-east-west",
    members: [["物", "もの"], ["東西", "とうざい"]],
    reason: "中文‘东西’同形；物是东西，東西是东与西，不是日语近义词。"
  },
  {
    id: "synonym-thousand-kilo",
    members: [["千", "せん"], ["(フ) kilo", "キロ"]],
    reason: "千是数词，キロ是可表示千克/千米等单位，不能互换。"
  },
  {
    id: "synonym-can-tank",
    members: [["缶", "かん"], ["tank", "タンク"]],
    reason: "缶是罐头/罐，タンク是储罐或大型容器，中文首义碰撞不构成近义。"
  },
  {
    id: "synonym-ice-ice-cream",
    members: [["氷", "こおり"], ["ice", "アイス"]],
    reason: "氷是冰，アイス还可指冰淇淋，不是同一词义。"
  },
  {
    id: "synonym-date-calendar-appointment",
    members: [["date", "デート"], ["日付", "ひづけ"], ["日にち", "ひにち"], ["期日", "きじつ"]],
    reason: "デート是约会，其他成员是日期/期限，原中文首义属于误译或多义碰撞。"
  },
  {
    id: "synonym-receipt-ticketing",
    members: [["領収書", "りょうしゅうしょ"], ["発券", "はっけん"]],
    reason: "領収書是收据，発券是出票/发行票券，不是发票的同义词。"
  },
  {
    id: "synonym-title-question",
    members: [["題名", "だいめい"], ["題", "だい"], ["設問", "せつもん"]],
    reason: "題名是标题，題/設問是题目或设问，不能作为一组可互换词。"
  },
  {
    id: "synonym-quality-mass",
    members: [["質", "しつ"], ["質量", "しつりょう"]],
    reason: "質是质量/素质，質量是物理学的质量（mass），中文同字不同义。"
  },
  {
    id: "synonym-ecology-eco",
    members: [["生態", "せいたい"], ["eco", "エコ"]],
    reason: "生態是生态状态，エコ是环保/生态友好，不能互换。"
  },
  {
    id: "synonym-literary-entertainment",
    members: [["芸能", "げいのう"], ["文芸", "ぶんげい"]],
    reason: "芸能是演艺/娱乐，文芸是文学艺术，中文‘文艺’造成误合并。"
  },
  {
    id: "synonym-lesson-curriculum",
    members: [["lesson", "レッスン"], ["curriculum", "カリキュラム"]],
    reason: "レッスン是单节课/课程，カリキュラム是课程体系，不是同义词。"
  },
  {
    id: "synonym-potted-plant-garden-tree",
    members: [["鉢植え", "はちうえ"], ["植木", "うえき"]],
    reason: "鉢植え是盆栽植物，植木是庭院树木/园林植物，中文首义过宽。"
  },
  {
    id: "synonym-decisive-absolutely-not",
    members: [["断然", "だんぜん"], ["断じて", "だんじて"]],
    reason: "断然是断然/明显地，断じて常用于‘绝不’，不是同义词。"
  },
  {
    id: "synonym-terminal-station-device",
    members: [["terminal", "ターミナル"], ["端末", "たんまつ"]],
    reason: "ターミナル可指终点站，端末是终端设备，中文首义不应合组。"
  },
  {
    id: "synonym-route-circuit",
    members: [["路線", "ろせん"], ["回線", "かいせん"]],
    reason: "路線是路线，回線是通信线路/电路，中文‘线路’造成误合并。"
  }
];
