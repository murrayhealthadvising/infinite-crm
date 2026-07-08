import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ExternalLink, Settings as Cog, Copy, Check, X } from 'lucide-react'
import { useApp } from '../context/AppContext'

// Per-agent Calendly links stored in localStorage. Shape:
//   { default: { label, url }, extras: [{ label, url }] }
// Settings → Calendly panel writes; this button reads. localStorage keeps
// configuration personal-per-device which is fine for booking links.
const KEY = (uid) => `calendly:${uid || 'anon'}`

export function loadCalendlyLinks(uid) {
  try {
    const raw = localStorage.getItem(KEY(uid))
    if (!raw) return { default: { label: '', url: '' }, extras: [] }
    const j = JSON.parse(raw)
    return {
      default: { label: j?.default?.label || 'Book a time', url: j?.default?.url || '' },
      extras: Array.isArray(j?.extras) ? j.extras.filter(x => x && x.url) : [],
    }
  } catch { return { default: { label: '', url: '' }, extras: [] } }
}
export function saveCalendlyLinks(uid, payload) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(payload)) } catch {}
}

// Add ?name= and ?email= query params to a Calendly URL — used as a fallback
// when the in-app popup widget can't load (offline, blocked, etc.). The
// preferred path uses Calendly's official popup widget instead so booking
// happens IN-APP rather than in a new browser tab.
function withPrefill(url, lead) {
  if (!url) return ''
  try {
    const u = new URL(url)
    const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim() || lead?.name || ''
    if (name) u.searchParams.set('name', name)
    if (lead?.email) u.searchParams.set('email', lead.email)
    return u.toString()
  } catch { return url }
}

// Lazy-load Calendly's official widget script + CSS the first time someone
// clicks Book. We only load it on demand so it doesn't slow first paint for
// agents who never book through the CRM.
let calendlyLoadPromise = null
function loadCalendlyWidget() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.Calendly && typeof window.Calendly.initPopupWidget === 'function') return Promise.resolve(window.Calendly)
  if (calendlyLoadPromise) return calendlyLoadPromise
  calendlyLoadPromise = new Promise((resolve, reject) => {
    try {
      if (!document.querySelector('link[href*="calendly.com/assets/external/widget.css"]')) {
        const css = document.createElement('link')
        css.rel = 'stylesheet'
        css.href = 'https://assets.calendly.com/assets/external/widget.css'
        document.head.appendChild(css)
      }
      if (document.querySelector('script[src*="calendly.com/assets/external/widget.js"]')) {
        // already in flight — wait for window.Calendly
        const start = Date.now()
        const iv = setInterval(() => {
          if (window.Calendly) { clearInterval(iv); resolve(window.Calendly) }
          else if (Date.now() - start > 8000) { clearInterval(iv); reject(new Error('Calendly load timeout')) }
        }, 100)
        return
      }
      const s = document.createElement('script')
      s.src = 'https://assets.calendly.com/assets/external/widget.js'
      s.async = true
      s.onload = () => resolve(window.Calendly || null)
      s.onerror = () => { calendlyLoadPromise = null; reject(new Error('Calendly script failed')) }
      document.head.appendChild(s)
    } catch (e) { calendlyLoadPromise = null; reject(e) }
  })
  return calendlyLoadPromise
}

