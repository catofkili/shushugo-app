# 题面中文释义审校

这个目录只存“中文 → 日文”正向题的题面审校工作，不改用户学习记录，也不读取真实 Chrome 数据。

当前普通清单已全部处理：`candidate-index.json` 的 5,853 行均为 `reviewed`；连同辨析题新增的 788 条唯一词面，运行时覆盖表现在有 6,615 条唯一键值。词库中 `先【さき】`、`本【ほん】` 的 JLPT 重复行共用同一条覆盖，不会产生重复运行时键。

## 判定口径

- `same_meaning`: 日语常用义和现代普通话核心义一致，题面直接使用简体中文汉字，不再另写解释。
- `manual_translation`: 字形相同或近似，但中文默认义不同、词性/范围不同，必须人工翻译。
- `partial_overlap`: 有一部分义项相同，但裸汉字会缩窄或误导；题面保留最常用的两个短义，答案面保留完整词义。
- `ambiguous`: 同一中文题面会对应多个日语词，必须附短义或依靠拍数/辨析消歧。
- `distinction`: 同一疑难辨析组内的成员题面审校；必须把人工辨析稿里的动作方向、对象、汉字用法或语域线索写进中文题面，并保证同组首义互不相同。`level: "interchangeable"` 的组可以保留自然的相同首义，不强造语言事实上的区别。

判断依据是现代中文是否自然、日语最常用义是否相同、词性/动作方向/语域是否相同；不把“是否和制汉语”当作唯一规则。日语词源来自日本的词，即使后来成为自然中文，也可以归入 `same_meaning`；反过来，共同汉字词只要现代义已经分叉，就归入人工翻译。

## 文件

- `build-candidate-index.mjs`：只读取日语词形、假名、词性和等级，生成候选清单；故意不把旧中文写入清单，避免审校创作被旧译法锚定。
- `candidate-index.json`：由脚本生成的全部纯汉字候选。
- `manual-batch-001.json`、后续 `manual-batch-*.json`：人工审校批次；每条按 `kanji + kana` 锁定，不用可变的数据库 ID。`manual-batch-0031.json`～`manual-batch-0034.json` 是 370 个非 synonym 辨析组的 788 条唯一词面；其中已经存在于旧批次的 26 条在原文件中更新，不能重复追加。
- `distinction-candidates.json`：由出厂 DB 离线导出的辨析组审校输入，当前包含 370 组、916 个成员、788 个唯一键（pair / stem / kanji-choice / reading-register）。
- `distinction-candidates-synonym.json`：814 个 synonym 组（有人工稿），第一轮没做；`distinction-candidates-unreviewed.json`：没有人工稿的组（homophone / reading-sense）里还缺题面的成员。三份都由同一条导出命令生成，第二轮计划见 `docs/DISTINCTION_QUIZ_PLAN_ROUND2.md`。
- ⚠️ **辨析题面不许为了「分得开」砍掉原文义项**（聞く 写成「听」丢了「询问」——这行字同时是日常正向题的题面）。`validate-manual-batch.mjs` 对 `distinction` 条目检查：原文 ≥2 个义项而题面只剩 1 个的报 `sense dropped`，除非 `reason` 里写了「舍弃义项：…」。第一轮 447 条命中，第二轮的工单就是这份输出。
- `complete-review-from-seed.mjs`：离线完成剩余清单的审校生成器；只把与中文简体字形及常用义完全一致的词直接保留汉字，其余词保留去除日语读音标注后的精简中文释义。
- 批次中的 `questionMeaning` 只控制正向题面；完整 `meaning` 不在这里被覆盖。

## 生成候选清单

在仓库根目录执行：

```bash
node question-meaning-review/build-candidate-index.mjs
```

该命令是离线读词库并写入本目录，不启动 Vite、不连接学习页、不访问真实学习数据。

批次增加后，用下面的命令把已经审校的内容重新生成到运行时覆盖表：

```bash
node question-meaning-review/build-runtime-overrides.mjs
```

全量完成后，使用下面的命令复核候选清单、批次和运行时覆盖表的一致性：

```bash
node question-meaning-review/validate-manual-batch.mjs
```

校验范围包括 `jlpt_words_seed.json` 和已经登记在 `jlpt_level_overrides.json` 的历史词条；后者是出厂 DB 中合法存在、但不在 JLPT seed 行里的词形，不能为了通过校验把它们硬塞回 seed。

## 辨析题面同时进释义层

`distinction` 条目不只管题面：`node question-meaning-review/sync-distinction-meanings.mjs`
把它们的 `questionMeaning` 写进 `frontend/src/data/jlpt_meaning_overrides.json`（→ `words.meaning`），
反向题答案面、辨析气泡、词库看到的才是分得开的那句话。跑完要 bump `JLPT_WORD_METADATA_VERSION`
并重烤出厂库，见 CLAUDE.md「释义有两层」。

## 辨析题面和练习页

`distinction-candidates.json` 的每组成员都从 `confusionGroups()` 和
`confusion_distinction_reviews.ts` 读取，题面仍写入同一份 `question_meaning_overrides.json`。
`distinction-quiz.ts` 只接收有人工稿、`major`、成员齐全且首义互异的组；缺一个成员题面就整组跳过，不能退回 `words.meaning`。

辨析练习支持单组、类别、今天正向题碰到的组和已学组四种范围。每组成员各出一题，组内连续，整场最多 24 题且不截断半组。答完只调用 `setConfusionMastered()`：全对置为已掌握，有错清掉；不写 `reviews`、`progress` 或任何 FSRS 字段，也不进入当日计划。

候选导出和唯一性回归测试是同一个文件 `frontend/src/lib/distinction-candidates.test.ts`：不给 `CANDIDATES_OUT` 时仍会常驻运行唯一性测试，给出路径时才额外落盘候选清单。导出命令示例：

```bash
cd frontend && CANDIDATES_OUT=../question-meaning-review/distinction-candidates.json npx vitest run src/lib/distinction-candidates.test.ts
```
