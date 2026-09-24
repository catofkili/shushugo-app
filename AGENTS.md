# AGENTS.md

本仓库的工作须知全部在 [CLAUDE.md](CLAUDE.md)，所有 AI（Codex、Claude 等）都按它来，开工前先读。

两条最常被违反的，单独列在这里：

1. **改任何用户看得见的页面，网页和微信小程序在同一个对话、同一个提交里一起改。**
   做法、闸门和禁止事项见 [docs/MINIPROGRAM_SYNC_PLAN.md](docs/MINIPROGRAM_SYNC_PLAN.md)。
   不要只改网页就报完成，也不要读完网页源码后「按自己理解」重写一版小程序页面。
2. **用户的 5173 学习页开在主目录上。** 在 worktree 里做，做完当场提交、合回 `main`、删掉 worktree；
   不要在主目录 `git stash` / `checkout` 源码（会热更新并可能触发降级重建，删掉当天作答）。
