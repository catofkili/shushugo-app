# 拉新邀请码：阿里云服务端部署清单

本文只提供步骤，未执行线上部署。按 `docs/TEAM_TITLE_DEPLOY.md` 的增量迁移流程操作：**备份 → 执行 0021 → 验证三张表及迁移记录 → 启动新 Worker**。必须在新 Worker 接流量之前迁移，不能只更新代码。

不要运行 `selfhost/migrate.mjs`、`install-migration.sh` 或 `d1:migrate:remote`：前两者是 Cloudflare 全量搬家工具，重新导入可能覆盖阿里云的新数据。本次不改 DNS、代理、密钥。

## 本次变更与验收口径

- `0021_referrals.sql` 新增 `referral_codes`、`referral_claims`、`referral_earnings`；邀请码唯一、每账号一次绑定、奖励身份 `(invitee_user_id, kind, key)` 唯一；邀请人查询及每日累计有索引。
- `openDatabase` 自动按文件名枚举 `migrations/*.sql`，每个迁移事务执行成功后才记入 `d1_migrations`，没有需要另外维护的自托管迁移清单。禁止手工补记未执行的迁移。
- `/api/health` 同一条查询检查三张新表；`migrationsApplied=true` 还需结合迁移记录与结构核对。0020 的 `team_members.title` 列仍须单独检查。
- 新增三个已验证账号接口：`GET /api/referral/me`、`POST /api/referral/claim`、`POST /api/referral/earnings`。原有普通称号行为不变，`title-yuyou` 须服务端确认任一身份已解锁套装。主题 `theme-dusk` 由客户端按 `setUnlocked` 发放，Worker 不另建外观购买账本。
- 日期沿用组队学习日（UTC+8、04:00 切日）；绑定日期用 `validStudyDay` 原有容差。奖励补报允许绑定日起 30 天内的合法日期，且不得晚于服务器学习日的次日。邀请人资格只看前 14 天内至少 3 个有已接受记录的不同日期。
- 每条奖励的每日 700 上限、邀请人跨全部被邀请人的终身 10000 上限在 INSERT 内计算；整批写入与双方解锁同一事务提交。重复奖励不新增、不再占额度；达到邀请人上限仍接收被邀请人的合法记录及解锁。
- 三张表不随用户删除级联清空：绑定和已结算奖励保留，避免对方删号后重算突破邀请人终身上限。记录只含内部账号 ID、设备标识及奖励元数据；对外的 rewards 只返回流水 ID 与金额，不返回被邀请人 ID。

## 1. 本机验收、打包、传输

在整合好的 main 上运行，不从落后的 worktree 打包。客户端由并行任务负责；发布客户端前还须完成其自身闸门。

```sh
cd /Users/lsc/Documents/shushugo
(cd cloudflare-sync && npm run check && npm test && npm run selfhost:build)
COPYFILE_DISABLE=1 tar -czf /tmp/shushugo-referral-code.tar.gz \
  cloudflare-sync/selfhost/dist \
  cloudflare-sync/selfhost/adapters.mjs \
  cloudflare-sync/selfhost/server.mjs \
  cloudflare-sync/migrations \
  cloudflare-sync/wrangler.jsonc \
  cloudflare-sync/package.json
shasum -a 256 /tmp/shushugo-referral-code.tar.gz
scp /tmp/shushugo-referral-code.tar.gz admin@8.148.68.155:/tmp/
ssh admin@8.148.68.155
```

`selfhost:build` 使用 Wrangler dry-run 生成本地包，不是部署到 Cloudflare。以下命令由部署者在服务器逐段执行，出错即停。

## 2. 核对、暂停写入、备份

比较包的 SHA-256；确认迁移已到 0020。缺少更早迁移时先核对，不要跳过或补记。避开 scheduled 任务运行时段。

