// Infinite CRM Email Worker — v4.17 (content-sniff finalCleanup — fixes HTML/QP single-part emails from new USHA)
//
// Deploys via the Cloudflare Workers REST API with NO bundler — every helper
// inlined here. Handles two paths:
//   1. fetch() : HTTP POST /leads?agent_id=UUID  (existing test/HTTP integration path)
//   2. email() : USHA Marketplace lead emails forwarded to {agent}-leads@infinite-crm.net
//                Parses 30+ fields from the email body and inserts into Supabase.
//
// Why this exists:
//   v3-debug only parsed ~9 fields. DOB, income, household, age, age_range,
//   gender, smoker, comments etc. were silently dropped. v4 captures them all.
//
// v4.7+: brand-new leads enroll into a per-agent PitchPrfct workflow — each
//   agent's own API key + keyword→workflow rules, looked up by lead owner.
// v4.8: optional delay — the lead is parked in pitchprfct_queue and a cron
//   trigger enrolls it once the timer runs out, unless the agent cancels.

const AGENT_ROUTING = {
  'murray-leads@infinite-crm.net':   '01ef1bd7-f5d1-4279-bf9b-15a02eec5f4a',
  'anthony-leads@infinite-crm.net':  '2b3fe8bf-e932-4672-be4e-5a998c223fdd',
  'palma-leads@infinite-crm.net':    '3c1b5bcc-1682-46c1-9298-5c0667bfc9bb',
  'dylan-leads@infinite-crm.net':    'f262eda2-f2bd-421e-bffa-4c7ea0b668db',
  'katerina-leads@infinite-crm.net': '2e01afc5-5afe-48f6-b618-3b94afe0f5fc',
  'andres-leads@infinite-crm.net':   '76faad76-bb01-4722-aa7b-5cae665cdb57',
  'doug-leads@infinite-crm.net':     'e396e3fa-16d7-4948-bb19-23ba73cc82c4',
  'felipe-leads@infinite-crm.net':   'd93a21e9-340b-4023-b758-ff3d9d6644a3',
  'skyler-leads@infinite-crm.net':   '341af7c4-fc71-435f-9458-2be692323ad9',
}

const DEFAULT_STAGE = 'not-started'

// ─── Tiny MIME helpers (no postal-mime) ───────────────────────────────────
async function streamToString(stream) {
  const reader = stream.getReader()
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  let total = 0
  for (const c of chunks) total += c.length
  const flat = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { flat.set(c, o); o += c.length }
  return new TextDecoder('utf-8').decode(flat)
}

