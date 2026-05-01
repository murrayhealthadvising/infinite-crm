import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import StatusTag from '../components/StatusTag'
import AddLeadModal from '../components/AddLeadModal'
import { Search, Plus, LayoutList, Columns, Phone, Copy, Home, DollarSign, Calendar, ExternalLink, ChevronDown, ChevronUp, X, Users, Check, Download, Upload, Square, CheckSquare } from 'lucide-react'

// Drag-to-scroll hook for horizontal containers
function useDragScroll() {
  const ref = useRef(null)
  const state = useRef({ down: false, startX: 0, scrollLeft: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onDown = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      state.current = { down: true, startX: clientX - el.offsetLeft, scrollLeft: el.scrollLeft }
      el.style.cursor = 'grabbing'
      el.style.userSelect = 'none'
    }
    const onUp = () => { state.current.down = false; el.style.cursor = 'grab'; el.style.userSelect = '' }
    const onMove = (e) => {
      if (!state.current.down) return
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const x = clientX - el.offsetLeft
      el.scrollLeft = state.current.scrollLeft - (x - state.current.startX) * 1.2
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
import { format, formatDistanceToNow, differenceInYears, parseISO } from 'date-fns'
import clsx from 'clsx'

// Age tooltip on DOB hover
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

// Tag pill dropdown — portal-based so nothing clips it
function TagPill({ stage, tags, onChange }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, openUp: false })
  const btnRef = useRef(null)
  const tag = tags.find(t => t.id === stage) || tags[0]
  const ITEM_H = 40
  const DROPDOWN_H = tags.length * ITEM_H + 8

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) {
        // also check if clicking inside the portal dropdown
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
      setPos({
        left: rect.left,
        top: openUp ? rect.top - DROPDOWN_H - 6 : rect.bottom + 6,
        openUp,
      })
    }
    setOpen(v => !v)
  }

  const dropdown = open ? (
    <div
      id="tag-portal"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: '192px',
        background: '#0A0E14',
        border: '1px solid #1A2130',
        borderRadius: '12px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
        zIndex: 9999,
        overflow: 'hidden',
      }}>
      {tags.map(t => (
        <button key={t.id}
          onClick={(e) => { e.stopPropagation(); onChange(t.id); setOpen(false) }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: '10px 12px', fontSize: '12px',
            color: t.color, background: 'transparent', border: 'none', cursor: 'pointer',
            textAlign: 'left',
          }}
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

// Auto-growing textarea
function AutoTextarea({ value, onChange, onBlur, placeholder }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = Math.max(64, ref.current.scrollHeight) + 'px' }
  }, [value])
  return (
    <textarea ref={ref} value={value}
      onChange={e => { onChange(e.target.value); if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = Math.max(64, ref.current.scrollHeight) + 'px' } }}
      onBlur={onBlur} placeholder={placeholder} rows={3}
      className="w-full bg-transparent border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm placeholder-[#3A4A5A] focus:outline-none focus:border-[#2A3547] resize-none overflow-hidden transition-colors"
      style={{ color: '#C0D0E0', minHeight: '64px' }}
      onClick={e => e.stopPropagation()} />
  )
}

