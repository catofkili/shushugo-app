# 小程序全路由截图对照报告（2026-10-02）

工作区：`/Users/lsc/Documents/shushugo-wt/route-parity`；分支：`codex/route-parity`。未提交、未合并、未上传、未生成预览码。网页源码无改动。

## ① 改了哪些文件

| 文件 | 用途 |
|---|---|
| `.gitignore` | 忽略截图、控制台日志与临时验收产物目录 |
| `taro-spike-2/src/platform/mini-overrides.weapp.css` | 注音裁切、边框 reset、首页伪元素、浅色 Image 图标与原始 slash utility 匹配 |
| `taro-spike-2/src/study/study-modes/study-modes.weapp.css` | 学习模式页图标、底框与说明色 |
| `taro-spike-2/src/study/study-modes/index.tsx` | 只引入小程序页面样式 |
| `taro-spike-2/src/account/login/LoginShell.weapp.tsx` | 独立登录页的主题外壳与 portal host |
| `taro-spike-2/src/account/login/index.tsx` | 接入 LoginShell；登录业务与文字不变 |
| `taro-spike-2/src/content-pages/favorites/favorites-layout.weapp.css` | 未选中 tab 透明背景 |
| `taro-spike-2/src/content-pages/favorites/index.tsx` | 只引入小程序页面样式 |
| `taro-spike-2/src/content-pages/yuzu-shop/yuzu-layout.weapp.css` | 结账条原生可用高度适配 |
| `taro-spike-2/src/content-pages/yuzu-shop/index.tsx` | 只引入小程序页面样式 |
| `taro-spike-2/reports/css-source-bytes.json` | 保留实际最终构建的报告变化 |
| `taro-spike-2/reports/package-gates.json` | 保留实际最终构建的报告变化 |
| `taro-spike-2/reports/package-sizes.json` | 保留实际最终构建的报告变化 |
| `taro-spike-2/reports/route-css-split.json` | 保留实际最终构建的报告变化 |
| `taro-spike-2/reports/webpack-stats.json` | 保留实际最终构建的报告变化 |
| `taro-spike-2/reports/route-parity-report.md` | 本报告 |

截图与原始日志留在本机 `taro-spike-2/reports/route-parity/`，由根 `.gitignore` 排除。没有改共享网页源码、业务逻辑、数据源或文案；页面 index.tsx 仅接入小程序样式 / 展示外壳。

## ② 每处问题：现象 → 原因 → 改法 + 三张图

### 1. 语法注音裁切

第一行「名詞」上方的读音只剩下半截 → 微信原生 button 的默认 overflow:hidden 裁掉浮在基线以上的注音 → 仅给 grammar-anki-card 的标题按钮恢复 overflow:visible。

- 网页：[web-grammar.png](route-parity/web-grammar.png)
- 小程序改前：[weapp-grammar.png](route-parity/weapp-grammar.png)
- 小程序改后：[weapp-after-grammar.png](route-parity/weapp-after-grammar.png)

### 2. 动态颜色样式丢失