function decodeQuotedPrintable(s) {
  return s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

// Strip HTML tags + leftover quoted-printable artifacts. Safety net used both
// when finalizing the extracted body AND on each individual captured field.
//
// v4.12 hardening: the new "Dynasty" marketplace template sends HTML where
// label/value pairs live in <tr><td>Label:</td><td>Value</td></tr> rows with
// no <br>. The old stripping ran them all together into one giant line and
// only the first "Name:" managed to match (anchored at start of string).
// Insert newlines for closing block tags so each row ends on its own line.
function stripHtmlAndQp(s) {
  if (!s) return ''
  return String(s)
    // QP soft line breaks
    .replace(/=\r?\n/g, '')
    // QP hex sequences (=3D → =, =20 → space, etc.)
    .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // Drop <style>/<script> blocks entirely (their contents are not text)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Convert <br> to newline
    .replace(/<br\s*\/?>/gi, '\n')
    // Closing ROW-level tags produce a newline so each row ends up on its
    // own line. Crucial for marketplace emails that ship as
    //   <tr><td>Label:</td><td>Value</td></tr>
    // Note: </td> intentionally does NOT trigger a newline — we want the
    // label and its value to stay on the SAME line so the parseLead regex
    // (which captures everything after the colon up to the next \n) can grab
    // the value. Only the row-boundary tags get \n.
    .replace(/<\/(?:tr|p|div|li|table|thead|tbody|tfoot|h[1-6]|article|section|header|footer|nav)\s*>/gi, '\n')
    // Strip every remaining tag
    .replace(/<[^>]*>?/g, '')
    // Common HTML entities seen in marketplace emails
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    // Collapse triple+ newlines to double — keeps the body readable for the
    // regex anchors without losing label/value pair separation.
    .replace(/\n{3,}/g, '\n\n')
}

// Note: an earlier rev had a normalizeLabelLines() helper that inserted \n
// before known USHA labels mid-line. It was buggy for substring-overlapping
// labels (matched "Name" inside "First Name" and broke it into two lines).
// We now rely entirely on stripHtmlAndQp's improved block-tag-to-\n handling
// to give us proper line breaks. If a future marketplace ships a format we
// can't parse, the new debug log line in email() prints the first 600 chars
// of the body so we can diagnose without guessing.

// Content-sniff final cleanup. v4.17 fix: the new USHA marketplace ships
// emails as single-part HTML with QP encoding, but Cloudflare's added ARC/DKIM
// headers push the original Content-Type/Content-Transfer-Encoding past where
// our outer-header regex looks, so QP-decode + HTML-strip silently skipped.
// Solution: always re-check the body content itself — if it LOOKS QP, decode;
// if it LOOKS HTML, strip. Header-independent, defensive.
function finalCleanup(body) {
  if (!body) return ''
  // QP heuristic: any =HH hex pair or =\n soft line break
  if (/=[0-9A-F]{2}/i.test(body) || /=\r?\n/.test(body)) {
    body = decodeQuotedPrintable(body)
  }
  // HTML heuristic: any opening or closing tag for common email-template tags
  if (/<\/?(html|head|body|div|p|table|tr|td|span|br|h[1-6]|a|ul|ol|li|strong|b|i|em)\b/i.test(body)) {
    body = stripHtmlAndQp(body)
  }
  return body
}

// Find the text/plain (preferred) or text/html part of a MIME message.
// Returns the decoded body (plain text). Handles NESTED multipart by recursing
// into any multipart/* child part — necessary for USHA Lead Arena emails that
// ship multipart/mixed → multipart/alternative → html.
function extractBody(raw) {
  const headerEnd = raw.indexOf('\r\n\r\n')
  if (headerEnd < 0) return finalCleanup(raw)
  const headers = raw.slice(0, headerEnd)
  let body = raw.slice(headerEnd + 4)

  const ctMatch = headers.match(/content-type:\s*([^\r\n;]+)(;\s*boundary="?([^"\r\n]+)"?)?/i)
  const contentType = ctMatch ? ctMatch[1].trim().toLowerCase() : 'text/plain'
  const boundary = ctMatch && ctMatch[3]

  if (boundary && contentType.startsWith('multipart/')) {
    console.log('[extractBody] multipart detected, boundary:', boundary, 'contentType:', contentType)
    const parts = body.split('--' + boundary)
    console.log('[extractBody] parts count:', parts.length)
    let plain = '', html = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const pHeaderEnd = part.indexOf('\r\n\r\n')
      if (pHeaderEnd < 0) {
        console.log('[extractBody] part', i, 'has no \\r\\n\\r\\n — skipping (len', part.length, ')')
        continue
      }
      const pHeadersRaw = part.slice(0, pHeaderEnd)
      const pHeaders = pHeadersRaw.toLowerCase()
      let pBody = part.slice(pHeaderEnd + 4)
      const cte = (pHeaders.match(/content-transfer-encoding:\s*([^\r\n]+)/) || [])[1] || ''
      console.log('[extractBody] part', i, 'headers:', pHeadersRaw.slice(0, 200).replace(/\r/g, '\\r').replace(/\n/g, '\\n'), '| cte:', cte, '| bodyLen:', pBody.length)
      // Recurse into nested multipart
      if (pHeaders.match(/content-type:\s*multipart\//)) {
        const inner = extractBody(part)
        if (inner) plain += inner + '\n'
        continue
      }
      if (cte.includes('quoted-printable')) pBody = decodeQuotedPrintable(pBody)
      else if (cte.includes('base64')) {
        try { pBody = atob(pBody.replace(/\s+/g, '')) } catch {}
      }
      if (pHeaders.includes('text/plain')) {
        plain += pBody + '\n'
        console.log('[extractBody] part', i, '→ PLAIN (+' + pBody.length + ' chars)')
      } else if (pHeaders.includes('text/html')) {
        html += pBody + '\n'
        console.log('[extractBody] part', i, '→ HTML (+' + pBody.length + ' chars)')
      } else {
        console.log('[extractBody] part', i, '→ UNCLASSIFIED, no text/plain or text/html in headers')
      }
    }
    console.log('[extractBody] decision: plain=' + plain.length + ' chars, html=' + html.length + ' chars')
    // Run final content-sniff cleanup on every return path so QP/HTML get
    // handled regardless of whether the headers correctly declared them.
    if (plain) return finalCleanup(plain)
    if (html) return finalCleanup(html)
    return finalCleanup(body)
  }

  // Single-part
  const cte = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i) || [])[1] || ''
  if (cte.toLowerCase().includes('quoted-printable')) body = decodeQuotedPrintable(body)
  else if (cte.toLowerCase().includes('base64')) {
    try { body = atob(body.replace(/\s+/g, '')) } catch {}
  }
  return finalCleanup(body)
}

// ─── Field extraction from a normalized text body ──────────────────────────
function fieldGetter(text) {
  return (label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // CRITICAL: only match horizontal whitespace ([ \t]) around label/colon —
    // never newlines. Otherwise an empty field like 'Zip:\n' captures the
    // next label's text, e.g. 'Business Name:'. \s would match newlines.
    const re = new RegExp('(?:^|\\n)[ \\t]*' + escaped + '[ \\t]*:[ \\t]*([^\\n\\r]+)', 'i')
    const m = text.match(re)
    if (!m) return ''
    // Safety net: clean any QP/HTML residue out of the captured value before
    // we trust it. Helps when the upstream MIME parsing missed something
    // (e.g. a nested multipart or unflagged QP-encoded HTML chunk).
    let v = stripHtmlAndQp(m[1]).trim()
    if (!v) return ''
    // Defensive: if the value happens to look exactly like another USHA label
    // (e.g. 'DOB:' or 'Business Name:'), treat it as empty rather than store
    // the leaked label as the value.
    if (/^[A-Za-z][A-Za-z ]*:$/.test(v)) return ''
    return v.replace(/\s+/g, ' ')
  }
}

function parseMoneyToInt(s) {
  if (!s) return null
  const str = String(s).trim()
  // Range like "$50,000 - $75,000" — take the lower bound (income is an INT column)
  if (/[-–~]/.test(str)) {
    const m = str.match(/\$?([0-9,]+)/)
    if (m) { const n = parseInt(m[1].replace(/,/g, '')); return isFinite(n) && n > 0 ? n : null }
    return null
  }
  const n = parseInt(str.replace(/[^0-9.]/g, ''))
  return isFinite(n) && n > 0 ? n : null
}

