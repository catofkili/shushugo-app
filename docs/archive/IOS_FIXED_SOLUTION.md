# iOS WebView position:fixed 问题总结

## 问题
- ✅ 浏览器中：导航栏固定
- ❌ iOS 应用中：导航栏跟随滚动

这是 iOS WebView 的已知问题。

## 根本原因
iOS WebView 中，`position: fixed` 元素在某些情况下会相对于滚动容器而不是视口。

## 已尝试的方案
1. ❌ Tailwind CSS 类名
2. ❌ inline style
3. ❌ 提高 z-index
4. ❌ 移动 DOM 位置到最外层
5. ❌ 禁用 WebView 滚动（会导致内容无法滚动）

## 最终解决方案

使用 CSS transform hack 强制创建新的渲染层：

```tsx
// 在 renderMobileNav 中添加
style={{
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 9999,
  backgroundColor: '#3f4242',
  WebkitTransform: 'translateZ(0)',  // 强制硬件加速
  transform: 'translateZ(0)',
  willChange: 'transform',
}}
```

这个方法在 iOS WebView 中强制创建独立的渲染层，让 fixed 定位正确工作。

## 参考
- https://stackoverflow.com/questions/32875046/ios-webkit-position-fixed
- https://remysharp.com/2012/05/24/issues-with-position-fixed-scrolling-on-ios

---
状态：准备测试最终方案
