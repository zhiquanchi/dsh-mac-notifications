/**
 * dsh-mac-notifications — browser half.
 *
 * Subscribes to the Host SSE stream at /plugin/dsh-mac-notifications/events and
 * shows notifications through the browser Notification API, so macOS attributes
 * them to the DeepSeek Harness application itself (its name and whale icon).
 *
 * Details:
 *  - Notification permission is requested from a small in-page card (browser
 *    engines only grant it from a user gesture).
 *  - Clicking a notification focuses the window, raises it via the dsh://open
 *    protocol (Electron), and jumps to the session when the frame carries one.
 *  - Reconnects automatically and catches up missed frames via /pending.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mac-notifications',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports
    var TAG = '[dsh-mac-notifications]'

    var es = null
    var reconnectTimer = null
    var disposed = false
    var lastSeq = 0
    var ctxRef = null

    // ---------------------------------------------------------------- 系统通知

    function osTitle(frame) {
      return frame.title || 'DeepSeek'
    }

    function osBody(frame) {
      var lines = []
      if (frame.subtitle) lines.push(frame.subtitle)
      if (frame.body) lines.push(frame.body)
      return lines.join('\n').slice(0, 240)
    }

    function focusAndOpen(sessionId) {
      try {
        window.focus()
      } catch {
        /* ignore */
      }
      if (sessionId) {
        var workspace = null
        try {
          workspace = ctxRef && typeof ctxRef.get === 'function' ? ctxRef.get('uiWorkspace') : null
        } catch {
          workspace = null
        }
        if (workspace && typeof workspace.openSession === 'function') {
          try {
            workspace.openSession(sessionId)
          } catch {
            /* ignore */
          }
        }
      }
      // Raise the desktop window through the protocol the desktop app registers.
      try {
        if (/electron/i.test(navigator.userAgent || '')) {
          var frame = document.createElement('iframe')
          frame.style.display = 'none'
          frame.src = 'dsh://open'
          document.body.appendChild(frame)
          setTimeout(function () {
            if (frame.parentNode) frame.parentNode.removeChild(frame)
          }, 1000)
        }
      } catch {
        /* ignore */
      }
    }

    function osNotify(frame) {
      if (typeof Notification === 'undefined') return
      if (Notification.permission !== 'granted') return
      try {
        var notification = new Notification(osTitle(frame), {
          body: osBody(frame),
          tag: frame.tag || 'dsh-mac-notifications',
          silent: frame.silent === true,
        })
        notification.onclick = function () {
          try {
            notification.close()
          } catch {
            /* already closed */
          }
          focusAndOpen(frame.sessionId)
        }
      } catch (error) {
        console.warn(TAG + ' 系统通知发送失败：' + error)
      }
    }

    // ---------------------------------------------------------------- 授权卡片

    var CARD_CSS = [
      '.dmn-root{position:fixed;top:14px;right:14px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;max-width:min(360px,calc(100vw - 28px))}',
      '.dmn-card{box-sizing:border-box;width:100%;border-radius:13px;border:1px solid rgba(122,140,175,.30);background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#1b1e26);box-shadow:0 12px 32px rgba(8,14,30,.20),0 2px 6px rgba(8,14,30,.10);padding:12px 14px 11px;display:flex;flex-direction:column;gap:8px;animation:dmn-in .18s cubic-bezier(.2,.9,.3,1.2)}',
      '.dmn-title{font-weight:700;font-size:14.5px}',
      '.dmn-body{color:var(--dsw-alias-label-secondary,#4a5061);font-size:13px}',
      '.dmn-foot{display:flex;align-items:center;gap:8px;justify-content:flex-end}',
      '.dmn-btn{border-radius:8px;border:1px solid rgba(122,140,175,.35);background:transparent;color:var(--dsw-alias-label-primary,#1b1e26);font:inherit;font-size:12.5px;padding:4px 10px;cursor:pointer}',
      '.dmn-btn:hover{background:rgba(122,140,175,.14)}',
      '.dmn-btn.dmn-primary{border-color:transparent;background:#4c6ef5;color:#fff}',
      '.dmn-btn.dmn-primary:hover{filter:brightness(1.08)}',
      '@keyframes dmn-in{from{opacity:0;transform:translateY(-8px) scale(.97)}to{opacity:1;transform:none}}',
    ].join('')

    function installStyle() {
      if (document.querySelector('style[data-dsh-mac-notifications]') !== null) return
      var tag = document.createElement('style')
      tag.setAttribute('data-dsh-mac-notifications', 'dsh-mac-notifications/style')
      tag.textContent = CARD_CSS
      document.head.appendChild(tag)
    }

    function ensureRoot() {
      var root = document.querySelector('.dmn-root')
      if (root) return root
      root = document.createElement('div')
      root.className = 'dmn-root'
      root.setAttribute('role', 'status')
      ;(document.body || document.documentElement).appendChild(root)
      return root
    }

    function dismiss(card) {
      if (!card || card.parentNode === null) return
      card.parentNode.removeChild(card)
      var root = document.querySelector('.dmn-root')
      if (root && root.childNodes.length === 0) root.remove()
    }

    function showPermissionCard() {
      installStyle()
      var root = ensureRoot()
      var card = document.createElement('div')
      card.className = 'dmn-card'
      var title = document.createElement('div')
      title.className = 'dmn-title'
      title.textContent = '开启桌面通知？'
      var body = document.createElement('div')
      body.className = 'dmn-body'
      body.textContent = '任务完成、需要你选择或任务失败时，通过系统通知提醒你（以 DeepSeek Harness 的名义显示）。'
      var foot = document.createElement('div')
      foot.className = 'dmn-foot'
      var ok = document.createElement('button')
      ok.type = 'button'
      ok.className = 'dmn-btn dmn-primary'
      ok.textContent = '开启'
      ok.addEventListener('click', function () {
        try {
          Notification.requestPermission()
        } catch {
          /* ignore */
        }
        dismiss(card)
      })
      var no = document.createElement('button')
      no.type = 'button'
      no.className = 'dmn-btn'
      no.textContent = '暂不'
      no.addEventListener('click', function () {
        dismiss(card)
      })
      foot.appendChild(no)
      foot.appendChild(ok)
      card.appendChild(title)
      card.appendChild(body)
      card.appendChild(foot)
      root.appendChild(card)
    }

    // ---------------------------------------------------------------- 帧分发

    function handleFrame(frame) {
      if (!frame || typeof frame !== 'object') return
      if (frame.kind === 'hello') {
        if (typeof frame.seq === 'number' && frame.seq > lastSeq) lastSeq = frame.seq
        return
      }
      if (typeof frame.seq === 'number') lastSeq = frame.seq
      if (frame.kind !== 'notify') return
      osNotify(frame)
    }

    function catchUp() {
      fetch('/plugin/dsh-mac-notifications/pending?since=' + lastSeq, { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        })
        .then(function (payload) {
          var items = payload && Array.isArray(payload.items) ? payload.items : []
          items.slice(-3).forEach(handleFrame)
        })
        .catch(function () {
          /* host half not up yet; silent */
        })
    }

    function scheduleReconnect(delay) {
      if (disposed || reconnectTimer) return
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null
        connect()
      }, delay || 3000)
    }

    function connect() {
      if (disposed) return
      if (typeof EventSource === 'undefined') {
        setInterval(catchUp, 2000)
        return
      }
      try {
        es = new EventSource('/plugin/dsh-mac-notifications/events')
      } catch (error) {
        console.warn(TAG + ' 建立通知流失败：' + error)
        scheduleReconnect(5000)
        return
      }
      es.onopen = function () {
        catchUp()
      }
      es.onmessage = function (event) {
        if (!event || typeof event.data !== 'string') return
        var frame
        try {
          frame = JSON.parse(event.data)
        } catch (error) {
          console.warn(TAG + ' 收到无法解析的通知帧')
          return
        }
        try {
          handleFrame(frame)
        } catch (error) {
          console.warn(TAG + ' 处理通知失败：' + error)
        }
      }
      es.onerror = function () {
        if (!es) return
        if (es.readyState === 2) {
          try {
            es.close()
          } catch {
            /* ignore */
          }
          es = null
          scheduleReconnect(3000)
        }
      }
    }

    function onVisible() {
      var visible = document.visibilityState === 'visible'
      if (visible && es === null) connect()
      if (visible) catchUp()
    }

    // ---------------------------------------------------------------- 装配

    function apply(ctx) {
      ctxRef = ctx
      connect()
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', onVisible)
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        // 权限请求必须由用户手势触发，弹一张小卡片请用户开启
        setTimeout(showPermissionCard, 1200)
      }
      ctx.effect(
        function () {
          return function () {
            disposed = true
            document.removeEventListener('visibilitychange', onVisible)
            window.removeEventListener('focus', onVisible)
            if (reconnectTimer) clearTimeout(reconnectTimer)
            if (es) {
              try {
                es.close()
              } catch {
                /* ignore */
              }
              es = null
            }
            var root = document.querySelector('.dmn-root')
            if (root) root.remove()
            var style = document.querySelector('style[data-dsh-mac-notifications]')
            if (style) style.remove()
          }
        },
        'dsh-mac-notifications: 通知流',
      )
    }

    exports.name = 'dsh-mac-notifications-client'
    exports.apply = apply
    return module.exports
  },
})
