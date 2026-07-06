import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import {
  Phone, PhoneCall, Calendar, CheckSquare, Plus, X, Check, Clock,
  ChevronDown, Trash2, ChevronLeft, ChevronRight, Sun, AlertTriangle,
} from 'lucide-react'
import {
  format, formatDistanceToNow, isToday, isTomorrow, isPast, isSameDay,
  addDays, addHours, addMinutes, startOfWeek, endOfWeek, startOfDay, differenceInMinutes,
} from 'date-fns'
import { displayPhone } from '../lib/phone'
import { localTimeFor } from '../lib/timezone'

// Reminder kinds — icon + accent color used by both the calendar blocks
// and the sidebar rows so a "Call" is always the same green everywhere.
const KIND_META = {
  call: { icon: PhoneCall,   color: '#10B981', label: 'Call' },
  appt: { icon: Calendar,    color: '#3B82F6', label: 'Appt' },
  task: { icon: CheckSquare, color: '#F59E0B', label: 'Task' },
}

// Calendar visual constants — tweak here to change hourly row height, start/
// end hours, or which day of week starts each column.
const CAL_START_HOUR = 6   // First visible hour (6 AM)
const CAL_END_HOUR   = 22  // Last visible hour exclusive (so up to 10 PM)
const CAL_HOUR_PX    = 44  // Row height per hour
const CAL_HOURS      = CAL_END_HOUR - CAL_START_HOUR

function leadName(lead) {
  if (!lead) return '(no lead)'
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || lead.phone || '(unnamed)'
}

// ISO helpers for the datetime-local <input>
function localInputToIso(input) {
  if (!input) return null
  const d = new Date(input)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function defaultTomorrow9am() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0)
  return isoToLocalInput(d.toISOString())
}

// Stale-lead heuristic — leads sitting in the same stage > 7 days that aren't
// closed. Surfaces in the side rail so the agent can nudge them.
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
      note: `Stale ${formatDistanceToNow(new Date(since))}`,
      since,
    })
  }
  // Sort oldest-first so the most-neglected leads sit at the top
  out.sort((a, b) => a.since - b.since)
  return out
}

// Where should this reminder be placed on the calendar? Returns null if it
// has no due_at (goes to "unscheduled" section in side rail).
function eventPosition(reminder) {
  if (!reminder.due_at) return null
  const start = new Date(reminder.due_at)
  if (isNaN(start.getTime())) return null
  const dayStart = startOfDay(start)
  const minsFromDayStart = differenceInMinutes(start, dayStart)
  const minsFromCalStart = minsFromDayStart - CAL_START_HOUR * 60
  // Default event duration for "Call" = 15 min, "Appt" = 30 min, "Task" = 20
  const durMin = reminder.kind === 'appt' ? 30 : reminder.kind === 'task' ? 20 : 15
  return {
    top: (minsFromCalStart / 60) * CAL_HOUR_PX,
    height: Math.max(20, (durMin / 60) * CAL_HOUR_PX - 2),  // -2 for gap
    date: start,
  }
}

