/**
 * dsh-mac-notifications — native macOS Notification Center notifications
 * for the DeepSeek Harness desktop app, bearing the official DeepSeek whale
 * logo as the notification icon.
 *
 * Fires a native notification when:
 *  - the agent asks you to make a choice (`user-questions/request`)
 *  - an approval decision is requested (`approval/request`)
 *  - a turn completes (`turn/end` with reason `completed`, unless live
 *    background jobs still run for that session)
 *  - a task fails abnormally (`turn/end` error/aborted, `agent/error`,
 *    `api-session/error`), deduplicated per turn
 *
 * Transport: macOS shows the sender app's icon in Notification Center, so the
 * plugin builds a small helper applet ("DeepSeek Notifier", LSUIElement,
 * DeepSeek logo as its icon) in the system temp directory and posts
 * notifications through it. If the helper cannot be built or launched, it
 * falls back to `osascript display notification` attributed to `appName`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

const DEFAULT_CONFIG = {
  questions: true,
  approvals: true,
  completed: true,
  errors: true,
  includeSubagents: false,
  suppressWhenJobsRunning: true,
  sound: true,
  language: 'zh',
  appName: 'DeepSeek Harness',
  cooldownMs: 3000,
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

const HELPER_NAME = 'DeepSeek Notifier.app'
const HELPER_BUILD_VERSION = '3'

const NOTIFY_SCRIPT = `on run argv
    try
        if (count of argv) is less than 4 then return
        set notifyBody to item 1 of argv
        set notifyTitle to item 2 of argv
        set notifySubtitle to item 3 of argv
        set notifySound to item 4 of argv
        if notifySubtitle is "" then
            if notifySound is "" then
                display notification notifyBody with title notifyTitle
            else
                display notification notifyBody with title notifyTitle sound name notifySound
            end if
        else
            if notifySound is "" then
                display notification notifyBody with title notifyTitle subtitle notifySubtitle
            else
                display notification notifyBody with title notifyTitle subtitle notifySubtitle sound name notifySound
            end if
        end if
    end try
    return
end run
`

function truncate(text, max = 200) {
  if (typeof text !== 'string') return ''
  const clean = text.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1)}…`
}

function applescriptEscape(text) {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function helperDir() {
  return join(tmpdir(), 'dsh-mac-notifications-helper')
}

/**
 * Build (once per boot) a minimal applet that posts notifications under its
 * own bundle identity, showing the DeepSeek logo as the notification icon.
 */
function buildHelper(log) {
  const dir = helperDir()
  const appPath = join(dir, HELPER_NAME)
  const stampPath = join(dir, `.built-v${HELPER_BUILD_VERSION}`)
  if (existsSync(stampPath) && existsSync(join(appPath, 'Contents/MacOS/applet'))) {
    return Promise.resolve(appPath)
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (path) => {
      if (settled) return
      settled = true
      resolve(path)
    }
    try {
      mkdirSync(dir, { recursive: true })
      rmSync(appPath, { recursive: true, force: true })
      const scriptPath = join(dir, 'notify.applescript')
      writeFileSync(scriptPath, NOTIFY_SCRIPT, 'utf8')
      const compile = spawn('/usr/bin/osacompile', ['-o', appPath, scriptPath], { stdio: 'ignore' })
      const timer = setTimeout(() => {
        try {
          compile.kill('SIGKILL')
        } catch {
          /* already gone */
        }
        finish(null)
      }, 30000)
      compile.on('error', () => {
        clearTimeout(timer)
        finish(null)
      })
      compile.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0 || !existsSync(join(appPath, 'Contents/MacOS/applet'))) return finish(null)
        try {
          const icns = join(MODULE_DIR, 'assets', 'deepseek.icns')
          if (existsSync(icns)) copyFileSync(icns, join(appPath, 'Contents/Resources/applet.icns'))
          const plist = join(appPath, 'Contents/Info.plist')
          for (const [key, type, value] of [
            ['CFBundleIdentifier', 'string', 'com.dsh.macnotifications.helper'],
            ['CFBundleName', 'string', 'DeepSeek Notifier'],
            ['LSUIElement', 'bool', 'true'],
          ]) {
            spawnSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist])
            spawnSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist])
          }
          writeFileSync(stampPath, String(Date.now()))
          return finish(appPath)
        } catch (error) {
          log.warn(`mac-notifications: helper finalize failed: ${String(error?.message ?? error)}`)
          return finish(null)
        }
      })
    } catch (error) {
      log.warn(`mac-notifications: helper build failed: ${String(error?.message ?? error)}`)
      finish(null)
    }
  })
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

  let helperApp = null
  buildHelper(log).then((path) => {
    helperApp = path
    if (path) log.info('mac-notifications: DeepSeek notification helper ready')
  })

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
    const sound = cfg.sound ? 'Glass' : ''
    const bodyText = truncate(body, 200) || ' '
    const titleText = truncate(title, 80) || 'DeepSeek'
    const subText = subtitle ? truncate(subtitle, 120) : ''
    // Preferred transport: the helper applet shows the DeepSeek logo.
    // The applet is executed directly so its `on run argv` receives the
    // arguments reliably (LaunchServices `open --args` does not deliver
    // them to applets).
    if (helperApp) {
      spawnDetached(join(helperApp, 'Contents/MacOS/applet'), [bodyText, titleText, subText, sound], () => {
        notifyAttributed({ bodyText, titleText, subText, sound })
      })
      return
    }
    notifyAttributed({ bodyText, titleText, subText, sound })
  }

  function notifyAttributed({ bodyText, titleText, subText, sound }) {
    const soundPart = sound ? ' sound name "Glass"' : ''
    const sub = subText ? ` subtitle "${applescriptEscape(subText)}"` : ''
    const bodyLiteral = applescriptEscape(bodyText) || ' '
    const titleLiteral = applescriptEscape(titleText)
    const app = applescriptEscape(cfg.appName || 'DeepSeek Harness')
    const attributed = `tell application "${app}" to display notification "${bodyLiteral}" with title "${titleLiteral}"${sub}${soundPart}`
    spawnDetached('/usr/bin/osascript', ['-e', attributed], () => {
      const plain = `display notification "${bodyLiteral}" with title "${titleLiteral}"${sub}${soundPart}`
      spawnDetached('/usr/bin/osascript', ['-e', plain], (error) => {
        log.warn(`mac-notifications: unable to post notification: ${String(error?.message ?? error)}`)
      })
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
