import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import StatusTag from './StatusTag'
import { X, Phone, PhoneCall, ChevronDown, ChevronRight, ChevronUp, Maximize2, Check, Calendar, MapPin, Pencil, Plus, MessageSquare, AtSign, StickyNote, Zap } from 'lucide-react'
import { format, formatDistanceToNow, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns'

// Activity-type → lucide icon + accent color. Used by the action log row
// renderer below. Kept in sync with LeadDetail.jsx so both views look the same.
const DRAWER_ACT_ICONS  = { call: PhoneCall, text: MessageSquare, email: AtSign, note: StickyNote, status: Zap, apt: Calendar }
const DRAWER_ACT_COLORS = { call: '#10B981', text: '#3B82F6', email: '#8B5CF6', note: '#F59E0B', status: '#00E5C3', apt: '#F97316' }
import clsx from 'clsx'
import { displayPhone } from '../lib/phone'
import { localTimeFor, localHourFor, tzLabelFor } from '../lib/timezone'
import { googleCalendarUrl, createCalendarEvent, isGcalConnected } from '../lib/gcal'

// Slim notes editor — auto-grows to content within [6 lines, 15 lines], grows
// upward only so manual resize sticks across re-renders.
const NOTES_MIN_H = 132
const NOTES_MAX_H = 330
function NotesField({ value, onSave, placeholder }) {
  const ref = useRef(null)
  const [text, setText] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)
  const initialRef = useRef(value || '')

  useEffect(() => { setText(value || ''); initialRef.current = value || '' }, [value])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const currentH = el.offsetHeight
    el.style.height = 'auto'
    const sh = el.scrollHeight
    el.style.height = (currentH || 0) + 'px'
    const autoH = Math.min(NOTES_MAX_H, Math.max(NOTES_MIN_H, sh))
    if (autoH > currentH) el.style.height = autoH + 'px'
  }, [text])

  const handleBlur = async () => {
    if (text === initialRef.current) return
    setSaving(true)
    try { await onSave(text); initialRef.current = text; setSavedTick(true); setTimeout(() => setSavedTick(false), 1800) }
    catch {}
    setSaving(false)
  }

  return (
    <div className="rounded-xl border border-[#F59E0B30] overflow-hidden" style={{ background: '#F59E0B08' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#F59E0B20]">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#F59E0B]">Notes</span>
        <div className="text-[10px] font-mono" style={{ color: savedTick ? '#00E5C3' : '#5A6A7A' }}>
          {saving ? 'saving…' : savedTick ? '✓ saved' : 'auto-save on blur'}
        </div>
      </div>
      <textarea ref={ref}
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder || 'Click to take notes…'}
        className="w-full bg-transparent px-3 py-2 text-sm text-[#E5D9A8] placeholder-[#5A6A7A] focus:outline-none"
        style={{ minHeight: NOTES_MIN_H + 'px', resize: 'vertical', overflowY: 'auto' }} />
    </div>
  )
}

