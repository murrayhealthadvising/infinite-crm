// Google Calendar integration — TWO paths:
//
// 1) DIRECT (preferred): if the user has connected their Google Calendar via
//    OAuth, we POST events straight to the Calendar API. The event appears on
//    their calendar instantly with no popup.
//
// 2) FALLBACK URL: if they haven't connected (or the token expired), we hand
//    back a pre-filled "create event" URL that the user can open in a new tab.
//
// We use Google Identity Services (GIS) "token client" — the script lives at
// https://accounts.google.com/gsi/client (loaded from index.html). Tokens are
// access-token only, ~1 hr lifetime, no refresh token. We cache the token in
// localStorage with an expiry; once expired the next call silently re-prompts.

const SCOPES = 'https://www.googleapis.com/auth/calendar.events'
const TOKEN_KEY = 'infinite_crm_gcal_token'

// ── Token cache (localStorage) ─────────────────────────────────────────────
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
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(token)) } catch {}
}
export function clearGcalToken() {
  try { localStorage.removeItem(TOKEN_KEY) } catch {}
}
export function isGcalConnected() {
  return !!readToken()
}

// ── Client ID lookup ───────────────────────────────────────────────────────
// Reads from VITE_GOOGLE_CLIENT_ID (set in Vercel env). If missing, OAuth
// can't run and we'll always fall back to the URL template.
export function getGoogleClientId() {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
}

// ── Connect: prompt the user to grant calendar access ──────────────────────
// Resolves with the access token on success. Caches it for ~55 minutes.
export function connectGoogleCalendar() {
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
        resolve(token)
      },
      error_callback: (err) => reject(new Error(err?.message || 'OAuth flow failed')),
    })
    client.requestAccessToken({ prompt: 'consent' })
  })
}

// Silent token refresh — tries to get a new token without prompting. Used
// just before creating an event when the cached token has expired.
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
          resolve(token)
        },
        error_callback: () => resolve(null),
      })
      client.requestAccessToken({ prompt: '' })
    } catch { resolve(null) }
  })
}

// ── Create an event on the user's primary calendar ─────────────────────────
// Returns { ok: true, htmlLink } on success, { ok: false, error, fallbackUrl }
// on failure (so the caller can show the URL link as a backup).
export async function createCalendarEvent({ title, startsAt, durationMinutes = 15, details = '', location = '' }) {
  if (!title || !startsAt) return { ok: false, error: 'title and startsAt required' }
  const start = new Date(startsAt)
  if (isNaN(start.getTime())) return { ok: false, error: 'invalid startsAt' }
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
  const fallbackUrl = googleCalendarUrl({ title, startsAt, durationMinutes, details, location })

  let token = readToken()
  if (!token) token = await silentRefresh()
  if (!token) return { ok: false, error: 'Not connected — connect Google Calendar in Settings', fallbackUrl }

  const body = {
    summary: title,
    description: details,
    location,
    start: { dateTime: start.toISOString() },
    end:   { dateTime: end.toISOString() },
    reminders: { useDefault: true },
  }

  try {
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )
    if (res.status === 401) {
      clearGcalToken()
      return { ok: false, error: 'Connection expired — reconnect Google Calendar', fallbackUrl }
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { ok: false, error: `Calendar API error (${res.status}): ${txt.slice(0, 120)}`, fallbackUrl }
    }
    const data = await res.json()
    return { ok: true, htmlLink: data.htmlLink, eventId: data.id }
  } catch (e) {
    return { ok: false, error: e?.message || 'Network error', fallbackUrl }
  }
}

// ── URL fallback (kept for offline / no-OAuth scenarios) ───────────────────
function pad(n) { return String(n).padStart(2, '0') }
function toGCalDate(d) {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  )
}
export function googleCalendarUrl({ title, startsAt, durationMinutes = 15, details = '', location = '' }) {
  if (!title || !startsAt) return null
  const start = new Date(startsAt)
  if (isNaN(start.getTime())) return null
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toGCalDate(start)}/${toGCalDate(end)}`,
    details,
    location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
