import { useState, useEffect, useRef } from 'react'
import { Calendar, ExternalLink, Settings as Cog } from 'lucide-react'
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

export default function CalendlyButton({ lead }) {
  const { user } = useApp()
  const [open, setOpen] = useState(false)
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
        return
      }
    } catch (e) {
      console.warn('[Calendly] popup widget unavailable, falling back to new tab', e)
    }
    // Fallback path — open in a new tab with query-string prefill
    const fallback = withPrefill(url, lead)
    if (fallback) window.open(fallback, '_blank', 'noopener,noreferrer')
  }

  // Zero-config state — button still visible, just sends to Settings
  if (!hasLinks) {
    return (
      <a href="/settings#calendly" title="Set up your Calendly links in Settings"
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[#1A2130] text-sm text-[#5A6A7A] hover:text-white hover:border-[#2A3547]">
        <Calendar size={13} /> Book
      </a>
    )
  }

  // One link — click goes straight to it (no dropdown)
  if (onlyOne) {
    return (
      <button onClick={() => openLink(all[0].url)}
        title={`Book ${all[0].label} (prefilled with this lead's name/email)`}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1A2130] text-sm text-[#8899AA] hover:text-white hover:border-[#2A3547]">
        <Calendar size={13} /> Book
      </button>
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
    </div>
  )
}
