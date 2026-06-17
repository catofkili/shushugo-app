# 使用 inline style 强制固定导航栏

## 问题分析
Tailwind CSS 类名可能被覆盖或不生效，导致 `position: fixed` 没有应用。

## 新方案
直接使用 React inline style，绕过 CSS 类名系统：

```tsx
<nav 
  style={{
    position: 'fixed',    // ← 强制固定定位
    bottom: 0,            // ← 固定在底部
    left: 0,              // ← 左边对齐
    right: 0,             // ← 右边对齐
    zIndex: 9999,         // ← 超高 z-index
    backgroundColor: '#3f4242',  // ← 不透明背景
  }}
  className="border-t border-white/15 px-1 pb-[calc(env(safe-area-inset-bottom)+0.3rem)] pt-1 shadow-[0_-10px_28px_rgba(0,0,0,0.24)] lg:hidden"
>
```

## 为什么这样一定会生效

1. **Inline style 优先级最高** - 会覆盖所有 CSS 类
2. **直接写在 DOM 上** - 不经过 Tailwind 编译
3. **无法被覆盖** - 除非有 `!important`

## 测试

如果这样还不固定，说明：
- 可能有父容器的 CSS 影响（transform, perspective 等）
- 可能是 WebView 的特殊行为
- 需要检查整个 DOM 结构

---

**状态**: ✅ 已部署
**方法**: Inline style
**预期**: 导航栏必须固定
