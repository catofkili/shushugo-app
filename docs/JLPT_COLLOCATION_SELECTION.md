# JLPT 固定搭配候选：选词与分级说明

## 产物边界

- `frontend/scripts/jlpt-collocation-manual-review.json` 是完整选择决定源，`status=complete` 且 `pending=0`。
- `frontend/src/data/jlpt_collocation_candidates.json` 是从决定源生成的独立候选产物。
- `frontend/scripts/jlpt-collocation-translation-review.json` 是中文释义的逐条决定源，`status=complete` 且 `pending=[]`。
- `frontend/src/data/jlpt_collocation_content.json` 是运行时内容产物，只保留表记、读音、等级、类型、`ent_seq`、中文释义和来源标记；选择审计字段留在候选决定源，不进入首屏 bundle。
- 中文释义已经接入运行时迁移：下次正常启动时将把这些条目（v1 为 882 条，2026-10-10 的 v2 为 790 条，见文末「删减」一节）作为 `pos=固定搭配` 写入本地种子库。迁移按“表记＋读音”去重，不覆盖已有条目，也只为本次新插入的行建立 `progress`。
- N5–N1 是面向中国学习者的教学分级，不代表 JLPT 官方词表。

## 来源与许可证

主候选源为 EDRDG 的 **JMdict English XML Next Generation**，快照创建日为 2026-08-28：

- 下载地址：<https://www.edrdg.org/pub/Nihongo/JMdict_e_NG.gz>
- SHA-256：`a669ef152c50b2ab94f4cea80598e3982e1dca10df65b73bb8dc5d6cef384467`
- 许可证：CC BY-SA 4.0
- EDRDG 许可与署名要求：<https://www.edrdg.org/edrdg/licence.html>

JMdict 提供候选表记、读音、稳定 `ent_seq`、词类与语域标签。清单没有复制英文释义；`selection_reason` 与 `selection_evidence` 记录本项目的选择依据。筛选没有使用 MOJi、商业教材、来源不明 JLPT 词表或未经核验的词频阈值。

## 中文释义

