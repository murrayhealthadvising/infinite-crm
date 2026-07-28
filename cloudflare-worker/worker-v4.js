// Infinite CRM Email Worker — v4.23 (verified enroll log — only writes activity if PP actually sent; response tag column)
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
// app.pitchprfct.com (or wherever) and posts to this worker. Also required
// for the /api/v1/* endpoints called by Kam and other external automations.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, x-api-key, authorization',
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

// ═════════════════════════════════════════════════════════════════════════════
//  INFINITE PUBLIC API v1  —  /api/v1/*
// ─────────────────────────────────────────────────────────────────────────────
// External REST surface. Auth via X-API-Key (or Authorization: Bearer). Every
// operation is scoped to the api_key's owner user_id, so a leaked key can only
// touch the owner's data — never anyone else's.
//
// Endpoints:
//   GET   /api/v1/leads?phone=+1... or ?email=...   → find (dedup)
//   POST  /api/v1/leads?upsert=true                  → create or upsert
//   GET   /api/v1/leads/:id                          → fetch one
//   PATCH /api/v1/leads/:id                          → update (auto-logs stage changes)
//   POST  /api/v1/leads/:id/tags                     → add/remove tags → maps to stage
//   POST  /api/v1/leads/:id/activity                 → append activity row
//   GET   /api/v1/stages                             → user's stage catalog
//   GET   /api/v1/tags                               → same as /stages (alias for Kam's terminology)
//
// Wire format is camelCase in/out; the mapper translates to/from snake_case
// on the DB side so external integrators don't need to know our column names.
// ═════════════════════════════════════════════════════════════════════════════

const API_V1_CORS = { ...CORS, 'content-type': 'application/json' }
const jsonResp = (obj, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...API_V1_CORS, ...extraHeaders },
  })

// ── Field mapping (external camelCase ↔ DB snake_case) ────────────────────
// Only fields listed here are accepted from external requests. Anything else
// is silently dropped (defense in depth against schema-cache errors and
// accidental writes to columns like user_id or stage_changed_at).
const EXT_TO_DB = {
  firstName: 'first_name',
  lastName: 'last_name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  city: 'city',
  state: 'state',
  zip: 'zip',
  dob: 'dob',
  ageBand: 'age_range',
  age: 'age',
  gender: 'gender',
  smoker: 'smoker',
  householdSize: 'household',
  income: 'income',
  campaign: 'campaign',
  source: 'source',
  cost: 'price',
  stage: 'stage',
  plan: 'plan_choice',
  planChoice: 'plan_choice',
  premium: 'premium',
  carrier: 'carrier',
  effectiveDate: 'effective_date',
  notesRaw: 'notes',
  notesStatus: 'notes_b',
  notes: 'notes',
  comments: 'comments',
  bestContactTime: 'best_contact_time',
  monthlyBudget: 'monthly_budget',
  externalId: 'external_id',
}
// Reverse map — DB snake_case → external camelCase, for GET responses.
const DB_TO_EXT = (() => {
  const out = {}
  for (const [ext, db] of Object.entries(EXT_TO_DB)) {
    // Prefer the "primary" external name for a given DB column. First one wins.
    if (!(db in out)) out[db] = ext
  }
  // Fields we return but don't accept as writable input
  out.id = 'id'
  out.user_id = 'ownerUserId'
  out.created_at = 'receivedAt'
  out.updated_at = 'updatedAt'
  out.stage_changed_at = 'stageChangedAt'
  out.pp_response_status = 'respondedStatus'
  return out
})()

function externalToDbPatch(body) {
  if (!body || typeof body !== 'object') return {}
  const out = {}
  for (const [ext, val] of Object.entries(body)) {
    const dbCol = EXT_TO_DB[ext]
    if (!dbCol) continue
    if (val === undefined) continue
    // Normalize phone to E.164 on the way in
    if (dbCol === 'phone') {
      const p = coercePhoneE164(val)
      if (p) out.phone = p
      continue
    }
    // Normalize effective_date to YYYY-MM-DD if a full ISO is sent
    if (dbCol === 'effective_date' && typeof val === 'string') {
      out.effective_date = val.slice(0, 10)
      continue
    }
    out[dbCol] = val
  }
  return out
}

function dbToExternal(row) {
  if (!row || typeof row !== 'object') return null
  const out = {}
  for (const [dbCol, val] of Object.entries(row)) {
    const extName = DB_TO_EXT[dbCol]
    if (!extName) continue
    out[extName] = val
  }
  return out
}

