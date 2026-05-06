import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import StatusTag from '../components/StatusTag'
import { Phone, Mail, MapPin, Calendar, ArrowLeft, MessageSquare, PhoneCall, AtSign, StickyNote, ChevronDown, Zap, Send, User, Home, DollarSign, Heart, Pencil, Check, X } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
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
          maxHeight: '80vh',
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

export default function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { leads, tags, updateLead, updateLeadStage, addActivity, getLeadActivities } = useApp()
  const safeLeads = Array.isArray(leads) ? leads : []
  const lead = safeLeads.find(l => l.id === id)
  const [logType, setLogType] = useState('note')
  const [logNote, setLogNote] = useState('')
  const [editStage, setEditStage] = useState(false)
  const [leadActivities, setLeadActivities] = useState([])

  useEffect(() => {
    if (id && typeof getLeadActivities === 'function') {
      try {
        const result = getLeadActivities(id)
        if (result && typeof result.then === 'function') {
          result.then(acts => setLeadActivities(acts || [])).catch(() => setLeadActivities([]))
        }
      } catch { setLeadActivities([]) }
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
    if (typeof updateLead === 'function') updateLead(id, { [key]: val })
    if (typeof addActivity === 'function') addActivity(id, 'note', `Updated ${key.replace(/_/g,' ')}: ${val}`)
  }

  const logActivity = async () => {
    if (!logNote.trim()) return
    if (typeof addActivity !== 'function') { setLogNote(''); return }
    const entry = await addActivity(id, logType, logNote)
    setLeadActivities(prev => [entry, ...prev])
    setLogNote('')
  }

  return (
    <div className="flex h-full overflow-hidden animate-fade-in">
      {/* Main — scrollable */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130] flex-shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={goBack} className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] transition-colors" title="Back">
              <ArrowLeft size={16} />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: (tag?.color || '#5A6A7A') + '25', color: tag?.color || '#5A6A7A' }}>
                {initials}
              </div>
              <div>
                <h1 className="text-lg font-display font-bold text-white">{fullName}</h1>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <StatusTag stage={lead.stage} status={lead.status} size="sm" />
                  <span className="text-xs text-[#5A6A7A]">{[lead.source, lead.state].filter(Boolean).join(' · ') || '—'}</span>
                  {lead.created_at && (
                    <span className="text-xs text-[#3A4A5A]">· added {(() => { try { return format(new Date(lead.created_at), 'MMM d, yyyy') } catch { return '' } })()}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          {/* Stage changer */}
          <div className="relative">
            <button onClick={() => setEditStage(!editStage)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1A2130] text-sm text-[#8899AA] hover:border-[#2A3547] transition-colors">
              Move stage <ChevronDown size={13} className={clsx('transition-transform', editStage && 'rotate-180')} />
            </button>
            {editStage && (
              <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-[#1A2130] overflow-hidden z-20 shadow-xl" style={{ background: '#0E1318' }}>
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Notes — big, prominent, top of detail page */}
          <NotesEditor
            value={lead.notes}
            onSave={(v) => typeof updateLead === 'function' ? updateLead(id, { notes: v }) : Promise.resolve()}
          />

          {/* Editable contact info */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A]">Contact Info</span>
              <span className="text-[10px] text-[#3A4A5A]">— hover any field to edit</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <EditableField label="First Name" value={lead.first_name} icon={User} onSave={field('first_name')} />
              <EditableField label="Last Name" value={lead.last_name} icon={User} onSave={field('last_name')} />
              <EditableField label="Phone" value={lead.phone} icon={Phone} onSave={field('phone')} />
              <EditableField label="Email" value={lead.email} icon={Mail} onSave={field('email')} type="email" />
              <EditableField label="State" value={lead.state} icon={MapPin} onSave={field('state')} />
              <EditableField label="Source" value={lead.source} icon={AtSign} onSave={field('source')} />
              <EditableField label="DOB" value={lead.dob} icon={Heart} onSave={field('dob')} type="date" />
              <EditableField label="Agent" value={lead.agent} icon={User} onSave={field('agent')} />
            </div>
          </div>


          {/* Sold info — only render if there's a plan_choice (set via Sold modal) */}
          {lead.plan_choice && lead.stage === 'sold' && (
            <div className="p-4 rounded-xl border border-[#00E5C330]" style={{ background: '#00E5C308' }}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#00E5C3] mb-2">Sold — Product</p>
              <p className="text-sm text-[#C0D0E0] whitespace-pre-wrap">{lead.plan_choice}</p>
              <button
                onClick={() => {
                  const v = prompt('Update product details:', lead.plan_choice || '')
                  if (v !== null && typeof updateLead === 'function') updateLead(id, { plan_choice: v })
                }}
                className="mt-2 text-[10px] text-[#00E5C3] hover:underline">
                Edit
              </button>
            </div>
          )}

          {/* Comments from lead vendor */}
          {lead.comments && (
            <div className="p-4 rounded-lg border border-[#F59E0B20]" style={{ background: '#F59E0B08' }}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#F59E0B] mb-2">Lead Vendor Comments</p>
              <p className="text-sm text-[#C0D0E0]">{lead.comments}</p>
            </div>
          )}

          {/* Log activity */}
          <div className="p-4 rounded-xl border border-[#1A2130]" style={{ background: '#0E1318' }}>
            <p className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-3">Log Activity</p>
            <div className="flex gap-2 mb-3 flex-wrap">
              {Object.entries(ACTIVITY_ICONS).map(([type, Icon]) => (
                <button key={type} onClick={() => setLogType(type)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs capitalize transition-colors border"
                  style={logType === type
                    ? { borderColor: ACTIVITY_COLORS[type] + '60', background: ACTIVITY_COLORS[type] + '15', color: ACTIVITY_COLORS[type] }
                    : { borderColor: '#1A2130', color: '#5A6A7A' }}>
                  <Icon size={12} />{type}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={logNote} onChange={e => setLogNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && logActivity()}
                placeholder={`Log a ${logType}...`}
                className="flex-1 bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
              <button onClick={logActivity}
                className="px-4 py-2 rounded-lg text-sm font-medium text-black transition-opacity hover:opacity-80"
                style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>Log</button>
            </div>
          </div>

          {/* Timeline */}
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-4">Activity Timeline</p>
            {leadActivities.length > 0
              ? leadActivities.map(a => <ActivityEntry key={a.id} activity={a} />)
              : <div className="flex items-center justify-center h-16 border border-dashed border-[#1A2130] rounded-lg">
                  <p className="text-sm text-[#3A4A5A]">No activity yet</p>
                </div>
            }
          </div>
        </div>
      </div>

      {/* AI Panel */}
      <div className="w-72 border-l border-[#1A2130] flex flex-col flex-shrink-0" style={{ background: '#0A0E14' }}>
        <AIAssistant lead={lead} />
      </div>
    </div>
  )
}
