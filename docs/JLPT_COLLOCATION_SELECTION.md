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

