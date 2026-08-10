# 内容来源与商业发布权利清单

> 更新时间：2026-08-05
>
> 这是一份工程审计清单，不是法律意见，也不是“全量内容已经获准商用”的声明。没有许可证、授权邮件或可核验的上游条款，就不要把对应内容当作已清权内容发布。

## 结论先说

当前仓库还不能直接作为“版权风险已解决”的商业发行包。最需要在发布前解决的是：

1. Git 历史与旧项目文档确认，种子数据中的 10,609 条 JLPT 词条、中文释义和旧例句来自 [eggrolls-JLPT10k-v3.5](https://github.com/5mdld/anki-jlpt-decks)，适用 CC BY-NC 4.0。旧例句已经替换，但词条和中文释义的来源许可没有因此改变；上游明确禁止将内容整合进付费产品或服务，因此当前词库仍不能直接商用。
2. 当前预生成音频使用 `VOICEVOX:春日部つむぎ`、`VOICEVOX:雨晴はう` 与 `VOICEVOX:玄野武宏`。三者都要求准确署名；按已核对的常规音声条款，正确署名并遵守各自限制后可商用，当前音频目录不再包含青山龍星。
3. README 或应用内文案不能替代许可证、权利方授权或律师意见。

Apple 的 App Review Guidelines 要求开发者只提交自己创建或已获许可的内容，并可能要求提供授权证明；这也包括 App Store 截图、预览和宣传内容。请以发布时的[官方审核指南](https://developer.apple.com/app-store/review/guidelines/)为准。

## 内容矩阵

| 内容 | 仓库位置 | 当前记录 | 发布前动作 |
|---|---|---|---|
| JLPT 词条、中文释义 | `frontend/src/data/jlpt_words_seed.json`、`frontend/public/nihongo.db` | 种子 JSON 有 10,609 条；生产 DB 有 11,057 个词条，其中 458 条无法与已确认的 eggrolls 来源逐条匹配；已匹配的中文释义来自 CC BY-NC 4.0 上游记录 | 取得商业授权，或整体替换所有未清权/来源不明的数据 |
| JLPT 例句 | `frontend/src/data/jlpt_words_seed.json`、`frontend/public/nihongo.db` | 2026-08-05 已清空此前批量生成的旧例句；第十批完成后，seed 的 10,609 条记录均有逐词手写例句，生产 DB 中对应词条也已同步。例句由人工批次文件记录，未运行旧的全量公式生成器；同一日语词形和假名的重复 seed 行复用对应例句 | 继续逐条审校并保留手写批次、备份、版本记录和人工审校记录。例句是否独立不改变词条/中文释义的 CC BY-NC 来源限制 |
| 语法说明 | `frontend/src/data/grammar_seed.json` | N1/N2 有从头改写的提交记录 | 保留作者、版本和来源记录，并确认没有复制第三方解释或例句 |
| 英文词源 | `frontend/src/data/english_origins.json` | 当前文件没有逐项来源和许可证元数据 | 逐项补来源/授权，或移除无权利证明的条目 |
| 汉字读音 | `frontend/src/data/kanji_readings.json` | 元数据记录 KANJIDIC2，CC BY-SA 4.0 | 保留 KANJIDIC2 署名、许可链接及适用义务；核对衍生数据是否需要相同方式共享 |
| 汉字变体 | `frontend/src/data/kanji_variants.json` | 使用 OpenCC 字典、Unicode Unihan 等上游资料 | 保存各上游许可证和 NOTICE，并按其要求署名/分发 |
| 单词音频 | `frontend/public/audio/words/` | 当前包含 VOICEVOX 春日部つむぎ、雨晴はう、玄野武宏的预生成 AAC，各 11,051 条 | 保留准确署名 `VOICEVOX:春日部つむぎ`、`VOICEVOX:雨晴はう`、`VOICEVOX:玄野武宏(CV:ガロ)`；不要把原始 AAC 作为独立素材包或用于训练/制作音声模型 |
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

## eggrolls-JLPT10k 来源核查

- 上游仓库：[5mdld/anki-jlpt-decks](https://github.com/5mdld/anki-jlpt-decks)
- 原始数据：`deck-source/notes.csv`（旧项目本地副本名为 `data/eggrolls_notes.csv`）
- 旧项目导入脚本：Git 历史中的 `frontend/scripts/import_jlpt_words.py`
- 旧项目原始文件 SHA-256：`4f3f8626c90960c4524fedb489fdadbcde803855734be332fcb4767f5817b966`
- 许可证：[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)
- 上游 README 明确举例禁止“将内容整合进付费产品或服务”。署名或修改内容都不会把 NC（非商业）许可变成商业许可。

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
