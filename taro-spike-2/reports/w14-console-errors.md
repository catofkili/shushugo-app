# W14 控制台错误排查

状态：代码修复、隔离端口 DevTools 扫描和指定操作检查已完成；真机 vConsole 验收待扫码。原始 vConsole 截图未随任务提供，所以 `onPageScroll` 的原始整行文案仍待补录。

## 问题与证据

| 原文 | 触发位置 | 根因 | 处理与当前状态 |
| --- | --- | --- | --- |
| `TypeError: Cannot read properties of undefined (reading 'words')` | W11 的 `/study/jlpt-plan/index` 与 `/account/settings/index` 都复现。堆栈指向 study 分包中的 `Array.map`，调用偏移重建前后分别为 `5670:50` / `5658:38`、`9160:50` / `9148:38`。W11 对 map 回调做的临时诊断定位到 `DailyPlanPanel` 图例 `view.segments.map`。 | 回调访问的是组件本地状态 `plan[segment.kind]`；首段 `segment.kind` 为 `words`，所以报错表示这一刻 `plan` 状态为 `undefined`，不是数据库记录的 `words` 字段缺失。源码在渲染前已有 `if (!view || !plan) return null`，而 W11 仍进了回调；为什么 W11 的 Taro 渲染越过该保护尚未证实。它是渲染状态问题，现有证据不指向 shim、sql.js 或迁移。 | W14 从已合入 W13 的 `taro/main` `2ecc665` 构建；备考计划页和设置页都纳入 26 路由扫描，当前未复现。没有添加猜测性的空值兜底，也没有改数据层。W14 零复现不能单独证明是哪项合并改动消除了它；若后续真机重现，需保留页面状态和完整堆栈继续查 Taro 渲染时序。 |
| `Template tmpl_0_div not found` | W14 早期 DevTools 页面加载；触发于 HTML 到 Taro 模板的公共转换。 | `html-text-template.weapp.cjs` 为处理自定义文本节点替换了 `@tarojs/plugin-html` 的既有 `modifyHydrateData` 回调，导致插件将 HTML 标签映射为 Taro 模板 ID 的处理丢失。 | 自定义转换现在先调用并保留插件原回调，再应用本项目映射。后续 W14 路由扫描与指定操作未再出现该错误。 |
| `Template tmpl_0_#text not found` | 用户提供的真机 vConsole 错误；源码候选 `<br>` 包括 `LevelSetup.tsx`、`WordStudyPanels.tsx`，隐藏周报也有 `<br>`。早期 W14 DevTools 在 HTML 文本转换时复现。 | `@tarojs/plugin-html` 会为 `<br>` 生成合成 `#text` 子节点；Taro 实际生成的文本模板 ID 是 `9`（`tmpl_0_9`），没有 `tmpl_0_#text`。合成节点不经过普通子节点文本转换。 | 在公共 `modifyHydrateData` 转换中将 `#text` 规范到模板 ID `9`，并增加 smoke 覆盖合成节点。修复后 W14 路由和操作扫描未再出现。 |
| `WXMLRT_$6163636f756e742f:./base.wxml:template:406:18: Template \`tmpl_0_summary\` not found.` | W11 打开 `/account/settings/index`。 | 原生 `<details>/<summary>` 在该 Taro 小程序模板中会生成不存在的 `summary` 模板。 | Settings 的微信小程序变体使用 `View` 和按钮呈现 Disclosure；网页继续使用原生 `<details>/<summary>`。W14 打开设置并操作 Picker 时未再出现该警告。 |
| `wx.getSystemInfoSync is deprecated.Please use wx.getSystemSetting/wx.getAppAuthorizeSetting/wx.getDeviceInfo/wx.getWindowInfo/wx.getAppBaseInfo instead.` | W11 的直接微信 API 探针触发。 | W11 共享 UI 组件通过 `Taro.getSystemInfoSync()` 读取窗口尺寸。 | W14 可替换调用改为 `Taro.getWindowInfo()`；平台 polyfill 优先使用 `wx.getWindowInfo()`，仅在该 API 不存在时保留兼容回退。W14 指定操作日志为零 warning。 |
| `onPageScroll` 连报 42 次（用户提供的原始截图；整行文案和截图当前不可访问） | 用户报告来自真机 vConsole；原页面与操作未注明。W14 源码没有页面订阅 `onPageScroll`，向下滚动语法页可覆盖滚动场景。 | 已定位 Taro 注册来源：`@tarojs/shared` 的 `defaultMiniLifecycle.page[5]` 默认包含 `onPageScroll`；`@tarojs/runtime` 的页面配置逻辑遍历该生命周期列表并挂到 Page。项目路由没有使用该生命周期，因此默认配置会为页面建立不需要的原生到 JS 滚动事件入口。手头没有原图/原始整行，无法确认 42 次具体是注册日志还是每次滚动派发日志。 | W14 的 `getMiniLifecycle` hook 从该列表移除 `onPageScroll`；构建后确认设置页 Page 对象没有自有 `onPageScroll`，调用 `wx.pageScrollTo({scrollTop: 800})` 未产生 error/warn。路线中没有其他页面滚动订阅。请补发原始 vConsole 截图或复制整行，以便把原文补全并核对是否与 Taro 生命周期注册日志一致。 |

## W14 DevTools 验收

- DevTools 独立打开 W14 产物，自动化端口为 **9542**（9541 已被其他项目占用）；没有操作 W15 窗口。最终 `tmp/devtools-route-sweep.cjs` 扫描 **26/26 路由 OK，零 ERR**，包括 `/study/jlpt-plan/index` 和 `/account/settings/index`。
- 按任务清单执行背词翻面评分 5 张、撤销、切换四个 tab、辨析类别 `自他动词` 与搜索 `欠ける`、语法页滚到底、设置 Picker、打开关闭柚子商店和付费小窗。采集到 **0 error、0 warning**。
- DevTools 截图：`w14-word-study-undo.png`、`w14-grammar-foundation-visual.png`、`w14-settings-visual.png`。
- 网页对照在隔离端口 **5200**、视口 **375×812** 完成；日期选择和设置页截图分别为 `w14-web-date-375.png`、`w14-web-settings-375.png`。页面布局正常，日期选择保留 12 个月选项。5173 学习页未触碰。
- W14 自有窗口使用 9542，是因为 9541 在用；初次指向 W15 的扫描结果没有作为 W14 验收证据。

## 构建和检查

- `npm run build:weapp`：通过；API、模块和分包闸门通过，`overBudget: []`。
- Taro `npm test` 与 `npm run check:release`：通过。
- 前端 `npm run check`：通过；`npm run lint`：0 errors、43 warnings；`npm test`：115 files passed、2 skipped；814 tests passed、26 skipped。
- 微信小程序 `npm test`：30 个脚本通过，使用已批准的 Route A 豁免。豁免只说明网页与小程序页面源码按路线 A 分开维护，不代表真机验收。
- 普通预览码 `/private/tmp/w14-console-preview.jpg` 已在临时启用 `wx.setEnableDebug({ enableDebug: true })` 的 W14 构建上生成。临时开关已移除，最终普通构建与 `npm run check:release` 均通过；开关不在提交中。

## 真机待验收

请扫码重复上面的操作，并把 vConsole 的 **Error**、**Warn** 两页截图发回。另请附上原始 `onPageScroll` 文案/截图，补全该项的原文证据。当前结论只覆盖 W14 微信开发者工具和网页截图，尚不代表真机验收通过。
