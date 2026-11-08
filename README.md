# dsh-mac-notifications

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）增加**原生 macOS 通知**的插件：在智能体需要你做出选择、任务完成、任务异常中断时，通过系统通知中心（Notification Center）弹出提醒——**通知图标显示 DeepSeek 官方鲸鱼 logo**，原生样式。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://www.apple.com/macos/)
[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-4F7CFF.svg)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.en.md)

## ✨ 功能

| 场景 | 触发时机 | 通知示例 |
| --- | --- | --- |
| 🧑‍⚖️ 需要你做出选择 | 智能体调用 `ask_user_question` 向你提问 | 「需要你的选择」+ 问题内容 |
| ✅ 需要你的授权 | 工具请求授权（approval 流程） | 「需要你的授权」+ 工具名与原因 |
| 🎉 任务完成 | 一轮任务正常结束（`turn/end` completed） | 「任务已完成」+ 会话标题 |
| ⚠️ 任务异常中断 | 步骤/回合出错、被中止、会话级失败 | 「任务异常中断」+ 错误信息 |

**防打扰细节**

- 「任务完成」通知在会话仍有后台任务（jobs）运行时自动抑制，避免"等待后台任务"被误报为完成；
- 子智能体（subagent）会话默认不通知，只通知主会话；
- 同一回合的错误通知去重（`agent/error` 与 `turn/end` error 只报一次）；
- 完成通知带冷却时间（默认 3 秒）；
- 所有开关均可在 `cordis.patch.yml` 的 `config` 中配置，改动后插件自动热重载。

## 🚀 安装

### 方式一：DSH CLI（推荐，从 GitHub 安装）

```sh
dsh plugin --profile web add github:zhiquanchi/dsh-mac-notifications
# 其他 profile 同理，如 headless：
dsh plugin --profile headless add github:zhiquanchi/dsh-mac-notifications
```

### 方式二：npm

```sh
dsh plugin --profile web add dsh-mac-notifications
```

### 方式三：从本地目录安装

在 DSH 桌面端（或 Web GUI）的「插件」页面选择"从目录安装"，指向本仓库目录即可；
也可以手工在 profile 的 `cordis.patch.yml` 中注册：

```yaml
- insert:
    - id: mac-notifications
      name: 'dsh-mac-notifications'
      config: {}
```

### 插件市场

