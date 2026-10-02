/*
 * FinBoard reminders (Web Push) in the service worker.
 *
 * The generated service worker (vite-plugin-pwa / workbox, see vite.config.ts) loads this file with
 * importScripts('push-sw.js'). It shows each reminder the server sends (api/reminders.ts) and, when
 * the notification is tapped, brings FinBoard to the front on the page the reminder is about.
 *
 * Payload (JSON): { title, body, url, tag }. Everything is optional and checked: a missing or broken
 * payload still shows a plain "FinBoard" notification, because iOS stops delivering pushes to apps
 * that receive one without showing anything.
 */
;(function () {
  'use strict'

  var ICON = '/pwa-192x192.png'
  var FALLBACK_TITLE = 'FinBoard'
  var FALLBACK_BODY = 'You have a reminder. Open FinBoard to see it.'
  var ELLIPSIS = String.fromCharCode(8230)

  function text(value, max) {
    if (typeof value !== 'string') return ''
    var t = value.trim()
    return t.length > max ? t.slice(0, max - 1) + ELLIPSIS : t
  }

  /** An address inside FinBoard (relative ones are resolved); anything else becomes the home page. */
  function appUrl(value) {
    try {
      var url = new URL(typeof value === 'string' && value.trim() ? value.trim() : '/', self.location.origin)
      if (url.origin === self.location.origin) return url.href
    } catch {
      // not a usable address
    }
    return self.location.origin + '/'
  }

  function readPayload(event) {
    if (!event.data) return {}
    try {
      var data = event.data.json()
      return data && typeof data === 'object' ? data : {}
    } catch {
      // not JSON: use plain text as the message
    }
    try {
      return { body: event.data.text() }
    } catch {
      return {}
    }
  }

  self.addEventListener('push', function (event) {
    var data = readPayload(event)
    var title = text(data.title, 120) || FALLBACK_TITLE
    var options = {
      body: text(data.body, 300) || FALLBACK_BODY,
      icon: ICON,
      data: { url: appUrl(data.url) },
    }
    var tag = text(data.tag, 200)
    if (tag) {
      // a newer reminder about the same thing replaces the older one, and still alerts
      options.tag = tag
      options.renotify = true
    }
    event.waitUntil(
      self.registration.showNotification(title, options).catch(function () {
        return self.registration.showNotification(FALLBACK_TITLE, { body: FALLBACK_BODY, icon: ICON, data: { url: self.location.origin + '/' } })
      }),
    )
  })

  /** The FinBoard window to reuse: the focused one, else a visible one, else any. */
  function pickWindow(windows) {
    var mine = windows.filter(function (w) {
      try {
        return new URL(w.url).origin === self.location.origin
      } catch {
        return false
      }
    })
    return (
      mine.filter(function (w) {
        return w.focused
      })[0] ||
      mine.filter(function (w) {
        return w.visibilityState === 'visible'
      })[0] ||
      mine[0] ||
      null
    )
  }

  function openWindow(url) {
    return self.clients.openWindow ? self.clients.openWindow(url) : Promise.resolve(null)
  }

  function showInApp(url) {
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
      var win = pickWindow(windows)
      if (!win) return openWindow(url)
      return Promise.resolve()
        .then(function () {
          return win.focus ? win.focus() : win
        })
        .catch(function () {
          return win
        })
        .then(function (focused) {
          var target = focused || win
          if (target.url === url) return target
          if (typeof target.navigate !== 'function') return openWindow(url)
          return target.navigate(url).then(
            function (navigated) {
              return navigated || openWindow(url)
            },
            function () {
              return openWindow(url)
            },
          )
        })
    })
  }

  self.addEventListener('notificationclick', function (event) {
    event.notification.close()
    var url = appUrl(event.notification.data && event.notification.data.url)
    event.waitUntil(
      showInApp(url).catch(function () {
        return openWindow(url)
      }),
    )
  })
})()
