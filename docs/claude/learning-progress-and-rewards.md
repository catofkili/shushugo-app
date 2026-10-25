# 学习进度、奖励与收藏

## 柚子：免费货币，只奖「做完了」，绝不奖「答得好」（2026-09-19）

`lib/yuzu.ts` + `lib/yuzu-catalog.ts` + `pages/YuzuShopPage.tsx`。入口是主页问候条里
连击旁边那枚余额 chip，货架在第二主页。**没有付费购买柚子的路，以后也别加。**

**2026-09-24 用户决定：**上面“以后也别加”的禁令已被明确撤销，后续要接人民币购买柚子。后台已提交
代币名「柚子」与 **1 元 = 100 柚子**。为让兑换面额下主题约 ¥20，同时保持免费获得商品所需的学习时间，
学习奖励和可购买商品 / 补签价格都按旧数值乘 10；旧本地账本用一次性 `yuzu_scale_10` 迁移同步放大，
不能只改新奖励、漏改商品价或清空已有余额。下面旧表和实测段记的是原面额，是作出决定时的历史依据，不是当前数值。

⚠️ **柚子不能和答对 / 答错、认识 / 忘记挂钩。** 挂上去的那一刻用户就会为了钱点
「认识」，喂给 FSRS 的全是假数据 —— 和辨析气泡、词库详情不放评分按钮是同一条理由。
也不按每次作答发（Habitica 的教训：按次发就是刷）。

### 数字是拿作者 102 天真实流水回放定的

当前面额（旧面额整体乘 10；后台兑换为 1 元 = 100 柚子）：学习满 100 词 +50、清完计划 +50、
7 日连击 +300、加餐 +50、每个成就 +200；主题 2,000 柚子（约 ¥20），高阶主题 / 皮肤 / 音效
3,000（约 ¥30），声音 6,000（约 ¥60），补签 500 / 1,000 / 2,000（约 ¥5 / ¥10 / ¥20）。
旧流水通过 `yuzu_scale_10` 只迁移一次，以保持原有免费积累时长与已存余额比例。

**2026-09-29 领取方式补充：**清完计划的 +50 不在 `settleYuzu()` 自动到账；它和满足门槛的最后一段专注奖励一起放进完成页宝箱，并分别标明来源。每日计划收尾时，当前专注段满 5 分钟且至少背 10 个词，按当天下一档领取；不足 5 分钟则作废。完整 10 分钟仍在休息页领本轮奖励。

| 事件 | 柚子 | 回放里的实测 |
|---|---|---|
| 今天学了 ≥ 100 个词 | 5 | 见下面「半份」那条 |
| 清完今日计划（叠在上一条上） | 5 | 8-21 之后 29 天里 27 天拿到 |
| 连击每满 7 天 | 30 | 占总收入 22% |
| 加餐（`readEncoreLog(day).dayWords > 0`，一天一次） | 5 | 回放里只有 2 天，量级无所谓 |
| 成就解锁 | 20/个 | 对着 `achievements` 表补差，**补发的老成就也拿得到** |
| 补签 | 30 天内第 1/2/3 张 50/100/200 | 3 次断档里 2 次 1 天、1 次 2 天 |
| 主题 200 / 皮肤 300 / 图标 500 / 第二声音 800 / 音效 300 | | 首件主题第 7 天到手；6 件外观 98 天买空 |

稳态 ≈ 14/天 ≈ 100/周。Duolingo 冻结卡 200 gems ≈ 免费用户 4~6 天收入，补签 50 同一档。

⚠️ **「完成 = 10 否则 0」会失真，所以拆成 5 + 5。** 作者 7-20 ~ 8-13 那 25 天每日计划
排到 500~1,100 词（复习上限设成 150 之前），每天答 400~1,000 次却只有 3 天清完 ——
按「清完才给」那 25 天只发了 40，8-21 之后 29 天发了 270，**学得一样多收入差 7 倍**。
「学了 ≥ 100 词 → 5」把这段拉回 185。别改成按完成率线性：「清完」那一级台阶要留着。

⚠️ **目录必须比六件大，否则第三个月开始堆币。** 回放里 6 件外观（1,500）第 98 天买空、
剩 110。图标 500 和第二声音 800 是撑后面几个月的；以后最便宜的补充沉没口是组队页
「送队友柚子」。实体周边**不用柚子买**（那是营销成本不是沉没口），门票是里程碑 +
柚子 + 自付邮费，兑换码走第三方店铺，别在 Worker 里存地址。

### 存法

- **一张表 `yuzu_ledger (kind, key, amount, day)`，`union` 同步，余额 = SUM(amount)。**
  每行是一笔不可变的账，身份 (kind, key)：study / plan / streak / encore 按学习日、
  achievement 按成就 id、buy 按商品 id、repair 按补回的那一天。不存计数器
  （`studyTimeMinutes` 那份自攒账从来没涨过，前车之鉴）。三处登记照例：
  `sync/tables.ts`、`scripts/user-data-tables.mjs`、`local-schema.sql`。
- **补签写的是 `checkins`**（连击只看它），账本里只留花了多少钱。补回的那天**不进**
  成就的连击判据（那条按 reviews 现算）——那天没学就是没学。只补今天 −1..−7 的洞，
  第一次打卡之前的日子不算洞。
- **补签卡**（2026-09-23）：发卡记 `card`（amount 0，key = 来源）、用卡记 `repair_card`（key = 补的那天），
  持有 = 两者之差，**最多存 1 张**，已有一张时再得到的那张记 `card_overflow` +80 柚子。同一来源只发一次。
  用卡不抬补签价（`repairPrice` 只数 `repair`）。现在唯一来源是「开通 Pro 送一张」（key `pro`，每账号一次，
  `settleYuzu` 里发；**试用不算开通**，否则开试用就白拿）。商店补签有洞时，非 Pro 且没领过的旁边摆
  「开通 Pro 送一张补签卡」跳 Pro 页。两台设备各自发卡、合并后可能是 2 张，没加闸。
