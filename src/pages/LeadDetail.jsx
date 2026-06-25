import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import StatusTag from '../components/StatusTag'
import PitchCountdown from '../components/PitchCountdown'
import ManualEnrollButton from '../components/ManualEnrollButton'
import SoldBadge from '../components/SoldBadge'
import CalendlyButton from '../components/CalendlyButton'
import ComposeEmailModal from '../components/ComposeEmailModal'
import { Phone, Mail, MapPin, Calendar, ArrowLeft, MessageSquare, PhoneCall, AtSign, StickyNote, ChevronDown, Zap, Send, User, Users, Home, DollarSign, Heart, Pencil, Check, X, Clock } from 'lucide-react'
import { normalizePhone, displayPhone } from '../lib/phone'
import { localTimeFor, localHourFor } from '../lib/timezone'
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import { googleCalendarUrl, createCalendarEvent, isGcalConnected } from '../lib/gcal'
import clsx from 'clsx'

// Big notes panel — fixed resting height with internal scroll. User can drag
// the bottom-right corner to expand it into a notepad as big as they want.
function NotesEditor({ value, onSave }) {
  const [text, setText] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)
  const initialRef = useRef(value || '')

  useEffect(() => { setText(value || ''); initialRef.current = value || '' }, [value])

  const handleBlur = async () => {
    if (text === initialRef.current) return
    setSaving(true)
    try { await onSave(text); initialRef.current = text; setSavedTick(true); setTimeout(() => setSavedTick(false), 1800) }
    catch {}
    setSaving(false)
  }

  return (
    <div className="rounded-xl border border-[#F59E0B30] overflow-hidden" style={{ background: '#F59E0B08' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#F59E0B20]">
        <div className="flex items-center gap-2">
          <StickyNote size={14} className="text-[#F59E0B]" />
          <span className="text-xs font-mono uppercase tracking-wider text-[#F59E0B]">Notes</span>
        </div>
        <div className="text-[10px] font-mono" style={{ color: savedTick ? '#00E5C3' : '#5A6A7A' }}>
          {saving ? 'saving…' : savedTick ? <span className="inline-flex items-center gap-1"><Check size={10} /> saved</span> : 'drag corner to expand · auto-save'}
        </div>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={handleBlur}
        placeholder="Click here and start taking notes for this lead — phone calls, follow-ups, anything…"
        className="w-full bg-transparent px-4 py-3 text-sm text-[#E5D9A8] placeholder-[#5A6A7A] focus:outline-none"
        style={{
          height: '220px',
          minHeight: '160px',
          // No maxHeight — drag the corner as big as you want for full notepad mode.
          resize: 'vertical',
          overflowY: 'auto',
        }} />
    </div>
  )
}

const ACTIVITY_ICONS = { call: PhoneCall, text: MessageSquare, email: AtSign, note: StickyNote, status: Zap, apt: Calendar }
const ACTIVITY_COLORS = { call: '#10B981', text: '#3B82F6', email: '#8B5CF6', note: '#F59E0B', status: '#00E5C3', apt: '#F97316' }

function ActivityEntry({ activity }) {
  const Icon = ACTIVITY_ICONS[activity.type] || StickyNote
  const color = ACTIVITY_COLORS[activity.type] || '#5A6A7A'
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: color + '20' }}>
          <Icon size={13} style={{ color }} />
        </div>
        <div className="w-px flex-1 bg-[#1A2130] mt-1" />
      </div>
      <div className="pb-5 flex-1">
        <p className="text-sm text-[#C0D0E0]">{activity.note}</p>
        <p className="text-xs text-[#3A4A5A] mt-1 font-mono">{formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}</p>
      </div>
    </div>
  )
}