// Coerce a possibly-string value into an integer, or null. For numeric DB columns.
function toIntOrNull(s) {
  if (s === null || s === undefined || s === '') return null
  const m = String(s).match(/-?\d+/)
  if (!m) return null
  const n = parseInt(m[0])
  return isFinite(n) ? n : null
}

function parseHousehold(s) {
  if (!s) return null
  const str = String(s).trim().toLowerCase()
  if (!str) return null
  const n = parseInt(str)
  if (isFinite(n) && n > 0) return n
  if (str === 'individual') return 1
  if (str === 'couple') return 2
  return null
}

function parseLead(body) {
  const get = fieldGetter(body)
  const lead = {
    campaign:    get('Name'),
    price:       parseMoneyToInt(get('Price')),
    external_id: get('Lead Id') || get('agentID'),

    first_name: get('First Name'),
    last_name:  get('Last Name'),
    phone:      get('Primary Phone') || get('Phone'),
    email:      get('Email'),
    address:    get('Address'),
    city:       get('City'),
    state:      get('State'),
    zip:        get('Zip'),

    gender:        get('Gender'),
    dob:           get('Date of Birth') || get('DOB'),
    age:           get('Age'),
    age_range:     get('Age Range'),
    income:        get('Income'),  // TEXT column — preserve range strings verbatim
    household:     parseHousehold(get('Household')),
    smoker:        get('Smoker'),
    spouse_age:    get('Spouse Age'),
    num_children:  get('Number Of Children'),

    current_carrier:   get('Current Carrier'),
    best_contact_time: get('Best Contact Time'),

    comments:        get('Comments'),
    plan_choice:     get('Plan Choice'),
    monthly_budget:  get('Monthly Budget'),
    effective_date:  get('Prefered Start Date') || get('Preferred Start Date'),
  }

  if (lead.phone) {
    const digits = String(lead.phone).replace(/\D/g, '')
    if (digits.length === 10) lead.phone = '+1' + digits
    else if (digits.length === 11 && digits[0] === '1') lead.phone = '+' + digits
    else lead.phone = digits || ''
  }

  // Strip empty values so they go in as NULL not ''
  for (const k of Object.keys(lead)) {
    if (lead[k] === '' || lead[k] === undefined) delete lead[k]
  }
  return lead
}

// ─── Supabase calls ────────────────────────────────────────────────────────
async function logErr(env, source, recipient, msg, extra = {}) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/lead_import_errors`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([{ source, recipient, error_message: msg, payload: JSON.stringify(extra).slice(0, 4000) }]),
    })
  } catch {}
}

async function insertLead(env, lead) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify([lead]),
  })
  const text = await resp.text()
  return { ok: resp.ok, status: resp.status, body: text }
}

// Bump last_activity on an existing lead (used when a duplicate USHA email
// arrives — the lead is already in the CRM, but we want to surface that the
// marketplace re-sent it so the agent sees it move to the top of "recent").
async function touchLeadByPhone(env, userId, phone) {
  const url = `${env.SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(userId)}&phone=eq.${encodeURIComponent(phone)}`
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({ last_activity: new Date().toISOString() }),
  })
  return { ok: resp.ok, status: resp.status }
}

// Detect Postgres unique-violation in PostgREST's JSON error body
function isDuplicate(result) {
  if (result.status !== 409) return false
  try { return JSON.parse(result.body)?.code === '23505' } catch { return false }
}

// CORS headers — needed because the PitchPerfect bookmarklet runs from
// app.pitchprfct.com (or wherever) and posts to this worker. Wide open since
// the worker validates agent_id and is otherwise read-only.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

// Columns the worker is allowed to forward to Supabase. Anything else gets
// silently dropped (prevents PGRST204 schema-cache errors when the bookmarklet
// sends odd fields).
const LEADS_COLUMNS = new Set([
  'first_name','last_name','phone','email','city','state','zip','address','street_address',
  'source','notes','notes_b','comments','dob','gender','age','age_range','smoker','spouse_age','num_children',
  'income','household','external_id','agent','agent_id','campaign','price',
  'premium','carrier','current_carrier','effective_date','plan_choice','monthly_budget','best_contact_time',
  'tags','stage','is_sold','user_id','created_at','last_activity',
  'runner','stage_changed_at','custom_fields',
])

function sanitizeForInsert(lead) {
  const out = {}
  for (const [k, v] of Object.entries(lead)) {
    if (LEADS_COLUMNS.has(k) && v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}

// Coerce a phone in any common shape — "(717) 623-0690", "7176230690",
// "+17176230690", "1-717-623-0690" — into E.164 +1XXXXXXXXXX. Returns null
// for anything that doesn't look like a US phone. Older leads in the DB were
// stored before parseLead's normalization ran, so we tolerate them at the
// enroll boundary rather than gate-rejecting them.
function coercePhoneE164(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits[0] === '1') return '+' + digits
  // Already in +1XXXXXXXXXX shape and the original had a leading +
  if (String(raw).trim().startsWith('+') && digits.length >= 10) return '+' + digits
  return null
}

// ─── US state → IANA TZ map (inlined; mirrors src/lib/timezone.js) ─────────
// Worker is zero-dep so we duplicate this rather than import. Keep in sync if
// the frontend mapping ever changes. Used by the 9am–9pm "respect their TZ"
// gate so we never enroll a lead into a workflow that texts them at 3am.
const WORKER_STATE_TZ = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver',
}
function workerZipOverride(zip) {
  if (!zip) return null
  const z = String(zip).trim().slice(0, 3)
  if (z === '324' || z === '325') return 'America/Chicago'
  if (z === '798' || z === '799') return 'America/Denver'
  if (z === '979') return 'America/Denver'
  if (z === '838') return 'America/Los_Angeles'
  if (z === '376' || z === '377' || z === '378') return 'America/New_York'
  if (z === '420' || z === '421' || z === '422') return 'America/Chicago'
  return null
}
function timezoneForLead(lead) {
  if (!lead) return null
  const zo = workerZipOverride(lead.zip)
  if (zo) return zo
  const st = String(lead.state || '').trim().toUpperCase()
  return WORKER_STATE_TZ[st] || null
}
// How many minutes the TZ is offset from UTC at a given instant. Positive for
// east of UTC; negative (e.g. -240 for EDT) for the Americas.
function tzOffsetMinutes(tz, when) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(when)
    const get = (t) => parseInt(parts.find(p => p.type === t)?.value || '0', 10)
    const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
    return Math.round((localAsUtc - when.getTime()) / 60000)
  } catch { return 0 }
}
// Returns the ISO timestamp the queue row should fire at: `base` if the lead's
// local clock is in the 9am-9pm window, otherwise the next 9am in their TZ.
// Falls back to `base` for leads whose TZ we can't infer (no state/zip).
const PP_WINDOW_START_HOUR = 9   // 9 AM
const PP_WINDOW_END_HOUR   = 21  // 9 PM (exclusive)
function nextOkEnrollIso(lead, base = new Date()) {
  const tz = timezoneForLead(lead)
  if (!tz) return base.toISOString()
  let localHour
  try {
    localHour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(base), 10)
  } catch { return base.toISOString() }
  if (!isFinite(localHour)) return base.toISOString()
  if (localHour >= PP_WINDOW_START_HOUR && localHour < PP_WINDOW_END_HOUR) {
    return base.toISOString()
  }
  // Build the next 9am in local TZ then convert back to UTC.
  const offsetMin = tzOffsetMinutes(tz, base)
  const localNowMs = base.getTime() + offsetMin * 60000
  const d = new Date(localNowMs)
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate()
  // If we're past 9pm, target tomorrow's 9am. Otherwise (before 9am) target today's.
  const dayShift = localHour >= PP_WINDOW_END_HOUR ? 1 : 0
  const targetLocalMs = Date.UTC(y, m, day + dayShift, PP_WINDOW_START_HOUR, 0, 0)
  const targetUtcMs = targetLocalMs - offsetMin * 60000
  return new Date(targetUtcMs).toISOString()
}

// Write an activity row to Supabase so the agent sees confirmation of an
// auto-enroll in the lead's Action Log. Best-effort: failures here just log.
async function logEnrollActivity(env, userId, leadId, workflowName) {
  try {
    const row = {
      lead_id: leadId,
      user_id: userId,
      type: 'note',
      note: `Auto-enrolled in PitchPrfct workflow: ${workflowName || '(unnamed)'}`,
      created_at: new Date().toISOString(),
    }
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/activities`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify([row]),
    })
    if (!r.ok) console.error('[pp] logEnrollActivity failed', r.status, (await r.text()).slice(0, 200))
  } catch (e) { console.error('[pp] logEnrollActivity threw', String(e)) }
}

