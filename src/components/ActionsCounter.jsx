import { useState, useEffect } from 'react'
import { Minus, Plus, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { useApp } from '../context/AppContext'

// Per-agent daily action tracker — embedded in the sidebar between the nav and
// the user/build footer. Visible on every page when the sidebar is open.
//
// Rows: Dials / Answers / Situations / Text Appts / Call Appts / Deals
//
// Dials auto-bumps when a 'call' activity fires anywhere in the CRM (listens
// for the window 'crm:activity' event the AppContext.addActivity helper
// dispatches). Everything else is manual +/-.
//
// Counts persist per-agent per-day in localStorage and reset naturally at
// midnight when the date-keyed bucket rolls over. The collapsed/expanded
// state is also remembered per-agent.

const CATEGORIES = [
  { key: 'dials',      label: 'Dials' },
  { key: 'answers',    label: 'Answers' },
  { key: 'situations', label: 'Situations' },
  { key: 'text_appts', label: 'Text Appts' },
  { key: 'call_appts', label: 'Call Appts' },
  { key: 'deals',      label: 'Deals', accent: '#3B82F6' },
]
const ZERO = { dials: 0, answers: 0, situations: 0, text_appts: 0, call_appts: 0, deals: 0 }

function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`
}

export default function ActionsCounter() {
  const { user } = useApp()
  const uid = user?.id || 'anon'
  const today = localDateKey()
  const countsKey = `actions-counter:counts:${uid}:${today}`
  const openKey = `actions-counter:open:${uid}`

  // Expanded by default. Collapsing keeps the header visible so the agent
  // can still see "today" + reopen with one click — useful on small screens.
  const [open, setOpen] = useState(() => {
    try { const raw = localStorage.getItem(openKey); return raw === null ? true : raw === 'true' } catch { return true }
  })
  useEffect(() => { try { localStorage.setItem(openKey, String(open)) } catch {} }, [open, openKey])

  const [counts, setCounts] = useState(() => {
    try {
      const raw = localStorage.getItem(countsKey)
      if (raw) return { ...ZERO, ...JSON.parse(raw) }
    } catch {}
    return { ...ZERO }
  })
  useEffect(() => { try { localStorage.setItem(countsKey, JSON.stringify(counts)) } catch {} }, [counts, countsKey])

  // Auto-bump Dials whenever a call activity is logged through addActivity
  useEffect(() => {
    const onAct = (e) => {
      const t = e?.detail?.type
      if (t === 'call') setCounts(c => ({ ...c, dials: (c.dials || 0) + 1 }))
    }
    window.addEventListener('crm:activity', onAct)
    return () => window.removeEventListener('crm:activity', onAct)
  }, [])

  const bump = (key, by) => setCounts(c => ({ ...c, [key]: Math.max(0, (c[key] || 0) + by) }))
  const resetOne = (key) => setCounts(c => ({ ...c, [key]: 0 }))
  const resetAll = () => setCounts({ ...ZERO })

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const total = Object.values(counts).reduce((s, n) => s + (n || 0), 0)

  return (
    <div className="border-t border-[#1A2130] flex-shrink-0" style={{ background: '#0A0E14' }}>
      {/* Header — also the collapse toggle */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-[#0E1318] transition-colors"
        title={open ? 'Collapse tracker' : 'Expand tracker'}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] flex-shrink-0" />
          <div className="min-w-0 text-left">
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#8899AA]">Today</p>
            <p className="text-[9px] text-[#5A6A7A] font-mono leading-tight">{dateLabel} · {total} actions</p>
          </div>
        </div>
        {open ? <ChevronDown size={12} className="text-[#5A6A7A]" /> : <ChevronUp size={12} className="text-[#5A6A7A]" />}
      </button>

      {open && (
        <>
          <div className="px-2 pb-1">
            {CATEGORIES.map((cat) => {
              const accent = cat.accent || '#C0D0E0'
              const val = counts[cat.key] || 0
              return (
                <div key={cat.key} className="flex items-center justify-between gap-1 py-1">
                  <span className="text-xs font-semibold flex-1 truncate" style={{ color: accent }}>{cat.label}</span>
                  <button onClick={() => bump(cat.key, -1)} disabled={val === 0}
                    className="w-5 h-5 rounded border border-[#2A3547] text-[#8899AA] hover:text-white hover:border-[#00E5C340] disabled:opacity-30 flex items-center justify-center"
                    title={`Decrement ${cat.label}`}>
                    <Minus size={9} />
                  </button>
                  <span className="text-xs font-bold text-white w-5 text-center font-mono tabular-nums">{val}</span>
                  <button onClick={() => bump(cat.key, 1)}
                    className="w-5 h-5 rounded border border-[#00E5C340] text-[#00E5C3] hover:bg-[#00E5C315] flex items-center justify-center"
                    title={`Increment ${cat.label}`}>
                    <Plus size={9} />
                  </button>
                  <button onClick={() => resetOne(cat.key)} disabled={val === 0}
                    className="p-0.5 text-[#3A4A5A] hover:text-[#8899AA] disabled:opacity-20"
                    title={`Reset ${cat.label}`}>
                    <RotateCcw size={9} />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-[#1A2130]">
            <p className="text-[9px] text-[#3A4A5A] font-mono">resets at midnight</p>
            <button onClick={resetAll}
              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#1A2130] text-[#C0D0E0] hover:bg-[#2A3547] hover:text-white">
              Reset All
            </button>
          </div>
        </>
      )}
    </div>
  )
}
