# 路线 A 第三轮：第 5 步结论（2026-09-25）

## 配置核对

基线为 `refs/archive/worktree/taro-spike-2-review`，提交 `2e1b5ef351f3596075e7ca59e5e7189a1ec89ef6`。

- Taro 4 官方实现说明：小程序 React 渲染器在 `@tarojs/react`，它以自定义渲染器替代 ReactDOM；项目因此保留 `@tarojs/react`，不再给 `react-dom` 手工指定 Web 别名。
- Taro 尺寸文档：375 设计稿对应 `designWidth: 375` 和 `deviceRatio: { 375: 2 }`；归档配置已符合。
- 官方分包配置以 `subPackages` 中声明的页面路由为边界，可配置分包预下载；这负责页面包加载，不提供从一个分包异步导入另一分包任意 JS 模块的接口。

依据：[Taro 实现细节](https://docs.taro.zone/docs/implement-note)、[设计稿及尺寸单位](https://docs.taro.zone/docs/3.x/size)、[全局配置](https://docs.taro.zone/docs/app-config)。

## 第 2–4 步试验产物

- 贴纸依照小程序品牌资源流程从网页原图用 `cwebp -q 82` 压缩，共 10 张，放在 `features/vocab-test` 分包。
- 用 `@tarojs/react` 专用组件替代 `lucide-react` 的内联 SVG，构建时生成 21 个图标的深色 / 浅色 SVG 文件；Taro 页面通过小程序 `Image` 加载。
- App 入口增加浅色背景、内边距和居中的内容区，作为试验页外壳。
- `NODE_ENV=production CI=1 npm run build:weapp` 编译成功。包体统计：主包 **1,230,874 B（1.174 MiB）**；`features` 分包 **2,017,226 B（1.924 MiB）**；每包上限 **2,097,152 B**，功能分包余量 **79,926 B**。`features/vocab-test/index.js` 为 **1,829,927 B**。
- Webpack stats 中 `question-meanings.js` 模块为 **719,694 B**，仍被静态编进查词页分包；上一轮替代器 `scripts/taro-content.cjs` 正是直接导入这份数据。

## 第 5 步：未能实现受支持的内容异步分包

1. Taro 动态 import 文档说明，小程序默认不支持真正的 `import()`，Taro Babel preset 会把它转换为同步 `require()`。本 worktree 用锁定的 Taro 4.2.1 `babel-preset-taro` 做转换验证，输出也是 `Promise.resolve().then(() => require(...))`，不会形成可在之后加载的独立 chunk。
2. Taro 的智能分包依赖文档说明，小程序分包之间不能互相引用文件。文档提供的 `sub-common` 方案会把共享模块复制进每个使用它的分包，不会形成一个可由多个页面包异步读取的单独内容包。
3. 因而，把题面移出 `features` 后，Taro 4.2.1 + Webpack 5 的官方配置没有办法让当前 React 页面再从该内容分包按需导入它。可用的 Taro 分包边界是页面路由；将题面留在该路由包仍是静态加载，不能满足本步骤“出厂内容按需加载、为后续页面留出包体空间”的要求。改用第三方动态 import 插件也不是本轮可接受做法：Taro 文档只描述 Webpack4 插件方案，并提示有审核风险。

依据：[动态 import](https://docs.taro.zone/en/docs/3.x/dynamic-import)、[智能提取分包依赖](https://docs.taro.zone/en/docs/mini-split-chunks-plugin)。文档页面标注为 3.x；对本项目锁定的 Taro 4.2.1 行为另用本地 Babel preset 实测。

**判定：第 5 步未通过，按任务硬规则停止第 6–8 步。** 这不是当前 2 MiB 包体超限（实测仍低于上限），而是 Taro 所支持的分包边界和模块加载方式无法满足出厂内容跨包按需读取。没有继续编译 `WordStudy.tsx`、生成预览二维码或测真机；开发者工具 CLI 打开项目时返回 `需要重新登录`，所以本轮新增页面也没有模拟器截图。该 blocker 与完整试验快照一并归档。