中文层使用 [Tomoshi 开放数据的 `zh_defs`](https://github.com/tomoshi-app/tomoshi-dict-data/releases/tag/v2026-08-12) 作为 JMdict 衍生底稿；其项目代码和数据按 CC BY-SA 4.0 发布，署名与修改声明见 [Tomoshi LICENSE](https://github.com/tomoshi-app/tomoshi-dict-data/blob/main/LICENSE.md)。上游 JMdict 的许可与 EDRDG 署名要求见 [EDRDG license](https://www.edrdg.org/edrdg/licence.html)。本仓库只提取匹配的释义行，不把 Tomoshi 数据库打包进应用。

- 878 条能直接匹配 Tomoshi `zh_defs`；其中 875 条保留第一义并统一为简体中文标点，3 条匹配后人工清理无关义项，另有 4 条因 Tomoshi 缺失由项目人工补齐，最终为 875 条 `tomoshi_zh_defs` 加 7 条 `project_manual`。
- 所有 882 条均有非空中文释义，来源标记为 `tomoshi_zh_defs` 或 `project_manual`；中文释义不是由 MOJi 或商业教材导入。
- 本内容层只承载释义，不承载例句；没有为了凑数生成模板句。若将来扩展例句，必须另行逐条审核，避免把自由组合或不自然机器句子写进种子库。

构建与验证：

```bash
node frontend/scripts/build-jlpt-collocation-translations.mjs
node frontend/scripts/verify-jlpt-collocation-content.mjs
```

内容验证会检查候选、翻译决定源和运行时产物逐条一致、882 条全部有中文释义、来源许可证信息存在、来源标记合法且没有 MOJi 字样。

## 收录口径

每条必须至少符合一种情况：

1. 名词、助词和谓语之间有可指明的选择限制；
2. 整体义或语用功能不能稳定地由组成词逐字推出；
3. 属于需要整句调用的寒暄、敬语或场景表达；
4. 属于现代语境仍有实际辨识价值的谚语或四字熟语。

排除自由组合、孤立普通词、仅仅是活用后的语法片段、古语、方言、低俗语、仅专业领域表达和过冷表达。同一 JMdict `ent_seq` 的异写只保留一个现代教学表记；语义相同的异写或近重复族也只保留一个代表项。

## 为什么最终是 882 条（v1，2026-08-28；v2 又删了 92 条，见文末）

最初按精确配额形成的 1,200 条草稿未通过独立质量审计，原因包括冷僻表达、自由组合、错误低分级、普通四字名词误分类、重复族和模板式审核理由。它没有作为最终清单保留。

重建时不再设最低数量或按等级、类型回填：

- 全量复核旧稿中的 740 个 `idiom`，删除 208 个，保留项逐条应用审计建议的等级与类型；
- 合并全局审计的 94 个删除决定、78 个等级调整、23 个类型调整和 23 组重复族；
- 对重建后的 905 条再做一次全量终审，处理 18 个删除项、3 个“删除或改为规范表面”项、29 个类型调整、36 个等级调整、2 组新增重叠族和 4 个与种子库语义或礼貌度重叠项；
- 其余候选只从显式审核清单进入，并记录固定表面、JMdict 标签、明确的收录判断口径或人工审计证据；
- 不为接近原定 1,200 条而补入低置信候选。

其中两项非规范表面改用各自匹配的 JMdict 条目（`目を丸くする`、`夫婦喧嘩は犬も食わない`）；`手を携えて` 没有冒用别的 `ent_seq` 改写为辞书形，而是直接排除。因此 882 是两轮全量审计后的结果，而不是新的机械配额。完整结果为：

- JMdict 初始候选池：15,302 条；
- 与当前 `frontend/public/nihongo.db` 表记＋读音匹配而排除：190 个 JMdict 条目；
- 当前种子库 phrase-like 基线：93 条；
- 最终接受：882 条；待定：0 条；
- 等级：N5 17、N4 40、N3 238、N2 391、N1 196；
- 类型：collocation 313、idiom 402、routine_expression 53、proverb 54、yojijukugo 60。

基础固定表达已有一部分存在于种子库，且这次明确排除了现有条目，所以新增 N5/N4 数量不会人为补齐。中高阶较多，是因为需要整块识别的抽象搭配和惯用表达主要集中在这些等级；常用但结构简单的表达仍按 N5–N3 分级，没有统一塞到 N1。

## 重建与验证

```bash
node frontend/scripts/build-jlpt-collocation-candidates.mjs
node frontend/scripts/verify-jlpt-collocation-candidates.mjs
```

构建脚本以审核文件的真实数量和分布为准，不接受硬编码配额。验证脚本会检查：

- `pending=0`，审核源与生成产物逐条一致；
- `ent_seq` 与规范化表记＋读音均唯一，每条都有显式接受决定和判断口径；
- 两份独立审计的删除、分级、分类和重复族决定均已应用；
- 第二轮 905 条终审的删除／规范表面替换、重分类、重分级、新增重叠族与种子库语义重叠决定均已应用；
- 与干净发布种子库没有直接碰撞；
- 来源许可证正确，候选层不存在中文释义、例句或 MOJi 来源字段；中文内容层另由 `verify-jlpt-collocation-content.mjs` 验证。

脚本只读取 `frontend/public/nihongo.db`，并拒绝名字指向 live/local 的数据库路径；不会访问浏览器、学习端口或个人学习数据。

## 2026-10-10 删减：「拼起来就懂」的 92 条（v2，882 → 790）

作者试用后反馈「太多显然的了」：N5/N4 推下来的新词里有一串 写真を撮る、時間がかかる、約束を守る、
手を挙げる 这样**认识每个组成词就能直接读懂整体意思**的条目，单独成卡没有学习价值。

- **只删这一类（字面相加）。** 作者明确要求**和中文同形同义的保留**：四字熟語（半信半疑、四面楚歌）、
  谚语（覆水盆に返らず）、比喻（警鐘を鳴らす、終止符を打つ、火に油を注ぐ）这类，虽然中国学习者一看就懂，
  也不删。第一版提案把这类 135 条也列进去了，被作者否掉 —— 以后再删减别再把它们算进「显然」。
- 意思猜不到的留（気がする、口にする、腕がいい、鼻が高い）；意思一看就懂、但动词选择是日语特有的
  也暂时留（電話をかける、電話に出る、心配をかける）—— 这条边界作者没表态，下次删减可以问。
- 删掉的条目从 `jlpt-collocation-manual-review.json` 的 `accepted[]` 移进 `pruned_obvious.entries`（带理由），
  翻译决定源同步删行；`build-jlpt-collocation-translations.mjs` 把它们写进运行时内容的 `removed[]`。
- 等级分布变为 N5 8、N4 16、N3 190、N2 380、N1 196；类型只动了 collocation（313 → 221）。

**老库怎么处理**（`study-core.ts` 的 `retireRemovedCollocations`，内容版本升到 `…-zh-v2`）：

- 从没碰过的行（progress 没见过，且除 progress 外没有任何带 `word_id` 的表指着它）→ 删 progress 和词条行。
  progress 删除走同步触发器留墓碑。
- 碰过的行（作答、当天新词任务 `stage1_tasks`、便签、收藏……）→ **不删，所有带 `known_forever` 列的记忆表都标熟知**，
  退出排期。开机自动迁移不许连带删学习记录（同 `docs/claude/storage-and-persistence.md`「老库重复词条」）。
- 作者实测库演练：92 条里 59 条删行、33 条标熟知 —— N5/N4 那 33 条全都已经作为新词推过
  （`stage1_tasks` + `seen_count=1`），正是作者嫌显然的那批，所以「碰过就原样留着照常排期」不算解决。
- 判据不能只看 `seen_count`：「标记熟知」不经作答也会写 progress。`fsrs_*` 列在这一步还不一定存在
  （迁移顺序早于 FSRS 加列），不要写进判据，否则新装库上迁移直接报错 —— 回归测试在 `seed-migrations.test.ts`。
- 小程序不跑这条迁移：它的内容来自云端下载的 `nihongo.db`，本来就没有这批搭配。

## 分档 tier（2026-11-02）

作者原话：**「自谦敬辞必须背；一般固定表达（搭配）次之；惯用句、谚语更弱」**。
本次任务提供的背景是：作者 N3 未学词的 181 条中有 173 条固定搭配，N2 未学固定搭配有 380 条。
分档按学习价值和使用场景决定，不改变现有条目的表记、读音、释义、等级、kind 或收录范围；总数仍为 790。

| tier | 定义 | 默认归属 |
| --- | --- | --- |
| `core` 必背 | 敬语、自谦与礼貌寒暄套话，听力即时应答、接待、书信和商务沟通中需要整块调用 | `routine_expression`，随意口语例外降为 common；其他 kind 中本质为敬语的另列例外 |
| `common` 常用 | 一般搭配，以及日常口语或职场中需要整块识别的常用惯用句 | `collocation`，敬语例外升为 core；另含降档的随意口语和审核通过的惯用句 |
| `optional` 选学 | 优先要求认读的惯用句、谚语、四字熟语 | `idiom` / `proverb` / `yojijukugo`；只有 idiom 可按例外提升 |

### 决定源、默认和例外

`frontend/scripts/jlpt-collocation-tier-review.json` 是分档决定源，`status=complete`、`pending=[]`，
`reviewed_at=2026-11-02`。它记录五种 kind 的默认档位、提升上限及 94 条带逐条理由的例外；
没有例外的条目只读默认规则，不另抄一份 790 条清单。例外同时保留 ent_seq、表记、等级和 kind，
重建与验证时核对身份，防止后来换词或重分类后误套旧决定。

- A：本质为敬语的非 routine_expression 升 core。本次为 3 条 collocation：
  N3「お見えになる」「お目にかける」，N2「お見舞い申し上げる」。没有把一般敬佩、谦让态度本身当成敬语，
  例如「頭が下がる」是表达佩服的惯用句，列入 common。
- B：routine_expression 中的随意口语降 common。本次为 N3 的「勝手にしろ」「その時はその時」
  「それはそれは」「火の用心」「まったくもう」5 条。其余确有敬语或礼貌套话功能的保留 core，
  包括 N5/N4 的基础礼貌表达。
- C：idiom 只有在口语或职场中确有常见使用场景、整体义需要整块识别时才提升 common。
  N3 最多 20、N2 最多 50、N1 最多 30；这是上限，不是配额。本次分别提升 **19 / 47 / 20** 条，
  每条的具体场景与非字面用法见决定源的 reason。没有联网补词或改写既有释义。
- proverb 54 条、yojijukugo 60 条全部保持 optional，不适用任何提升例外。

### 体积与读取约定

运行时 JSON 只增加可选字段 `t`，审核源仍使用完整的 `core` / `common` / `optional` 档名。

| entry 的 t | `collocationTier(entry)` 返回值 |
| --- | --- |
| 缺省 | `common` |
| `0` | `core` |
| `2` | `optional` |

**现行（任务 D）**：内容 JSON 的 `t` 继续使用上述紧凑编码；迁移将缺省值写成 1，
在 `words.collocation_tier INTEGER` 保存 0 / 1 / 2。NULL 固定搭配按 common 处理。
读取只比较该列，正文保持异步加载，主包不再携带运行时身份索引。下面保留任务 A 当时尚未接入队列的历史状态。

#### 历史：任务 A 的边界

0 / 2 只是内容传输编码，不是数据库值或排期权重。消费者通过 `frontend/src/lib/study-core.ts`
导出的 `collocationTier` 读取；内容类型相应增加 `t?: 0 | 2`。本次仅增加类型和该纯函数，未接入任何调用方。
`ensureJlptCollocationContent` 仍只插入原有词条字段，**不写 tier 入 DB**，固定搭配内容版本保持
`2026-10-18-jlpt-collocations-zh-v3`，schema_version、原有 reviewed_at、removed 清单及其他既有内容均不变。
队列、每日计划、完成口径和界面读取档位属于后续任务 B。

对同一批决定实测表示法的开销如下；原始大小包含现有两空格缩进和末尾换行：

| 表示法 | 新增原始字节 | 去掉 JSON 空白后新增字节 |
| --- | ---: | ---: |
| 每条都写完整 tier 字符串 | 19,718 | 13,398 |
| 缺省 common，只写 core / optional 字符串 | 12,302 | 8,454 |
| 顶层 core / optional 两个 ent_seq 数组 | 6,289 | 3,870 |
| **本次：缺省 common，紧凑 t 数字字段** | **2,886** | **2,886** |

选择最后一种：每个新增片段 `,"t":0` 或 `,"t":2` 恰为 6 字节，51 条 core 加 430 条 optional，
共 481 × 6 = **2,886 字节**。构建脚本仅压紧新字段，保留其他内容的格式；原文件 230,278 B，
新文件 **233,164 B**。以 Node zlib 默认参数对整份文件压缩作辅助比较，gzip 增加 502 B、Brotli 增加 267 B；
这些不是小程序构建后的包体测量。决定源、理由、默认规则和提升上限不进入运行时 JSON。
相比顶层 ID 数组，entry 自带短字段也使读取函数无需额外索引、缓存或修改现有异步装载链路。

已核对 Taro 的构建配置与已提交 webpack stats：`jlpt_collocation_content` 经共享 shims 映射到
`seed-guard.js`，stats 没有收录该 JSON。此次不重新编译小程序；包体闸门只复核现有 reports，
不能把基线 reports 的通过结果当作重新构建的证明。

### 最终计数与验证

| 等级 | core | common | optional | 合计 |
| --- | ---: | ---: | ---: | ---: |
| N5 | 7 | 1 | 0 | 8 |
| N4 | 9 | 7 | 0 | 16 |
| N3 | 22 | 141 | 27 | 190 |
| N2 | 13 | 106 | 261 | 380 |
| N1 | 0 | 54 | 142 | 196 |
| 合计 | 51 | 309 | 430 | 790 |

`build-jlpt-collocation-translations.mjs` 在原有选择、翻译决定源之外读取分档决定源并生成短字段；
重建不会丢档位。`verify-jlpt-collocation-content.mjs` 进一步检查编码合法、产物逐条符合默认及例外、
例外身份与单行理由、谚语及四字熟语保持 optional、非 routine 的 core 有例外记录、
N3 core ∈ [15, 30]、N2 core ∈ [8, 20]、惯用句提升上限及总数 790。
读取函数的缺省 common、core、optional 三种情况覆盖在 `seed-migrations.test.ts`；
原有迁移和内容矩阵测试继续核对条数、迁移幂等及既有计划计数。


### 2026-11-02 为什么从索引改成列

任务 C 把索引从 **37,965 → 22,877 B**，仍随 `collocation-tier.ts` 进入主包 `common.js`，
主包 **1,925,754 B**，超 1,900,000 B 闸门 **25,754 B**。实际小程序 vendored wasm 支持 `json_each`，
问题是数据进入主包且每个 SQL 片段重复展开；stage1 语句从去过滤对照的 1,920 字符膨胀到
B 原状 **46,223**、压缩后 **33,453** 字符（97,599 / 70,685 UTF-8 B），不能靠提高预算解决。

任务 D 改成列比较后，捕获同一条真实 stage1 语句为 **2,122 字符 / 2,178 UTF-8 B**；
首页 total 从 9,994 字符 / 21,238 B 降到 **463 / 471 B**，unseenCount 从 10,293 / 21,537 B
降到 **762 / 770 B**。辨析/汉字批读仍为 158 / 178 字符，未改成员或分组。
同依赖 fresh build 对照：A (`5bd94d14`) 主包 **1,898,450 B**，B/C (`ed8eb9b2`) **1,925,740 B**，
D 当前源码 **1,903,415 B**；C 历史数字比同环境重建多 14 B，分别保留，不能混为同一次构建。
D 比 C 历史值少 22,339 B，但仍超闸门 **3,415 B**，尚未达到包体目标。
本次 HEAD `2199a6ef` 另有 Quote 图标映射缺失：资产链在该处失败；上述 D 数字来自继续执行的真实编译及后续测量，
不是整条构建链通过的证明。候选模块、各分包和未决项见
[任务 D 验收记录](claude/mini-program-and-cross-platform.md#2026-11-02-任务-d固定搭配档位列与包体复核未完成)。

旧设备：`local-schema.sql` 的建表定义包含 `collocation_tier INTEGER`；已有表/旧整库备份靠
`ensureUserTables` 的结构指纹变化触发 `ALTER TABLE words ADD COLUMN collocation_tier INTEGER`，
出厂 `public/nihongo.db` 不重生成。内容版本升为 `2026-10-18-jlpt-collocations-zh-v4`，
v3 设备会重跑固定搭配迁移，在同一事务里按 `pos='固定搭配' AND kanji=? AND kana=?`
更新全部 790 条（已存在行也更新，普通词不变）；JSON 缺省 `t` 写成 1。
`retireRemovedCollocations` 重跑时仍保留已接触卡的熟知状态与历史；内容和版本继续走 `persistContentSoon()` 整库落盘。
回归覆盖全部 790 条、v3 重跑、旧备份 export/reopen 后 ALTER+补档位、NULL 搭配和同形普通词。

**小程序升级边界**：当前 Taro `database-runtime.weapp.ts` 只调用 `ensureUserTables`，
`jlpt_collocation_content` 实际仍被 `shims-map.mjs` 映射到 `seed-guard.js`，没有已存在的懒加载迁移路径。
原生小程序同样以下载出厂库为内容来源，未调用该迁移。仅更新共享生成物会补列，却不会填档位；
790 条若保持 NULL 就都会按 common 处理，optional 开关因而无法正确过滤。补齐内容分包、入口与回归需要扩大文件白名单，
本次已向作者确认，尚未获得授权，未擅自修改这些文件，也未宣称双端迁移已完成。


#### 任务 D 第二次修正：包体复核通过

上面 **1,903,415 B、超 3,415 B** 为第一次尝试的历史值。
继续把仅首次设定保存 / 备考重估使用的异步先验事务移入 `lazy/level-starting-point`，
保留 `level-plan.ts` 原 Promise 接口、幂等签名检查、事务及主包数据库实例。
fresh build 主包现为 **1,898,552 B**：C 历史 **1,925,754 → 1,898,552 B**，
比 1,900,000 B 闸门低 **1,448 B**，比历史 1,898,464 B 基线多 88 B。
新增异步块 5,592 B，全部分包及重复模块闸门通过；档位列的 SQL 长度和 v4 升级路径不变。
各分包、候选判据、CI 和既存小程序升级/图标边界见
[第二次修正记录](claude/mini-program-and-cross-platform.md#2026-11-02-任务-d-第二次修正主包回到闸门内)。


#### 2026-11-02 第三次修正：小程序真实启动补档位

现行实现补齐了先前记录的启动缺口：网页 ensureSeedData、Taro ensureDatabase、
原生 ensureDatabase / restoreDatabase 都等待同一个 v4 内容迁移，旧设备按 ALTER + v4 补档位。
迁移主体和 790 条正文留在异步分包；主包仍只读 words.collocation_tier，NULL 搭配按 common。
其它汉字/辨析物化也改用参数化批量 VALUES，生产源码与共享生成物的指定 grep 零命中。
最终 fresh 主包 **1,925,754 → 1,895,372 B**，低于 1,900,000 B 闸门 4,628 B；
stage1 仍为 **2,122 字符 / 2,178 B**，对照旧索引 33,453 字符 / 70,685 B。
此前索引 37,965 → 22,877 B、仍超 25,754 B 的历史数字保留。
新增实际小程序开库升级 / 备份恢复 / 失败重试和批写原子性共 6 项，总计净增 10 项回归。
细节、分包字节和 CI 结果见
[第三次修正记录](claude/mini-program-and-cross-platform.md#2026-11-02-任务-d-第三次修正小程序实际执行-v4生产-sql-零残留)。


第三次最终 `VITEST_MAX_WORKERS=2 bash scripts/ci-local.sh` 退出 0：前端 1,532 项通过，
原生全部 32 个脚本、Taro 分包闸门和云同步检查通过；净增 10 项测试，生产 grep 零命中。
未提交，未运行 dev server 或 GUI；既有 Quote 图标构建警告及真机验收边界见上述记录。
