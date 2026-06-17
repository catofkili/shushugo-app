# 🎨 主题切换功能完成

## ✅ 已实现功能

### 1. **三种主题模式** 🌓
- ☀️ **浅色模式** - 清新薄荷绿果冻玻璃风格
- 🌙 **深色模式** - 经典深灰色果冻玻璃风格  
- 📱 **跟随系统** - 自动同步 iOS 系统主题设置

### 2. **单行三按钮选择器** 
```
┌─────────────────────────────┐
│  [☀️]   [🌙]   [📱]        │
│  浅色    深色   跟随系统     │
└─────────────────────────────┘
```

### 3. **实时同步 iOS 系统主题** ✅
- 使用 `window.matchMedia('(prefers-color-scheme: dark)')` 检测系统主题
- 监听系统主题变化事件
- 选择"跟随系统"时自动切换

---

## 🎨 主题配色

### 浅色模式（Light）
| 元素 | 颜色 |
|------|------|
| 背景 | #F2FAF7 (薄荷白) |
| 次级背景 | #E6F2EB (薄荷绿) |
| 卡片 | #FFFFFF (纯白) |
| 主文字 | #1a4d3e (深绿) |
| 边框 | rgba(129, 216, 207, 0.2) |
| 强调色 | #81D8CF (青色) |

### 深色模式（Dark）
| 元素 | 颜色 |
|------|------|
| 背景 | #343838 (深灰) |
| 次级背景 | #3c3f3f (中灰) |
| 卡片 | #464949 (浅灰) |
| 主文字 | rgba(255, 255, 255, 0.95) |
| 边框 | rgba(255, 255, 255, 0.15) |
| 强调色 | #81D8CF (青色) |

---

## 🔧 技术实现

### 1. 主题检测
```typescript
// 获取实际应用的主题
export const getResolvedTheme = (): "light" | "dark" => {
  const prefs = getStudyPreferences();

  if (prefs.theme === "light") return "light";
  if (prefs.theme === "dark") return "dark";

  // system: 检查 iOS 系统主题
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return "dark";
  }

  return "light";
};
```

### 2. 应用主题
```typescript
// 应用主题到 DOM
export const applyTheme = (theme?: "light" | "dark") => {
  const resolved = theme || getResolvedTheme();
  document.documentElement.setAttribute("data-theme", resolved);
};
```

### 3. 监听系统变化
```typescript
// 监听 iOS 系统主题变化
if (window.matchMedia) {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  darkModeQuery.addEventListener('change', () => {
    applyTheme();  // 自动重新应用
  });
}
```

### 4. CSS 变量切换
```css
/* 浅色模式 */
:root,
[data-theme="light"] {
  --color-bg-primary: #F2FAF7;
  --color-text-primary: #1a4d3e;
}

/* 深色模式 */
[data-theme="dark"] {
  --color-bg-primary: #343838;
  --color-text-primary: rgba(255, 255, 255, 0.95);
}
```

---

## 📱 iOS 系统集成

### 自动同步原理

1. **首次加载**
   - 读取用户设置（localStorage）
   - 如果是"跟随系统"，检测 iOS 当前主题
   - 应用对应主题

2. **系统切换时**
   - iOS 系统主题改变
   - `matchMedia` 触发 `change` 事件
   - 自动重新检测并应用主题

3. **用户手动切换**
   - 点击主题按钮
   - 保存到 localStorage
   - 立即应用新主题

### iOS 系统主题检测
```typescript
// 检测 iOS 是否为深色模式
window.matchMedia('(prefers-color-scheme: dark)').matches
// true = 深色模式
// false = 浅色模式
```

---

## 🎯 使用方法

### 在应用中切换主题

1. 进入"设置"页面
2. 找到"外观"部分
3. 点击三个主题按钮之一：
   - **浅色** - 薄荷绿清新风格
   - **深色** - 深灰经典风格
   - **跟随系统** - 同步 iOS 设置

### 测试跟随系统

1. 选择"跟随系统"
2. 在 iOS 设置中切换主题：
   ```
   设置 → 显示与亮度 → 外观
   ```
3. 返回应用，主题自动同步 ✅

---

## 🔄 主题切换流程

```
用户点击主题按钮
       ↓
保存到 localStorage
       ↓
调用 applyTheme()
       ↓
├─ light → 设置 data-theme="light"
├─ dark  → 设置 data-theme="dark"
└─ system → 检测 iOS 系统
            ├─ iOS 深色 → data-theme="dark"
            └─ iOS 浅色 → data-theme="light"
       ↓
CSS 变量切换
       ↓
界面立即更新
```