// Floating side widget shown alongside the Calendly popup. Calendly's overlay
// doesn't reliably prefill the phone field (their form asks for it inside the
// modal after the time is picked), so agents keep having to bounce back to the
// CRM to grab digits. This panel pins the key lead fields to the top-right at
// higher z-index than Calendly's overlay so you can click-to-copy without
// juggling windows. Auto-dismisses when the Calendly overlay is removed.
function CalendlyCopyPanel({ lead, onClose }) {
  const [copied, setCopied] = useState('')

  // Poll for Calendly overlay removal — when the user closes the popup we
  // hide this widget too. Calendly injects `.calendly-overlay` into <body>.
  useEffect(() => {
    const iv = setInterval(() => {
      if (!document.querySelector('.calendly-overlay')) onClose()
    }, 500)
    return () => clearInterval(iv)
  }, [onClose])

  const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim() || lead?.name || ''
  // Phone: normalize to digits-only for one variant, keep pretty for display.
  const phoneRaw = String(lead?.phone || '').trim()
  const phoneDigits = phoneRaw.replace(/\D/g, '')
  const phonePretty = phoneDigits.length === 10
    ? `(${phoneDigits.slice(0,3)}) ${phoneDigits.slice(3,6)}-${phoneDigits.slice(6)}`
    : (phoneRaw || '')

  const copy = async (label, value) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setTimeout(() => setCopied(c => (c === label ? '' : c)), 1200)
    } catch {}
  }

  const rows = [
    { label: 'Name',  value: name },
    { label: 'Email', value: lead?.email || '' },
    { label: 'Phone', value: phonePretty, altValue: phoneDigits && phoneDigits.length === 10 ? phoneDigits : '' },
    { label: 'State', value: lead?.state || '' },
    { label: 'Zip',   value: lead?.zip || '' },
    { label: 'DOB',   value: lead?.dob ? formatDOB(lead.dob) : '' },
  ].filter(r => r.value)

  return createPortal(
    <div
      // Sit above Calendly's overlay (theirs is ~9999). Fixed to viewport so
      // it doesn't shift when Calendly locks body scroll.
      style={{ position: 'fixed', top: 24, right: 24, zIndex: 10001, width: 260 }}
      className="rounded-xl border border-[#1A2130] shadow-2xl overflow-hidden"
    >
      <div style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1A2130]" style={{ background: '#111820' }}>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#00E5C3]">Lead info</p>
            <p className="text-[10px] text-[#3A4A5A] mt-0.5">Click to copy</p>
          </div>
          <button onClick={onClose}
            className="p-1 rounded hover:bg-[#1A2130] text-[#5A6A7A] hover:text-white transition-colors"
            title="Hide"
          >
            <X size={12} />
          </button>
        </div>
        <div className="p-2 space-y-1">
          {rows.map(r => (
            <div key={r.label} className="flex items-stretch gap-1">
              <button
                onClick={() => copy(r.label, r.value)}
                className="flex-1 flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-[#1A2130] transition-colors text-left"
                title={`Copy ${r.label.toLowerCase()}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] uppercase tracking-wider text-[#5A6A7A] leading-none mb-0.5">{r.label}</p>
                  <p className="text-xs text-white truncate">{r.value}</p>
                </div>
                {copied === r.label
                  ? <Check size={12} className="text-[#00E5C3] flex-shrink-0" />
                  : <Copy size={11} className="text-[#5A6A7A] flex-shrink-0" />
                }
              </button>
              {r.altValue && r.altValue !== r.value && (
                <button
                  onClick={() => copy(r.label + ' digits', r.altValue)}
                  className="px-2 rounded-md hover:bg-[#1A2130] transition-colors text-[9px] text-[#5A6A7A] hover:text-white"
                  title="Copy as digits only (no formatting)"
                >
                  {copied === r.label + ' digits' ? <Check size={10} className="text-[#00E5C3]" /> : '#'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

function formatDOB(dob) {
  if (!dob) return ''
  // Handles YYYY-MM-DD (from date columns) — displayed as MM/DD/YYYY like the rest of the app.
  const m = String(dob).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[2]}/${m[3]}/${m[1]}`
  return String(dob)
}

export default function CalendlyButton({ lead }) {
  const { user } = useApp()
  const [open, setOpen] = useState(false)
  const [copyPanelOpen, setCopyPanelOpen] = useState(false)
  const [links, setLinks] = useState(() => loadCalendlyLinks(user?.id))
  const ref = useRef(null)

  // Re-read when user changes (login switch) or when the dropdown opens
  // (so Settings edits are picked up without a hard reload).
  useEffect(() => { setLinks(loadCalendlyLinks(user?.id)) }, [user?.id])
  useEffect(() => { if (open) setLinks(loadCalendlyLinks(user?.id)) }, [open, user?.id])

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const all = [
    ...(links.default?.url ? [{ label: links.default.label || 'Default', url: links.default.url }] : []),
    ...(links.extras || []),
  ]
  const hasLinks = all.length > 0
  const onlyOne = all.length === 1

  const openLink = async (url) => {
    if (!url) return
    setOpen(false)
    const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim() || lead?.name || ''
    const email = lead?.email || ''
    try {
      const Calendly = await loadCalendlyWidget()
      if (Calendly && typeof Calendly.initPopupWidget === 'function') {
        // In-app modal overlay — booking happens without leaving the CRM
        Calendly.initPopupWidget({
          url,                              // bare URL — prefill is passed separately
          prefill: { name, email },         // prefill the booking form
          utm: { utmSource: 'Infinite CRM' },
        })
        // Show the side copy widget — Calendly's form doesn't reliably prefill
        // phone, so agents keep needing quick access to lead info while booking.
        setCopyPanelOpen(true)
        return
      }
    } catch (e) {
      console.warn('[Calendly] popup widget unavailable, falling back to new tab', e)
    }
    // Fallback path — open in a new tab with query-string prefill
    const fallback = withPrefill(url, lead)
    if (fallback) window.open(fallback, '_blank', 'noopener,noreferrer')
  }

  // Copy widget is rendered via portal so it appears alongside any variant.
  const copyPanel = copyPanelOpen ? (
    <CalendlyCopyPanel lead={lead} onClose={() => setCopyPanelOpen(false)} />
  ) : null

  // Zero-config state — button still visible, just sends to Settings
  if (!hasLinks) {
    return (
      <>
        <a href="/settings#calendly" title="Set up your Calendly links in Settings"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[#1A2130] text-sm text-[#5A6A7A] hover:text-white hover:border-[#2A3547]">
          <Calendar size={13} /> Book
        </a>
        {copyPanel}
      </>
    )
  }

  // One link — click goes straight to it (no dropdown)
  if (onlyOne) {
    return (
      <>
        <button onClick={() => openLink(all[0].url)}
          title={`Book ${all[0].label} (prefilled with this lead's name/email)`}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1A2130] text-sm text-[#8899AA] hover:text-white hover:border-[#2A3547]">
          <Calendar size={13} /> Book
        </button>
        {copyPanel}
      </>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        title="Pick which Calendly link to send"
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1A2130] text-sm text-[#8899AA] hover:text-white hover:border-[#2A3547]">
        <Calendar size={13} /> Book
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-xl border border-[#1A2130] overflow-hidden z-20 shadow-xl" style={{ background: '#0E1318' }}>
          <div className="px-3 py-2 border-b border-[#1A2130]">
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#3B82F6]">Send Calendly link</p>
            <p className="text-[10px] text-[#3A4A5A] mt-0.5">Opens prefilled with this lead</p>
          </div>
          {all.map((l, i) => (
            <button key={i} onClick={() => openLink(l.url)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#1A2130] transition-colors">
              <span className="text-xs text-white truncate">{l.label}</span>
              <ExternalLink size={11} className="text-[#5A6A7A] flex-shrink-0" />
            </button>
          ))}
          <div className="border-t border-[#1A2130] px-3 py-2">
            <a href="/settings#calendly" className="text-[10px] text-[#5A6A7A] hover:text-white inline-flex items-center gap-1">
              <Cog size={10} /> Manage links
            </a>
          </div>
        </div>
      )}
      {copyPanel}
    </div>
  )
}