// ─── PitchPrfct workflow enrollment (per-agent) ────────────────────────────
// The moment a brand-new lead is inserted, push it into PitchPrfct as a contact
// and enroll that contact in a workflow — PitchPrfct then runs whatever the
// workflow does (texts, calls, drips). No Make.com.
//
// Everything is PER-AGENT — each agent has their own PitchPrfct account:
//   • their API key lives in the pitchprfct_keys table (one row per user_id),
//     entered by the agent in CRM Settings → "PitchPrfct Automation"
//   • their keyword→workflow rules live on their profile (pitchprfct_rules)
// Both are looked up by the lead's owning agent, so each agent's leads enroll
// into THAT agent's workflows using THAT agent's key. An agent with no key, or
// no rules, is simply skipped.
const PITCHPRFCT_API = 'https://app.pitchprfct.com/api/v1'

// Pull the agent's keyword→workflow rules off their profile row. Shape:
//   { rules: [{ keyword, workflowId, workflowName }],
//     defaultWorkflowId, defaultWorkflowName }
async function getProfileRules(env, userId) {
  try {
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=pitchprfct_rules`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    )
    if (!r.ok) { console.error('[pp] getProfileRules HTTP', r.status); return null }
    const rows = await r.json()
    return (Array.isArray(rows) && rows[0] && rows[0].pitchprfct_rules) || null
  } catch (e) { console.error('[pp] getProfileRules threw', String(e)); return null }
}

// Pull the agent's own PitchPrfct API key from the pitchprfct_keys table. Read
// with the service role so row-level security doesn't block the lookup.
async function getAgentApiKey(env, userId) {
  try {
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/pitchprfct_keys?user_id=eq.${encodeURIComponent(userId)}&select=api_key`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    )
    if (!r.ok) { console.error('[pp] getAgentApiKey HTTP', r.status); return null }
    const rows = await r.json()
    const key = Array.isArray(rows) && rows[0] && rows[0].api_key
    return (key && String(key).trim()) || null
  } catch (e) { console.error('[pp] getAgentApiKey threw', String(e)); return null }
}