// ── SHA-256 hex — used to hash incoming API keys before DB lookup ─────────
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Auth middleware — resolve X-API-Key to { userId, scopes, keyId } ─────
// Returns null on failure. Bumps last_used_at on success (fire-and-forget so
// slow DB writes don't slow the API response).
async function authenticateApiKey(env, req, ctx) {
  const headerKey = req.headers.get('x-api-key')
    || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!headerKey || headerKey.length < 16) return null
  const hash = await sha256Hex(headerKey)
  const url = `${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${encodeURIComponent(hash)}&revoked_at=is.null&select=id,user_id,scopes&limit=1`
  const r = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  })
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  if (!rows?.length) return null
  const { id, user_id, scopes } = rows[0]
  // Fire-and-forget bump of last_used_at
  const bump = fetch(`${env.SUPABASE_URL}/rest/v1/api_keys?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {})
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(bump)
  return { userId: user_id, scopes: Array.isArray(scopes) ? scopes : [], keyId: id }
}

function hasScope(auth, needed) {
  return auth && Array.isArray(auth.scopes) && auth.scopes.includes(needed)
}

// ── DB helpers used by the API routes ─────────────────────────────────────
async function sbSelect(env, table, query) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  })
  if (!r.ok) return { ok: false, status: r.status, body: await r.text() }
  return { ok: true, status: r.status, rows: await r.json().catch(() => []) }
}

async function sbInsert(env, table, row) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify([row]),
  })
  const txt = await r.text()
  if (!r.ok) return { ok: false, status: r.status, body: txt }
  let rows = []
  try { rows = JSON.parse(txt) } catch {}
  return { ok: true, status: r.status, row: rows?.[0] || null }
}

async function sbPatch(env, table, filterQuery, patch) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  })
  const txt = await r.text()
  if (!r.ok) return { ok: false, status: r.status, body: txt }
  let rows = []
  try { rows = JSON.parse(txt) } catch {}
  return { ok: true, status: r.status, row: rows?.[0] || null }
}

// Log an activity row (mirrors the CRM's addActivity function).
async function apiLogActivity(env, userId, leadId, type, note) {
  try {
    await sbInsert(env, 'activities', {
      user_id: userId, lead_id: leadId, type, note, created_at: new Date().toISOString(),
    })
  } catch {}
}

// ── ROUTES ────────────────────────────────────────────────────────────────
async function handleApiV1(url, req, env, ctx) {
  // OPTIONS preflight
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // Authenticate
  const auth = await authenticateApiKey(env, req, ctx)
  if (!auth) {
    return jsonResp({ error: 'Unauthorized. Send X-API-Key: <your key> or Authorization: Bearer <your key>.' }, 401)
  }

  const path = url.pathname.replace(/^\/api\/v1/, '') || '/'
  const method = req.method

  try {
    // GET /leads?phone=... or ?email=... — find (dedup)
    if (method === 'GET' && path === '/leads') {
      if (!hasScope(auth, 'leads:read')) return jsonResp({ error: 'Missing scope: leads:read' }, 403)
      const phone = url.searchParams.get('phone')
      const email = url.searchParams.get('email')
      if (!phone && !email) return jsonResp({ error: 'Provide phone or email' }, 400)
      const filters = [`user_id=eq.${encodeURIComponent(auth.userId)}`]
      if (phone) {
        const e164 = coercePhoneE164(phone) || phone
        filters.push(`phone=eq.${encodeURIComponent(e164)}`)
      }
      if (email) filters.push(`email=eq.${encodeURIComponent(email.toLowerCase())}`)
      const r = await sbSelect(env, 'leads', filters.join('&') + '&limit=1&order=created_at.desc')
      if (!r.ok) return jsonResp({ error: `Lookup failed: ${r.body}` }, 500)
      const lead = r.rows[0] || null
      return jsonResp({ found: !!lead, lead: lead ? dbToExternal(lead) : null })
    }

    // POST /leads or POST /leads?upsert=true
    if (method === 'POST' && path === '/leads') {
      if (!hasScope(auth, 'leads:write')) return jsonResp({ error: 'Missing scope: leads:write' }, 403)
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') return jsonResp({ error: 'Body must be JSON object' }, 400)
      const patch = externalToDbPatch(body)
      if (!patch.phone && !patch.email) {
        return jsonResp({ error: 'Provide at least phone or email' }, 400)
      }
      const upsert = url.searchParams.get('upsert') === 'true'
      // Dedup by phone (preferred) then email
      if (upsert) {
        const dedupFilters = [`user_id=eq.${encodeURIComponent(auth.userId)}`]
        if (patch.phone) dedupFilters.push(`phone=eq.${encodeURIComponent(patch.phone)}`)
        else if (patch.email) dedupFilters.push(`email=eq.${encodeURIComponent(patch.email.toLowerCase())}`)
        const existing = await sbSelect(env, 'leads', dedupFilters.join('&') + '&limit=1&select=id,stage')
        if (existing.ok && existing.rows[0]) {
          const leadId = existing.rows[0].id
          const oldStage = existing.rows[0].stage
          const patched = { ...patch }
          delete patched.phone; delete patched.email  // don't overwrite the dedup key
          if ('stage' in patched && patched.stage !== oldStage) {
            patched.stage_changed_at = new Date().toISOString()
          }
          const pr = await sbPatch(env, 'leads', `id=eq.${leadId}`, patched)
          if (!pr.ok) return jsonResp({ error: `Upsert-patch failed: ${pr.body}` }, 500)
          if ('stage' in patched && patched.stage !== oldStage) {
            await apiLogActivity(env, auth.userId, leadId, 'status', `Stage → ${patched.stage} (via API)`)
          }
          return jsonResp({ lead: dbToExternal(pr.row), upserted: true, action: 'updated' }, 200)
        }
      }
      // Fresh insert
      const insertRow = { ...patch, user_id: auth.userId, created_at: new Date().toISOString() }
      if (insertRow.email) insertRow.email = String(insertRow.email).toLowerCase()
      if (insertRow.stage) insertRow.stage_changed_at = new Date().toISOString()
      const ir = await sbInsert(env, 'leads', insertRow)
      if (!ir.ok) {
        if (isDuplicate(ir)) return jsonResp({ error: 'Lead already exists', code: 'duplicate' }, 409)
        return jsonResp({ error: `Insert failed: ${ir.body}` }, 500)
      }
      if (insertRow.stage) {
        await apiLogActivity(env, auth.userId, ir.row.id, 'status', `Stage → ${insertRow.stage} (via API)`)
      }
      await apiLogActivity(env, auth.userId, ir.row.id, 'note', 'Created via API')
      return jsonResp({ lead: dbToExternal(ir.row), upserted: !!upsert, action: 'created' }, 201)
    }

    // /leads/:id routes
    const leadIdMatch = path.match(/^\/leads\/([0-9a-fA-F-]{36})(\/(tags|activity))?$/)
    if (leadIdMatch) {
      const leadId = leadIdMatch[1]
      const subresource = leadIdMatch[3]

      // Verify the lead belongs to this API key's owner (isolation guarantee)
      const own = await sbSelect(env, 'leads', `id=eq.${leadId}&user_id=eq.${encodeURIComponent(auth.userId)}&select=id,stage&limit=1`)
      if (!own.ok || !own.rows[0]) return jsonResp({ error: 'Lead not found' }, 404)
      const oldStage = own.rows[0].stage

      // GET /leads/:id
      if (method === 'GET' && !subresource) {
        if (!hasScope(auth, 'leads:read')) return jsonResp({ error: 'Missing scope: leads:read' }, 403)
        const r = await sbSelect(env, 'leads', `id=eq.${leadId}&limit=1`)
        if (!r.ok || !r.rows[0]) return jsonResp({ error: 'Lead not found' }, 404)
        return jsonResp({ lead: dbToExternal(r.rows[0]) })
      }

      // PATCH /leads/:id
      if (method === 'PATCH' && !subresource) {
        if (!hasScope(auth, 'leads:write')) return jsonResp({ error: 'Missing scope: leads:write' }, 403)
        const body = await req.json().catch(() => null)
        if (!body || typeof body !== 'object') return jsonResp({ error: 'Body must be JSON object' }, 400)
        const patch = externalToDbPatch(body)
        // Append vs replace for notes — Kam wants to accumulate raw notes over
        // a conversation, so if `notesRaw` is set AND body.notesMode !== 'replace',
        // fetch current and prepend a newline.
        const notesMode = String(body.notesMode || 'append').toLowerCase()
        if ('notes' in patch && notesMode === 'append') {
          const existing = await sbSelect(env, 'leads', `id=eq.${leadId}&select=notes&limit=1`)
          const prior = existing.ok ? (existing.rows[0]?.notes || '') : ''
          patch.notes = prior ? `${prior}\n${patch.notes}` : patch.notes
        }
        // notes_b (right box / status) defaults to replace since Kam wants to
        // overwrite the current-state summary, not accumulate it.
        // Auto-stamp stage_changed_at when stage changes
        if ('stage' in patch && patch.stage !== oldStage) {
          patch.stage_changed_at = new Date().toISOString()
        }
        if (!Object.keys(patch).length) return jsonResp({ error: 'No writable fields in body' }, 400)
        const pr = await sbPatch(env, 'leads', `id=eq.${leadId}`, patch)
        if (!pr.ok) return jsonResp({ error: `Patch failed: ${pr.body}` }, 500)
        if ('stage' in patch && patch.stage !== oldStage && hasScope(auth, 'activity:write')) {
          await apiLogActivity(env, auth.userId, leadId, 'status', `Stage → ${patch.stage} (via API)`)
        }
        return jsonResp({ lead: dbToExternal(pr.row) })
      }

      // POST /leads/:id/tags — add/remove tags. In Infinite each lead has ONE
      // stage (not a multi-tag). We treat "add" as "set the stage to this tag";
      // "remove" clears the stage if it matches. Tag catalog is fuzzy-matched
      // to stage IDs so Kam can send "#SOLD", "sold", or "Sold" interchangeably.
      if (method === 'POST' && subresource === 'tags') {
        if (!hasScope(auth, 'tags:write')) return jsonResp({ error: 'Missing scope: tags:write' }, 403)
        const body = await req.json().catch(() => null)
        if (!body || typeof body !== 'object') return jsonResp({ error: 'Body must be JSON object' }, 400)
        const add = Array.isArray(body.add) ? body.add : []
        const remove = Array.isArray(body.remove) ? body.remove : []
        // Fetch tag catalog to fuzzy-match names to IDs
        const cat = await sbSelect(env, 'tags', `user_id=eq.${encodeURIComponent(auth.userId)}&select=id,label`)
        if (!cat.ok) return jsonResp({ error: `Tag catalog fetch failed: ${cat.body}` }, 500)
        const stageMap = new Map()
        for (const t of cat.rows) {
          stageMap.set(String(t.id).toLowerCase(), t.id)
          if (t.label) stageMap.set(String(t.label).toLowerCase().replace(/^#/, '').trim(), t.id)
        }
        const resolve = (raw) => {
          const k = String(raw || '').toLowerCase().replace(/^#/, '').trim()
          return stageMap.get(k) || null
        }
        // Apply removes first, then adds. Last successful add wins as the stage.
        let newStage = oldStage
        for (const r of remove) {
          const rid = resolve(r)
          if (rid && rid === newStage) newStage = null
        }
        for (const a of add) {
          const aid = resolve(a)
          if (aid) newStage = aid
        }
        if (newStage !== oldStage) {
          const patch = { stage: newStage, stage_changed_at: new Date().toISOString() }
          const pr = await sbPatch(env, 'leads', `id=eq.${leadId}`, patch)
          if (!pr.ok) return jsonResp({ error: `Stage update failed: ${pr.body}` }, 500)
          if (hasScope(auth, 'activity:write')) {
            await apiLogActivity(env, auth.userId, leadId, 'status', `Stage → ${newStage || '(cleared)'} (via API tags)`)
          }
          return jsonResp({ lead: dbToExternal(pr.row), stage: newStage })
        }
        return jsonResp({ stage: newStage, changed: false })
      }

      // POST /leads/:id/activity
      if (method === 'POST' && subresource === 'activity') {
        if (!hasScope(auth, 'activity:write')) return jsonResp({ error: 'Missing scope: activity:write' }, 403)
        const body = await req.json().catch(() => null)
        if (!body || typeof body !== 'object') return jsonResp({ error: 'Body must be JSON object' }, 400)
        const type = String(body.type || 'note').slice(0, 32)
        const note = String(body.note || '').slice(0, 500)
        if (!note) return jsonResp({ error: 'note required' }, 400)
        await apiLogActivity(env, auth.userId, leadId, type, note)
        return jsonResp({ ok: true }, 201)
      }
    }

    // POST /warm-bucket — Kam (or any external automation) pushes a high-
    // priority contact into Nic's Warm Bucket for a callback. Idempotent by
    // (user_id, phone) — retries with the same phone update the same row
    // instead of duplicating. Optional externalId lets Kam track its own
    // reference. Scope: warm_bucket:write (added to default key scopes).
    //
    // Body:
    //   { phone: "+1...", firstName?, lastName?, email?, state?, zip?,
    //     note?, reason?, priority? (1-5), externalId? }
    if (method === 'POST' && path === '/warm-bucket') {
      // Reuse leads:write since callers who can create leads should be able
      // to add to the bucket. (Separate scope not worth the complexity for MVP.)
      if (!hasScope(auth, 'leads:write')) return jsonResp({ error: 'Missing scope: leads:write' }, 403)
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') return jsonResp({ error: 'Body must be JSON object' }, 400)
      const phoneE164 = coercePhoneE164(body.phone)
      if (!phoneE164) return jsonResp({ error: 'valid phone required' }, 400)
      const priority = Math.max(1, Math.min(5, parseInt(body.priority, 10) || 3))
      const row = {
        user_id: auth.userId,
        phone: phoneE164,
        first_name: body.firstName || null,
        last_name: body.lastName || null,
        email: (body.email || '').toLowerCase() || null,
        state: body.state || null,
        zip: body.zip || null,
        note: body.note || null,
        reason: body.reason || null,
        priority,
        source: 'api',
        external_id: body.externalId || null,
        status: 'pending',
      }
      // Upsert by (user_id, phone) — retries safe.
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/warm_bucket_queue?on_conflict=user_id,phone`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'content-type': 'application/json',
          prefer: 'return=representation,resolution=merge-duplicates',
        },
        body: JSON.stringify([row]),
      })
      const txt = await r.text()
      if (!r.ok) return jsonResp({ error: `Warm bucket push failed: ${txt.slice(0, 200)}` }, 500)
      let saved = null
      try { saved = JSON.parse(txt)?.[0] || null } catch {}
      return jsonResp({ ok: true, entry: saved, action: 'queued' }, 201)
    }

    // GET /stages and GET /tags (alias — both return the user's tag/stage catalog)
    if (method === 'GET' && (path === '/stages' || path === '/tags')) {
      if (!hasScope(auth, 'stages:read')) return jsonResp({ error: 'Missing scope: stages:read' }, 403)
      const r = await sbSelect(env, 'tags', `user_id=eq.${encodeURIComponent(auth.userId)}&select=id,label,color,sort_order&order=sort_order.asc`)
      if (!r.ok) return jsonResp({ error: `Fetch failed: ${r.body}` }, 500)
      // Return both id (write-safe) and label (display) so Kam can pick whichever.
      return jsonResp({ stages: r.rows.map(t => ({ id: t.id, label: t.label, color: t.color })) })
    }

    // Not matched
    return jsonResp({ error: `No route for ${method} ${path}` }, 404)
  } catch (e) {
    return jsonResp({ error: String(e?.message || e) }, 500)
  }
}
// ═════════════════════════════════════════════════════════════════════════════
//  END INFINITE PUBLIC API v1
// ═════════════════════════════════════════════════════════════════════════════

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
// local clock is in the 9am-9pm window, otherwise the next 9am in their TZ
// with a small random 0-5 minute jitter so a batch of overnight leads doesn't
// all fire at exactly 9:00:00 (looks bot-like on the recipient side).
// Falls back to `base` for leads whose TZ we can't infer (no state/zip).
const PP_WINDOW_START_HOUR = 9   // 9 AM
const PP_WINDOW_END_HOUR   = 21  // 9 PM (exclusive)
// After-9am jitter: adds 0-5 minutes so deferred enrollments land at ~9:02 or
// ~9:05 etc. instead of a synchronized 9:00:00 avalanche.
const PP_JITTER_MAX_MIN    = 5
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
  // Add 0-5 minutes of random jitter so multiple leads deferred overnight
  // don't all fire on the exact same 9:00:00 tick — spreads them across
  // ~9:00–9:05 which reads more natural to the recipient.
  const jitterMs = Math.floor(Math.random() * (PP_JITTER_MAX_MIN * 60 * 1000))
  const targetUtcMs = (targetLocalMs - offsetMin * 60000) + jitterMs
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
  // Rules can now match against either `comments` (default, contains-match)
  // or `campaign` (exact case-insensitive match). Field is optional on the
  // rule — omitted means comments, keeping every existing rule working
  // unchanged. First rule that matches wins.
  const list = Array.isArray(rules && rules.rules) ? rules.rules : []
  const comments = String(lead.comments || '').toLowerCase()
  const campaign = String(lead.campaign || '').toLowerCase().trim()
  for (const rule of list) {
    const kw = String((rule && rule.keyword) || '').trim().toLowerCase()
    if (!kw || !rule.workflowId) continue
    const field = (rule.field || 'comments').toLowerCase()
    if (field === 'campaign') {
      // Exact match on campaign (case-insensitive). Handles "america-choice"
      // matching "america-choice-network" via a substring check too, so agents
      // don't have to type the exact vendor string when their marketplace
      // sometimes tacks on suffixes.
      if (campaign === kw || (campaign && campaign.includes(kw))) {
        return { id: rule.workflowId, name: rule.workflowName || '', why: `campaign matched "${rule.keyword}"` }
      }
    } else {
      // Comments contains-match (legacy default)
      if (comments.includes(kw)) {
        return { id: rule.workflowId, name: rule.workflowName || '', why: `comments matched "${rule.keyword}"` }
      }
    }
  }
  if (rules && rules.defaultWorkflowId) {
    return { id: rules.defaultWorkflowId, name: rules.defaultWorkflowName || '', why: 'no rule matched — default workflow' }
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

// Enroll a contact into a workflow. Retries on transient failures — the most
// common bug was "contact was just created, PP hasn't finished indexing it,
// enroll returns 404 or 500, we give up, lead gets a contact but never a
// text". 3 attempts with 800ms + 1600ms backoff catches ~all eventual-
// consistency and one-off network errors. Only 400 (workflow paused / bad
// request) is treated as terminal since retry won't help.
async function enrollInWorkflow(apiKey, workflowId, contactUuid) {
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetch(`${PITCHPRFCT_API}/workflows/${encodeURIComponent(workflowId)}/enroll`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ contactUuid }),
      })
      const text = await r.text()
      if (r.ok) {
        console.log('[pp] ENROLLED contact', contactUuid, 'in workflow', workflowId, 'attempt', attempt)
        return true
      }
      // 400 = terminal (workflow paused / invalid). Everything else is
      // eligible for retry — includes 404 (contact not indexed yet), 429
      // (rate limit), 5xx (transient upstream).
      console.error('[pp] enroll attempt', attempt, 'FAILED', r.status, text.slice(0, 240))
      if (r.status === 400) {
        console.error('[pp] enroll terminal failure — not retrying (workflow paused / bad request)')
        return false
      }
    } catch (e) {
      console.error('[pp] enroll attempt', attempt, 'threw', String(e))
    }
    if (attempt < MAX_ATTEMPTS) {
      // Backoff: 800ms, 1600ms
      await new Promise(res => setTimeout(res, 800 * attempt))
    }
  }
  console.error('[pp] enroll GAVE UP after', MAX_ATTEMPTS, 'attempts — contact', contactUuid, 'workflow', workflowId)
  return false
}