- 装备槽（theme / mascot / icon / sound）存 `app_state` 的 `yuzu_equipped:<category>`，lww 同步。
  买了槽位空着就自动装上。`applyYuzuEquipment()` 把装备落到运行时，启动时（`main.tsx`
  库就位后）和每次买 / 换都调。已接线的三样：
  - **配色**：写 `<html data-skin="theme-*">`，`styles.css` 里每个皮肤浅色 + 深色各一份
    `--zoo-*` / `--color-accent*` 覆盖。⚠️ 只换主色一族和底色，`--zoo-orange` / 棕 / 文字色不动 ——
    柚子和吉祥物在哪个皮肤里都还是自己。少写深色那份 = 换皮肤后切深色退回默认绿，看着像坏了。
  - **风格主题（纸本 `theme-paper` / 圆圆 `theme-round`，2026-09-23）**：同样是 theme 槽位，
    但不只换颜色变量，还换质感（投影、描边粗细、按钮立体底边、主键颜色、字体），
    样式单独在 `src/skins.css`，**在 `main.tsx` 里排在 app.css 之后**才压得住浅色翻译层的 `!important`。
    来源是作者从三个视觉方向效果图里挑的 A（纸本）和 B′（圆润·收集日版）。
    ⚠️ 圆圆不许用 Duolingo 的绿 / 蓝 / 红，也不许把连击 + 货币摆成它那种右上角胶囊（苹果审核 4.1 Copycats）。
    ⚠️ 评分键按 DOM 顺序 `nth-child(1..4)` 认，`answerOptions` 改了顺序这里要跟着改。
    ⚠️ 商店迷你主页的 `data-skin` 挂在 div 上不在 html 上，所以 skins.css 末尾给商品图单独写了一段。
  - **声音**：商品 id 是 `voice-<音频库 voice id>`（现在 voicevox-10 / 11 各 600），索引里 `default`
    那个免费。`speech.resolveVoice` 按 `voiceUnlocked` 设门（没买的退回默认，以前选过的也一样），
    设置页下拉把没买的 `disabled` 并标「柚子商店解锁」。⚠️ `speech.ts` 因此多了唯一一个 import；
    测试里没有库时 try/catch 放行。
  - **音效**：`zoo-sounds.setSoundTimbre`，只换波形和衰减（marimba 正弦更短、epiano 锯齿过低通），
    Shepard 音高逻辑一个字不动。
  - **吉祥物皮肤**：一套皮肤 = `public/brand/sheet-<皮肤>/` 下和默认那套**同名**的一批贴纸，
    `Sticker` / `BrandIcon` 按 `setMascotSkin` 切目录（`useSyncExternalStore`，换装备所有贴纸同一帧重画）。
    现在只有鳄鱼（`mascot-croc`，300）：作者的五张鳄鱼分图在 `~/收集日/` 顶层（1448×1086），
    `scripts/brand-sheet/cut-croc.sh` 裁出 32 张（坐标是按行/列墨水区间量的）。
    ⚠️ 皮肤没有的格子退回默认水豚（工具盘小图标、气泡、走路帧 —— **小路上走的仍是水豚**），
    但**表情缺的退回这套皮肤的默认表情**，不能退回水豚：一屏两种动物比少一个表情糟。
    鳄鱼的 `app-icon` 是分图里自带深蓝底的那格（`roundmask` 量出来 552×544、R≈106），浅色主题也用它。
    ⚠️ `upcut.mjs` 多了 `SAT` 环境变量：鳄鱼分图有两格是奶油 / 淡粉底（饱和度 ≈ 24），默认的 20 抠不掉。
  ⚠️ **商品图 `<img onError>` 里不许 `remove()` 节点** —— 那是 React 管的节点，拆了它下次 diff 直接
  `insertBefore` 抛错、整页进 ErrorBoundary（实测点一下换商品就白屏）。用 `visibility:hidden` + 按 src 当 key。
  `soon: true` 的商品（App 图标 ×2、走法 / 周报封面 / 队伍称号）货架上露脸但不卖：图标要 Capacitor 换图标插件，其余等图。
- 结算挂在学习页 flush 那一下（和 `checkAchievements` 同一处）和商店页打开时，幂等。
  连击那笔要求今天已打卡且 `streak % 7 === 0`；今天没打卡时 `computeStreak` 数的是昨天的，
  不发。
- **余额条 + 试衣台是 sticky 的**（`.yz-sticky`，`top:-1rem` + `padding-top:1rem` 盖住 main 的 `pt-4`，
  否则那 16px 里会露出滚过去的货架）。补签**是货架上第一件**，不另起一行：价格是 `repairPrice()` 算的，
  选中它试衣台上一天一颗「补 9/18 · 50」，没洞时按钮灰掉。
- 商品图不走单独的文件：**配色 / 皮肤商品画一张迷你主页**（`YuzuShopPage` 的 `MiniHome`，外层挂
  `data-skin` + `data-theme`，styles.css 里的皮肤变量就落在它身上，所见即买到），其它按 catalog 的 `art`
  取总表上本来没用上的格子（开心图标 = `mood-happy`、音效 = 气泡、周报封面 = `card-daily`、
  走法 = `walk-frame`（走路帧第一格）…）。⚠️ `.yz-art>img` 那条绝对定位只能作用在直接子级，
  写成 `.yz-art img` 会把迷你主页里的贴纸也铺满整格（踩过）。
- **声音 / 音效商品有「试听」**：`speech.previewVoice(id)` 不过购买那道门（没买的当然要能试），
  例句库有这个声音就播一句例句，没有退回单词 勉強；`zoo-sounds.previewTimbre` 临时切音色连对三下再切回，
  不看「答题音效」开关。
- 作弊面：把 dailyGoal 调到 5 或在词库批量标熟知就能「清完计划」—— 单机外观币，骗的是自己，不加闸。
- 判据在 `yuzu.test.ts`：不重复记账、连击第 7 天才发、补签窗口和阶梯价、补完连击接上。

### 2026-09-29 逐件核查：网页六类商品全部能用；小程序的三类「买了没效果」已改成「资源没就绪就不卖」