// Decide the workflow ID by scanning the lead's marketplace comments for the
// agent's keywords. First rule that matches wins; otherwise the default.
function pickWorkflowId(rules, lead) {
  const hay = String(lead.comments || '').toLowerCase()
  const list = Array.isArray(rules && rules.rules) ? rules.rules : []
  for (const rule of list) {
    const kw = String((rule && rule.keyword) || '').trim().toLowerCase()
    if (kw && rule.workflowId && hay.includes(kw)) {
      return { id: rule.workflowId, name: rule.workflowName || '', why: `comments matched "${rule.keyword}"` }
    }
  }
  if (rules && rules.defaultWorkflowId) {
    return { id: rules.defaultWorkflowId, name: rules.defaultWorkflowName || '', why: 'no keyword match — default workflow' }
  }
  return null
}

// Dig the contact UUID out of PitchPrfct's create-contact response, tolerating
// a few likely JSON shapes (the API docs don't pin the response body down).
function extractContactUuid(text) {
  try {
    const j = JSON.parse(text)
    return j && (j.uuid || j.id || (j.data && (j.data.uuid || j.data.id))
      || (j.contact && (j.contact.uuid || j.contact.id))) || null
  } catch { return null }
}

// Look an existing contact up by phone (used when create-contact returns 409
// "phone already exists") so we can still get its UUID to enroll.
async function findContactByPhone(apiKey, phone) {
  try {
    const r = await fetch(
      `${PITCHPRFCT_API}/contacts?search=${encodeURIComponent(phone)}&take=5`,
      { headers: { 'x-api-key': apiKey } }
    )
    if (!r.ok) { console.error('[pp] findContactByPhone HTTP', r.status); return null }
    const j = await r.json()
    // List may be a bare array or wrapped — e.g. { data: { rows: [...] } }.
    const list = Array.isArray(j) ? j
      : ((j && j.data && (j.data.rows || j.data)) || (j && j.contacts) || [])
    const arr = Array.isArray(list) ? list : []
    const digits = String(phone).replace(/\D/g, '')
    for (const c of arr) {
      const cd = String((c && (c.phoneNumber || c.phone)) || '').replace(/\D/g, '')
      if (cd && (cd === digits || cd.endsWith(digits) || digits.endsWith(cd))) {
        return c.uuid || c.id || null
      }
    }
    return arr[0] ? (arr[0].uuid || arr[0].id || null) : null
  } catch (e) { console.error('[pp] findContactByPhone threw', String(e)); return null }
}

// Create the lead as a PitchPrfct contact (or find it if it already exists),
// returning the contact UUID needed for workflow enrollment.
async function createOrFindContact(apiKey, lead) {
  const payload = {
    phoneNumber: lead.phone,
    firstName: lead.first_name || undefined,
    lastName:  lead.last_name || undefined,
    email:     lead.email || undefined,
    city:      lead.city || undefined,
    state:     lead.state || undefined,
    zipCode:   lead.zip || undefined,
    tags:      ['Infinite CRM', lead.campaign].filter(Boolean),
  }
  let r
  try {
    r = await fetch(`${PITCHPRFCT_API}/contacts`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (e) { console.error('[pp] createContact threw', String(e)); return null }
  const text = await r.text()
  if (r.ok) {
    const uuid = extractContactUuid(text)
    if (uuid) { console.log('[pp] contact created', uuid); return uuid }
    console.error('[pp] contact created but no UUID in response:', text.slice(0, 400))
  }
  // 409 = phone already a contact. Any other failure: still try to find it.
  if (r.status !== 200 && r.status !== 201) {
    if (r.status !== 409) console.error('[pp] createContact failed', r.status, text.slice(0, 300))
    const found = await findContactByPhone(apiKey, lead.phone)
    if (found) { console.log('[pp] contact found by phone', found); return found }
  }
  return null
}

// Enroll a contact into a workflow.
async function enrollInWorkflow(apiKey, workflowId, contactUuid) {
  try {
    const r = await fetch(`${PITCHPRFCT_API}/workflows/${encodeURIComponent(workflowId)}/enroll`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ contactUuid }),
    })
    const text = await r.text()
    if (r.ok) {
      console.log('[pp] ENROLLED contact', contactUuid, 'in workflow', workflowId)
    } else {
      // 400 = workflow not active, 404 = workflow or contact not found.
      console.error('[pp] enroll FAILED', r.status, text.slice(0, 300))
    }
    return r.ok
  } catch (e) { console.error('[pp] enroll threw', String(e)); return false }
}

// Orchestrator — called once per brand-new lead from the email() handler.
// Best-effort: any failure here is logged but never breaks lead insertion.
async function enrollLeadInPitch(env, userId, lead) {
  const tag = lead.id ? `lead=${lead.id}` : 'lead=?'
  const normPhone = coercePhoneE164(lead.phone)
  if (!normPhone) {
    console.log('[pp]', tag, 'no usable phone — skipping', { raw: lead.phone }); return false
  }
  lead = { ...lead, phone: normPhone }
  const apiKey = await getAgentApiKey(env, userId)
  if (!apiKey) { console.log('[pp]', tag, 'agent has no PitchPrfct API key — skipping'); return false }
  const rules = await getProfileRules(env, userId)
  const hasRules = rules && (rules.defaultWorkflowId || (Array.isArray(rules.rules) && rules.rules.length))
  if (!hasRules) { console.log('[pp]', tag, 'no workflow rules for this agent — skipping'); return false }
  const pick = pickWorkflowId(rules, lead)
  if (!pick) { console.log('[pp]', tag, 'no workflow matched and no default set — skipping'); return false }
  console.log('[pp]', tag, pick.why, '→ workflow', pick.id, pick.name || '')
  const contactUuid = await createOrFindContact(apiKey, lead)
  if (!contactUuid) { console.error('[pp]', tag, 'no contact UUID — cannot enroll'); return false }
  const ok = await enrollInWorkflow(apiKey, pick.id, contactUuid)
  if (ok && lead.id) {
    // Fire-and-forget: agent sees the confirmation in the lead's Action Log
    await logEnrollActivity(env, userId, lead.id, pick.name || pick.id)
  }
  return ok
}

