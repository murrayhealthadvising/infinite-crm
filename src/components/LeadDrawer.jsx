import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import StatusTag from './StatusTag'
import { X, Phone, PhoneCall, ChevronDown, ChevronRight, ExternalLink, Check, Calendar, MapPin, Pencil } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import clsx from 'clsx'
import { displayPhone } from '../lib/phone'
import { localTimeFor, localHourFor } from '../lib/timezone'

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

export default function LeadDrawer({ leadId, onClose }) {
  const { leads, tags, updateLead, updateLeadStage, addActivity, addReminder, splitNotes } = useApp()
  const [stageOpen, setStageOpen] = useState(false)
  const [showEmpty, setShowEmpty] = useState(false)
  const lastCallRef = useRef(0)

  // Esc closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
  const tzOff = tzHour != null && (tzHour < 8 || tzHour >= 21)

  const logCall = async () => {
    const now = Date.now()
    if (now - lastCallRef.current < 15 * 60 * 1000) return
    lastCallRef.current = now
    if (typeof addActivity === 'function') {
      try { await addActivity(leadId, 'call', `Called ${displayPhone(lead.phone) || lead.phone || ''}`.trim()) } catch {}
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
                  <span className="text-xs font-mono" style={{ color: tzOff ? '#F59E0B' : '#5A6A7A' }}>
                    · {tzTime}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={onClose} className="p-2 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130]" title="Close (esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Action bar — Call + Move stage */}
        <div className="px-4 py-3 border-b border-[#1A2130] flex items-center gap-2 flex-shrink-0">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} onClick={logCall}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-black"
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
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Notes (top — main surface for working a lead) */}
          {splitNotes ? (
            <div className="grid grid-cols-2 gap-2">
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

          {/* ALL info — every standard field + custom_fields, inline editable */}
          <AllInfoPanel lead={lead} leadId={leadId} updateLead={updateLead}
            showEmpty={showEmpty} setShowEmpty={setShowEmpty} />
        </div>
      </aside>
    </>
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
    ['source', 'Source'],
    ['campaign', 'Campaign'],
    ['current_carrier', 'Current carrier'],
    ['carrier', 'Carrier (sold)'],
    ['premium', 'Premium', { type: 'number' }],
    ['effective_date', 'Effective date', { type: 'date' }],
    ['best_contact_time', 'Best contact time'],
    ['agent', 'Agent'],
    ['runner', 'Runner'],
    ['price', 'Lead cost', { type: 'number' }],
    ['external_id', 'Vendor ID'],
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
