import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import {
  Phone, PhoneCall, Calendar, CheckSquare, Plus, X, Check, Clock,
  ChevronDown, Trash2, MoreHorizontal, Sun, AlertTriangle,
} from 'lucide-react'
import { format, formatDistanceToNow, isToday, isTomorrow, isThisWeek, isPast, addDays, addHours, addMinutes } from 'date-fns'
import { displayPhone } from '../lib/phone'
import { localTimeFor } from '../lib/timezone'

const KIND_META = {
  call: { icon: PhoneCall, color: '#10B981', label: 'Call' },
  appt: { icon: Calendar,  color: '#3B82F6', label: 'Appt' },
  task: { icon: CheckSquare, color: '#F59E0B', label: 'Task' },
}

function leadName(lead) {
  if (!lead) return '(no lead)'
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || lead.phone || '(unnamed)'
}

// Datetime helper — accept either an ISO string from <input type="datetime-local">
// (no TZ) and produce a proper ISO with the local TZ baked in.
function localInputToIso(input) {
  if (!input) return null
  const d = new Date(input)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

// Inverse: ISO → "yyyy-MM-ddTHH:mm" for the input default value
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Default suggested time for new reminders: tomorrow 9 AM local
function defaultTomorrow9am() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return isoToLocalInput(d.toISOString())
}

// Time-bucket a reminder relative to "now"
function bucketize(due_at) {
  if (!due_at) return 'later'
  const due = new Date(due_at)
  const now = new Date()
  const diffMin = (due.getTime() - now.getTime()) / 60000
  if (diffMin < -2) return 'overdue'  // past 2 min
  if (diffMin < 120) return 'now'     // within 2 hours
  if (isToday(due)) return 'today'
  if (isTomorrow(due)) return 'tomorrow'
  if (isThisWeek(due, { weekStartsOn: 1 })) return 'thisweek'
  return 'later'
}

// Auto-nudge: leads that have been sitting in the same stage > 7 days with no
// recent notes update. Surfaces as suggestions on the Today page.
function buildStaleNudges(leads) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const out = []
  for (const l of leads || []) {
    if (l.stage === 'sold' || l.stage === 'stop' || l.stage === 'ghosted') continue
    const since = new Date(l.stage_changed_at || l.created_at || 0).getTime()
    if (!since || since > cutoff) continue
    out.push({
      id: 'stale-' + l.id,
      lead_id: l.id,
      kind: 'call',
      due_at: null,
      note: `Stale in stage for ${formatDistanceToNow(new Date(since))}`,
      _synthetic: true,
    })
  }
  return out
}

