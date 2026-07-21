# 从 MOJi 迁移背词复习记录

由于 iOS 不允许一个 App 读取另一个 App 的私有数据库，Master Nihongo 不直接读取 MOJi 的 `.realm` 文件。可复现的方式是在已登录 MOJi 的 Mac 上生成一个中立 JSON，再通过 AirDrop 或“文件”导入 iPhone。

1. 在 Mac 上打开 MOJi，进入一次背词复习页，确保它完成加载。
2. 退出 MOJi，避免缓存正在写入。
3. 首次使用，在本项目根目录执行一次：

   ```bash
   npm install --prefix scripts/moji-realm-export
   ```

4. 然后执行：

   ```bash
   python3 scripts/export-moji-review-data.py --fetch
   ```

5. 脚本将在桌面生成 `master-nihongo-moji-review-export.json`。它只包含词条、读音、释义和复习状态；不会包含 MOJi 登录凭据。
6. 将此 JSON 通过 AirDrop 发送到 iPhone，在 Master Nihongo 的“我的 → 设置 → 导入词单或 MOJi 复习记录”中选择它。

脚本会从本机 MOJi 的缓存中读取已登录会话，再对 MOJi 发起只读请求以获取复习状态和词条信息。它不会修改 MOJi 数据，也不会把会话凭据写入导出文件。若 MOJi 更新后缓存或接口改变，脚本会安全失败并提示重新打开背词页；不要直接把 `.realm`、`.db` 或缓存文件导入应用。
