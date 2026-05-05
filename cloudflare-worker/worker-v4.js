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
  'murray-leads@infinite-crm.net':  '01ef1bd7-f5d1-4279-bf9b-15a02eec5f4a',
  'anthony-leads@infinite-crm.net': '2b3fe8bf-e932-4672-be4e-5a998c223fdd',
  'palma-leads@infinite-crm.net':   '3c1b5bcc-1682-46c1-9298-5c0667bfc9bb',
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

// Find the text/plain (preferred) or text/html part of a MIME message.
// Returns the decoded body (plain text). Strips HTML tags if html-only.
function extractBody(raw) {
  const headerEnd = raw.indexOf('\r\n\r\n')
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
      const pHeaders = part.slice(0, pHeaderEnd).toLowerCase()
      let pBody = part.slice(pHeaderEnd + 4)
      const cte = (pHeaders.match(/content-transfer-encoding:\s*([^\r\n]+)/) || [])[1] || ''
      if (cte.includes('quoted-printable')) pBody = decodeQuotedPrintable(pBody)
      else if (cte.includes('base64')) {
        try { pBody = atob(pBody.replace(/\s+/g, '')) } catch {}
      }
      if (pHeaders.includes('text/plain')) plain += pBody + '\n'
      else if (pHeaders.includes('text/html')) html += pBody + '\n'
    }
    if (plain) return plain
    if (html) return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '\n')
    return body
  }

  // Single-part
  const cte = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i) || [])[1] || ''
  if (cte.toLowerCase().includes('quoted-printable')) body = decodeQuotedPrintable(body)
  else if (cte.toLowerCase().includes('base64')) {
    try { body = atob(body.replace(/\s+/g, '')) } catch {}
  }
  if (contentType.includes('html')) body = body.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '\n')
  return body
}

// ─── Field extraction from a normalized text body ──────────────────────────
function fieldGetter(text) {
  return (label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp('(?:^|\\n)\\s*' + escaped + '\\s*:\\s*([^\\n\\r]+)', 'i')
    const m = text.match(re)
    if (!m) return ''
    return m[1].trim().replace(/\s+/g, ' ')
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
    income:        parseMoneyToInt(get('Income')),  // INT column — handles ranges
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

// ─── Worker entry points ───────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (req.method !== 'POST' || !url.pathname.startsWith('/leads')) {
      return new Response('infinite-crm-webhook v4 — POST /leads?agent_id=UUID', { status: 200 })
    }
    const agentId = url.searchParams.get('agent_id')
    if (!agentId) return new Response(JSON.stringify({ error: 'missing agent_id' }), { status: 400 })
    let body = {}
    try { body = await req.json() } catch { return new Response('bad json', { status: 400 }) }
    const lead = {
      ...body,
      user_id: agentId,
      agent_id: agentId,
      stage: body.stage || DEFAULT_STAGE,
      created_at: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    }
    const result = await insertLead(env, lead)
    return new Response(JSON.stringify({ ok: result.ok, status: result.status, lead: result.body.slice(0, 1000) }), {
      status: result.ok ? 200 : 500,
      headers: { 'content-type': 'application/json' },
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
      if (!result.ok) {
        console.error('[email] INSERT FAILED', { status: result.status, body: result.body.slice(0, 800), lead: JSON.stringify(lead).slice(0, 1500) })
        // Last-resort: write a stub row so the failure is visible in the CRM
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
      } else {
        console.log('[email] INSERTED ok', { fields: Object.keys(lead) })
      }
    } catch (e) {
      console.error('[email] EXCEPTION', String(e), e?.stack)
    }
  },
}