用户还没挨个点过，所以在独立端口（灌了柚子余额）对 `yuzu-catalog.ts` 的每一件真买、真装、真读了运行结果。小程序那一列是**读代码得出，没在开发者工具 / 真机里点过**：

| 商品 | 网页 | 小程序（Taro） |
|---|---|---|
| 5 个配色 / 风格主题 | ✅ 浅色 + 深色下 `data-skin` 都换、`--zoo-primary` 各不相同（圆圆主色和默认相同，靠质感区分，不是 bug） | ✅ `WeappPage` 把 `skin-<id>` 挂在页面根节点 |
| 鳄鱼吉祥物 | ✅ 表情 / 空状态 / 图标全走 `sheet-croc/`，缺的表情退回鳄鱼默认表情 | 原来 ❌（`setMascotSkin` 是空函数，包里没有鳄鱼图，买了什么都不变）。现已实现，见下「小程序皮肤」，**云端上传前商店里是「即将上架」** |
| 声音 雨晴はう / 玄野武宏 | ✅ 索引三个声音、文件 200（本机 `public/audio` 在，线上网页没有，见下） | 云存储只传过默认声音 `voicevox-8`（`wechat-miniprogram/README.md`）。商店现在按声音索引判断，索引里没有就是「即将上架」；补传后自动变成可买 |
| 音效 木琴 / 电钢 | ✅ 音色变量正确、`previewTimbre` 不报错 | ✅ **有替身**：`wechat-miniprogram/scripts/shared/shims/zoo-sounds.js` 把音合成 WAV 交给 `InnerAudioContext`，三种音色都支持 |
| `soon` 五件 | ✅ `buyItem` 返回 false | 同左 |

⚠️ **更正（同一天）**：这张表第一版写的是「小程序答题音效整个是静音的」，是错的——只搜了 `taro-spike-2` 和 `runtime/`，漏了 `scripts/shared/shims/`。
据此还白让 Codex 做了一份 `wx.createWebAudioContext` 适配，整份丢弃。**判断小程序有没有某项平台能力，先查 `scripts/shared/shims-map.mjs`**：
`frontend/src/lib` 里好几个模块（zoo-sounds、speech 以外的存储 / 触感 / 分享）在小程序里都是被替身换掉的，直接读 `lib/` 源码会得出错误结论。

⚠️ 网页线上版没有预生成音频（那 137 MB 不在仓库里，见「网页版默认没有预生成读音音频」），所以线上网页的两个付费声音同样是「即将上架」，直到 `AUDIO_ARTIFACT_URL` 发布。

#### 商店可用性闸门（`lib/shop-availability.ts`）

**2026-10-12 增补：声音名单改读腾讯云开发音频包总索引。** `availableVoices()` 来自共用 `speech-packs.ts`：免费 `voicevox-8` 可先提供已有音频，付费 `voicevox-10/11` 必须在新索引中存在且 `complete: true`（单词、单词例句、语法例句的源音频全部齐全）才可买/装备/试听。背景生成尚未结束时两个付费声音继续显示「即将上架」，不以目录存在或本机有几条样本当成可售。三端使用同一判断；资源就绪后作者重跑生成并上传 `--packs`，用户下次启动读到新索引自动开放。下面 `AUDIO_ARTIFACT_URL`、`--audio` 的旧补传步骤已被音频包取代，保留作历史记录。

**商品在当前平台资源没就绪，就当 `soon` 处理：不能买、不能装备、不出试听；已拥有但本设备不可用时按钮写「此设备暂不可用」。**
全部用能力检测，不按平台名分支：声音 = `speech.availableVoices()` 里有没有这个 id；音效 = `zoo-sounds.soundAvailable()`
（网页看 `AudioContext`，小程序替身自己回答）；皮肤 = `mascotSkinReady(id)`。购买和装备入口再各查一次。
以前的问题是「先买、再说会下载」——那句文案是给弱网设计的，前提是**云端真有这个文件**，而 catalog 不知道云端有什么。
⚠️ **以后新加要靠外部资源的商品，必须接进 `itemAvailable`，不能只往 catalog 里加一行。**

#### 小程序皮肤（鳄鱼）：图放云存储，装备时下载

主包只剩十来 KB，皮肤图进不了主包，也不能进分包（主包页面用不了分包里的图），所以：

- 名单只有一份：`frontend/src/lib/mascot-skins.ts`（纯数据），网页和小程序共用，网页 `CapybaraMascot.tsx` 从它派生，行为不变。
- `taro-spike-2/scripts/build-skin-assets.mjs` 把 32 张原图按「被渲染的最大高度 × 2」缩小 + pngquant，整套约 1.2 MB，
  输出到 `taro-spike-2/skin-dist/`（生成物，gitignore）和 `manifest.json`（版本 = 内容哈希前 8 位）。
- 上传：`cd wechat-miniprogram && TCB=<tcb 路径> ./scripts/upload-cloud-content.sh --skins`（要先 `tcb login`，本机 tcb 不在 PATH 里）。
  manifest **最后**传，文件没到齐时不会有人下到 404。云端地址 `config.js` 的 `skinBaseUrl`。
- 客户端：`mascot.weapp.tsx`（主包，只做同步选路径）+ 懒加载的 `mascot-skin-cache.weapp.ts`（取 manifest、逐张下载到
  `USER_DATA_PATH/skins/<id>/<版本>/`、换版本删旧目录、失败不留半成品）。冷启动先同步看本地缓存，齐了不等网络。
  没下完之前用水豚，下完派发 `MASCOT_SKIN_EVENT` 全部贴纸一起重画。
- 判据：`taro-spike-2/scripts/mascot-skins-smoke.mjs`（假 `wx`：manifest 拿不到不抛错、下载路径、冷启动、回退三规则、换版本、中途失败）。
- 主包增量 2.8 KB（1,885,349 → 1,888,115），此后主包只剩约 12 KB。

**补传声音**（云端还没有时）：`cd wechat-miniprogram && VOICES="voicevox-8 voicevox-10 voicevox-11" UPLOAD="voicevox-10 voicevox-11" TCB=<tcb> ./scripts/upload-cloud-content.sh --audio`，
每个声音约 45 MB。传完商店里两个声音自动变成可买，不用发版。

