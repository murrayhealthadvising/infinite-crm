// Gmail send integration — mirror of gcal.js but for the Gmail send API.
//
// Lets the user compose + send a reply or new email straight from a lead
// detail page without leaving the CRM. We reuse the same Google Identity
// Services (GIS) token-client pattern Calendar uses, but with separate
// storage so connecting Gmail doesn't require Calendar (and vice-versa).
//
// Sends through https://www.googleapis.com/gmail/v1/users/me/messages/send.
// Body is RFC 2822, base64url-encoded, plain-text only (no attachments).

import { getGoogleClientId } from './gcal'

// gmail.compose covers send + read/list/edit drafts, which is how Gmail
// templates are stored. Broader than gmail.send but lets us pull the agent's
// existing templates into the Compose modal so they don't have to retype.
const SCOPES = 'https://www.googleapis.com/auth/gmail.compose'
const TOKEN_KEY = 'infinite_crm_gmail_token'
const CONNECTED_KEY = 'infinite_crm_gmail_connected'

function readToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const t = JSON.parse(raw)
    if (!t?.access_token || !t?.expires_at) return null
    if (Date.now() >= t.expires_at - 60_000) return null  // 1-min skew buffer
    return t
  } catch { return null }
}
function writeToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
    localStorage.setItem(CONNECTED_KEY, '1')
  } catch {}
}
export function clearGmailToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(CONNECTED_KEY)
  } catch {}
}
export function isGmailConnected() {
  try { return localStorage.getItem(CONNECTED_KEY) === '1' } catch { return false }
}

// Proactive token refresh every 50 min — Google access tokens are ~1 hr.
let _refreshTimer = null
function scheduleRefresh() {
  if (_refreshTimer) clearTimeout(_refreshTimer)
  _refreshTimer = setTimeout(async () => {
    if (!isGmailConnected()) return
    const t = await silentRefresh()
    if (t) scheduleRefresh()
  }, 50 * 60 * 1000)
}
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => { if (isGmailConnected()) scheduleRefresh() })
}

// ── Connect: visible consent prompt the first time, silent thereafter ─────
export function connectGmail() {
  return new Promise((resolve, reject) => {
    const clientId = getGoogleClientId()
    if (!clientId) {
      reject(new Error('Google Client ID not configured. Set VITE_GOOGLE_CLIENT_ID in Vercel env vars.'))
      return
    }
    const gis = window.google?.accounts?.oauth2
    if (!gis) {
      reject(new Error('Google Identity Services not loaded — refresh the page and try again.'))
      return
    }
    const client = gis.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      prompt: '',
      callback: (resp) => {
        if (resp?.error) { reject(new Error(resp.error_description || resp.error)); return }
        if (!resp?.access_token) { reject(new Error('No access token returned')); return }
        const token = {
          access_token: resp.access_token,
          expires_at: Date.now() + (Number(resp.expires_in || 3500) * 1000),
        }
        writeToken(token)
        scheduleRefresh()
        resolve(token)
      },
      error_callback: (err) => reject(new Error(err?.message || 'OAuth flow failed')),
    })
    client.requestAccessToken({ prompt: 'consent' })
  })
}

// Silent refresh: no UI prompt. Used right before sending if the cached
// token expired AND on the 50-min timer to keep the connection warm.
function silentRefresh() {
  return new Promise((resolve) => {
    const clientId = getGoogleClientId()
    const gis = window.google?.accounts?.oauth2
    if (!clientId || !gis) { resolve(null); return }
    try {
      const client = gis.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        prompt: '',
        callback: (resp) => {
          if (!resp?.access_token) { resolve(null); return }
          const token = {
            access_token: resp.access_token,
            expires_at: Date.now() + (Number(resp.expires_in || 3500) * 1000),
          }
          writeToken(token)
          scheduleRefresh()
          resolve(token)
        },
        error_callback: () => resolve(null),
      })
      client.requestAccessToken({ prompt: '' })
    } catch { resolve(null) }
  })
}

