# 释义重写进度

- 盲筛选目标：旧中文释义超过五字的词条，共 5163 条。
- 已独立撰写：5163 条（batch-001～batch-018）。
- 已接入正式词库：`frontend/src/data/jlpt_meaning_overrides.json`，并烧入 `frontend/public/nihongo.db`。
- 已接入自动撞车表：`frontend/src/data/auto_similar_meaning_groups.json`；按正式题面首义生成 1,645 组、覆盖 4,007 个唯一词形，排片干扰隔离和答案面对照卡均读取这份表。
- 用户学习记录、同步数据：未修改。
- 创作输入：词条 ID、日语词形、假名、词性；未读取旧中文内容。