### 2026-10-19 逐件补齐：走法 / 队伍称号 / 备用 App 图标

作者问「商店里一大堆东西还没完整做好，一个一个查具体是什么情况、做好」。逐件核查后：配色 ×5、鳄鱼、音效 ×2、声音 ×2 本来就能用
（鳄鱼皮肤包和两个付费声音在**小程序**里能不能买，取决于云存储里传没传，本机查不了，见上面两节）；剩下五件 `soon` 的按作者当天的决定处理：

| 商品 | 作者的决定 | 现状 |
|---|---|---|
| 小路走法 → 「滚着走」 | 「本来就不应该移除一开始的走法」 | ✅ 做完。顶栏小路恢复走路的水豚；`walk` 槽位，8 帧滚动版 |
| 队伍称号 ×6 | 做，服务端部署作者来 | ✅ 代码做完；**上线要先迁移 0020 再切流量** |
| 备用 App 图标 ×2（开心 / 泡汤） | 图让 GPT 生成 | ✅ 做完，仅 iOS App 里能买能换；真机 / 模拟器点换图标要验 |
| 周报封面 | 等周报重做完再说 | ⏳ 仍是 `soon`，别动：v3 周报还没重做，现在做封面大概率白做 |

**走法（`walk` 槽，商品 `walk-alt`「滚着走」，4000）**
- v3 的 `99485957`（背词页陪伴水豚）把小路上走路的水豚换成了 lucide 图标，作者否决。**默认模式（今日复习）和 `mixed` 用 `CapybaraWalk`；错题本 / 反向 / 汉字仍是 lucide 图标**（emoji → lucide 是另一个决定，没动）。
  陪伴水豚已搁置（`STUDY_BUDDY_SHELVED`），所以不存在「一屏两只」。若哪天陪伴水豚恢复，小路上的这只要重新和作者对一次。
- `CapybaraMascot.tsx` / `taro-spike-2/src/platform/mascot.weapp.tsx` 各有 `setWalkStyle` + `useWalkStyle`（`useSyncExternalStore`，和皮肤同一个写法）；
  `applyYuzuEquipment` 传 `equippedItem("walk")`，所有已挂载的 `CapybaraWalk`（小路 + 各页加载）同一帧换。默认 4 帧 248:272 / 640ms，滚动 8 帧 545:334 / 1280ms，帧数和时长走 CSS 变量 `--walk-frames` / `--walk-duration`。
- ⚠️ 滚着走的格子比走路宽（545:334），顶栏 `--zoo-trail-tail` 因此从 56px 加到 88px（小路本身短了约 32px）。
- 素材：`roll-strip.png` 网页版 1.2 MB → 78 KB；小程序版（`taro-spike-2/src/assets/brand/roll-strip.png`，主包）高 144、**40 色**、35 KB。
  **小程序主包 1,825,518 → 1,861,428 B（上限 1,900,000），余量只剩约 38 KB。** 下一个往主包加东西的人先看这个数。
  `sync-brand-assets.mjs` 对 `roll-strip` 单独取整宽度（须被 8 整除，否则每格采样到相邻帧）。

**队伍称号（`title` 槽，6 个商品，各 3000）**
- 商品：`title-early` 晨读派 / `title-night` 夜读派 / `title-hunter` 单词猎人 / `title-slow` 慢慢来 / `title-grove` 柚子庄园主 / `title-capy` 水豚本豚。
  key 的**唯一一份**在 `frontend/src/lib/yuzu-titles.ts`（`YUZU_TITLE_IDS`），catalog 和 Worker 白名单都引用它。
  单买单装备，槽位 `yuzu_equipped:title`（lww 同步）；第一件自动装备，买第二件不抢占，点「使用」才替换。
- 服务端（`cloudflare-sync/src/index.ts`）：迁移 `0020_team_member_title.sql`（`team_members.title TEXT` 可空）；`PUT /api/teams/title`
  `{title: 六个 key 或 ""}`，鉴权 / 限速（team-write 每账号 30 次 / 小时）/ 错误形状沿用别的组队接口，非法 key 400，未入队 404；队伍详情的每个成员多一个 `title: string | null`，**只加字段**。
- 客户端：组队页名字旁一枚浅底主色字的胶囊（`team-activity.ts` 的 `watchTeamTitle` 订阅 `YUZU_EVENT`，装备槽真的变了才推；进组队页时和服务端自己那条比，不一致才推）。
  **失败一律静默**（断网 / 旧服务端 404 / 限速），下次进组队页再试；未知 key / 缺字段 / 旧版本不显示任何东西。商品图是纯 CSS 的迷你名单，没有新图片。
- ⚠️ **服务端不知道谁买了什么**（柚子账本在客户端，随快照同步），只校验白名单：改过客户端的人能挂上没买的称号。纯外观，和「单机外观币，骗的是自己，不加闸」同一口径；
  如果以后称号要有「稀缺」含义（比如限定），这里就得改成服务端校验。
- ⚠️ **部署顺序：先迁移，再让新 Worker 接流量。** 新 Worker + 没有 `title` 列的库，组队的 SELECT / UPDATE 全部报错，旧客户端也受影响。`/api/health` 的 `migrationsApplied=true` **不能证明 `title` 列已加**（那份清单只列表名）。
  阿里云自托管的完整命令（停服务 → `.backup` 备份 → 解包 → 用 `openDatabase` 跑增量迁移 → 查列 → 启动 → 回退 / 四种新旧组合）在 `docs/TEAM_TITLE_DEPLOY.md`（**线上一步都还没执行**）；**不要用 `selfhost/migrate.mjs` / `install-migration.sh`**，那是 Cloudflare D1 全量搬家工具，阿里云已经切流，重新全量导入可能拿旧 D1 覆盖新服务器数据。

