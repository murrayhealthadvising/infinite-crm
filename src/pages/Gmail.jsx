import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import {
  Mail, RefreshCw, Plus, Zap, Check, X, ExternalLink, Copy,
  ChevronDown, ChevronUp, ShieldCheck, AlertCircle,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'

// Per-agent forwarding address. Cloudflare Email Routing has 3 active routes.
const FORWARD_BY_EMAIL = {
  'murrayhealthadvising@gmail.com': 'murray-leads@infinite-crm.net',
  'coveragebyag@gmail.com':         'anthony-leads@infinite-crm.net',
  'apalmahealth@gmail.com':         'palma-leads@infinite-crm.net',
}

function forwardAddressFor(email) {
  if (!email) return null
  if (FORWARD_BY_EMAIL[email]) return FORWARD_BY_EMAIL[email]
  // Fallback: derive from local-part of email
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${local}-leads@infinite-crm.net`
}

// ─── USHA email parser (manual paste fallback) ───────────────────────────────
// Strict regex: label MUST be at start-of-line and value is everything until
// end-of-line. Stops the old bug where 'State: LA\nBusiness Name:' captured
// 'LA Business Name:' as the state.
function parseUSHAEmail(body) {
  const get = (label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Only match horizontal whitespace [ \t] around label/colon. Newlines
    // would let an empty field like 'Zip:\n' grab the next label's text.
    const re = new RegExp('(?:^|\\n)[ \\t]*' + escaped + '[ \\t]*:[ \\t]*([^\\n\\r]+)', 'i')
    const m = body.match(re)
    if (!m) return ''
    const v = m[1].trim().replace(/<[^>]+>/g, '')
    // If the captured value looks like a USHA label (e.g. 'DOB:'), treat as empty
    if (/^[A-Za-z][A-Za-z ]*:$/.test(v)) return ''
    return v.replace(/\s+/g, ' ')
  }
  // Smoker only counts if the value clearly says yes / true / 1 — anything
  // else (empty, 'no', 'false', random label leakage) means non-smoker.
  const smokerRaw = (get('Smoker') || '').toLowerCase().trim()
  const smoker = (smokerRaw === 'yes' || smokerRaw === 'true' || smokerRaw === '1' || smokerRaw === 'y') ? 'Yes' : ''
  // Household: 'Family' / 'Couple' / 'Individual' / int — keep whatever's parseable
  const householdRaw = get('Household')
  let household = null
  if (householdRaw) {
    const n = parseInt(householdRaw)
    if (isFinite(n) && n > 0) household = n
    else if (householdRaw.toLowerCase() === 'individual') household = 1
    else if (householdRaw.toLowerCase() === 'couple') household = 2
  }
  return {
    first_name: get('First Name') || 'Unknown',
    last_name: get('Last Name') || '',
    phone: get('Primary Phone') || get('Phone') || '',
    email: get('Email') || '',
    state: get('State') || '',
    zip: get('Zip') || '',
    city: get('City') || '',
    address: get('Address') || '',
    dob: get('Date of Birth') || get('DOB') || '',
    gender: get('Gender') || '',
    age: get('Age') || '',
    age_range: get('Age Range') || '',
    // Keep income as a string so ranges like "$50,000 - $75,000" survive
    // verbatim. Exact values like "$30,000" also stored as text.
    income: get('Income') || '',
    household,
    smoker,
    comments: get('Comments') || '',
    plan_choice: get('Plan Choice') || '',
    monthly_budget: get('Monthly Budget') || '',
    campaign: get('Name') || '',
    external_id: get('Lead Id') || '',
    source: 'USHA Marketplace',
  }
}

// ─── Live status panel ───────────────────────────────────────────────────────
function CloudflareStatus({ user, leads }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const forward = forwardAddressFor(user?.email)

  const copy = (s) => {
    navigator.clipboard.writeText(s)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  // Count of email-imported leads in the last 24h / 7d
  const stats = useMemo(() => {
    const safe = Array.isArray(leads) ? leads : []
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const isUsha = (l) => (l.source || '').toLowerCase().includes('usha') || (l.source || '').toLowerCase().includes('marketplace')
    return {
      last24h: safe.filter(l => isUsha(l) && (now - new Date(l.created_at || 0).getTime() < day)).length,
      last7d: safe.filter(l => isUsha(l) && (now - new Date(l.created_at || 0).getTime() < 7 * day)).length,
      total: safe.filter(isUsha).length,
    }
  }, [leads])

  return (
    <div className="rounded-xl border border-[#00E5C330] overflow-hidden mb-6" style={{ background: '#00E5C308' }}>
      <div className="px-5 py-4 flex items-center gap-3 border-b border-[#1A2130]">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          <ShieldCheck size={18} className="text-black" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">Email auto-import is LIVE</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase"
              style={{ background: '#00E5C320', color: '#00E5C3' }}>
              Cloudflare Worker
            </span>
          </div>
          <p className="text-xs text-[#8899AA] mt-0.5">
            USHA Marketplace leads forwarded to your address below land in this CRM in &lt;1s.
          </p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Forwarding address */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-2">Your forwarding address</p>
          {forward ? (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-[#00E5C320]" style={{ background: '#080B0F' }}>
              <code className="text-sm text-[#00E5C3] font-mono flex-1 truncate">{forward}</code>
              <button onClick={() => copy(forward)}
                className="p-1.5 rounded text-[#5A6A7A] hover:text-white transition-colors flex-shrink-0">
                {copied ? <Check size={14} className="text-[#00E5C3]" /> : <Copy size={14} />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-[#F59E0B30] text-[#F59E0B] text-xs" style={{ background: '#F59E0B08' }}>
              <AlertCircle size={14} />
              No forwarding address provisioned for {user?.email || 'your account'}. Ask the admin to add one.
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg border border-[#1A2130]" style={{ background: '#0A0E14' }}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">Last 24h</p>
            <p className="text-2xl font-bold text-[#00E5C3] mt-1">{stats.last24h}</p>
          </div>
          <div className="p-3 rounded-lg border border-[#1A2130]" style={{ background: '#0A0E14' }}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">Last 7 days</p>
            <p className="text-2xl font-bold text-white mt-1">{stats.last7d}</p>
          </div>
          <div className="p-3 rounded-lg border border-[#1A2130]" style={{ background: '#0A0E14' }}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">All-time USHA</p>
            <p className="text-2xl font-bold text-white mt-1">{stats.total}</p>
          </div>
        </div>

        {/* How it works (collapsible) */}
        <button onClick={() => setOpen(v => !v)}
          className="text-xs text-[#8899AA] hover:text-white flex items-center gap-1.5 transition-colors">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          How it works
        </button>
        {open && (
          <div className="pt-2 space-y-3">
            {[
              { n: 1, title: 'USHA sends you a lead email', desc: `From leads@ushamarketplace.com to ${user?.email || 'your Gmail'}` },
              { n: 2, title: 'Gmail filter forwards it', desc: `Subject "New Lead" → forwards to ${forward || '<your forward address>'}` },
              { n: 3, title: 'Cloudflare Email Worker fires', desc: 'Parses every field, inserts into Supabase, source = USHA Marketplace' },
              { n: 4, title: 'Lead appears in your CRM', desc: 'Realtime: pops in at the top of /leads instantly, no refresh needed' },
            ].map(s => (
              <div key={s.n} className="flex gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                  style={{ background: '#00E5C320', color: '#00E5C3' }}>{s.n}</div>
                <div>
                  <p className="text-sm text-white font-medium">{s.title}</p>
                  <p className="text-xs text-[#5A6A7A] mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-[#3A4A5A] mt-3">
              First-time setup: in Gmail → Settings → Filters & Blocked Addresses, create a filter for
              <code className="text-[#5A6A7A] mx-1">from:leads@ushamarketplace.com</code>
              and forward to your address above. (Verify the address from your inbox once.)
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Manual paste fallback (kept as-is) ──────────────────────────────────────
function ManualParse({ addLead }) {
  const navigate = useNavigate()
  const [emailText, setEmailText] = useState('')
  const [preview, setPreview] = useState(null)
  const [imported, setImported] = useState(false)

  const parse = () => {
    if (!emailText.trim()) return
    const parsed = parseUSHAEmail(emailText)
    setPreview(parsed)
    setImported(false)
  }

  const importLead = async () => {
    if (typeof addLead !== 'function') return
    const lead = await addLead(preview)
    if (lead?.id) setImported(lead.id)
  }

  return (
    <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
      <div className="px-5 py-4 border-b border-[#1A2130]">
        <p className="text-sm font-semibold text-white">Manual paste (one-off backup)</p>
        <p className="text-xs text-[#5A6A7A] mt-0.5">If a USHA email slipped through the filter or you got it on the wrong account, paste the body here.</p>
      </div>
      <div className="p-5">
        <textarea
          value={emailText}
          onChange={e => { setEmailText(e.target.value); setPreview(null); setImported(false) }}
          placeholder={`First Name: …\nLast Name: …\nPrimary Phone: …\nEmail: …\nState: …\nZip: …\nDate of Birth: …\nGender: …\nIncome: $…\nHousehold: …\nComments: …`}
          rows={8}
          className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-[#C0D0E0] placeholder-[#2A3547] focus:outline-none focus:border-[#00E5C340] resize-none font-mono"
        />
        <button onClick={parse}
          className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-black"
          style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          Parse Email
        </button>

        {preview && (
          <div className="mt-4 p-4 rounded-xl border border-[#00E5C320]" style={{ background: '#00E5C308' }}>
            <p className="text-xs font-mono uppercase tracking-wider text-[#00E5C3] mb-3">Parsed Lead Preview</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                ['Name', `${preview.first_name} ${preview.last_name}`],
                ['Phone', preview.phone],
                ['Email', preview.email],
                ['State / Zip', `${preview.state} ${preview.zip}`],
                ['DOB', preview.dob],
                ['Income', preview.income ? `$${preview.income.toLocaleString()}` : '—'],
                ['Household', preview.household || '—'],
                ['Gender', preview.gender || '—'],
                ['Comments', preview.comments || '—'],
              ].map(([label, val]) => (
                <div key={label} className="text-xs">
                  <span className="text-[#5A6A7A]">{label}: </span>
                  <span className="text-white">{val || '—'}</span>
                </div>
              ))}
            </div>
            {imported ? (
              <button onClick={() => navigate(`/leads/${imported}`)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-[#00E5C340] text-[#00E5C3] hover:bg-[#00E5C315] transition-colors">
                <Check size={14} /> View Lead <ExternalLink size={13} />
              </button>
            ) : (
              <button onClick={importLead}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-black"
                style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                <Plus size={14} /> Import to CRM
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Gmail() {
  const { user, leads, addLead } = useApp()
  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130] flex-shrink-0">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Gmail Leads</h1>
          <p className="text-xs text-[#5A6A7A] mt-0.5">USHA Marketplace email pipeline</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <CloudflareStatus user={user} leads={leads} />
        <ManualParse addLead={addLead} />
      </div>
    </div>
  )
}
