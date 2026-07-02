import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import PitchCountdown from '../components/PitchCountdown'
import EmailButton from '../components/EmailButton'
import SoldBadge from '../components/SoldBadge'
import { normalizePhone, displayPhone, copyPhoneValue } from '../lib/phone'
import { localTimeFor, localHourFor, timezoneFor } from '../lib/timezone'

// IANA timezone → short label used for the TZ filter pills
const TZ_LABEL = {
  'America/New_York': 'EST',
  'America/Detroit': 'EST',
  'America/Indiana/Indianapolis': 'EST',
  'America/Chicago': 'CST',
  'America/Denver': 'MST',
  'America/Boise': 'MST',
  'America/Phoenix': 'AZ',
  'America/Los_Angeles': 'PST',
  'America/Anchorage': 'AK',
  'Pacific/Honolulu': 'HI',
}
function tzShortFor(lead) {
  const tz = timezoneFor(lead)
  if (!tz) return null
  return TZ_LABEL[tz] || null
}
import StatusTag from '../components/StatusTag'
import AddLeadModal from '../components/AddLeadModal'
import {
  Search, Plus, LayoutList, Columns, Phone, Copy, Home, DollarSign, Calendar,
  ExternalLink, ChevronDown, ChevronUp, X, Users, Check, Download, Upload,
  Square, CheckSquare, AlertCircle, CheckCircle, Trash2, AlertTriangle, RefreshCw,
  MessageSquare, StickyNote, AtSign, Zap,
} from 'lucide-react'
import { format, formatDistanceToNow, differenceInYears, parseISO } from 'date-fns'
import clsx from 'clsx'

// ───────────────────────────────────────────────────────────────────────────
// Helpers — schema-agnostic (handle both old first_name/stage and new name/status)
// ───────────────────────────────────────────────────────────────────────────
function leadName(lead) {
  if (!lead) return ''
  if (lead.name && lead.name.trim()) return lead.name.trim()
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim()
}
function leadStageId(lead, tags) {
  if (lead?.stage) return lead.stage
  if (lead?.status && Array.isArray(tags)) {
    const t = tags.find(x => (x.label || '').toLowerCase() === String(lead.status).toLowerCase())
    if (t) return t.id
  }
  return 'not-started'
}
function safeDate(d) { if (!d) return null; const dt = new Date(d); return isNaN(dt.getTime()) ? null : dt }
function safeRel(d) { const dt = safeDate(d); if (!dt) return ''; try { return formatDistanceToNow(dt, { addSuffix: true }) } catch { return '' } }
function safeFormat(d, fmt) { const dt = safeDate(d); if (!dt) return '—'; try { return format(dt, fmt) } catch { return '—' } }

// ───────────────────────────────────────────────────────────────────────────
// Drag-to-scroll for the filter pill row
// ───────────────────────────────────────────────────────────────────────────
function useDragScroll() {
  const ref = useRef(null)
  const state = useRef({ down: false, startX: 0, scrollLeft: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onDown = (e) => {
      const x = e.touches ? e.touches[0].clientX : e.clientX
      state.current = { down: true, startX: x - el.offsetLeft, scrollLeft: el.scrollLeft }
      el.style.cursor = 'grabbing'; el.style.userSelect = 'none'
    }
    const onUp = () => { state.current.down = false; el.style.cursor = 'grab'; el.style.userSelect = '' }
    const onMove = (e) => {
      if (!state.current.down) return
      const x = e.touches ? e.touches[0].clientX : e.clientX
      el.scrollLeft = state.current.scrollLeft - (x - state.current.startX - el.offsetLeft) * 1.2
    }
    el.addEventListener('mousedown', onDown)
    el.addEventListener('touchstart', onDown, { passive: true })
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchend', onUp)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      el.removeEventListener('mousedown', onDown)
      el.removeEventListener('touchstart', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
    }
  }, [])
  return ref
}

// Live "local time" for the lead based on state (with ZIP overrides for
// multi-timezone states). Ticks every 30s. Tinted amber outside 8am–9pm
// to signal "probably not a great time to call right now."
function LocalTime({ lead }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [])
  const t = localTimeFor(lead)
  if (!t) return null
  const h = localHourFor(lead)
  const offHours = h != null && (h < 8 || h >= 21)
  return (
    <span className="text-xs font-mono"
      style={{ color: offHours ? '#F59E0B' : '#5A6A7A' }}
      title={offHours ? "Outside typical 8a–9p window" : "Local time at this lead"}>
      · {t}
    </span>
  )
}

// Refresh button — re-pulls leads without a full page reload.
function RefreshButton() {
  const { refreshLeads } = useApp()
  const [spinning, setSpinning] = useState(false)
  const click = async () => {
    if (spinning) return
    setSpinning(true)
    try { await refreshLeads?.() } catch {}
    setTimeout(() => setSpinning(false), 400)
  }
  return (
    <button onClick={click} disabled={spinning}
      className="p-2 rounded-lg border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547] transition-colors disabled:opacity-50"
      title="Refresh leads">
      <RefreshCw size={15} className={spinning ? 'animate-spin' : ''} />
    </button>
  )
}

// DOB — bolder / brighter text so it stands out on the card, plus an "Age N"
// hover tooltip rendered through a portal so it never gets clipped by card
// overflow (which was the first-row cutoff bug).
function DOBField({ dob }) {
  const [tipPos, setTipPos] = useState(null)  // { top, left } | null
  const anchorRef = useRef(null)
  if (!dob) return <span className="text-xs text-[#5A6A7A]">—</span>
  let age = null
  try { age = differenceInYears(new Date(), parseISO(dob)) } catch {}

  const show = () => {
    if (age == null || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    // Try to place above the anchor. If no room, flip below.
    const preferAbove = rect.top > 34
    setTipPos({
      top: preferAbove ? rect.top - 30 : rect.bottom + 6,
      left: rect.left + rect.width / 2,
    })
  }
  const hide = () => setTipPos(null)

  return (
    <>
      <span ref={anchorRef}
        className="inline-flex items-center gap-1 cursor-default text-xs font-semibold text-[#00E5C3] tracking-tight"
        onMouseEnter={show} onMouseLeave={hide}>
        {dob}
      </span>
      {tipPos && age !== null && createPortal(
        <span
          className="fixed px-2 py-1 rounded-lg text-xs font-mono whitespace-nowrap pointer-events-none shadow-lg"
          style={{
            top: tipPos.top,
            left: tipPos.left,
            transform: 'translate(-50%, 0)',
            zIndex: 9999,
            background: '#0E1318',
            color: '#00E5C3',
            border: '1px solid #00E5C340',
          }}>
          Age {age}
        </span>,
        document.body
      )}
    </>
  )
}

// Tag pill dropdown
function TagPill({ stage, tags, onChange }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, openUp: false })
  const btnRef = useRef(null)
  const safeTags = Array.isArray(tags) && tags.length > 0 ? tags : [{ id: 'not-started', label: 'Not Started', color: '#8899AA', bg: '#1A2130' }]
  const tag = safeTags.find(t => t.id === stage) || safeTags[0]
  const ITEM_H = 40
  const MAX_DROPDOWN_H = 320  // cap so it never blows past the viewport
  const DROPDOWN_H = Math.min(safeTags.length * ITEM_H + 8, MAX_DROPDOWN_H)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) {
        const portal = document.getElementById('tag-portal')
        if (portal && portal.contains(e.target)) return
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = (e) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const openUp = spaceBelow < DROPDOWN_H + 16
      setPos({ left: rect.left, top: openUp ? rect.top - DROPDOWN_H - 6 : rect.bottom + 6, openUp })
    }
    setOpen(v => !v)
  }

  const dropdown = open ? (
    <div id="tag-portal"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: '192px',
        maxHeight: MAX_DROPDOWN_H + 'px',
        background: '#0A0E14', border: '1px solid #1A2130', borderRadius: '4px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.6)', zIndex: 9999, overflowY: 'auto', overflowX: 'hidden' }}>
      {safeTags.map(t => (
        <button key={t.id}
          onClick={(e) => { e.stopPropagation(); onChange(t.id); setOpen(false) }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: '10px 12px', fontSize: '12px',
            color: t.color, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1A2130'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '4px', background: t.color, flexShrink: 0 }} />
            {t.label}
          </div>
          {t.id === stage && <Check size={11} />}
        </button>
      ))}
    </div>
  ) : null

  return (
    <div onClick={e => e.stopPropagation()}>
      <button ref={btnRef} onClick={handleOpen}
        className="flex items-center gap-1.5 px-3 py-1 rounded-[9999px] text-xs font-semibold transition-all hover:opacity-90 whitespace-nowrap"
        style={{ background: tag.bg, color: tag.color, border: `1px solid ${tag.color}40` }}>
        <span className="w-1.5 h-1.5 rounded-[9999px] flex-shrink-0" style={{ background: tag.color }} />
        {tag.label}
        <ChevronDown size={11} className={clsx('transition-transform flex-shrink-0', open && 'rotate-180')} />
      </button>
      {open && createPortal(dropdown, document.body)}
    </div>
  )
}

// Match a free-form campaign value (e.g. 'DY', 'GoldBar', 'GB ') to one of
// the agent's saved campaigns. Tries exact (case-insensitive) → initials
// (DY = Dynasty) → prefix (Gold = GoldBar) → contains (Star = NorthStar).
// Returns the saved name when a single confident match exists; otherwise null.
function matchSavedCampaign(input, savedList) {
  if (!input) return null
  const v = String(input).trim()
  if (!v) return null
  const list = Array.isArray(savedList) ? savedList : []
  if (list.length === 0) return null
  const lower = v.toLowerCase()
  // 1. exact (case-insensitive)
  const exact = list.find(c => c.toLowerCase() === lower)
  if (exact) return exact
  // 2. initials → "GB" matches "GoldBar" because G+B = uppercase letters
  if (v.length <= 4) {
    const inits = (c) => c.replace(/[^A-Z]/g, '').toLowerCase()
    const initialsHits = list.filter(c => inits(c).startsWith(lower))
    if (initialsHits.length === 1) return initialsHits[0]
  }
  // 3. starts-with
  const prefixHits = list.filter(c => c.toLowerCase().startsWith(lower))
  if (prefixHits.length === 1) return prefixHits[0]
  // 4. contains
  const containsHits = list.filter(c => c.toLowerCase().includes(lower))
  if (containsHits.length === 1) return containsHits[0]
  return null
}