// Fetch recent PitchPrfct messages for a contact. Reuses the same URL-attempt
// fan-out the /pp-conversation HTTP endpoint uses so both stay in sync when
// PP's undocumented messages endpoint moves. Returns [] on total failure.
// Pause/unenroll a contact from ALL PitchPrfct workflows. Called when a lead's
// stage moves to something that means "stop texting them" (apt / sold / stop /
// dnq). PP's unenroll API isn't published in a form we can rely on, so we fan
// out across the plausible endpoint shapes and consider ANY 2xx a success —
// worst case a couple extra 404s hit their edge; no client-visible impact.
async function unenrollAllPPWorkflows(apiKey, contactUuid) {
  if (!apiKey || !contactUuid) return { ok: false, tried: [], reason: 'missing key or contact' }
  const attempts = [
    { method: 'POST',   url: `${PITCHPRFCT_API}/contacts/${encodeURIComponent(contactUuid)}/pause` },
    { method: 'POST',   url: `${PITCHPRFCT_API}/contacts/${encodeURIComponent(contactUuid)}/unenroll` },
    { method: 'DELETE', url: `${PITCHPRFCT_API}/contacts/${encodeURIComponent(contactUuid)}/workflows` },
    { method: 'POST',   url: `${PITCHPRFCT_API}/contacts/${encodeURIComponent(contactUuid)}/unsubscribe` },
    { method: 'POST',   url: `${PITCHPRFCT_API}/workflows/unenroll`,
      body: JSON.stringify({ contactUuid, contact_id: contactUuid }) },
  ]
  const results = []
  for (const a of attempts) {
    try {
      const r = await fetch(a.url, {
        method: a.method,
        headers: { 'x-api-key': apiKey, ...(a.body ? { 'content-type': 'application/json' } : {}) },
        body: a.body,
      })
      const txt = await r.text().catch(() => '')
      results.push({ url: a.url.split('/api/v1')[1], status: r.status, ok: r.ok })
      if (r.ok) {
        console.log('[pp] UNENROLLED contact', contactUuid, 'via', a.method, a.url)
        return { ok: true, via: a.url, results }
      }
      // 404s are expected for endpoint shapes PP doesn't implement.
      if (r.status !== 404) {
        console.warn('[pp] unenroll non-404 error', r.status, txt.slice(0, 160))
      }
    } catch (e) {
      results.push({ url: a.url.split('/api/v1')[1], status: 0, ok: false, error: String(e) })
    }
  }
  console.error('[pp] unenroll FAILED for contact', contactUuid, 'attempts:', results)
  return { ok: false, results }
}

