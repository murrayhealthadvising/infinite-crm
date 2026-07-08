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
// "Connected" flag is separate from the access token — it survives token
// expiry so we can still consider the user connected and silently re-issue.
const CONNECTED_KEY = 'infinite_crm_gcal_connected'

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
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
    localStorage.setItem(CONNECTED_KEY, '1')
  } catch {}
}
export function clearGcalToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(CONNECTED_KEY)
  } catch {}
}
// "Connected" stays true even after the access token expires — we'll silently
// refresh on next API call. Only an explicit Disconnect (or repeated refresh
// failure) flips this back to false.
export function isGcalConnected() {
  try { return localStorage.getItem(CONNECTED_KEY) === '1' } catch { return false }
}

// ── Proactive refresh timer ────────────────────────────────────────────────
// Once the user is connected, we refresh the token every ~50 min so it never
// silently goes stale between use. The refresh is silent (prompt:'') and only
// works if the user is still signed into Google in this browser — which is
// the case 99% of the time.
let _refreshTimer = null
function scheduleRefresh() {
  if (_refreshTimer) clearTimeout(_refreshTimer)
  _refreshTimer = setTimeout(async () => {
    if (!isGcalConnected()) return
    const t = await silentRefresh()
    if (t) scheduleRefresh()
    // If refresh failed silently, leave _connected=true so the next user
    // action triggers a visible re-prompt instead of a surprise disconnect.
  }, 50 * 60 * 1000)  // 50 min — well inside the 1hr Google token lifetime
}
if (typeof window !== 'undefined') {
  // Kick off the refresh loop on page load if user is already connected
  window.addEventListener('load', () => { if (isGcalConnected()) scheduleRefresh() })
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
        scheduleRefresh()  // start the auto-refresh loop
        resolve(token)
      },
      error_callback: (err) => reject(new Error(err?.message || 'OAuth flow failed')),
    })
    client.requestAccessToken({ prompt: 'consent' })
  })
}

// Silent token refresh — tries to get a new token without prompting. Used
// just before creating an event when the cached token has expired AND by
// the 50-min auto-refresh timer to keep the connection warm.
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

// ── Create an event on the user's primary calendar ─────────────────────────
// Returns { ok: true, htmlLink } on success, { ok: false, error, fallbackUrl }
// on failure (so the caller can show the URL link as a backup).
export async function createCalendarEvent({ title, startsAt, durationMinutes = 15, details = '', location = '' }) {
  if (!title || !startsAt) return { ok: false, error: 'title and startsAt required' }
  const start = new Date(startsAt)
  if (isNaN(start.getTime())) return { ok: false, error: 'invalid startsAt' }
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
  const fallbackUrl = googleCalendarUrl({ title, startsAt, durationMinutes, details, location })

  // Try cached → silent refresh. If both fail and the user was "connected",
  // still don't wipe the connected flag here; let the API call try anyway and
  // we'll handle 401 with one retry below.
  let token = readToken()
  if (!token) token = await silentRefresh()
  if (!token && !isGcalConnected()) {
    return { ok: false, error: 'Not connected — connect Google Calendar in Settings', fallbackUrl }
  }
  if (!token) {
    // Connected flag was true but no token — silent refresh failed. Tell the
    // caller it expired but keep the connected flag so the next call retries.
    return { ok: false, error: 'Token refresh failed — open Settings and click Connect to re-authorize.', fallbackUrl }
  }

  const body = {
    summary: title,
    description: details,
    location,
    start: { dateTime: start.toISOString() },
    end:   { dateTime: end.toISOString() },
    reminders: { useDefault: true },
  }

  const post = async (tok) => fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  try {
    let res = await post(token)
    if (res.status === 401) {
      // Token rejected — try ONE silent refresh and retry. Only wipe on second failure.
      const fresh = await silentRefresh()
      if (fresh) {
        res = await post(fresh)
      }
      if (res.status === 401) {
        clearGcalToken()
        return { ok: false, error: 'Connection expired — reconnect Google Calendar in Settings.', fallbackUrl }
      }
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

// ── List events from the user's primary calendar ──────────────────────────
// Used by the Today page to overlay real Google Calendar events on the
// month/week grid so agents can see their existing commitments alongside
// CRM reminders. Same OAuth scope we already have (calendar.events) allows
// events.list on primary — no additional consent prompt needed.
//
// Returns { ok, events } where events is an array of:
//   { id, summary, startAt, endAt, allDay, htmlLink, location }
// Silently returns { ok: false, events: [] } if the user isn't connected
// (caller can hide the toggle in that case).
export async function listGoogleEvents({ timeMin, timeMax }) {
  if (!timeMin || !timeMax) return { ok: false, events: [], error: 'timeMin and timeMax required' }

  let token = readToken()
  if (!token) token = await silentRefresh()
  if (!token) return { ok: false, events: [], error: 'Not connected' }

  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
  url.searchParams.set('timeMin', new Date(timeMin).toISOString())
  url.searchParams.set('timeMax', new Date(timeMax).toISOString())
  // singleEvents expands recurring events into instances so we can plot each
  // occurrence separately. orderBy=startTime lets us render in chronological
  // order without a client-side sort.
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('maxResults', '250')

  const get = async (tok) => fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${tok.access_token}` },
  })

  try {
    let res = await get(token)
    if (res.status === 401) {
      const fresh = await silentRefresh()
      if (fresh) res = await get(fresh)
      if (res.status === 401) {
        clearGcalToken()
        return { ok: false, events: [], error: 'Connection expired' }
      }
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { ok: false, events: [], error: `Calendar API error (${res.status}): ${txt.slice(0, 120)}` }
    }
    const data = await res.json()
    // Normalize into a shape Today.jsx can render without knowing about the
    // Google event schema. All-day events use date; timed events use dateTime.
    const events = (Array.isArray(data.items) ? data.items : []).map(e => {
      const allDay = !!(e.start?.date && !e.start?.dateTime)
      const startAt = e.start?.dateTime || e.start?.date || null
      const endAt   = e.end?.dateTime   || e.end?.date   || null
      return {
        id: e.id,
        summary: e.summary || '(no title)',
        startAt, endAt, allDay,
        htmlLink: e.htmlLink || '',
        location: e.location || '',
      }
    }).filter(e => e.startAt)
    return { ok: true, events }
  } catch (e) {
    return { ok: false, events: [], error: e?.message || 'Network error' }
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