export default function LeadDrawer({ leadId, onClose, bucket = [], onNavigate }) {
  const { leads, tags, updateLead, updateLeadStage, addActivity, getLeadActivities, deleteActivity, addReminder, splitNotes, sideTagStyles, recentActivitiesByLead } = useApp()
  const navigate = useNavigate()
  const [stageOpen, setStageOpen] = useState(false)
  const [showEmpty, setShowEmpty] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [activities, setActivities] = useState([])
  const [actionText, setActionText] = useState('')
  const [actionKind, setActionKind] = useState('note')
  // Per-lead call throttle. Keyed by leadId so navigating between leads in
  // the drawer (arrow-down etc.) doesn't accidentally suppress a call on the
  // new lead. Without this fix, agents calling 4 different leads in 15 min
  // would only get the FIRST call logged.
  const lastCallByLeadRef = useRef({})

  // Activity history. Two-step load to keep the UI smooth:
  //   1) IMMEDIATE seed from recentActivitiesByLead (already in memory from
  //      the Leads list mount). No empty-flash, no fetch wait. If empty, we
  //      still show empty state but at least it's accurate.
  //   2) Background fetch via getLeadActivities to top-up with the FULL history
  //      and pick up anything teammates have logged since last refresh. Only
  //      replaces the seed if the fresh fetch returns MORE entries — never
  //      downgrades the visible count.
  useEffect(() => {
    if (!leadId) return
    // Step 1 — instant seed from the in-memory recent-activity map
    const seeded = (recentActivitiesByLead && recentActivitiesByLead[leadId]) || []
    setActivities(seeded)
    if (typeof getLeadActivities !== 'function') return
    let cancelled = false
    // Step 2 — background fresh fetch
    try {
      const result = getLeadActivities(leadId, { force: true })
      if (result && typeof result.then === 'function') {
        result.then(acts => {
          if (cancelled) return
          const fresh = Array.isArray(acts) ? acts : []
          // Only overwrite if the fresh fetch returned ≥ what we seeded.
          // Prevents an empty fetch (RLS reject / cancelled net / etc.) from
          // wiping out a perfectly good in-memory list.
          if (fresh.length >= seeded.length) setActivities(fresh)
        }).catch(() => { /* keep seeded list */ })
      }
    } catch {}
    return () => { cancelled = true }
  }, [leadId, recentActivitiesByLead, getLeadActivities])

  const logAction = async (kind, text) => {
    if (!text || !text.trim()) return
    if (typeof addActivity !== 'function') return
    try {
      const entry = await addActivity(leadId, kind, text.trim())
      if (entry) setActivities(prev => [entry, ...prev])
    } catch {}
  }

  // Bucket navigation — pipeline passes the current column's lead IDs in
  // order. Arrow Up/Down hops to prev/next without closing the drawer.
  const bucketIdx = Array.isArray(bucket) ? bucket.indexOf(leadId) : -1
  const goPrev = () => { if (bucketIdx > 0 && onNavigate) onNavigate(bucket[bucketIdx - 1]) }
  const goNext = () => { if (bucketIdx >= 0 && bucketIdx < bucket.length - 1 && onNavigate) onNavigate(bucket[bucketIdx + 1]) }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      // Don't hijack arrows while the user is typing in an input/textarea
      const t = document.activeElement
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (inField) return
      if (e.key === 'ArrowDown') { e.preventDefault(); goNext() }
      if (e.key === 'ArrowUp')   { e.preventDefault(); goPrev() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, bucket, onClose])

  const lead = (leads || []).find(l => l.id === leadId)
  if (!lead) return null

  const safeTags = Array.isArray(tags) && tags.length > 0 ? tags : [{ id: 'not-started', label: 'Not Started', color: '#8899AA', bg: '#1A2130' }]
  const tag = safeTags.find(t => t.id === lead.stage) || safeTags[0]
  const fName = lead.first_name || (lead.name ? lead.name.split(' ')[0] : '')
  const lName = lead.last_name || (lead.name ? lead.name.split(' ').slice(1).join(' ') : '')
  const initials = ((fName.trim()[0] || '?') + (lName.trim()[0] || '')).toUpperCase()
  const fullName = [fName, lName].filter(Boolean).join(' ').trim() || lead.phone || 'Lead'
  const tzTime = localTimeFor(lead)
  const tzHour = localHourFor(lead)
  const tzLabel = tzLabelFor(lead)
  const tzOff = tzHour != null && (tzHour < 8 || tzHour >= 21)

  const logCall = async () => {
    const now = Date.now()
    const lastForThisLead = lastCallByLeadRef.current[leadId] || 0
    // 2-min coalesce per lead: prevents accidental double-taps but lets the
    // agent log every legitimate dial. 15 min was way too aggressive.
    if (now - lastForThisLead < 2 * 60 * 1000) {
      console.info('[ActionLog] Call to', leadId, 'coalesced — last call', Math.round((now - lastForThisLead)/1000), 'sec ago')
      return
    }
    lastCallByLeadRef.current[leadId] = now
    if (typeof addActivity !== 'function') return
    try {
      const entry = await addActivity(leadId, 'call', `Called ${displayPhone(lead.phone) || lead.phone || ''}`.trim())
      if (entry) setActivities(prev => [entry, ...prev])
    } catch (e) {
      console.error('[ActionLog] Failed to log call for', leadId, e)
    }
  }

  return (
    <>
      {/* Backdrop — clicking dims and closes; keeps the pipeline visible behind */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />

      {/* Right-side drawer */}
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[460px] flex flex-col shadow-2xl"
        style={{ background: '#0E1318', borderLeft: '1px solid #1A2130' }}>

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#1A2130] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ background: tag.color + '25', color: tag.color }}>
              {initials}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-display font-bold text-white truncate">{fullName}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusTag stage={lead.stage} status={lead.status} size="sm" />
                {tzTime && (
                  <span className="text-xs font-mono" style={{ color: tzOff ? '#F59E0B' : '#5A6A7A' }}
                    title={tzOff ? 'Outside 8a–9p local' : 'Local time'}>
                    · {tzTime}{tzLabel ? ` ${tzLabel}` : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Prev/Next within the bucket */}
            {bucket.length > 1 && (
              <>
                <button onClick={goPrev} disabled={bucketIdx <= 0}
                  className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] disabled:opacity-30"
                  title="Previous lead in bucket (↑)">
                  <ChevronUp size={14} />
                </button>
                <span className="text-[10px] font-mono text-[#5A6A7A] select-none px-1" title="Position in this bucket">
                  {bucketIdx + 1}/{bucket.length}
                </span>
                <button onClick={goNext} disabled={bucketIdx < 0 || bucketIdx >= bucket.length - 1}
                  className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] disabled:opacity-30"
                  title="Next lead in bucket (↓)">
                  <ChevronDown size={14} />
                </button>
              </>
            )}
            {/* Open full page (same tab) */}
            <button onClick={() => { navigate(`/leads/${leadId}`); onClose() }}
              className="p-2 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130]"
              title="Open the full lead page (same tab)">
              <Maximize2 size={14} />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130]" title="Close (esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Action bar — Call + Move stage */}
        <div className="px-4 py-3 border-b border-[#1A2130] flex items-center gap-2 flex-shrink-0">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} onClick={logCall}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-[8px] text-sm font-semibold text-black"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <PhoneCall size={14} /> Call {displayPhone(lead.phone)}
            </a>
          )}
          <div className="relative">
            <button onClick={() => setStageOpen(v => !v)}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[#1A2130] text-sm text-[#8899AA] hover:text-white hover:border-[#2A3547]">
              Move <ChevronDown size={12} className={clsx('transition-transform', stageOpen && 'rotate-180')} />
            </button>
            {stageOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-[#1A2130] overflow-hidden z-20 shadow-xl max-h-80 overflow-y-auto" style={{ background: '#0E1318' }}>
                {safeTags.map(t => (
                  <button key={t.id} onClick={() => { if (typeof updateLeadStage === 'function') updateLeadStage(leadId, t.id); setStageOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-[#1A2130]"
                    style={{ color: t.color }}>
                    <div className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                    {t.label}
                    {lead.stage === t.id && <Check size={11} className="ml-auto" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setReminderOpen(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1A2130] text-sm text-[#8899AA] hover:text-white hover:border-[#2A3547]"
            title="Schedule a reminder">
            <Calendar size={13} /> Remind
          </button>
        </div>

        {/* Inline reminder form (toggleable) */}
        {reminderOpen && (
          <ReminderInlineForm leadId={leadId}
            lead={lead}
            onSubmit={async (data) => { await addReminder({ ...data, lead_id: leadId }); setReminderOpen(false) }}
            onClose={() => setReminderOpen(false)} />
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Notes (top — main surface for working a lead). Stacked vertically
              when splitNotes is enabled so the drawer stays readable at
              typical widths — was side-by-side which cramped both fields. */}
          {splitNotes ? (
            <div className="space-y-2">
              <NotesField value={lead.notes} onSave={(v) => updateLead(leadId, { notes: v })} />
              <NotesField value={lead.notes_b} onSave={(v) => updateLead(leadId, { notes_b: v })} placeholder="Notes (B)…" />
            </div>
          ) : (
            <NotesField value={lead.notes} onSave={(v) => updateLead(leadId, { notes: v })} />
          )}

          {/* Vendor comments if any */}
          {lead.comments && (
            <div className="p-3 rounded-lg border border-[#F59E0B20]" style={{ background: '#F59E0B08' }}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#F59E0B] mb-1">Marketplace comments</p>
              <p className="text-xs text-[#C0D0E0] whitespace-pre-wrap">{lead.comments}</p>
            </div>
          )}

          {/* Sold product if applicable */}
          {lead.plan_choice && lead.stage === 'sold' && (
            <div className="p-3 rounded-lg border border-[#00E5C330]" style={{ background: '#00E5C308' }}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#00E5C3] mb-1">Sold · product</p>
              <p className="text-xs text-[#C0D0E0] whitespace-pre-wrap">{lead.plan_choice}</p>
            </div>
          )}

          {/* Side tags */}
          <SideTagsEditor
            tags={lead.tags}
            styles={sideTagStyles}
            onChange={(next) => updateLead(leadId, { tags: next })} />

          {/* Discreet action log — auto Call timestamps + add-your-own */}
          <ActionLog activities={activities}
            actionText={actionText} setActionText={setActionText}
            actionKind={actionKind} setActionKind={setActionKind}
            onLog={logAction}
            onDelete={async (aid) => {
              setActivities(prev => prev.filter(a => a.id !== aid))
              try { await deleteActivity(aid, leadId) } catch {}
            }} />

          {/* ALL info — every standard field + custom_fields, inline editable */}
          <AllInfoPanel lead={lead} leadId={leadId} updateLead={updateLead}
            showEmpty={showEmpty} setShowEmpty={setShowEmpty} />
        </div>
      </aside>
    </>
  )
}

// Action log — matches the design used on LeadDetail's ActionLogPanel:
// round icon badge + tinted background, note text, day/time label below,
// hover reveals a delete X. Quick-add row at top with kind buttons + input.
// Always visible; smooth list (no flash) because the parent seeds activities
// from recentActivitiesByLead so empty state never appears mid-fetch when
// there's actually data.
function ActionLog({ activities, actionText, setActionText, actionKind, setActionKind, onLog, onDelete }) {
  const list = (Array.isArray(activities) ? activities : []).slice(0, 40)
  const KINDS = [
    ['call',  'Called',  '#10B981'],
    ['text',  'Texted',  '#3B82F6'],
    ['email', 'Emailed', '#8B5CF6'],
    ['note',  'Note',    '#F59E0B'],
  ]
  return (
    <div className="rounded-xl border border-[#1A2130] overflow-hidden flex flex-col" style={{ background: '#0E1318' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1A2130]">
        <div className="flex items-center gap-2">
          <PhoneCall size={13} className="text-[#10B981]" />
          <span className="text-xs font-mono uppercase tracking-wider text-[#8899AA]">Action log</span>
          <span className="text-[10px] text-[#3A4A5A] font-mono">· {list.length}</span>
        </div>
      </div>
      <div className="px-4 py-3 border-b border-[#1A2130]">
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {KINDS.map(([k, l, c]) => (
            <button key={k} type="button" onClick={() => setActionKind(k)}
              className="text-[10px] px-2 py-0.5 rounded border transition-colors"
              style={actionKind === k
                ? { background: c + '15', color: c, borderColor: c + '60' }
                : { color: '#5A6A7A', borderColor: '#1A2130' }}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={actionText} onChange={e => setActionText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onLog(actionKind, actionText); setActionText('') } }}
            placeholder="What happened? (e.g., didn't answer, left vm)"
            className="flex-1 bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
          <button onClick={() => { onLog(actionKind, actionText); setActionText('') }}
            disabled={!actionText.trim()}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-black disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            Add
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5" style={{ maxHeight: '260px', minHeight: '120px' }}>
        {list.length === 0 ? (
          <p className="text-xs text-[#3A4A5A] text-center py-6 px-4">
            Every call you make is auto-logged here with the exact time of day, so you can see when they don't pick up.
          </p>
        ) : list.map((a, i) => {
          const Icon = DRAWER_ACT_ICONS[a.type] || StickyNote
          const color = DRAWER_ACT_COLORS[a.type] || '#5A6A7A'
          const when = (() => { try { return new Date(a.created_at) } catch { return new Date() } })()
          const valid = isFinite(when.getTime())
          const dayLabel = !valid ? '' : isToday(when) ? 'Today' : isYesterday(when) ? 'Yesterday' : format(when, 'EEE MMM d')
          const timeLabel = !valid ? '' : format(when, 'h:mm a')
          const isTmp = a.id && String(a.id).startsWith('tmp-')
          return (
            <div key={a.id || i} className="flex items-start gap-2.5 group">
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: color + '20' }}>
                <Icon size={11} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#C0D0E0] leading-snug">{a.note || `(${a.type})`}</p>
                <p className="text-[10px] text-[#3A4A5A] font-mono mt-0.5">
                  {dayLabel}{dayLabel && timeLabel ? ' · ' : ''}{timeLabel}
                </p>
              </div>
              {onDelete && !isTmp && (
                <button
                  onClick={() => {
                    if (!confirm('Delete this action log entry?')) return
                    onDelete(a.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415] transition-opacity flex-shrink-0"
                  title="Delete this entry">
                  <X size={11} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Side tags chip editor — same UX as the lead-card chips but inline in the
// drawer. Pulls colors + order from the user's side_tag_styles library.
function SideTagsEditor({ tags, styles, onChange }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const lib = styles || {}
  const orderOf = (n) => (typeof lib[n]?.order === 'number' ? lib[n].order : 9999)
  const visible = (Array.isArray(tags) ? tags : [])
    .filter(t => t && t !== 'starred' && !lib[t]?.hidden)
    .sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b))
  const add = (raw) => {
    const v = String(raw || '').trim().toLowerCase()
    if (!v) return
    const cur = Array.isArray(tags) ? [...tags] : []
    if (!cur.includes(v)) onChange([...cur, v])
    setText(''); setAdding(false)
  }
  const remove = (t) => onChange((Array.isArray(tags) ? tags : []).filter(x => x !== t))

  const pool = Object.keys(lib)
    .filter(k => !visible.includes(k) && !lib[k]?.hidden)
    .filter(k => !text || k.toLowerCase().includes(text.toLowerCase()))
    .sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b))
  const trimmed = text.trim().toLowerCase()
  const showCreate = trimmed && !pool.some(k => k.toLowerCase() === trimmed) && !visible.includes(trimmed)

  return (
    <div className="rounded-xl border border-[#1A2130] p-3" style={{ background: '#080B0F' }}>
      <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-2">Side tags</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map(t => {
          const c = lib[t]?.color
          const chipStyle = c
            ? { background: c + '15', color: c, border: `1px solid ${c}40` }
            : { background: '#1A2130', color: '#8899AA', border: '1px solid #2A3547' }
          return (
            <span key={t} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={chipStyle}>
              #{t}
              <button onClick={() => remove(t)} className="opacity-60 hover:opacity-100 leading-none"><X size={9} /></button>
            </span>
          )
        })}
        {adding ? (
          <div className="relative">
            <input autoFocus value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); add(text) }
                if (e.key === 'Escape') { setAdding(false); setText('') }
              }}
              onBlur={() => setTimeout(() => setAdding(false), 150)}
              placeholder="search or create…"
              className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-[#0E1318] border border-[#2A3547] outline-none w-32 text-white" />
            {(pool.length > 0 || showCreate) && (
              <div className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden border max-h-40 overflow-y-auto"
                style={{ background: '#0A0E14', borderColor: '#1A2130', minWidth: 140, boxShadow: '0 8px 20px rgba(0,0,0,0.5)' }}>
                {showCreate && (
                  <button onMouseDown={e => { e.preventDefault(); add(trimmed) }}
                    className="block w-full text-left px-2 py-1.5 text-[11px] font-mono text-[#00E5C3] hover:bg-[#1A2130] border-b border-[#1A2130]">
                    + Create <strong>#{trimmed}</strong>
                  </button>
                )}
                {pool.map(s => (
                  <button key={s} onMouseDown={e => { e.preventDefault(); add(s) }}
                    className="block w-full text-left px-2 py-1.5 text-[11px] font-mono hover:bg-[#1A2130]"
                    style={{ color: lib[s]?.color || '#8899AA' }}>
                    #{s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            className="text-[10px] px-1.5 py-0.5 rounded font-mono border border-dashed border-[#2A3547] text-[#5A6A7A] hover:text-white">
            + tag
          </button>
        )}
      </div>
    </div>
  )
}

// Inline reminder form that drops below the drawer's action bar
function ReminderInlineForm({ leadId, lead, onSubmit, onClose }) {
  const [kind, setKind] = useState('call')
  const [due, setDue] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [gcalStatus, setGcalStatus] = useState(null)  // {ok, link, error, fallbackUrl}
  const connected = isGcalConnected()
  const [pushToGcal, setPushToGcal] = useState(connected)  // user can opt out per reminder

  // Build the calendar event payload from current form values
  const buildEvent = () => {
    if (!due) return null
    const leadName = lead ? ([lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.phone || 'Lead') : 'Lead'
    const labels = { call: 'Call', appt: 'Appt with', task: 'Task —' }
    return {
      title: `${labels[kind] || ''} ${leadName}`.trim(),
      startsAt: new Date(due).toISOString(),
      durationMinutes: 15,
      details: note || '',
    }
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    setSaving(true)
    setGcalStatus(null)
    try {
      // Always save the in-app reminder
      await onSubmit({ kind, due_at: due ? new Date(due).toISOString() : null, note: note.trim() || null })
      // If user has GCal connected + wants to push, create the event server-side
      if (pushToGcal && due) {
        const ev = buildEvent()
        if (ev) {
          const result = await createCalendarEvent(ev)
          setGcalStatus(result)
        }
      }
    } finally { setSaving(false) }
  }
  const setBy = (fn) => {
    const d = fn(new Date())
    const pad = n => String(n).padStart(2, '0')
    setDue(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)
  }
  return (
    <div className="px-4 py-3 border-b border-[#1A2130] space-y-2"
      style={{ background: '#A78BFA08' }}>
      <div className="flex gap-1.5">
        {[['call','Call','#10B981'],['appt','Appt','#3B82F6'],['task','Task','#F59E0B']].map(([k, label, color]) => (
          <button type="button" key={k} onClick={() => setKind(k)}
            className="flex-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider border"
            style={kind === k
              ? { background: color + '15', color, borderColor: color + '60' }
              : { color: '#5A6A7A', borderColor: '#1A2130' }}>
            {label}
          </button>
        ))}
      </div>
      <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)}
        className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#A78BFA40]" />
      <div className="flex gap-1 flex-wrap">
        <button type="button" onClick={() => setBy(d => { d.setHours(d.getHours()+1); return d })} className="text-[10px] px-1.5 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">+1h</button>
        <button type="button" onClick={() => setBy(d => { d.setHours(d.getHours()+3); return d })} className="text-[10px] px-1.5 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">+3h</button>
        <button type="button" onClick={() => setBy(d => { d.setDate(d.getDate()+1); d.setHours(9,0,0,0); return d })} className="text-[10px] px-1.5 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">Tmrw 9am</button>
        <button type="button" onClick={() => setBy(d => { d.setDate(d.getDate()+7); return d })} className="text-[10px] px-1.5 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">+1 wk</button>
      </div>
      <input value={note} onChange={e => setNote(e.target.value)}
        placeholder="Note (optional) — what do you need to do?"
        className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 text-xs text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#A78BFA40]" />
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-black disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #A78BFA, #3B82F6)' }}>
          {saving ? 'Saving…' : 'Set reminder'}
        </button>
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-[#5A6A7A] hover:text-white border border-[#1A2130]">
          Cancel
        </button>
      </div>
      {/* Google Calendar — direct create if connected, URL fallback if not */}
      {due && (
        <div className="rounded-lg border border-[#1A2130] p-2" style={{ background: '#080B0F' }}>
          {connected ? (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={pushToGcal} onChange={e => setPushToGcal(e.target.checked)}
                className="accent-[#A78BFA]" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#A78BFA]">
                {pushToGcal ? 'Will create 15-min event on Google Calendar' : 'Skip Google Calendar for this reminder'}
              </span>
            </label>
          ) : (
            <a href={(() => {
              const ev = buildEvent()
              return ev ? googleCalendarUrl(ev) : '#'
            })()} target="_blank" rel="noopener"
              className="block text-center py-1 rounded text-[10px] font-mono uppercase tracking-wider text-[#A78BFA] hover:text-white">
              + open as new Google Calendar event ↗
              <span className="block text-[9px] text-[#3A4A5A] normal-case mt-0.5">(connect calendar in Settings to skip this step)</span>
            </a>
          )}
          {gcalStatus && (
            <p className={`text-[10px] font-mono mt-1 ${gcalStatus.ok ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
              {gcalStatus.ok ? (
                <>✓ on calendar · <a href={gcalStatus.htmlLink} target="_blank" rel="noopener" className="underline">view ↗</a></>
              ) : (
                <>✗ {gcalStatus.error}{gcalStatus.fallbackUrl && (
                  <> · <a href={gcalStatus.fallbackUrl} target="_blank" rel="noopener" className="underline">open fallback ↗</a></>
                )}</>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ContactInput({ label, value, onSave, type = 'text' }) {
  const [val, setVal] = useState(value || '')
  useEffect(() => setVal(value || ''), [value])
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-0.5">{label}</p>
      <input type={type} value={val} onChange={e => setVal(e.target.value)}
        onBlur={() => { if (val !== (value || '')) onSave(val) }}
        className="w-full bg-[#0E1318] border border-[#1A2130] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#00E5C340]" />
    </div>
  )
}

// Every standard lead field shown inline + custom_fields. Defaults to hiding
// empty rows so the drawer stays compact during a call. Toggle to reveal all.
function AllInfoPanel({ lead, leadId, updateLead, showEmpty, setShowEmpty }) {
  const FIELDS = [
    ['first_name', 'First name'],
    ['last_name', 'Last name'],
    ['phone', 'Phone', { type: 'tel', display: (v) => displayPhone(v) }],
    ['email', 'Email', { type: 'email' }],
    ['address', 'Street address'],
    ['city', 'City'],
    ['state', 'State'],
    ['zip', 'ZIP'],
    ['age', 'Age', { type: 'number' }],
    ['dob', 'DOB', { type: 'date' }],
    ['gender', 'Gender'],
    ['income', 'Income'],
    ['household', 'Household', { type: 'number' }],
    ['campaign', 'Campaign'],
    ['carrier', 'Carrier (sold)'],
    ['premium', 'Premium', { type: 'number' }],
    ['effective_date', 'Effective date', { type: 'date' }],
    ['best_contact_time', 'Best contact time'],
    ['agent', 'Agent'],
    ['runner', 'Runner'],
    ['price', 'Lead cost', { type: 'number' }],
  ]

  const filled = FIELDS.filter(([k]) => {
    const v = lead[k]
    return v !== null && v !== undefined && v !== ''
  })
  const empty = FIELDS.filter(([k]) => {
    const v = lead[k]
    return v === null || v === undefined || v === ''
  })
  const customFields = (lead.custom_fields && typeof lead.custom_fields === 'object') ? lead.custom_fields : {}
  const customKeys = Object.keys(customFields)

  const Row = ([key, label, opts]) => {
    const display = opts?.display ? opts.display(lead[key]) : lead[key]
    return (
      <ContactInput key={key} label={label} value={display ?? ''} type={opts?.type || 'text'}
        onSave={(v) => {
          // Phone needs E.164 normalization on save
          if (key === 'phone') {
            const digits = String(v || '').replace(/\D/g, '')
            const next = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits[0] === '1' ? `+${digits}` : v
            updateLead(leadId, { phone: next })
            return
          }
          updateLead(leadId, { [key]: v || null })
        }} />
    )
  }

  return (
    <div className="rounded-xl border border-[#1A2130]" style={{ background: '#080B0F' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1A2130]">
        <span className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A]">
          Details ({filled.length}{customKeys.length ? ` + ${customKeys.length}` : ''})
        </span>
        <button onClick={() => setShowEmpty(v => !v)}
          className="text-[10px] font-mono text-[#5A6A7A] hover:text-white">
          {showEmpty ? 'Hide empty' : `Show empty (${empty.length})`}
        </button>
      </div>

      <div className="p-3 grid grid-cols-2 gap-2">
        {filled.length === 0 && !showEmpty && (
          <p className="col-span-2 text-xs text-[#5A6A7A]">No info yet — click "Show empty" to fill out fields.</p>
        )}
        {filled.map(Row)}
        {showEmpty && empty.map(Row)}
      </div>

      {/* Custom fields */}
      {customKeys.length > 0 && (
        <div className="px-3 pb-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#A78BFA] mb-1.5 pt-2 border-t border-[#1A2130]">
            Custom fields
          </div>
          <div className="grid grid-cols-2 gap-2">
            {customKeys.map(k => (
              <ContactInput key={k} label={k} value={customFields[k] || ''}
                onSave={(v) => {
                  const next = { ...customFields, [k]: v }
                  updateLead(leadId, { custom_fields: next })
                }} />
            ))}
          </div>
        </div>
      )}

      {/* Show created/received timestamp at the bottom (read-only-ish; edit via /leads/:id if needed) */}
      {lead.created_at && (
        <div className="px-3 pb-2 text-[10px] font-mono text-[#3A4A5A]">
          Received {format(new Date(lead.created_at), 'MMM d, yyyy · h:mm a')}
        </div>
      )}
    </div>
  )
}
