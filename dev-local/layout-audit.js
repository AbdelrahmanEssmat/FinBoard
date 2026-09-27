// Layout audit for the browser (dev only). With the local app open (npm run dev:local), in the console:
//   await import('/dev-local/layout-audit.js'); await __sweep('/debts')
// Reports, for the page and for every popup its buttons open (in every switch/tab state):
// anything wider than the box that holds it (poking out or cut off), controls that overlap each
// other, single-line text that spills out of its box, and sideways page scrolling.

window.__wait = (ms) => new Promise((r) => setTimeout(r, ms))
window.__finish = () => document.getAnimations().forEach((a) => { try { a.finish() } catch { /* infinite animations */ } })

window.__audit = () => {
  const issues = []
  const vw = window.innerWidth
  if (document.documentElement.scrollWidth > vw + 1) issues.push(`page scrolls sideways (${document.documentElement.scrollWidth}px wide)`)
  const dialogs = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')]
  const root = dialogs.length ? dialogs[dialogs.length - 1].lastElementChild : document.querySelector('main')
  if (!root) return issues
  const name = (el) => {
    const t = (el.getAttribute('aria-label') || el.placeholder || el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 30)
    return `${el.tagName.toLowerCase()}${el.type && el.tagName !== 'BUTTON' ? '[' + el.type + ']' : ''} "${t}"`
  }
  const rr = root.getBoundingClientRect()
  const L = Math.max(rr.left, 0)
  const R = Math.min(rr.right, vw)
  const all = [...root.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && s.position !== 'fixed' && !el.closest('svg')
  })

  // The box an element must fit in: the nearest ancestor that clips (a card, the sheet's scroll
  // area), else the page/sheet. Rows built to scroll sideways and "…" truncation are exempt.
  const boundsOf = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p === root) return { l: L, r: R, box: 'page/sheet' }
      const s = getComputedStyle(p)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      // a row built to scroll sideways (overflow-x-auto also turns overflow-y to auto, so look at
      // whether it actually scrolls vertically rather than at the style)
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollHeight <= p.clientHeight + 1) return null
      if (s.textOverflow === 'ellipsis') return null
      const q = p.getBoundingClientRect()
      return { l: Math.max(q.left, 0), r: Math.min(q.right, vw), box: String(p.className).split(' ').slice(0, 3).join(' ') }
    }
    return { l: L, r: R, box: 'page' }
  }
  // the padded column an element sits in (a sheet body, a card): running into its side margin
  // counts too; 8px of slack allows the few deliberate edge-to-edge touches (e.g. a chart's -mx-1)
  const columnOf = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      const pl = parseFloat(s.paddingLeft), pr = parseFloat(s.paddingRight)
      if (pl > 0 || pr > 0) {
        const q = p.getBoundingClientRect()
        return { l: q.left + pl + parseFloat(s.borderLeftWidth), r: q.right - pr - parseFloat(s.borderRightWidth) }
      }
      if (p === root) break
    }
    return null
  }
  for (const el of all) {
    const b = boundsOf(el)
    if (!b) continue
    const r = el.getBoundingClientRect()
    if (r.right > b.r + 1 || r.left < b.l - 1) {
      issues.push(`sticks out: ${name(el)} (${Math.round(r.left)}-${Math.round(r.right)}, room ${Math.round(b.l)}-${Math.round(b.r)} in ${b.box})`)
      continue
    }
    // a row that deliberately runs edge to edge sticks out evenly on both sides; a spill is lopsided
    const c = columnOf(el)
    if (c) {
      const outL = c.l - r.left, outR = r.right - c.r
      if ((outL > 8 || outR > 8) && Math.abs(outL - outR) > 8) issues.push(`into the margin: ${name(el)} (${Math.round(r.left)}-${Math.round(r.right)}, column ${Math.round(c.l)}-${Math.round(c.r)})`)
    }
  }

  // Overlapping controls, using only the part of each that is actually on screen
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    let x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const q = p.getBoundingClientRect()
        x1 = Math.max(x1, q.left); y1 = Math.max(y1, q.top); x2 = Math.min(x2, q.right); y2 = Math.min(y2, q.bottom)
      }
      if (p === root) break
    }
    return x2 - x1 > 1 && y2 - y1 > 1 ? { x1, y1, x2, y2 } : null
  }
  const controls = all.filter((el) => el.matches('input:not([type=hidden]), select, textarea, button, [role=switch], [role=tab], a[href]'))
  const vis = controls.map(visible)
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j], ra = vis[i], rb = vis[j]
      if (!ra || !rb || a.contains(b) || b.contains(a)) continue
      const w = Math.min(ra.x2, rb.x2) - Math.max(ra.x1, rb.x1)
      const h = Math.min(ra.y2, rb.y2) - Math.max(ra.y1, rb.y1)
      if (w > 1 && h > 1) issues.push(`overlap: ${name(a)} x ${name(b)} (${Math.round(w)}x${Math.round(h)}px)`)
    }
  }

  // Single-line text wider than its own box with no "…"
  for (const el of all) {
    if (el.children.length || !el.textContent.trim()) continue
    const s = getComputedStyle(el)
    if (s.display !== 'inline' && s.whiteSpace === 'nowrap' && s.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 2) issues.push(`text spills: "${el.textContent.trim().slice(0, 30)}"`)
  }
  return [...new Set(issues)].slice(0, 15)
}

