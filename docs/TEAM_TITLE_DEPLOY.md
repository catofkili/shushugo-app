# 队伍称号：服务端部署清单（2026-10-19）

队伍称号（柚子商店 6 件 `title-*`，见 `docs/claude/learning-progress-and-rewards.md`「2026-10-19 逐件补齐」）带一个服务端迁移和一个新接口。
**代码已合进本地 main，线上服务端还没动。** 以下是 Codex 写好的部署步骤，**还没有任何一步在线上执行过**；由作者执行。

⚠️ 先迁移、再让新 Worker 接流量；不要用 `selfhost/migrate.mjs` / `install-migration.sh`（那是 Cloudflare D1 全量搬家工具，阿里云已切流，重新全量导入可能拿旧 D1 覆盖新数据）。
第 1 步里的「先把这次所有改动合进 main 再打包」：打包前在 main 上跑一遍下面的测试，别从旧 worktree 打。

## 迁移与健康检查

- `0020_team_member_title.sql` 只有 `ALTER TABLE team_members ADD COLUMN title TEXT;`，可空，无新表、索引或回填。旧成员和不指定此列的旧 INSERT 得到 NULL。
- index.ts 健康检查附近是**表名**清单，0020 没有新表，因此只增注释、不塞不存在的表名。`/api/health` 的 migrationsApplied=true **不能证明 title 列已加**；作者部署必须额外查列和 d1_migrations，见下方命令。没有放宽健康检查的一次 round-trip 闸门。
- 自托管 `server.mjs -> createRuntime -> openDatabase` 启动时枚举 migrations/*.sql，按 d1_migrations 跳过已执行文件；每个新迁移先事务执行 SQL 再记账。selfhost.test.mjs 动态枚举文件，数量断言无需改；新增 title 列断言，覆盖导入库落后最后一个迁移后启动升级。
- `selfhost/migrate.mjs` / `install-migration.sh` 是 **Cloudflare D1/KV/R2 全量搬家**工具，不能当这次增量迁移入口。阿里云已经切流，重新全量导入可能拿旧 D1 覆盖新服务器数据。此次只用 openDatabase 应用新增 SQL。
- 必须先迁移、再让新 Worker 接流量；新 Worker + 无 title 列的数据库会让组队 SELECT/UPDATE 报错，旧客户端也受影响。不能用客户端兼容矩阵代替数据库版本检查。

## 作者部署步骤（仅说明，未执行）

先在 main 上构建。服务器无须安装 npm 依赖。`selfhost:build` 内部是 Wrangler **dry-run**，不是部署。

### 1. 本机打包和传输

```sh
cd /Users/lsc/Documents/shushugo
(cd frontend && npx tsc --noEmit && npx vitest run src/lib/yuzu.test.ts src/lib/shop-availability.test.ts --testTimeout=60000)
(cd cloudflare-sync && npm test && npm run check && npm run selfhost:build)
(cd taro-spike-2 && npm run build:weapp && npm test)
node wechat-miniprogram/scripts/build-shared.mjs --check
COPYFILE_DISABLE=1 tar -czf /tmp/shushugo-title-code.tar.gz \
  cloudflare-sync/selfhost/dist \
  cloudflare-sync/selfhost/adapters.mjs \
  cloudflare-sync/selfhost/server.mjs \
  cloudflare-sync/migrations \
  cloudflare-sync/wrangler.jsonc \
  cloudflare-sync/package.json
shasum -a 256 /tmp/shushugo-title-code.tar.gz
scp /tmp/shushugo-title-code.tar.gz admin@8.148.68.155:/tmp/
ssh admin@8.148.68.155
```

上面 SSH 用户沿用 selfhost/README.md；实际用户不同时只替换用户名。不要运行根目录 wrangler deploy / d1:migrate:remote，也不要改 proxy、DNS 或密钥。

### 2. 服务器核对、暂停写入、备份

先比较上传包 SHA-256 与本机输出；确认数据库已执行到 0019。若更早，先核对缺失迁移的影响，不能补记为已执行。选择部署窗口，避开 scheduled 正在运行时段。以下按段执行，出错即停。

```sh
sha256sum /tmp/shushugo-title-code.tar.gz
sudo sqlite3 /var/lib/shushugo/worker.sqlite \
  "SELECT name FROM d1_migrations ORDER BY name;"
sudo systemctl stop shushugo-worker-scheduled.timer shushugo-worker-scheduled.service shushugo-worker.service
TITLE_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sudo sqlite3 /var/lib/shushugo/worker.sqlite \
  ".backup '/var/lib/shushugo/backups/pre-title-$TITLE_STAMP.sqlite'"
sudo chmod 0600 "/var/lib/shushugo/backups/pre-title-$TITLE_STAMP.sqlite"
sudo tar -czf "/opt/shushugo/pre-title-code-$TITLE_STAMP.tar.gz" -C /opt/shushugo \
  cloudflare-sync/selfhost/dist \
  cloudflare-sync/selfhost/adapters.mjs \
  cloudflare-sync/selfhost/server.mjs \
  cloudflare-sync/migrations \
  cloudflare-sync/wrangler.jsonc \
  cloudflare-sync/package.json
```

SQLite 用 .backup，不复制 WAL 模式的裸文件。新备份 root 持有、0600，代码/数据库备份都保留到人工确认稳定。

### 3. 安装代码、显式执行现有迁移器，再启动服务

```sh
sudo tar -xzf /tmp/shushugo-title-code.tar.gz -C /opt/shushugo --no-same-owner --no-same-permissions
sudo -u shushugo /usr/bin/node --input-type=module -e '
import { openDatabase } from "/opt/shushugo/cloudflare-sync/selfhost/adapters.mjs";
const db = openDatabase("/var/lib/shushugo/worker.sqlite", "/opt/shushugo/cloudflare-sync/migrations");
try {
  const title = db.prepare("PRAGMA table_info(team_members)").all().find(c => c.name === "title");
  const applied = db.prepare("SELECT name FROM d1_migrations WHERE name = ?").get("0020_team_member_title.sql");
  if (title?.type !== "TEXT" || title.notnull !== 0 || !applied) throw new Error("title migration not verified");
  console.log("0020 applied; nullable title TEXT verified");
} finally { db.close(); }
'
sudo systemctl start shushugo-worker.service
sudo systemctl is-active shushugo-worker.service
curl -fsS http://127.0.0.1:8787/api/health
sudo sqlite3 /var/lib/shushugo/worker.sqlite \
  "PRAGMA table_info(team_members); SELECT name FROM d1_migrations WHERE name='0020_team_member_title.sql';"
sudo journalctl -u shushugo-worker.service -n 30 --no-pager
curl -fsS https://api.shushugo.com/api/health
sudo systemctl start shushugo-worker-scheduled.timer
```

openDatabase 也会在启动时迁移；这里停机提前调用同一个入口，目的是接流量前明确拿到成功证据。失败时不要继续开新 Worker/发客户端。

作者再用测试账号验证：买一件 → 自己/另一队友取列表都看到 → 换另一件 → 卸下为 null；未入队 404 / 非法 key 400。不要给真实学习账号灌币。验证通过后才发布网页/App、上传 Taro 小程序。

需要回退时保持停写，先回退业务代码再开服务。旧 Worker 能兼容新增可空列，不需要 DROP COLUMN，更不要为了回退外观功能恢复整份旧数据库（会丢掉其它新写入）。旧代码归档不含新加的 0020 文件：回退目录时须明确保留已应用迁移历史，别只解压旧目录就声称完全回退。数据库损坏才另做数据恢复方案。

## 四种兼容组合（新服务端指已执行 0020）

| 客户端 | 服务端 | 结果 |
| --- | --- | --- |
| 旧 | 旧 | 原有组队行为；称号 soon，不显示。 |
| 旧 | 新 | 忽略成员新增 title 字段，其它组队字段不变；不会主动清空服务端已有称号。 |
| 新 | 旧 | 可本地买/装，app_state 正常同步；PUT 404 静默。成员缺 title，不显示；服务端升级后下次进队伍页补同步。 |
| 新 | 新 | 换装/卸下推送，进队伍页补偿；队友下次取列表可见。未知 key 隐藏，没有新增实时广播。 |
