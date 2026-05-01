import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { Mail, RefreshCw, Plus, Zap, Check, X, ExternalLink, Copy, ChevronDown, ChevronUp } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'

// Parse USHA email body text into a lead
function parseUSHAEmail(body) {
  const get = (label) => {
    const re = new RegExp(`${label}[:\\s]+([^\\n\\r<]+)`, 'i')
    const m = body.match(re)
    return m ? m[1].trim().replace(/<[^>]+>/g, '') : ''
  }
  const parseIncome = (s) => { if (!s) return null; const n = parseInt(s.replace(/[$,]/g,'')); return isNaN(n) ? null : n }
  return {
    first_name: get('First Name') || 'Unknown',
    last_name: get('Last Name') || '',
    phone: get('Primary Phone') || get('Phone') || '',
    email: get('Email') || '',
    state: get('State') || '',
    zip: get('Zip') || '',
    city: get('City') || '',
    street_address: get('Address') || '',
    dob: get('Date of Birth') || get('DOB') || '',
    gender: get('Gender') || '',
    age: get('Age') || '',
    age_range: get('Age Range') || '',
    income: parseIncome(get('Income')),
    household: parseInt(get('Household')) || null,
    smoker: get('Smoker') || '',
    spouse_age: get('Spouse Age') || '',
    num_children: get('Number Of Children') || '',
    comments: get('Comments') || '',
    plan_choice: get('Plan Choice') || '',
    monthly_budget: get('Monthly Budget') || '',
    campaign: get('Name') || get('Campaign') || '',
    price: get('Price') || '',
    source: 'USHA Marketplace',
    stage: 'not-started',
  }
}

function WebhookSetup() {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(true)
  // In production this would be your deployed URL. For now show the pattern.
  const webhookUrl = `${window.location.origin}/api/gmail-webhook`

  const copy = () => {
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-xl border border-[#1A2130] overflow-hidden mb-6" style={{ background: '#0E1318' }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00E5C320, #3B82F620)' }}>
            <Zap size={15} className="text-[#00E5C3]" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-white">Auto-Import via Make.com</p>
            <p className="text-xs text-[#5A6A7A]">New USHA leads → Infinite CRM automatically</p>
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-[#5A6A7A]" /> : <ChevronDown size={16} className="text-[#5A6A7A]" />}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-[#1A2130]">
          <p className="text-xs text-[#5A6A7A] mt-4 mb-4">
            Set up a Make.com scenario to watch your Gmail for USHA leads and push them straight into Infinite. Takes about 5 minutes.
          </p>
          <div className="space-y-3">
            {[
              { n: 1, title: 'Create a Make.com scenario', desc: 'Go to make.com → Create new scenario' },
              { n: 2, title: 'Add Gmail trigger', desc: 'Search for Gmail → "Watch Emails" → filter by: From = leads@ushamarketplace.com, Subject = "New Health Lead"' },
              { n: 3, title: 'Add HTTP module', desc: 'Add an HTTP → Make a request module after the Gmail trigger' },
              { n: 4, title: 'Configure the webhook', desc: 'Method: POST · URL: your Infinite webhook endpoint (set up after deploying to Vercel) · Body: map all Gmail fields' },
              { n: 5, title: 'Test & activate', desc: 'Run once to test, then turn the scenario on. Every new lead email auto-imports.' },
            ].map(step => (
              <div key={step.n} className="flex gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                  style={{ background: '#00E5C320', color: '#00E5C3' }}>{step.n}</div>
                <div>
                  <p className="text-sm text-white font-medium">{step.title}</p>
                  <p className="text-xs text-[#5A6A7A] mt-0.5">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F' }}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-2">Webhook URL (after Vercel deploy)</p>
            <div className="flex items-center gap-2">
              <code className="text-xs text-[#00E5C3] font-mono flex-1 truncate">{webhookUrl}</code>
              <button onClick={copy} className="p-1.5 rounded text-[#5A6A7A] hover:text-white transition-colors flex-shrink-0">
                {copied ? <Check size={13} className="text-[#00E5C3]" /> : <Copy size={13} />}
              </button>
            </div>
          </div>
          <p className="text-xs text-[#3A4A5A] mt-3">
            💡 Once you deploy Infinite to Vercel, we'll add the webhook API route so Make.com can push directly to your CRM. For now use the manual import below.
          </p>
        </div>
      )}
    </div>
  )
}

function ManualParse() {
  const { addLead } = useApp()
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

  const importLead = () => {
    const lead = addLead(preview)
    setImported(lead.id)
  }

  return (
    <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
      <div className="px-5 py-4 border-b border-[#1A2130]">
        <p className="text-sm font-semibold text-white">Manual Import from Email</p>
        <p className="text-xs text-[#5A6A7A] mt-0.5">Paste the USHA lead email body — we'll parse every field automatically</p>
      </div>
      <div className="p-5">
        <textarea
          value={emailText}
          onChange={e => { setEmailText(e.target.value); setPreview(null); setImported(false) }}
          placeholder={`Paste the full email body here...\n\nExample:\nFirst Name: Timothy\nLast Name: Shropshire\nPrimary Phone: 4047963713\nEmail: tbshropshire@gmail.com\nState: GA\nZip: 30296\nDate of Birth: 1968-01-21\nGender: Male\nAge: 58\nIncome: $75,000\nHousehold: 1\nComments: health-for-moms`}
          rows={10}
          className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-[#C0D0E0] placeholder-[#2A3547] focus:outline-none focus:border-[#00E5C340] resize-none font-mono"
        />
        <button onClick={parse}
          className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-black"
          style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          Parse Email
        </button>

        {/* Preview */}
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
                ['Age', preview.age],
                ['Income', preview.income ? `$${preview.income.toLocaleString()}` : '—'],
                ['Household', preview.household || '—'],
                ['Gender', preview.gender || '—'],
                ['Comments', preview.comments || '—'],
                ['Campaign', preview.campaign || '—'],
                ['Price', preview.price || '—'],
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
  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130] flex-shrink-0">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Gmail Leads</h1>
          <p className="text-xs text-[#5A6A7A] mt-0.5">Import USHA Marketplace leads from email</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <WebhookSetup />
        <ManualParse />
      </div>
    </div>
  )
}