// Campaign pill — single-select dropdown of the user's saved campaigns,
// plus inline "+ Create new" when typed text doesn't match any. Adding a new
// campaign saves it to profile.campaigns so it shows up everywhere going
// forward. Click the chip to open. Portal-based so cards don't clip it.
function CampaignPill({ value, color, onSave }) {
  const { campaigns, saveCampaigns } = useApp()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [pos, setPos] = useState({ left: 0, top: 0, openUp: false })
  const wrapRef = useRef(null)
  const btnRef = useRef(null)

  const calcPos = () => {
    const el = btnRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const DROPDOWN_H = 280
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < DROPDOWN_H + 16 && rect.top > spaceBelow
    setPos({
      left: rect.left,
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      openUp,
    })
  }

  useEffect(() => {
    if (!open) return
    calcPos()
    const onScroll = () => calcPos()
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        const portal = document.getElementById('campaign-portal')
        if (portal && portal.contains(e.target)) return
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = () => { setOpen(false); setFilter('') }

  const pick = async (v) => {
    try { await onSave(v || null) } catch {}
    close()
  }
  const createAndPick = async (raw) => {
    const v = String(raw || '').trim()
    if (!v) return
    if (!campaigns.includes(v)) {
      try { await saveCampaigns([...campaigns, v]) } catch {}
    }
    await pick(v)
  }
  const removeFromLibrary = async (e, name) => {
    e.stopPropagation()
    if (!confirm(`Remove "${name}" from your campaign list? (Existing leads keep the label.)`)) return
    try { await saveCampaigns(campaigns.filter(c => c !== name)) } catch {}
  }

  const q = filter.trim().toLowerCase()
  const filtered = (campaigns || []).filter(c => !q || c.toLowerCase().includes(q))
  const exactExists = (campaigns || []).some(c => c.toLowerCase() === q)
  const showCreate = q && !exactExists

  // Auto-normalize: if the stored value matches one of the saved campaigns by
  // initials/prefix/contains, show the saved name instead. Doesn't rewrite
  // the DB until the agent explicitly picks from the dropdown.
  const matched = matchSavedCampaign(value, campaigns)
  const display = value && String(value).trim() ? (matched || value) : '—'

  const dropdown = open ? (
    <div id="campaign-portal"
      style={{
        position: 'fixed',
        left: pos.left, top: pos.top,
        transform: pos.openUp ? 'translateY(-100%)' : undefined,
        width: '220px',
        background: '#0A0E14', border: '1px solid #1A2130', borderRadius: '4px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.6)', zIndex: 9999, overflow: 'hidden',
      }}>
      <div className="p-2 border-b border-[#1A2130]">
        <input autoFocus value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); showCreate ? createAndPick(filter) : (filtered[0] && pick(filtered[0])) }
            if (e.key === 'Escape') close()
          }}
          placeholder="Search or create campaign…"
          className="w-full bg-[#080B0F] border border-[#1A2130] rounded px-2 py-1 text-xs text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {value && (
          <button onMouseDown={e => { e.preventDefault(); pick(null) }}
            className="block w-full text-left px-2.5 py-1.5 text-[10px] uppercase tracking-wider font-mono text-[#5A6A7A] hover:bg-[#1A2130]">
            ← clear campaign
          </button>
        )}
        {filtered.map(c => (
          <div key={c} className="group flex items-center hover:bg-[#1A2130]">
            <button onMouseDown={e => { e.preventDefault(); pick(c) }}
              className="flex-1 text-left px-2.5 py-1.5 text-xs font-mono"
              style={{ color: value === c ? '#00E5C3' : '#8899AA' }}>
              {c}
              {value === c && <span className="ml-1 text-[#00E5C3]">✓</span>}
            </button>
            <button onClick={(e) => removeFromLibrary(e, c)}
              className="px-2 py-1.5 text-[10px] text-[#3A4A5A] hover:text-[#EF4444] opacity-0 group-hover:opacity-100"
              title="Remove from list">
              ×
            </button>
          </div>
        ))}
        {showCreate && (
          <button onMouseDown={e => { e.preventDefault(); createAndPick(filter) }}
            className="block w-full text-left px-2.5 py-1.5 text-xs font-mono text-[#00E5C3] hover:bg-[#1A2130] border-t border-[#1A2130]">
            + Create <strong>{filter.trim()}</strong>
          </button>
        )}
        {!showCreate && filtered.length === 0 && (
          <p className="px-2.5 py-2 text-[11px] text-[#5A6A7A]">No campaigns. Type to create.</p>
        )}
      </div>
    </div>
  ) : null

  return (
    <div ref={wrapRef} className="inline-block" onClick={e => e.stopPropagation()}>
      <button ref={btnRef}
        onClick={() => setOpen(v => !v)}
        className="text-[10px] px-1.5 py-0.5 rounded font-mono cursor-pointer hover:opacity-80 max-w-[140px] truncate inline-flex items-center gap-1"
        title="Click to pick a campaign"
        style={{ background: color + '15', color }}>
        {display}
        <span className="opacity-60">▾</span>
      </button>
      {open && createPortal(dropdown, document.body)}
    </div>
  )
}

// Inline-editable text pill (campaign name)
function TextPill({ value, color, onSave, placeholder = 'campaign', maxLen = 24 }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value || '')
  useEffect(() => { setText(value || '') }, [value])

  const commit = async () => {
    const trimmed = text.trim()
    if (trimmed !== (value || '')) { try { await onSave(trimmed || null) } catch {} }
    setEditing(false)
  }
  const cancel = () => { setText(value || ''); setEditing(false) }

  if (editing) {
    return (
      <input autoFocus value={text}
        onChange={e => setText(e.target.value.slice(0, maxLen))}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
        placeholder={placeholder}
        className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-[#080B0F] border outline-none w-24"
        style={{ color, borderColor: color + '60' }} />
    )
  }
  const display = value && String(value).trim() ? value : '—'
  return (
    <button onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      className="text-[10px] px-1.5 py-0.5 rounded font-mono cursor-pointer hover:opacity-80 max-w-[140px] truncate"
      title="Click to edit campaign"
      style={{ background: color + '15', color }}>
      {display}
    </button>
  )
}

// Multi-select secondary tags on a lead — independent of the pipeline stage.
// e.g. a "Long Term" lead can also be tagged "pitched" + "appointment" without
// changing its main stage. Displayed as removable chips with a + adder.
const SUGGESTED_TAGS = [
  'pitched', 'appointment', 'callback', 'voicemail',
  'texted', 'emailed', 'follow-up', 'quoted', 'objection', 'spouse',
]
function TagChips({ tags = [], onChange, suggestions = [] }) {
  const { sideTagStyles } = useApp()
  const styles = sideTagStyles || {}
  const styleFor = (t) => styles[t] || {}
  // Sort chips/suggestions by the user's library order; fall back to alpha
  // for anything missing an explicit order.
  const orderedSort = (a, b) => {
    const oa = typeof styles[a]?.order === 'number' ? styles[a].order : 9999
    const ob = typeof styles[b]?.order === 'number' ? styles[b].order : 9999
    if (oa !== ob) return oa - ob
    return String(a).localeCompare(String(b))
  }
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [pos, setPos] = useState({ top: 0, left: 0, openUp: false })
  const wrapRef = useRef(null)
  const inputRef = useRef(null)

  // Hide the "starred" tag (legacy Dial Bucket marker) AND any tag the user
  // has flagged as hidden in their personal side-tag library. Sort by saved
  // library order so chips on the card mirror what's in Settings.
  const visible = (Array.isArray(tags) ? tags : [])
    .filter(t => t && t !== 'starred' && !styleFor(t).hidden)
    .sort(orderedSort)

  // Reposition the portal dropdown relative to the input; flip up when there
  // isn't enough room below. Recalculate on scroll/resize so it tracks the input.
  const calcPos = () => {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const DROPDOWN_H = 280  // matches max-h below
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < DROPDOWN_H + 16 && rect.top > spaceBelow
    setPos({
      left: rect.left,
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      openUp,
    })
  }

  useEffect(() => {
    if (!adding) return
    calcPos()
    const onScroll = () => calcPos()
    const onResize = () => calcPos()
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        // Allow clicks inside the portal dropdown
        const portal = document.getElementById('tag-chips-portal')
        if (portal && portal.contains(e.target)) return
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding])

  const close = () => { setAdding(false); setText('') }

  const addTag = async (raw) => {
    const v = String(raw || '').trim().toLowerCase()
    if (!v) return
    const current = Array.isArray(tags) ? [...tags] : []
    if (current.includes(v)) { close(); return }
    current.push(v)
    try { await onChange(current) } catch {}
    close()
  }

  const removeTag = async (tag) => {
    const next = (Array.isArray(tags) ? tags : []).filter(t => t !== tag)
    try { await onChange(next) } catch {}
  }

  // Autocomplete pool: every defaults + previously-used tag, minus already-on-this-lead.
  // Search filters by .includes() on user text. Sorted by user's library order.
  const trimmed = text.trim().toLowerCase()
  const pool = Array.from(new Set([...SUGGESTED_TAGS, ...suggestions]))
    .filter(s => s && !visible.includes(s) && s !== 'starred' && !styleFor(s).hidden)
    .filter(s => !trimmed || s.toLowerCase().includes(trimmed))
    .sort(orderedSort)

  // Show a "Create '#newtag'" affordance if the typed text isn't already an
  // existing tag (and isn't blank). Makes the create flow discoverable.
  const showCreate = trimmed && !pool.some(s => s.toLowerCase() === trimmed) && !visible.includes(trimmed)

  const dropdown = adding ? (
    <div id="tag-chips-portal"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        transform: pos.openUp ? 'translateY(-100%)' : undefined,
        background: '#0A0E14',
        border: '1px solid #1A2130',
        borderRadius: '4px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
        zIndex: 9999,
        minWidth: 180,
        maxHeight: '280px',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
      {showCreate && (
        <button onMouseDown={e => { e.preventDefault(); addTag(trimmed) }}
          className="block w-full text-left px-2.5 py-2 text-[11px] font-mono text-[#00E5C3] hover:bg-[#1A2130] border-b border-[#1A2130]"
          title="Press Enter">
          + Create <span className="font-bold">#{trimmed}</span>
        </button>
      )}
      {pool.map(s => (
        <button key={s} onMouseDown={e => { e.preventDefault(); addTag(s) }}
          className="block w-full text-left px-2.5 py-1.5 text-[11px] font-mono text-[#8899AA] hover:bg-[#1A2130]">
          #{s}
        </button>
      ))}
      {!showCreate && pool.length === 0 && (
        <p className="px-2.5 py-2 text-[11px] text-[#5A6A7A]">
          {trimmed ? 'No matches — type to create' : 'Type to add a tag'}
        </p>
      )}
    </div>
  ) : null

  return (
    <div className="flex flex-wrap items-center gap-1" onClick={e => e.stopPropagation()}>
      {visible.map(t => {
        const c = styleFor(t).color
        const chipStyle = c
          ? { background: c + '15', color: c, border: `1px solid ${c}40` }
          : { background: '#1A2130', color: '#8899AA', border: '1px solid #2A3547' }
        return (
          <span key={t}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono"
            style={chipStyle}>
            #{t}
            <button onClick={() => removeTag(t)}
              className="opacity-60 hover:opacity-100 transition-opacity leading-none"
              title="Remove tag">
              <X size={9} />
            </button>
          </span>
        )
      })}
      {adding ? (
        <div ref={wrapRef} className="relative">
          <input ref={inputRef} autoFocus value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addTag(text) }
              if (e.key === 'Escape') close()
            }}
            placeholder="search or create tag…"
            className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-[#080B0F] border outline-none w-40"
            style={{ color: '#8899AA', borderColor: '#2A3547' }} />
          {createPortal(dropdown, document.body)}
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="text-[10px] px-1.5 py-0.5 rounded font-mono cursor-pointer hover:opacity-80"
          title="Add tag"
          style={{ background: 'transparent', color: '#5A6A7A', border: '1px dashed #2A3547' }}>
          + tag
        </button>
      )}
    </div>
  )
}