// ── RFC 2822 builder ─────────────────────────────────────────────────────
// Builds either a plain-text message OR a multipart/alternative with BOTH
// plain and HTML so the recipient's mail client shows the HTML version while
// still having a usable plain-text fallback (good deliverability, accessible).
//
// When `html` is provided, plain is auto-derived from it for the alternative
// part. We use quoted-printable for the HTML body so soft line wraps don't
// corrupt URLs / inline styles.
function rfc2822({ to, subject, html, body, fromName }) {
  const lines = []
  if (fromName) lines.push(`From: ${fromName}`)
  lines.push(`To: ${to}`)
  lines.push(`Subject: ${encodeHeader(subject || '')}`)
  lines.push(`Date: ${new Date().toUTCString()}`)
  lines.push('MIME-Version: 1.0')

  if (html) {
    const boundary = 'boundary-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    const plain = body || htmlToPlain(html)
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    lines.push('')
    lines.push('--' + boundary)
    lines.push('Content-Type: text/plain; charset=utf-8')
    lines.push('Content-Transfer-Encoding: 8bit')
    lines.push('')
    lines.push(String(plain).replace(/\r?\n/g, '\r\n'))
    lines.push('--' + boundary)
    lines.push('Content-Type: text/html; charset=utf-8')
    lines.push('Content-Transfer-Encoding: 8bit')
    lines.push('')
    lines.push(String(html).replace(/\r?\n/g, '\r\n'))
    lines.push('--' + boundary + '--')
  } else {
    lines.push('Content-Type: text/plain; charset=utf-8')
    lines.push('Content-Transfer-Encoding: 8bit')
    lines.push('')
    lines.push(String(body || '').replace(/\r?\n/g, '\r\n'))
  }
  return lines.join('\r\n')
}

// Cheap HTML → plain-text fallback for the multipart/alternative plain part.
// Doesn't need to be pretty; it's what gets shown only if the recipient's
// mail client can't render HTML.
function htmlToPlain(html) {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// RFC 2047 encoding for non-ASCII subject lines. Gmail tolerates UTF-8 raw,
// but using `=?UTF-8?B?...?=` makes the subject render correctly in every
// email client even if it contains emoji / accented characters.
function encodeHeader(s) {
  if (!s) return ''
  // Only encode if there's a non-ASCII char
  if (/^[\x20-\x7E]*$/.test(s)) return s
  try {
    const b64 = btoa(unescape(encodeURIComponent(s)))
    return `=?UTF-8?B?${b64}?=`
  } catch { return s }
}

// base64url (RFC 4648 §5) — '+' → '-', '/' → '_', strip '='. Required by
// Gmail's `raw` field.
function toBase64Url(s) {
  try {
    return btoa(unescape(encodeURIComponent(s)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  } catch (e) {
    throw new Error('Failed to base64-encode message body: ' + (e?.message || e))
  }
}

// ── Drafts / Templates ────────────────────────────────────────────────────
// Gmail templates are stored as drafts. We list the agent's drafts and pull
// out subject + body text so they can pick one in the Compose modal.
//
// Trade-off: this requires gmail.compose scope (we already have it). The
// list-then-fetch-each-detail pattern is N+1 API calls but Gmail caps at
// 20-50 drafts for most users so it's fine. We cache the result in-memory
// for the modal's lifetime — refresh button forces a re-fetch.

function decodeBase64Url(s) {
  if (!s) return ''
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    return decodeURIComponent(escape(atob(b64)))
  } catch { return '' }
}

// Recursively walk a Gmail message payload and pull out BOTH text/plain and
// text/html parts. Returns { plain, html }. Either or both may be empty.
// We keep both so the compose modal can show a rendered HTML preview AND
// fall back to plain when sending.
function extractBodyParts(payload) {
  let plain = ''
  let html = ''
  function walk(p) {
    if (!p) return
    if (p.body?.data) {
      const text = decodeBase64Url(p.body.data)
      if (p.mimeType === 'text/plain' && !plain) plain = text
      else if (p.mimeType === 'text/html' && !html) html = text
    }
    if (Array.isArray(p.parts)) p.parts.forEach(walk)
  }
  walk(payload)
  return { plain, html }
}

function getHeader(payload, name) {
  const h = payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

// List the agent's drafts. Each returned entry: { id, subject, body }
// maxResults caps at 50 to keep the fan-out reasonable.
export async function listGmailDrafts({ maxResults = 25 } = {}) {
  let token = readToken()
  if (!token) token = await silentRefresh()
  if (!token) return { ok: false, error: 'Gmail not connected', drafts: [] }

  const auth = { 'Authorization': `Bearer ${token.access_token}` }
  try {
    const listRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/drafts?maxResults=${maxResults}`,
      { headers: auth }
    )
    if (listRes.status === 401) {
      const fresh = await silentRefresh()
      if (fresh) return listGmailDrafts({ maxResults })
      return { ok: false, error: 'Connection expired — reconnect Gmail.', drafts: [] }
    }
    if (listRes.status === 403) {
      // Two common 403 causes: API not enabled in the Google Cloud project,
      // OR the user authorized with an older narrower scope. Differentiate
      // by looking at the response body — SERVICE_DISABLED means the API
      // itself isn't turned on for the project, NOT a token issue.
      const txt = await listRes.text().catch(() => '')
      if (/SERVICE_DISABLED|accessNotConfigured|gmail\.googleapis\.com/i.test(txt)) {
        return {
          ok: false,
          error: 'Gmail API is disabled for your Google Cloud project. Admin: enable it at console.developers.google.com → APIs & Services → Enable APIs → Gmail API, then retry.',
          drafts: [],
        }
      }
      return { ok: false, error: 'Reconnect Gmail to grant read access for templates.', drafts: [] }
    }
    if (!listRes.ok) {
      const txt = await listRes.text().catch(() => '')
      return { ok: false, error: `Drafts API error (${listRes.status}): ${txt.slice(0, 160)}`, drafts: [] }
    }
    const { drafts: ids = [] } = await listRes.json()
    if (!ids.length) return { ok: true, drafts: [] }
    // Fetch each draft in parallel — Gmail allows ~20 concurrent reads fine
    const fetched = await Promise.all(ids.map(async ({ id }) => {
      try {
        const r = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/drafts/${id}?format=full`,
          { headers: auth }
        )
        if (!r.ok) return null
        const j = await r.json()
        const payload = j?.message?.payload
        const subject = getHeader(payload, 'Subject') || '(no subject)'
        const { plain, html } = extractBodyParts(payload)
        return { id, subject, body: plain, html }
      } catch { return null }
    }))
    const drafts = fetched.filter(Boolean)
    // Sort: drafts with subjects first, alphabetically
    drafts.sort((a, b) => a.subject.localeCompare(b.subject))
    return { ok: true, drafts }
  } catch (e) {
    return { ok: false, error: e?.message || 'Network error', drafts: [] }
  }
}

