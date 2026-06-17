# iOS 应用分发指南

## 🌐 方法 1：Web 版本（最快，免费）

### 优点
- ✅ 完全免费
- ✅ 任何设备都能访问（iPhone、Android、电脑）
- ✅ 即时部署，分享链接即可
- ✅ 无需 App Store 审核

### 部署步骤

#### 使用 Vercel（推荐）

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 构建项目
npm run build

# 3. 部署
vercel deploy dist/

# 第一次会提示登录，之后会给你一个链接
```

#### 使用 Netlify

```bash
# 1. 安装 Netlify CLI
npm i -g netlify-cli

# 2. 构建项目
npm run build

# 3. 部署
netlify deploy --prod --dir=dist

# 第一次会提示登录和设置
```

部署后你会得到一个链接，比如：
- `https://your-app.vercel.app`
- `https://your-app.netlify.app`

直接分享这个链接，别人用手机浏览器打开即可！

---

## 📱 方法 2：TestFlight（iOS 原生测试）

### 前提条件
- ✅ Apple Developer Program 账号（$99/年）
- ✅ 测试用户有 iPhone/iPad

### 优点
- ✅ 真正的原生 iOS 应用体验
- ✅ 支持最多 10,000 个外部测试用户
- ✅ 测试用户只需安装免费的 TestFlight app
- ✅ 可以收集崩溃报告和反馈

### 步骤

1. **在 Xcode 中打包**
   ```
   1. 打开项目：open ios/App/App.xcworkspace
   2. Product → Archive
   3. 等待打包完成
   ```

2. **上传到 App Store Connect**
   ```
   1. Archive 完成后会打开 Organizer
   2. 选择刚才的 Archive
   3. 点击 "Distribute App"
   4. 选择 "App Store Connect"
   5. 按提示完成上传
   ```

3. **在 App Store Connect 中配置 TestFlight**
   ```
   1. 登录 https://appstoreconnect.apple.com
   2. 进入你的应用
   3. 选择 "TestFlight" 标签
   4. 等待构建处理完成（通常 10-30 分钟）
   5. 添加测试用户（输入他们的 Apple ID 邮箱）
   ```

4. **测试用户安装**
   ```
   1. 在 App Store 搜索并安装 "TestFlight" 应用
   2. 打开邮件中的邀请链接
   3. 在 TestFlight 中接受邀请
   4. 点击 "安装" 即可
   ```

---

## 🎥 方法 3：录制演示视频（最简单）

如果只是想展示效果：

### 在 Mac 上录制模拟器

```bash
# 启动模拟器
npm run ios

# 使用 QuickTime 录屏
# 或者使用 Xcode 的截图功能：Cmd + S
```

### 在真机上录制

```
1. iPhone 控制中心 → 屏幕录制
2. 录制操作演示
3. 分享视频文件
```

---

## 🔧 方法 4：Ad Hoc 分发（小范围测试）

### 前提条件
- ✅ Apple Developer Program 账号
- ✅ 测试设备的 UDID（最多 100 个设备）

### 步骤

1. **收集设备 UDID**
   - 让测试用户将 iPhone 连接电脑
   - 打开 Finder/iTunes 查看设备信息
   - 复制 UDID

2. **在 Apple Developer 网站注册设备**
   - https://developer.apple.com/account/resources/devices/list
   - 添加 UDID

3. **创建 Ad Hoc Provisioning Profile**
   - 在 Xcode 中配置
   - 或在 developer.apple.com 手动创建

4. **打包并分发**
   - Xcode → Archive → Distribute App → Ad Hoc
   - 导出 IPA 文件
   - 通过 AirDrop、邮件或网盘分享

5. **测试用户安装**
   - 需要使用 Apple Configurator 或其他工具
   - 比较麻烦，不推荐

---

## 💡 推荐方案

### 快速演示（几分钟内）
→ **Web 版本**（Vercel/Netlify）

### 专业测试（几天内）
→ **TestFlight**

### 仅展示效果
→ **录制视频**

---

## 🌐 Web 版本 vs iOS 原生

你的应用使用 Capacitor，web 版本几乎和 iOS 版本体验一致：
- ✅ 所有功能都能正常工作
- ✅ 磨砂玻璃效果在 Safari 也支持
- ✅ 在 iPhone 上用 Safari 打开，体验和原生 app 相差不大

唯一区别：
- ❌ 没有原生的启动画面
- ❌ 没有桌面图标（除非添加到主屏幕）
- ❌ 少数原生 API 可能不可用

## 建议
先用 **Web 版本**快速分享，如果反馈好，再考虑上 TestFlight 或 App Store。