// Lead card
function LeadCard({ lead, selected, onSelect, onStageChange, onNoteChange, onNavigate }) {
  const { tags, getTag } = useApp()
  const [note, setNote] = useState(lead.notes || '')
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const tag = getTag(lead.stage)

  const copyPhone = (e) => { e.stopPropagation(); navigator.clipboard.writeText(lead.phone); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const saveNote = () => { if (note !== lead.notes) onNoteChange(lead.id, note) }

  return (
    <div className="rounded-xl border overflow-hidden transition-all duration-200"
      style={{ background: tag.bg, borderColor: selected ? tag.color : tag.color + '30', borderWidth: selected ? '2px' : '1px' }}>
      {/* Main row */}
      <div className="grid gap-3 px-4 pt-3 pb-2 items-start" style={{ gridTemplateColumns: '28px 1.8fr 0.9fr 1.4fr 1fr 80px' }}>

        {/* Checkbox */}
        <div className="pt-1" onClick={e => e.stopPropagation()}>
          <button onClick={() => onSelect(lead.id)}
            className="text-[#3A4A5A] hover:text-white transition-colors">
            {selected ? <CheckSquare size={16} style={{ color: tag.color }} /> : <Square size={16} />}
          </button>
        </div>

        {/* Col 1: Identity */}
        <div>
          {/* Clickable name */}
          <button onClick={() => onNavigate(lead.id)}
            className="text-sm font-semibold text-white hover:underline text-left mb-1 block"
            style={{ color: 'white' }}
            onMouseEnter={e => e.target.style.color = tag.color}
            onMouseLeave={e => e.target.style.color = 'white'}>
            {lead.first_name} {lead.last_name}
          </button>
          <div className="flex items-center gap-1.5 mb-1">
            <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
              className="text-sm font-mono hover:underline" style={{ color: tag.color }}>
              {lead.phone}
            </a>
            <button onClick={copyPhone} className="text-[#3A4A5A] hover:text-[#8899AA] transition-colors">
              {copied ? <Check size={11} className="text-[#00E5C3]" /> : <Copy size={11} />}
            </button>
          </div>
          {lead.email && <p className="text-xs text-[#5A6A7A] truncate max-w-[200px] mb-1">{lead.email}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-[#5A6A7A]">{[lead.state, lead.zip].filter(Boolean).join(' ')}</span>
            {lead.source && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: tag.color + '15', color: tag.color }}>{lead.source}</span>}
          </div>
        </div>

        {/* Col 2: Actions */}
        <div className="flex flex-col gap-2 pt-0.5" onClick={e => e.stopPropagation()}>
          <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-black transition-opacity hover:opacity-80"
            style={{ background: `linear-gradient(135deg, ${tag.color}, ${tag.color}AA)` }}>
            <Phone size={12} /> Call
          </a>
          <TagPill stage={lead.stage} tags={tags} onChange={(s) => onStageChange(lead.id, s)} />
        </div>

        {/* Col 3: Lead info */}
        <div className="space-y-1.5">
          {lead.household && (
            <div className="flex items-center gap-1.5">
              <Home size={11} className="text-[#3A4A5A]" />
              <span className="text-xs text-[#8899AA]">Household: {lead.household}</span>
            </div>
          )}
          {lead.income && (
            <div className="flex items-center gap-1.5">
              <DollarSign size={11} className="text-[#3A4A5A]" />
              <span className="text-xs text-[#8899AA]">${Number(lead.income).toLocaleString()}/yr</span>
            </div>
          )}
          {lead.dob && (
            <div className="flex items-center gap-1.5">
              <Calendar size={11} className="text-[#3A4A5A]" />
              <DOBField dob={lead.dob} />
            </div>
          )}
          {lead.gender && <p className="text-xs text-[#5A6A7A]">{lead.gender}{lead.age_range ? ` · ${lead.age_range}` : ''}</p>}
          {lead.smoker && lead.smoker.toLowerCase() !== 'no' && lead.smoker.toLowerCase() !== 'false' && (
            <p className="text-xs text-[#F97316]">Smoker</p>
          )}
          {lead.comments && <p className="text-xs text-[#5A6A7A] line-clamp-2">{lead.comments}</p>}
          {lead.plan_choice && <p className="text-xs text-[#5A6A7A]">Plan: {lead.plan_choice}</p>}
          {lead.monthly_budget && <p className="text-xs text-[#5A6A7A]">Budget: ${lead.monthly_budget}/mo</p>}
          {lead.premium && (
            <p className="text-xs font-mono" style={{ color: tag.color }}>${lead.premium}/mo · {lead.carrier}</p>
          )}
        </div>

        {/* Col 4: Meta */}
        <div className="space-y-1">
          <p className="text-[10px] text-[#3A4A5A] font-mono uppercase tracking-wider">Received</p>
          <p className="text-xs text-[#8899AA]">{format(new Date(lead.created_at), 'MM-dd-yyyy')}</p>
          <p className="text-xs text-[#5A6A7A]">{lead.source || '—'}</p>
        </div>

        {/* Col 5: Controls */}
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

      {/* Notes */}
      <div className="px-4 pb-3 pl-12" onClick={e => e.stopPropagation()}>
        <AutoTextarea value={note} onChange={setNote} onBlur={saveNote} placeholder="Add notes..." />
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-[#1A2130]">
          <div className="grid grid-cols-3 gap-3 pt-3">
            <div className="p-2.5 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F40' }}>
              <p className="text-[10px] text-[#3A4A5A] font-mono uppercase tracking-wider mb-1">Agent</p>
              <p className="text-xs text-white">{lead.agent || '—'}</p>
            </div>
            <div className="p-2.5 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F40' }}>
              <p className="text-[10px] text-[#3A4A5A] font-mono uppercase tracking-wider mb-1">Last Activity</p>
              <p className="text-xs text-white">{formatDistanceToNow(new Date(lead.last_activity), { addSuffix: true })}</p>
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

// Draggable scrollable pill filter row
function DragScrollPills({ stageFilter, setStageFilter, tags, leads }) {
  const ref = useDragScroll()
  return (
    <div ref={ref} className="flex gap-2 px-6 pb-2 overflow-x-auto"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab', WebkitOverflowScrolling: 'touch' }}>
      <style>{`.drag-pills::-webkit-scrollbar{display:none!important}`}</style>
      <button onClick={() => setStageFilter('')}
        className="px-3 py-1 rounded-full text-xs whitespace-nowrap flex-shrink-0 border transition-all"
        style={!stageFilter ? { background: '#1A2130', color: 'white', borderColor: '#2A3547' } : { color: '#5A6A7A', borderColor: '#1A2130' }}>
        All ({leads.length})
      </button>
      {tags.map(t => (
        <button key={t.id} onClick={() => setStageFilter(stageFilter === t.id ? '' : t.id)}
          className="px-3 py-1 rounded-full text-xs whitespace-nowrap flex-shrink-0 transition-all"
          style={stageFilter === t.id
            ? { background: t.bg, color: t.color, border: `1px solid ${t.color}60` }
            : { color: '#5A6A7A', border: '1px solid #1A2130' }}>
          {t.label} ({leads.filter(l => l.stage === t.id).length})
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
            <button className="text-sm font-medium text-white group-hover:underline text-left block truncate w-full">{lead.first_name} {lead.last_name}</button>
            <p className="text-xs font-mono mt-1" style={{ color: tag.color }}>{lead.phone}</p>
            <p className="text-xs text-[#3A4A5A] mt-1">{lead.state}{lead.zip ? ` · ${lead.zip}` : ''} · {lead.source}</p>
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

// CSV Export — matches Ringy + USHA email format
function exportCSV(leads) {
  const headers = [
    'first_name','last_name','phone','email','state','city','zip','street_address',
    'stage','source','dob','gender','age','age_range','income','household',
    'smoker','spouse_age','num_children','height','weight',
    'premium','carrier','effective_date','plan_choice','monthly_budget',
    'current_carrier','best_contact_time','campaign','price','agent',
    'comments','notes','is_sold'
  ]
  const rows = leads.map(l => headers.map(h => {
    const val = l[h] ?? ''
    return `"${String(val).replace(/"/g, '""')}"`
  }))
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `infinite-leads-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

// CSV Import — exact Ringy + USHA Marketplace column mapping
function importCSV(text, tags) {
  const lines = text.trim().split(/\r?\n/)
  const rawHeaders = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase().replace(/\s+/g,'_'))

  // MAP: our field → all possible CSV column names (Ringy + USHA + generic)
  const MAP = {
    first_name:        ['first_name','first name','firstname','first','fname','given_name'],
    last_name:         ['last_name','last name','lastname','last','lname','surname','family_name'],
    phone:             ['phone','phone_number','phone number','mobile','cell','telephone','primary_phone','primaryphone'],
    email:             ['email','email_address','email address','e_mail'],
    state:             ['state','st','state_code'],
    city:              ['city','town'],
    zip:               ['zip','zip_code','zip code','zipcode','postal_code','postal'],
    street_address:    ['street_address','street address','address','addr','street'],
    dob:               ['dob','date_of_birth','date of birth','birth_date','birthday','birthdate'],
    gender:            ['gender','sex'],
    age:               ['age'],
    age_range:         ['age_range','age range','agerange'],
    income:            ['income','annual_income','household_income','yearly_income'],
    household:         ['household','household_size','household size','family_size','members','householdsize'],
    smoker:            ['smoker','tobacco','smoking'],
    spouse_age:        ['spouse_age','spouse age','spouseage'],
    num_children:      ['num_children','number_of_children','number of children','children','kids','numchildren'],
    height:            ['height'],
    weight:            ['weight'],
    source:            ['source','lead_source','vendor','origin','campaign_name'],
    campaign:          ['campaign','campaign_name','name'],
    price:             ['price','cost','lead_cost','lead cost'],
    notes:             ['notes','note','agent_notes','agent notes'],
    comments:          ['comments','comment','remarks','lead_comments','lead comments'],
    stage:             ['stage','status','disposition','tag'],
    agent:             ['agent','assigned_to','agent_name'],
    premium:           ['premium','monthly_premium','price_quoted'],
    carrier:           ['carrier','insurance_carrier','plan','current_carrier','currentcarrier'],
    effective_date:    ['effective_date','start_date','policy_start','preferred_start_date','preferred start date','prefered_start_date'],
    plan_choice:       ['plan_choice','plan choice','planchoice'],
    monthly_budget:    ['monthly_budget','monthly budget','budget'],
    best_contact_time: ['best_contact_time','best contact time','contact_time'],
    is_sold:           ['is_sold','is sold','sold'],
  }

  const colIndex = {}
  Object.entries(MAP).forEach(([field, variants]) => {
    const idx = rawHeaders.findIndex(h => variants.includes(h))
    if (idx !== -1) colIndex[field] = idx
  })

  const parseRow = (line) => {
    const vals = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { vals.push(cur); cur = '' }
      else cur += ch
    }
    vals.push(cur)
    return vals.map(v => v.replace(/^"|"$/g, '').trim())
  }

  const validTagIds = tags.map(t => t.id)

  return lines.slice(1).filter(l => l.trim()).map((line, i) => {
    const vals = parseRow(line)
    const get = (field) => colIndex[field] !== undefined ? (vals[colIndex[field]] || '') : ''

    // Stage: map Ringy status to our pipeline stages
    let stage = 'not-started'
    const isSold = (get('is_sold') || '').toLowerCase()
    const ringyStatus = (get('ringy_status') || '').toLowerCase()
    if (isSold === 'yes' || isSold === 'true' || isSold === '1') {
      stage = 'sold'
    } else if (ringyStatus.includes('quoted')) {
      stage = 'interested'
    } else if (ringyStatus.includes('appt') || ringyStatus.includes('appointment')) {
      stage = 'apt'
    } else if (ringyStatus.includes('sold')) {
      stage = 'sold'
    }

    // Parse name — some CSVs have "Full Name" in first col
    let firstName = get('first_name')
    let lastName = get('last_name')
    if (!firstName && !lastName) {
      const nameCol = rawHeaders.findIndex(h => h === 'name' || h === 'full_name' || h === 'full name')
      if (nameCol !== -1) {
        const parts = (vals[nameCol] || '').split(' ')
        firstName = parts[0] || 'Unknown'
        lastName = parts.slice(1).join(' ')
      }
    }

    return {
      id: Date.now().toString() + i,
      first_name: firstName || 'Unknown',
      last_name: lastName || '',
      phone: get('phone'),
      email: get('email'),
      state: get('state'),
      city: get('city'),
      zip: get('zip'),
      street_address: get('street_address'),
      dob: get('dob'),
      gender: get('gender'),
      age: get('age'),
      age_range: get('age_range'),
      household: get('household') ? parseInt(get('household')) : null,
      income: get('income') ? parseInt(get('income').replace(/[$,]/g,'')) : null,
      smoker: get('smoker'),
      spouse_age: get('spouse_age'),
      num_children: get('num_children'),
      height: get('height'),
      weight: get('weight'),
      source: get('source') || get('campaign'),
      campaign: get('campaign'),
      price: get('price'),
      notes: get('notes'),
      comments: get('comments'),
      stage,
      agent: get('agent'),
      premium: get('premium') ? parseInt(get('premium').replace(/[$,]/g,'')) : null,
      carrier: get('carrier'),
      effective_date: get('effective_date'),
      plan_choice: get('plan_choice'),
      monthly_budget: get('monthly_budget'),
      best_contact_time: get('best_contact_time'),
      created_at: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    }
  })
}

export default function Leads() {
  const { leads, tags, updateLeadStage, updateLead, addLead, bulkAddLeads, refreshLeads } = useApp()
  const navigate = useNavigate()
  const [view, setView] = useState('list')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [dragLeadId, setDragLeadId] = useState(null)
  const fileRef = useRef(null)
  const [importStatus, setImportStatus] = useState(null)

  const filtered = leads.filter(l => {
    const q = search.toLowerCase()
    const matchSearch = !q || `${l.first_name} ${l.last_name} ${l.phone} ${l.email} ${l.state} ${l.zip}`.toLowerCase().includes(q)
    const matchStage = !stageFilter || l.stage === stageFilter
    return matchSearch && matchStage
  })

  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelected(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)))

  const handleExport = () => {
    const toExport = selected.size > 0 ? leads.filter(l => selected.has(l.id)) : filtered
    exportCSV(toExport)
  }

  const handleImport = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const imported = importCSV(ev.target.result, tags)
        if (!imported || imported.length === 0) {
          setImportStatus({ loading: false, done: 0, total: 0, failed: true, msg: 'No leads found in CSV. Check the file format.' })
          return
        }
        // Dedupe by phone against existing leads
        const existingPhones = new Set(
          leads.map(l => (l.phone || '').replace(/[^\d]/g, '')).filter(Boolean)
        )
        const toImport = imported.filter(l => {
          const phone = (l.phone || '').replace(/[^\d]/g, '')
          if (!phone) return true
          if (existingPhones.has(phone)) return false
          existingPhones.add(phone)
          return true
        })
        const skipped = imported.length - toImport.length
        if (toImport.length === 0) {
          setImportStatus({ loading: false, done: 0, total: imported.length, failed: false, msg: `All ${imported.length} leads already exist — skipped as duplicates` })
          setTimeout(() => setImportStatus(null), 5000)
          return
        }
        setImportStatus({ loading: true, done: 0, total: toImport.length, failed: false })
        // Bulk insert in batches of 50 — much faster than one at a time
        const inserted = await bulkAddLeads(toImport)
        // Refresh from Supabase to show all new leads
        setImportStatus({ loading: true, done: inserted, total: toImport.length, msg: 'Loading leads...' })
        await refreshLeads()
        const msg = [
          `${inserted} lead${inserted !== 1 ? 's' : ''} imported`,
          skipped > 0 ? `${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped` : null,
        ].filter(Boolean).join(' · ')
        setImportStatus({ loading: false, done: inserted, total: toImport.length, failed: false, msg })
        setTimeout(() => setImportStatus(null), 6000)
      } catch (err) {
        console.error('Import error:', err)
        setImportStatus({ loading: false, done: 0, total: 0, failed: true, msg: `Import error: ${err.message}` })
      }
    }
    reader.onerror = () => setImportStatus({ loading: false, done: 0, total: 0, failed: true, msg: 'Could not read file.' })
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleDrop = (stageId) => { if (dragLeadId) { updateLeadStage(dragLeadId, stageId); setDragLeadId(null) } }
  const handleNoteChange = (id, notes) => updateLead(id, { notes })

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130] flex-shrink-0">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Leads</h1>
          <p className="text-xs text-[#5A6A7A] mt-0.5">{filtered.length} of {leads.length} leads{selected.size > 0 ? ` · ${selected.size} selected` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Select all */}
          <button onClick={toggleAll}
            className="p-2 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] transition-colors" title="Select all">
            {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare size={16} className="text-[#00E5C3]" /> : <Square size={16} />}
          </button>
          {/* Export */}
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547] transition-colors">
            <Download size={13} /> {selected.size > 0 ? `Export ${selected.size}` : 'Export'}
          </button>
          {/* Import */}
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547] transition-colors">
            <Upload size={13} /> Import CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleImport} className="hidden" />

          {/* View toggle */}
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
      {importStatus && (
        <div className={`flex items-center gap-3 px-6 py-3 text-sm flex-shrink-0 ${importStatus.failed ? 'bg-[#EF444412] border-b border-[#EF444430]' : 'bg-[#00E5C312] border-b border-[#00E5C330]'}`}>
          {importStatus.loading ? (
            <>
              <div className="w-4 h-4 border-2 border-[#00E5C3] border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span className="text-[#00E5C3]">Importing leads... {importStatus.done} / {importStatus.total}</span>
              <div className="flex-1 h-1.5 rounded-full bg-[#1A2130] overflow-hidden">
                <div className="h-full rounded-full bg-[#00E5C3] transition-all duration-300"
                  style={{ width: `${importStatus.total > 0 ? (importStatus.done / importStatus.total) * 100 : 0}%` }} />
              </div>
            </>
          ) : importStatus.failed ? (
            <>
              <span className="text-[#EF4444]">✗</span>
              <span className="text-[#EF4444]">{importStatus.msg || 'Import failed'}</span>
              <button onClick={() => setImportStatus(null)} className="ml-auto text-[#EF4444] hover:opacity-70">✕</button>
            </>
          ) : (
            <>
              <span className="text-[#00E5C3]">✓</span>
              <span className="text-[#00E5C3]">
                {importStatus.msg || `Successfully imported ${importStatus.done} leads`}
              </span>
              <button onClick={() => setImportStatus(null)} className="ml-auto text-[#00E5C3] hover:opacity-70">✕</button>
            </>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex-shrink-0 border-b border-[#1A2130]" style={{ background: '#080B0F' }}>
        <div className="flex items-center gap-3 px-6 py-2">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5A6A7A]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, email, zip..."
              className="w-full bg-[#0E1318] border border-[#1A2130] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5A6A7A] hover:text-white"><X size={13} /></button>}
          </div>
        </div>
        {/* Draggable scrollable tag pills */}
        <DragScrollPills stageFilter={stageFilter} setStageFilter={setStageFilter} tags={tags} leads={leads} />
      </div>

      {/* Content */}
      {view === 'list' ? (
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {filtered.map(lead => (
            <LeadCard key={lead.id} lead={lead}
              selected={selected.has(lead.id)}
              onSelect={toggleSelect}
              onStageChange={updateLeadStage}
              onNoteChange={handleNoteChange}
              onNavigate={id => navigate(`/leads/${id}`)} />
          ))}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-[#3A4A5A]">
              <Users size={32} className="mb-3 opacity-30" />
              <p className="text-sm">No leads found</p>
              <button onClick={() => fileRef.current?.click()} className="mt-3 text-xs text-[#00E5C3] hover:underline">Import CSV</button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-6">
          <div className="flex gap-4" style={{ minWidth: 'max-content' }}>
            {tags.map(tag => (
              <KanbanCol key={tag.id} tag={tag}
                leads={filtered.filter(l => l.stage === tag.id)}
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
