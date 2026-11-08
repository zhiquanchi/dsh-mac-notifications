# dsh-mac-notifications

Native **macOS Notification Center alerts** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): when the agent needs your choice, when a task completes, and when a task fails — **delivered under the DeepSeek Harness application's own name and whale icon**, never as Script Editor.

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
| `sound` | boolean | `true` | Play the system default notification sound |
| `language` | `'zh' \| 'en'` | `'zh'` | Notification copy language |
| `cooldownMs` | number | `3000` | Minimum interval between completion notifications |
| `fallbackOsascript` | boolean | `false` | Fall back to osascript (Script Editor attribution) when no Web GUI client is connected (off by default) |

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

macOS shows the sending app's name and icon on every notification. This plugin
uses a two-part design:

1. The **Host half** listens to Harness events and pushes notification payloads
   to the Web GUI over a local SSE endpoint (`/plugin/dsh-mac-notifications/events`);
2. The **Client half** (loaded with the Web GUI) shows them through the browser
   Notification API.

Because the notification is posted by the DeepSeek Harness app's own renderer,
Notification Center shows **the app name "DeepSeek Harness" and its whale icon**
— a genuine DeepSeek notification, with nothing to do with Script Editor.

> Refresh the Web GUI page once after installing/updating, so the Client half loads.
> Browser notifications play the system default sound; set `sound: false` for silence.
> With no Web GUI client connected (e.g. a headless profile), an optional
> `osascript` fallback keeps notifications working; it is off by default (`fallbackOsascript: false`) so every notification stays attributed to DeepSeek Harness.

## 🗒️ Limitations

- **macOS only** (`/usr/bin/osascript`); on other platforms the plugin is a no-op.
- Clicking an `osascript` notification does not focus the app (system limitation).
- Refresh the Web GUI once after install/update; notification permission is the DeepSeek Harness app's own system authorization.

## 🏪 Market listings

- [DSH.SO](https://www.dsh.so/) — DSH's default plugin market (security audit + install verification)
- [DSH Meme Hub](https://dsh-meme-hub.cdqyfdbymn.me/) — community directory
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) — curated list, also served as the `dsh-plugin-catalog` market index
- GitHub-topic crawlers (`dsh-plugin` / `deepseek-harness` topics): DSH-Plugins-Marketplace, dsh-plugins-store, and more

## 📄 License

[MIT](LICENSE) © 2026 [zhiquanchi](https://github.com/zhiquanchi)

> Independent community project, not affiliated with DeepSeek. Installing a plugin runs third-party code — review the source first.
