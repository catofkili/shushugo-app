# W15 小程序 / 网页视觉差异矩阵

## 运行口径

- 小程序使用隔离项目 `/private/tmp/shushugo-w15-isolated/taro-spike-2`，iPhone 模拟器 390×844；根 tab webview 为 390×671，推入的子页 webview 为 390×753。账户数据目录为 `w15-visual`；没有触碰 5173 学习页或主目录数据。
- 固定路由脚本的最后一轮结果在 [`route-sweep.txt`](route-sweep.txt)。26 个路由均有渲染文本，`BAD=0`、`ERR=0`。逐页小程序截图在 `mini/`，网页参考图使用新的无痕浏览器上下文、375×812，在 `web/`。
- 小程序单词 tab 的隔离样例已有今日完成记录，因此最终路由截图 `mini/pages_word_index.png` 是完成页。卡片正反面网页参考在 `web/word-before.png`、`web/word-after.png`；修复前的小程序隐藏答案卡在 `before/_pages_word_index.png`。最终模拟器未取得同状态的单词卡翻面截图，真机预览后请用户补拍。
- 未改变 `frontend/src`；网页截图作为视觉基线。小程序图片不纳入 Git 提交。
- 最终测量记在 [`layout-measurements.txt`](layout-measurements.txt)。小程序截图在首轮高度修正时曾显示三页仍截短；这次复查定位并修正了共同的 Pro 预览高度和分类筛选器布局。

## 已修正的差异

| 页面 / 状态 | 网页与小程序差异、根因 | 修复与分类 | 对照证据 |
|---|---|---|---|
| 首次设定、学习模式、考期选项 | Taro WXML 丢弃 `aria-*`；CSS 选中态规则因而不匹配。React 仍通过 TaroElement 的属性设置路径更新状态。 | PostCSS 将全部 CSS 属性选择器映射成类；运行时在 `setAttribute`、`removeAttribute` 和 class 变化时维护映射类。公共运行时修复。 | 修复前首次设定弹窗：`before/first-setup.png`；修复后动态验证 `.attr-aria-pressed-true` 从“会五十音”迁移到 N5，学习模式也完成迁移。网页参考：`web/setup-initial.png`、`web/setup-selection.png`。 |
| 首页学习回顾遮幕 | CSS 分包脚本按 `.wr-*` 类把 `.wr-entrance-veil` 移入学习回顾分包，但主页也通过 portal 使用它，主页因此只漏出一个「日」字。 | 保留共享遮幕规则在全局 `app.wxss`；其他周报样式仍按路由分包。平台构建修复，网页不变。 | 修复前 `before/_pages_home_weekly-veil.png`；修复后 `mini/pages_home_index.png`。 |
| 疑难辨析分类筛选 | WXSS 将 `.cf-types` 的 `flex-wrap: wrap` 算作 `nowrap`，按钮被压成窄竖条；单给按钮保留宽度又会让一行横向溢出。 | 小程序专用三列网格，保持按钮宽度并让所有筛选项留在屏内。网页 CSS 不变。平台布局适配。 | `mini/study_confusion_index.png`；最终容器 358×114，9 项分三行。网页参考：`web/confusion.png`。 |
| 疑难辨析、一字多音 | 网页 `ProReadingPreview` 高度公式重复扣浏览器顶栏、底栏；小程序 webview 已由原生导航排除，导致容器只有 451px，视口余下部分空白。 | 两页预览容器按小程序视口减去自身 32px 内边距，最终 720px。保留会员对角遮罩，不把它当本次 bug。公共壳层适配。 | `mini/study_confusion_index.png`、`mini/study_kanji-readings_index.png`；网页参考 `web/confusion.png`、`web/kanji-readings.png`。 |
| 背单词整页 | 原生顶栏、底栏在 webview 外；网页按 `--app-main-*` 变量计算的卡片高度在小程序只占部分可用区。 | 小程序内容主区启用原生 `ScrollView`；单词卡高为 `100vh - 2rem`。公共壳层适配。 | 最终 tab 截图 `mini/pages_word_index.png`（完成态）；测量卡片 638px / 内容区 671px。网页翻面前后参考：`web/word-before.png`、`web/word-after.png`；修复前小程序卡片：`before/_pages_word_index.png`。 |
| 词库记忆档、设置开关、动效偏好 | `data-band`、`type=checkbox`、`data-motion` 属性不进入 WXML，属性 CSS 无法选中。 | 同一属性类映射覆盖 presence、等值及字符串运算符；主题根同步当前 motion 类。公共运行时修复。 | `mini/study_word-list_index.png`、`mini/account_settings_index.png`；记忆档点选、设置 checkbox 和“省电”动态类已实测。网页状态以原页面为基线。 |
| 一字多音展开说明 | `<details open>` 在 `.weapp` Disclosure 适配器中用 `is-open` 状态和上/下箭头实现，不输出原生 `open` 属性。 | 保留既有平台适配器；点击后 `.is-open` 与箭头联动。不是本次三个页面的空白问题。平台实现差异。 | `mini/study_kanji-readings_index.png`；点击后实测 `is-open`、箭头 `▴`。 |
| Pro 对角提示 | 会员遮罩是既有页面状态，不是剩余屏幕空白的根因。 | 按用户更正保持不变。 | `mini/account_pro_index.png` 与两张浏览页图。 |