// never press anything that saves, deletes, sends or leaves
const SKIP = /delete|remove|archive|sign ?out|undo|save|^sell|confirm|reset|import|export|restore|backup|log payout|log it|mark all|^done$|refresh|fetch|clear|close|record|pay back|use this|apply|keep|split|cancel|^yes|install|deposit money|withdraw money/i

window.__navigate = async (path) => {
  history.pushState({}, '', path)
  dispatchEvent(new PopStateEvent('popstate'))
  await __wait(900)
  __finish()
}
window.__closeDialogs = async () => {
  for (let k = 0; k < 4 && document.querySelector('[role=dialog],[role=alertdialog]'); k++) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await __wait(250)
  }
}
const topDialog = () => { const d = [...document.querySelectorAll('[role=dialog]')]; return d[d.length - 1] }

/** Audit the open popup, then again after flipping each of its switches and tabs. */
window.__auditDialog = async (label, out) => {
  __finish()
  let r = __audit()
  if (r.length) out.push({ where: label, issues: r })
  const count = topDialog()?.querySelectorAll('[role=switch], [role=tab]').length ?? 0
  for (let i = 0; i < count; i++) {
    const t = topDialog()?.querySelectorAll('[role=switch], [role=tab]')[i]
    if (!t || t.disabled) continue
    const tl = (t.innerText || t.closest('label')?.innerText || 'switch').trim().split('\n')[0].slice(0, 24)
    t.click()
    await __wait(250)
    __finish()
    r = __audit()
    if (r.length) out.push({ where: `${label} > ${tl}`, issues: r })
  }
}

/** Audit a page and every popup (or sub-page) its buttons open. */
window.__sweep = async (path, opts = {}) => {
  const out = []
  await __closeDialogs()
  await __navigate(path)
  let r = __audit()
  if (r.length) out.push({ where: `page ${path}`, issues: r })
  const labelOf = (b) => (b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30)
  const candidates = [...document.querySelectorAll('main button, main [role=button]')].map(labelOf).filter((t) => t && !SKIP.test(t))
  const seen = new Set()
  let opened = 0
  for (const t of candidates) {
    if (seen.has(t) || opened >= (opts.max ?? 14)) continue
    seen.add(t)
    const b = [...document.querySelectorAll('main button, main [role=button]')].find((x) => labelOf(x) === t)
    if (!b) continue
    b.click()
    await __wait(600)
    __finish()
    if (location.pathname !== path) {
      r = __audit()
      if (r.length) out.push({ where: `${path} -> ${location.pathname}`, issues: r })
      await __navigate(path)
      continue
    }
    if (document.querySelector('[role=dialog]')) {
      opened++
      await __auditDialog(`${path} [${t}]`, out)
      await __closeDialogs()
    }
  }
  return { path, opened, problems: out }
}

/** The home page's floating "+" menu and every form it opens. */
window.__sweepQuickAdd = async () => {
  const out = []
  await __closeDialogs()
  await __navigate('/')
  const fab = () => document.querySelector('button[aria-label="Quick add"]')
  if (!fab()) return { path: '+ menu', opened: 0, problems: [{ where: '+ menu', issues: ['no + button on the home page'] }] }
  fab().click()
  await __wait(500)
  await __auditDialog('+ menu', out)
  const options = [...topDialog().querySelectorAll('button')].map((b) => b.innerText.trim()).filter((t) => t && t !== 'Update prices' && !/close/i.test(t))
  await __closeDialogs()
  let opened = 0
  for (const o of options) {
    fab().click()
    await __wait(500)
    const b = [...topDialog().querySelectorAll('button')].find((x) => x.innerText.trim() === o)
    if (!b) continue
    b.click()
    await __wait(700)
    if (document.querySelector('[role=dialog]')) {
      opened++
      await __auditDialog(`+ menu [${o}]`, out)
    }
    await __closeDialogs()
  }
  return { path: '+ menu', opened, problems: out }
}

/** Sweep many routes, saving progress in sessionStorage (survives a reload; call again to resume). */
window.__runAll = async (routes, key) => {
  const saved = JSON.parse(sessionStorage.getItem(key) || '[]')
  for (const p of routes) {
    if (saved.some((s) => s.p === p)) continue
    sessionStorage.setItem(key + ':current', p)
    let entry
    try {
      const r = p === '+' ? await __sweepQuickAdd() : await __sweep(p)
      entry = { p, opened: r.opened, problems: r.problems }
    } catch (e) {
      entry = { p, error: String(e).slice(0, 160) }
    }
    saved.push(entry)
    sessionStorage.setItem(key, JSON.stringify(saved))
  }
  await __closeDialogs()
  sessionStorage.setItem(key + ':done', '1')
}

export {}
