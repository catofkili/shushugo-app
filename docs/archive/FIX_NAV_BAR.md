# 底部导航栏遮挡问题 - 修复记录

## 问题描述
底部 tab 导航栏被白色块遮挡，无法看到导航按钮。

## 可能的原因

1. ✅ **index.html 中的 `overflow: hidden`**
   - `html, body { overflow: hidden }` 导致内容无法滚动
   - 修复：移除 overflow hidden，改为正常显示

2. ✅ **背景颜色不匹配**
   - 原来设置 `#f5f5f5`（浅灰色）
   - 改为 `#555858`（深灰色，与应用主题一致）

3. **#root 的 overflow 设置**
   - 原来 `overflow: auto` 可能导致双层滚动
   - 改为 `position: relative`

## 已修复

```css
/* 之前 */
html, body {
  overflow: hidden;  /* ❌ 这个导致内容被裁剪 */
  background-color: #f5f5f5;  /* ❌ 颜色不对 */
}

#root {
  overflow: auto;  /* ❌ 可能导致滚动问题 */
}

/* 现在 */
html {
  background-color: #555858;  /* ✅ 与应用主题一致 */
}

body {
  background-color: #555858;  /* ✅ 深灰色背景 */
  /* 没有 overflow: hidden */
}

#root {
  position: relative;  /* ✅ 正常定位 */
  /* 没有 overflow: auto */
}
```

## 导航栏配置

底部导航栏使用了：
```css
position: fixed;
inset-x-0;
bottom: 0;
z-index: 40;  /* 应该在最上层 */
```

这个配置应该能正常显示在底部。

## 测试步骤

1. ✅ 重新构建应用
2. ✅ 同步到 iOS
3. ✅ 重启应用
4. 🔍 检查底部导航栏是否可见
5. 🔍 检查是否还有白色遮挡

## 如果还是有问题

可能的其他原因：
- 安全区域 padding 设置问题
- CSS 冲突
- WebView 渲染问题

需要在浏览器中检查：
```bash
cd ~/Documents/master-nihongo-ios/frontend
npm run dev
# 访问 http://localhost:5173
# 打开开发者工具查看元素
```

---

**状态**: ✅ 已修复并重启应用
**下一步**: 请在模拟器中检查底部导航栏是否正常显示