// Inline editable field
function EditableField({ label, value, icon: Icon, onSave, type = 'text', options }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value || '')

  const save = () => { onSave(val); setEditing(false) }
  const cancel = () => { setVal(value || ''); setEditing(false) }

  return (
    <div className="p-3 rounded-lg border border-[#1A2130] group relative" style={{ background: '#080B0F' }}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon size={11} className="text-[#5A6A7A]" />}
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">{label}</span>
      </div>
      {editing ? (
        <div className="flex items-center gap-1">
          {options ? (
            <select value={val} onChange={e => setVal(e.target.value)} autoFocus
              className="flex-1 bg-[#0E1318] border border-[#00E5C340] rounded px-2 py-1 text-sm text-white focus:outline-none">
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input type={type} value={val} onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
              autoFocus
              className="flex-1 bg-[#0E1318] border border-[#00E5C340] rounded px-2 py-1 text-sm text-white focus:outline-none min-w-0" />
          )}
          <button onClick={save} className="p-1 text-[#00E5C3] hover:opacity-80 flex-shrink-0"><Check size={13} /></button>
          <button onClick={cancel} className="p-1 text-[#5A6A7A] hover:text-white flex-shrink-0"><X size={13} /></button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-white truncate">{val || <span className="text-[#3A4A5A]">—</span>}</p>
          <button onClick={() => setEditing(true)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[#3A4A5A] hover:text-[#00E5C3] flex-shrink-0">
            <Pencil size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

// Custom user-defined field row (lives in lead.custom_fields JSONB)
function CustomFieldRow({ name, value, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value || '')
  useEffect(() => setVal(value || ''), [value])

  const save = () => { onUpdate(val); setEditing(false) }
  const cancel = () => { setVal(value || ''); setEditing(false) }

  return (
    <div className="p-3 rounded-lg border border-[#1A2130] group relative" style={{ background: '#080B0F' }}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#A78BFA] truncate">{name}</span>
        <button onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-[#3A4A5A] hover:text-[#EF4444] transition-colors flex-shrink-0"
          title="Remove this field">
          <X size={11} />
        </button>
      </div>
      {editing ? (
        <div className="flex items-center gap-1">
          <input value={val} onChange={e => setVal(e.target.value)} autoFocus
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
            className="flex-1 bg-[#0E1318] border border-[#00E5C340] rounded px-2 py-1 text-sm text-white focus:outline-none min-w-0" />
          <button onClick={save} className="p-1 text-[#00E5C3] flex-shrink-0"><Check size={13} /></button>
          <button onClick={cancel} className="p-1 text-[#5A6A7A] flex-shrink-0"><X size={13} /></button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-white truncate">{val || <span className="text-[#3A4A5A]">—</span>}</p>
          <button onClick={() => setEditing(true)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[#3A4A5A] hover:text-[#00E5C3] flex-shrink-0">
            <Pencil size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

function leadFullName(lead) {
  if (lead?.name) return lead.name
  return [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim() || 'this lead'
}
function leadStageLabel(lead) {
  return lead?.status || lead?.stage || 'new'
}

function AIAssistant({ lead }) {
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `I'm looking at ${leadFullName(lead)} — ${leadStageLabel(lead)} lead from ${lead?.state || 'unknown'}. ${lead?.notes ? `Notes: "${lead.notes}". ` : ''}How can I help you follow up?` }
  ])
  const [loading, setLoading] = useState(false)

  const send = async () => {
    if (!prompt.trim() || loading) return
    const userMsg = { role: 'user', content: prompt }
    setMessages(prev => [...prev, userMsg])
    setPrompt('')
    setLoading(true)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: `You are an AI assistant for Nic Murray, a health insurance agent at Murray Health Advising. Be concise and practical. Lead: ${lead.first_name} ${lead.last_name}, ${lead.phone}, ${lead.state}, stage: ${lead.stage}, source: ${lead.source}, income: ${lead.income ? '$'+lead.income.toLocaleString() : 'unknown'}, household: ${lead.household || 'unknown'}, notes: ${lead.notes || 'none'}. You sell SecureAdvantage, PremierAdvantage, and HealthAccess III.`,
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
        })
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.content?.[0]?.text || 'Sorry, try again.' }])
    } catch { setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error.' }]) }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1A2130]">
        <Zap size={14} className="text-[#00E5C3]" />
        <span className="text-xs font-mono text-[#00E5C3] uppercase tracking-wider">AI Assistant</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={clsx('text-sm rounded-lg px-3 py-2.5 max-w-[90%]', m.role === 'user' ? 'ml-auto bg-[#00E5C315] text-white border border-[#00E5C320]' : 'bg-[#0E1318] text-[#C0D0E0] border border-[#1A2130]')}>
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="bg-[#0E1318] border border-[#1A2130] rounded-lg px-3 py-2.5 max-w-[90%]">
            <div className="flex gap-1">{[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#00E5C3] animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />)}</div>
          </div>
        )}
      </div>
      <div className="p-3 border-t border-[#1A2130]">
        <div className="flex gap-2">
          <input value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Draft a text, suggest follow-up..."
            className="flex-1 bg-[#0A0E14] border border-[#1A2130] rounded-lg px-3 py-2 text-xs text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
          <button onClick={send} className="px-3 py-2 rounded-lg text-black transition-opacity hover:opacity-80" style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Send size={13} />
          </button>
        </div>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {['Draft a follow-up text', 'Suggest next steps', 'Write a re-engagement message'].map(s => (
            <button key={s} onClick={() => setPrompt(s)} className="text-[10px] px-2 py-1 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white hover:border-[#00E5C340] transition-colors">{s}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Big action log panel — auto-logs every Call click with the exact time of day
// so you can see "called at 2:14 PM Wed, no answer" at a glance. Manual entries
// (text, email, note) get the same treatment. Kept sticky on the right column
// so it's visible while you're pitching.
function ActionLogPanel({ activities, leadId, addActivity, deleteActivity, setLeadActivities }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState('note')
  const list = (activities || []).slice(0, 40)

  const add = async () => {
    if (!text.trim()) return
    const entry = await addActivity(leadId, kind, text.trim())
    if (entry) setLeadActivities(prev => [entry, ...prev])
    setText('')
  }

  const remove = async (aid) => {
    if (!aid || String(aid).startsWith('tmp-')) return
    if (!confirm('Delete this action log entry?')) return
    setLeadActivities(prev => prev.filter(a => a.id !== aid))
    try { await deleteActivity(aid, leadId) } catch {}
  }

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
          {[['call','Called','#10B981'],['text','Texted','#3B82F6'],['email','Emailed','#8B5CF6'],['note','Note','#F59E0B']].map(([k, l, c]) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className="text-[10px] px-2 py-0.5 rounded border transition-colors"
              style={kind === k ? { background: c + '15', color: c, borderColor: c + '60' } : { color: '#5A6A7A', borderColor: '#1A2130' }}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="What happened? (e.g., didn't answer, left vm)"
            className="flex-1 bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
          <button onClick={add} className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-black"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            Add
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5" style={{ maxHeight: '380px', minHeight: '220px' }}>
        {list.length === 0 ? (
          <p className="text-xs text-[#3A4A5A] text-center py-8 px-4">
            Every call you make is auto-logged here with the exact time of day, so you can see when they don't pick up.
          </p>
        ) : list.map((a, i) => {
          const Icon = ACTIVITY_ICONS[a.type] || StickyNote
          const color = ACTIVITY_COLORS[a.type] || '#5A6A7A'
          const when = (() => { try { return new Date(a.created_at) } catch { return new Date() } })()
          const valid = isFinite(when.getTime())
          const dayLabel = !valid ? '' : isToday(when) ? 'Today' : isYesterday(when) ? 'Yesterday' : format(when, 'EEE MMM d')
          const timeLabel = !valid ? '' : format(when, 'h:mm a')
          return (
            <div key={a.id || i} className="flex items-start gap-2.5 group">
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: color + '20' }}>
                <Icon size={11} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#C0D0E0] leading-snug">{a.note}</p>
                <p className="text-[10px] text-[#3A4A5A] font-mono mt-0.5">
                  {dayLabel}{dayLabel && timeLabel ? ' · ' : ''}{timeLabel}
                </p>
              </div>
              {a.id && !String(a.id).startsWith('tmp-') && (
                <button
                  onClick={() => remove(a.id)}
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

// Read-mode info card for the pitch view. Hover → pencil. Click pencil → edit.
// All fields are visible by default (no hidden accordion). The "Edit all" toggle
// in the header flips every card into edit mode at once for bulk editing.
function InfoSection({ title, color, children }) {
  return (
    <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
      <div className="px-4 py-2.5 border-b border-[#1A2130]">
        <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: color || '#5A6A7A' }}>{title}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 p-3">
        {children}
      </div>
    </div>
  )
}

export default function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { leads, tags, updateLead, updateLeadStage, addActivity, getLeadActivities, deleteActivity, splitNotes, addReminder } = useApp()
  const [showRemindMe, setShowRemindMe] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const safeLeads = Array.isArray(leads) ? leads : []
  const lead = safeLeads.find(l => l.id === id)
  const [editStage, setEditStage] = useState(false)
  const [leadActivities, setLeadActivities] = useState([])
  const lastCallRef = useRef(0)

  useEffect(() => {
    if (id && typeof getLeadActivities === 'function') {
      // Wipe immediately so the previous lead's activities never bleed into
      // this lead's view while the fetch is in flight.
      setLeadActivities([])
      let cancelled = false
      try {
        // force: true → bypass cache so we always see activities from teammates
        const result = getLeadActivities(id, { force: true })
        if (result && typeof result.then === 'function') {
          result.then(acts => { if (!cancelled) setLeadActivities(acts || []) })
                .catch(() => { if (!cancelled) setLeadActivities([]) })
        }
      } catch { setLeadActivities([]) }
      return () => { cancelled = true }
    }
  }, [id])

  // Smart back: if there's history (came from /pipeline, /leads, etc.) go back,
  // otherwise fall through to /leads as a sensible default.
  const goBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/leads')
  }

  if (!lead) return (
    <div className="flex flex-col items-center justify-center h-full text-[#5A6A7A]">
      <p>Lead not found</p>
      <button onClick={goBack} className="mt-3 text-sm text-[#00E5C3]">← Back</button>
    </div>
  )

  // activities loaded via useEffect above
  const safeTags = Array.isArray(tags) && tags.length > 0 ? tags : [{ id: 'not-started', label: 'Not Started', color: '#8899AA', bg: '#1A2130' }]
  const tag = safeTags.find(t => t.id === lead.stage) || safeTags[0]
  const fName = lead.first_name || (lead.name ? lead.name.split(' ')[0] : '')
  const lName = lead.last_name || (lead.name ? lead.name.split(' ').slice(1).join(' ') : '')
  const initials = ((fName.trim()[0] || '?') + (lName.trim()[0] || '')).toUpperCase()
  const fullName = leadFullName(lead)

  const field = (key) => (val) => {
    // Phone gets normalized to +1XXXXXXXXXX before save (and any +1 the user
    // pastes is collapsed automatically — see lib/phone.js)
    const normalized = key === 'phone' ? normalizePhone(val) : val
    if (typeof updateLead === 'function') updateLead(id, { [key]: normalized })
    if (typeof addActivity === 'function') addActivity(id, 'note', `Updated ${key.replace(/_/g,' ')}: ${normalized}`)
  }

  const logActivity = async () => {
    if (!logNote.trim()) return
    if (typeof addActivity !== 'function') { setLogNote(''); return }
    const entry = await addActivity(id, logType, logNote)
    setLeadActivities(prev => [entry, ...prev])
    setLogNote('')
  }

  // Log a call timestamp when the agent presses Call. Coalesced so spamming
  // the call button doesn't fill the timeline — only one log per 15 min.
  const logCall = async () => {
    const now = Date.now()
    if (now - lastCallRef.current < 2 * 60 * 1000) {
      console.info('[ActionLog] Call to', id, 'coalesced — last call', Math.round((now - lastCallRef.current)/1000), 'sec ago')
      return
    }
    lastCallRef.current = now
    if (typeof addActivity !== 'function') return
    try {
      const entry = await addActivity(id, 'call', `Called ${displayPhone(lead.phone) || lead.phone || ''}`.trim())
      if (entry) setLeadActivities(prev => [entry, ...prev])
    } catch (e) {
      console.error('[ActionLog] Failed to log call for', id, e)
    }
  }

  // (lastCallRef is per-route-instance — LeadDetail unmounts when you navigate
  // to a different lead, so the throttle naturally resets. Still, shorten the
  // window from 15 min to 2 min so legitimate retry-calls aren't dropped.)

  // Most-recent call activity → "Last called 2h ago" badge
  const lastCallAt = (() => {
    const calls = (leadActivities || []).filter(a => a?.type === 'call')
    if (!calls.length) return null
    const t = new Date(calls[0].created_at).getTime()
    return isFinite(t) ? t : null
  })()
  const lastCallLabel = lastCallAt ? formatDistanceToNow(new Date(lastCallAt), { addSuffix: true }) : null

  const tzTime = localTimeFor(lead)
  const tzHour = localHourFor(lead)
  const tzOffHours = tzHour != null && (tzHour < 8 || tzHour >= 21)

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Header — back, name, prominent Call, stage move */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130] flex-shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={goBack} className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] transition-colors flex-shrink-0" title="Back">
            <ArrowLeft size={16} />
          </button>
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ background: (tag?.color || '#5A6A7A') + '25', color: tag?.color || '#5A6A7A' }}>
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-display font-bold text-white truncate">{fullName}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <StatusTag stage={lead.stage} status={lead.status} size="sm" />
              {tzTime && (
                <span className="text-xs font-mono"
                  style={{ color: tzOffHours ? '#F59E0B' : '#5A6A7A' }}
                  title={tzOffHours ? 'Outside 8a–9p local time' : 'Local time'}>
                  · {tzTime}
                </span>
              )}
              {lastCallLabel && (
                <span className="text-xs text-[#5A6A7A]">· last called {lastCallLabel}</span>
              )}
              <PitchCountdown leadId={id} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {lead.phone && (
            <a href={`tel:${lead.phone}`}
              onClick={logCall}
              className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-sm font-semibold text-black transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <PhoneCall size={14} /> Call {displayPhone(lead.phone)}
            </a>
          )}
          {lead.email && (
            <button onClick={() => setShowCompose(true)}
              title={`Compose email to ${lead.email}`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)' }}>
              <Mail size={13} /> Email
            </button>
          )}
          <ManualEnrollButton lead={lead} />
          <CalendlyButton lead={lead} />
          <button onClick={() => setShowRemindMe(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1A2130] text-sm text-[#8899AA] hover:text-white hover:border-[#2A3547]"
            title="Schedule a reminder for this lead">
            <Calendar size={13} /> Remind me
          </button>
          <div className="relative">
            <button onClick={() => setEditStage(!editStage)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#1A2130] text-sm text-[#8899AA] hover:border-[#2A3547] transition-colors">
              Move stage <ChevronDown size={13} className={clsx('transition-transform', editStage && 'rotate-180')} />
            </button>
            {editStage && (
              <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-[#1A2130] overflow-hidden z-20 shadow-xl max-h-80 overflow-y-auto" style={{ background: '#0E1318' }}>
                {safeTags.map(t => (
                  <button key={t.id} onClick={() => { if (typeof updateLeadStage === 'function') updateLeadStage(id, t.id); setEditStage(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-[#1A2130] transition-colors"
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
      </div>

      {/* Body — pitch-first layout: all info visible, no accordion */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-6xl mx-auto w-full">

        {/* Sold — prominent badge with plan + monthly premium */}
        <SoldBadge lead={lead} size="detail" />

        {/* Vendor comments (raw from marketplace) */}
        {lead.comments && (
          <div className="p-4 rounded-lg border border-[#F59E0B20]" style={{ background: '#F59E0B08' }}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#F59E0B] mb-2">Marketplace Comments</p>
            <p className="text-sm text-[#C0D0E0]">{lead.comments}</p>
          </div>
        )}

        {/* Notes (left) + Action log (right) — pitch surface */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {splitNotes ? (
            <div className="space-y-3">
              <NotesEditor value={lead.notes}
                onSave={(v) => typeof updateLead === 'function' ? updateLead(id, { notes: v }) : Promise.resolve()} />
              <NotesEditor value={lead.notes_b}
                onSave={(v) => typeof updateLead === 'function' ? updateLead(id, { notes_b: v }) : Promise.resolve()} />
            </div>
          ) : (
            <NotesEditor value={lead.notes}
              onSave={(v) => typeof updateLead === 'function' ? updateLead(id, { notes: v }) : Promise.resolve()} />
          )}
          <ActionLogPanel activities={leadActivities} leadId={id}
            addActivity={addActivity} deleteActivity={deleteActivity}
            setLeadActivities={setLeadActivities} />
        </div>

        {/* CONTACT — always visible. Hover any cell to edit. */}
        <InfoSection title="Contact" color="#00E5C3">
          <EditableField label="First Name" value={lead.first_name} icon={User} onSave={field('first_name')} />
          <EditableField label="Last Name" value={lead.last_name} icon={User} onSave={field('last_name')} />
          <EditableField label="Phone" value={displayPhone(lead.phone)} icon={Phone} onSave={field('phone')} />
          <EditableField label="Email" value={lead.email} icon={Mail} onSave={field('email')} type="email" />
          <EditableField label="Address" value={lead.address} icon={Home} onSave={field('address')} />
          <EditableField label="City" value={lead.city} icon={MapPin} onSave={field('city')} />
          <EditableField label="State" value={lead.state} icon={MapPin} onSave={field('state')} />
          <EditableField label="Zip" value={lead.zip} icon={MapPin} onSave={field('zip')} />
        </InfoSection>

        {/* DEMOGRAPHICS */}
        <InfoSection title="Demographics" color="#A78BFA">
          <EditableField label="Age" value={lead.age} icon={Heart} onSave={field('age')} type="number" />
          <EditableField label="DOB" value={lead.dob} icon={Heart} onSave={field('dob')} type="date" />
          <EditableField label="Gender" value={lead.gender} icon={User} onSave={field('gender')} />
          <EditableField label="Household" value={lead.household} icon={Users} onSave={field('household')} type="number" />
          <EditableField label="Income" value={lead.income} icon={DollarSign} onSave={field('income')} />
          <EditableField label="Best contact time" value={lead.best_contact_time} icon={Clock} onSave={field('best_contact_time')} />
        </InfoSection>

        {/* INSURANCE */}
        <InfoSection title="Insurance" color="#3B82F6">
          <EditableField label="Campaign" value={lead.campaign} icon={AtSign} onSave={field('campaign')} />
          <EditableField label="Carrier (sold)" value={lead.carrier} icon={AtSign} onSave={field('carrier')} />
          <EditableField label="Premium" value={lead.premium} icon={DollarSign} onSave={field('premium')} type="number" />
          <EditableField label="Effective date" value={lead.effective_date} icon={Calendar} onSave={field('effective_date')} type="date" />
        </InfoSection>

        {/* LOGISTICS */}
        <InfoSection title="Logistics" color="#F59E0B">
          <EditableField label="Agent" value={lead.agent} icon={User} onSave={field('agent')} />
          <EditableField label="Runner" value={lead.runner} icon={Users} onSave={field('runner')} />
          <EditableField label="Date received" value={lead.created_at ? new Date(lead.created_at).toISOString().slice(0, 16) : ''} icon={Calendar}
            onSave={(val) => {
              if (!val) return
              const iso = new Date(val).toISOString()
              if (typeof updateLead === 'function') updateLead(id, { created_at: iso })
            }} type="datetime-local" />
        </InfoSection>

        {/* CUSTOM FIELDS — user-defined extras live here */}
        <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
          <div className="px-4 py-2.5 border-b border-[#1A2130] flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#A78BFA]">Custom fields</span>
            <span className="text-[10px] text-[#3A4A5A] font-mono">
              {Object.keys(lead.custom_fields || {}).length} field{Object.keys(lead.custom_fields || {}).length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 p-3">
            {Object.entries(lead.custom_fields || {}).map(([key, value]) => (
              <CustomFieldRow key={key}
                name={key}
                value={value}
                onUpdate={(v) => {
                  const next = { ...(lead.custom_fields || {}), [key]: v }
                  if (typeof updateLead === 'function') updateLead(id, { custom_fields: next })
                }}
                onDelete={() => {
                  const next = { ...(lead.custom_fields || {}) }
                  delete next[key]
                  if (typeof updateLead === 'function') updateLead(id, { custom_fields: next })
                }}
              />
            ))}
            <button
              onClick={() => {
                const raw = window.prompt('Field name (e.g. "Spouse Name", "Renewal Date"):')
                const name = (raw || '').trim()
                if (!name) return
                if ((lead.custom_fields || {})[name] !== undefined) {
                  alert('That field already exists on this lead.')
                  return
                }
                const next = { ...(lead.custom_fields || {}), [name]: '' }
                if (typeof updateLead === 'function') updateLead(id, { custom_fields: next })
              }}
              className="col-span-2 lg:col-span-3 p-3 rounded-lg border border-dashed border-[#2A3547] text-xs text-[#5A6A7A] hover:text-white hover:border-[#A78BFA]/40 transition-colors">
              + Add custom field
            </button>
          </div>
        </div>
      </div>

      {showRemindMe && (
        <RemindMeModal lead={lead}
          onClose={() => setShowRemindMe(false)}
          onSubmit={async (data) => {
            await addReminder({ ...data, lead_id: id })
            setShowRemindMe(false)
          }} />
      )}

      {showCompose && (
        <ComposeEmailModal leadId={id} to={lead.email}
          onClose={() => setShowCompose(false)} />
      )}
    </div>
  )
}

function RemindMeModal({ lead, onClose, onSubmit }) {
  const [kind, setKind] = useState('call')
  const [due, setDue] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [gcalStatus, setGcalStatus] = useState(null)
  const connected = isGcalConnected()
  const [pushToGcal, setPushToGcal] = useState(connected)

  const buildEvent = () => {
    if (!due) return null
    const leadName = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || lead?.phone || 'Lead'
    const labels = { call: 'Call', appt: 'Appt with', task: 'Task —' }
    return {
      title: `${labels[kind] || ''} ${leadName}`.trim(),
      startsAt: new Date(due).toISOString(),
      durationMinutes: 15,
      details: note || '',
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setGcalStatus(null)
    try {
      const due_at = due ? new Date(due).toISOString() : null
      await onSubmit({ kind, due_at, note: note.trim() || null })
      if (pushToGcal && due) {
        const ev = buildEvent()
        if (ev) {
          const result = await createCalendarEvent(ev)
          setGcalStatus(result)
          // Auto-close on success after a beat so they see the confirmation
          if (result.ok) setTimeout(() => onClose(), 1200)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]">
          <h3 className="text-base font-semibold text-white">Remind me about {lead.first_name || 'this lead'}</h3>
          <button onClick={onClose} className="text-[#5A6A7A] hover:text-white"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="flex gap-2">
            {[['call','Call','#10B981'],['appt','Appt','#3B82F6'],['task','Task','#F59E0B']].map(([k, label, color]) => (
              <button type="button" key={k} onClick={() => setKind(k)}
                className="flex-1 px-3 py-2 rounded-lg text-xs border"
                style={kind === k
                  ? { background: color + '15', color, borderColor: color + '60' }
                  : { color: '#5A6A7A', borderColor: '#1A2130' }}>
                {label}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">When</label>
            <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)}
              className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <button type="button" onClick={() => setBy(d => { d.setHours(d.getHours()+1); return d })}
                className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">+ 1h</button>
              <button type="button" onClick={() => setBy(d => { d.setHours(d.getHours()+3); return d })}
                className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">+ 3h</button>
              <button type="button" onClick={() => setBy(d => { d.setDate(d.getDate()+1); d.setHours(9,0,0,0); return d })}
                className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">Tmrw 9am</button>
              <button type="button" onClick={() => setBy(d => { d.setDate(d.getDate()+7); return d })}
                className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">+ 1 wk</button>
            </div>
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">Note</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="What about this lead needs your attention?"
              className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340] resize-y" />
          </div>
          {/* Google Calendar — direct or fallback URL */}
          {due && (
            <div className="rounded-lg border border-[#1A2130] p-3" style={{ background: '#080B0F' }}>
              {connected ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={pushToGcal} onChange={e => setPushToGcal(e.target.checked)}
                    className="accent-[#A78BFA]" />
                  <span className="text-xs text-[#A78BFA]">
                    {pushToGcal ? 'Will create 15-min event on Google Calendar' : 'Skip Google Calendar for this reminder'}
                  </span>
                </label>
              ) : (
                <a href={(() => { const ev = buildEvent(); return ev ? googleCalendarUrl(ev) : '#' })()}
                  target="_blank" rel="noopener"
                  className="block text-center py-1 text-xs text-[#A78BFA] hover:text-white">
                  + open as new Google Calendar event ↗
                  <span className="block text-[10px] text-[#3A4A5A] mt-0.5">
                    Connect Google Calendar in Settings to skip this step.
                  </span>
                </a>
              )}
              {gcalStatus && (
                <p className={`text-[11px] font-mono mt-2 ${gcalStatus.ok ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
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

          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-black disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              {saving ? 'Saving…' : 'Set reminder'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
