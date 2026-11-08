/**
 * Client half of dsh-mac-notifications. Subscribes to the Host's SSE endpoint
 * and shows notifications through the browser Notification API, so macOS
 * attributes them to the DeepSeek Harness application itself.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mac-notifications',
  factory() {
    return {
      apply(ctx) {
        if (typeof Notification === 'undefined' || typeof EventSource === 'undefined') return
        let source = null
        let disposed = false

        function showNotification(payload) {
          try {
            if (Notification.permission !== 'granted') return
            const text = payload.subtitle ? `${payload.subtitle}\n${payload.body}` : payload.body
            new Notification(payload.title || 'DeepSeek', {
              body: text,
              tag: payload.tag || 'dsh-mac-notifications',
              silent: payload.silent === true,
            })
          } catch {
            /* ignore */
          }
        }

        function connect() {
          if (disposed || Notification.permission === 'denied') return
          source = new EventSource('/plugin/dsh-mac-notifications/events')
          source.onmessage = (event) => {
            try {
              showNotification(JSON.parse(event.data))
            } catch {
              /* ignore */
            }
          }
          // EventSource reconnects automatically on network errors.
        }

        function ensurePermission() {
          if (Notification.permission === 'default') {
            Notification.requestPermission()
              .then((result) => {
                if (result === 'granted') connect()
              })
              .catch(() => {})
          } else if (Notification.permission === 'granted') {
            connect()
          }
        }

        ensurePermission()
        ctx.effect(
          () => () => {
            disposed = true
            source?.close()
          },
          'dsh-mac-notifications client',
        )
      },
    }
  },
})
