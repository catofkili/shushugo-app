# 今日 ML 任务贴纸（macOS 桌面）

和收集日 App 无关的独立小工具：桌面右上角常驻一张便签，显示今天要做的 1–3 件事，点一下打勾。

## 安装

```bash
brew install --cask ubersicht   # 装完打开一次
bash desktop-sticker/install.sh
```

## 规则

- 课表在 `ml-today.widget/plan.json`：5 个阶段、70 天，每 7 天一个复盘日。
- **按队列走，不按日历走**：哪天没做完，第二天接着显示同一天的任务，不会越积越多。
- 当天的任务全部做完后显示「今天完成」，第二天才放出下一天的任务，不会提前跑。
- 点错了再点一次就能取消。🔥 是连续有打勾的天数。
- 完成记录在 `~/.ml-today/log.txt`。更新课表时重跑 `install.sh`，进度不会丢。
- 复盘日要把卡点发给 Claude，由 Claude 改 `plan.json` 调整之后的课表。