export default function Today() {
  const { reminders, leads, addReminder, completeReminder, uncompleteReminder, snoozeReminder, deleteReminder, tags } = useApp()
  const navigate = useNavigate()
  const [showAdd, setShowAdd] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const safeLeads = Array.isArray(leads) ? leads : []
  const leadById = useMemo(() => {
    const m = new Map()
    for (const l of safeLeads) m.set(l.id, l)
    return m
  }, [safeLeads])

  const activeReminders = (reminders || []).filter(r => !r.done_at)
  const doneReminders = (reminders || []).filter(r => r.done_at).sort((a, b) => new Date(b.done_at) - new Date(a.done_at)).slice(0, 30)

  // Bucket the active ones
  const buckets = useMemo(() => {
    const acc = { overdue: [], now: [], today: [], tomorrow: [], thisweek: [], later: [] }
    for (const r of activeReminders) {
      acc[bucketize(r.due_at)].push(r)
    }
    // sort each bucket by due_at ascending
    for (const k in acc) acc[k].sort((a, b) => new Date(a.due_at || 0) - new Date(b.due_at || 0))
    return acc
  }, [activeReminders])

  const staleNudges = useMemo(() => buildStaleNudges(safeLeads), [safeLeads])

  const totalActive = activeReminders.length

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130]">
        <div className="flex items-center gap-3">
          <Sun size={18} className="text-[#F59E0B]" />
          <div>
            <h1 className="text-xl font-display font-bold text-white">Today</h1>
            <p className="text-xs text-[#5A6A7A] mt-0.5">
              {totalActive === 0 ? 'No reminders — add one to get started' : `${totalActive} open · ${buckets.overdue.length + buckets.now.length} need attention now`}
              {' · '}{format(new Date(), 'EEEE, MMM d')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowDone(v => !v)}
            className="px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547]">
            {showDone ? 'Hide' : 'Show'} completed ({doneReminders.length})
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-black"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Plus size={13} /> Add reminder
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6">
        <Section title="Overdue" tint="#EF4444" icon={AlertTriangle} items={buckets.overdue}
          empty="Nothing overdue ✓" lookup={leadById} onComplete={completeReminder}
          onSnooze={snoozeReminder} onDelete={deleteReminder} onNavigate={(id) => navigate(`/leads/${id}`)} />

        <Section title="Now (next 2 hours)" tint="#F59E0B" icon={Clock} items={buckets.now}
          empty="Free for the next 2 hours" lookup={leadById} onComplete={completeReminder}
          onSnooze={snoozeReminder} onDelete={deleteReminder} onNavigate={(id) => navigate(`/leads/${id}`)} />

        <Section title="Later today" tint="#00E5C3" icon={Sun} items={buckets.today}
          empty="Nothing else scheduled today" lookup={leadById} onComplete={completeReminder}
          onSnooze={snoozeReminder} onDelete={deleteReminder} onNavigate={(id) => navigate(`/leads/${id}`)} />

        <Section title="Tomorrow" tint="#3B82F6" icon={Calendar} items={buckets.tomorrow}
          empty="Nothing scheduled tomorrow" lookup={leadById} onComplete={completeReminder}
          onSnooze={snoozeReminder} onDelete={deleteReminder} onNavigate={(id) => navigate(`/leads/${id}`)} />

        <Section title="This week" tint="#A78BFA" icon={Calendar} items={buckets.thisweek}
          empty="Quiet rest of the week" lookup={leadById} onComplete={completeReminder}
          onSnooze={snoozeReminder} onDelete={deleteReminder} onNavigate={(id) => navigate(`/leads/${id}`)} />

        <Section title="Later" tint="#5A6A7A" icon={Clock} items={buckets.later}
          empty="No long-term reminders" lookup={leadById} onComplete={completeReminder}
          onSnooze={snoozeReminder} onDelete={deleteReminder} onNavigate={(id) => navigate(`/leads/${id}`)} />

        {/* Stale-lead nudges — auto-generated, not real reminders */}
        {staleNudges.length > 0 && (
          <div className="rounded-xl border border-[#1A2130] p-4" style={{ background: '#0E1318' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} className="text-[#A78BFA]" />
                <h3 className="text-xs font-mono uppercase tracking-wider text-[#A78BFA]">Stale leads — could use a touch</h3>
              </div>
              <span className="text-xs font-mono text-white bg-[#1A2130] px-2 py-0.5 rounded-full">{staleNudges.length}</span>
            </div>
            <div className="space-y-2">
              {staleNudges.slice(0, 5).map(n => {
                const lead = leadById.get(n.lead_id)
                return (
                  <div key={n.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F' }}>
                    <button onClick={() => navigate(`/leads/${n.lead_id}`)}
                      className="text-sm text-white hover:underline truncate flex-1 text-left">
                      {leadName(lead)} <span className="text-[#5A6A7A]">— {n.note}</span>
                    </button>
                    {lead?.phone && (
                      <a href={`tel:${lead.phone}`}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold text-black flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                        Call
                      </a>
                    )}
                  </div>
                )
              })}
              {staleNudges.length > 5 && (
                <p className="text-[10px] text-[#5A6A7A] text-center pt-1">…and {staleNudges.length - 5} more — open Pipeline to work them</p>
              )}
            </div>
          </div>
        )}

        {/* Completed (collapsed by default) */}
        {showDone && (
          <div className="rounded-xl border border-[#1A2130] p-4" style={{ background: '#0E1318', opacity: 0.7 }}>
            <h3 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-3">Recently completed</h3>
            {doneReminders.length === 0 ? (
              <p className="text-sm text-[#5A6A7A]">Nothing completed yet today.</p>
            ) : (
              <div className="space-y-2">
                {doneReminders.map(r => (
                  <ReminderRow key={r.id} reminder={r} lead={leadById.get(r.lead_id)}
                    onComplete={uncompleteReminder} onSnooze={snoozeReminder} onDelete={deleteReminder}
                    onNavigate={(id) => navigate(`/leads/${id}`)} done />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showAdd && (
        <AddReminderModal leads={safeLeads} onClose={() => setShowAdd(false)}
          onSubmit={async (data) => { await addReminder(data); setShowAdd(false) }} />
      )}
    </div>
  )
}

function Section({ title, tint, icon: Icon, items, empty, lookup, onComplete, onSnooze, onDelete, onNavigate }) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 px-1">
        <Icon size={13} style={{ color: tint }} />
        <h3 className="text-xs font-mono uppercase tracking-wider" style={{ color: tint }}>{title}</h3>
        <span className="text-xs font-mono text-[#5A6A7A]">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map(r => (
          <ReminderRow key={r.id} reminder={r} lead={lookup.get(r.lead_id)}
            onComplete={onComplete} onSnooze={onSnooze} onDelete={onDelete}
            onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}

function ReminderRow({ reminder, lead, onComplete, onSnooze, onDelete, onNavigate, done }) {
  const meta = KIND_META[reminder.kind] || KIND_META.call
  const Icon = meta.icon
  const overdue = reminder.due_at && isPast(new Date(reminder.due_at)) && !done
  const dueLabel = reminder.due_at
    ? (isToday(new Date(reminder.due_at))
        ? format(new Date(reminder.due_at), 'h:mm a')
        : format(new Date(reminder.due_at), 'MMM d, h:mm a'))
    : 'no time'
  const tzTime = lead && localTimeFor(lead)

  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const snoozeBy = (delta) => {
    const base = reminder.due_at ? new Date(reminder.due_at) : new Date()
    const next = typeof delta === 'function' ? delta(base) : addMinutes(base, delta)
    onSnooze(reminder.id, next.toISOString())
    setSnoozeOpen(false)
  }

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${done ? '' : 'hover:border-[#2A3547]'}`}
      style={{ background: '#080B0F', borderColor: overdue ? '#EF444460' : '#1A2130' }}>

      {/* Done checkbox */}
      <button onClick={() => onComplete(reminder.id)}
        className="flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors"
        style={{ borderColor: done ? '#00E5C3' : '#2A3547', background: done ? '#00E5C320' : 'transparent' }}
        title={done ? 'Mark not done' : 'Mark done'}>
        {done && <Check size={12} className="text-[#00E5C3]" />}
      </button>

      {/* Kind icon */}
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: meta.color + '20' }}>
        <Icon size={13} style={{ color: meta.color }} />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {lead ? (
            <button onClick={() => onNavigate(lead.id)}
              className="text-sm font-medium text-white hover:text-[#00E5C3] truncate text-left">
              {leadName(lead)}
            </button>
          ) : (
            <span className="text-sm text-[#5A6A7A] italic">(no lead)</span>
          )}
          {lead?.phone && (
            <span className="text-[11px] font-mono text-[#5A6A7A]">{displayPhone(lead.phone)}</span>
          )}
          {tzTime && <span className="text-[10px] font-mono text-[#5A6A7A]">{tzTime}</span>}
        </div>
        {reminder.note && <p className="text-xs text-[#8899AA] truncate">{reminder.note}</p>}
      </div>

      {/* Due time */}
      <div className="text-right flex-shrink-0">
        <p className="text-[11px] font-mono" style={{ color: overdue ? '#EF4444' : '#5A6A7A' }}>
          {dueLabel}
        </p>
      </div>

      {/* Actions */}
      {!done && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {lead?.phone && (
            <a href={`tel:${lead.phone}`}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold text-black"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <Phone size={11} className="inline -mt-0.5" /> Call
            </a>
          )}
          <div className="relative">
            <button onClick={() => setSnoozeOpen(v => !v)}
              className="px-2 py-1 rounded-lg text-xs text-[#5A6A7A] hover:text-white border border-[#1A2130]">
              <Clock size={11} className="inline -mt-0.5" />
            </button>
            {snoozeOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 rounded-lg border border-[#1A2130] overflow-hidden shadow-xl"
                style={{ background: '#0A0E14', minWidth: '140px' }}>
                <button onClick={() => snoozeBy(15)} className="block w-full text-left px-3 py-1.5 text-xs text-[#8899AA] hover:bg-[#1A2130]">+ 15 min</button>
                <button onClick={() => snoozeBy(60)} className="block w-full text-left px-3 py-1.5 text-xs text-[#8899AA] hover:bg-[#1A2130]">+ 1 hour</button>
                <button onClick={() => snoozeBy(180)} className="block w-full text-left px-3 py-1.5 text-xs text-[#8899AA] hover:bg-[#1A2130]">+ 3 hours</button>
                <button onClick={() => snoozeBy(d => addDays(d, 1))} className="block w-full text-left px-3 py-1.5 text-xs text-[#8899AA] hover:bg-[#1A2130]">+ 1 day</button>
                <button onClick={() => snoozeBy(d => addDays(d, 7))} className="block w-full text-left px-3 py-1.5 text-xs text-[#8899AA] hover:bg-[#1A2130]">+ 1 week</button>
              </div>
            )}
          </div>
          <button onClick={() => { if (confirm('Delete this reminder?')) onDelete(reminder.id) }}
            className="p-1.5 rounded-lg text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415]">
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

function AddReminderModal({ leads, onClose, onSubmit }) {
  const [kind, setKind] = useState('call')
  const [leadId, setLeadId] = useState('')
  const [leadSearch, setLeadSearch] = useState('')
  const [due, setDue] = useState(defaultTomorrow9am())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const filteredLeads = (leadSearch
    ? leads.filter(l => {
        const q = leadSearch.toLowerCase()
        return leadName(l).toLowerCase().includes(q) || (l.phone || '').includes(leadSearch) || (l.email || '').toLowerCase().includes(q)
      })
    : leads
  ).slice(0, 6)

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSubmit({ lead_id: leadId || null, kind, due_at: localInputToIso(due), note: note.trim() || null })
    } finally { setSaving(false) }
  }

  const selectedLead = leads.find(l => l.id === leadId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]">
          <h3 className="text-base font-semibold text-white">Add reminder</h3>
          <button onClick={onClose} className="text-[#5A6A7A] hover:text-white"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] block mb-2">Kind</label>
            <div className="flex gap-2">
              {Object.entries(KIND_META).map(([k, m]) => (
                <button type="button" key={k} onClick={() => setKind(k)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors"
                  style={kind === k
                    ? { background: m.color + '15', color: m.color, borderColor: m.color + '60' }
                    : { color: '#5A6A7A', borderColor: '#1A2130' }}>
                  <m.icon size={12} /> {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">Lead (optional)</label>
            {selectedLead ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F' }}>
                <span className="text-sm text-white flex-1">{leadName(selectedLead)}</span>
                <button type="button" onClick={() => { setLeadId(''); setLeadSearch('') }}
                  className="text-[#5A6A7A] hover:text-white"><X size={13} /></button>
              </div>
            ) : (
              <>
                <input value={leadSearch} onChange={e => setLeadSearch(e.target.value)}
                  placeholder="Type a name, phone, or email…"
                  className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
                {leadSearch && filteredLeads.length > 0 && (
                  <div className="mt-1 rounded-lg border border-[#1A2130] overflow-hidden" style={{ background: '#0A0E14' }}>
                    {filteredLeads.map(l => (
                      <button type="button" key={l.id} onClick={() => { setLeadId(l.id); setLeadSearch('') }}
                        className="block w-full text-left px-3 py-1.5 text-xs text-[#8899AA] hover:bg-[#1A2130]">
                        {leadName(l)} <span className="text-[#5A6A7A]">{displayPhone(l.phone) || ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">When</label>
            <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)}
              className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {[
                ['+ 1h', () => isoToLocalInput(addHours(new Date(), 1).toISOString())],
                ['+ 3h', () => isoToLocalInput(addHours(new Date(), 3).toISOString())],
                ['Tmrw 9am', () => defaultTomorrow9am()],
                ['+ 1 wk', () => isoToLocalInput(addDays(new Date(), 7).toISOString())],
              ].map(([label, fn]) => (
                <button type="button" key={label} onClick={() => setDue(fn())}
                  className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white hover:border-[#2A3547]">
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">Note</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Quick note about what you need to do…"
              rows={3}
              className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340] resize-y" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-black disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              {saving ? 'Saving…' : 'Add reminder'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