本插件已提交到 [DSH.SO 插件市场](https://www.dsh.so/) 等多个社区市场；
DSH 桌面端「插件 → 发现」页可直接搜索安装（部分市场收录需要数小时同步）。

## ⚙️ 配置

所有配置都在插件的 `cordis.patch.yml` 行的 `config` 字段中：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `questions` | boolean | `true` | 智能体提问（`ask_user_question`）时通知 |
| `approvals` | boolean | `true` | 工具请求授权时通知 |
| `completed` | boolean | `true` | 任务正常完成时通知 |
| `errors` | boolean | `true` | 任务异常中断/失败时通知 |
| `includeSubagents` | boolean | `false` | 是否包含子智能体（subagent）会话 |
| `suppressWhenJobsRunning` | boolean | `true` | 会话仍有后台任务运行时抑制完成通知 |
| `sound` | boolean | `true` | 通知是否播放系统提示音（Glass） |
| `language` | `'zh' \| 'en'` | `'zh'` | 通知文案语言 |
| `appName` | string | `DeepSeek Harness` | 通知归属应用名（决定通知中心显示的图标） |
| `cooldownMs` | number | `3000` | 完成通知的最小间隔（毫秒） |

完整示例：

```yaml
- insert:
    - id: mac-notifications
      name: 'dsh-mac-notifications'
      config:
        questions: true
        approvals: true
        completed: true
        errors: true
        includeSubagents: false
        suppressWhenJobsRunning: true
        sound: true
        language: zh
        appName: DeepSeek Harness
        cooldownMs: 3000
```

## 🧠 工作原理

插件是纯 Host 端（Node）Cordis 插件，无需构建、无运行时依赖，仅使用 Node 内置的 `child_process`。

### 事件 → 通知

| Harness 事件 | 说明 | 对应通知 |
| --- | --- | --- |
| `user-questions/request` | 智能体请求结构化用户输入（waterfall，`prepend` 注册，不抢占回答） | 需要你的选择 |
| `approval/request` | 授权请求（waterfall，`prepend` 注册，不抢占决策） | 需要你的授权 |
| `session/event` → `turn/end`（completed） | 回合正常结束；若有运行中的后台任务则抑制 | 任务已完成 |
| `session/event` → `turn/end`（error / aborted） | 回合失败或非用户中止 | 任务异常中断 / 任务已中止 |
| `agent/error` | 步骤或回合出错（可能没有持久化记录） | 任务异常中断 |
| `api-session/error` | 智能体在持久回合之外失败 | 任务异常中断 |

### 通知通道与图标

macOS 的通知图标 = 发送通知的应用的图标。为了让通知显示 **DeepSeek 官方鲸鱼 logo**，插件会在系统临时目录自动构建一个轻量辅助应用
`DeepSeek Notifier.app`（无窗口、无 Dock 图标，图标为 DeepSeek 鲸鱼），并通过它发送通知。
构建失败时自动回退为归属到 `appName` 应用的 `osascript` 通知。

> ⚠️ 首次使用请在 **系统设置 → 通知** 中找到 **DeepSeek Notifier** 并开启"允许通知"，否则 macOS 会静默丢弃它的通知。
> 辅助应用使用的 DeepSeek logo 版权归 DeepSeek 所有，仅用于通知图标显示。

### 去重与抑制

- 每个会话记录最近一次错误通知的回合号，同一回合的 `agent/error` 与 `turn/end` error 只通知一次；
- 完成通知按 `cooldownMs` 冷却；
- `session.header.origin === 'subagent'` 的会话默认跳过（`includeSubagents: true` 可开启）。

## 🗒️ 已知限制

- **仅 macOS 生效**（依赖 `/usr/bin/osascript`）；其他平台插件安全空转，不发通知。
- 点击 `osascript`/辅助应用的通知本身**不会**把应用带到前台（系统限制）；如需"点击跳回对话"可后续扩展。
- 通知图标来自 **DeepSeek Notifier** 辅助应用（首次需在 系统设置 → 通知 中授权）。
- 通知文案基于配置语言 `zh`/`en`，问题内容本身使用模型输出原文。

## 🔧 开发

```sh
# 无构建步骤：index.js 即为全部运行时代码
git clone https://github.com/zhiquanchi/dsh-mac-notifications
cd dsh-mac-notifications
node --input-type=module --eval "$(cat index.js)"   # 语法自检

# 本地安装到 profile 并从目录链接（改代码即时生效，配合 HMR 热重载）
# 在 DSH「插件」页使用"从目录安装"，或：
dsh plugin --profile web add ./dsh-mac-notifications
```

目录结构：

```
dsh-mac-notifications/
├── index.js            # 插件运行时（Host 端，纯 Node）
├── cordis.patch.yml    # Cordis 组合补丁（插件行 + 默认配置）
├── package.json        # dsh.bundle 清单 + npm 元数据
├── icon.svg            # 插件图标（原始创作）
├── locale/             # en / zh 显示元数据
├── README.md / README.en.md
└── LICENSE
```

## 🏪 市场收录

- [DSH.SO](https://www.dsh.so/) — DSH 默认插件市场（含安全审计与安装验证）
- [DSH Meme Hub](https://dsh-meme-hub.cdqyfdbymn.me/) — 社区目录
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) — 精选列表（同时是 `dsh-plugin-catalog` 市场索引）
- 依赖 GitHub topic `dsh-plugin` / `deepseek-harness` 自动收录的其它目录（DSH-Plugins-Marketplace、dsh-plugins-store 等）

## 📄 License

[MIT](LICENSE) © 2026 [zhiquanchi](https://github.com/zhiquanchi)

> 本插件为社区独立项目，与 DeepSeek 官方无关。安装第三方插件即运行第三方代码，请自行审查源码。