**备用 App 图标（`icon` 槽，`icon-happy` 开心 / `icon-onsen` 泡汤，各 5000）**
- **默认 App 图标本来就是读书的水豚**，所以原计划的「读书图标」（`icon-study`）是和默认重复的，改成「泡汤图标」（id `icon-onsen`；旧 id 没人买过，可换）。两张图是 GPT 按默认图标的画风生成的，1024×1024、无 alpha、整张铺满（iOS 自己切圆角）：
  `frontend/ios/App/App/Assets.xcassets/AppIconHappy.appiconset/AppIconHappy-1024.png`、`AppIconOnsen.appiconset/AppIconOnsen-1024.png`。换图只覆盖这两个路径（保持文件名和 Contents.json），不用改代码。
- 原生：App target 里的本地 Capacitor 6 插件 `AppIconPlugin.swift`（jsName `AppIcon`，`getCurrent` / `set`）；构建设置 `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "AppIconHappy AppIconOnsen"`（Debug / Release 各一处，由 actool 生成 `CFBundleAlternateIcons`，没手写 Info.plist）。
  ⚠️ **Capacitor 6 里 App target 内的本地插件要显式注册**：`Main.storyboard` 唯一的 controller 改成了 App 模块的 `AppBridgeViewController`，它覆写 `capacitorDidLoad()` 调 `bridge?.registerPluginInstance(AppIconPlugin())`；
  不要换成 `registerPluginType`（这个版本自动注册模式下直接 return）。别的插件仍走自动注册，没碰。
- 前端 `lib/app-icon.ts`：`appIconAvailable()`（iOS + 插件在）；`setAppIcon(itemId)` 串行排队、**先 `getCurrent` 再 `set`，名字相同不调原生**（iOS 每次真换图标都弹系统提示「你已更改了…的图标」，不能没变也弹）；失败静默；
  `main.tsx` 启动时 `syncAppIcon()` 对账一次（别的设备同步来的装备也会落到这台）。`equipItem` / `unequip` / `buyItem` 对 `icon` 类在非 iOS 上直接拒绝。
  小程序用 `wechat-miniprogram/scripts/shared/shims/app-icon.mjs`（经 `shims-map.mjs` 整模块替换，恒不可用）。
  商店页：不可用且没买的图标按钮写「仅 iOS App 可用」，已拥有但本设备不可用写「此设备暂不可用」。
- ⚠️ **小程序里「泡汤图标」商品图曾是空白**：`scene-onsen` 没登记进 `sync-brand-assets.mjs` 的内容分包名单。**以后商品 `art` 指向哪张贴纸，要同时登记到小程序的素材名单里**，网页里看不出缺（网页直接读 `public/brand`）。
- Xcode 27 本机构建（worktree 里没有 Pods 时要先 `cd frontend && npm run build && npx cap sync ios`，再 `cd ios/App && pod install`；`cap sync` 会因 node_modules 软链改 Podfile 路径，要还原）：
  独立 `-project` 编不过（Capacitor 的 Pod 依赖不在依赖图里），要用 `-workspace frontend/ios/App/App.xcworkspace -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' IPHONEOS_DEPLOYMENT_TARGET=16.4 build`
  （Pods 里的 iOS 13 / 14 最低版本会被 Xcode 27 拒绝，只在命令行覆盖，没改 Podfile / pbxproj）。

**判据（以后再加商品）**：① 要靠外部资源的商品必须接进 `itemAvailable`；② 商品 `art` 用的贴纸要登记进小程序素材名单；③ 货架上露脸但没做的商品保持 `soon`，别为了「货架满」去掉。

## 拉新邀请码：专属套装 + 按被邀请人正常收入乘倍率（2026-10-26）

作者要去学校日语班宣传前要的「邀请码机制」。规则是作者逐条拍板的（同一天三轮改稿），**数字别自己改**：

| | 新号（被邀请人） | 邀请人 |
|---|---|---|
| 柚子 | 绑定后 30 天内，自己每笔正常收入再多得 ×1.0（`referral_invitee`） | 同期被邀请人正常收入 ×0.5 向下取整（`referral_inviter`），终身封顶 10,000 |
| 套装「柚友」 | 绑定后第一次清完当日计划 | 任一被邀请人在绑定后 14 天内学满 3 个不同日子 |

- 套装 = 主题 `theme-dusk`「晚霞」+ 队伍称号 `title-yuyou`「柚友」，`invite: true`，**商店里不卖**（`buyItem` 拒绝），按钮写「邀请获得」。
  发放就是记两行 `buy` / amount 0，`ownsItem` 不用改。图标那件（两只水豚）作者同意以后再做。
- 「正常收入」白名单只有 `study / plan / streak / encore / focus`。**不算成就**（新号前几天一口气解锁一堆，会把倍率冲高）、
  **不算组队 / 对战**（两人多半同队，会重复发）、**不算以后花钱买的柚子**（充值就能放大奖励）。以后新加收入种类，默认不进白名单。
- 邀请人倍率 < 1 是防刷的核心：开小号学一天，邀请人只拿一半，不如在自己号上学。
- 不按「答得好」发，所以和本节开头「柚子只奖做完了」不冲突；它是对「做完了」的收入再乘一次。

**谁算账**
- 新号那份在**本机**按自己的账本逐行镜像（key = `${kind}:${key}`，天然幂等、union 同步不重复）——和「单机外观币骗的是自己」同一口径，不经服务端。
- 邀请人那份由 **Worker 结算**：新号把窗口内白名单行 POST 到 `/api/referral/earnings`，服务端校验种类、单笔上限（study/plan/encore 50、streak 300、focus 100）、
  窗口、**每人每天合计 ≤ 700**，在 INSERT 语句里算终身 10,000 余额（并发请求也冲不破）；邀请人从 `GET /api/referral/me` 的 `rewards[{id, amount}]` 拉结算行入账（key = 行 id，不暴露对方账号 id）。
- 改过客户端能伪造上报，损失被每日 700 和终身 10,000 两道封顶限住。
- `title-yuyou` 是第一个**有稀缺含义**的称号，所以 `PUT /api/teams/title` 对它查服务端解锁状态（上面 10-19 那节说过「称号要稀缺就得改服务端校验」，这里就是）。只有设的是它才查邀请表，所以 Worker 先上、迁移没跑时别的称号照常。

