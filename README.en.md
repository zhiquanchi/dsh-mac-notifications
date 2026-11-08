# dsh-mac-notifications

Native **macOS Notification Center alerts** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): when the agent needs your choice, when a task completes, and when a task fails — with the **official DeepSeek whale logo as the notification icon**.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://www.apple.com/macos/)
[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-4F7CFF.svg)](https://github.com/deepseek-ai/deepseek-harness)

[中文](README.md)

## ✨ Features

| Scenario | Trigger | Example |
| --- | --- | --- |
| 🧑‍⚖️ A choice is needed | The agent calls `ask_user_question` | "A choice is needed" + the question |
| ✅ Approval requested | A tool requests approval | "Approval needed" + tool name & reason |
| 🎉 Task complete | A turn ends with `turn/end` reason `completed` | "Task complete" + session title |
| ⚠️ Task failed | A step/turn errors, aborts, or the session fails | "Task failed" + error message |

**Noise control**

- Completion notifications are suppressed while the session still has live background jobs;
- Subagent sessions are skipped by default — only the main conversation notifies;
- Per-turn error deduplication (`agent/error` and `turn/end` error fire once);
- Completion cooldown (default 3 s);
- Every switch lives in the `config` of `cordis.patch.yml` and hot-reloads.

## 🚀 Install

```sh
# From GitHub (recommended)
dsh plugin --profile web add github:zhiquanchi/dsh-mac-notifications

# From npm
dsh plugin --profile web add dsh-mac-notifications

# From a local checkout (linked, hot-reloads)
dsh plugin --profile web add ./dsh-mac-notifications
```

Or install from a local directory in the DSH desktop app's Plugins page.

## ⚙️ Configuration

All options live in the plugin row's `config` in `cordis.patch.yml`:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `questions` | boolean | `true` | Notify when the agent asks a question |
| `approvals` | boolean | `true` | Notify when a tool requests approval |
| `completed` | boolean | `true` | Notify when a task completes |
| `errors` | boolean | `true` | Notify on abnormal interruption/failure |
| `includeSubagents` | boolean | `false` | Include subagent sessions |
| `suppressWhenJobsRunning` | boolean | `true` | Suppress completion while background jobs run |
| `sound` | boolean | `true` | Play the system "Glass" sound |
| `language` | `'zh' \| 'en'` | `'zh'` | Notification copy language |
| `appName` | string | `DeepSeek Harness` | App the notification is attributed to (decides the icon) |
| `cooldownMs` | number | `3000` | Minimum interval between completion notifications |

## 🧠 How it works

A dependency-free Host (Node) Cordis plugin using only Node's built-in `child_process`.

### Events → notifications

| Harness event | Meaning | Notification |
| --- | --- | --- |
| `user-questions/request` | Structured user input requested (waterfall, `prepend`, never claims) | Choice needed |
| `approval/request` | Approval requested (waterfall, `prepend`, never claims) | Approval needed |
| `session/event` → `turn/end` (completed) | Turn finished; suppressed when live jobs remain | Task complete |
| `session/event` → `turn/end` (error / aborted) | Turn failed or aborted (non-user) | Task failed / aborted |
| `agent/error` | Step or turn errored (may lack a durable record) | Task failed |
| `api-session/error` | Agent failed outside a durable turn | Task failed |

### Notification transport & icon

macOS shows the sender app's icon on every notification. To display the official
**DeepSeek whale logo**, the plugin builds a lightweight helper applet
(`DeepSeek Notifier.app`, windowless, no Dock icon, DeepSeek logo as its icon) in
the system temp directory and posts notifications through it. If the helper
cannot be built or launched, it falls back to `osascript` notifications
attributed to `appName`.

> ⚠️ On first use, enable notifications for **DeepSeek Notifier** under
> **System Settings → Notifications**, otherwise macOS silently drops them.
> The DeepSeek logo belongs to DeepSeek and is used only as the notification icon.

## 🗒️ Limitations

- **macOS only** (`/usr/bin/osascript`); on other platforms the plugin is a no-op.
- Clicking an `osascript` notification does not focus the app (system limitation).
- Notification icon comes from the **DeepSeek Notifier** helper app — grant it permission under System Settings → Notifications on first use.

## 🏪 Market listings

- [DSH.SO](https://www.dsh.so/) — DSH's default plugin market (security audit + install verification)
- [DSH Meme Hub](https://dsh-meme-hub.cdqyfdbymn.me/) — community directory
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) — curated list, also served as the `dsh-plugin-catalog` market index
- GitHub-topic crawlers (`dsh-plugin` / `deepseek-harness` topics): DSH-Plugins-Marketplace, dsh-plugins-store, and more

## 📄 License

[MIT](LICENSE) © 2026 [zhiquanchi](https://github.com/zhiquanchi)

> Independent community project, not affiliated with DeepSeek. Installing a plugin runs third-party code — review the source first.
