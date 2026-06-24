import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Minus, Plus, RotateCcw, BarChart3 } from 'lucide-react'
import { useApp } from '../context/AppContext'

// Per-agent daily action tracker.
//   Dials       — auto-bumps when a 'call' activity is logged anywhere in the
//                 CRM (listens for the window 'crm:activity' DOM event the
//                 AppContext.addActivity helper dispatches). Also +/- by hand.
//   Answers     — manual (someone picked up)
//   Situations  — manual (a qualified prospect surfaced)
//   Text Appts  — manual (set appt via text)
//   Call Appts  — manual (set appt on the phone)
//   Deals       — manual (closed)
//
// Counts persist per-agent per-day in localStorage and reset naturally at
// midnight when the date-keyed bucket rolls over. Widget position is also
// remembered per-agent so it stays where you put it between sessions.
//
// Modeled on the user-provided reference: header (name · date · close), six
// rows (label · − · count · + · per-row reset), Reset All footer button.

const CATEGORIES = [
  { key: 'dials',      label: 'Dials' },
  { key: 'answers',    label: 'Answers' },
  { key: 'situations', label: 'Situations' },
  { key: 'text_appts', label: 'Text Appts' },
  { key: 'call_appts', label: 'Call Appts' },
  { key: 'deals',      label: 'Deals', accent: '#3B82F6' },
]
const ZERO = { dials: 0, answers: 0, situations: 0, text_appts: 0, call_appts: 0, deals: 0 }

// YYYY-MM-DD in local time — used as the rollover key so counts reset cleanly
// at midnight without any timer logic.
function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`
}

export default function ActionsCounter() {
  const { user } = useApp()
  const uid = user?.id || 'anon'
  const name = user?.name || (user?.email ? user.email.split('@')[0] : 'Agent')

  const today = localDateKey()
  const countsKey = `actions-counter:counts:${uid}:${today}`
  const posKey = `actions-counter:pos:${uid}`
  const openKey = `actions-counter:open:${uid}`

  // Visibility — re-open via the small floating launcher in the bottom-right
  const [open, setOpen] = useState(() => {
    try { const raw = localStorage.getItem(openKey); return raw === null ? true : raw === 'true' } catch { return true }
  })
  useEffect(() => { try { localStorage.setItem(openKey, String(open)) } catch {} }, [open, openKey])

  // Counts
  const [counts, setCounts] = useState(() => {
    try {
      const raw = localStorage.getItem(countsKey)
      if (raw) return { ...ZERO, ...JSON.parse(raw) }
    } catch {}
    return { ...ZERO }
  })
  useEffect(() => { try { localStorage.setItem(countsKey, JSON.stringify(counts)) } catch {} }, [counts, countsKey])

  // Auto-bump Dials when any call activity is logged through addActivity
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

  // ── Drag-to-position ─────────────────────────────────────────────────────
  // Free-drag on the header. Position clamped to viewport on resize so the
  // widget doesn't end up offscreen if you tucked it in a corner and then
  // shrank the window.
  const [pos, setPos] = useState(() => {
    try { const raw = localStorage.getItem(posKey); if (raw) return JSON.parse(raw) } catch {}
    // Default: a comfortable distance from the bottom-right corner
    return { x: Math.max(20, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 340), y: 140 }
  })
  useEffect(() => { try { localStorage.setItem(posKey, JSON.stringify(pos)) } catch {} }, [pos, posKey])

  const dragState = useRef(null)
  const startDrag = (e) => {
    if (e.button !== 0) return
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    dragState.current = { startX: clientX, startY: clientY, origX: pos.x, origY: pos.y }
    document.body.style.userSelect = 'none'
  }
  useEffect(() => {
    const onMove = (e) => {
      const s = dragState.current
      if (!s) return
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const clientY = e.touches ? e.touches[0].clientY : e.clientY
      const w = typeof window !== 'undefined' ? window.innerWidth : 1200
      const h = typeof window !== 'undefined' ? window.innerHeight : 800
      const nextX = Math.min(Math.max(0, s.origX + (clientX - s.startX)), Math.max(0, w - 300))
      const nextY = Math.min(Math.max(0, s.origY + (clientY - s.startY)), Math.max(0, h - 80))
      setPos({ x: nextX, y: nextY })
    }
    const onUp = () => { dragState.current = null; document.body.style.userSelect = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [])

  // Tiny launcher when closed — bottom-right pill, click to re-open
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-3 py-2 rounded-full border border-[#1A2130] shadow-lg text-xs font-mono text-[#C0D0E0] hover:text-white hover:border-[#00E5C340] transition-colors"
        style={{ background: '#0E1318' }}
        title="Open actions tracker">
        <BarChart3 size={13} className="text-[#00E5C3]" />
        Tracker
      </button>
    )
  }

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="fixed z-40 w-[280px] rounded-2xl border border-[#1A2130] shadow-2xl overflow-hidden select-text"
      style={{ background: '#0E1318', left: pos.x, top: pos.y }}>
      {/* Header — drag handle */}
      <div onMouseDown={startDrag} onTouchStart={startDrag}
        className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[#1A2130] cursor-move"
        style={{ background: '#161D2A' }}
        title="Drag to move">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-[#10B981] flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-white truncate">{name}</p>
            <p className="text-[10px] text-[#8899AA] font-mono">{dateLabel}</p>
          </div>
        </div>
        <button onClick={() => setOpen(false)}
          className="p-1 rounded text-[#8899AA] hover:text-white hover:bg-[#1A2130]"
          title="Hide tracker">
          <X size={14} />
        </button>
      </div>

      {/* Rows */}
      <div className="px-3 py-2">
        {CATEGORIES.map((cat, idx) => {
          const accent = cat.accent || '#C0D0E0'
          const val = counts[cat.key] || 0
          return (
            <div key={cat.key}
              className={`flex items-center justify-between gap-2 py-2 ${idx < CATEGORIES.length - 1 ? 'border-b border-[#1A2130]' : ''}`}>
              <span className="text-sm font-semibold flex-1" style={{ color: accent }}>{cat.label}</span>
              <button onClick={() => bump(cat.key, -1)} disabled={val === 0}
                className="w-7 h-7 rounded-md border border-[#2A3547] text-[#8899AA] hover:text-white hover:border-[#00E5C340] disabled:opacity-30 flex items-center justify-center"
                title={`Decrement ${cat.label}`}>
                <Minus size={12} />
              </button>
              <span className="text-base font-bold text-white w-7 text-center font-mono tabular-nums">{val}</span>
              <button onClick={() => bump(cat.key, 1)}
                className="w-7 h-7 rounded-md border border-[#00E5C340] text-[#00E5C3] hover:bg-[#00E5C315] flex items-center justify-center"
                title={`Increment ${cat.label}`}>
                <Plus size={12} />
              </button>
              <button onClick={() => resetOne(cat.key)} disabled={val === 0}
                className="p-1 text-[#3A4A5A] hover:text-[#8899AA] disabled:opacity-20"
                title={`Reset ${cat.label}`}>
                <RotateCcw size={11} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[#1A2130]">
        <p className="text-[10px] text-[#3A4A5A] font-mono">Resets at midnight</p>
        <button onClick={resetAll}
          className="px-3 py-1.5 rounded-md text-[11px] font-semibold bg-[#1A2130] text-[#C0D0E0] hover:bg-[#2A3547] hover:text-white">
          Reset All
        </button>
      </div>
    </div>
  )
}