**绑定的限制**：两边都要登录；账号 `users.created_at` 7 天内才能填；一辈子只绑一次（主键）；不能填自己的码；
和邀请人最后一次上报的设备号相同也拒绝（`getDeviceId()`）。填码限速每小时 10 次。码 6 位，字母表和组队码同一套。

**界面**
- 主页：问候语**下面**一条「有邀请码？」（× 永久关掉，`referral_banner_dismissed`），只给本机最早学习日在 7 天内（或没有记录）、本账号没绑定过的人看；
  组队格旁边加「邀请好友」格（JLPT 格改成占满一行）。
  ⚠️ 横幅最早放在问候语**上面**，右边的 × 被周报那根挂绳叶子（`zoo-weekly-cord`）盖住、点不到，所以挪下来了。以后往主页顶部塞东西先看那根绳。
- 邀请页（网页路由 `invite`，小程序 `study/invite` 分包）：码的票根沿用组队邀请码样式、复制 / 分享（小程序分享路径带 `?ref=`，**只预填不自动绑定**，和组队一样）、
  「已邀请 N 人」、能绑定时的输入框、规则一行。
- ⚠️ **小程序里不出现任何奖励字样**（柚子 / 奖励 / 套装 / 翻倍）：微信禁止诱导分享，「邀请好友得奖励」正是被罚的那种。文案差异放在 `lib/referral-copy.ts` / `referral-copy.weapp.ts`，
  `taro-spike-2/scripts/referral-smoke.mjs` 查构建产物。奖励照常发，只是不在小程序里宣传。
- ⚠️ 作者明确说过：**不要强调同学 / 学校**，就是普通邀请码。文案里别出现「同学」「学校」「班」。

**上线**：先在阿里云跑迁移 `0021_referrals.sql`，再让新 Worker 接流量，步骤见 `docs/REFERRAL_DEPLOY.md`（线上一步都还没执行）。
账号删除时三张表**不级联清空**（防止删号重算冲破封顶），只剩内部 id 和金额；要是以后审核对删号数据有意见，这里是要改的地方。

## 成就：判据现算，不攒计数器

`lib/achievements/` — 47 个成就。**判据全部从 reviews/progress 现算**（`stats.ts`），
解锁记录进数据库 `achievements` 表（`union` 策略同步，解锁不可逆）。

- 好处是**加新成就时以前达成过的会自动补发** —— 没人愿意为了拿成就重学一遍
- `stats.ts` 的字段是**懒算并记住的**：结算只碰「还没解锁的那些」用到的字段。
  全算一遍 281ms，而学习页每分钟结算一次 —— 拿到「先冷静」之后那两条 window function
  连击查询就再也不会跑了
- 缺表要返回 0 而不是抛错（老库没有 word_notes / content_favorites）
- 成就页打开时会当场结算，否则会出现「进度条 8/1 却还锁着」
- **图标是 lucide，不是 emoji**（2026-09-29，用户认为 emoji 不合适）。按 id 查的表在 `achievements/icons.ts`，
  **不放进 catalog**：catalog 是纯数据、会被打进原生小程序的 `web.js`，那边不能出现 lucide-react。
  `achievements.test.ts` 那条钉着「每个 id 都有图标、没有两个成就共用一个图标」。
  ⚠️ **只给成就页用，全局弹窗（`AppShell`）只放一个 `Trophy`**：Taro 的 lucide 是按路由预生成的 SVG，
  被 tab 路由 / AppShell 引到的会全进主包，而主包离 1.9 MB 上限只有十几 KB（2026-09-29 实测 15 KB）。
  成就页在 `content-pages` 分包里，47 个图标只让它涨了约 29 KB，主包只多了 0.9 KB（导出表和分包清单）。
  （2026-10-02：词库 / 快速复习 / 疑难辨析 / 一字多音四页的样式（`wl-` / `quick-` / `cf-` / `kr-`）由 `split-route-css.mjs` 挪进 study 分包，
  主包 1,894,988 → 1,858,484 B，腾出约 36 KB。`cf-` 两页都用，各放一份；`ach-`「我的」页也用，没动。判据在 `split-route-css.test.mjs`。）
  加新成就图标要在**三处**登记：`icons.ts`、`taro-spike-2/scripts/build-lucide-icons.cjs` 的 `names`、
  `taro-spike-2/src/platform/lucide.weapp.tsx` 的导出，然后重跑 `node scripts/build-lucide-icons.cjs`。
  「我的」页那句「共 N 个」用 `count.ts` 的常量而不是 `ACHIEVEMENTS.length`（后者会把整份 catalog 拖进主包），一致性由测试钉住。

**前车之鉴：`userProfile` 里那份 `studyTimeMinutes` 自攒计数器从来没涨过** ——
它收秒、每 15 秒 flush 一次、`Math.floor(seconds/60)` 恒为 0。学习时长和天数现在一律
问数据库要（`study-totals.ts`），和统计页同口径。**别再在 Preferences 里攒第二份账。**

## 完成页日历的「学习 N 项」= 减负 + 单词 + 语法，和小路同一口径（2026-09-19）

用户报「日历上的数和别处对不上」：同一天日历写 364、学习页小路写 407。差的是两样：
**减负卡**（每天 6~12 张，不写 `reviews`、不进 FSRS，只在 `app_state.daily_relief_v2`
留今天这一份）和**混合模式插播的语法**（在 `grammar_reviews`，另一张表）。
用户定的是「统一口径都要加进去」，所以 `dailyStudyStats` 现在每天给
`wordCount / grammarCount / reliefCount / total`，日历格、tooltip、完成页那格全用 `total`，
tooltip 底下再列一行拆分。

- ⚠️ **往日的减负数是按当天判据重算的**（`dailyReliefCount`）：减负当天演完就没有痕迹，
  而 `app_state` 是按 key 同步的 lww 表，**不许拿日期当 key 写日志**（grammar-quiz 里
  `encoreKey` 那条注释说的同一件事）。重算 = `reliefCountFor(reliefCandidates(day),
  previousStudyWordCount(day))`，实测最近 14 天每天都是 12，和当天发的一致。
  只有两种情况会偏：那天根本没打开学习页（调用方只对有作答的日子重算），
  新设备上 14 天以前的 `stage1_tasks` 没同步过来（候选多几个，封顶 12）。
