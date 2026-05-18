// Infinite CRM Email Worker — v4 (rich USHA parsing, zero-dep)
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

const AGENT_ROUTING = {
  'murray-leads@infinite-crm.net':   '01ef1bd7-f5d1-4279-bf9b-15a02eec5f4a',
  'anthony-leads@infinite-crm.net':  '2b3fe8bf-e932-4672-be4e-5a998c223fdd',
  'palma-leads@infinite-crm.net':    '3c1b5bcc-1682-46c1-9298-5c0667bfc9bb',
  'dylan-leads@infinite-crm.net':    'f262eda2-f2bd-421e-bffa-4c7ea0b668db',
  'katerina-leads@infinite-crm.net': '2e01afc5-5afe-48f6-b618-3b94afe0f5fc',
  'andres-leads@infinite-crm.net':   '76faad76-bb01-4722-aa7b-5cae665cdb57',
  'doug-leads@infinite-crm.net':     'e396e3fa-16d7-4948-bb19-23ba73cc82c4',
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
function stripHtmlAndQp(s) {
  if (!s) return ''
  return String(s)
    // QP soft line breaks
    .replace(/=\r?\n/g, '')
    // QP hex sequences (=3D → =, =20 → space, etc.)
    .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // Drop <style>/<script> blocks
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Convert <br> to newline, then strip every other tag (no leftover <
    // even if the tag is unterminated)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>?/g, '')
    // Common HTML entities seen in marketplace emails
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
}

// Find the text/plain (preferred) or text/html part of a MIME message.
// Returns the decoded body (plain text). Handles NESTED multipart by recursing
// into any multipart/* child part — necessary for USHA Lead Arena emails that
// ship multipart/mixed → multipart/alternative → html.
function extractBody(raw) {
  const headerEnd = raw.indexOf('\r\n\r\n')
  if (headerEnd < 0) return stripHtmlAndQp(raw)
  const headers = raw.slice(0, headerEnd)
  let body = raw.slice(headerEnd + 4)

  const ctMatch = headers.match(/content-type:\s*([^\r\n;]+)(;\s*boundary="?([^"\r\n]+)"?)?/i)
  const contentType = ctMatch ? ctMatch[1].trim().toLowerCase() : 'text/plain'
  const boundary = ctMatch && ctMatch[3]

  if (boundary && contentType.startsWith('multipart/')) {
    const parts = body.split('--' + boundary)
    let plain = '', html = ''
    for (const part of parts) {
      const pHeaderEnd = part.indexOf('\r\n\r\n')
      if (pHeaderEnd < 0) continue
      const pHeadersRaw = part.slice(0, pHeaderEnd)
      const pHeaders = pHeadersRaw.toLowerCase()
      let pBody = part.slice(pHeaderEnd + 4)
      const cte = (pHeaders.match(/content-transfer-encoding:\s*([^\r\n]+)/) || [])[1] || ''
      // Recurse into nested multipart — common in marketplace emails where the
      // outer is multipart/mixed and the actual text lives inside an inner
      // multipart/alternative.
      if (pHeaders.match(/content-type:\s*multipart\//)) {
        const inner = extractBody(part)
        if (inner) plain += inner + '\n'
        continue
      }
      if (cte.includes('quoted-printable')) pBody = decodeQuotedPrintable(pBody)
      else if (cte.includes('base64')) {
        try { pBody = atob(pBody.replace(/\s+/g, '')) } catch {}
      }
      if (pHeaders.includes('text/plain')) plain += pBody + '\n'
      else if (pHeaders.includes('text/html')) html += pBody + '\n'
    }
    if (plain) return plain
    if (html) return stripHtmlAndQp(html)
    return stripHtmlAndQp(body)
  }

  // Single-part
  const cte = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i) || [])[1] || ''
  if (cte.toLowerCase().includes('quoted-printable')) body = decodeQuotedPrintable(body)
  else if (cte.toLowerCase().includes('base64')) {
    try { body = atob(body.replace(/\s+/g, '')) } catch {}
  }
  if (contentType.includes('html')) body = stripHtmlAndQp(body)
  return body
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

// ─── Worker entry points ───────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
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
      const body = extractBody(raw)
      const userId = AGENT_ROUTING[recipient]
      if (!userId) {
        console.error('[email] no AGENT_ROUTING entry for', recipient)
        return
      }
      const lead = parseLead(body)
      lead.user_id = userId
      lead.agent_id = userId
      lead.source = 'USHA Marketplace'
      lead.stage = DEFAULT_STAGE
      lead.created_at = new Date().toISOString()
      lead.last_activity = lead.created_at

      console.log('[email] parsed lead fields:', Object.keys(lead).join(','))
      const result = await insertLead(env, lead)
      if (result.ok) {
        console.log('[email] INSERTED ok', { fields: Object.keys(lead) })
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
}
