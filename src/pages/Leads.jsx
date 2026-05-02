import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import StatusTag from '../components/StatusTag'
import AddLeadModal from '../components/AddLeadModal'
import {
  Search, Plus, LayoutList, Columns, Phone, Copy, Home, DollarSign, Calendar,
  ExternalLink, ChevronDown, ChevronUp, X, Users, Check, Download, Upload,
  Square, CheckSquare, AlertCircle, CheckCircle,
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

// DOB tooltip
function DOBField({ dob }) {
  const [show, setShow] = useState(false)
  if (!dob) return <span className="text-xs text-[#5A6A7A]">—</span>
  let age = null
  try { age = differenceInYears(new Date(), parseISO(dob)) } catch {}
  return (
    <span className="relative inline-flex items-center gap-1 cursor-default"
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="text-xs text-[#8899AA]">{dob}</span>
      {show && age !== null && (
        <span className="absolute bottom-full left-0 mb-1 px-2 py-1 rounded-lg text-xs font-mono whitespace-nowrap z-50 pointer-events-none"
          style={{ background: '#1A2130', color: '#00E5C3', border: '1px solid #00E5C340' }}>
          Age {age}
        </span>
      )}
    </span>
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
  const DROPDOWN_H = safeTags.length * ITEM_H + 8

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
        background: '#0A0E14', border: '1px solid #1A2130', borderRadius: '12px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.6)', zIndex: 9999, overflow: 'hidden' }}>
      {safeTags.map(t => (
        <button key={t.id}
          onClick={(e) => { e.stopPropagation(); onChange(t.id); setOpen(false) }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: '10px 12px', fontSize: '12px',
            color: t.color, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1A2130'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
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
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all hover:opacity-90 whitespace-nowrap"
        style={{ background: tag.bg, color: tag.color, border: `1px solid ${tag.color}40` }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tag.color }} />
        {tag.label}
        <ChevronDown size={11} className={clsx('transition-transform flex-shrink-0', open && 'rotate-180')} />
      </button>
      {open && createPortal(dropdown, document.body)}
    </div>
  )
}

// Auto-growing notes textarea with auto-save on blur + saved tick
function NotesField({ value, onSave, placeholder }) {
  const ref = useRef(null)
  const [text, setText] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)
  const initialRef = useRef(value || '')

  useEffect(() => { setText(value || ''); initialRef.current = value || '' }, [value])
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = Math.max(64, ref.current.scrollHeight) + 'px'
    }
  }, [text])

  const handleBlur = async () => {
    if (text === initialRef.current) return
    setSaving(true)
    try { await onSave(text); initialRef.current = text; setSavedTick(true); setTimeout(() => setSavedTick(false), 1800) }
    catch { /* swallow */ }
    setSaving(false)
  }

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <textarea ref={ref}
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={3}
        className="w-full bg-transparent border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm placeholder-[#3A4A5A] focus:outline-none focus:border-[#2A3547] resize-none overflow-hidden transition-colors"
        style={{ color: '#C0D0E0', minHeight: '64px' }}
      />
      {(saving || savedTick) && (
        <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-mono"
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
function LeadCard({ lead, selected, onSelect, onStageChange, onNoteChange, onNavigate }) {
  const { tags, getTag } = useApp()
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const safeTags = Array.isArray(tags) && tags.length > 0 ? tags : [{ id: 'not-started', label: 'Not Started', color: '#8899AA', bg: '#1A2130' }]
  const stageId = leadStageId(lead, safeTags)
  const tag = (typeof getTag === 'function' ? getTag(stageId) : null) || safeTags.find(t => t.id === stageId) || safeTags[0]
  const fullName = leadName(lead) || '—'
  const safeColor = tag?.color || '#5A6A7A'
  const safeBg = tag?.bg || '#1A2130'

  const copyPhone = (e) => {
    e.stopPropagation()
    if (lead.phone) navigator.clipboard.writeText(lead.phone)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
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
          <button onClick={() => onNavigate(lead.id)}
            className="text-sm font-semibold text-white hover:underline text-left mb-1 block"
            style={{ color: 'white' }}
            onMouseEnter={e => e.target.style.color = safeColor}
            onMouseLeave={e => e.target.style.color = 'white'}>
            {fullName}
          </button>
          <div className="flex items-center gap-1.5 mb-1">
            {lead.phone && (
              <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
                className="text-sm font-mono hover:underline" style={{ color: safeColor }}>
                {lead.phone}
              </a>
            )}
            {lead.phone && (
              <button onClick={copyPhone} className="text-[#3A4A5A] hover:text-[#8899AA] transition-colors">
                {copied ? <Check size={11} className="text-[#00E5C3]" /> : <Copy size={11} />}
              </button>
            )}
          </div>
          {lead.email && <p className="text-xs text-[#5A6A7A] truncate max-w-[200px] mb-1">{lead.email}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-[#5A6A7A]">{[lead.state, lead.zip].filter(Boolean).join(' ')}</span>
            {lead.source && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: safeColor + '15', color: safeColor }}>{lead.source}</span>}
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-0.5" onClick={e => e.stopPropagation()}>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-black transition-opacity hover:opacity-80"
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
          {lead.income && (
            <div className="flex items-center gap-1.5">
              <DollarSign size={11} className="text-[#3A4A5A]" />
              <span className="text-xs text-[#8899AA]">${Number(String(lead.income).replace(/[^0-9.]/g, '')).toLocaleString()}/yr</span>
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
          {lead.comments && <p className="text-xs text-[#5A6A7A] line-clamp-2">{lead.comments}</p>}
          {lead.plan_choice && <p className="text-xs text-[#5A6A7A]">Plan: {lead.plan_choice}</p>}
          {lead.monthly_budget && <p className="text-xs text-[#5A6A7A]">Budget: ${lead.monthly_budget}/mo</p>}
          {lead.premium && (
            <p className="text-xs font-mono" style={{ color: safeColor }}>${lead.premium}/mo · {lead.carrier || ''}</p>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-[10px] text-[#3A4A5A] font-mono uppercase tracking-wider">Received</p>
          <p className="text-xs text-[#8899AA]">{safeFormat(lead.created_at, 'MM-dd-yyyy')}</p>
          <p className="text-xs text-[#5A6A7A]">{lead.source || '—'}</p>
        </div>

        <div className="flex flex-col items-end gap-1.5 pt-0.5">
          <button onClick={() => onNavigate(lead.id)}
            className="p-1.5 rounded-lg text-[#3A4A5A] hover:text-white transition-colors" title="Open detail">
            <ExternalLink size={14} />
          </button>
          <button onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg text-[#3A4A5A] hover:text-white transition-colors">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Notes — primary element on every card */}
      <div className="px-4 pb-3 pl-12">
        <NotesField
          value={lead.notes || ''}
          onSave={(v) => onNoteChange(lead.id, v)}
          placeholder="Add notes…"
        />
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
            <p className="text-xs font-mono mt-1" style={{ color: tag.color }}>{lead.phone || ''}</p>
            <p className="text-xs text-[#3A4A5A] mt-1">{[lead.state, lead.zip].filter(Boolean).join(' · ')}{lead.source ? ` · ${lead.source}` : ''}</p>
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
// Ringy / ISalesCRM CSV import (kept from new importer)
// ───────────────────────────────────────────────────────────────────────────
const RINGY_MAP = {
  'first name': 'first_name', 'firstname': 'first_name', 'fname': 'first_name',
  'last name': 'last_name',  'lastname':  'last_name',  'lname': 'last_name',
  'full name': 'name', 'name': 'name', 'contact name': 'name', 'contact': 'name',
  'phone': 'phone', 'phone number': 'phone', 'phonenumber': 'phone',
  'mobile': 'phone', 'mobile phone': 'phone', 'cell': 'phone',
  'cell phone': 'phone', 'primary phone': 'phone', 'phone 1': 'phone',
  'email': 'email', 'email address': 'email', 'emailaddress': 'email',
  'address': 'address', 'street': 'address', 'address 1': 'address', 'street address': 'address',
  'city': 'city',
  'state': 'state', 'state/province': 'state', 'province': 'state',
  'zip': 'zip', 'zip code': 'zip', 'zipcode': 'zip', 'postal code': 'zip', 'postal': 'zip',
  'source': 'source', 'lead source': 'source',
  'status': 'status', 'lead status': 'status', 'stage': 'status',
  'notes': 'notes', 'note': 'notes', 'comments': 'notes', 'description': 'notes',
  'tags': 'tags_raw',
  'contact id': 'external_id', 'id': 'external_id', 'lead id': 'external_id', 'ringy id': 'external_id',
  'date added': 'imported_at', 'created': 'imported_at', 'date created': 'imported_at',
  'created at': 'imported_at', 'created_at': 'imported_at',
  'company': 'company', 'company name': 'company',
  'dob': 'dob', 'date of birth': 'dob', 'birthday': 'dob',
  'income': 'income', 'annual income': 'income',
  'household size': 'household_size', 'family size': 'household_size', 'household': 'household_size',
  'county': 'county',
}
const STATUS_MAP = {
  'new': 'Not Started', 'fresh': 'Not Started', 'new lead': 'Not Started',
  'not started': 'Not Started', 'not contacted': 'Not Started', 'uncontacted': 'Not Started',
  'interested': 'Interested', 'hot': 'Interested', 'warm': 'Interested',
  'apt': 'Apt', 'appointment': 'Apt', 'scheduled': 'Apt', 'appointment set': 'Apt',
  'sold': 'Sold', 'closed': 'Sold', 'won': 'Sold', 'enrolled': 'Sold',
  'ghosted': 'Ghosted', 'no answer': 'Ghosted', 'no response': 'Ghosted',
  'aged': 'Aged', 'old': 'Aged', 'stale': 'Aged',
  'stop': 'Stop', 'do not call': 'Stop', 'dnc': 'Stop', 'not interested': 'Stop',
  'long term': 'Long Term', 'future': 'Long Term', 'follow up later': 'Long Term',
}
const STATUSES = ['Not Started','Interested','Apt','Ghosted','Sold','Aged','Stop','Long Term']
function normalizePhone(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  if (digits.length > 6) return String(raw).trim()
  return ''
}
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
function mapRow(row) {
  const out = {}
  for (const [col, val] of Object.entries(row)) {
    const key = String(col).toLowerCase().trim()
    const field = RINGY_MAP[key]
    if (field && val && String(val).trim()) out[field] = String(val).trim()
  }
  if (!out.name) {
    const parts = [out.first_name, out.last_name].filter(Boolean)
    if (parts.length) out.name = parts.join(' ')
  }
  if (out.phone) out.phone = normalizePhone(out.phone)
  out.status = normalizeStatus(out.status)
  if (out.tags_raw) {
    out.tags = out.tags_raw.split(/[,;|]/).map(t => t.trim()).filter(Boolean)
    delete out.tags_raw
  } else { out.tags = [] }
  delete out.imported_at
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
  const { user, leads, tags, updateLeadStage, updateLead, refreshLeads } = useApp()
  const navigate = useNavigate()
  const [view, setView] = useState('list')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [dragLeadId, setDragLeadId] = useState(null)
  const fileRef = useRef(null)

  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState(null)
  const [unmappedCols, setUnmappedCols] = useState([])
  const [importResult, setImportResult] = useState(null)

  const safeTags = Array.isArray(tags) ? tags : []
  const safeLeads = Array.isArray(leads) ? leads : []

  // Newest leads on top
  const sortedLeads = [...safeLeads].sort((a, b) => {
    const ad = new Date(a.created_at || 0).getTime() || 0
    const bd = new Date(b.created_at || 0).getTime() || 0
    return bd - ad
  })

  const filtered = sortedLeads.filter(l => {
    const q = search.toLowerCase().trim()
    const haystack = `${leadName(l)} ${l.phone || ''} ${l.email || ''} ${l.state || ''} ${l.zip || ''} ${l.city || ''}`.toLowerCase()
    const matchSearch = !q || haystack.includes(q)
    const matchStage = !stageFilter || leadStageId(l, safeTags) === stageFilter
    return matchSearch && matchStage
  })

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
      const mapped = rows.map(mapRow)
      const unmapped = headers.filter(h => {
        const key = String(h).toLowerCase().trim()
        return !RINGY_MAP[key] && String(h).trim()
      })
      setUnmappedCols(unmapped)
      const withPhone = mapped.filter(r => r.phone).length
      setImportPreview({ rows: mapped, total: mapped.length, withPhone, filename: file.name, sample: mapped.slice(0, 3) })
      setImportResult(null)
    } catch (err) {
      setImportResult({ error: 'Could not read file: ' + err.message })
    }
  }

  const confirmImport = async () => {
    if (!importPreview || !user?.id) return
    setImporting(true)
    setImportResult(null)
    const { rows } = importPreview
    let imported = 0, errors = 0
    const CHUNK = 100
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map(r => ({
        ...r,
        user_id: user.id,
        source: r.source || 'Ringy Import',
        tags: r.tags || [],
      }))
      const withPhone = chunk.filter(r => r.phone)
      const withoutPhone = chunk.filter(r => !r.phone)
      if (withPhone.length) {
        try {
          const { error } = await supabase.from('leads').upsert(withPhone, { onConflict: 'user_id,phone', ignoreDuplicates: true })
          if (error) { console.error(error); errors += withPhone.length } else imported += withPhone.length
        } catch (e) { console.error(e); errors += withPhone.length }
      }
      if (withoutPhone.length) {
        try {
          const { error } = await supabase.from('leads').insert(withoutPhone)
          if (error) { console.error(error); errors += withoutPhone.length } else imported += withoutPhone.length
        } catch (e) { console.error(e); errors += withoutPhone.length }
      }
    }
    setImportResult({ ok: true, imported, errors, total: rows.length })
    setImportPreview(null)
    setImporting(false)
    try { await refreshLeads() } catch {}
    setTimeout(() => setImportResult(null), 6000)
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
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547] transition-colors">
            <Download size={13} /> {selected.size > 0 ? `Export ${selected.size}` : 'Export'}
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547] transition-colors">
            <Upload size={13} /> Import CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileSelect} className="hidden" />

          <div className="flex rounded-lg border border-[#1A2130] overflow-hidden" style={{ background: '#0A0E14' }}>
            <button onClick={() => setView('list')} className={clsx('px-3 py-1.5 transition-colors', view === 'list' ? 'bg-[#1A2130] text-white' : 'text-[#5A6A7A] hover:text-white')}>
              <LayoutList size={15} />
            </button>
            <button onClick={() => setView('kanban')} className={clsx('px-3 py-1.5 transition-colors', view === 'kanban' ? 'bg-[#1A2130] text-white' : 'text-[#5A6A7A] hover:text-white')}>
              <Columns size={15} />
            </button>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-black transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Plus size={15} /> Add Lead
          </button>
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
                <span>Imported <strong>{importResult.imported}</strong> leads.{importResult.errors > 0 && ` ${importResult.errors} failed.`}</span>
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
            </div>
            <button onClick={() => setImportPreview(null)} className="text-[#8899AA] hover:text-white"><X size={14} /></button>
          </div>
          <div className="space-y-1 mb-3 bg-[#0A0E14] rounded-lg p-3">
            <p className="text-xs text-[#556677] mb-2">Preview (first 3 rows):</p>
            {importPreview.sample.map((r, i) => (
              <div key={i} className="text-xs text-[#8899AA] font-mono">
                {r.name || '(no name)'} · {r.phone || '(no phone)'} · {r.status}
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

      {/* Filters */}
      <div className="flex-shrink-0 border-b border-[#1A2130]" style={{ background: '#080B0F' }}>
        <div className="flex items-center gap-3 px-6 py-2">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5A6A7A]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, phone, email, zip…"
              className="w-full bg-[#0E1318] border border-[#1A2130] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5A6A7A] hover:text-white"><X size={13} /></button>}
          </div>
        </div>
        <DragScrollPills stageFilter={stageFilter} setStageFilter={setStageFilter} tags={safeTags} leads={safeLeads} />
      </div>

      {/* Content */}
      {view === 'list' ? (
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {filtered.map(lead => (
            <LeadCard key={lead.id} lead={lead}
              selected={selected.has(lead.id)}
              onSelect={toggleSelect}
              onStageChange={(id, s) => typeof updateLeadStage === 'function' && updateLeadStage(id, s)}
              onNoteChange={handleNoteChange}
              onNavigate={id => navigate(`/leads/${id}`)} />
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
    </div>
  )
}