- **分享图和累计里程碑仍按单词算**：图上写的是「词」，`MILESTONES` 比的是单词累计，
  混进语法和减负就是假数。
- **主页「每日」那张图没动**：它是积压图，右半边是按到期词预测的，语法和减负预测不了，
  加到左半边就是左右两把尺子（见「进度概览的三档」那节「只数正向」的理由）。

## 收藏夹：夹名就是行身份；完成页给当天顽固词一个出口（2026-09-01）

`favorites-api.ts` + `components/FavoriteFolderPicker.tsx` + `word-api/stubborn-today.ts`。

**收藏夹不是新的一层数据，只是 `content_favorites` 上多一列 `folder`。**
`favorite_folders` 那张表只为了让「建好但还没往里放东西」的夹子活得下来。

- ⚠️ **夹子的身份是它的名字，不是自增 id** —— 同步表的行身份绝不许用自增 id
  （见 `sync/tables.ts` 开头），两端各建一个「考前突击」必须是同一个夹子。
  代价是改名要连带 `UPDATE content_favorites SET folder = ?`，一句就做完了。
- **夹子清单 = 建过的夹子 ∪ 收藏行上出现过的夹名。** 后半段不是冗余：对端删了夹子、
  这台还有收藏挂在上面时（`favorite_folders` 走 union 合并，删除靠墓碑），
  光看 favorite_folders 会让那些收藏在「全部」以外的任何视图里凭空消失。
- ⚠️ **删夹子不删收藏**，里面的东西回到未分类。测试里钉着这条。
- ⚠️ **一个夹子都没建过时不弹选择框**，直接进未分类。收藏本来是一下点完的动作，
  给从没用过分类的人加一次弹窗是纯摩擦；夹子是用户自己建出来的，建了才问。
- **「收进哪个夹子」只有一份实现**：`useFavoriteFolderPicker`。学习卡星标、词库详情、
  语法列表、沉浸阅读、收藏页移动、完成页顽固词，六处共用。别再写第二个选择框。
- 选择框是 portal，但**要挂在会 stopPropagation 的那层里面**（词库详情 `wl-sheet`）——
  portal 的事件仍按 React 树冒泡，挂外面点收藏夹会撞上遮罩的 onClose 把详情关掉。
- 新表照例三处登记：`sync/tables.ts`、`scripts/user-data-tables.mjs`（泄漏守卫）、
  `legacy-word-migrations` 的合并搬迁（那句 INSERT 要把 `folder` 一起带走，
  否则合并重复词条会把手动分好的夹子悄悄清成未分类）。
- ⚠️ **浮层开着必须把按键吞掉**（`stopImmediatePropagation`，capture 阶段）。
  学习页的全局快捷键挂在 window 上：翻面前**按任意键**就翻面、翻面后 V/B/N/M 直接评分——
  不吞的话「选个收藏夹」这一下会顺手给 FSRS 灌一次假作答。输入框里的按键要放行，
  否则敲名字 + 回车建不了夹子。（`stopPropagation` 不够：按键的 target 常常就是
  body/window，同一节点上的其它监听器只有 Immediate 版拦得住。）
- 改名用行内输入框，不用 `window.prompt`：那是个没样式的系统框，而且在 WKWebView 里
  未必回得来。删夹子沿用 `window.confirm`（和「合并重复词条」同一套二次确认）。
- 市面上成熟的做法只抄了两条：**默认夹子不可删不可改名**（B 站的「兜底」，我们的
  未分类 = `folder = ''`，删不掉也改不了名，收藏永远有个去处）、**记住上次收进哪个**
  （Pinterest 把最近用过的板置顶）。**故意没抄**多级分组、把最近用过的夹子置顶
  （位置一动肌肉记忆就废了，只加一个「上次」角标）、以及**一条收藏进多个夹子**——
  多对多要另建一张关系表和一套多选 UI，而一个词该在哪一组的答案通常只有一个。
  真要多标签再说。

### ⚠️ 语法收藏从来就没在收藏页显示过（2026-09-01 查明并修复）

收藏夹的计数把它照出来了：角标写着 3、列表只有 2 条。

语法收藏存的是 `grammar.ts` 的**字符串 id**（`pdf-n5-001`，两处写入都是 `point.id`），
而 `getFavoriteItems` 解析语法用的是 `SELECT ... FROM grammar_points WHERE pattern = ?`
—— 出厂库里根本没有那个字符串 id 这一列，于是每条语法收藏都在 `flatMap` 里被静默丢掉。

id 是全应用的语法身份（详情页、furigana 表、进度都按它走），**不改存的东西**：
查不到的行原样交出去（标题留空），由收藏页按需 `import("../data/grammar")` 补标题、
释义、等级。那份 1.2MB 的语法数据只在真有语法收藏时才拉，不进主包。

### 完成页的「今天的顽固词」

判据是**两条都要满足**（2026-09-01 收紧，原来是 OR）：累计点过 > 8 次「忘记」
**且**今天答错 ≥ `STUBBORN_DAILY_MISTAKES`(3) 次。

⚠️ **单看累计不行**：忘过 20 次的词今天一次就答对了，它今天并不顽固 —— 按 OR 算，
这张表就成了「今天露过面的所有顽固词」。**单看当天也不行**：新词头一天磕三次是正常的
学习过程。要的是「历史上就难 + 今天又打了一架」的交集。

⚠️⚠️ **累计数的是 `progress.forgot_count`，不是 `fsrs_lapses`。** 两者听着一样，差一个
数量级：`fsrs_lapses` 只在**复习态**的卡答错时 +1（当天重学阶段再错多少次都不加），
而且顽固词每天最多放 `LEECH_DAILY_INTAKE`(10) 个进计划。第一版写成 lapses，实测用户库
2026-08-26~09-01 每天只有 **0,1,1,2,1,0,1** 个 —— 那张表几乎永远是空的，用户当天就报
「快速复习当天顽固没出来」。换成 forgot_count 后同期是 **6,9,11,14,23,16,15**（均 13 个）。

