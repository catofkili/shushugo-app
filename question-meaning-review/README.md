# 题面中文释义审校

这个目录只存“中文 → 日文”正向题的题面审校工作，不改用户学习记录，也不读取真实 Chrome 数据。

当前清单已全部处理：`candidate-index.json` 的 5,853 行均为 `reviewed`，运行时覆盖表同步了 5,853 条唯一键值。词库中 `先【さき】`、`本【ほん】` 的 JLPT 重复行共用同一条覆盖，不会产生重复运行时键。

## 判定口径

- `same_meaning`: 日语常用义和现代普通话核心义一致，题面直接使用简体中文汉字，不再另写解释。
- `manual_translation`: 字形相同或近似，但中文默认义不同、词性/范围不同，必须人工翻译。
- `partial_overlap`: 有一部分义项相同，但裸汉字会缩窄或误导；题面保留最常用的两个短义，答案面保留完整词义。
- `ambiguous`: 同一中文题面会对应多个日语词，必须附短义或依靠拍数/辨析消歧。

判断依据是现代中文是否自然、日语最常用义是否相同、词性/动作方向/语域是否相同；不把“是否和制汉语”当作唯一规则。日语词源来自日本的词，即使后来成为自然中文，也可以归入 `same_meaning`；反过来，共同汉字词只要现代义已经分叉，就归入人工翻译。

## 文件

- `build-candidate-index.mjs`：只读取日语词形、假名、词性和等级，生成候选清单；故意不把旧中文写入清单，避免审校创作被旧译法锚定。
- `candidate-index.json`：由脚本生成的全部纯汉字候选。
- `manual-batch-001.json`、后续 `manual-batch-*.json`：人工审校批次；每条按 `kanji + kana` 锁定，不用可变的数据库 ID。
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