```sh
sha256sum /tmp/shushugo-referral-code.tar.gz
sudo sqlite3 /var/lib/shushugo/worker.sqlite \
  "SELECT name FROM d1_migrations ORDER BY name; PRAGMA table_info(team_members);"
sudo systemctl stop shushugo-worker-scheduled.timer shushugo-worker-scheduled.service shushugo-worker.service
REFERRAL_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sudo mkdir -p /var/lib/shushugo/backups
sudo sqlite3 /var/lib/shushugo/worker.sqlite \
  ".backup '/var/lib/shushugo/backups/pre-referral-$REFERRAL_STAMP.sqlite'"
sudo chmod 0600 "/var/lib/shushugo/backups/pre-referral-$REFERRAL_STAMP.sqlite"
sudo tar -czf "/opt/shushugo/pre-referral-code-$REFERRAL_STAMP.tar.gz" -C /opt/shushugo \
  cloudflare-sync/selfhost/dist \
  cloudflare-sync/selfhost/adapters.mjs \
  cloudflare-sync/selfhost/server.mjs \
  cloudflare-sync/migrations \
  cloudflare-sync/wrangler.jsonc \
  cloudflare-sync/package.json
```

数据库必须用 SQLite `.backup`，不能直接复制 WAL 模式的裸文件。备份保留至人工确认稳定。

## 3. 安装、显式迁移、验证后才启动

服务继续保持停止。解包不会让新 Worker 接流量；先调用同一个启动迁移器，并核对表、索引、称号列和迁移记账。

```sh
sudo tar -xzf /tmp/shushugo-referral-code.tar.gz -C /opt/shushugo --no-same-owner --no-same-permissions
sudo -u shushugo /usr/bin/node --input-type=module -e '
import { openDatabase } from "/opt/shushugo/cloudflare-sync/selfhost/adapters.mjs";
const db = openDatabase("/var/lib/shushugo/worker.sqlite", "/opt/shushugo/cloudflare-sync/migrations");
try {
  for (const name of ["referral_codes", "referral_claims", "referral_earnings"]) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get("table", name)) throw new Error(`missing table: ${name}`);
    console.log(name, db.prepare(`PRAGMA table_info(${name})`).all());
  }
  for (const name of ["idx_referral_claims_inviter", "idx_referral_earnings_day"]) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get("index", name)) throw new Error(`missing index: ${name}`);
  }
  if (!db.prepare("PRAGMA table_info(team_members)").all().some(c => c.name === "title" && c.type === "TEXT")) throw new Error("missing 0020 title column");
  if (!db.prepare("SELECT 1 FROM d1_migrations WHERE name = ?").get("0021_referrals.sql")) throw new Error("0021 not recorded");
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("integrity check failed");
  console.log("0021 applied and verified; safe to start new Worker");
} finally { db.close(); }
'
sudo systemctl start shushugo-worker.service
sudo systemctl is-active shushugo-worker.service
curl -fsS http://127.0.0.1:8787/api/health
sudo journalctl -u shushugo-worker.service -n 30 --no-pager
curl -fsS https://api.shushugo.com/api/health
sudo systemctl start shushugo-worker-scheduled.timer
```

核对健康响应 `migrationsApplied=true`，且三张表对应字段均为 true；认证硬化相关状态须符合既有生产配置。失败不要继续发客户端。

## 4. 测试账号验收与回退

用两个不同设备标识的新测试账号验证：重复 GET 邀请码不变 → 填码成功、重复绑定 409 → 上报合法 plan 后被邀请人解锁 → 重报 accepted=0 → 前 14 天内累计三个不同学习日后邀请人解锁 → 邀请人只看到流水 ID/金额 → `title-yuyou` 未解锁 403、解锁后可设置。三天资格按真实学习日验证，不伪造线上时间，不给真实学习账号灌币；完整边界已由离线路由测试覆盖。

旧客户端可继续使用原接口；新客户端遇旧服务端会得到 referral 404，不能据此当作新服务端已验收。确认服务端升级后才放行新客户端。

回退时先停服务和 scheduled，再还原业务代码；保留新增三张表、0021 SQL 文件及 `d1_migrations` 记录，旧代码可忽略这些表。不要 DROP 表或用部署前整库备份覆盖已有新写入。数据库损坏才另行制定恢复方案。