// Inline-editable runner pill — who actually worked / dialed the lead.
// Free-text + a dropdown of recently used runner names for one-click selection.
function RunnerPill({ value, color, onSave, suggestions = [] }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value || '')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => { setText(value || '') }, [value])

  // Close suggestions on outside click
  useEffect(() => {
    if (!editing) return
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) commit() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, text])

  const commit = async () => {
    const trimmed = (text || '').trim()
    if (trimmed !== (value || '')) { try { await onSave(trimmed || null) } catch {} }
    setEditing(false); setOpen(false)
  }
  const cancel = () => { setText(value || ''); setEditing(false); setOpen(false) }
  const pickSuggestion = async (s) => { setText(s); try { await onSave(s) } catch {}; setEditing(false); setOpen(false) }

  if (editing) {
    const filtered = suggestions
      .filter(s => s && s.toLowerCase() !== (text || '').toLowerCase())
      .filter(s => !text || s.toLowerCase().includes(text.toLowerCase()))
      .slice(0, 6)
    return (
      <div ref={wrapRef} className="relative" onClick={e => e.stopPropagation()}>
        <input autoFocus value={text}
          onChange={e => { setText(e.target.value.slice(0, 24)); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
          placeholder="runner"
          className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-[#080B0F] border outline-none w-24"
          style={{ color, borderColor: color + '60' }} />
        {open && filtered.length > 0 && (
          <div className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden border"
            style={{ background: '#0A0E14', borderColor: '#1A2130', boxShadow: '0 8px 20px rgba(0,0,0,0.5)', minWidth: 120 }}>
            {filtered.map(s => (
              <button key={s} onMouseDown={e => { e.preventDefault(); pickSuggestion(s) }}
                className="block w-full text-left px-2.5 py-1.5 text-[11px] font-mono hover:bg-[#1A2130]"
                style={{ color }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }
  const display = value && String(value).trim() ? value : '+ runner'
  const isEmpty = !value || !String(value).trim()
  return (
    <button onClick={(e) => { e.stopPropagation(); setEditing(true); setOpen(true) }}
      className="text-[10px] px-1.5 py-0.5 rounded font-mono cursor-pointer hover:opacity-80 max-w-[140px] truncate inline-flex items-center gap-1"
      title={isEmpty ? 'Set runner' : `Runner: ${value} (click to edit)`}
      style={{
        background: isEmpty ? 'transparent' : '#A78BFA15',
        color: isEmpty ? '#5A6A7A' : '#A78BFA',
        border: isEmpty ? '1px dashed #2A3547' : '1px solid #A78BFA40',
      }}>
      <Users size={9} />{display}
    </button>
  )
}

// Inline-editable price pill — click to type a $ amount, blur or Enter to save
function PricePill({ value, color, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value != null ? String(value) : '')
  useEffect(() => { setText(value != null ? String(value) : '') }, [value])

  const commit = async () => {
    const cleaned = String(text).replace(/[^0-9.\-]/g, '')
    const num = cleaned === '' ? null : parseFloat(cleaned)
    if (num !== value) {
      try { await onSave(isNaN(num) ? null : num) } catch {}
    }
    setEditing(false)
  }
  const cancel = () => { setText(value != null ? String(value) : ''); setEditing(false) }

  if (editing) {
    return (
      <input autoFocus value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
        placeholder="$"
        className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-[#080B0F] border outline-none w-16"
        style={{ color, borderColor: color + '60' }} />
    )
  }
  const display = value != null && !isNaN(value) ? `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: value % 1 === 0 ? 0 : 2 })}` : '—'
  return (
    <button onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      className="text-[10px] px-1.5 py-0.5 rounded font-mono cursor-pointer hover:opacity-80"
      title="Click to edit lead cost"
      style={{ background: color + '15', color }}>
      {display}
    </button>
  )
}

// Notes textarea: auto-fits content between 6 lines (min) and 15 lines (max).
// Past 15 lines the textarea caps and scrolls internally. User can also drag
// the bottom-right corner to expand into a huge notepad whenever they want.
const NOTES_MIN_H = 132   // ~6 lines at our padding/line-height
const NOTES_MAX_H = 330   // ~15 lines — content past this scrolls internally
function NotesField({ value, onSave, placeholder }) {
  const ref = useRef(null)
  const [text, setText] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)
  const initialRef = useRef(value || '')

  useEffect(() => { setText(value || ''); initialRef.current = value || '' }, [value])

  // Auto-fit height to content within [min, max]. Beyond max, the user can
  // still drag the resize handle to make it as big as they want — we ONLY
  // grow auto-fit, never shrink, so manual resize sticks across re-renders.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const currentH = el.offsetHeight
    const probeH = el.style.height
    el.style.height = 'auto'
    const sh = el.scrollHeight
    el.style.height = probeH || ''
    const autoH = Math.min(NOTES_MAX_H, Math.max(NOTES_MIN_H, sh))
    if (autoH > currentH) el.style.height = autoH + 'px'
  }, [text])

  const handleFocus = (e) => {
    e.currentTarget.style.borderColor = '#00E5C3'
    e.currentTarget.style.background = '#0E141B'
  }
  const handleBlur = async (e) => {
    e.currentTarget.style.borderColor = '#2F3A4A'
    e.currentTarget.style.background = '#0B0F14'
    if (text === initialRef.current) return
    setSaving(true)
    try { await onSave(text); initialRef.current = text; setSavedTick(true); setTimeout(() => setSavedTick(false), 1800) }
    catch { /* swallow */ }
    setSaving(false)
  }

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <textarea
        ref={ref}
        value={text}
        onChange={e => setText(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
        style={{
          color: '#E0E8F0',
          background: '#0B0F14',
          border: '1px solid #2F3A4A',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.45)',
          minHeight: NOTES_MIN_H + 'px',
          // No maxHeight — drag the corner as far as you want for huge notepad mode.
          resize: 'vertical',
          overflowY: 'auto',
          transition: 'border-color 120ms, background-color 120ms',
        }}
      />
      {(saving || savedTick) && (
        <div className="absolute top-1.5 right-6 flex items-center gap-1 text-[10px] font-mono pointer-events-none"
          style={{ color: savedTick ? '#00E5C3' : '#5A6A7A' }}>
          {saving && <span>saving…</span>}
          {savedTick && <><Check size={10} /> saved</>}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Lead card
// ───────────────────────────────────────────────────────────────────────────
const ACT_ICONS = { call: Phone, text: MessageSquare, email: AtSign, note: StickyNote, status: Zap, apt: Calendar }
const ACT_COLORS = { call: '#10B981', text: '#3B82F6', email: '#8B5CF6', note: '#F59E0B', status: '#00E5C3', apt: '#F97316' }

// Scrollable mini activity log for the Leads card's right column — sits
// below "Received" and shows up to 5 most-recent activities for this lead.
// Internally scrollable when entries overflow so the card height stays sane.
function RecentActionsList({ entries }) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) {
    return <p className="text-[10px] text-[#3A4A5A] italic">No actions yet</p>
  }
  return (
    <div className="space-y-1 overflow-y-auto pr-1" style={{ maxHeight: '78px' }}>
      {list.map((e, i) => {
        const Icon = ACT_ICONS[e.type] || StickyNote
        const color = ACT_COLORS[e.type] || '#5A6A7A'
        let ago = ''
        try { ago = formatDistanceToNow(new Date(e.created_at), { addSuffix: true }) } catch {}
        return (
          <div key={e.id || i} className="flex items-start gap-1.5"
            title={`${e.type} · ${e.note || ''} · ${ago}`}>
            <Icon size={9} style={{ color }} className="flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-[#8899AA] truncate leading-tight">{e.note || `(${e.type})`}</p>
              <p className="text-[9px] text-[#3A4A5A] font-mono leading-tight">{ago}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LeadCard({ lead, selected, onSelect, onStageChange, onNoteChange, onNoteBChange, onNavigate, onDelete, onPriceChange, onCampaignChange, onRunnerChange, onTagsChange, runnerSuggestions, tagSuggestions, canDelete = true }) {
  const { tags, getTag, splitNotes, pipelineCardFields, recentActivitiesByLead } = useApp()
  const showRunner = pipelineCardFields?.runner !== false
  const [copied, setCopied] = useState(false)
  const [nameCopied, setNameCopied] = useState(false)
  const [emailCopied, setEmailCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const safeTags = Array.isArray(tags) && tags.length > 0 ? tags : [{ id: 'not-started', label: 'Not Started', color: '#8899AA', bg: '#1A2130' }]
  const stageId = leadStageId(lead, safeTags)
  const tag = (typeof getTag === 'function' ? getTag(stageId) : null) || safeTags.find(t => t.id === stageId) || safeTags[0]
  const fullName = leadName(lead) || '—'
  const safeColor = tag?.color || '#5A6A7A'
  const safeBg = tag?.bg || '#1A2130'

  const copyPhone = (e) => {
    e.stopPropagation()
    if (lead.phone) navigator.clipboard.writeText(copyPhoneValue(lead.phone))
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  const copyName = (e) => {
    e.stopPropagation()
    if (fullName && fullName !== '—') navigator.clipboard.writeText(fullName)
    setNameCopied(true); setTimeout(() => setNameCopied(false), 1500)
  }
  const copyEmail = (e) => {
    e.stopPropagation()
    if (lead.email) navigator.clipboard.writeText(lead.email)
    setEmailCopied(true); setTimeout(() => setEmailCopied(false), 1500)
  }

  return (
    <div className="rounded-xl border overflow-hidden transition-all duration-200"
      style={{ background: safeBg, borderColor: selected ? safeColor : safeColor + '30', borderWidth: selected ? '2px' : '1px' }}>
      <div className="grid gap-3 px-4 pt-3 pb-2 items-start" style={{ gridTemplateColumns: '28px 1.8fr 0.9fr 1.4fr 1fr 80px' }}>
        <div className="pt-1" onClick={e => e.stopPropagation()}>
          <button onClick={() => onSelect(lead.id)} className="text-[#3A4A5A] hover:text-white transition-colors">
            {selected ? <CheckSquare size={16} style={{ color: safeColor }} /> : <Square size={16} />}
          </button>
        </div>

        <div>
          {/* Name: clicking copies to clipboard (does NOT navigate or dial) */}
          <button onClick={copyName}
            className="text-sm font-semibold text-left mb-1 inline-flex items-center gap-1.5"
            style={{ color: 'white' }}
            onMouseEnter={e => e.currentTarget.style.color = safeColor}
            onMouseLeave={e => e.currentTarget.style.color = 'white'}
            title="Click to copy name">
            {fullName}
            {nameCopied
              ? <Check size={11} className="text-[#00E5C3] flex-shrink-0" />
              : <Copy size={10} className="text-[#3A4A5A] flex-shrink-0 opacity-60" />}
          </button>
          <div className="flex items-center gap-1.5 mb-1">
            {/* Phone: clicking opens the lead detail (does NOT dial). Only the
                Call button dials. The little Copy icon copies the number. */}
            {lead.phone && (
              <button onClick={(e) => { e.stopPropagation(); onNavigate(lead.id) }}
                className="text-sm font-mono hover:underline"
                style={{ color: safeColor }}
                title="Click to open this lead">
                {displayPhone(lead.phone)}
              </button>
            )}
            {lead.phone && (
              <button onClick={copyPhone}
                className="text-[#3A4A5A] hover:text-[#8899AA] transition-colors"
                title="Copy phone number">
                {copied ? <Check size={11} className="text-[#00E5C3]" /> : <Copy size={11} />}
              </button>
            )}
          </div>
          {lead.email && (
            <button onClick={copyEmail}
              title={`Click to copy · ${lead.email}`}
              className="text-xs text-[#5A6A7A] hover:text-[#8899AA] transition-colors mb-1 inline-flex items-center gap-1 max-w-full text-left">
              <span className="truncate min-w-0">{lead.email}</span>
              {emailCopied
                ? <Check size={10} className="text-[#00E5C3] flex-shrink-0" />
                : <Copy size={10} className="text-[#3A4A5A] flex-shrink-0 opacity-60" />}
            </button>
          )}
          <SoldBadge lead={lead} />
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <PitchCountdown leadId={lead.id} />
            <span className="text-xs text-[#5A6A7A]">{[lead.state, lead.zip].filter(Boolean).join(' ')}</span>
            <LocalTime lead={lead} />
            <CampaignPill value={lead.campaign || lead.source} color={safeColor} onSave={(v) => onCampaignChange(lead.id, v)} />
            <PricePill value={lead.price} color={safeColor} onSave={(v) => onPriceChange(lead.id, v)} />
            {showRunner && <RunnerPill value={lead.runner} color={safeColor} onSave={(v) => onRunnerChange(lead.id, v)} suggestions={runnerSuggestions} />}
            {lead.comments && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono max-w-[180px] truncate"
                title={lead.comments}
                style={{ background: '#F59E0B15', color: '#F59E0B', border: '1px solid #F59E0B30' }}>
                {lead.comments}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-0.5" onClick={e => e.stopPropagation()}>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold text-black transition-opacity hover:opacity-80"
              style={{ background: `linear-gradient(135deg, ${safeColor}, ${safeColor}AA)` }}>
              <Phone size={12} /> Call
            </a>
          )}
          <TagPill stage={stageId} tags={safeTags} onChange={(s) => onStageChange(lead.id, s)} />
        </div>

        <div className="space-y-1.5">
          {(lead.household || lead.household_size) && (
            <div className="flex items-center gap-1.5">
              <Home size={11} className="text-[#3A4A5A]" />
              <span className="text-xs text-[#8899AA]">Household: {lead.household || lead.household_size}</span>
            </div>
          )}
          {(lead.income !== null && lead.income !== undefined && lead.income !== '') && (
            <div className="flex items-center gap-1.5">
              <DollarSign size={11} className="text-[#3A4A5A]" />
              <span className="text-xs text-[#8899AA]">{(() => {
                const v = String(lead.income).trim()
                // USHA emails ship ranges like "$50,000 - $75,000" — render as-is
                if (/[-–~]/.test(v) && /\d/.test(v)) return v.startsWith('$') ? v + '/yr' : '$' + v + '/yr'
                const n = Number(v.replace(/[^0-9.]/g, ''))
                return isFinite(n) && n > 0 ? `$${n.toLocaleString()}/yr` : v
              })()}</span>
            </div>
          )}
          {lead.dob && (
            <div className="flex items-center gap-1.5">
              <Calendar size={11} className="text-[#3A4A5A]" />
              <DOBField dob={lead.dob} />
            </div>
          )}
          {lead.gender && <p className="text-xs text-[#5A6A7A]">{lead.gender}{lead.age_range ? ` · ${lead.age_range}` : ''}</p>}
          {lead.smoker && String(lead.smoker).toLowerCase() !== 'no' && String(lead.smoker).toLowerCase() !== 'false' && (
            <p className="text-xs text-[#F97316]">Smoker</p>
          )}
          {lead.plan_choice && <p className="text-xs text-[#5A6A7A]">Plan: {lead.plan_choice}</p>}
          {lead.monthly_budget && <p className="text-xs text-[#5A6A7A]">Budget: ${lead.monthly_budget}/mo</p>}
          {lead.premium && (
            <p className="text-xs font-mono" style={{ color: safeColor }}>${lead.premium}/mo · {lead.carrier || ''}</p>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-[10px] text-[#3A4A5A] font-mono uppercase tracking-wider">Received</p>
          <p className="text-xs text-[#8899AA]">{safeFormat(lead.created_at, 'MM-dd-yyyy')}</p>
          <div className="pt-1.5 mt-1.5 border-t border-[#1A2130]">
            <p className="text-[10px] text-[#3A4A5A] font-mono uppercase tracking-wider mb-1">Recent</p>
            <RecentActionsList entries={recentActivitiesByLead?.[lead.id]} />
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 pt-0.5">
          {/* Quick-email button — small, top-right, opens the compose modal
              without leaving the Leads list. */}
          {lead.email && (
            <EmailButton lead={lead} variant="compact" />
          )}
          <button onClick={() => onNavigate(lead.id)}
            className="p-1.5 rounded-lg text-[#3A4A5A] hover:text-white transition-colors" title="Open detail">
            <ExternalLink size={14} />
          </button>
          <button onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg text-[#3A4A5A] hover:text-white transition-colors">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${fullName}"? This cannot be undone.`)) onDelete?.(lead.id) }}
              className="p-1.5 rounded-lg text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415] transition-colors"
              title="Delete lead">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Secondary tags row — multi-select chips, independent of pipeline stage */}
      <div className="px-4 pb-2 pl-12">
        <TagChips
          tags={lead.tags}
          onChange={(next) => onTagsChange?.(lead.id, next)}
          suggestions={tagSuggestions}
        />
      </div>

      {/* Notes — primary element on every card. Split mode shows a blank
          companion textarea so you can keep, e.g. "history" vs "next steps". */}
      <div className="px-4 pb-3 pl-12">
        {splitNotes ? (
          <div className="grid grid-cols-2 gap-2">
            <NotesField
              value={lead.notes || ''}
              onSave={(v) => onNoteChange(lead.id, v)}
              placeholder="Add notes…"
            />
            <NotesField
              value={lead.notes_b || ''}
              onSave={(v) => onNoteBChange(lead.id, v)}
              placeholder="Notes (B)…"
            />
          </div>
        ) : (
          <NotesField
            value={lead.notes || ''}
            onSave={(v) => onNoteChange(lead.id, v)}
            placeholder="Add notes…"
          />
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-[#1A2130]">
          <div className="grid grid-cols-3 gap-3 pt-3">
            <div className="p-2.5 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F40' }}>
              <p className="text-[10px] text-[#3A4A5A] font-mono uppercase tracking-wider mb-1">Agent</p>
              <p className="text-xs text-white">{lead.agent || '—'}</p>
            </div>
            <div className="p-2.5 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F40' }}>
              <p className="text-[10px] text-[#3A4A5A] font-mono uppercase tracking-wider mb-1">Last Activity</p>
              <p className="text-xs text-white">{safeRel(lead.last_activity || lead.created_at) || '—'}</p>
            </div>
            <div className="p-2.5 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F40' }}>
              <p className="text-[10px] text-[#3A4A5A] font-mono uppercase tracking-wider mb-1">Zip Code</p>
              <p className="text-xs text-white">{lead.zip || '—'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Side-tag filter pills — multi-select. Built dynamically from every distinct
// tag in use across the user's leads.
function TagFilterPills({ tagFilters, setTagFilters, leads }) {
  const ref = useDragScroll()
  const safeLeads = Array.isArray(leads) ? leads : []
  const all = useMemo(() => {
    const counts = new Map()
    for (const l of safeLeads) {
      for (const t of (Array.isArray(l.tags) ? l.tags : [])) {
        if (!t || t === 'starred') continue
        counts.set(t, (counts.get(t) || 0) + 1)
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])  // most-used first
  }, [safeLeads])

  if (all.length === 0) return null
  const toggle = (t) => setTagFilters(prev => {
    const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n
  })

  return (
    <div ref={ref} className="flex gap-2 px-6 pb-2 overflow-x-auto items-center"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab', WebkitOverflowScrolling: 'touch' }}>
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#3A4A5A] flex-shrink-0 mr-1">Side tags</span>
      {all.map(([t, count]) => {
        const active = tagFilters.has(t)
        return (
          <button key={t} onClick={() => toggle(t)}
            className="px-2.5 py-1 rounded-full text-xs whitespace-nowrap flex-shrink-0 transition-all font-mono"
            style={active
              ? { background: '#A78BFA15', color: '#A78BFA', border: '1px solid #A78BFA60' }
              : { color: '#5A6A7A', border: '1px solid #1A2130' }}>
            #{t} <span className="opacity-60">({count})</span>
          </button>
        )
      })}
      {tagFilters.size > 0 && (
        <button onClick={() => setTagFilters(new Set())}
          className="text-[10px] text-[#5A6A7A] hover:text-white px-2 flex-shrink-0">
          clear
        </button>
      )}
    </div>
  )
}

// Campaign filter pills — buckets every lead by its campaign (or source as
// fallback). Multi-select. Includes a '(none)' bucket for leads with no
// campaign so they're still selectable.
function CampaignFilterPills({ campaignFilters, setCampaignFilters, leads }) {
  const ref = useDragScroll()
  const safeLeads = Array.isArray(leads) ? leads : []
  const counts = useMemo(() => {
    const m = new Map()
    for (const l of safeLeads) {
      const c = (l.campaign && String(l.campaign).trim()) || (l.source && String(l.source).trim()) || '(none)'
      m.set(c, (m.get(c) || 0) + 1)
    }
    return m
  }, [safeLeads])
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])  // most-used first
  if (entries.length === 0) return null

  const toggle = (c) => setCampaignFilters(prev => {
    const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n
  })

  return (
    <div ref={ref} className="flex gap-2 px-6 pb-2 overflow-x-auto items-center"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab', WebkitOverflowScrolling: 'touch' }}>
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#3A4A5A] flex-shrink-0 mr-1">Campaigns</span>
      {entries.map(([c, count]) => {
        const active = campaignFilters.has(c)
        return (
          <button key={c} onClick={() => toggle(c)}
            className="px-2.5 py-1 rounded-full text-xs font-mono whitespace-nowrap flex-shrink-0"
            style={active
              ? { background: '#10B98115', color: '#10B981', border: '1px solid #10B98160' }
              : { color: '#5A6A7A', border: '1px solid #1A2130' }}>
            {c} <span className="opacity-60">({count})</span>
          </button>
        )
      })}
      {campaignFilters.size > 0 && (
        <button onClick={() => setCampaignFilters(new Set())}
          className="text-[10px] text-[#5A6A7A] hover:text-white px-2 flex-shrink-0">
          clear
        </button>
      )}
    </div>
  )
}

// Time-zone filter pills — uses tzShortFor() to bucket every lead into a
// short zone label (EST/CST/MST/PST/AZ/AK/HI). Multi-select.
function TzFilterPills({ tzFilters, setTzFilters, leads }) {
  const ref = useDragScroll()
  const safeLeads = Array.isArray(leads) ? leads : []
  const counts = useMemo(() => {
    const m = new Map()
    for (const l of safeLeads) {
      const z = tzShortFor(l)
      if (!z) continue
      m.set(z, (m.get(z) || 0) + 1)
    }
    return m
  }, [safeLeads])

  // Stable order so the pills don't shuffle as leads come in
  const ZONE_ORDER = ['EST','CST','MST','PST','AZ','AK','HI']
  const zones = ZONE_ORDER.filter(z => counts.has(z))
  if (zones.length === 0) return null

  const toggle = (z) => setTzFilters(prev => {
    const n = new Set(prev); n.has(z) ? n.delete(z) : n.add(z); return n
  })

  return (
    <div ref={ref} className="flex gap-2 px-6 pb-2 overflow-x-auto items-center"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab', WebkitOverflowScrolling: 'touch' }}>
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#3A4A5A] flex-shrink-0 mr-1">Time zones</span>
      {zones.map(z => {
        const active = tzFilters.has(z)
        return (
          <button key={z} onClick={() => toggle(z)}
            className="px-2.5 py-1 rounded-full text-xs whitespace-nowrap flex-shrink-0 transition-all font-mono"
            style={active
              ? { background: '#22D3EE15', color: '#22D3EE', border: '1px solid #22D3EE60' }
              : { color: '#5A6A7A', border: '1px solid #1A2130' }}>
            {z} <span className="opacity-60">({counts.get(z)})</span>
          </button>
        )
      })}
      {tzFilters.size > 0 && (
        <button onClick={() => setTzFilters(new Set())}
          className="text-[10px] text-[#5A6A7A] hover:text-white px-2 flex-shrink-0">
          clear
        </button>
      )}
    </div>
  )
}

// Filter pills
function DragScrollPills({ stageFilter, setStageFilter, tags, leads }) {
  const ref = useDragScroll()
  const safeTags = Array.isArray(tags) ? tags : []
  const safeLeads = Array.isArray(leads) ? leads : []
  return (
    <div ref={ref} className="flex gap-2 px-6 pb-2 overflow-x-auto"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab', WebkitOverflowScrolling: 'touch' }}>
      <button onClick={() => setStageFilter('')}
        className="px-3 py-1 rounded-full text-xs whitespace-nowrap flex-shrink-0 border transition-all"
        style={!stageFilter ? { background: '#1A2130', color: 'white', borderColor: '#2A3547' } : { color: '#5A6A7A', borderColor: '#1A2130' }}>
        All ({safeLeads.length})
      </button>
      {safeTags.map(t => (
        <button key={t.id} onClick={() => setStageFilter(stageFilter === t.id ? '' : t.id)}
          className="px-3 py-1 rounded-full text-xs whitespace-nowrap flex-shrink-0 transition-all"
          style={stageFilter === t.id
            ? { background: t.bg, color: t.color, border: `1px solid ${t.color}60` }
            : { color: '#5A6A7A', border: '1px solid #1A2130' }}>
          {t.label} ({safeLeads.filter(l => leadStageId(l, safeTags) === t.id).length})
        </button>
      ))}
    </div>
  )
}

// Kanban column
function KanbanCol({ tag, leads, onLeadClick, onDrop }) {
  const [dragOver, setDragOver] = useState(false)
  return (
    <div className="flex flex-col rounded-xl border min-w-[240px] w-[240px] transition-colors"
      style={{ background: dragOver ? tag.color + '08' : '#0E1318', borderColor: dragOver ? tag.color : '#1A2130' }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDrop(tag.id) }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1A2130]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: tag.color }} />
          <span className="text-xs font-mono uppercase tracking-wider" style={{ color: tag.color }}>{tag.label}</span>
        </div>
        <span className="text-xs font-mono text-[#5A6A7A]">{leads.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {leads.map(lead => (
          <div key={lead.id} draggable onDragStart={e => e.dataTransfer.setData('leadId', lead.id)}
            onClick={() => onLeadClick(lead.id)}
            className="p-3 rounded-lg border cursor-pointer transition-colors group"
            style={{ background: tag.bg, borderColor: tag.color + '30' }}>
            <button className="text-sm font-medium text-white group-hover:underline text-left block truncate w-full">{leadName(lead) || '—'}</button>
            <p className="text-xs font-mono mt-1" style={{ color: tag.color }}>{displayPhone(lead.phone) || ''}</p>
            <p className="text-xs text-[#3A4A5A] mt-1">{[lead.state, lead.zip].filter(Boolean).join(' · ')}{lead.campaign ? ` · ${lead.campaign}` : ''}</p>
          </div>
        ))}
        {leads.length === 0 && (
          <div className="flex items-center justify-center h-16 border border-dashed rounded-lg" style={{ borderColor: dragOver ? tag.color : '#1A2130' }}>
            <p className="text-xs" style={{ color: dragOver ? tag.color : '#3A4A5A' }}>{dragOver ? 'Drop here' : 'Empty'}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Ringy / ISalesCRM CSV import — column mapping
// All target field names below MUST exist in the leads table schema.
// ───────────────────────────────────────────────────────────────────────────
const RINGY_MAP = {
  'first name': 'first_name', 'firstname': 'first_name', 'fname': 'first_name',
  'last name': 'last_name',  'lastname':  'last_name',  'lname': 'last_name',
  // 'full name' / 'name' / 'contact' fields are split into first_name + last_name later
  'full name': '_fullname', 'name': '_fullname', 'contact name': '_fullname', 'contact': '_fullname',

  'phone': 'phone', 'phone number': 'phone', 'phonenumber': 'phone',
  'mobile': 'phone', 'mobile phone': 'phone', 'cell': 'phone',
  'cell phone': 'phone', 'primary phone': 'phone', 'phone 1': 'phone',

  'email': 'email', 'email address': 'email', 'emailaddress': 'email',

  'address': 'address', 'street': 'street_address', 'address 1': 'address',
  'street address': 'street_address',
  'city': 'city',
  'state': 'state', 'state/province': 'state', 'province': 'state',
  'zip': 'zip', 'zip code': 'zip', 'zipcode': 'zip', 'postal code': 'zip', 'postal': 'zip',

  'source': 'source', 'lead source': 'source', 'lead vendor': 'source', 'vendor': 'source',

  // Pipeline: Ringy may use any of these; we'll convert to a stage id
  'status': '_stagelike', 'lead status': '_stagelike', 'stage': '_stagelike',
  'disposition': '_stagelike', 'lead disposition': '_stagelike',

  // Tags — comma/semicolon/pipe separated; tags that match a stage label
  // get pulled out and used as the stage, the rest become freeform tags
  'tags': '_tagsraw', 'disposition tags': '_tagsraw', 'lead tags': '_tagsraw', 'labels': '_tagsraw',

  'notes': 'notes', 'note': 'notes', 'agent notes': 'notes', 'description': 'notes',
  'comments': 'comments', 'comment': 'comments', 'lead comments': 'comments',

  'contact id': 'external_id', 'id': 'external_id', 'lead id': 'external_id', 'ringy id': 'external_id',

  // Ringy / USHA original received-on date — maps to created_at so imported
  // leads sort by their real arrival time, not when you clicked Import.
  'received on': '_received', 'received': '_received',
  'date added': '_received', 'created': '_received', 'date created': '_received',
  'created at': '_received', 'created_at': '_received',
  'lead date': '_received', 'date': '_received',

  'dob': 'dob', 'date of birth': 'dob', 'birthday': 'dob', 'birth date': 'dob', 'birthdate': 'dob',
  'gender': 'gender', 'sex': 'gender',
  'age': 'age', 'age range': 'age_range',
  'smoker': 'smoker', 'tobacco': 'smoker',
  'income': 'income', 'annual income': 'income',
  'household': 'household', 'household size': 'household', 'family size': 'household', 'members': 'household',
  'spouse age': 'spouse_age', 'num children': 'num_children', 'children': 'num_children', 'kids': 'num_children',

  'campaign': 'campaign', 'price': 'price', 'lead cost': 'price',
  'premium': 'premium', 'monthly premium': 'premium',
  'carrier': 'carrier', 'insurance carrier': 'carrier', 'plan': 'carrier',
  'current carrier': 'current_carrier',
  'effective date': 'effective_date', 'start date': 'effective_date', 'policy start': 'effective_date',
  'plan choice': 'plan_choice',
  'monthly budget': 'monthly_budget', 'budget': 'monthly_budget',
  'best contact time': 'best_contact_time', 'contact time': 'best_contact_time',

  'agent': 'agent', 'assigned to': 'agent', 'agent name': 'agent',
  'is sold': 'is_sold', 'sold': 'is_sold',
}

// Schema whitelist — anything outside this set is silently dropped before insert
const LEADS_COLUMNS = new Set([
  'first_name','last_name','phone','email','city','state','zip','address','street_address',
  'source','notes','notes_b','comments','dob','gender','age','age_range','smoker','spouse_age','num_children',
  'income','household','external_id','agent','agent_id','campaign','price',
  'premium','carrier','current_carrier','effective_date','plan_choice','monthly_budget','best_contact_time',
  'tags','stage','is_sold','user_id','created_at','last_activity',
  'runner',  // free-text attribution: who actually worked the lead
  'stage_changed_at','custom_fields',
])
const STATUS_MAP = {
  'new': 'Not Started', 'fresh': 'Not Started', 'new lead': 'Not Started',
  'not started': 'Not Started', 'not contacted': 'Not Started', 'uncontacted': 'Not Started',
  'interested': 'Interested', 'hot': 'Interested', 'warm': 'Interested',
  'working': 'Interested', 'in progress': 'Interested', 'engaged': 'Interested',
  'lead replied positive': 'Interested', 'replied positive': 'Interested',
  'positive reply': 'Interested', 'lead positive reply': 'Interested',
  'apt': 'Apt', 'appointment': 'Apt', 'scheduled': 'Apt', 'appointment set': 'Apt',
  'sold': 'Sold', 'closed': 'Sold', 'won': 'Sold', 'enrolled': 'Sold',
  'ghosted': 'Ghosted', 'no answer': 'Ghosted', 'no response': 'Ghosted',
  'aged': 'Aged', 'old': 'Aged', 'stale': 'Aged',
  'stop': 'Stop', 'do not call': 'Stop', 'dnc': 'Stop', 'not interested': 'Stop',
  'long term': 'Long Term', 'future': 'Long Term', 'follow up later': 'Long Term',
}
const STATUSES = ['Not Started','Interested','Apt','Ghosted','Sold','Aged','Stop','Long Term']
function normalizeStatus(raw) {
  if (!raw) return 'Not Started'
  const lower = String(raw).trim().toLowerCase()
  return STATUS_MAP[lower] || STATUSES.find(s => s.toLowerCase() === lower) || 'Not Started'
}
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }
  const delim = lines[0].includes('\t') ? '\t' : ','
  function parseLine(line) {
    const result = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++ } else inQ = !inQ }
      else if (ch === delim && !inQ) { result.push(cur.trim()); cur = '' }
      else cur += ch
    }
    result.push(cur.trim())
    return result
  }
  const rawHeaders = parseLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i])
    if (vals.every(v => !v)) continue
    const row = {}
    rawHeaders.forEach((h, idx) => { row[h] = vals[idx] || '' })
    rows.push(row)
  }
  return { headers: rawHeaders, rows }
}
// Convert a Ringy / USHA status-ish label into a stage id we have in `tags`.
// Resolution order:
//   1. Direct match on a tags row's label (covers any custom stage user added,
//      e.g. "Pitched", "Quoted", "Underwriting")
//   2. STATUS_MAP synonyms (e.g. "appointment" -> "Apt")
//   3. STATUSES default list match
function statusLabelToStageId(label, dbTags) {
  if (!label) return null
  const lower = String(label).trim().toLowerCase()
  // 1. direct match against a custom or default tag's label
  if (Array.isArray(dbTags) && dbTags.length) {
    const direct = dbTags.find(t => (t.label || '').toLowerCase() === lower)
    if (direct) return direct.id
  }
  // 2-3. fall through to legacy synonyms / 8-stage defaults
  const mapped = STATUS_MAP[lower] || STATUSES.find(s => s.toLowerCase() === lower)
  if (!mapped) return null
  if (Array.isArray(dbTags) && dbTags.length) {
    const hit = dbTags.find(t => (t.label || '').toLowerCase() === mapped.toLowerCase())
    if (hit) return hit.id
  }
  return mapped.toLowerCase().replace(/\s+/g, '-')
}

// Pick the candidate stage label from a raw CSV row — matches mapRow's logic.
// Used pre-import to find labels we should auto-create as custom stages.
function pickStageCandidate(rawRow) {
  // 1. explicit status/stage/disposition column
  for (const [col, val] of Object.entries(rawRow)) {
    const key = String(col).toLowerCase().trim()
    if (RINGY_MAP[key] === '_stagelike' && val && String(val).trim()) {
      return String(val).trim()
    }
  }
  // 2. first tag in the tags column
  for (const [col, val] of Object.entries(rawRow)) {
    const key = String(col).toLowerCase().trim()
    if (RINGY_MAP[key] === '_tagsraw' && val && String(val).trim()) {
      const list = String(val).split(/[,;|]/).map(t => t.trim()).filter(Boolean)
      return list[0] || null
    }
  }
  return null
}

// Test whether a Ringy tag matches ANY stage label (custom or default)
function tagMatchesStage(tagText, dbTags) {
  if (!tagText) return false
  const lower = String(tagText).trim().toLowerCase()
  if (Array.isArray(dbTags) && dbTags.find(t => (t.label || '').toLowerCase() === lower)) return true
  if (STATUS_MAP[lower]) return true
  if (STATUSES.find(s => s.toLowerCase() === lower)) return true
  return false
}

function mapRow(row, dbTags) {
  const raw = {}
  for (const [col, val] of Object.entries(row)) {
    const key = String(col).toLowerCase().trim()
    const field = RINGY_MAP[key]
    if (field && val && String(val).trim()) raw[field] = String(val).trim()
  }

  // Split a "Full Name" / "Name" / "Contact" column into first/last if needed
  if (raw._fullname && (!raw.first_name || !raw.last_name)) {
    const parts = raw._fullname.split(/\s+/).filter(Boolean)
    if (!raw.first_name) raw.first_name = parts[0] || ''
    if (!raw.last_name) raw.last_name = parts.slice(1).join(' ')
  }
  delete raw._fullname

  if (raw.phone) raw.phone = normalizePhone(raw.phone)

  // Parse tags column (comma/semicolon/pipe separated)
  let tagList = []
  if (raw._tagsraw) {
    tagList = raw._tagsraw.split(/[,;|]/).map(t => t.trim()).filter(Boolean)
    delete raw._tagsraw
  }

  // Pipeline stage = explicit status column OR the FIRST tag in the tags
  // column. Whatever isn't the pipeline tag becomes a secondary chip — even
  // if it could have matched another stage. This is the seamless Ringy →
  // Infinite flow: a lead tagged "Pitched, Callback, Voicemail" lands in
  // Pitched with #callback + #voicemail as side chips.
  let stageLabel = raw._stagelike || null
  delete raw._stagelike
  if (!stageLabel && tagList.length > 0) stageLabel = tagList[0]
  raw.stage = statusLabelToStageId(stageLabel, dbTags) || 'not-started'

  // Side tags = every tag that isn't the chosen pipeline tag
  const stageLower = (stageLabel || '').toLowerCase()
  raw.tags = tagList.filter(t => t.toLowerCase() !== stageLower)

  // Coerce numeric fields. income is TEXT in the schema so range strings
  // ('$50,000 - $75,000') survive verbatim — no parseInt needed.
  if (raw.household) raw.household = parseInt(raw.household) || null
  if (raw.premium) raw.premium = parseInt(String(raw.premium).replace(/[^0-9.\-]/g, '')) || null
  if (raw.price) raw.price = parseFloat(String(raw.price).replace(/[^0-9.\-]/g, '')) || null
  if (raw.spouse_age) raw.spouse_age = parseInt(raw.spouse_age) || null
  if (raw.num_children) raw.num_children = parseInt(raw.num_children) || null
  if (raw.is_sold !== undefined) raw.is_sold = String(raw.is_sold).toLowerCase() === 'true' || String(raw.is_sold).toLowerCase() === 'yes' || raw.is_sold === '1' || raw.is_sold === 1

  // Parse the original received-on date (Ringy "Date Added", "Received On", etc.)
  // Maps to created_at + last_activity so imported leads sort by their real
  // arrival timestamp instead of all clumping at the import moment.
  if (raw._received) {
    const d = new Date(raw._received)
    if (!isNaN(d.getTime())) {
      raw.created_at = d.toISOString()
      raw.last_activity = d.toISOString()
    }
  }
  delete raw._received

  // Drop columns that don't exist in our schema (silently)
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (LEADS_COLUMNS.has(k)) out[k] = v
  }
  return out
}

// CSV export
function exportCSV(leads) {
  const headers = ['name','first_name','last_name','phone','email','state','city','zip','address',
    'status','source','dob','gender','income','household_size','notes','agent','created_at','last_activity']
  const rows = leads.map(l => headers.map(h => {
    const v = l[h] ?? ''
    return `"${String(v).replace(/"/g, '""')}"`
  }))
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `infinite-leads-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN
// ───────────────────────────────────────────────────────────────────────────
export default function Leads() {
  const { user, leads, tags, updateLeadStage, updateLead, refreshLeads, deleteLead, deleteLeads, deleteAllLeadsForUser, isRunner, can, sideTagStyles } = useApp()
  const navigate = useNavigate()

  // Filter persistence — survives clicking into a lead and coming back, OR a
  // full tab reload, by stashing the entire filter state under a single
  // sessionStorage key. Sets are serialized as arrays.
  const LEADS_STATE_KEY = 'leads:viewState'
  const initialState = (() => {
    try {
      const raw = sessionStorage.getItem(LEADS_STATE_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return {}
  })()

  const [view, setView] = useState(initialState.view || 'list')
  const [search, setSearch] = useState(initialState.search || '')
  const [stageFilter, setStageFilter] = useState(initialState.stageFilter || '')
  const [tagFilters, setTagFilters] = useState(() => new Set(initialState.tagFilters || []))
  const [tzFilters, setTzFilters] = useState(() => new Set(initialState.tzFilters || []))
  const [campaignFilters, setCampaignFilters] = useState(() => new Set(initialState.campaignFilters || []))
  const [sortBy, setSortBy] = useState(initialState.sortBy || 'created_desc')
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [dragLeadId, setDragLeadId] = useState(null)
  const fileRef = useRef(null)

  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState(null)
  const [unmappedCols, setUnmappedCols] = useState([])
  const [importResult, setImportResult] = useState(null)

  // Write filter state back to sessionStorage whenever any of it changes so a
  // round-trip into LeadDetail and back doesn't blow away the agent's view.
  useEffect(() => {
    try {
      sessionStorage.setItem(LEADS_STATE_KEY, JSON.stringify({
        view, search, stageFilter, sortBy,
        tagFilters: Array.from(tagFilters),
        tzFilters: Array.from(tzFilters),
        campaignFilters: Array.from(campaignFilters),
      }))
    } catch {}
  }, [view, search, stageFilter, sortBy, tagFilters, tzFilters, campaignFilters])

  // Scroll-position preservation. When the agent clicks into a lead and comes
  // back, we want them dropped right where they were — not jumped to the top.
  // The list view container is the actual scrollable element (the page itself
  // doesn't scroll), so we save its scrollTop to sessionStorage on every scroll
  // and restore once the leads have rendered on mount.
  const listScrollRef = useRef(null)
  const SCROLL_KEY = 'leads:list:scrollTop'
  const handleListScroll = () => {
    const el = listScrollRef.current
    if (!el) return
    try { sessionStorage.setItem(SCROLL_KEY, String(el.scrollTop)) } catch {}
  }
  useEffect(() => {
    if (view !== 'list') return
    let raw = 0
    try { raw = parseInt(sessionStorage.getItem(SCROLL_KEY) || '0', 10) || 0 } catch {}
    if (!raw) return
    // Wait one frame so the list has a chance to render its rows, otherwise the
    // container doesn't have enough scroll height yet and scrollTop snaps to 0.
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => {
        if (listScrollRef.current) listScrollRef.current.scrollTop = raw
      })
      return () => cancelAnimationFrame(r2)
    })
    return () => cancelAnimationFrame(r1)
  }, [view])

  // Delete-all double-confirm modal state
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const [deleteAllInput, setDeleteAllInput] = useState('')
  const [deletingAll, setDeletingAll] = useState(false)
  const [filtersExpanded, setFiltersExpanded] = useState(false)

  const safeTags = Array.isArray(tags) ? tags : []
  const safeLeads = Array.isArray(leads) ? leads : []

  // Sort leads by user-selected key
  const sortedLeads = [...safeLeads].sort((a, b) => {
    const ts = (l, k) => new Date(l[k] || 0).getTime() || 0
    const nameOf = (l) => (leadName(l) || '').toLowerCase()
    switch (sortBy) {
      case 'activity_desc': return ts(b, 'last_activity') - ts(a, 'last_activity')
      case 'activity_asc':  return ts(a, 'last_activity') - ts(b, 'last_activity')
      case 'created_asc':   return ts(a, 'created_at') - ts(b, 'created_at')
      case 'name_asc':      return nameOf(a).localeCompare(nameOf(b))
      case 'price_desc':    return (Number(b.price) || 0) - (Number(a.price) || 0)
      case 'campaign_asc':  return String(a.campaign || a.source || '').toLowerCase().localeCompare(String(b.campaign || b.source || '').toLowerCase())
      case 'created_desc':
      default:              return ts(b, 'created_at') - ts(a, 'created_at')
    }
  })

  const filtered = sortedLeads.filter(l => {
    const q = search.toLowerCase().trim()
    // Search across name, phone, email, location AND side tags + comments
    const tagsStr = Array.isArray(l.tags) ? l.tags.join(' ') : ''
    const haystack = `${leadName(l)} ${l.phone || ''} ${l.email || ''} ${l.state || ''} ${l.zip || ''} ${l.city || ''} ${l.comments || ''} ${tagsStr}`.toLowerCase()
    const matchSearch = !q || haystack.includes(q)
    const matchStage = !stageFilter || leadStageId(l, safeTags) === stageFilter
    // Side-tag filter: lead must have EVERY selected tag (AND match)
    const matchTags = tagFilters.size === 0 ||
      (Array.isArray(l.tags) && Array.from(tagFilters).every(t => l.tags.includes(t)))
    // TZ filter: lead's TZ must be one of the selected zones
    const matchTz = tzFilters.size === 0 || tzFilters.has(tzShortFor(l))
    // Campaign filter (or empty-campaign bucket)
    const matchCampaign = campaignFilters.size === 0 ||
      campaignFilters.has(l.campaign || l.source || '(none)')
    return matchSearch && matchStage && matchTags && matchTz && matchCampaign
  })

  // Save the current filtered/sorted ID list to sessionStorage so LeadDetail
  // can show ← → arrows that walk through THIS exact list in THIS exact order.
  // Updated whenever filters or sort change.
  useEffect(() => {
    try {
      sessionStorage.setItem('leads:visibleIds', JSON.stringify(filtered.map(l => l.id)))
    } catch {}
  }, [filtered])

  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelected(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)))

  const handleExport = () => {
    const toExport = selected.size > 0 ? safeLeads.filter(l => selected.has(l.id)) : filtered
    exportCSV(toExport)
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const text = await file.text()
      const { headers, rows } = parseCSV(text)
      if (!rows.length) { setImportResult({ error: 'No data rows found in CSV.' }); return }
      const mapped = rows.map(r => mapRow(r, safeTags))
      const unmapped = headers.filter(h => {
        const key = String(h).toLowerCase().trim()
        return !RINGY_MAP[key] && String(h).trim()
      })
      setUnmappedCols(unmapped)
      const withPhone = mapped.filter(r => r.phone).length

      // Pre-scan for stage candidates that aren't already a known stage —
      // those will be auto-created as custom stages on confirmImport so
      // every Ringy disposition lands in a real pipeline column.
      const knownLabels = new Set([
        ...safeTags.map(t => (t.label || '').toLowerCase()),
        ...Object.keys(STATUS_MAP),
        ...STATUSES.map(s => s.toLowerCase()),
      ])
      const newStages = new Map()
      for (const r of rows) {
        const c = pickStageCandidate(r)
        if (c && !knownLabels.has(c.toLowerCase()) && !newStages.has(c.toLowerCase())) {
          newStages.set(c.toLowerCase(), c.trim())
        }
      }

      setImportPreview({
        rows: mapped, rawRows: rows,
        total: mapped.length, withPhone,
        filename: file.name, sample: mapped.slice(0, 3),
        stagesToCreate: Array.from(newStages.values()),
      })
      setImportResult(null)
    } catch (err) {
      setImportResult({ error: 'Could not read file: ' + err.message })
    }
  }

  const confirmImport = async () => {
    if (!importPreview || !user?.id) return
    setImporting(true)
    setImportResult(null)
    const now = new Date().toISOString()

    // 1. Auto-create any unknown stages so every Ringy disposition becomes a
    //    real pipeline column on this account. Defaults stay shared, customs
    //    stay private — these new stages get user_id = current user.
    let enrichedTags = safeTags
    let createdStages = 0
    const palette = ['#A78BFA','#F59E0B','#EC4899','#22D3EE','#84CC16','#FB7185','#F97316','#06B6D4']
    if (Array.isArray(importPreview.stagesToCreate) && importPreview.stagesToCreate.length > 0) {
      const stamp = Date.now()
      const newStageRows = importPreview.stagesToCreate.map((label, i) => {
        const color = palette[i % palette.length]
        return {
          id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + stamp + '-' + i,
          label,
          color,
          bg: color + '18',
          sort_order: safeTags.length + i,
          user_id: user.id,
        }
      })
      try {
        const { data: inserted, error } = await supabase.from('tags').insert(newStageRows).select()
        if (!error && inserted) {
          enrichedTags = [...safeTags, ...inserted]
          createdStages = inserted.length
        }
      } catch (e) { console.error('auto-create stages failed:', e) }
    }

    // 2. Re-map raw rows against the enriched stage list so first-tag landings
    //    point at real stage IDs (whether shared default, existing custom, or
    //    just-created custom).
    const remapped = (importPreview.rawRows || []).map(r => mapRow(r, enrichedTags))

    // 3. Client-side dedupe by phone against existing leads
    const existingPhones = new Set(safeLeads.map(l => String(l.phone || '').replace(/\D/g, '')).filter(Boolean))
    const seen = new Set()
    let dupes = 0
    const toInsert = []
    for (const r of remapped) {
      const digits = String(r.phone || '').replace(/\D/g, '')
      if (digits && (existingPhones.has(digits) || seen.has(digits))) { dupes++; continue }
      if (digits) seen.add(digits)
      toInsert.push({
        ...r,
        user_id: user.id,
        // Only set a generic 'CSV Import' fallback if the row truly had no
        // source — PitchPerfect/Ringy/whatever already populates `source` when
        // it's in the export, and we preserve that verbatim.
        source: r.source || 'CSV Import',
        // Use the row's parsed received-on date if mapRow extracted one
        // ("Received On" / "Date Added" / etc.), otherwise stamp now.
        created_at: r.created_at || now,
        last_activity: r.last_activity || r.created_at || now,
      })
    }

    let imported = 0
    const failures = []
    const CHUNK = 50
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const batch = toInsert.slice(i, i + CHUNK)
      try {
        const { error } = await supabase.from('leads').insert(batch)
        if (error) {
          // Fall back to per-row insert so we know which ones fail and why
          for (const row of batch) {
            try {
              const { error: e2 } = await supabase.from('leads').insert([row])
              if (e2) failures.push({ row, msg: e2.message }); else imported++
            } catch (e3) { failures.push({ row, msg: e3.message }) }
          }
        } else imported += batch.length
      } catch (e) {
        for (const row of batch) {
          try {
            const { error: e2 } = await supabase.from('leads').insert([row])
            if (e2) failures.push({ row, msg: e2.message }); else imported++
          } catch (e3) { failures.push({ row, msg: e3.message }) }
        }
      }
    }

    if (failures.length > 0) {
      console.error('[Import] First 5 failures:', failures.slice(0, 5))
    }
    const failMsg = failures.length > 0 ? ` · ${failures.length} failed (${(failures[0]?.msg || '').slice(0, 80)}…)` : ''
    const stagesMsg = createdStages > 0 ? ` · created ${createdStages} new stage${createdStages === 1 ? '' : 's'}` : ''
    setImportResult({
      ok: true,
      imported,
      errors: failures.length,
      total: remapped.length,
      msg: `Imported ${imported}${dupes > 0 ? ` · ${dupes} duplicate${dupes === 1 ? '' : 's'} skipped` : ''}${stagesMsg}${failMsg}`,
    })
    setImportPreview(null)
    setImporting(false)
    try { await refreshLeads() } catch {}
    setTimeout(() => setImportResult(null), 10000)
  }

  const handleDrop = (stageId) => {
    if (dragLeadId && typeof updateLeadStage === 'function') {
      updateLeadStage(dragLeadId, stageId)
      setDragLeadId(null)
    }
  }

  const handleNoteChange = async (id, notes) => {
    if (typeof updateLead === 'function') await updateLead(id, { notes })
  }

  const handleNoteBChange = async (id, notes_b) => {
    if (typeof updateLead === 'function') await updateLead(id, { notes_b })
  }

  const handlePriceChange = async (id, price) => {
    if (typeof updateLead === 'function') await updateLead(id, { price })
  }

  const handleCampaignChange = async (id, campaign) => {
    if (typeof updateLead === 'function') await updateLead(id, { campaign })
  }

  const handleRunnerChange = async (id, runner) => {
    if (typeof updateLead === 'function') await updateLead(id, { runner })
  }

  const handleTagsChange = async (id, nextTags) => {
    if (typeof updateLead !== 'function') return
    // Preserve any 'starred' state on the lead (driven by the Star button, not the chip UI)
    const lead = safeLeads.find(l => l.id === id)
    const wasStarred = Array.isArray(lead?.tags) && lead.tags.includes('starred')
    const merged = Array.from(new Set([...(nextTags || []), ...(wasStarred ? ['starred'] : [])]))
    await updateLead(id, { tags: merged })
  }

  // Distinct runner names already used across the user's leads — autocomplete fodder
  const runnerSuggestions = Array.from(new Set(
    safeLeads.map(l => (l.runner || '').trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b))

  // Distinct secondary tags already used (minus 'starred', which is internal)
  // Union of: every distinct tag used on a lead + every library entry from
  // Settings → Side Tags. So tags pre-created in Settings show up in the
  // picker before they're applied to any lead.
  const libraryTagKeys = Object.keys(sideTagStyles || {}).filter(k => !sideTagStyles[k]?.hidden)
  const tagSuggestions = Array.from(new Set([
    ...safeLeads.flatMap(l => Array.isArray(l.tags) ? l.tags : []).filter(t => t && t !== 'starred'),
    ...libraryTagKeys,
  ])).sort((a, b) => a.localeCompare(b))

  const handleDeleteOne = async (id) => {
    if (typeof deleteLead !== 'function') return
    const ok = await deleteLead(id)
    if (ok) setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  const handleBulkDelete = async () => {
    if (selected.size === 0 || typeof deleteLeads !== 'function') return
    const count = selected.size
    if (!confirm(`Delete ${count} selected lead${count === 1 ? '' : 's'}? This cannot be undone.`)) return
    const ids = Array.from(selected)
    const n = await deleteLeads(ids)
    setSelected(new Set())
    setImportResult({ ok: true, imported: 0, errors: 0, total: 0, msg: `Deleted ${n} lead${n === 1 ? '' : 's'}` })
    setTimeout(() => setImportResult(null), 4000)
  }

  const handleDeleteAll = async () => {
    if (typeof deleteAllLeadsForUser !== 'function') return
    setDeletingAll(true)
    const n = await deleteAllLeadsForUser()
    setDeletingAll(false)
    setShowDeleteAll(false)
    setDeleteAllInput('')
    setSelected(new Set())
    setImportResult({ ok: true, imported: 0, errors: 0, total: 0, msg: `Wiped ${n} lead${n === 1 ? '' : 's'} — ready for fresh import` })
    setTimeout(() => setImportResult(null), 6000)
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130] flex-shrink-0">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Leads</h1>
          <p className="text-xs text-[#5A6A7A] mt-0.5">{filtered.length} of {safeLeads.length} leads{selected.size > 0 ? ` · ${selected.size} selected` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleAll}
            className="p-2 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] transition-colors" title="Select all">
            {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare size={16} className="text-[#00E5C3]" /> : <Square size={16} />}
          </button>
          {selected.size > 0 && can?.deleteLeads && (
            <button onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#EF444440] text-[#EF4444] hover:bg-[#EF444415] transition-colors">
              <Trash2 size={13} /> Delete {selected.size}
            </button>
          )}
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547] transition-colors">
            <Download size={13} /> {selected.size > 0 ? `Export ${selected.size}` : 'Export'}
          </button>
          {!isRunner && (
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547] transition-colors">
              <Upload size={13} /> Import CSV
            </button>
          )}
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileSelect} className="hidden" />
          {safeLeads.length > 0 && can?.deleteLeads && (
            <button onClick={() => setShowDeleteAll(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#EF444440] text-[#EF4444] hover:bg-[#EF444415] transition-colors"
              title="Wipe all leads (for fresh re-import)">
              <Trash2 size={13} /> Delete All
            </button>
          )}

          {/* Refresh — pulls latest leads without reloading the page */}
          <RefreshButton />
          <div className="flex rounded-lg border border-[#1A2130] overflow-hidden" style={{ background: '#0A0E14' }}>
            <button onClick={() => setView('list')} className={clsx('px-3 py-1.5 transition-colors', view === 'list' ? 'bg-[#1A2130] text-white' : 'text-[#5A6A7A] hover:text-white')}>
              <LayoutList size={15} />
            </button>
            <button onClick={() => setView('kanban')} className={clsx('px-3 py-1.5 transition-colors', view === 'kanban' ? 'bg-[#1A2130] text-white' : 'text-[#5A6A7A] hover:text-white')}>
              <Columns size={15} />
            </button>
          </div>
          {!isRunner && (
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-black transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <Plus size={15} /> Add Lead
            </button>
          )}
        </div>
      </div>

      {/* Import status banner */}
      {importResult && (
        <div className={`mx-6 mt-3 px-4 py-3 rounded-lg flex items-start gap-2 text-sm ${
          importResult.error
            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
        }`}>
          {importResult.error
            ? <><AlertCircle size={16} className="mt-0.5 flex-shrink-0" />{importResult.error}</>
            : <><CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{importResult.msg || `Imported ${importResult.imported} leads${importResult.errors > 0 ? ` · ${importResult.errors} failed` : ''}`}</span>
              </>}
          <button onClick={() => setImportResult(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Import preview */}
      {importPreview && (
        <div className="mx-6 mt-3 rounded-xl border border-[#00D4FF]/30 p-4" style={{ background: '#00D4FF08' }}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-white">
                Ready to import <strong>{importPreview.total}</strong> leads from <span className="text-[#00D4FF]">{importPreview.filename}</span>
              </p>
              <p className="text-xs text-[#8899AA] mt-0.5">
                {importPreview.withPhone} have phone numbers · {importPreview.total - importPreview.withPhone} without phone
              </p>
              {unmappedCols.length > 0 && (
                <p className="text-xs text-yellow-500/80 mt-1">Skipped columns: {unmappedCols.join(', ')}</p>
              )}
              {Array.isArray(importPreview.stagesToCreate) && importPreview.stagesToCreate.length > 0 && (
                <p className="text-xs text-[#A78BFA] mt-1">
                  Will create new pipeline stage{importPreview.stagesToCreate.length === 1 ? '' : 's'}: {importPreview.stagesToCreate.map(s => `"${s}"`).join(', ')}
                </p>
              )}
            </div>
            <button onClick={() => setImportPreview(null)} className="text-[#8899AA] hover:text-white"><X size={14} /></button>
          </div>
          <div className="space-y-1 mb-3 bg-[#0A0E14] rounded-lg p-3">
            <p className="text-xs text-[#556677] mb-2">Preview (first 3 rows):</p>
            {importPreview.sample.map((r, i) => (
              <div key={i} className="text-xs text-[#8899AA] font-mono">
                {r.name || '(no name)'} · {displayPhone(r.phone) || '(no phone)'} · {r.status}
                {r.city && ` · ${r.city}, ${r.state || ''}`}
              </div>
            ))}
            {importPreview.total > 3 && <div className="text-xs text-[#445566]">…and {importPreview.total - 3} more</div>}
          </div>
          <div className="flex gap-2">
            <button onClick={confirmImport} disabled={importing}
              className="px-4 py-2 rounded-lg text-sm font-medium text-black"
              style={{ background: importing ? '#446677' : 'linear-gradient(135deg, #00D4FF, #0099CC)' }}>
              {importing ? 'Importing…' : `Import ${importPreview.total} Leads`}
            </button>
            <button onClick={() => setImportPreview(null)}
              className="px-4 py-2 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters — compact top row + collapsible secondary filter strip */}
      <div className="flex-shrink-0 border-b border-[#1A2130]" style={{ background: '#080B0F' }}>
        <div className="flex items-center gap-2 px-6 py-2">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A6A7A]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, phone, email, zip…"
              className="w-full bg-[#0E1318] border border-[#1A2130] rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#5A6A7A] hover:text-white"><X size={12} /></button>}
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="bg-[#0E1318] border border-[#1A2130] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#00E5C340]">
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
            <option value="activity_desc">Recent activity</option>
            <option value="activity_asc">Stale (no recent activity)</option>
            <option value="name_asc">Name A→Z</option>
            <option value="price_desc">Highest cost first</option>
            <option value="campaign_asc">Campaign A→Z</option>
          </select>
          {(() => {
            const activeCount = (stageFilter ? 1 : 0) + tagFilters.size + tzFilters.size + campaignFilters.size
            return (
              <button onClick={() => setFiltersExpanded(v => !v)}
                className="px-2.5 py-1.5 rounded-lg text-xs border transition-colors"
                style={activeCount > 0
                  ? { background: '#A78BFA15', color: '#A78BFA', borderColor: '#A78BFA60' }
                  : { color: '#8899AA', borderColor: '#1A2130' }}>
                Filters{activeCount > 0 ? ` (${activeCount})` : ''} <ChevronDown size={11} className={clsx('inline ml-0.5 transition-transform', filtersExpanded && 'rotate-180')} />
              </button>
            )
          })()}
          {(stageFilter || tagFilters.size || tzFilters.size || campaignFilters.size) && (
            <button onClick={() => { setStageFilter(''); setTagFilters(new Set()); setTzFilters(new Set()); setCampaignFilters(new Set()) }}
              className="text-[10px] text-[#5A6A7A] hover:text-white">
              clear
            </button>
          )}
        </div>
        {filtersExpanded && (
          <div className="border-t border-[#1A2130] py-1">
            <DragScrollPills stageFilter={stageFilter} setStageFilter={setStageFilter} tags={safeTags} leads={safeLeads} />
            <TagFilterPills tagFilters={tagFilters} setTagFilters={setTagFilters} leads={safeLeads} />
            <CampaignFilterPills campaignFilters={campaignFilters} setCampaignFilters={setCampaignFilters} leads={safeLeads} />
            <TzFilterPills tzFilters={tzFilters} setTzFilters={setTzFilters} leads={safeLeads} />
          </div>
        )}
      </div>

      {/* Content */}
      {view === 'list' ? (
        <div ref={listScrollRef} onScroll={handleListScroll}
          className="flex-1 overflow-y-auto p-5 space-y-3">
          {filtered.map(lead => (
            <LeadCard key={lead.id} lead={lead}
              selected={selected.has(lead.id)}
              onSelect={toggleSelect}
              onStageChange={(id, s) => typeof updateLeadStage === 'function' && updateLeadStage(id, s)}
              onNoteChange={handleNoteChange}
              onNoteBChange={handleNoteBChange}
              onPriceChange={handlePriceChange}
              onCampaignChange={handleCampaignChange}
              onRunnerChange={handleRunnerChange}
              runnerSuggestions={runnerSuggestions}
              onTagsChange={handleTagsChange}
              tagSuggestions={tagSuggestions}
              onNavigate={id => navigate(`/leads/${id}`)}
              onDelete={handleDeleteOne}
              canDelete={can?.deleteLeads !== false && !isRunner} />
          ))}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-[#3A4A5A]">
              <Users size={32} className="mb-3 opacity-30" />
              <p className="text-sm">{safeLeads.length === 0 ? 'No leads yet' : 'No leads match your filters'}</p>
              <button onClick={() => fileRef.current?.click()} className="mt-3 text-xs text-[#00E5C3] hover:underline">Import CSV</button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-6">
          <div className="flex gap-4" style={{ minWidth: 'max-content' }}>
            {safeTags.map(tag => (
              <KanbanCol key={tag.id} tag={tag}
                leads={filtered.filter(l => leadStageId(l, safeTags) === tag.id)}
                onLeadClick={id => navigate(`/leads/${id}`)}
                onDrop={handleDrop} />
            ))}
          </div>
        </div>
      )}

      {showAdd && <AddLeadModal onClose={() => setShowAdd(false)} />}

      {/* Delete-all confirmation modal */}
      {showDeleteAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !deletingAll && setShowDeleteAll(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[#EF444440] overflow-hidden" style={{ background: '#0E1318' }}>
            <div className="flex items-center gap-3 px-6 py-4 border-b border-[#1A2130]">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#EF444415' }}>
                <AlertTriangle size={18} className="text-[#EF4444]" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Delete ALL leads?</h2>
                <p className="text-xs text-[#8899AA]">{safeLeads.length} leads will be permanently deleted from your account.</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-[#C0D0E0]">This is irreversible. Leads from the email pipeline and CSV imports will all be wiped — recommended only when re-importing a fresh CSV.</p>
              <div>
                <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">
                  Type <span className="text-[#EF4444]">DELETE</span> to confirm
                </label>
                <input
                  value={deleteAllInput}
                  onChange={e => setDeleteAllInput(e.target.value)}
                  placeholder="DELETE"
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#EF4444] font-mono"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleDeleteAll}
                  disabled={deleteAllInput !== 'DELETE' || deletingAll}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-40"
                  style={{ background: '#EF4444' }}>
                  {deletingAll ? 'Deleting…' : `Delete all ${safeLeads.length} leads`}
                </button>
                <button
                  onClick={() => { setShowDeleteAll(false); setDeleteAllInput('') }}
                  disabled={deletingAll}
                  className="px-4 py-2.5 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
