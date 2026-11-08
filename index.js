/**
 * dsh-mac-notifications — native macOS Notification Center notifications for
 * the DeepSeek Harness desktop app.
 *
 * The Host half listens to Harness events and pushes notification payloads to
 * the Web GUI over an SSE endpoint. The Client half (client.js) shows them
 * through the browser Notification API, so macOS delivers them **attributed to
 * the DeepSeek Harness application itself** (its name and whale icon) — never
 * to Script Editor.
 *
 * Triggers:
 *  - the agent asks you to make a choice (`user-questions/request`)
 *  - an approval decision is requested (`approval/request`)
 *  - a turn completes (`turn/end` completed, unless live background jobs
 *    still run for that session)
 *  - a task fails abnormally (`turn/end` error/aborted, `agent/error`,
 *    `api-session/error`), deduplicated per turn
 *
 * When no Web GUI client is connected (e.g. a headless profile), an
 * `osascript` fallback keeps notifications working; it is attributed to
 * Script Editor and can be disabled with `fallbackOsascript: false`.
 */
import { spawn } from 'node:child_process'

const DEFAULT_CONFIG = {
  questions: true,
  approvals: true,
  completed: true,
  errors: true,
  includeSubagents: false,
  suppressWhenJobsRunning: true,
  sound: true,
  language: 'zh',
  cooldownMs: 3000,
  fallbackOsascript: true,
}

const TEXT = {
  zh: {
    askTitle: '需要你的选择',
    askSubtitle: 'DeepSeek 正在等待你的回复',
    approvalTitle: '需要你的授权',
    approvalBody: (tool, reason) =>
      reason ? `「${tool}」请求授权：${reason}` : `「${tool}」请求授权`,
    doneTitle: '任务已完成',
    doneBody: (title) =>
      title ? `会话「${title}」已处理完毕` : '智能体已处理完毕，回到对话查看结果',
    errorTitle: '任务异常中断',
    errorBody: (message) => (message ? `发生错误：${message}` : '任务在运行中发生错误'),
    abortedTitle: '任务已中止',
    abortedBody: (cause) => `任务被中止${cause ? `（${cause}）` : ''}`,
  },
  en: {
    askTitle: 'A choice is needed',
    askSubtitle: 'DeepSeek is waiting for your reply',
    approvalTitle: 'Approval needed',
    approvalBody: (tool, reason) =>
      reason ? `"${tool}" requests approval: ${reason}` : `"${tool}" requests approval`,
    doneTitle: 'Task complete',
    doneBody: (title) =>
      title ? `Session "${title}" has finished` : 'The agent has finished. Come back to see the result',
    errorTitle: 'Task failed',
    errorBody: (message) => (message ? `An error occurred: ${message}` : 'The task failed while running'),
    abortedTitle: 'Task aborted',
    abortedBody: (cause) => `The task was aborted${cause ? ` (${cause})` : ''}`,
  },
}

