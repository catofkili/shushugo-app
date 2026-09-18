# 内容来源与商业发布权利清单

> 更新时间：2026-09-06
>
> 这是一份工程审计清单，不是法律意见，也不是“全量内容已经获准商用”的声明。没有许可证、授权邮件或可核验的上游条款，就不要把对应内容当作已清权内容发布。

## 结论先说

1. ⚠️ **词条、中文释义、例句、词表选词已全部自建**（作者 2026-09-06 确认）。
   此前记录的 eggrolls-JLPT10k / CC BY-NC 4.0 那条结论**已作废，不再是上架阻塞**。
   **不要再从 git 历史或旧版文档里把它翻出来重提** —— 它在 2026-08 之前成立、之后不成立。
   独立创作的证据链留在 `manual-meaning-rewrite/`、`manual-meaning-polish/`、
   `question-meaning-review/`（逐批原文与方法说明），**不要删**。
2. ⚠️ **语法的「文字层」已全部自建（2026-09-08）**：741 条解释、863 条例句逐条重写完毕，
   已核验没有一条与重写前相同、没有日文说明残留。**剩下的是「选目层」** ——
   条目集合、切分方式、分级归属和排序仍沿用那本书，`bookOrder` 字段更是逐条记着它的目录序。
   条目 id 至今写着 `pdf-n1-001` 这种前缀，那就是那份 PDF 留下的痕迹。详见下面「语法说明」一节。
3. 当前预生成音频使用 `VOICEVOX:春日部つむぎ`、`VOICEVOX:雨晴はう` 与 `VOICEVOX:玄野武宏`。三者都要求准确署名；按已核对的常规音声条款，正确署名并遵守各自限制后可商用，当前音频目录不再包含青山龍星。
4. README 或应用内文案不能替代许可证、权利方授权或律师意见。

