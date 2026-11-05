# cache-reminder

Claude Code 插件：在输入框上方显示提示缓存命中率、缓存过期倒计时（1 小时）、5h / 7d 额度和上下文大小。缓存剩 10 分钟时弹提示，上下文超过 10 万 token 时再发系统通知，提醒你在离开前先 `/compact`，避免缓存过期后按全价重算整段上下文。

A Claude Code plugin that shows prompt-cache hit rate, a cache-expiry countdown, 5-hour / 7-day usage and context size above the prompt, and reminds you to `/compact` before the cache expires.

## 安装 / Install

```
/plugin install cache-reminder --marketplace liliyy2/claude-cache-reminder
```

提示是否添加 marketplace 时输入 `y`，然后选择安装范围（建议 user）。

## 用法 / Usage

- 输入框上方：`缓存 94% ⏳46m │ 5h 37% ↻2h2m │ 7d 62% ↻2d23h │ 上下文 200k/1M`
- `/cache`：查看详细数字
- `/cache hide` / `/cache show`：隐藏或显示提示条（提醒照常）
