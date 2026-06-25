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
// Gmail API wants the raw RFC 2822 message base64url-encoded. We construct
// a minimal text/plain message — no attachments, no HTML, no MIME parts.
// Headers we set: To, Subject, From (optional name), Date, MIME-Version,
// Content-Type. Body is the plain text the agent typed.
function rfc2822({ to, subject, body, fromName }) {
  const lines = []
  lines.push('MIME-Version: 1.0')
  lines.push('Content-Type: text/plain; charset=utf-8')
  lines.push('Content-Transfer-Encoding: 7bit')
  if (fromName) lines.push(`From: ${fromName}`)
  lines.push(`To: ${to}`)
  lines.push(`Subject: ${encodeHeader(subject || '')}`)
  lines.push(`Date: ${new Date().toUTCString()}`)
  lines.push('')
  lines.push(String(body || '').replace(/\r?\n/g, '\r\n'))
  return lines.join('\r\n')
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

// Recursively walk a Gmail message payload to find the best text body.
// Prefers text/plain, falls back to text/html stripped to text.
function extractTextBody(payload) {
  if (!payload) return ''
  // Direct body
  if (payload.body?.data) {
    const text = decodeBase64Url(payload.body.data)
    if (payload.mimeType === 'text/html') return stripHtmlToText(text)
    return text
  }
  // Multipart — prefer text/plain, then text/html, then recurse
  if (Array.isArray(payload.parts)) {
    const plain = payload.parts.find(p => p.mimeType === 'text/plain' && p.body?.data)
    if (plain) return decodeBase64Url(plain.body.data)
    const html = payload.parts.find(p => p.mimeType === 'text/html' && p.body?.data)
    if (html) return stripHtmlToText(decodeBase64Url(html.body.data))
    for (const part of payload.parts) {
      const inner = extractTextBody(part)
      if (inner) return inner
    }
  }
  return ''
}

function stripHtmlToText(html) {
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
        const body = extractTextBody(payload)
        return { id, subject, body }
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
//   body      — plain text body (no HTML)
//   fromName  — optional "Display Name <email>" or just a display name
export async function sendGmailMessage({ to, subject, body, fromName }) {
  if (!to || !subject) return { ok: false, error: 'Recipient and subject are required.' }

  let token = readToken()
  if (!token) token = await silentRefresh()
  if (!token && !isGmailConnected()) {
    return { ok: false, error: 'Gmail not connected — connect in Settings first.' }
  }
  if (!token) {
    return { ok: false, error: 'Token refresh failed — open Settings and click Connect to re-authorize.' }
  }

  const raw = toBase64Url(rfc2822({ to, subject, body, fromName }))
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