function truncate(text, max = 200) {
  if (typeof text !== 'string') return ''
  const clean = text.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1)}…`
}

function applescriptEscape(text) {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Fire-and-forget spawn with a 5 s kill guard; onFail runs once. */
function spawnDetached(command, args, onFail) {
  let settled = false
  let child
  try {
    child = spawn(command, args, { stdio: 'ignore', detached: true })
  } catch (error) {
    onFail?.(error)
    return
  }
  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }, 5000)
  child.on('error', (error) => {
    clearTimeout(timer)
    if (settled) return
    settled = true
    onFail?.(error)
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    if (settled) return
    settled = true
    if (code !== 0) onFail?.(new Error(`exit code ${code}`))
  })
  child.unref()
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG }
  if (config && typeof config === 'object') {
    for (const [key, value] of Object.entries(config)) {
      if (key in DEFAULT_CONFIG) cfg[key] = value
    }
  }
  const t = TEXT[cfg.language === 'en' ? 'en' : 'zh']
  const log = ctx.logger ?? console

  // --- SSE channel: notification payloads for the Web GUI client half. ---
  const clients = new Set()
  const encoder = new TextEncoder()
  const webServer = ctx.get('webServer')
  if (webServer) {
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/plugin/dsh-mac-notifications/events',
          resource: async () => {
            let client = null
            const stream = new ReadableStream({
              start(controller) {
                client = {
                  send(payload) {
                    try {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
                    } catch {
                      /* stream already closed */
                    }
                  },
                }
                clients.add(client)
                controller.enqueue(encoder.encode('retry: 3000\n\n'))
              },
              cancel() {
                if (client) clients.delete(client)
              },
            })
            return new Response(stream, {
              headers: {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-cache, no-transform',
                connection: 'keep-alive',
              },
            })
          },
        }),
      'mac-notifications sse',
    )
  }

  const lastErrorNotify = new Map() // sessionId -> { turn, time }
  const lastDoneNotify = new Map() // sessionId -> time
  const now = () => Date.now()

  function hasLiveJobs(sessionId) {
    if (!cfg.suppressWhenJobsRunning) return false
    const jobs = ctx.get('jobs')
    if (!jobs) return false
    try {
      return jobs.list(sessionId).some((job) => job.status === 'running' || job.status === 'stopping')
    } catch {
      return false
    }
  }

  function sessionTitle(session) {
    try {
      return ctx.get('sessionTitle')?.get(session)?.title
    } catch {
      return undefined
    }
  }

  function isSubagent(session) {
    return typeof session?.header?.origin === 'string' && session.header.origin === 'subagent'
  }

  function isSubagentById(sessionId) {
    if (!sessionId) return false
    try {
      return isSubagent(ctx.get('sessions')?.get(sessionId))
    } catch {
      return false
    }
  }

  function notify({ title, subtitle, body }) {
    const payload = {
      title: truncate(title, 80) || 'DeepSeek',
      subtitle: subtitle ? truncate(subtitle, 120) : '',
      body: truncate(body, 200) || ' ',
      silent: !cfg.sound,
      tag: 'dsh-mac-notifications',
    }
    if (clients.size > 0) {
      for (const client of clients) client.send(payload)
      return
    }
    if (cfg.fallbackOsascript) notifyViaOsascript(payload)
  }

  function notifyViaOsascript(payload) {
    const sound = cfg.sound ? ' sound name "Glass"' : ''
    const script = `display notification "${applescriptEscape(payload.body)}" with title "${applescriptEscape(payload.title)}"${sound}`
    spawnDetached('/usr/bin/osascript', ['-e', script], (error) => {
      log.warn(`mac-notifications: osascript fallback failed: ${String(error?.message ?? error)}`)
    })
  }

  function dedupeError(sessionId, turn) {
    const time = now()
    const prev = lastErrorNotify.get(sessionId)
    if (prev && prev.turn === turn && time - prev.time < 60_000) return true
    lastErrorNotify.set(sessionId, { turn, time })
    return false
  }

  function errorText(error) {
    if (error && typeof error === 'object') {
      if (typeof error.message === 'string' && error.message) return error.message
      if (typeof error.code === 'string' && error.code) return error.code
    }
    if (typeof error === 'string') return error
    return ''
  }

  // 1) The agent asks the user to make a choice.
  ctx.on(
    'user-questions/request',
    (request, next) => {
      if (cfg.questions) {
        const first = request?.questions?.[0]
        notify({
          title: t.askTitle,
          subtitle: t.askSubtitle,
          body: truncate(first?.question) || truncate(first?.header) || t.askSubtitle,
        })
      }
      return next()
    },
    { prepend: true },
  )

  // 2) An approval decision is requested.
  ctx.on(
    'approval/request',
    (req, next) => {
      if (cfg.approvals) {
        const reason = truncate(req?.displayReason?.[cfg.language] ?? req?.displayReason?.en ?? req?.reason, 140)
        notify({ title: t.approvalTitle, body: t.approvalBody(truncate(req?.toolName, 60), reason) })
      }
      return next()
    },
    { prepend: true },
  )

  // 3) A turn settled: completed or failed.
  ctx.on('session/event', (session, event) => {
    if (!session || event?.type !== 'turn/end') return
    if (!cfg.includeSubagents && isSubagent(session)) return
    const { turn, reason } = event.data
    switch (reason?.kind) {
      case 'completed': {
        if (!cfg.completed || hasLiveJobs(session.id)) return
        const time = now()
        const prev = lastDoneNotify.get(session.id) ?? 0
        if (time - prev < cfg.cooldownMs) return
        lastDoneNotify.set(session.id, time)
        notify({ title: t.doneTitle, body: t.doneBody(sessionTitle(session)) })
        break
      }
      case 'error': {
        if (!cfg.errors) return
        if (dedupeError(session.id, turn)) return
        notify({ title: t.errorTitle, body: t.errorBody(errorText(reason.error)) })
        break
      }
      case 'aborted': {
        if (!cfg.errors) return
        const cause = reason.reason?.kind
        if (cause === 'user') return
        if (dedupeError(session.id, turn)) return
        notify({ title: t.abortedTitle, body: t.abortedBody(cause) })
        break
      }
      default:
        break
    }
  })

  // 4) A step or turn errored without a durable position.
  ctx.on('agent/error', (payload) => {
    if (!cfg.errors) return
    const { agent, turn, error } = payload ?? {}
    if (!cfg.includeSubagents && isSubagentById(agent?.id)) return
    if (agent?.id && dedupeError(agent.id, turn)) return
    notify({ title: t.errorTitle, body: t.errorBody(errorText(error)) })
  })

  // 5) An agent failed outside a durable turn position.
  ctx.on('api-session/error', (sessionId, message) => {
    if (!cfg.errors) return
    if (!cfg.includeSubagents && isSubagentById(sessionId)) return
    notify({ title: t.errorTitle, body: t.errorBody(truncate(message)) })
  })
}