---

## 🎨 主题特性对比

| 特性 | 浅色模式 | 深色模式 |
|------|---------|---------|
| **背景** | 薄荷绿渐变 | 深灰纯色 |
| **文字** | 深绿色 | 白色半透明 |
| **卡片** | 白色渐变 | 灰色渐变 |
| **阴影** | 青色半透明 | 黑色半透明 |
| **边框** | 青色 20% | 白色 15% |
| **玻璃效果** | 白色 60-75% | 白色 8-12% |
| **果冻感** | 浅色内光 | 深色内光 |

---

## 📐 UI 设计

### 主题选择器

```
┌─────────────────────────────────────┐
│ 主题模式                            │
│                                     │
│ ┌──────┐  ┌──────┐  ┌──────┐      │
│ │  ☀️  │  │  🌙  │  │  📱  │      │
│ │ 浅色 │  │ 深色 │  │跟随  │      │
│ │  ✓  │  │      │  │系统  │      │
│ └──────┘  └──────┘  └──────┘      │
│                                     │
│ 主题会立即生效并自动保存            │
└─────────────────────────────────────┘
```

### 选中状态
- **边框**: 青色高亮
- **背景**: 青色 10% 半透明
- **图标**: 青色
- **勾号**: ✓ 显示在底部

---

## ✨ 用户体验

### 即时生效 ⚡
- 点击主题按钮后立即切换
- 无需刷新页面
- 无闪烁或延迟

### 自动保存 💾
- 选择自动保存到本地
- 下次打开保持上次设置
- 跨会话持久化

### 系统同步 📱
- "跟随系统"实时同步
- iOS 切换主题时自动更新
- 无需手动操作

---

## 🧪 测试清单

### 基础功能测试
- [ ] 点击"浅色"，界面变为浅色 ✅
- [ ] 点击"深色"，界面变为深色 ✅
- [ ] 点击"跟随系统"，同步 iOS 主题 ✅
- [ ] 重启应用，主题保持 ✅

### 系统同步测试
- [ ] 选择"跟随系统"
- [ ] 在 iOS 设置中切换亮/暗模式
- [ ] 返回应用，主题自动切换 ✅
- [ ] 来回切换多次，每次都同步 ✅

### 边界情况测试
- [ ] 在浅色模式下关闭应用
- [ ] 在 iOS 设置中切换到深色
- [ ] 重新打开应用（跟随系统模式）
- [ ] 应显示深色主题 ✅

---

## 📱 iOS 兼容性

### 支持的 iOS 版本
- ✅ iOS 13+ (支持系统主题检测)
- ✅ iOS 15+ (Capacitor 6 目标版本)
- ✅ iOS 17+ (最新版本)

### 检测方法
使用标准 Web API：
```javascript
window.matchMedia('(prefers-color-scheme: dark)')
```
- 所有现代浏览器支持
- iOS Safari 13+ 支持
- Capacitor WebView 原生支持

---

## 🔍 调试方法

### 查看当前主题
```javascript
// 在浏览器控制台
document.documentElement.getAttribute('data-theme')
// 输出: "light" 或 "dark"
```

### 查看系统主题
```javascript
window.matchMedia('(prefers-color-scheme: dark)').matches
// true = 系统深色模式
// false = 系统浅色模式
```

### 查看用户设置
```javascript
localStorage.getItem('mn-study-preferences')
// 输出: {"theme":"system",...}
```

---

## 🎉 总结

### 已完成
✅ 三种主题模式（浅色/深色/跟随系统）  
✅ 单行三按钮选择器  
✅ 实时同步 iOS 系统主题  
✅ 自动保存用户偏好  
✅ 浅色和深色完整样式  
✅ 果冻玻璃效果适配  
✅ 主题切换即时生效  

### 技术特点
✅ 使用 CSS 变量实现主题切换  
✅ `matchMedia` API 检测系统主题  
✅ 监听系统主题变化事件  
✅ localStorage 持久化设置  
✅ 启动时立即应用主题  

---

**现在可以在 Xcode 中测试主题切换功能！** 🚀

```bash
cd /Users/lsc/Documents/master-nihongo-ios/frontend
open ios/App/App.xcworkspace
```

选择模拟器运行，进入设置测试三种主题模式！✨
