# ✅ 找到问题了！

## 问题根源

导航栏被包含在 `grid min-h-screen` 容器内部：

```tsx
<div className="grid min-h-screen">
  <aside>...</aside>
  <main>...</main>
  {renderMobileNav()}  // ❌ 在 grid 容器里面
</div>
```

当 grid 容器滚动时，导航栏也跟着滚动！

## 解决方案

把导航栏移到最外层，完全独立：

```tsx
<div className="relative min-h-screen">
  <div className="grid min-h-screen">
    <aside>...</aside>
    <main>...</main>
  </div>
  {notice && ...}
  {renderMobileNav()}  // ✅ 在最外层，独立于滚动容器
</div>
```

## 为什么这样一定能固定

1. **导航栏不在滚动容器里** - grid 容器滚动不影响它
2. **position: fixed** - 相对于视口固定
3. **在最外层** - 不受任何父容器影响

---

**修改**: 移动 `{renderMobileNav()}` 到最外层
**预期**: 导航栏必须固定在底部