async function fetchPPMessages(apiKey, contactUuid, limit = 20) {
  const attempts = [
    `${PITCHPRFCT_API}/contacts/${encodeURIComponent(contactUuid)}/messages?take=${limit}`,
    `${PITCHPRFCT_API}/messages?contactUuid=${encodeURIComponent(contactUuid)}&take=${limit}`,
    `${PITCHPRFCT_API}/messages?contact_id=${encodeURIComponent(contactUuid)}&take=${limit}`,
    `${PITCHPRFCT_API}/conversations/${encodeURIComponent(contactUuid)}?take=${limit}`,
  ]
  const settled = await Promise.allSettled(attempts.map(async (u) => {
    const r = await fetch(u, { headers: { 'x-api-key': apiKey } })
    return { url: u, ok: r.ok, text: await r.text() }
  }))
  const ok200s = settled.filter(s => s.status === 'fulfilled' && s.value.ok).map(s => s.value)
  const merged = []
  const seen = new Set()
  const extractList = (rawText) => {
    let raw
    try { raw = JSON.parse(rawText) } catch { return [] }
    const list = (raw && raw.data && (raw.data.rows || raw.data.messages || raw.data)) ||
                 (raw && raw.messages) ||
                 (Array.isArray(raw) ? raw : [])
    return Array.isArray(list) ? list : []
  }
  for (const r of ok200s) {
    for (const m of extractList(r.text)) {
      const id = m.id || m.uuid || null
      const body = (m.body || m.message || m.text || m.content || '').trim()
      const sentAt = m.sentAt || m.createdAt || m.created_at || m.date || null
      const key = id ? `id:${id}` : `c:${sentAt || ''}|${body}`
      if (seen.has(key)) continue
      seen.add(key)
      // Direction detection — permissive on strings, strict on the default:
      // if we truly cannot classify, mark 'unknown' (never default to inbound,
      // that's the bug that let cold drips through). Regex-tolerant so shapes
      // like "outbound", "OUTGOING", "sms.outbound", "MT", "sent_by_agent"
      // all classify correctly.
      const rawDir = String(m.direction || m.type || m.status || '').toLowerCase().trim()
      let direction = 'unknown'
      if (/(^|[^a-z])(outbound|outgoing|sent|mt|from[_ ]?me|from[_ ]?agent|agent[_ ]?to)($|[^a-z])/i.test(rawDir)) direction = 'outbound'
      else if (/(^|[^a-z])(inbound|incoming|received|mo|reply|from[_ ]?contact|contact[_ ]?to)($|[^a-z])/i.test(rawDir)) direction = 'inbound'
      // Boolean field fallback (many APIs use these)
      if (direction === 'unknown') {
        if (m.outbound === true || m.isOutbound === true || m.fromMe === true || m.from_me === true || m.is_outgoing === true || m.sent_by_agent === true) direction = 'outbound'
        else if (m.inbound === true || m.isInbound === true || m.fromContact === true || m.from_contact === true || m.is_incoming === true) direction = 'inbound'
      }
      // "from" field fallback — if the from-number equals the agent's PP
      // number, it's outbound. We don't know the agent number here, so this
      // is a last-resort heuristic: presence of a bidirectional pair of
      // known agent-like flags. Kept as unknown otherwise.
      merged.push({ id, body, direction, sent_at: sentAt })
    }
  }
  return merged
}

