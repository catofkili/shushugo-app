# 问题排查指南

> 日语学习主页面可能正在保存真实进度。**不要刷新、接管或复用正在学习的 5173 页面。**
> 浏览器复现必须使用隔离数据并另开端口，例如 `npm run dev -- --port 5174`；只需要判断
> 类型、算法或数据转换时，优先直接运行测试，不启动页面。

## 如果"我的"页面按钮不能点击

### 现象 1: 按钮完全没反应

**可能原因:**
- React 状态更新问题
- 事件处理器未正确绑定
- TypeScript 编译错误

**解决方法:**
1. 用隔离数据启动 `npm run dev -- --port 5174`，只打开新输出的地址
2. 打开开发者工具（F12）
3. 查看 Console 是否有错误
4. 点击"我的"页面的按钮
5. 查看是否有报错信息

### 现象 2: 按钮有反应但不跳转

**可能原因:**
- `setPage()` 函数被调用但页面没渲染
- `renderPage()` 函数缺少对应的页面处理

**检查方法:**
```bash
# 检查所有页面文件是否存在
ls ~/Documents/shushugo/frontend/src/pages/*.tsx

# 应该看到:
# - PersonalInfo.tsx
# - AccountSecurity.tsx
# - NotificationSettings.tsx
# - SettingsPage.tsx
# - PrivacySettings.tsx
# - HelpPage.tsx
# - AboutPage.tsx
```

### 现象 3: 某些按钮可以，某些不行

**可能原因:**
- 特定页面组件有错误
- 导入路径不正确

**排查步骤:**
1. 找出哪个按钮不行
2. 查看对应的页面文件
3. 检查是否有语法错误

## 缓存清理

先只清理可再生成的 Web 构建缓存：

```bash
cd /Users/lsc/Documents/shushugo/frontend

rm -rf node_modules/.vite
rm -rf dist
npm run build
npx cap sync ios
```

不要删除 `frontend/ios`、Pods 或 Podfile.lock 作为通用排错步骤，更不要重新运行
`npx cap add ios`。原生工程含签名、capability、最低系统版本和插件配置；若 CocoaPods
确实报错，先保留完整错误并在 `frontend/ios/App` 单独运行 `pod install`。

## 在浏览器中调试

最简单的调试方法：

```bash
cd ~/Documents/shushugo/frontend
npm run dev -- --port 5174
```

然后只访问新输出的 5174 地址。不要打开或刷新正在学习的 5173 页面。

在浏览器中：
1. 打开开发者工具（F12）
2. 切换到 Console 标签
3. 点击"我的"
4. 点击任意按钮
5. 查看 Console 输出

## 常见错误信息

### TypeError: Cannot read property 'page' of undefined
**原因**: `profileSections` 中的 item 没有 `page` 属性
**解决**: 检查 App.tsx 中 profileSections 的定义

### Module not found: Can't resolve './pages/XXX'
**原因**: 页面文件不存在或路径错误
**解决**: 检查文件是否存在，路径是否正确

### Uncaught ReferenceError: XXX is not defined
**原因**: 组件未正确导入
**解决**: 检查 App.tsx 顶部的 import 语句

## 快速测试方法

在浏览器 Console 中输入：

```javascript
// 检查页面状态
console.log('当前页面类型定义:', 'word | grammar | detail | toolbox | dashboard | review | mistakes | comparison | profile | account | personal-info | notifications | settings | privacy | help | about');

// 模拟点击
// 如果能看到页面变化，说明逻辑是对的
```

## 联系支持

如果以上方法都不行，请提供：
1. 浏览器 Console 的完整错误信息
2. 点击哪个按钮不行
3. 其他功能是否正常（单词学习、语法等）