Apple 的 App Review Guidelines 要求开发者只提交自己创建或已获许可的内容，并可能要求提供授权证明；这也包括 App Store 截图、预览和宣传内容。请以发布时的[官方审核指南](https://developer.apple.com/app-store/review/guidelines/)为准。

## 内容矩阵

| 内容 | 仓库位置 | 当前记录 | 发布前动作 |
|---|---|---|---|
| JLPT 词条、中文释义 | `frontend/src/data/jlpt_words_seed.json`、`frontend/public/nihongo.db` | ✅ 已全部自建：选词表、中文释义、题面释义均由作者独立撰写，重写批次留在 `manual-meaning-rewrite/`、`manual-meaning-polish/`、`question-meaning-review/` | 保留批次文件、方法说明与审校记录作为独立创作证据 |
| JLPT 固定搭配、中文释义 | `frontend/src/data/jlpt_collocation_candidates.json`、`frontend/src/data/jlpt_collocation_content.json` | 882 条由 JMdict（表记、读音、`ent_seq`）与 Tomoshi `zh_defs` 衍生中文释义组成；两者按 CC BY-SA 4.0 发布，内容层记录了版本、署名与修改说明；首次启动迁移写入 `pos=固定搭配` | 发布时保留 EDRDG、Tomoshi（Y1Z）署名、CC BY-SA 4.0 链接与修改声明；运行 `verify-jlpt-collocation-content.mjs`，并确认整体发行包仍满足 ShareAlike 条件 |
| JLPT 例句 | `frontend/src/data/jlpt_words_seed.json`、`frontend/public/nihongo.db` | ✅ 2026-08-05 已清空此前批量生成的旧例句；第十批完成后，seed 的 10,609 条记录均有逐词手写例句，生产 DB 中对应词条也已同步。例句由人工批次文件记录，未运行旧的全量公式生成器；同一日语词形和假名的重复 seed 行复用对应例句 | 继续逐条审校并保留手写批次、备份、版本记录和人工审校记录 |
| 语法说明 | `frontend/src/data/grammar_seed.json`、`frontend/src/data/grammar.ts` | ⚠️ 源头是《蓝宝书》PDF 的 OCR（id 前缀 `pdf-n*-`）。**文字层已全部重写**：741 条解释 + 863 条例句，批次留在 `scripts/grammar-explanation-rewrites/`、`scripts/grammar-example-rewrites/`，对照表在 `docs/GRAMMAR_*_REWRITE_COMPARISON.md`。**选目层未处理** | 打散条数、增删条目、重排顺序、自定分级，并留一份选目记录；见下面「语法说明」一节 |
| 英文词源 | `frontend/src/data/english_origins.json` | 当前文件没有逐项来源和许可证元数据 | 逐项补来源/授权，或移除无权利证明的条目 |
| 汉字读音 | `frontend/src/data/kanji_readings.json` | 元数据记录 KANJIDIC2，CC BY-SA 4.0 | 保留 KANJIDIC2 署名、许可链接及适用义务；核对衍生数据是否需要相同方式共享 |
| 汉字变体 | `frontend/src/data/kanji_variants.json` | 使用 OpenCC 字典、Unicode Unihan 等上游资料 | 保存各上游许可证和 NOTICE，并按其要求署名/分发 |
| 单词音频 | `frontend/public/audio/words/` | 当前包含 VOICEVOX 春日部つむぎ、雨晴はう、玄野武宏的预生成 AAC，各 11,051 条 | 保留准确署名 `VOICEVOX:春日部つむぎ`、`VOICEVOX:雨晴はう`、`VOICEVOX:玄野武宏(CV:ガロ)`；不要把原始 AAC 作为独立素材包或用于训练/制作音声模型 |
| 例句音频 | `frontend/public/audio/examples/`（不入库；计划放 R2） | 2026-09-18 生成，VOICEVOX 春日部つむぎ 11,655 条 AAC。⚠️ 生成时用 macOS 自带 Kyoko 念一遍当**语调参考**（只提取音高曲线写进 VOICEVOX 查询，Kyoko 的音频一个字节都不发布，见 `scripts/prosody-transfer.mjs`）。macOS SLA 对系统语音的**输出**限定个人非商用；音高曲线是否算「输出」没有先例，风险低但是灰的 | 署名同单词音频。要彻底去掉灰区就把参考引擎换成 AivisSpeech（ACML 1.0，商用允许、署名自愿），只改 `referenceWav` 一个函数，重跑约 6 小时 |
| 第三方依赖 | `frontend/package-lock.json`、`frontend/node_modules/`、`frontend/ios/App/Pods/` | 依赖自身带有许可证文件，但尚未形成发行版 NOTICE 汇总 | 发布前生成并检查第三方许可证/NOTICE 清单 |
| 图片、图标、字体、宣传素材 | `frontend/ios/`、`frontend/public/`、App Store 素材 | 本清单未证明全部拥有权利 | 逐项登记来源和许可；删除无法证明的素材 |

## VOICEVOX 发布注意事项

当前音频索引见 `frontend/public/audio/words/index.json`。根据[VOICEVOX 使用条款](https://voicevox.hiroshiba.jp/term/)，生成音频可以在遵守各角色条款的前提下使用，但必须标注 `VOICEVOX`；角色本身的条款仍然独立适用。

发布前至少要完成：

- **春日部つむぎ**：[VOICEVOX 音声使用规则](https://tsumugi-official.studio.site/rule-2)明确允许商用/非商用，要求在任意位置署名 `VOICEVOX:春日部つむぎ`。其联系页面还说明，正常的署名使用不接受逐案许可咨询；仅使用音声、不使用角色立绘或制作角色二次创作时，不要把二次创作条款误当成音声必须申请的要求。
- **雨晴はう**：[官方使用规则](https://amehau.com/rules/amehare-hau-rule)允许个人及企业商用/非商用，要求标注 `VOICEVOX`；角色名署名为推荐项。按规则，使用其音声制作原创角色或二次角色无需另行申请或确认；禁止 R18 音频及制作/训练新的音声模型。
- **玄野武宏**：[VirVox Project 使用规则](https://www.virvoxproject.com/voicevox%E3%81%AE%E5%88%A9%E7%94%A8%E8%A6%8F%E7%B4%84)允许在遵守规则并署名后商用/非商用，当前采用的准确署名为 `VOICEVOX:玄野武宏(CV:ガロ)`。该页面对青山龍星列出的特殊事前申请条件不适用于玄野武宏。
- 在 About 页面及公开版权/鸣谢页面保留准确署名。App 内音频没有视频“简介栏”，About/鸣谢页是合适位置；不要隐藏音源来源。
- 不要将这些预生成 AAC 单独包装成音频素材库，也不要用它们制作或训练新的音声模型；发布前仍需保存条款快照并核对条款是否更新。

## 语法说明：蓝宝书 OCR 的残留

**这是现在唯一挡在商业发行前面的内容问题。**

### 有版权的到底是哪一层

分三层，风险差别很大，别混着算：

| 层 | 有没有版权 | 说明 |
|---|---|---|
| **句型本身**（`～かけだ`、`～ないうちに`） | ❌ 没有 | 是语言事实，著作权保护表达不保护事实。谁都可以列 |
| **解释文字、例句** | ✅ 有，而且这是**唯一真正的风险** | 这是表达。逐条能对上就是复制，改写措辞不解决 |
| **选哪些 + 怎么排**（汇编） | ⚠️ 弱 | 《著作权法》给汇编作品的保护条件是「对内容的**选择或者编排体现独创性**」。N5 语法就那一百来条，谁编都差不多 —— 独创性越低，保护越薄 |

⚠️ **不要写「按 JLPT 官方出题范围重排」这种话，那个东西不存在。**
新 JLPT 从 2010 年改版起**就不再公布出題基準**（[官方 FAQ](https://www.jlpt.jp/faq/) 有这一条），
旧版 1994 / 改訂版 2002 的出題基準是凡人社出的书，本身也是有版权的出版物。
**所以市面上每一本 JLPT 语法书的清单，都是那家出版社自己编的，没有官方靠山可引。**

但这对我们是好消息不是坏消息：**多本书的清单高度重合，恰恰说明这批语法点是由语言和考试
本身决定的，不是某一家的独创编排**。要证明选目不是抄某一本，办法是交叉比对多个来源
（旧出題基準的语法表在网上广泛转载、`公式問題集` 里实际考过的题、みんなの日本語 /
新完全マスター 等教材大纲），能对上就说明是行业共识。**排序自己定，不沿用任何一本书的顺序。**

### ⚠️ 选目那一层也得动，理由在我们自己的数字里

**我们库里每级的条数是：N5 120 / N4 130 / N3 140 / N2 150 / N1 201。**
前四个是公差 10 的等差数列 —— 语言不会这么整齐，**这是编者规划出来的条数**。
它直接说明：这批语法点的集合不是"由考试范围决定的必然结果"，
而是**沿用了那本书的编排**。所以"相同"这件事在这里没法用「大家都差不多」解释过去。

⚠️ **N1(201) / N2(150) 的重写只解决了表达那一层，没解决选目这一层** ——
条数一条没变，集合原样保留。所以这个问题对**全部 741 条**成立，不只是待重写的 390 条。

判据是"连怪癖都一样"：真正致命的相同不是"你也收了 `～かけだ`"，而是

- **条目切分方式**（别人算一条的，那本书拆成三条，你也拆成三条）
- **只有那本书才收的冷门条目**
- **条目命名的写法**（`～かけだ／かける` 这种斜杠组合本身就是编者的选择）
- **分级归属**（同一个语法点，各家放的级别不同，你跟谁走）
- **条数**（见上面那个等差数列）

### 选目层的处理办法（成本远低于重写文字）

1. **打散条数**：按语义合并或拆分条目，让每级的数字不再是 120/130/140/150
2. **加减条目**：对照其它公开来源，补进那本书没收、别家收了的；删掉只有它收的
3. **重排顺序**：按功能分组（时间 / 条件 / 推量 / 敬语…），不按书的章节顺序
4. **分级自己判**：有争议的条目按自己的判断归级，并写下理由
5. **留一份选目记录**：每条写「为什么收它、参考了哪几个公开来源」。
   **这份记录才是「选目是我自己编的」的证据**，比集合本身像不像更管用

### 验收线

- **文字层**：随机抽 20 条，把你的解释和原书并排，一个不懂日语的人看不出对应关系
- **选目层**：每级条数、条目切分、分级归属，至少有一项和原书明显不同，且有记录说明为什么
- **已处理（文字层，2026-09-08 全部完成）**：741 条解释、863 条例句逐条重写。
  逐条对拍结果：与重写前完全相同的解释 **0 条**、例句 **0 条**，
  解释里残留日文说明句 **0 条**，`usageNotes` 与新解释不同步 **0 条**。
  批次文件在 `frontend/scripts/grammar-explanation-rewrites/`（n1~n5）与
  `frontend/scripts/grammar-example-rewrites/`（n1~n5），
  对照表在 `docs/GRAMMAR_EXPLANATION_REWRITE_COMPARISON.md` 和
  `docs/GRAMMAR_EXAMPLE_REWRITE_COMPARISON.md`。**这些都是独立创作的证据链，不要删。**
- **选目层已动过一处（2026-09-18）**：26 条「A／B」标题按「两个写法能不能互相推出来」拆成 54 条
  （741 → 769），新条目的解释、例句、抓手全部是独立写的，记录在
  `frontend/scripts/grammar-variant-splits.json`（判据见 CLAUDE.md「语法考题：一张卡两个写法」）。
  这是按学习需要做的切分，不是照抄任何一本书的目录；其余仍沿用原书。
- **未处理（选目层，其余部分）**：条目集合、分级归属、排序仍沿用原书。
  最扎眼的一条是 `bookOrder`：值是 **1~741 的全书连续序**，字段名就叫 bookOrder ——
  它不是「某种排序」，是逐条记下的那本书的目录序，而且是全应用的显示排序键
  （`grammar-numbering.ts` 的编号、`build-furigana.mjs` 与 `verify-release-db.mjs`
  的 sort_order 校验都按它走）。换掉它同时解决「顺序一样」和「字段名自证」两件事。
- **重写方法沿用释义那次的口径**：创作输入只有句型本身、接续形态和等级，**不读原书解释和原例句**；
  逐批留原文和方法说明（同 `manual-meaning-rewrite/`），那份记录才是"独立创作"的证据。
- ⚠️ **id 前缀 `pdf-n*-` 建议留着别改**。它是全应用的语法身份（详情页、furigana 表、
  收藏、`grammar_progress` 的桥接全按它走），改名要动一大片；而"名字里有 pdf"本身不构成侵权，
  真正要换掉的是内容。**改了反而会让下一个人以为已经处理干净了。**
- ✅ **升 `GRAMMAR_SEED_VERSION` 这条路已经修好（2026-09-08）**：`grammar_seed.json`
  改成和出厂库 `grammar_points` 逐行同构（741 行、bookOrder 顺序、同一套 `（N4-2）`
  重名后缀），`verify-release-db.mjs` 加了逐行比对的闸门。此前两边各用一套消歧写法，
  真升一次版本会删掉 16 个语法点连同用户在它们上面的全部进度（详见 CLAUDE.md 里那一节）。

## 历史来源归档（已替换，勿据此重开结论）

> ⚠️ 下面这段留作审计溯源。**词条与释义已于 2026-08 全部自建替换**，
> 不要再拿它得出"当前词库不能商用"的结论。

- 上游仓库：[5mdld/anki-jlpt-decks](https://github.com/5mdld/anki-jlpt-decks)
- 原始数据：`deck-source/notes.csv`（旧项目本地副本名为 `data/eggrolls_notes.csv`）
- 旧项目导入脚本：Git 历史中的 `frontend/scripts/import_jlpt_words.py`
- 旧项目原始文件 SHA-256：`4f3f8626c90960c4524fedb489fdadbcde803855734be332fcb4767f5817b966`
- 许可证：[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)
- 上游 README 明确举例禁止“将内容整合进付费产品或服务”。署名或修改内容都不会把 NC（非商业）许可变成商业许可 —— 正因为改写不解除 NC，才做了整体替换而不是改写。

## 归档要求

建议在发布目录外单独保存以下材料，并在每次数据或音频更新时重新审计：

- 上游数据原始 URL、下载日期、版本号、许可证全文和哈希值；
- 权利方授权邮件、合同或工单编号；
- 例句和语法的生成脚本、输入版本、审校记录；
- 第三方依赖 NOTICE/LICENSE 汇总；
- 最终 App 包、App Store 截图/预览和提交说明对应的版权审查记录。

## 可用于 App Review Notes 的说明模板

只有在上面的来源、许可证和授权都已经核验完成后，才可以按实际情况改写下面的模板；不要把模板原样当作授权证明：

```text
The Japanese vocabulary, meanings, and example sentences in this build were independently created or separately licensed for commercial distribution. Third-party datasets, generated audio, and dependency notices are listed in the repository's content-rights documentation. We can provide the applicable licenses and written permissions upon request.
```
