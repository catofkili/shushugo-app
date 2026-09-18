# 二楼字体

Shushu Echo 来自 LXGW WenKai Lite Regular，作者 LXGW，按 SIL Open Font License 1.1 分发，完整许可及版权信息见 OFL-WenKai.txt。

上游：https://github.com/lxgw/LxgwWenKai-Lite
源文件：https://raw.githubusercontent.com/lxgw/LxgwWenKai-Lite/main/fonts/TTF/LXGWWenKaiLite-Regular.ttf

2026-09-13 下载完整字体，用 fontTools 和 Brotli 转为 WOFF2；未删减或修改字形。为尊重许可证的保留名称，字体 name 表的 family/full/PostScript/typographic family 改为 Shushu Echo / ShushuEcho-Regular，样式为 Regular，版权与许可条目保留。原始 TTF 保存在交付目录 versions/v2-font-source，生产资源仅包含 5.03 MiB WOFF2，不请求第三方字体服务器。

转换步骤：TTFont(source) → 更新 name 表中 1、4、6、16（名称）与 2、17（Regular）→ font.flavor = "woff2" → font.save(output)。转换工具为临时 uv 环境的 fonttools、brotli，未增加应用依赖。

用于周报标题、词语封面和分享图；数字和功能文字保留系统字体。font-display: swap 允许字体加载期间先阅读正文。
