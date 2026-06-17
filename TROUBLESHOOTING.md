# 问题排查指南

## 如果"我的"页面按钮不能点击

### 现象 1: 按钮完全没反应

**可能原因:**
- React 状态更新问题
- 事件处理器未正确绑定
- TypeScript 编译错误

**解决方法:**
1. 在浏览器中打开 http://localhost:5173
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
ls ~/Documents/master-nihongo-ios/frontend/src/pages/*.tsx

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

## 缓存清理命令

如果需要完全重新开始：

```bash
cd ~/Documents/master-nihongo-ios/frontend

# 清理所有缓存
rm -rf node_modules/.vite
rm -rf dist
rm -rf build
rm -rf ios/App/App/public
rm -rf ios/App/Pods
rm -rf ios/App/Podfile.lock

# 重新构建
npm run build
npx cap sync ios

# 在 Xcode 中
# Product > Clean Build Folder (Shift+Cmd+K)
# 然后重新运行
```

## 在浏览器中调试

最简单的调试方法：

```bash
cd ~/Documents/master-nihongo-ios/frontend
npm run dev
```

然后访问 http://localhost:5173

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