// ─── PitchPrfct delay queue ────────────────────────────────────────────────
// With a delay configured (pitchprfct_rules.delayMinutes), a new lead is parked
// in the pitchprfct_queue table instead of enrolled right away. The scheduled()
// cron handler enrolls rows once their timer runs out — unless the agent hit
// Cancel in the CRM first (which flips the row to 'cancelled').

// Pull the inserted lead's id out of the Supabase insert response body.
function parseFirstId(body) {
  try { const a = JSON.parse(body); return (Array.isArray(a) && a[0] && a[0].id) || null }
  catch { return null }
}

async function insertQueueRow(env, row) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/pitchprfct_queue`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify([row]),
    })
    if (!r.ok) { console.error('[pp] insertQueueRow failed', r.status, (await r.text()).slice(0, 200)); return false }
    return true
  } catch (e) { console.error('[pp] insertQueueRow threw', String(e)); return false }
}

// Decide: queue the lead for later, or enroll it now. delayMinutes <= 0 (or no
// lead id) means enroll immediately.
async function schedulePitchForLead(env, userId, lead) {
  const tag = lead.id ? `lead=${lead.id}` : 'lead=?'
  if (!coercePhoneE164(lead.phone)) {
    console.log('[pp]', tag, 'no usable phone — skipping', { raw: lead.phone }); return
  }
  const rules = await getProfileRules(env, userId)
  const delayMin = Math.max(0, parseInt((rules && rules.delayMinutes), 10) || 0)
  // Earliest enroll time the agent's settings allow: now + their call-first delay.
  const earliest = new Date(Date.now() + delayMin * 60000)
  // TZ window — if earliest is outside 9am-9pm local, push to next 9am local.
  const enrollAtIso = nextOkEnrollIso(lead, earliest)
  const enrollAt = new Date(enrollAtIso)
  const deferred = enrollAt.getTime() > earliest.getTime() + 1000
  // If we have no lead.id we can't queue — best we can do is enroll now and
  // hope the local hour isn't horrible. This case shouldn't happen post-insert.
  if (!lead.id) {
    if (deferred) {
      console.warn('[pp]', tag, 'no lead.id, cannot queue TZ-deferred enroll — firing immediately')
    }
    await enrollLeadInPitch(env, userId, lead)
    return
  }
  // Queue if there's any wait (delay OR TZ defer). Otherwise enroll inline.
  if (delayMin > 0 || deferred) {
    const ok = await insertQueueRow(env, {
      lead_id: lead.id, user_id: userId, enroll_at: enrollAtIso, status: 'pending',
    })
    if (ok) {
      console.log('[pp]', tag, 'QUEUED — enroll_at', enrollAtIso, deferred ? '(TZ-deferred to 9am local)' : `(+${delayMin}m)`)
      return
    }
    console.error('[pp]', tag, 'queue insert failed — enrolling inline instead')
  }
  await enrollLeadInPitch(env, userId, lead)
}

// ── Cron side ──────────────────────────────────────────────────────────────
async function getLeadById(env, leadId) {
  try {
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    )
    if (!r.ok) { console.error('[cron] getLeadById HTTP', r.status); return null }
    const rows = await r.json()
    return (Array.isArray(rows) && rows[0]) || null
  } catch (e) { console.error('[cron] getLeadById threw', String(e)); return null }
}

async function patchQueueRow(env, id, patch) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/pitchprfct_queue?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    })
  } catch (e) { console.error('[cron] patchQueueRow threw', String(e)) }
}
async function setQueueStatus(env, id, status) {
  await patchQueueRow(env, id, { status })
}

// Enroll one queued lead whose timer has elapsed, then mark the row done.
// Re-checks the 9am-9pm TZ window at fire time; if still outside, defers the
// row to the next OK time instead of enrolling and waking the lead at 3am.
async function processQueueRow(env, row) {
  const lead = await getLeadById(env, row.lead_id)
  if (!lead) {
    console.error('[cron] lead not found for queue row', row.id, row.lead_id)
    await setQueueStatus(env, row.id, 'failed')
    return
  }
  // Re-check TZ window at fire time — clock may have advanced since the row
  // was queued, but a lead queued at 8pm with a 90-min delay would fire at
  // 9:30pm which is outside the window. Defer in that case.
  const okIso = nextOkEnrollIso(lead, new Date())
  if (new Date(okIso).getTime() > Date.now() + 30 * 1000) {
    console.log('[cron] row', row.id, 'still outside 9-9 local — defer to', okIso)
    await patchQueueRow(env, row.id, { enroll_at: okIso, status: 'pending' })
    return
  }
  console.log('[cron] enrolling queued lead', row.lead_id, 'attempt', (row.attempts || 0) + 1)
  const ok = await enrollLeadInPitch(env, row.user_id, lead)
  if (ok) {
    await setQueueStatus(env, row.id, 'done')
    return
  }
  // Enroll failed — bump attempts. After 3 failures, give up loudly.
  const attempts = (row.attempts || 0) + 1
  if (attempts >= 3) {
    console.error('[cron] row', row.id, 'failed', attempts, 'times — marking failed')
    await patchQueueRow(env, row.id, { status: 'failed', attempts })
  } else {
    // Retry in 5 minutes
    const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    console.warn('[cron] row', row.id, 'enroll failed (attempt', attempts + ') — retrying at', retryAt)
    await patchQueueRow(env, row.id, { enroll_at: retryAt, status: 'pending', attempts })
  }
}

// Process every pending queue row whose enroll_at has passed. Rows the agent
// cancelled (status 'cancelled') are never selected here, so they never enroll.
async function runQueue(env) {
  try {
    const now = new Date().toISOString()
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/pitchprfct_queue?status=eq.pending&enroll_at=lte.${encodeURIComponent(now)}&select=id,lead_id,user_id,attempts&order=enroll_at.asc&limit=50`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    )
    if (!r.ok) { console.error('[cron] queue query HTTP', r.status); return }
    const rows = await r.json()
    const due = Array.isArray(rows) ? rows : []
    console.log('[cron] due queue rows:', due.length)
    for (const row of due) await processQueueRow(env, row)
  } catch (e) { console.error('[cron] runQueue threw', String(e)) }
}