## 26 路由结果

| 路由 | 结果 | W15 视觉检查 | 小程序截图 |
|---|---|---|---|
| `/pages/home/index` | OK | 主题根、首页与学习回顾遮幕 | `mini/pages_home_index.png` |
| `/pages/word/index` | OK | 整页单词卡高度 | `mini/pages_word_index.png` |
| `/pages/grammar/index` | OK | 语法首页；无新增平台差异 | `mini/pages_grammar_index.png` |
| `/pages/profile/index` | OK | 我的页；无新增平台差异 | `mini/pages_profile_index.png` |
| `/study/team/index` | OK | 未登录提示；无 W15 布局改动 | `mini/study_team_index.png` |
| `/study/quick-study/index` | OK | 答案区渲染；无 W15 专项改动 | `mini/study_quick-study_index.png` |
| `/study/vocab-test/index` | OK | 答题控件渲染 | `mini/study_vocab-test_index.png` |
| `/study/study-modes/index` | OK | `aria-pressed` 选中态 | `mini/study_study-modes_index.png` |
| `/study/confusion/index` | OK | 内容高度、分类筛选网格 | `mini/study_confusion_index.png` |
| `/study/distinction-quiz/index` | OK | 空训练范围提示；隔离样例没有可练组 | `mini/study_distinction-quiz_index.png` |
| `/study/kanji-readings/index` | OK | 内容高度、Disclosure 展开 | `mini/study_kanji-readings_index.png` |
| `/study/word-list/index` | OK | 长列表滚动、记忆档颜色 | `mini/study_word-list_index.png` |
| `/study/jlpt-plan/index` | OK | 备考计划页；选中态由动态 selector 测试覆盖 | `mini/study_jlpt-plan_index.png` |
| `/account/pro/index` | OK | 会员页对角提示保持原样 | `mini/account_pro_index.png` |
| `/account/notifications/index` | OK | 微信订阅模板未配置提示；平台能力状态 | `mini/account_notifications_index.png` |
| `/account/settings/index` | OK | checkbox、每日量、动效偏好 | `mini/account_settings_index.png` |
| `/account/privacy/index` | OK | 隐私页渲染 | `mini/account_privacy_index.png` |
| `/account/privacy-policy/index` | OK | 隐私政策渲染 | `mini/account_privacy-policy_index.png` |
| `/account/user-agreement/index` | OK | 用户协议渲染 | `mini/account_user-agreement_index.png` |
| `/account/help/index` | OK | 帮助页渲染 | `mini/account_help_index.png` |
| `/content-pages/detail/index` | OK | 语法详情渲染 | `mini/content-pages_detail_index.png` |
| `/content-pages/grammar-foundation/index` | OK | 语法基础目录渲染 | `mini/content-pages_grammar-foundation_index.png` |
| `/content-pages/favorites/index` | OK | 收藏空态渲染 | `mini/content-pages_favorites_index.png` |
| `/content-pages/yuzu-shop/index` | OK | 商店类别与卡片渲染 | `mini/content-pages_yuzu-shop_index.png` |
| `/content-pages/achievements/index` | OK | 成就列表渲染 | `mini/content-pages_achievements_index.png` |
| `/content-pages/about/index` | OK | 关于页渲染 | `mini/content-pages_about_index.png` |

## 本地验收

| 检查 | 结果 |
|---|---|
| `npm run build:weapp` | 通过；最新包主包 1,851,511 B（上限 1,900,000 B），所有分包均在预算内。 |
| Taro `npm test` | 通过；内容异步加载、浏览器运行时、云取数、release 自测和包体闸门通过。 |
| `npm run check:release` | 通过；普通包、无计时层、无开发专用代码。 |
| 前端 `npm run check` | 通过。 |
| 前端 `npm run lint` | 通过，0 errors、43 warnings（既有 warning）。 |
| 前端 `npm test` | 默认 5 秒单测超时下，3 项种子迁移/快照测试超时；`npm test -- --testTimeout=30000` 重跑通过：115 文件通过、2 跳过，814 项通过、26 跳过。 |
| 原生小程序 `npm test` | 通过，30 个脚本全部通过；路线 A 豁免由既有 `2ecc6651` 批准。 |
| DevTools 路由扫页 | 26/26 OK，`BAD=0`、`ERR=0`。 |
| 普通预览码 | 已生成在 `preview-qr.jpg`；开发者工具预览上传成功。预览统计主包 1,816,172 B。 |

## 验收边界

截图来自微信开发者工具模拟器。真机视觉仍以普通预览码扫描后的 iPhone 画面为准；请回传首次设定点选后、主页、背单词翻面后、疑难辨析、一字多音、设置页和「我的」截图。会员遮罩斜角不属于本次修复。
