# dsh-mac-notifications

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）增加**原生 macOS 通知**的插件：在智能体需要你做出选择、任务完成、任务异常中断时，通过系统通知中心（Notification Center）弹出提醒——**通知以 DeepSeek Harness 应用自身名义发出（应用名称 + 鲸鱼图标）**，而不是脚本编辑器。

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
| `sound` | boolean | `true` | 通知是否播放系统默认提示音 |
| `language` | `'zh' \| 'en'` | `'zh'` | 通知文案语言 |
| `cooldownMs` | number | `3000` | 完成通知的最小间隔（毫秒） |
| `fallbackOsascript` | boolean | `true` | 无 Web GUI 客户端时回退到 osascript 通知（归属脚本编辑器） |

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
        cooldownMs: 3000
        fallbackOsascript: true
```

## 🧠 工作原理

插件由两部分组成：Host 端（Node，纯 `child_process` + 内置流，无构建、无运行时依赖）
与 Client 端（随 Web GUI 加载的浏览器模块，约 1 KB）。

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

macOS 的通知会显示**发送应用的名称与图标**。本插件采用两段式设计：

1. **Host 端**监听 Harness 事件，把通知内容通过本机 SSE 端点（`/plugin/dsh-mac-notifications/events`）推送给 Web GUI；
2. **Client 端**（随 Web GUI 加载）用浏览器 Notification API 弹出通知。

由于通知由 DeepSeek Harness 应用自身的渲染进程发出，通知中心里显示的是**应用名称「DeepSeek Harness」和它的鲸鱼图标**——真正"作为 DeepSeek 的通知"，与脚本编辑器无关。

> 安装/更新插件后请**刷新一次 Web GUI 页面**以加载 Client 端模块。
> 提示音使用系统默认通知音（浏览器通知不支持自定义音效）；可通过 `sound: false` 静音。
> 没有 Web GUI 客户端连接时（如 headless profile），可选回退到 `osascript`（归属脚本编辑器）；不想要可设 `fallbackOsascript: false`。

### 去重与抑制

- 每个会话记录最近一次错误通知的回合号，同一回合的 `agent/error` 与 `turn/end` error 只通知一次；
- 完成通知按 `cooldownMs` 冷却；
- `session.header.origin === 'subagent'` 的会话默认跳过（`includeSubagents: true` 可开启）。

## 🗒️ 已知限制

- **仅 macOS 生效**（依赖 `/usr/bin/osascript`）；其他平台插件安全空转，不发通知。
- 点击通知本身**不会**把应用带到前台（系统限制）；如需"点击跳回对话"可后续扩展。
- 安装/更新后需刷新一次 Web GUI 页面；通知权限沿用 DeepSeek Harness 应用自身的系统通知授权。
- 通知文案基于配置语言 `zh`/`en`，问题内容本身使用模型输出原文。

## 🔧 开发

```sh
# 无构建步骤：index.js / client.js 即为全部运行时代码
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
├── index.js            # 插件运行时（Host 端：事件监听 + SSE 推送）
├── client.js           # 插件运行时（Client 端：浏览器 Notification API）
├── cordis.patch.yml    # Cordis 组合补丁（插件行 + 默认配置）
├── package.json        # dsh.bundle + dsh.client 清单 + npm 元数据
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