// ─── Worker entry points ───────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }
    // Version probe — lets us curl the deployed worker and confirm Cloudflare
    // is actually running the code we think it is. Bump the version string
    // every release so a stale deploy is immediately visible.
    if (req.method === 'GET' && url.pathname === '/version') {
      return new Response(JSON.stringify({
        version: 'v4.17',
        parser: 'content-sniff cleanup — handles HTML/QP regardless of headers',
        deployed_check: 'if you see v4.17 here, the deploy succeeded',
      }), { status: 200, headers: { 'content-type': 'application/json', ...CORS } })
    }
    // Workflow-list proxy — lets the CRM Settings panel show a dropdown of the
    // agent's real PitchPrfct workflows WITHOUT the API key ever touching the
    // browser — the CRM passes ?agent_id=UUID and the key is looked up here.
    if (req.method === 'GET' && url.pathname === '/pp-workflows') {
      const wfAgent = url.searchParams.get('agent_id')
      if (!wfAgent) {
        return new Response(JSON.stringify({ error: 'missing agent_id' }), {
          status: 400, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const wfKey = await getAgentApiKey(env, wfAgent)
      if (!wfKey) {
        return new Response(JSON.stringify({ error: 'no PitchPrfct API key saved for this agent yet' }), {
          status: 404, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      try {
        const r = await fetch(`${PITCHPRFCT_API}/workflows?take=200`, {
          headers: { 'x-api-key': wfKey },
        })
        const text = await r.text()
        return new Response(text, {
          status: r.status, headers: { 'content-type': 'application/json', ...CORS },
        })
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 502, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
    }
    // Manual workflow enrollment — used occasionally from the LeadDetail UI when
    // an agent wants to drop a specific lead into a specific workflow on demand.
    // Fires IMMEDIATELY (no delay, no queue) — manual means manual.
    //   POST /pp-enroll-manual  { agent_id, lead_id, workflow_id }
    if (req.method === 'POST' && url.pathname === '/pp-enroll-manual') {
      let payload = {}
      try { payload = await req.json() } catch {
        return new Response(JSON.stringify({ error: 'bad json' }), {
          status: 400, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const agentId = payload.agent_id
      const leadId = payload.lead_id
      const workflowId = payload.workflow_id
      const workflowName = payload.workflow_name || ''
      if (!agentId || !leadId || !workflowId) {
        return new Response(JSON.stringify({ error: 'missing agent_id, lead_id, or workflow_id' }), {
          status: 400, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const apiKey = await getAgentApiKey(env, agentId)
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'no PitchPrfct API key saved for this agent' }), {
          status: 404, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const lead = await getLeadById(env, leadId)
      if (!lead) {
        return new Response(JSON.stringify({ error: 'lead not found' }), {
          status: 404, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const normPhone = coercePhoneE164(lead.phone)
      if (!normPhone) {
        return new Response(JSON.stringify({ error: `lead phone "${lead.phone || ''}" doesn't look like a US number` }), {
          status: 400, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const contactUuid = await createOrFindContact(apiKey, { ...lead, phone: normPhone })
      if (!contactUuid) {
        return new Response(JSON.stringify({ error: 'could not create/find PitchPrfct contact' }), {
          status: 502, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const ok = await enrollInWorkflow(apiKey, workflowId, contactUuid)
      if (!ok) {
        return new Response(JSON.stringify({ error: 'workflow enroll failed (workflow paused or not found?)', contact_uuid: contactUuid }), {
          status: 502, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      // Log a confirmation row so the agent sees this enrollment in the lead's
      // Action Log too — same pattern as auto-enroll, just labeled "Manually".
      await logEnrollActivity(env, agentId, leadId, workflowName ? `Manually → ${workflowName}` : 'Manual enroll')
      return new Response(JSON.stringify({ ok: true, contact_uuid: contactUuid, workflow_id: workflowId }), {
        status: 200, headers: { 'content-type': 'application/json', ...CORS },
      })
    }
    if (req.method !== 'POST' || !url.pathname.startsWith('/leads')) {
      return new Response('infinite-crm-webhook v4 — POST /leads?agent_id=UUID', {
        status: 200, headers: { ...CORS },
      })
    }
    const agentId = url.searchParams.get('agent_id')
    if (!agentId) {
      return new Response(JSON.stringify({ error: 'missing agent_id' }), {
        status: 400, headers: { 'content-type': 'application/json', ...CORS },
      })
    }
    let body = {}
    try { body = await req.json() } catch {
      return new Response('bad json', { status: 400, headers: CORS })
    }

    // Normalize phone to +1XXXXXXXXXX if present
    if (body.phone) {
      const digits = String(body.phone).replace(/\D/g, '')
      if (digits.length === 10) body.phone = `+1${digits}`
      else if (digits.length === 11 && digits[0] === '1') body.phone = `+${digits}`
    }

    const lead = sanitizeForInsert({
      ...body,
      user_id: agentId,
      agent_id: agentId,
      stage: body.stage || DEFAULT_STAGE,
      created_at: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    })

    const result = await insertLead(env, lead)
    // Treat 23505 unique-violation (lead already exists) as success — bump
    // last_activity on the existing row instead so the agent sees it refresh.
    if (!result.ok && isDuplicate(result) && lead.phone) {
      const t = await touchLeadByPhone(env, agentId, lead.phone)
      return new Response(JSON.stringify({ ok: true, duplicate: true, status: t.status }), {
        status: 200, headers: { 'content-type': 'application/json', ...CORS },
      })
    }
    return new Response(JSON.stringify({ ok: result.ok, status: result.status, lead: result.body.slice(0, 1000) }), {
      status: result.ok ? 200 : 500,
      headers: { 'content-type': 'application/json', ...CORS },
    })
  },

  async email(message, env) {
    const recipient = message.to || ''
    console.log('[email] received', { recipient, from: message.from, subject: message.headers?.get?.('subject') || '' })
    try {
      const raw = await streamToString(message.raw)
      // Chunked raw dump — DKIM/ARC headers eat ~2000 chars before the MIME
      // body even starts, so we log multiple windows to capture both the
      // outer Content-Type AND the actual multipart structure.
      const CHUNK = 1800
      const totalChunks = Math.min(6, Math.ceil(raw.length / CHUNK))
      console.log('[email] raw length:', raw.length, 'chars,', totalChunks, 'chunks')
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK
        const slice = raw.slice(start, start + CHUNK)
        console.log(`[email] raw chunk ${i + 1}/${totalChunks} (${start}..${start + slice.length}):`,
          slice.replace(/\r/g, '\\r').replace(/\n/g, '\\n'))
      }
      const body = extractBody(raw)
      const userId = AGENT_ROUTING[recipient]
      if (!userId) {
        console.error('[email] no AGENT_ROUTING entry for', recipient)
        return
      }
      // Verbose diagnostic logging — every step of the parse is traced. With
      // these in Cloudflare Logs we can pinpoint exactly where a misparse goes
      // wrong (body content, regex result, sanitization, insert).
      console.log('[email] body length:', body.length, 'chars')
      console.log('[email] body preview (first 800):', body.slice(0, 800).replace(/\n/g, '\\n'))
      const lead = parseLead(body)
      console.log('[email] parsed lead:', JSON.stringify(lead))
      lead.user_id = userId
      lead.agent_id = userId
      // Tag the source so we can tell worker-imported leads apart from
      // manual-paste imports. v4.14 stamps a build id so we can verify deploys.
      lead.source = 'USHA Marketplace (worker v4.17)'
      lead.stage = DEFAULT_STAGE
      lead.created_at = new Date().toISOString()
      lead.last_activity = lead.created_at

      console.log('[email] final lead to insert:', JSON.stringify(lead))
      const result = await insertLead(env, lead)
      if (result.ok) {
        console.log('[email] INSERTED ok', { fields: Object.keys(lead) })
        // Brand-new lead → schedule PitchPrfct enrollment. With a delay set in
        // Settings it's queued (a countdown the agent can cancel); with no delay
        // it enrolls immediately. Duplicates fall through and are NOT re-enrolled.
        const insertedId = parseFirstId(result.body)
        await schedulePitchForLead(env, userId, { ...lead, id: insertedId })
      } else if (isDuplicate(result) && lead.phone) {
        // USHA forwarded the same lead twice (e.g. via Gmail filter AND directly
        // to murray-leads@). Bump last_activity on the existing row instead of
        // failing or writing a debug stub.
        console.log('[email] DUPLICATE — bumping last_activity', { phone: lead.phone })
        const t = await touchLeadByPhone(env, userId, lead.phone)
        console.log('[email] touch result', t)
      } else {
        console.error('[email] INSERT FAILED', { status: result.status, body: result.body.slice(0, 800), lead: JSON.stringify(lead).slice(0, 1500) })
        // Last-resort: write a stub row so genuine failures are visible in the CRM
        const stubLead = {
          user_id: userId,
          agent_id: userId,
          source: 'WORKER_DEBUG',
          stage: DEFAULT_STAGE,
          first_name: lead.first_name || 'Worker',
          last_name: lead.last_name || 'DebugError',
          notes: `Insert failed (status ${result.status}): ${result.body.slice(0, 800)}\n\nOriginal lead JSON:\n${JSON.stringify(lead, null, 2).slice(0, 1500)}`,
          created_at: new Date().toISOString(),
          last_activity: new Date().toISOString(),
        }
        await insertLead(env, stubLead)
      }
    } catch (e) {
      console.error('[email] EXCEPTION', String(e), e?.stack)
    }
  },

  // Cron trigger — enrolls queued leads whose delay timer has run out. Needs a
  // Cron Trigger (e.g. every minute, "* * * * *") added to this Worker in the
  // Cloudflare dashboard. Without a delay configured, nothing is ever queued
  // and this simply finds no rows.
  async scheduled(event, env, ctx) {
    await runQueue(env)
  },
}
