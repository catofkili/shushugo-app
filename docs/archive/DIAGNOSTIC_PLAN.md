# 导航栏问题诊断方案

## 🔍 诊断步骤

### 1. 测试基础 HTML（最简单）
我创建了一个纯 HTML 测试页面：`test-fixed-nav.html`

**请测试**：
1. 在**浏览器**中打开这个文件
2. 滚动页面
3. 看底部导航栏是否固定

**如果固定** ✅ → 说明 CSS 本身没问题，问题在 React 应用中
**如果不固定** ❌ → 说明可能是浏览器或 WebView 的问题

### 2. 在 iOS 模拟器中测试
把这个 HTML 文件也放到 iOS 中测试：

```bash
# 复制到 public 目录
cp test-fixed-nav.html ~/Documents/master-nihongo-ios/frontend/public/

# 然后在模拟器中访问
# http://localhost:5173/test-fixed-nav.html
```

### 3. 检查实际的 DOM 结构

在浏览器中打开 `http://localhost:5173`，然后：

1. **F12** 打开开发者工具
2. 点击 **Elements** 标签
3. 找到 `<nav>` 元素（底部导航栏）
4. 查看：
   - `position` 的值
   - 父元素是什么
   - 有没有 `transform` 属性
   - `z-index` 的值

## 🎯 可能的原因

### 原因 1: 父元素有 transform
如果父元素有 `transform`，`position: fixed` 会相对于父元素而不是视口。

**检查**：
```javascript
// 在浏览器 console 运行
const nav = document.querySelector('nav');
let parent = nav.parentElement;
while (parent) {
  const style = window.getComputedStyle(parent);
  if (style.transform !== 'none') {
    console.log('找到 transform:', parent, style.transform);
  }
  parent = parent.parentElement;
}
```

### 原因 2: iOS WebView 的特殊行为
某些 iOS WebView 配置可能影响 `position: fixed`。

**解决**：检查 `capacitor.config.ts` 中的 WebView 设置。

### 原因 3: CSS 被覆盖
虽然用了 inline style，但可能有 `!important` 规则。

**检查**：在开发者工具中查看 computed styles。

### 原因 4: 渲染层级问题
虽然 z-index 很高，但可能在某个渲染上下文中。

## 📝 下一步行动

**请按顺序测试**：

1. ✅ **打开 test-fixed-nav.html** 
   - 浏览器中是否固定？
   - iOS 模拟器中是否固定？

2. ✅ **在浏览器中检查实际应用**
   - 打开 http://localhost:5173
   - F12 → Elements
   - 找到 <nav> 元素
   - 告诉我 computed position 的值

3. ✅ **运行诊断脚本**
   - 在浏览器 console 中运行上面的 transform 检查脚本

**把结果告诉我，我就能准确定位问题！**

---

**当前进度**：
- ✅ inline style 已设置
- ✅ 导航栏已移到最外层
- ⏳ 等待诊断结果
