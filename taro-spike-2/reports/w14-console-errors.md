# W14 控制台错误排查

状态：尚未完成 DevTools 复现与 26 页扫描。本记录只把源码和构建证据标为已确认；静态候选不等于运行时根因。

## 已知问题

| 原文 | 触发位置 | 根因 | 处理 |
| --- | --- | --- | --- |
| `Cannot read properties of undefined (reading 'words')` | W11 的 26 路由日志在 `/study/jlpt-plan/index` 复现；同一轮在 `/account/settings/index` 也记录到。堆栈为 `getsubpackagebundle_study.js` → `Array.map` → `A`，最初偏移 `5670:50` / `5658:38`，重建后偏移变为 `9160:50` / `9148:38`。两个页面共用 `DailyPlanPanel`。 | 运行时错误已由 W11 日志确认，但 W14 尚未重新复现。源码里至少有两个候选 map 会在首项读取 `words`：`DailyPlanRing.weapp.tsx` 的 `value[kind]`，以及 `DailyPlanPanel.tsx` 的 `plan[segment.kind]`。`DailyPlanPanel` 在 `view` 或 `plan` 为空时会返回 `null`；因此目前既未从 bundle 栈确认是哪一个对象为 undefined，也未解释为何小程序进入该 map。 | 未做保护性兜底，避免掩盖尚未定位的数据/渲染状态。先在 W14 正确 DevTools 项目里复现并核对生成调用；若根因落在 shim、sql.js 或迁移，按任务要求交给 Claude。 |
| `Template tmpl_0_#text not found` | 已确认的触发写法是 `<br>`。候选调用点：`frontend/src/components/LevelSetup.tsx`、`frontend/src/features/word-study/WordStudyPanels.tsx`；`WeeklyReportStory.tsx` 也含 `<br>`，但周报当前隐藏。具体报错页面尚未由 DevTools 确认。 | `@tarojs/plugin-html` 在 `modifyHydrateData` 中为 `<br>` 添加合成 `#text` 子节点；Taro 生成的 `base.wxml` 只有文本模板 `tmpl_0_9`，没有 `tmpl_0_#text`。合成节点在真实子节点遍历之后加入，因此常规文本转换没有处理它。 | 在公共 `modifyHydrateData` hook 中把遗留的 `#text` 节点名改成模板 id `9`。新增 smoke 覆盖合成子节点；构建通过。真实 DevTools 页面复验待做。 |
| `onPageScroll` 连报 42 次（同一张用户 vConsole 截图；原文待开发者工具复现） | 页面和触发操作未确认。当前源码没有 `onPageScroll` 或 `usePageScroll` 调用；唯一分页入口是 `touch-adapter.weapp.ts` 中的 `useReachBottom`，供 `useProgressiveList` 使用。 | 未完成 DevTools 复现，无法确认这 42 次是注册、触发还是基础库提示，也不能据此认定由分页 hook 引起。 | 暂不改动。拿到控制台原文和页面堆栈后，追到注册方再决定是否移除。 |

## 扫描范围与限制

W14 预期覆盖 26 个页面，以及背词翻面评分 5 张、撤销、切四个 tab、辨析类别与搜索、语法页触底、设置、柚子商店、打开并关闭付费小窗。当前均未取得有效 W14 DevTools 结果：共享微信开发者工具当时打开的是 `taro/w15-visual-sweep` worktree，9541 自动化所见项目路径也指向 W15。因此 W15 上的扫描输出作废，没有上传或切换它的项目。

普通预览码、临时 vConsole Error/Warn 截图和用户手动操作验收都尚未进行。等共享 DevTools 确认可供 W14 使用后再继续；学习页 5173 未触碰。

## 已执行的检查

- `npm run build:weapp`：通过；包括 API 扫描、分包体积与模块闸门。
- Taro `npm test`、`npm run check:release`：通过。
- 前端 `check`：通过；`lint`：0 errors、43 warnings；单独运行的 `npm test`：814 passed、26 skipped。
- 微信小程序 `npm test`：30 个脚本全部通过（已批准的路线 A 豁免生效）。

构建 API 扫描器原先对 Taro URL 解析器的 `Invalid URL` 错误文案产生误报。已把 allowlist 收窄到该文案后紧接相对 URL 解析表达式的上下文，并由完整构建验证通过。