// List PitchPrfct contacts filtered by tag name. PP's contact-list endpoint
// isn't in a stable public spec for our use case, so we fan out across
// several plausible URL shapes and merge the successful ones. Returns an
// array of { uuid, phone, first_name, last_name, tags[] }.
async function fetchPPContactsByTag(apiKey, tagName, limit = 500) {
  const t = encodeURIComponent(tagName)
  const attempts = [
    `${PITCHPRFCT_API}/contacts?tag=${t}&take=${limit}`,
    `${PITCHPRFCT_API}/contacts?tags=${t}&take=${limit}`,
    `${PITCHPRFCT_API}/contacts?tag_name=${t}&take=${limit}`,
    `${PITCHPRFCT_API}/contacts?filter%5Btag%5D=${t}&take=${limit}`,
    `${PITCHPRFCT_API}/tags/${t}/contacts?take=${limit}`,
  ]
  const settled = await Promise.allSettled(attempts.map(async (u) => {
    const r = await fetch(u, { headers: { 'x-api-key': apiKey } })
    return { url: u, ok: r.ok, status: r.status, text: await r.text() }
  }))
  const ok = settled.filter(s => s.status === 'fulfilled' && s.value.ok).map(s => s.value)
  const errors = settled.filter(s => s.status === 'fulfilled' && !s.value.ok).map(s => `${s.value.status}:${s.value.url.split('/api/v1')[1]}`)
  if (!ok.length) {
    console.error('[pp] fetchPPContactsByTag no 200s. attempts:', errors.join(' | '))
    return { contacts: [], errors }
  }
  const seen = new Set()
  const out = []
  for (const r of ok) {
    let raw
    try { raw = JSON.parse(r.text) } catch { continue }
    const list = (raw?.data?.rows || raw?.data?.contacts || raw?.data || raw?.contacts || (Array.isArray(raw) ? raw : []))
    if (!Array.isArray(list)) continue
    for (const c of list) {
      const uuid = c.uuid || c.id || c.contact_id || null
      if (!uuid || seen.has(uuid)) continue
      seen.add(uuid)
      // Client-side tag re-check: if the row has a tags array, confirm the
      // Positive tag is present. Some PP endpoints ignore filter params and
      // return everything — this keeps the bucket honest either way.
      const tags = c.tags || c.contactTags || c.tag_list || []
      const tagNames = Array.isArray(tags)
        ? tags.map(t => (typeof t === 'string' ? t : (t?.name || t?.label || '')).toString()).filter(Boolean)
        : []
      if (tagNames.length && !tagNames.some(n => n.toLowerCase() === tagName.toLowerCase())) continue
      // Custom fields: PP stores extra info in various shapes (custom_fields,
      // customFields, meta, attributes). Merge everything we recognize into
      // one bag so the focus view can display it.
      const customBag = {}
      const raw = c.custom_fields || c.customFields || c.attributes || c.meta || null
      if (raw && typeof raw === 'object') {
        // Array-of-{name,value} shape (common)
        if (Array.isArray(raw)) {
          for (const cf of raw) {
            const k = (cf?.name || cf?.key || cf?.label || '').toString()
            const v = cf?.value ?? cf?.val ?? ''
            if (k) customBag[k] = String(v)
          }
        } else {
          // Object map shape
          for (const [k, v] of Object.entries(raw)) {
            if (typeof v === 'string' || typeof v === 'number') customBag[k] = String(v)
          }
        }
      }
      out.push({
        uuid,
        phone: c.phone || c.phone_number || c.phoneNumber || '',
        first_name: c.first_name || c.firstName || c.name?.split(' ')?.[0] || '',
        last_name: c.last_name || c.lastName || (c.name?.split(' ')?.slice(1).join(' ')) || '',
        email: c.email || c.email_address || '',
        state: c.state || c.state_code || customBag.state || customBag.State || '',
        zip: c.zip || c.zip_code || c.postal_code || customBag.zip || customBag.Zip || '',
        city: c.city || customBag.city || customBag.City || '',
        dob: c.dob || c.date_of_birth || customBag.dob || customBag.DOB || '',
        source: c.source || customBag.source || customBag.Source || '',
        campaign: c.campaign || customBag.campaign || customBag.Campaign || '',
        // Every recognized custom field, in a flat map so the UI can list them
        custom_fields: customBag,
        tags: tagNames,
      })
    }
  }
  return { contacts: out, errors }
}

// Update the leads row's pp_response_status + checked timestamp.
async function patchLeadPPStatus(env, leadId, status, checkedAt) {
  try {
    const patch = { pp_response_status: status }
    if (checkedAt) patch.pp_response_checked_at = checkedAt
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    })
    if (!r.ok) console.error('[pp] patchLeadPPStatus failed', r.status)
  } catch (e) { console.error('[pp] patchLeadPPStatus threw', String(e)) }
}

// Verify + log — background task fired after a successful enroll. Waits 15
// seconds for PP to send the first workflow message, then confirms via the
// messages endpoint. Only logs the "Enrolled in workflow" activity if a real
// outbound message was actually sent in that window. Prevents misleading
// success entries when PP accepts the enroll but never actually texts.
async function verifyAndLogEnroll(env, userId, leadId, apiKey, contactUuid, workflowName) {
  try {
    await new Promise(res => setTimeout(res, 15000))
    const messages = await fetchPPMessages(apiKey, contactUuid, 10)
    const cutoff = Date.now() - 90 * 1000  // messages in the last 90 sec
    const hasFreshOutbound = messages.some(m => {
      if (m.direction !== 'outbound') return false
      if (!m.sent_at) return false
      const t = new Date(m.sent_at).getTime()
      return isFinite(t) && t >= cutoff
    })
    if (hasFreshOutbound) {
      await logEnrollActivity(env, userId, leadId, workflowName || '(unnamed)')
      console.log('[pp] verified — logged enroll for lead', leadId)
    } else {
      console.warn('[pp] enroll acknowledged but no outbound message within 15s for lead', leadId, '— skipping log')
    }
  } catch (e) { console.error('[pp] verifyAndLogEnroll threw', String(e)) }
}

// Orchestrator — called once per brand-new lead from the email() handler.
// Best-effort: any failure here is logged but never breaks lead insertion.
// Pass `ctx` (from the fetch/email/scheduled handler) so the post-enroll
// verification can run in the background via ctx.waitUntil() without blocking
// the response.
async function enrollLeadInPitch(env, userId, lead, ctx) {
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
    // Immediately mark as awaiting a reply so the card shows the tag.
    await patchLeadPPStatus(env, lead.id, 'awaiting', new Date().toISOString())
    // Verify a real outbound message actually went out before writing the
    // action-log entry. Runs in the background if ctx.waitUntil is available.
    const task = verifyAndLogEnroll(env, userId, lead.id, apiKey, contactUuid, pick.name || pick.id)
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task)
    else await task
  }
  return ok
}

