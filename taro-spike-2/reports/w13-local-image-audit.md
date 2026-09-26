# W13 本地图片兼容性审计

来源分支：`taro/main` at `3a7ba16`。构建目录：`taro-spike-2/dist`。

## 图片来源盘点

| 来源 | 数量 / 路径 | 分类与处理 |
|---|---:|---|
| 吉祥物贴纸、表情、工具图标、品牌图、商店插图、周报封面与走路精灵图 | 59 张：main 26、study 5、account 4、content-pages 24 | 包内 PNG；路径由 `src/platform/brand-packages.cjs` 映射到所属分包。每张图的源尺寸、显示高度、输出尺寸、转换前后格式和字节数见 `brand-asset-sizes.json`。 |
| 底部导航图标 | 4 张：`assets/tabs/{home,word,grammar,profile}.png` | 包内 PNG；属于既有导航资源，不计入上述 59 张品牌图。 |
| Lucide 图标 | 218 个 SVG 文件 | 包内 SVG，由 `src/platform/lucide.weapp.tsx` 生成路径；继续作为 `<Image>` 的本地图标来源。 |
| 用户头像 | `ProfilePage`、`PersonalInfo` 的动态 `profile.avatar` | 用户资料可能是 data URL，也可能是同步得到的网络 URL；没有包内 WebP 路径。仅当来源为 HTTP(S) 或 `cloud://` 且后缀为 `.webp` 时，`CrossPlatformImage.weapp.tsx` 才传 `webp` 属性。 |
| 分享图片预览 | `ShareImageSheet.weapp.tsx` 的动态 `url` | 微信用户目录下由分享画布生成的临时 PNG 文件路径。 |
| WXSS `url()` | 3 处：`app.wxss` 1 处、周报 WXSS 2 处 | 全部为 `data:image/svg+xml` base64 数据；本地文件 URL 为 0。 |

构建产物共 39 个 WXML 和 35 个 WXSS。39 个 WXML 共用 `base.wxml` 中的 2 个通用 `<image>` 模板，`src` 都绑定到运行时字段 `i.p4`；源类型如上表。构建后本地 WebP 文件为 0，WXSS 本地 `url()` 为 0。基础 WXML 模板仍为通用图片节点保留 `webp` 绑定，默认值为 `false`；源代码只会给远程 WebP 传入 `true`。

## 品牌 PNG 体积

所有输出仍按最大显示高度 ×2 生成，并以 pngquant 256 色调色板、质量 65–90 量化。分包汇总与逐图字节数均记录在 `brand-asset-sizes.json`。

| 分包 | 图片数 | 转换前合计 (B) | 转换后合计 (B) |
|---|---:|---:|---:|
| main | 26 | 190,864 | 342,738 |
| study | 5 | 41,968 | 69,816 |
| account | 4 | 13,430 | 51,051 |
| content-pages | 24 | 147,298 | 515,218 |

## 分包体积

与 `taro/main` 基线 `3a7ba16` 比较；字节数来自 `reports/package-sizes.json`。

| 分包 | 改前 (B) | 改后 (B) | 变化 (B) |
|---|---:|---:|---:|
| main | 1,717,392 | 1,846,880 | +129,488 |
| study | 272,021 | 299,862 | +27,841 |
| account | 210,601 | 248,849 | +38,248 |
| content-pages | 690,609 | 1,059,131 | +368,522 |
| features | 580,407 | 580,408 | +1 |
| content | 1,619,455 | 1,619,456 | +1 |
| grammar-foundation | 668,450 | 668,451 | +1 |
| grammar-advanced | 547,378 | 547,379 | +1 |
| grammar-pages | 354,928 | 354,920 | −8 |
| core | 279,123 | 279,124 | +1 |
| lazy | 566,487 | 567,087 | +600 |

主包低于 1,900,000 B 的构建闸门，余量 53,120 B；也低于任务要求的 1.95 MiB。所有分包均通过 1,900,000 B 闸门。

## 验收记录

- `npm run build:weapp`、`npm run check:release`、`frontend` 的 `npm run check`、`npm run lint`、`npm test`、`taro-spike-2` 的 `npm test` 均通过。前端测试 814 passed、26 skipped；Lint 0 errors、43 warnings。
- `tmp/devtools-route-sweep.cjs` 通过 `AUTO_PORT=9531` 扫描 26 个路由：26 个页面均有内容，0 `BAD`、0 `ERR`。
- 微信开发者工具模拟器与独立网页预览 `http://127.0.0.1:9532/` 已做视觉检查；本地 PNG 吉祥物、卡片插画、工具图标、导航图标与走路精灵图均有渲染。开发者工具的 Chrome 内核检查不等同于 iPhone 真机验收。