- **单词那张表只数 `direction='forward'`**：和主页「每日学习量」同一把尺子
  （见「只数正向」那条）。
- **语法另算一段，判据一模一样**（`getStubbornGrammarToday`，2026-09-06 加）：
  `grammar_progress.forgot_count > 8` 且今天 `grammar_reviews` 里错 ≥ 3 次。
  混合模式里语法和单词是同一场，完成页只列单词等于说了一半。没答过语法的日子这段自己
  就是空的，所以不用按模式加闸。实测用户库 2026-09-06（当天答了 290 条语法）出 8 行，
  和单词那张表一个量级 —— 阈值不用为语法另调。
  ⚠️ **语法行没有收藏按钮**：语法收藏存的是 grammar.ts 的字符串 id，而这里只有
  `grammar_points` 的数字 id，桥接得按 pattern 去翻那份 1.2MB 的语法数据
  （见「语法有两份进度」）。为一颗星把它拉进完成页不划算，收藏和攻坚都在语法列表页。
  「快速复习」按钮同理只带单词（`QuickStudyPanel` 是词的批次模式）。
- **只在完成页现算一次**：判据要数今天的流水，而这一页是今天最后一次结算，查早了数还没记全。
- 它是**出口不是攻坚入口**：一览 + 一键收藏，没有评分按钮（答案全露着时评分等于给 FSRS
  灌「记住了」，和辨析气泡、词库详情同一个道理）。集中攻坚仍然走错题本模式。

### 往日顽固词：同一条判据换个日期，这一档是 Pro（2026-09-09）

完成页顽固词卡的头部多一颗「往日」，点开是一张按天倒序的清单（日推历史那种翻法），
点某一天看那天跟你打过架的词。`getStubbornHistoryDays()` + 给两个 getter 加了个
`day` 参数 —— **没有第二条判据**：历史用的就是今天那张表的同一段 SQL，只是换了日期。

- ⚠️ **判据里的「累计忘过几次」是 `forgot_count` 的当前值，不是那天的值。**
  所以历史是「以今天的眼光回看那天」：一个词上个月只忘过 3 次、这个月忘到 12 次，
  它会补进上个月那天的名单里。要按当天的累计算，就得对每个 (天, 词) 数一遍截止那天的
  流水；而今天那张表本来就是拿 forgot_count 说话的，**两处口径分家比这点偏差贵**。
- **日期列表不在 SQL 里 LIMIT**：单词和语法各查一次再取并集，先截断会让两边的日子对不上。
  实测用户库 83 天、单词那条查询 30ms 上下，进这张浮层时查一次。
- ⚠️ **今天没有顽固词的日子，那张卡整个不出现** —— 所以那时候要单独摆一行
  「今天没有顽固词 · 翻翻往日」的入口，否则这个付费功能在状态好的日子里凭空消失。
- **没有评分按钮**（答案全露着时评分等于给 FSRS 灌「记住了」，同辨析气泡、词库详情），
  能做的只有一键收藏和「快速复习这 N 个」（走 `QuickStudyPanel` 的 wordIds 批次模式）。
- **Pro 门是 `FeatureId` 的 `stubbornHistory`，`FinishPanel` 自己弹 `Paywall`** ——
  不为一个按钮把 `requirePro` 从 App 一路穿过 WordStudy 传进来。
  ⚠️ **`Paywall` 的 `benefits` 列表要跟着改**：那几行是买之前看到的承诺，
  必须和真正锁着的功能对得上（现在锁着两样：沉浸式语法学习、往日顽固词）。
- 行样式抽到 `features/word-study/stubborn-history.tsx` 的 `StubbornWordRow` /
  `StubbornGrammarRow`，今日卡和历史浮层共用（**新文件导出、WordStudyPanels 引用**，
  反过来会成环）。

### 顽固词太多就不给加餐，改成「快速复习今天的顽固词」

当天顽固词 ≥ `STUBBORN_ENCORE_BLOCK`(30) 时，完成页把「继续学习 N 个」整块换成
「快速复习这 N 个顽固词」（走 `QuickStudyPanel` 的 `wordIds` 批次模式）。

⚠️ **30 是用户定的数，但实测他一天只有 6~23 个**，也就是只有最糟那一两天才触发。
所以顽固词卡片上**常驻**一个「快速复习」按钮，这个阈值只决定「要不要把加餐整个换掉」，
不决定这个功能出不出现。要让它天天触发，把 30 调到 10~15。
加餐是「今天状态不错，再来一批」；而今天有三十个词跟你打了一架的时候，
再塞新词进来只是把明天的账提前记上。

- ⚠️ **在「加餐」这一层，两者必须是同一笔账**（`recordStubbornQuickStudy` → `recordEncore`）。
  长期积压大的人根本见不到加餐按钮 —— 如果只有加餐记账，那就是**越吃力的人越拿不到
  加餐那一层的东西**（本周加餐次数、炫耀图上的加餐徽章、以后任何按加餐算的成就）。
  47 个成就本身都是从 reviews/progress 现算的，快速复习写的是正常流水，天然算数。
- ⚠️ **批次模式不写快速学习的草稿**（`persistDraft` 包了一层）。那份草稿是「今天那轮
  快速学习排到哪了」，拿一次性名单覆盖它，用户回去会发现自己评了一半的那页没了。
  批次过完就结束，不接着把今天剩下的词拉进来。
- 从别处进快速学习（`navigateToPage("quick-study")`）会清掉这批名单，否则点一次顽固复习
  之后，首页那个入口会一直停在那批词上。

### 收藏夹能直接开一场

收藏页选中一个夹子 → 「学这 N 个词」，走的是**自选清单**那条通道
（`focus: "picked"`，不看到期、不进今日计划、上限 300）。不新开通道：
「把一批词单独刷一遍」这件事词库页已经有了一份实现，收藏夹只是换了个选词的地方。