// Cron scan runs every minute and does TWO passes:
//
//   Pass 1 — response detection: for every lead in 'awaiting' status, check
//   PP for inbound. If found, flip to 'responded'.
//
//   Pass 2 — self-heal for missed enrolls: find recent leads with NO
//   pp_response_status set. If they have a PP contact with any outbound
//   message, backfill status='awaiting' + write the "Auto-enrolled" activity
//   row. This catches leads whose original verifyAndLogEnroll missed (worker
//   restart, race condition, enrolled via a legacy code path pre-v4.23, etc.)
//   so agents always see the response pill + activity for anything PP actually
//   sent.
//
// Both passes bounded to 20 leads per tick so the PP rate limit stays safe.
async function scanForResponses(env) {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 15 * 60 * 1000).toISOString()

  // ── Pass 1: awaiting → responded
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/leads?pp_response_status=eq.awaiting&or=(pp_response_checked_at.is.null,pp_response_checked_at.lte.${encodeURIComponent(cutoff)})&select=id,phone,user_id&limit=20`
    const r = await fetch(url, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    })
    if (r.ok) {
      const leads = await r.json()
      if (Array.isArray(leads) && leads.length) {
        console.log('[pp-scan] checking', leads.length, 'awaiting leads')
        for (const lead of leads) {
          try {
            const apiKey = await getAgentApiKey(env, lead.user_id)
            if (!apiKey) continue
            const normPhone = coercePhoneE164(lead.phone)
            if (!normPhone) continue
            const contactUuid = await findContactByPhone(apiKey, normPhone)
            if (!contactUuid) {
              await patchLeadPPStatus(env, lead.id, 'awaiting', now.toISOString())
              continue
            }
            const messages = await fetchPPMessages(apiKey, contactUuid, 20)
            const hasInbound = messages.some(m => m.direction === 'inbound')
            if (hasInbound) {
              await patchLeadPPStatus(env, lead.id, 'responded', now.toISOString())
              console.log('[pp-scan] lead', lead.id, 'RESPONDED')
            } else {
              await patchLeadPPStatus(env, lead.id, 'awaiting', now.toISOString())
            }
          } catch (e) { console.error('[pp-scan] error on lead', lead.id, String(e)) }
        }
      }
    } else {
      console.error('[pp-scan] pass1 HTTP', r.status)
    }
  } catch (e) { console.error('[pp-scan] pass1 threw', String(e)) }

  // ── Pass 2: self-heal missed enrolls. Look at leads created in the last
  //    7 days whose pp_response_status is null/unknown. If they have PP
  //    outbound messages, they SHOULD be marked awaiting + logged.
  try {
    const lookback = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const url = `${env.SUPABASE_URL}/rest/v1/leads?or=(pp_response_status.is.null,pp_response_status.eq.unknown)&created_at=gte.${encodeURIComponent(lookback)}&select=id,phone,user_id&limit=20&order=created_at.desc`
    const r = await fetch(url, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    })
    if (!r.ok) { console.error('[pp-scan] pass2 HTTP', r.status); return }
    const leads = await r.json()
    if (!Array.isArray(leads) || leads.length === 0) return
    console.log('[pp-scan] self-heal checking', leads.length, 'unstatused leads')
    for (const lead of leads) {
      try {
        const apiKey = await getAgentApiKey(env, lead.user_id)
        if (!apiKey) continue
        const normPhone = coercePhoneE164(lead.phone)
        if (!normPhone) continue
        const contactUuid = await findContactByPhone(apiKey, normPhone)
        if (!contactUuid) continue  // no PP contact = never enrolled, leave status null
        const messages = await fetchPPMessages(apiKey, contactUuid, 20)
        const hasOutbound = messages.some(m => m.direction === 'outbound')
        if (!hasOutbound) continue  // contact exists but no outbound = not really enrolled
        // Something was sent. Determine current state.
        const hasInbound = messages.some(m => m.direction === 'inbound')
        const newStatus = hasInbound ? 'responded' : 'awaiting'
        await patchLeadPPStatus(env, lead.id, newStatus, now.toISOString())
        // Backfill activity log entry if one doesn't already exist for this lead.
        // Cheapest: query for any Auto-enrolled activity — insert only if absent.
        const activityUrl = `${env.SUPABASE_URL}/rest/v1/activities?lead_id=eq.${lead.id}&note=like.Auto-enrolled*&select=id&limit=1`
        const ar = await fetch(activityUrl, {
          headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
        })
        const existing = ar.ok ? await ar.json() : []
        if (!Array.isArray(existing) || existing.length === 0) {
          await logEnrollActivity(env, lead.user_id, lead.id, '(recovered)')
          console.log('[pp-scan] SELF-HEAL lead', lead.id, '→', newStatus, '+ backfilled activity')
        } else {
          console.log('[pp-scan] SELF-HEAL lead', lead.id, '→', newStatus, '(activity already existed)')
        }
      } catch (e) { console.error('[pp-scan] self-heal error on lead', lead.id, String(e)) }
    }
  } catch (e) { console.error('[pp-scan] pass2 threw', String(e)) }
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
async function schedulePitchForLead(env, userId, lead, ctx) {
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
    await enrollLeadInPitch(env, userId, lead, ctx)
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
  await enrollLeadInPitch(env, userId, lead, ctx)
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
async function processQueueRow(env, row, ctx) {
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
  const ok = await enrollLeadInPitch(env, row.user_id, lead, ctx)
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
async function runQueue(env, ctx) {
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
    for (const row of due) await processQueueRow(env, row, ctx)
  } catch (e) { console.error('[cron] runQueue threw', String(e)) }
}

// ─── Worker entry points ───────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx) {
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
        version: 'v4.37',
        parser: 'warm bucket: simplified — Positive tag + newest is outbound = in bucket',
        deployed_check: 'if you see v4.37 here, the deploy succeeded',
      }), { status: 200, headers: { 'content-type': 'application/json', ...CORS } })
    }
    // Public API v1 — auth via X-API-Key. All routes under /api/v1/*.
    if (url.pathname.startsWith('/api/v1')) {
      return handleApiV1(url, req, env, ctx)
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
    // Conversation scan — pull the most recent N messages between the agent's
    // PitchPrfct account and a given phone number, so the LeadDetail can show
    // a quick "have we already talked / did they opt out" summary without the
    // agent having to flip over to PitchPrfct in another tab.
    //   GET /pp-conversation?agent_id=UUID&phone=+1...&limit=5
    if (req.method === 'GET' && url.pathname === '/pp-conversation') {
      const cAgent = url.searchParams.get('agent_id')
      const cPhoneRaw = url.searchParams.get('phone') || ''
      const cLimit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit'), 10) || 5))
      if (!cAgent || !cPhoneRaw) {
        return new Response(JSON.stringify({ error: 'missing agent_id or phone' }), {
          status: 400, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const cPhone = coercePhoneE164(cPhoneRaw)
      if (!cPhone) {
        return new Response(JSON.stringify({ error: `phone "${cPhoneRaw}" doesn't look like a US number` }), {
          status: 400, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const cKey = await getAgentApiKey(env, cAgent)
      if (!cKey) {
        return new Response(JSON.stringify({ error: 'no PitchPrfct API key saved for this agent' }), {
          status: 404, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      // Find the contact UUID first — most messages-API patterns key off it.
      const cUuid = await findContactByPhone(cKey, cPhone)
      if (!cUuid) {
        return new Response(JSON.stringify({ ok: true, messages: [], note: 'no PitchPrfct contact found for this phone' }), {
          status: 200, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      // PitchPrfct's messages-list endpoint isn't in their public OpenAPI spec
      // (only POST /messages is documented). Fire ALL likely REST patterns in
      // PARALLEL, then MERGE messages from every successful response — some
      // endpoints return empty 200 while others return the data, so picking
      // the "first 200" was making us miss messages and need a retry.
      const attempts = [
        `${PITCHPRFCT_API}/contacts/${encodeURIComponent(cUuid)}/messages?take=${cLimit * 3}`,
        `${PITCHPRFCT_API}/messages?contactUuid=${encodeURIComponent(cUuid)}&take=${cLimit * 3}`,
        `${PITCHPRFCT_API}/messages?contact_id=${encodeURIComponent(cUuid)}&take=${cLimit * 3}`,
        `${PITCHPRFCT_API}/conversations/${encodeURIComponent(cUuid)}?take=${cLimit * 3}`,
      ]
      // Walk a PP API response of any shape and pull the messages array.
      const extractList = (rawText) => {
        let raw
        try { raw = JSON.parse(rawText) } catch { return [] }
        const list = (raw && raw.data && (raw.data.rows || raw.data.messages || raw.data)) ||
                     (raw && raw.messages) ||
                     (Array.isArray(raw) ? raw : [])
        return Array.isArray(list) ? list : []
      }
      // Run all 4 attempts in parallel. Returns merged + normalized message
      // array from every 200 response.
      const runRound = async (pass) => {
        const settled = await Promise.allSettled(attempts.map(async (u) => {
          try {
            const r = await fetch(u, { headers: { 'x-api-key': cKey } })
            const text = await r.text()
            console.log(`[pp-conv] pass${pass}`, u, '→', r.status, text.slice(0, 140))
            return { url: u, status: r.status, ok: r.ok, text }
          } catch (e) {
            console.error('[pp-conv] threw on', u, String(e))
            throw e
          }
        }))
        const ok200s = settled.filter(s => s.status === 'fulfilled' && s.value.ok).map(s => s.value)
        const lastFail = settled.find(s => s.status === 'fulfilled' && !s.value.ok)
        return { ok200s, lastFail: lastFail ? lastFail.value : null }
      }
      const round1 = await runRound(1)
      let merged = round1.ok200s.flatMap(r => extractList(r.text))
      // Eventual-consistency retry: if every endpoint returned empty on pass 1
      // (but the contact exists), wait briefly and try once more. Cheap
      // insurance against "needed two clicks to find" behavior.
      if (merged.length === 0 && round1.ok200s.length > 0) {
        await new Promise(res => setTimeout(res, 600))
        const round2 = await runRound(2)
        merged = round2.ok200s.flatMap(r => extractList(r.text))
      }
      // No 200 at all → real upstream failure
      if (round1.ok200s.length === 0) {
        const status = round1.lastFail ? round1.lastFail.status : 0
        const body = round1.lastFail ? round1.lastFail.text : ''
        return new Response(JSON.stringify({
          error: 'PitchPrfct messages endpoint not reachable',
          tried: attempts,
          upstream_status: status,
          upstream_body: body.slice(0, 400),
        }), { status: 502, headers: { 'content-type': 'application/json', ...CORS } })
      }
      // Dedupe by id, then by composite (body+sent_at). Sort newest first.
      const seen = new Set()
      const messages = []
      for (const m of merged) {
        const id = m.id || m.uuid || null
        const body = (m.body || m.message || m.text || m.content || '').trim()
        const sentAt = m.sentAt || m.createdAt || m.created_at || m.date || null
        const dedupeKey = id ? `id:${id}` : `c:${sentAt || ''}|${body}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        messages.push({
          id,
          body,
          direction:
            (m.direction || m.type ||
             (m.outbound || m.isOutbound || m.fromMe ? 'outbound' : 'inbound')).toString().toLowerCase(),
          sent_at: sentAt,
          status: m.status || m.deliveryStatus || null,
        })
      }
      // Sort newest → oldest, then slice to requested limit
      messages.sort((a, b) => {
        const ta = a.sent_at ? new Date(a.sent_at).getTime() : 0
        const tb = b.sent_at ? new Date(b.sent_at).getTime() : 0
        return tb - ta
      })
      const trimmed = messages.slice(0, cLimit)
      console.log('[pp-conv] returning', trimmed.length, 'messages (merged from', round1.ok200s.length, '2xx responses)')
      return new Response(JSON.stringify({ ok: true, contact_uuid: cUuid, messages: trimmed }), {
        status: 200, headers: { 'content-type': 'application/json', ...CORS },
      })
    }

    // Warm Bucket scan — pulls PP contacts tagged "Positive" who've gone
    // quiet after Nic's last outbound. Frontend calls this from the Warm
    // Bucket page with an agent_id + hours window (default 24). Returns
    // matches with the last 5 messages for immediate context.
    //
    //   GET /warm-bucket/scan?agent_id=UUID&hours=24&tag=Positive
    //
    // Filter logic — trust the tag. If Nic tagged them Positive, the tag
    // itself IS the engagement proof; no need to re-verify with message
    // heuristics that misclassify PP's system events. Just show:
    //   1) Contact has the tag (default "Positive", case-insensitive).
    //   2) Contact's most recent message is within the `hours` window.
    //   3) The newest message is OUTBOUND — they haven't replied to it yet.
    if (req.method === 'GET' && url.pathname === '/warm-bucket/scan') {
      const wbAgent = url.searchParams.get('agent_id')
      const wbHours = Math.max(1, Math.min(720, parseInt(url.searchParams.get('hours'), 10) || 24))
      const wbTag = url.searchParams.get('tag') || 'Positive'
      if (!wbAgent) {
        return new Response(JSON.stringify({ error: 'missing agent_id' }), {
          status: 400, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const wbKey = await getAgentApiKey(env, wbAgent)
      if (!wbKey) {
        return new Response(JSON.stringify({ error: 'no PitchPrfct API key saved for this agent' }), {
          status: 404, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      try {
        const now = Date.now()
        const windowStart = now - wbHours * 60 * 60 * 1000
        const { contacts, errors } = await fetchPPContactsByTag(wbKey, wbTag)
        if (!contacts.length) {
          return new Response(JSON.stringify({
            ok: true, matches: [],
            note: `No contacts returned from PP for tag "${wbTag}". PP endpoint attempts: ${errors.join(', ') || 'all 200s but empty results'}. Check tag name is exact (case-insensitive).`,
          }), { status: 200, headers: { 'content-type': 'application/json', ...CORS } })
        }
        console.log('[warm-bucket] scanning', contacts.length, 'tagged contacts for agent', wbAgent, 'window', wbHours + 'h')
        const matches = []
        const skipCounts = { no_msgs: 0, bad_ts: 0, out_of_window: 0, newest_not_out: 0 }
        const skipSamples = []  // first ~5 skips with detail
        // Scan up to 300 tagged contacts. Nic can have hundreds of Positives
        // and the interesting warm ones aren't always first in PP's list.
        // Run in concurrent batches of 15 so PP isn't blasted but we still
        // process 300 in ~10-20s of CPU (well inside Cloudflare's budget).
        const capped = contacts.slice(0, 300)
        const BATCH_SIZE = 15
        const processContact = async (c) => {
          try {
            const rawMsgs = await fetchPPMessages(wbKey, c.uuid, 30)
            // Only count messages with actual body text. PP's messages
            // endpoint mixes in system events (workflow started, tag added,
            // notifications) that have no body — those were falsely inflating
            // hasInbound and letting drip-only contacts through.
            const msgs = rawMsgs.filter(m => m.body && m.body.trim())
            const noteSkip = (reason, extra = {}) => {
              skipCounts[reason] = (skipCounts[reason] || 0) + 1
              if (skipSamples.length < 5) {
                skipSamples.push({
                  contact: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.uuid,
                  phone: c.phone,
                  reason,
                  msg_count: msgs.length,
                  directions: msgs.slice(0, 5).map(m => m.direction),
                  ...extra,
                })
              }
            }
            if (!msgs.length) { noteSkip('no_msgs'); return }
            msgs.sort((a, b) => (new Date(b.sent_at || 0)).getTime() - (new Date(a.sent_at || 0)).getTime())
            const newest = msgs[0]
            const newestTs = new Date(newest.sent_at || 0).getTime()
            if (!isFinite(newestTs) || newestTs === 0) { noteSkip('bad_ts'); return }
            if (newestTs < windowStart) { noteSkip('out_of_window', { newest_at: newest.sent_at }); return }
            // Only rule left: the newest message must be OUTBOUND from us —
            // meaning they haven't replied to it yet. Nic already curates the
            // Positive tag manually, so we trust that engagement happened.
            const isOutbound = newest.direction === 'outbound'
            if (!isOutbound) { noteSkip('newest_not_out', { newest_dir: newest.direction }); return }
            // Per-contact stats — surfaced on each match so we can verify the
            // worker's classification against what the UI displays. If a
            // match shows 0 inbound in the UI but this reports 1+, we know
            // PP's returning something my classifier tags as inbound that
            // the UI is hiding (e.g. a system event with a hidden body).
            const inboundCount = msgs.filter(m => m.direction === 'inbound').length
            const outboundCount = msgs.filter(m => m.direction === 'outbound').length
            const unknownCount = msgs.filter(m => m.direction === 'unknown').length
            const rawCount = rawMsgs.length
            const _msg_stats = { total_from_pp: rawCount, with_body: msgs.length, inbound: inboundCount, outbound: outboundCount, unknown: unknownCount }
            // Match — keep the full recent history (oldest→newest so the UI
            // reads chronologically). Focus mode shows all of them.
            const history = msgs.slice().reverse()
            matches.push({
              pp_contact_uuid: c.uuid,
              phone: c.phone,
              first_name: c.first_name,
              last_name: c.last_name,
              // PP contact fields — surfaced in the focus view so Nic has
              // real context on the call, not just a phone number.
              email: c.email,
              state: c.state,
              zip: c.zip,
              city: c.city,
              dob: c.dob,
              source: c.source,
              campaign: c.campaign,
              custom_fields: c.custom_fields,
              tags: c.tags,
              last_outbound_at: newest.sent_at,
              recent_messages: history,
              _msg_stats,
            })
          } catch (e) {
            console.error('[warm-bucket] contact', c.uuid, 'threw', String(e))
          }
        }
        // Run in concurrent batches. Cloudflare Workers handle plenty of
        // concurrent subrequests; keeping the batch at 15 stays polite to
        // PP and finishes 300 contacts in a few seconds.
        for (let i = 0; i < capped.length; i += BATCH_SIZE) {
          const batch = capped.slice(i, i + BATCH_SIZE)
          await Promise.allSettled(batch.map(processContact))
        }
        console.log('[warm-bucket]', matches.length, 'matches · skip counts:', skipCounts)
        const debug = matches.length === 0
          ? { contacts_found_by_tag: contacts.length, scanned: capped.length, skip_counts: skipCounts, skip_samples: skipSamples }
          : undefined
        return new Response(JSON.stringify({ ok: true, matches, scanned: capped.length, tag: wbTag, hours: wbHours, debug }), {
          status: 200, headers: { 'content-type': 'application/json', ...CORS },
        })
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e?.message || e) }), {
          status: 500, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
    }

    // Unenroll a contact from ALL PitchPrfct workflows. Called from the CRM
    // frontend whenever a lead moves to a stage that means "stop texting them"
    // (apt/sold/stop/dnq). Fire-and-forget from the frontend — a failure
    // doesn't block the stage change.
    //
    //   POST /pp-unenroll  { agent_id, lead_id }  OR  { agent_id, phone }
    //
    // Looks up the PP contact via phone, then fans out unenroll attempts.
    if (req.method === 'POST' && url.pathname === '/pp-unenroll') {
      let payload = {}
      try { payload = await req.json() } catch {
        return new Response(JSON.stringify({ error: 'bad json' }), {
          status: 400, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const agentId = payload.agent_id
      const leadId = payload.lead_id
      let phone = payload.phone
      if (!agentId || (!leadId && !phone)) {
        return new Response(JSON.stringify({ error: 'missing agent_id and (lead_id or phone)' }), {
          status: 400, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      // Resolve lead → phone if only lead_id was given
      if (!phone && leadId) {
        try {
          const r = await fetch(`${env.SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=phone&limit=1`, {
            headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
          })
          const rows = r.ok ? await r.json() : []
          phone = rows?.[0]?.phone
        } catch {}
      }
      const normPhone = coercePhoneE164(phone || '')
      if (!normPhone) {
        return new Response(JSON.stringify({ error: 'lead has no usable phone' }), {
          status: 400, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const apiKey = await getAgentApiKey(env, agentId)
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'no PitchPrfct API key saved for this agent' }), {
          status: 404, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const contactUuid = await findContactByPhone(apiKey, normPhone)
      if (!contactUuid) {
        // No PP contact means nothing to unenroll — treat as success so callers
        // don't retry noisily.
        return new Response(JSON.stringify({ ok: true, note: 'no PitchPrfct contact for this phone — nothing to unenroll' }), {
          status: 200, headers: { 'content-type': 'application/json', ...CORS },
        })
      }
      const result = await unenrollAllPPWorkflows(apiKey, contactUuid)
      // Also cancel any pending queue row for this lead so a delayed enroll
      // doesn't fire AFTER we unenrolled.
      if (leadId) {
        try {
          await fetch(`${env.SUPABASE_URL}/rest/v1/pitchprfct_queue?lead_id=eq.${encodeURIComponent(leadId)}&status=eq.pending`, {
            method: 'PATCH',
            headers: {
              apikey: env.SUPABASE_SERVICE_KEY,
              authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'content-type': 'application/json',
              prefer: 'return=minimal',
            },
            body: JSON.stringify({ status: 'cancelled' }),
          })
        } catch {}
      }
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 502,
        headers: { 'content-type': 'application/json', ...CORS },
      })
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
      // Immediately mark as awaiting so the card shows the tag right away.
      await patchLeadPPStatus(env, leadId, 'awaiting', new Date().toISOString())
      // Verify + log in the background so the HTTP response returns fast.
      // The action-log entry only appears if PP actually sent a message.
      const verifyTask = verifyAndLogEnroll(
        env, agentId, leadId, apiKey, contactUuid,
        workflowName ? `Manually → ${workflowName}` : 'Manual enroll'
      )
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(verifyTask)
      else verifyTask.catch(() => {})
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

  async email(message, env, ctx) {
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
      lead.source = 'USHA Marketplace (worker v4.23)'
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
        await schedulePitchForLead(env, userId, { ...lead, id: insertedId }, ctx)
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
    await runQueue(env, ctx)
    // Also scan for lead responses on each cron tick — bounded to 20 leads
    // per run so we never blow PP's rate limit. Only re-checks any given lead
    // every 15 minutes to avoid pointless churn.
    await scanForResponses(env)
  },
}