export default function Today() {
  const {
    reminders, leads, addReminder, completeReminder, uncompleteReminder,
    snoozeReminder, deleteReminder, dialsToday, addActivity,
  } = useApp()
  const navigate = useNavigate()

  // Which week are we looking at? Anchor is any date inside the week; the
  // grid derives Sun-Sat from it via startOfWeek(). Left/right arrows shift
  // by ±7 days, "Today" jumps back to the current week.
  const [weekAnchor, setWeekAnchor] = useState(new Date())
  const weekStart = useMemo(() => startOfWeek(weekAnchor, { weekStartsOn: 0 }), [weekAnchor])
  const weekEnd   = useMemo(() => endOfWeek(weekAnchor, { weekStartsOn: 0 }), [weekAnchor])
  const days      = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const [showAdd, setShowAdd] = useState(false)
  const [addSeed, setAddSeed] = useState(null)  // { due_at, kind } — prefill for the add modal

  const safeLeads = Array.isArray(leads) ? leads : []
  const leadById = useMemo(() => {
    const m = new Map()
    for (const l of safeLeads) m.set(l.id, l)
    return m
  }, [safeLeads])

  const activeReminders = (reminders || []).filter(r => !r.done_at)
  const now = new Date()
  const overdue = useMemo(() => activeReminders
    .filter(r => r.due_at && isPast(new Date(r.due_at)))
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at)), [activeReminders])
  const staleNudges = useMemo(() => buildStaleNudges(safeLeads), [safeLeads])

  // Reminders visible in the current week — split by day for the grid
  const remindersByDay = useMemo(() => {
    const map = new Map(days.map(d => [d.toDateString(), []]))
    for (const r of activeReminders) {
      if (!r.due_at) continue
      const d = new Date(r.due_at)
      if (d < weekStart || d > addDays(weekEnd, 1)) continue
      const key = startOfDay(d).toDateString()
      if (map.has(key)) map.get(key).push(r)
    }
    return map
  }, [activeReminders, days, weekStart, weekEnd])

  // Log-a-dial pattern for sidebar Call buttons. Per-lead 2-min coalesce.
  const dialLogRef = useRef({})
  const logDialFor = (lead) => {
    if (!lead?.id) return
    const t = Date.now()
    if (t - (dialLogRef.current[lead.id] || 0) < 2 * 60 * 1000) return
    dialLogRef.current[lead.id] = t
    if (typeof addActivity === 'function') {
      addActivity(lead.id, 'call', `Called ${lead.phone || ''}`.trim()).catch(() => {})
    }
  }

  // Click on an empty slot in the calendar → open Add modal seeded with that
  // date+hour so the agent can just type a note and hit Save. rowClickHour is
  // the hour under the cursor; the date comes from which column was clicked.
  const seedFromSlot = (day, hour) => {
    const seed = new Date(day)
    seed.setHours(hour, 0, 0, 0)
    setAddSeed({ due_at: isoToLocalInput(seed.toISOString()), kind: 'call' })
    setShowAdd(true)
  }
  // Click on a reminder → open the add modal in EDIT mode. For now we just
  // reopen the modal (edit isn't implemented) so at minimum the agent can
  // read the note quickly. Delete/snooze is via the side rail.
  const seedFromReminder = (r) => {
    setAddSeed({ due_at: r.due_at ? isoToLocalInput(r.due_at) : '', kind: r.kind, note: r.note, lead_id: r.lead_id })
    setShowAdd(true)
  }

  const weekLabel = format(weekStart, 'MMM d') + ' – ' + format(weekEnd, 'MMM d, yyyy')

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#1A2130] flex-shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Sun size={18} className="text-[#F59E0B] flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-display font-bold text-white truncate">Today</h1>
            <p className="text-xs text-[#5A6A7A] mt-0.5 truncate">
              {activeReminders.length} open · {overdue.length} overdue · {format(now, 'EEE MMM d')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Week nav */}
          <div className="flex items-center gap-0.5 border border-[#1A2130] rounded-lg">
            <button onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}
              title="Previous week"
              className="p-1.5 text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] rounded-l-lg">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setWeekAnchor(new Date())}
              className="px-3 py-1 text-xs text-[#8899AA] hover:text-white border-x border-[#1A2130]">
              Today
            </button>
            <button onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}
              title="Next week"
              className="p-1.5 text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] rounded-r-lg">
              <ChevronRight size={14} />
            </button>
          </div>
          <span className="text-xs text-[#5A6A7A] font-mono px-1 hidden md:inline">{weekLabel}</span>
          <div className="text-right pr-2 border-r border-[#1A2130]" title="Dials today">
            <p className="text-[9px] text-[#5A6A7A] font-mono uppercase tracking-wider">Dials</p>
            <p className="text-sm font-bold flex items-center justify-end gap-1 leading-tight"
              style={{ color: dialsToday > 0 ? '#00E5C3' : '#5A6A7A' }}>
              <Phone size={10} /> {dialsToday}
            </p>
          </div>
          <button onClick={() => { setAddSeed(null); setShowAdd(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-black"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Plus size={12} /> Add reminder
          </button>
        </div>
      </div>

      {/* Body — calendar on the left, overdue/stale rail on the right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Calendar */}
        <WeekCalendar
          days={days}
          remindersByDay={remindersByDay}
          leadById={leadById}
          onSlotClick={seedFromSlot}
          onReminderClick={seedFromReminder}
          onCompleteReminder={completeReminder}
          onDeleteReminder={deleteReminder}
        />

        {/* Side rail — overdue + stale leads */}
        <SideRail
          overdue={overdue}
          staleNudges={staleNudges}
          leadById={leadById}
          onNavigate={(id) => navigate(`/leads/${id}`)}
          onCompleteReminder={completeReminder}
          onSnoozeReminder={snoozeReminder}
          onDeleteReminder={deleteReminder}
          logDialFor={logDialFor}
        />
      </div>

      {showAdd && (
        <AddReminderModal
          leads={safeLeads}
          seed={addSeed}
          onClose={() => { setShowAdd(false); setAddSeed(null) }}
          onSubmit={async (data) => { await addReminder(data); setShowAdd(false); setAddSeed(null) }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Week calendar — 7 columns × N hour rows. Click a slot to add a reminder
// at that time. Click an existing reminder to view/edit it. Auto-scrolls to
// 8 AM on mount so morning is centered.
// ─────────────────────────────────────────────────────────────────────────────
function WeekCalendar({ days, remindersByDay, leadById, onSlotClick, onReminderClick, onCompleteReminder, onDeleteReminder }) {
  const scrollRef = useRef(null)
  const nowLineRef = useRef(null)
  useEffect(() => {
    // Scroll so 8 AM is near the top (about 2 rows in from 6 AM)
    if (scrollRef.current) scrollRef.current.scrollTop = 2 * CAL_HOUR_PX - 12
  }, [])
  // Ticking current-time line so the red bar moves down through the day.
  const [nowTs, setNowTs] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 60 * 1000)
    return () => clearInterval(t)
  }, [])
  const now = new Date(nowTs)
  const todayIdx = days.findIndex(d => isSameDay(d, now))
  const nowTop = (differenceInMinutes(now, startOfDay(now)) / 60 - CAL_START_HOUR) * CAL_HOUR_PX

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ background: '#080B0F' }}>
      {/* Sticky day header */}
      <div className="sticky top-0 z-20 grid" style={{
        gridTemplateColumns: '52px repeat(7, 1fr)',
        background: '#0E1318',
        borderBottom: '1px solid #1A2130',
      }}>
        <div className="border-r border-[#1A2130]" />
        {days.map((d, i) => {
          const isNow = isSameDay(d, now)
          return (
            <div key={i}
              className="py-2 text-center border-r border-[#1A2130]"
              style={{ background: isNow ? '#00E5C308' : 'transparent' }}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">{format(d, 'EEE')}</p>
              <p className={`text-base font-bold mt-0.5 ${isNow ? 'text-[#00E5C3]' : 'text-white'}`}>{format(d, 'd')}</p>
            </div>
          )
        })}
      </div>

      {/* Grid */}
      <div className="relative grid" style={{
        gridTemplateColumns: '52px repeat(7, 1fr)',
        height: CAL_HOURS * CAL_HOUR_PX,
      }}>
        {/* Hour rail */}
        <div className="relative border-r border-[#1A2130]">
          {Array.from({ length: CAL_HOURS }).map((_, i) => {
            const hour = CAL_START_HOUR + i
            const label = hour === 12 ? '12 PM' : hour === 0 ? '12 AM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`
            return (
              <div key={i}
                className="border-b border-[#1A2130] text-[9px] font-mono text-[#3A4A5A] text-right pr-1.5 pt-0.5"
                style={{ height: CAL_HOUR_PX }}>
                {label}
              </div>
            )
          })}
        </div>

        {/* Day columns */}
        {days.map((day, dayIdx) => {
          const key = day.toDateString()
          const items = remindersByDay.get(key) || []
          const isNow = isSameDay(day, now)
          return (
            <div key={dayIdx} className="relative border-r border-[#1A2130]"
              style={{ background: isNow ? '#00E5C304' : 'transparent' }}>
              {/* Hour slot rows — click any to seed the add modal at that hour */}
              {Array.from({ length: CAL_HOURS }).map((_, i) => {
                const hour = CAL_START_HOUR + i
                return (
                  <button key={i}
                    onClick={() => onSlotClick(day, hour)}
                    className="w-full block border-b border-[#1A2130] hover:bg-[#00E5C308] transition-colors cursor-pointer"
                    style={{ height: CAL_HOUR_PX }}
                    title={`+ Add reminder at ${hour}:00`}
                    aria-label={`Add reminder ${format(day, 'EEE MMM d')} ${hour}:00`}
                  />
                )
              })}
              {/* Events overlaid absolute */}
              {items.map(r => {
                const pos = eventPosition(r)
                if (!pos) return null
                if (pos.top < 0 || pos.top >= CAL_HOURS * CAL_HOUR_PX) return null
                const lead = leadById.get(r.lead_id)
                const meta = KIND_META[r.kind] || KIND_META.call
                const Icon = meta.icon
                const overdue = isPast(new Date(r.due_at)) && !r.done_at
                const border = overdue ? '#EF4444' : meta.color
                return (
                  <button key={r.id}
                    onClick={(e) => { e.stopPropagation(); onReminderClick(r) }}
                    className="absolute left-1 right-1 rounded-md border overflow-hidden text-left px-1.5 py-1 transition-transform hover:scale-[1.02] group"
                    style={{
                      top: pos.top,
                      height: pos.height,
                      background: meta.color + '20',
                      borderColor: border + '60',
                      borderLeft: `3px solid ${border}`,
                    }}
                    title={`${format(new Date(r.due_at), 'h:mm a')} · ${leadName(lead)} · ${r.note || ''}`}>
                    <div className="flex items-center gap-1 min-w-0">
                      <Icon size={9} style={{ color: meta.color }} className="flex-shrink-0" />
                      <span className="text-[10px] font-semibold truncate text-white">{leadName(lead)}</span>
                    </div>
                    {r.note && pos.height > 24 && (
                      <p className="text-[9px] text-[#C0D0E0] truncate leading-tight">{r.note}</p>
                    )}
                    {/* Hover-reveal quick actions */}
                    <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 p-0.5"
                      onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onCompleteReminder(r.id)}
                        className="w-4 h-4 rounded flex items-center justify-center hover:bg-[#10B98130]"
                        title="Mark done">
                        <Check size={9} className="text-[#10B981]" />
                      </button>
                      <button
                        onClick={() => { if (confirm('Delete this reminder?')) onDeleteReminder(r.id) }}
                        className="w-4 h-4 rounded flex items-center justify-center hover:bg-[#EF444430]"
                        title="Delete">
                        <X size={9} className="text-[#EF4444]" />
                      </button>
                    </div>
                  </button>
                )
              })}
              {/* Current-time line — only on today's column, positioned across
                  the whole grid via absolute top */}
              {isNow && nowTop >= 0 && nowTop < CAL_HOURS * CAL_HOUR_PX && (
                <div ref={nowLineRef}
                  className="absolute left-0 right-0 pointer-events-none z-10"
                  style={{ top: nowTop }}>
                  <div style={{ height: 1, background: '#EF4444', boxShadow: '0 0 6px #EF444480' }} />
                  <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full" style={{ background: '#EF4444' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Side rail — overdue reminders on top, stale leads below. Each has a quick
// Call button + snooze/complete/delete for reminders.
// ─────────────────────────────────────────────────────────────────────────────
function SideRail({ overdue, staleNudges, leadById, onNavigate, onCompleteReminder, onSnoozeReminder, onDeleteReminder, logDialFor }) {
  return (
    <aside className="w-80 flex-shrink-0 border-l border-[#1A2130] overflow-y-auto"
      style={{ background: '#0A0E14' }}>
      <div className="p-3 space-y-4">

        {/* Overdue */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={12} className="text-[#EF4444]" />
            <h3 className="text-[10px] font-mono uppercase tracking-wider text-[#EF4444]">
              Overdue {overdue.length > 0 && <span className="text-[#3A4A5A]">· {overdue.length}</span>}
            </h3>
          </div>
          {overdue.length === 0 ? (
            <p className="text-[11px] text-[#3A4A5A] italic px-1">Nothing overdue ✓</p>
          ) : (
            <div className="space-y-1.5">
              {overdue.map(r => (
                <ReminderRow key={r.id} reminder={r}
                  lead={leadById.get(r.lead_id)}
                  onComplete={onCompleteReminder}
                  onSnooze={onSnoozeReminder}
                  onDelete={onDeleteReminder}
                  onNavigate={onNavigate}
                  logDialFor={logDialFor}
                  compact />
              ))}
            </div>
          )}
        </section>

        {/* Stale leads */}
        {staleNudges.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Clock size={12} className="text-[#A78BFA]" />
              <h3 className="text-[10px] font-mono uppercase tracking-wider text-[#A78BFA]">
                Stale leads <span className="text-[#3A4A5A]">· {staleNudges.length}</span>
              </h3>
            </div>
            <div className="space-y-1.5">
              {staleNudges.slice(0, 15).map(n => {
                const lead = leadById.get(n.lead_id)
                if (!lead) return null
                return (
                  <div key={n.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-[#1A2130]"
                    style={{ background: '#080B0F' }}>
                    <button onClick={() => onNavigate(lead.id)}
                      className="flex-1 text-left min-w-0">
                      <p className="text-[11px] text-white truncate">{leadName(lead)}</p>
                      <p className="text-[9px] text-[#5A6A7A] font-mono truncate">{n.note}</p>
                    </button>
                    {lead.phone && (
                      <a href={`tel:${lead.phone}`} onClick={() => logDialFor(lead)}
                        className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-black flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                        Call
                      </a>
                    )}
                  </div>
                )
              })}
              {staleNudges.length > 15 && (
                <p className="text-[9px] text-[#3A4A5A] text-center pt-1">…and {staleNudges.length - 15} more</p>
              )}
            </div>
          </section>
        )}

        {overdue.length === 0 && staleNudges.length === 0 && (
          <p className="text-[11px] text-[#3A4A5A] italic text-center py-8">
            You're all caught up.<br/>Click a slot on the calendar to add a reminder.
          </p>
        )}
      </div>
    </aside>
  )
}

// Compact reminder row for the side rail
function ReminderRow({ reminder, lead, onComplete, onSnooze, onDelete, onNavigate, logDialFor, compact }) {
  const meta = KIND_META[reminder.kind] || KIND_META.call
  const Icon = meta.icon
  const overdue = reminder.due_at && isPast(new Date(reminder.due_at))
  const dueLabel = reminder.due_at
    ? (isToday(new Date(reminder.due_at))
        ? format(new Date(reminder.due_at), 'h:mm a')
        : format(new Date(reminder.due_at), 'MMM d, h:mm a'))
    : 'anytime'
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const snoozeBy = (delta) => {
    const base = reminder.due_at ? new Date(reminder.due_at) : new Date()
    const next = typeof delta === 'function' ? delta(base) : addMinutes(base, delta)
    onSnooze(reminder.id, next.toISOString())
    setSnoozeOpen(false)
  }
  return (
    <div className="px-2 py-1.5 rounded-md border relative"
      style={{ background: '#080B0F', borderColor: overdue ? '#EF444450' : '#1A2130' }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={10} style={{ color: meta.color }} className="flex-shrink-0" />
        {lead ? (
          <button onClick={() => onNavigate(lead.id)}
            className="text-[11px] font-medium text-white hover:text-[#00E5C3] truncate flex-1 text-left">
            {leadName(lead)}
          </button>
        ) : (
          <span className="text-[11px] text-[#5A6A7A] italic flex-1">(no lead)</span>
        )}
        <span className="text-[9px] font-mono flex-shrink-0"
          style={{ color: overdue ? '#EF4444' : '#5A6A7A' }}>{dueLabel}</span>
      </div>
      {reminder.note && <p className="text-[10px] text-[#8899AA] truncate mb-1.5">{reminder.note}</p>}
      <div className="flex items-center gap-1">
        {lead?.phone && (
          <a href={`tel:${lead.phone}`} onClick={() => logDialFor && logDialFor(lead)}
            className="flex-1 text-center py-0.5 rounded text-[9px] font-semibold text-black"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            Call
          </a>
        )}
        <button onClick={() => onComplete(reminder.id)}
          className="p-0.5 rounded text-[#10B981] hover:bg-[#10B98120]" title="Mark done">
          <Check size={11} />
        </button>
        <div className="relative">
          <button onClick={() => setSnoozeOpen(v => !v)}
            className="p-0.5 rounded text-[#5A6A7A] hover:text-white" title="Snooze">
            <Clock size={11} />
          </button>
          {snoozeOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 rounded-lg border border-[#1A2130] overflow-hidden shadow-xl min-w-[120px]"
              style={{ background: '#0A0E14' }}>
              <button onClick={() => snoozeBy(15)}  className="block w-full text-left px-2 py-1 text-[10px] text-[#8899AA] hover:bg-[#1A2130]">+ 15 min</button>
              <button onClick={() => snoozeBy(60)}  className="block w-full text-left px-2 py-1 text-[10px] text-[#8899AA] hover:bg-[#1A2130]">+ 1 hour</button>
              <button onClick={() => snoozeBy(180)} className="block w-full text-left px-2 py-1 text-[10px] text-[#8899AA] hover:bg-[#1A2130]">+ 3 hours</button>
              <button onClick={() => snoozeBy(d => addDays(d, 1))} className="block w-full text-left px-2 py-1 text-[10px] text-[#8899AA] hover:bg-[#1A2130]">+ 1 day</button>
              <button onClick={() => snoozeBy(d => addDays(d, 7))} className="block w-full text-left px-2 py-1 text-[10px] text-[#8899AA] hover:bg-[#1A2130]">+ 1 week</button>
            </div>
          )}
        </div>
        <button onClick={() => { if (confirm('Delete this reminder?')) onDelete(reminder.id) }}
          className="p-0.5 rounded text-[#3A4A5A] hover:text-[#EF4444]" title="Delete">
          <Trash2 size={10} />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Add reminder modal — reused from the old Today. Now supports a seed so
// clicking a calendar slot prefills the date+time.
// ─────────────────────────────────────────────────────────────────────────────
function AddReminderModal({ leads, seed, onClose, onSubmit }) {
  const [kind, setKind] = useState(seed?.kind || 'call')
  const [leadId, setLeadId] = useState(seed?.lead_id || '')
  const [leadSearch, setLeadSearch] = useState('')
  const [due, setDue] = useState(seed?.due_at || defaultTomorrow9am())
  const [note, setNote] = useState(seed?.note || '')
  const [saving, setSaving] = useState(false)

  const filteredLeads = (leadSearch
    ? leads.filter(l => {
        const q = leadSearch.toLowerCase()
        return leadName(l).toLowerCase().includes(q)
          || (l.phone || '').includes(leadSearch)
          || (l.email || '').toLowerCase().includes(q)
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
                ['+ 1h',   () => isoToLocalInput(addHours(new Date(), 1).toISOString())],
                ['+ 3h',   () => isoToLocalInput(addHours(new Date(), 3).toISOString())],
                ['Tmrw 9am', () => defaultTomorrow9am()],
                ['+ 1 wk',  () => isoToLocalInput(addDays(new Date(), 7).toISOString())],
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
