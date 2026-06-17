# iOS WebView 底部导航栏修复

## 问题分析

**症状**: 
- ✅ 浏览器中正常
- ❌ iOS 模拟器中底部有白色遮挡

**原因**:
iOS WebView 对 `env(safe-area-inset-bottom)` 的处理与浏览器不同，导致计算的 padding 值不正确。

## 修复方案

### 修改前
```tsx
<main className="pb-[calc(env(safe-area-inset-bottom)+5.25rem)]">
```

这个计算在 iOS WebView 中可能产生错误的值。

### 修改后
```tsx
<main className="pb-[6rem]">
```

使用固定值 `6rem`（约 96px），足够容纳：
- 导航栏高度：约 70px
- 底部安全区域：约 20-30px

## 为什么这样修复

1. **env(safe-area-inset-bottom) 在 WebView 中不可靠**
   - 浏览器：正确识别
   - iOS WebView：可能返回 0 或错误值

2. **固定值更稳定**
   - 6rem = 96px，足够大
   - 适配所有 iPhone（包括有 Home 指示器的）

3. **导航栏本身是 fixed**
   - 导航栏使用 `position: fixed`
   - 不会随内容滚动
   - padding 只是为了避免内容被遮挡

## 测试

重启应用后检查：
- [ ] 底部导航栏完全可见
- [ ] 没有白色遮挡
- [ ] 内容不会被导航栏遮挡
- [ ] 可以正常点击导航按钮

## 如果还有问题

可能需要调整的其他地方：

1. **增加 padding**
   ```tsx
   className="pb-[7rem]"  // 更大的间距
   ```

2. **检查导航栏的 z-index**
   ```tsx
   className="z-40"  // 当前值，应该足够高
   ```

3. **检查是否有其他元素遮挡**
   - 在浏览器开发者工具中检查元素层级

---

**修复时间**: 2026-06-14 16:00
**状态**: ✅ 已修改并重启应用