语法详情的接续浅绿块消失；学习模式的选中底色、图标底框及说明文字颜色也不对 → 运行时 class 保留 bg-[#81D8CF]/12、/16、/18 和 text-white/58 等原字符串，WXSS 的同名选择器被转义后匹配不到 → 小程序 attribute-selector 桥按原始 class 的 opacity 范围恢复 design.css 的 primary-tint / ink-2 / ink-3；学习模式页的结构规则放在分包样式。

- 网页：[web-detail.png](route-parity/web-detail.png)
- 小程序改前：[weapp-detail.png](route-parity/weapp-detail.png)
- 小程序改后：[weapp-after-detail.png](route-parity/weapp-after-detail.png)

### 3. 学习模式图标颜色丢失

网页绿图标在小程序变成深墨色 → lucide 使用原生 Image，SVG 的 currentColor 不会继承父节点主题色 → 分包 CSS filter 还原网页默认浅色图标 #5C8F32；像素抽样两端均为 RGB(92,143,50)。

- 网页：[web-study-modes.png](route-parity/web-study-modes.png)
- 小程序改前：[weapp-study-modes.png](route-parity/weapp-study-modes.png)
- 小程序改后：[weapp-after-study-modes.png](route-parity/weapp-after-study-modes.png)

### 4. 浅色页图标不可见

太阳、月亮图标消失；「我的」与其他设置入口的右箭头也近乎白色 → lucide 根据 text-white 类选了 light SVG，网页浅色主题的颜色重映射对 Image 无效 → 仅在 theme-light 对这些 Image 的既有 text-whites40/45/60/70 类应用网页 muted ink #978C7E 的 filter；保留深色主题。

- 网页：[web-settings.png](route-parity/web-settings.png)
- 小程序改前：[weapp-settings.png](route-parity/weapp-settings.png)
- 小程序改后：[weapp-after-settings.png](route-parity/weapp-after-settings.png)

### 5. 边框与分隔线缺失

账号条目之间没有分隔线，会员卡和若干次按钮的边框不见 → WXSS 丢掉 Tailwind 通配 preflight 的 border-style:solid；border / border-t / border-b 只改宽度，仍是 none → 恢复这三个现有 utility 的 border-style；单边 utility 明确将其他三边宽度归零；同样修复辨析练习的返回按钮。

- 网页：[web-profile.png](route-parity/web-profile.png)
- 小程序改前：[weapp-profile.png](route-parity/weapp-profile.png)
- 小程序改后：[weapp-after-profile.png](route-parity/weapp-after-profile.png)

### 6. 会员卡黑色描边

恢复边框后，会员权益浅绿块出现网页没有的黑色描边 → 动态 border-white/12 的颜色匹配丢失；design.css 对浅色块的 :is() + attribute 透明边框规则也没有生效 → 小程序 attribute-selector 桥恢复 ds-line，同时匹配原始 / 已编码 bg-tint 类并按网页 bg-tint + border-white 条件恢复透明边框；原生实测 border-color 为 rgba(0,0,0,0)。

- 网页：[web-pro.png](route-parity/web-pro.png)
- 小程序改前：[weapp-before-border-pro.png](route-parity/weapp-before-border-pro.png)
- 小程序改后：[weapp-after-pro.png](route-parity/weapp-after-pro.png)

### 7. 学习模式贴纸裁切

标题右侧的问号贴纸上沿被截掉 → 原生 ScrollView 在自身 padding 边缘裁切，而贴纸 -my-3 的上沿落在该边缘外；实测图片 top=4px，内容起点=16px → 仅在页面分包 CSS 平移这张贴纸 12px，保留共享标题行高与文字布局。

- 网页：[web-study-modes.png](route-parity/web-study-modes.png)
- 小程序改前：[weapp-study-modes.png](route-parity/weapp-study-modes.png)
- 小程序改后：[weapp-after-study-modes.png](route-parity/weapp-after-study-modes.png)

### 8. 首页装饰圆错位

今日大卡右上光圆没有按网页显示，光斑跑到左上 → 微信 button::after 默认 left/bottom/transform/transform-origin 污染网页的装饰伪元素 → 仅 zoo-now::after 恢复网页默认 auto / none / center；不更改网页圆的位置、颜色或尺寸。

- 网页：[web-home.png](route-parity/web-home.png)
- 小程序改前：[weapp-home.png](route-parity/weapp-home.png)
- 小程序改后：[weapp-after-home.png](route-parity/weapp-after-home.png)

### 9. 登录页缺主题外壳

对话框退回旧深色配色，深色关闭图标看不见 → 这个独立原生路由绕过 WeappPage，没有主题 class 与 portal host → 新增 LoginShell.weapp.tsx，复用 getResolvedTheme 与 usePortalHost；原登录业务、按钮文字与回调全部保留。

- 网页：[web-account-login-index.png](route-parity/web-account-login-index.png)
- 小程序改前：[weapp-account-login-index.png](route-parity/weapp-account-login-index.png)
- 小程序改后：[weapp-after-account-login-index.png](route-parity/weapp-after-account-login-index.png)

### 10. 收藏页未选中 tab 默认白面

「单词 / 语法」两个未选中 tab 是白块，网页应露出父容器浅色底 → 原生 button 自带白背景，普通透明 reset 在此没有获胜 → 只在收藏页分包样式给未选中 tab 明确 transparent；已选中 tab 保留主色。

- 网页：[web-favorites.png](route-parity/web-favorites.png)
- 小程序改前：[weapp-favorites.png](route-parity/weapp-favorites.png)
- 小程序改后：[weapp-after-favorites.png](route-parity/weapp-after-favorites.png)

### 11. 商店结账条悬空

结账条下面仍露出大段商品，离实际底部过远 → 共享 CSS 的 --app-main-bottom 包含网页 tab 栏，但小程序分包页面没有这根栏；初次补规则又被 CSS splitter 追加的共享规则覆盖 → 分包 CSS 以既有 weapp-theme-root 提高特异度，只保留网页的 6px 间距与 safe-area；实测 bottom 从 110px 变为 40px。

- 网页：[web-yuzu-shop.png](route-parity/web-yuzu-shop.png)
- 小程序改前：[weapp-yuzu-shop.png](route-parity/weapp-yuzu-shop.png)
- 小程序改后：[weapp-after-yuzu-shop.png](route-parity/weapp-after-yuzu-shop.png)

同一通用规则影响的其余页面也均有首屏改前 / 改后截图，见下方路由清单。

## ③ 留给 Claude 定的差异（未自行改设计 / 业务 / 文案）

| 页面 | 差异与边界 | 截图 |
|---|---|
| pro / profile | 微信「首月赠送会员」与网页 Pro / App Store 方案不同；没有改变权益或购买流程。 | [web-pro](route-parity/web-pro.png) / [weapp-pro](route-parity/weapp-after-pro.png)；[web-profile](route-parity/web-profile.png) / [weapp-profile](route-parity/weapp-after-profile.png) |
| account / login | 微信登录、审核账号入口与网页 Apple / 邮箱登录不相同；本次只修主题，不决定登录功能差异。 | [web-account](route-parity/web-account.png) / [weapp-account](route-parity/weapp-after-account.png)；[web-login](route-parity/web-account-login-index.png) / [weapp-login](route-parity/weapp-after-account-login-index.png) |
| notifications | 微信订阅提醒暂不可用，网页有完整提醒设置。属于平台功能 / 配置差异，未碰。 | [web](route-parity/web-notifications.png) / [weapp](route-parity/weapp-after-notifications.png) |
| confusion / grammar-foundation / word 等 | 网页是首次设定后的新来源空库；模拟器沿用既有存档。辨析总组数 1893 / 1881、词序、规划量、收藏等数据状态不一致。没有灌库、清库、评分或伪造账号来强行对齐。 | [web-confusion](route-parity/web-confusion.png) / [weapp-confusion](route-parity/weapp-after-confusion.png)；其余逐页见清单 |
| help | 帮助页平台提示与反馈方式不同，属于文案 / 平台流程范围，保留给 Claude 核对。 | [web-help](route-parity/web-help.png) / [weapp-help](route-parity/weapp-after-help.png) |

字体渲染、原生导航栏、开发工具设备框与标识按任务约定排除。仅检查要求的浅色首屏；没有自行改列数、字号、字体、入口、文案或动画。

## ④ 验收输出

主包：`reports/package-gates.json` 的 `packages.main.bytes` = **1,860,223**。基线 1,858,495，增量 **1,728 B**，允许上限 +2,000 B；通过。

| 命令 | 输出 / 结果 | 原始完整日志 |
|---|---|
| `cd frontend && npm run check` | exit 0，`tsc --noEmit` | [frontend-check.log](route-parity/frontend-check.log) |
| `cd frontend && npm run lint` | exit 0，0 errors / 45 warnings | [frontend-lint.log](route-parity/frontend-lint.log) |
| `cd frontend && npx vitest run` | 134 passed / 2 skipped 文件；954 passed / 26 skipped 测试 | [frontend-vitest.log](route-parity/frontend-vitest.log) |
| `cd taro-spike-2 && npm run build:weapp` | exit 0，构建 / 包体 / WXSS / 平台 API 闸门通过 | [build-final.log](route-parity/build-final.log) |
| `cd taro-spike-2 && npm run check:release` | exit 0，16 项发布配置检查通过；这里只验证，没有上传 | [taro-release-final.log](route-parity/taro-release-final.log) |
| `cd taro-spike-2 && npm test` | exit 0，11 个脚本通过 | [taro-test-final.log](route-parity/taro-test-final.log) |
| `cd wechat-miniprogram && npm test` | exit 0，32 个脚本全部通过 | [wechat-test.log](route-parity/wechat-test.log) |
| `git diff --check` | exit 0 | 工作区最终复核 |

全部命令的原始输出合并在 [acceptance-output.txt](route-parity/acceptance-output.txt)。

微信开发者工具按任务指定在每次最终 build 后运行 `cli auto --project .../taro-spike-2 --auto-port 9681`，没有关闭 IDE 或其他项目窗口。36 个登记页实际导航成功；改前 / 改后均为 console.error + exception 合计 0。日志：[mini-before.log](route-parity/mini-before.log)、[mini-final.log](route-parity/mini-final.log)，原始事件数组：[mini-after.json](route-parity/mini-after.json)。

测量不能用缓存的 wx.getSystemInfoSync.windowHeight：它始终返回首次 tab 页的 639。原生元素实测 `.weapp-app-main`：tab 页 639 px，普通分包 721 px；截图设备为 375×812。网页 PNG 是 375×812，开发工具原生截图为其设备框缩放输出 466×1008，未冒充网页尺寸。

网页运行于 5251（strictPort）。先通过界面选「会五十音」并保存，其后用应用自己的 `setAppState({page:同名 id})` 进入对应页，以覆盖直接小程序路由同样可达的账号 / Pro 页面；登录对照通过实际 requireAccount 打开，截完关闭弹窗。新来源的导航与学习数据状态没有写回 5173。

网页有 3 次 `/__live-snapshot` 404（分别在初始化 / study-modes / favorites 时出现）；5251 明确不提供个人实时快照接口，终端启动日志也说明「非 5173，不收快照」。没有隐藏或假造这 3 次网络错误。网页 0 个 JS exception，小程序每页 0 error / exception。证据：[web-resource-failures.json](route-parity/web-resource-failures.json)、[web.json](route-parity/web.json)。

### 全路由清单（dist/app.json；去掉 weekly-report / talk）

| route | 网页 | 小程序改前 | 小程序改后 | error / exception |
|---|---|---|---|---|
| `pages/home/index` | [图](route-parity/web-home.png) | [图](route-parity/weapp-home.png) | [图](route-parity/weapp-after-home.png) | 0 / 0 |
| `pages/word/index` | [图](route-parity/web-word.png) | [图](route-parity/weapp-word.png) | [图](route-parity/weapp-after-word.png) | 0 / 0 |
| `pages/grammar/index` | [图](route-parity/web-grammar.png) | [图](route-parity/weapp-grammar.png) | [图](route-parity/weapp-after-grammar.png) | 0 / 0 |
| `pages/profile/index` | [图](route-parity/web-profile.png) | [图](route-parity/weapp-profile.png) | [图](route-parity/weapp-after-profile.png) | 0 / 0 |
| `study/team/index` | [图](route-parity/web-team.png) | [图](route-parity/weapp-team.png) | [图](route-parity/weapp-after-team.png) | 0 / 0 |
| `study/quick-study/index` | [图](route-parity/web-quick-study.png) | [图](route-parity/weapp-quick-study.png) | [图](route-parity/weapp-after-quick-study.png) | 0 / 0 |
| `study/vocab-test/index` | [图](route-parity/web-vocab-test.png) | [图](route-parity/weapp-vocab-test.png) | [图](route-parity/weapp-after-vocab-test.png) | 0 / 0 |
| `study/study-modes/index` | [图](route-parity/web-study-modes.png) | [图](route-parity/weapp-study-modes.png) | [图](route-parity/weapp-after-study-modes.png) | 0 / 0 |
| `study/confusion/index` | [图](route-parity/web-confusion.png) | [图](route-parity/weapp-confusion.png) | [图](route-parity/weapp-after-confusion.png) | 0 / 0 |
| `study/distinction-quiz/index` | [图](route-parity/web-distinction-quiz.png) | [图](route-parity/weapp-distinction-quiz.png) | [图](route-parity/weapp-after-distinction-quiz.png) | 0 / 0 |
| `study/kanji-readings/index` | [图](route-parity/web-kanji-readings.png) | [图](route-parity/weapp-kanji-readings.png) | [图](route-parity/weapp-after-kanji-readings.png) | 0 / 0 |
| `study/word-list/index` | [图](route-parity/web-word-list.png) | [图](route-parity/weapp-word-list.png) | [图](route-parity/weapp-after-word-list.png) | 0 / 0 |
| `study/jlpt-plan/index` | [图](route-parity/web-jlpt-plan.png) | [图](route-parity/weapp-jlpt-plan.png) | [图](route-parity/weapp-after-jlpt-plan.png) | 0 / 0 |
| `account/login/index` | [图](route-parity/web-account-login-index.png) | [图](route-parity/weapp-account-login-index.png) | [图](route-parity/weapp-after-account-login-index.png) | 0 / 0 |
| `account/pro/index` | [图](route-parity/web-pro.png) | [图](route-parity/weapp-pro.png) | [图](route-parity/weapp-after-pro.png) | 0 / 0 |
| `account/account/index` | [图](route-parity/web-account.png) | [图](route-parity/weapp-account.png) | [图](route-parity/weapp-after-account.png) | 0 / 0 |
| `account/personal-info/index` | [图](route-parity/web-personal-info.png) | [图](route-parity/weapp-personal-info.png) | [图](route-parity/weapp-after-personal-info.png) | 0 / 0 |
| `account/notifications/index` | [图](route-parity/web-notifications.png) | [图](route-parity/weapp-notifications.png) | [图](route-parity/weapp-after-notifications.png) | 0 / 0 |
| `account/settings/index` | [图](route-parity/web-settings.png) | [图](route-parity/weapp-settings.png) | [图](route-parity/weapp-after-settings.png) | 0 / 0 |
| `account/privacy/index` | [图](route-parity/web-privacy.png) | [图](route-parity/weapp-privacy.png) | [图](route-parity/weapp-after-privacy.png) | 0 / 0 |
| `account/privacy-policy/index` | [图](route-parity/web-privacy-policy.png) | [图](route-parity/weapp-privacy-policy.png) | [图](route-parity/weapp-after-privacy-policy.png) | 0 / 0 |
| `account/user-agreement/index` | [图](route-parity/web-user-agreement.png) | [图](route-parity/weapp-user-agreement.png) | [图](route-parity/weapp-after-user-agreement.png) | 0 / 0 |
| `account/help/index` | [图](route-parity/web-help.png) | [图](route-parity/weapp-help.png) | [图](route-parity/weapp-after-help.png) | 0 / 0 |
| `content-pages/detail/index` | [图](route-parity/web-detail.png) | [图](route-parity/weapp-detail.png) | [图](route-parity/weapp-after-detail.png) | 0 / 0 |
| `content-pages/grammar-foundation/index` | [图](route-parity/web-grammar-foundation.png) | [图](route-parity/weapp-grammar-foundation.png) | [图](route-parity/weapp-after-grammar-foundation.png) | 0 / 0 |
| `content-pages/favorites/index` | [图](route-parity/web-favorites.png) | [图](route-parity/weapp-favorites.png) | [图](route-parity/weapp-after-favorites.png) | 0 / 0 |
| `content-pages/yuzu-shop/index` | [图](route-parity/web-yuzu-shop.png) | [图](route-parity/weapp-yuzu-shop.png) | [图](route-parity/weapp-after-yuzu-shop.png) | 0 / 0 |
| `content-pages/achievements/index` | [图](route-parity/web-achievements.png) | [图](route-parity/weapp-achievements.png) | [图](route-parity/weapp-after-achievements.png) | 0 / 0 |
| `content-pages/about/index` | [图](route-parity/web-about.png) | [图](route-parity/weapp-about.png) | [图](route-parity/weapp-after-about.png) | 0 / 0 |
| `features/placeholder/index` | 内部页，无网页对应 | [图](route-parity/weapp-features-placeholder-index.png) | [图](route-parity/weapp-after-features-placeholder-index.png) | 0 / 0 |
| `content/placeholder/index` | 内部页，无网页对应 | [图](route-parity/weapp-content-placeholder-index.png) | [图](route-parity/weapp-after-content-placeholder-index.png) | 0 / 0 |
| `grammar-foundation/placeholder/index` | 内部页，无网页对应 | [图](route-parity/weapp-grammar-foundation-placeholder-index.png) | [图](route-parity/weapp-after-grammar-foundation-placeholder-index.png) | 0 / 0 |
| `grammar-advanced/placeholder/index` | 内部页，无网页对应 | [图](route-parity/weapp-grammar-advanced-placeholder-index.png) | [图](route-parity/weapp-after-grammar-advanced-placeholder-index.png) | 0 / 0 |
| `grammar-pages/compile/index` | 内部页，无网页对应 | [图](route-parity/weapp-grammar-pages-compile-index.png) | [图](route-parity/weapp-after-grammar-pages-compile-index.png) | 0 / 0 |
| `core/index` | 内部页，无网页对应 | [图](route-parity/weapp-core-index.png) | [图](route-parity/weapp-after-core-index.png) | 0 / 0 |
| `lazy/placeholder/index` | 内部页，无网页对应 | [图](route-parity/weapp-lazy-placeholder-index.png) | [图](route-parity/weapp-after-lazy-placeholder-index.png) | 0 / 0 |

29 对网页 / 小程序页面；7 个内部登记页仅做开发工具运行 / 截图：features、content、grammar-foundation、grammar-advanced、grammar-pages/compile、core、lazy。其 null / 空内容是源码本来如此，没有造一个网页来凑数。

## ⑤ 没做完的和原因

1. **备考页缺 mood-shocked、收藏页缺 mood-heart，尚未补资源。** 通过页面树实际 src 和 dist 文件存在性检查确认；缺资源是明确问题，不是设计争议。`sync-brand-assets.mjs` 把它们只登记在 account 分包，study / content-pages 没有相应登记，组件退到不存在的 `/assets/brand/*.png`。正统修法是补分包登记并重建；该脚本超出用户指定的 CSS / .weapp.tsx 修复范围，尚未获得额外授权，因此没有擅自改脚本、换贴纸或改用网络图。证据：[missing-images.json](route-parity/missing-images.json)。
   - 备考：[web](route-parity/web-jlpt-plan.png) / [小程序](route-parity/weapp-after-jlpt-plan.png)。
   - 收藏：[web](route-parity/web-favorites.png) / [小程序](route-parity/weapp-after-favorites.png)。
2. **7 个内部登记页没有网页截图**：route-table 没有对应页面 id，源码是资源占位或编译探针；实际开发工具截图和零错误日志已经保留。
3. 周报和 talk 按任务要求跳过；没有进行上传、提审、发布、真机扫码或实际登录 / 付款。这些不属于本次要求。
4. 报告③中的数据、通知、会员、帮助文案差异留给 Claude；不能把本次首屏布局修复称为这些业务差异的验收完成。
