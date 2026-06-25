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

const SCOPES = 'https://www.googleapis.com/auth/gmail.send'
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
      // 403 insufficient_scope → user authorized Calendar previously and
      // doesn't have the gmail.send grant. Tell them to reconnect.
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