// ── Send a message ────────────────────────────────────────────────────────
// Returns { ok, error?, messageId? }
//   to        — recipient email address
//   subject   — plain string
//   body      — plain text body
//   html      — optional HTML body. If provided, message is sent as
//               multipart/alternative with both representations so the
//               recipient sees the rich HTML AND fallback clients see plain.
//   fromName  — optional "Display Name <email>" or just a display name
export async function sendGmailMessage({ to, subject, body, html, fromName }) {
  if (!to || !subject) return { ok: false, error: 'Recipient and subject are required.' }
  if (!body && !html)  return { ok: false, error: 'Message body is empty.' }

  let token = readToken()
  if (!token) token = await silentRefresh()
  if (!token && !isGmailConnected()) {
    return { ok: false, error: 'Gmail not connected — connect in Settings first.' }
  }
  if (!token) {
    return { ok: false, error: 'Token refresh failed — open Settings and click Connect to re-authorize.' }
  }

  const raw = toBase64Url(rfc2822({ to, subject, body, html, fromName }))
  const send = async (tok) => fetch(
    'https://www.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    }
  )

  try {
    let res = await send(token)
    if (res.status === 401) {
      // Token expired between read and send — try one silent refresh + retry.
      const fresh = await silentRefresh()
      if (fresh) res = await send(fresh)
      if (res.status === 401) {
        clearGmailToken()
        return { ok: false, error: 'Connection expired — reconnect Gmail in Settings.' }
      }
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      // SERVICE_DISABLED — Gmail API not enabled on the Google Cloud project
      if (res.status === 403 && /SERVICE_DISABLED|accessNotConfigured/i.test(txt)) {
        return { ok: false, error: 'Gmail API is disabled for your Google Cloud project. Admin: enable it at console.developers.google.com → APIs & Services → Enable APIs → Gmail API, then retry.' }
      }
      // Insufficient scope — user authorized with a narrower scope earlier
      if (res.status === 403 && /scope/i.test(txt)) {
        return { ok: false, error: 'Gmail send permission missing — reconnect Gmail in Settings.' }
      }
      return { ok: false, error: `Gmail API error (${res.status}): ${txt.slice(0, 160)}` }
    }
    const data = await res.json().catch(() => ({}))
    return { ok: true, messageId: data.id || null, threadId: data.threadId || null }
  } catch (e) {
    return { ok: false, error: e?.message || 'Network error' }
  }
}
