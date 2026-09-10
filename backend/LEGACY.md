# Legacy Backend

这里曾经是一个 FastAPI 的同步原型（`server.py`，295 行 + `requirements.txt`）。
**实现已于 2026-09-09 删除**，Git 历史里还在。

账号、邮箱验证、内购权益和云备份的生产实现全部在：

```text
cloudflare-sync/
```

⚠️ 删的是**实现**不是这份说明：留着它是为了让下一个人知道
`docs/DEPLOYMENT_GUIDE.md` 和 `docs/PROJECT_SUMMARY.md` 里那些 `cd backend` 的段落
说的是这个已经退役的原型，别照着去部署一份和 Worker 打架的后端。
