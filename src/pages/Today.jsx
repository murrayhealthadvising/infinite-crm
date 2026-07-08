import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import {
  Phone, PhoneCall, Calendar, CheckSquare, Plus, X, Check, Clock,
  ChevronLeft, ChevronRight, Trash2, Sun, AlertTriangle, ExternalLink,
} from 'lucide-react'
import { isGcalConnected, listGoogleEvents } from '../lib/gcal'
import {
  format, formatDistanceToNow, isToday, isTomorrow, isPast, isSameDay,
  addDays, addHours, addMinutes, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfDay, endOfDay, differenceInMinutes, differenceInDays,
} from 'date-fns'
import { displayPhone } from '../lib/phone'

// Reminder kinds — same accent color everywhere (calendar block, sidebar row).
const KIND_META = {
  call: { icon: PhoneCall,   color: '#10B981', label: 'Call' },
  appt: { icon: Calendar,    color: '#3B82F6', label: 'Appt' },
  task: { icon: CheckSquare, color: '#F59E0B', label: 'Task' },
}

// Week calendar visual constants
const CAL_START_HOUR = 6
const CAL_END_HOUR   = 22
const CAL_HOUR_PX    = 44
const CAL_HOURS      = CAL_END_HOUR - CAL_START_HOUR

function leadName(lead) {
  if (!lead) return '(no lead)'
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || lead.phone || '(unnamed)'
}

// ISO helpers for <input type="datetime-local">
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
  out.sort((a, b) => a.since - b.since)
  return out
}

// Set the time portion of an ISO date to a specific hour, preserving the day.
// Used by drag-drop: dragging a reminder to a new day preserves its clock time.
function setDayPreservingTime(existingIso, newDay) {
  const existing = existingIso ? new Date(existingIso) : new Date()
  const hh = existing.getHours()
  const mm = existing.getMinutes()
  const target = new Date(newDay)
  target.setHours(hh, mm, 0, 0)
  return target.toISOString()
}

// Where should this reminder be placed on the WEEK calendar? Returns null if
// it has no due_at (goes to "unscheduled" section in side rail).
function eventPosition(reminder) {
  if (!reminder.due_at) return null
  const start = new Date(reminder.due_at)
  if (isNaN(start.getTime())) return null
  const dayStart = startOfDay(start)
  const minsFromDayStart = differenceInMinutes(start, dayStart)
  const minsFromCalStart = minsFromDayStart - CAL_START_HOUR * 60
  const durMin = reminder.kind === 'appt' ? 30 : reminder.kind === 'task' ? 20 : 15
  return {
    top: (minsFromCalStart / 60) * CAL_HOUR_PX,
    height: Math.max(20, (durMin / 60) * CAL_HOUR_PX - 2),
    date: start,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Today page — month view by default, click to add, drag to move, sidebar
// shows overdue reminders + stale-lead nudges. Week view still selectable.
// ─────────────────────────────────────────────────────────────────────────────
export default function Today() {
  const {
    reminders, leads, addReminder, updateReminder, completeReminder,
    snoozeReminder, deleteReminder, dialsToday, addActivity,
  } = useApp()
  const navigate = useNavigate()

  const [view, setView] = useState('month')          // 'month' | 'week'
  const [anchor, setAnchor] = useState(new Date())   // any date inside the visible range
  const [showAdd, setShowAdd] = useState(false)
  const [addSeed, setAddSeed] = useState(null)       // prefill data for the add/edit modal
  const [editing, setEditing] = useState(null)       // reminder being edited

  // Google Calendar overlay — persist the toggle in localStorage so the
  // preference sticks across page loads. Only meaningful if the user has
  // connected their Google account in Settings.
  const gcalConnected = isGcalConnected()
  const [showGcal, setShowGcal] = useState(() => {
    try { return localStorage.getItem('today:showGcal') === '1' } catch { return false }
  })
  const [gcalEvents, setGcalEvents] = useState([])
  const [gcalLoading, setGcalLoading] = useState(false)
  const [gcalError, setGcalError] = useState(null)

  // Fetch GCal events when overlay is on and range changes. Range is the
  // whole visible grid, not just the current month: month view shows leading/
  // trailing week days from adjacent months, so we widen to cover those too.
  useEffect(() => {
    if (!showGcal || !gcalConnected) { setGcalEvents([]); return }
    const timeMin = view === 'month'
      ? startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 })
      : startOfWeek(anchor, { weekStartsOn: 0 })
    const timeMax = view === 'month'
      ? endOfWeek(endOfMonth(anchor), { weekStartsOn: 0 })
      : endOfWeek(anchor, { weekStartsOn: 0 })
    let cancelled = false
    setGcalLoading(true); setGcalError(null)
    listGoogleEvents({ timeMin, timeMax }).then(res => {
      if (cancelled) return
      if (res.ok) { setGcalEvents(res.events || []); setGcalError(null) }
      else { setGcalEvents([]); setGcalError(res.error || 'Load failed') }
      setGcalLoading(false)
    })
    return () => { cancelled = true }
  }, [showGcal, gcalConnected, view, anchor])

  const toggleGcal = () => {
    const next = !showGcal
    setShowGcal(next)
    try { localStorage.setItem('today:showGcal', next ? '1' : '0') } catch {}
  }

  const safeLeads = Array.isArray(leads) ? leads : []
  const leadById = useMemo(() => {
    const m = new Map()
    for (const l of safeLeads) m.set(l.id, l)
    return m
  }, [safeLeads])

  const activeReminders = (reminders || []).filter(r => !r.done_at)
  const overdue = useMemo(() => activeReminders
    .filter(r => r.due_at && isPast(new Date(r.due_at)))
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at)), [activeReminders])
  const staleNudges = useMemo(() => buildStaleNudges(safeLeads), [safeLeads])

  // Log-a-dial pattern for sidebar Call buttons — 2-min per-lead coalesce.
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

  const seedFromSlot = (day, hour) => {
    const seed = new Date(day)
    if (hour != null) seed.setHours(hour, 0, 0, 0)
    else seed.setHours(9, 0, 0, 0)  // default 9 AM for month-view day clicks
    setAddSeed({ due_at: isoToLocalInput(seed.toISOString()), kind: 'call' })
    setEditing(null)
    setShowAdd(true)
  }
  const editReminder = (r) => {
    setEditing(r)
    setAddSeed({
      due_at: r.due_at ? isoToLocalInput(r.due_at) : '',
      end_at: r.end_at ? isoToLocalInput(r.end_at) : '',
      kind: r.kind,
      note: r.note,
      lead_id: r.lead_id,
    })
    setShowAdd(true)
  }

  // Drag-to-reschedule handler shared by month + week view. Preserves the
  // reminder's clock time when moved to a different day.
  const dropReminderOnDay = (reminderId, newDay) => {
    const r = (reminders || []).find(x => x.id === reminderId)
    if (!r) return
    const newDue = setDayPreservingTime(r.due_at, newDay)
    let newEnd = null
    if (r.end_at) {
      // Preserve duration: shift the end by the same delta.
      const delta = new Date(newDue).getTime() - new Date(r.due_at).getTime()
      newEnd = new Date(new Date(r.end_at).getTime() + delta).toISOString()
    }
    const patch = { due_at: newDue }
    if (newEnd) patch.end_at = newEnd
    updateReminder(reminderId, patch)
  }

  const rangeLabel = view === 'month'
    ? format(anchor, 'MMMM yyyy')
    : (() => {
        const ws = startOfWeek(anchor, { weekStartsOn: 0 })
        const we = endOfWeek(anchor, { weekStartsOn: 0 })
        return `${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`
      })()

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#1A2130] flex-shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Sun size={18} className="text-[#F59E0B] flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-display font-bold text-white truncate">Today</h1>
            <p className="text-xs text-[#5A6A7A] mt-0.5 truncate">
              {activeReminders.length} open · {overdue.length} overdue · {rangeLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* View switcher */}
          <div className="flex items-center border border-[#1A2130] rounded-lg overflow-hidden text-xs">
            <button onClick={() => setView('month')}
              className={`px-3 py-1 ${view === 'month' ? 'bg-[#1A2130] text-white' : 'text-[#8899AA] hover:text-white'}`}>
              Month
            </button>
            <button onClick={() => setView('week')}
              className={`px-3 py-1 border-l border-[#1A2130] ${view === 'week' ? 'bg-[#1A2130] text-white' : 'text-[#8899AA] hover:text-white'}`}>
              Week
            </button>
          </div>
          {/* Google Calendar overlay toggle — only rendered when connected.
              If not connected, the button becomes a link to Settings so the
              agent knows where to hook it up. */}
          {gcalConnected ? (
            <button onClick={toggleGcal}
              title={showGcal ? 'Hide Google Calendar events' : 'Overlay Google Calendar events on this view'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                showGcal
                  ? 'border-[#4285F4] text-white'
                  : 'border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547]'
              }`}
              style={showGcal ? { background: '#4285F415' } : {}}
            >
              <Calendar size={12} style={{ color: showGcal ? '#4285F4' : undefined }} />
              GCal {showGcal ? 'on' : 'off'}
              {gcalLoading && <span className="text-[9px] text-[#5A6A7A]">…</span>}
            </button>
          ) : (
            <a href="/settings#gcal"
              title="Connect your Google Calendar in Settings to overlay events here"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-[#1A2130] text-xs text-[#5A6A7A] hover:text-white hover:border-[#2A3547]">
              <Calendar size={12} /> Connect GCal
            </a>
          )}
          {/* Nav */}
          <div className="flex items-center gap-0.5 border border-[#1A2130] rounded-lg">
            <button onClick={() => setAnchor(view === 'month' ? addDays(startOfMonth(anchor), -1) : addDays(anchor, -7))}
              title={view === 'month' ? 'Previous month' : 'Previous week'}
              className="p-1.5 text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] rounded-l-lg">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setAnchor(new Date())}
              className="px-3 py-1 text-xs text-[#8899AA] hover:text-white border-x border-[#1A2130]">
              Today
            </button>
            <button onClick={() => setAnchor(view === 'month' ? addDays(endOfMonth(anchor), 1) : addDays(anchor, 7))}
              title={view === 'month' ? 'Next month' : 'Next week'}
              className="p-1.5 text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] rounded-r-lg">
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="text-right pr-2 border-r border-[#1A2130]" title="Dials today">
            <p className="text-[9px] text-[#5A6A7A] font-mono uppercase tracking-wider">Dials</p>
            <p className="text-sm font-bold flex items-center justify-end gap-1 leading-tight"
              style={{ color: dialsToday > 0 ? '#00E5C3' : '#5A6A7A' }}>
              <Phone size={10} /> {dialsToday}
            </p>
          </div>
          <button onClick={() => { setAddSeed(null); setEditing(null); setShowAdd(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-black"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Plus size={12} /> Add reminder
          </button>
        </div>
      </div>

      {/* Body — calendar on the left, overdue/stale rail on the right */}
      <div className="flex-1 flex overflow-hidden">
        {view === 'month' ? (
          <MonthCalendar
            anchor={anchor}
            reminders={activeReminders}
            gcalEvents={gcalEvents}
            leadById={leadById}
            onSlotClick={(day) => seedFromSlot(day)}
            onReminderClick={editReminder}
            onDropOnDay={dropReminderOnDay}
            onCompleteReminder={completeReminder}
            onDeleteReminder={deleteReminder}
          />
        ) : (
          <WeekCalendar
            anchor={anchor}
            reminders={activeReminders}
            gcalEvents={gcalEvents}
            leadById={leadById}
            onSlotClick={seedFromSlot}
            onReminderClick={editReminder}
            onDropOnDay={dropReminderOnDay}
            onCompleteReminder={completeReminder}
            onDeleteReminder={deleteReminder}
          />
        )}

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
        <ReminderModal
          leads={safeLeads}
          seed={addSeed}
          editing={editing}
          onClose={() => { setShowAdd(false); setAddSeed(null); setEditing(null) }}
          onSubmit={async (data) => {
            if (editing) await updateReminder(editing.id, data)
            else await addReminder(data)
            setShowAdd(false); setAddSeed(null); setEditing(null)
          }}
          onDelete={editing ? async () => {
            if (!confirm('Delete this reminder?')) return
            await deleteReminder(editing.id)
            setShowAdd(false); setAddSeed(null); setEditing(null)
          } : null}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Month view — 5 or 6 weeks of day cells. Each cell shows up to 4 reminder
// pills; overflow gets a "+N more" line. Click empty area → add at 9 AM.
// Drag a pill to another day → reschedule. Multi-day appointments span cells.
// ─────────────────────────────────────────────────────────────────────────────
function MonthCalendar({ anchor, reminders, gcalEvents = [], leadById, onSlotClick, onReminderClick, onDropOnDay, onCompleteReminder, onDeleteReminder }) {
  const monthStart = startOfMonth(anchor)
  const monthEnd   = endOfMonth(anchor)
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 0 })
  const gridEnd    = endOfWeek(monthEnd, { weekStartsOn: 0 })
  const totalDays  = Math.round((gridEnd - gridStart) / (24 * 60 * 60 * 1000)) + 1
  const days       = useMemo(() => Array.from({ length: totalDays }, (_, i) => addDays(gridStart, i)), [gridStart, totalDays])
  const today = new Date()

  // Which day is currently being hovered as a drop target?
  const [dragOverKey, setDragOverKey] = useState(null)

  // Bucket reminders by every day they touch (multi-day appointments show up
  // in every intermediate day cell).
  const remindersByDay = useMemo(() => {
    const m = new Map(days.map(d => [d.toDateString(), []]))
    for (const r of reminders) {
      if (!r.due_at) continue
      const start = new Date(r.due_at)
      const end = r.end_at ? new Date(r.end_at) : start
      if (isNaN(start.getTime())) continue
      // Snap to whole-day range so a 9-11am event just occupies its start day
      const rangeStart = startOfDay(start)
      const rangeEnd   = endOfDay(end)
      for (const d of days) {
        if (d >= rangeStart && d <= rangeEnd) {
          const arr = m.get(d.toDateString())
          if (arr) arr.push(r)
        }
      }
    }
    // Sort each day's list by due_at ascending
    for (const arr of m.values()) arr.sort((a, b) => new Date(a.due_at || 0) - new Date(b.due_at || 0))
    return m
  }, [reminders, days])

  // Bucket Google Calendar events the same way. Kept separate so cell UI can
  // render them with distinct styling (blue chip, "G" tag, external-link icon)
  // and skip the drag handlers — gcal events are read-only in Infinite.
  const gcalByDay = useMemo(() => {
    const m = new Map(days.map(d => [d.toDateString(), []]))
    for (const e of gcalEvents) {
      const start = new Date(e.startAt)
      const end   = new Date(e.endAt || e.startAt)
      if (isNaN(start.getTime())) continue
      const rangeStart = startOfDay(start)
      const rangeEnd   = endOfDay(isNaN(end.getTime()) ? start : end)
      for (const d of days) {
        if (d >= rangeStart && d <= rangeEnd) {
          const arr = m.get(d.toDateString())
          if (arr) arr.push(e)
        }
      }
    }
    for (const arr of m.values()) arr.sort((a, b) => new Date(a.startAt || 0) - new Date(b.startAt || 0))
    return m
  }, [gcalEvents, days])

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#080B0F' }}>
      {/* Day-name header */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', background: '#0E1318', borderBottom: '1px solid #1A2130' }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="py-2 text-center text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] border-r border-[#1A2130] last:border-r-0">
            {d}
          </div>
        ))}
      </div>
      {/* Grid — each row is one week, autofit remaining space */}
      <div className="flex-1 grid overflow-y-auto"
        style={{
          gridTemplateColumns: 'repeat(7, 1fr)',
          gridAutoRows: 'minmax(90px, 1fr)',
        }}>
        {days.map(day => {
          const key = day.toDateString()
          const items = remindersByDay.get(key) || []
          const gEvents = gcalByDay.get(key) || []
          const inMonth = day.getMonth() === anchor.getMonth()
          const isNow = isSameDay(day, today)
          const dragOver = dragOverKey === key
          // Cap total chips at 4; split budget favoring reminders since those
          // are the primary CRM data. GCal events fill any remaining slots.
          const maxChips = 4
          const reminderSlots = Math.min(items.length, Math.max(2, maxChips - Math.min(gEvents.length, 2)))
          const gcalSlots = Math.max(0, maxChips - reminderSlots)
          const hiddenCount = Math.max(0, (items.length - reminderSlots) + (gEvents.length - Math.min(gEvents.length, gcalSlots)))
          return (
            <div key={key}
              onDragOver={(e) => { e.preventDefault(); if (dragOverKey !== key) setDragOverKey(key) }}
              onDragLeave={() => { if (dragOverKey === key) setDragOverKey(null) }}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/reminder-id')
                if (id) onDropOnDay(id, day)
                setDragOverKey(null)
              }}
              onClick={(e) => { if (e.target === e.currentTarget) onSlotClick(day) }}
              className="border-r border-b border-[#1A2130] p-1 cursor-pointer relative flex flex-col gap-0.5 overflow-hidden"
              style={{
                background: dragOver ? '#00E5C315' : (isNow ? '#00E5C308' : (inMonth ? 'transparent' : '#050709')),
                minHeight: 90,
              }}>
              <div className="flex items-center justify-between flex-shrink-0 px-1"
                onClick={(e) => { e.stopPropagation(); onSlotClick(day) }}>
                <span className={`text-xs font-mono ${isNow ? 'text-[#00E5C3] font-bold' : (inMonth ? 'text-white' : 'text-[#3A4A5A]')}`}>
                  {day.getDate()}
                </span>
                {isNow && <span className="text-[8px] font-mono uppercase text-[#00E5C3]">Today</span>}
              </div>
              <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
                {items.slice(0, reminderSlots).map(r => {
                  const lead = leadById.get(r.lead_id)
                  const meta = KIND_META[r.kind] || KIND_META.call
                  const overdue = r.due_at && isPast(new Date(r.due_at))
                  const timeLabel = r.due_at ? format(new Date(r.due_at), 'h:mma').toLowerCase() : ''
                  return (
                    <div key={r.id}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/reminder-id', r.id); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={(e) => { e.stopPropagation(); onReminderClick(r) }}
                      title={`${timeLabel} · ${leadName(lead)} · ${r.note || ''}`}
                      className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] cursor-grab active:cursor-grabbing truncate hover:brightness-125"
                      style={{
                        background: (overdue ? '#EF4444' : meta.color) + '25',
                        borderLeft: `2px solid ${overdue ? '#EF4444' : meta.color}`,
                      }}>
                      {timeLabel && <span className="text-[9px] font-mono flex-shrink-0" style={{ color: overdue ? '#EF4444' : meta.color }}>{timeLabel}</span>}
                      <span className="text-white truncate">{leadName(lead)}</span>
                    </div>
                  )
                })}
                {/* Google Calendar chips — read-only, blue-tinted, open the
                    event in Google Calendar on click. Distinct from CRM
                    reminders by the "G" tag and left border color. */}
                {gEvents.slice(0, gcalSlots).map(e => {
                  const timeLabel = e.allDay ? '' : format(new Date(e.startAt), 'h:mma').toLowerCase()
                  return (
                    <a key={e.id}
                      href={e.htmlLink || '#'} target="_blank" rel="noopener noreferrer"
                      onClick={(ev) => ev.stopPropagation()}
                      title={`${e.allDay ? 'All-day' : timeLabel} · ${e.summary}${e.location ? ' @ ' + e.location : ''} (Google Calendar)`}
                      className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] truncate hover:brightness-125"
                      style={{
                        background: '#4285F420',
                        borderLeft: '2px solid #4285F4',
                      }}>
                      <span className="text-[8px] font-mono flex-shrink-0 px-1 rounded" style={{ background: '#4285F430', color: '#8AB4F8' }}>G</span>
                      {timeLabel && <span className="text-[9px] font-mono flex-shrink-0 text-[#8AB4F8]">{timeLabel}</span>}
                      <span className="text-white truncate">{e.summary}</span>
                    </a>
                  )
                })}
                {hiddenCount > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onSlotClick(day) }}
                    className="text-[9px] text-[#5A6A7A] hover:text-white text-left px-1">
                    +{hiddenCount} more
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Week view — kept from before, with drag-drop and now-line.
// ─────────────────────────────────────────────────────────────────────────────
function WeekCalendar({ anchor, reminders, gcalEvents = [], leadById, onSlotClick, onReminderClick, onDropOnDay, onCompleteReminder, onDeleteReminder }) {
  const weekStart = useMemo(() => startOfWeek(anchor, { weekStartsOn: 0 }), [anchor])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const scrollRef = useRef(null)
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 2 * CAL_HOUR_PX - 12 }, [])
  const [nowTs, setNowTs] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNowTs(Date.now()), 60 * 1000); return () => clearInterval(t) }, [])
  const now = new Date(nowTs)
  const nowTop = (differenceInMinutes(now, startOfDay(now)) / 60 - CAL_START_HOUR) * CAL_HOUR_PX
  const [dragOverKey, setDragOverKey] = useState(null)

  const byDay = useMemo(() => {
    const m = new Map(days.map(d => [d.toDateString(), []]))
    for (const r of reminders) {
      if (!r.due_at) continue
      const d = new Date(r.due_at)
      const key = startOfDay(d).toDateString()
      if (m.has(key)) m.get(key).push(r)
    }
    return m
  }, [reminders, days])

  // Google Calendar events bucketed by day. Timed events get a block on the
  // hour timeline; all-day events show as a strip at the top of the column.
  const gcalByDay = useMemo(() => {
    const m = new Map(days.map(d => [d.toDateString(), { timed: [], allDay: [] }]))
    for (const e of gcalEvents) {
      const start = new Date(e.startAt)
      if (isNaN(start.getTime())) continue
      const key = startOfDay(start).toDateString()
      const bucket = m.get(key)
      if (!bucket) continue
      if (e.allDay) bucket.allDay.push(e)
      else bucket.timed.push(e)
    }
    return m
  }, [gcalEvents, days])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ background: '#080B0F' }}>
      <div className="sticky top-0 z-20 grid" style={{
        gridTemplateColumns: '52px repeat(7, 1fr)', background: '#0E1318', borderBottom: '1px solid #1A2130',
      }}>
        <div className="border-r border-[#1A2130]" />
        {days.map((d, i) => {
          const isNow = isSameDay(d, now)
          return (
            <div key={i} className="py-2 text-center border-r border-[#1A2130]"
              style={{ background: isNow ? '#00E5C308' : 'transparent' }}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">{format(d, 'EEE')}</p>
              <p className={`text-base font-bold mt-0.5 ${isNow ? 'text-[#00E5C3]' : 'text-white'}`}>{format(d, 'd')}</p>
            </div>
          )
        })}
      </div>
      <div className="relative grid" style={{
        gridTemplateColumns: '52px repeat(7, 1fr)', height: CAL_HOURS * CAL_HOUR_PX,
      }}>
        <div className="relative border-r border-[#1A2130]">
          {Array.from({ length: CAL_HOURS }).map((_, i) => {
            const hour = CAL_START_HOUR + i
            const label = hour === 12 ? '12 PM' : hour === 0 ? '12 AM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`
            return (
              <div key={i} className="border-b border-[#1A2130] text-[9px] font-mono text-[#3A4A5A] text-right pr-1.5 pt-0.5"
                style={{ height: CAL_HOUR_PX }}>{label}</div>
            )
          })}
        </div>
        {days.map((day, dayIdx) => {
          const key = day.toDateString()
          const items = byDay.get(key) || []
          const isNow = isSameDay(day, now)
          const dragOver = dragOverKey === key
          return (
            <div key={dayIdx} className="relative border-r border-[#1A2130]"
              onDragOver={(e) => { e.preventDefault(); if (dragOverKey !== key) setDragOverKey(key) }}
              onDragLeave={() => { if (dragOverKey === key) setDragOverKey(null) }}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/reminder-id')
                if (id) onDropOnDay(id, day)
                setDragOverKey(null)
              }}
              style={{ background: dragOver ? '#00E5C315' : (isNow ? '#00E5C304' : 'transparent') }}>
              {Array.from({ length: CAL_HOURS }).map((_, i) => {
                const hour = CAL_START_HOUR + i
                return (
                  <button key={i} onClick={() => onSlotClick(day, hour)}
                    className="w-full block border-b border-[#1A2130] hover:bg-[#00E5C308] transition-colors cursor-pointer"
                    style={{ height: CAL_HOUR_PX }}
                    title={`+ Add reminder at ${hour}:00`} />
                )
              })}
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
                  <div key={r.id}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/reminder-id', r.id); e.dataTransfer.effectAllowed = 'move' }}
                    onClick={(e) => { e.stopPropagation(); onReminderClick(r) }}
                    className="absolute left-1 right-1 rounded-md border overflow-hidden text-left px-1.5 py-1 transition-transform hover:scale-[1.02] group cursor-grab active:cursor-grabbing"
                    style={{
                      top: pos.top, height: pos.height,
                      background: meta.color + '20',
                      borderColor: border + '60',
                      borderLeft: `3px solid ${border}`,
                    }}
                    title={`${format(new Date(r.due_at), 'h:mm a')} · ${leadName(lead)} · ${r.note || ''}`}>
                    <div className="flex items-center gap-1 min-w-0">
                      <Icon size={9} style={{ color: meta.color }} className="flex-shrink-0" />
                      <span className="text-[10px] font-semibold truncate text-white">{leadName(lead)}</span>
                    </div>
                    {r.note && pos.height > 24 && (<p className="text-[9px] text-[#C0D0E0] truncate leading-tight">{r.note}</p>)}
                    <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 p-0.5"
                      onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => onCompleteReminder(r.id)}
                        className="w-4 h-4 rounded flex items-center justify-center hover:bg-[#10B98130]" title="Mark done">
                        <Check size={9} className="text-[#10B981]" />
                      </button>
                      <button onClick={() => { if (confirm('Delete this reminder?')) onDeleteReminder(r.id) }}
                        className="w-4 h-4 rounded flex items-center justify-center hover:bg-[#EF444430]" title="Delete">
                        <X size={9} className="text-[#EF4444]" />
                      </button>
                    </div>
                  </div>
                )
              })}
              {/* Google Calendar timed events — read-only blocks. Position
                  using the same eventPosition helper so they align on the
                  hour grid. Blue color matches Google's brand + differentiates
                  from CRM reminders. Clicking opens the event in a new tab. */}
              {(gcalByDay.get(key)?.timed || []).map(e => {
                const start = new Date(e.startAt)
                const end = e.endAt ? new Date(e.endAt) : new Date(start.getTime() + 30 * 60 * 1000)
                if (isNaN(start.getTime())) return null
                const dayStart = startOfDay(start)
                const minsFromCalStart = differenceInMinutes(start, dayStart) - CAL_START_HOUR * 60
                const durMin = Math.max(15, differenceInMinutes(end, start))
                const top = (minsFromCalStart / 60) * CAL_HOUR_PX
                const height = Math.max(20, (durMin / 60) * CAL_HOUR_PX - 2)
                if (top < 0 || top >= CAL_HOURS * CAL_HOUR_PX) return null
                return (
                  <a key={e.id}
                    href={e.htmlLink || '#'} target="_blank" rel="noopener noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    className="absolute left-1 right-1 rounded-md border overflow-hidden text-left px-1.5 py-1 hover:brightness-125"
                    style={{
                      top, height,
                      background: '#4285F420',
                      borderColor: '#4285F460',
                      borderLeft: '3px solid #4285F4',
                    }}
                    title={`${format(start, 'h:mm a')} · ${e.summary}${e.location ? ' @ ' + e.location : ''} (Google Calendar)`}>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-[8px] font-mono flex-shrink-0 px-1 rounded" style={{ background: '#4285F430', color: '#8AB4F8' }}>G</span>
                      <span className="text-[10px] font-semibold truncate text-white">{e.summary}</span>
                    </div>
                    {height > 24 && e.location && (
                      <p className="text-[9px] text-[#8AB4F8] truncate leading-tight">{e.location}</p>
                    )}
                  </a>
                )
              })}
              {isNow && nowTop >= 0 && nowTop < CAL_HOURS * CAL_HOUR_PX && (
                <div className="absolute left-0 right-0 pointer-events-none z-10" style={{ top: nowTop }}>
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
// Side rail — overdue + stale leads. Can be collapsed to a thin strip so the
// calendar gets the full width when the agent wants more room. Collapsed state
// persists in localStorage so the preference sticks across page loads.
// ─────────────────────────────────────────────────────────────────────────────
function SideRail({ overdue, staleNudges, leadById, onNavigate, onCompleteReminder, onSnoozeReminder, onDeleteReminder, logDialFor }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('today:railCollapsed') === '1' } catch { return false }
  })
  const toggle = () => {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem('today:railCollapsed', next ? '1' : '0') } catch {}
      return next
    })
  }

  // Collapsed state — thin strip with just an expand button and count dots.
  // Keeps counts visible so the agent knows what's waiting even when hidden.
  if (collapsed) {
    return (
      <aside className="w-8 flex-shrink-0 border-l border-[#1A2130] flex flex-col items-center py-3 gap-3"
        style={{ background: '#0A0E14' }}>
        <button onClick={toggle}
          title="Expand overdue / stale leads panel"
          className="p-1.5 rounded-md text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] transition-colors">
          <ChevronLeft size={14} />
        </button>
        <div className="w-px flex-1 bg-[#1A2130]" />
        {overdue.length > 0 && (
          <button onClick={toggle}
            title={`${overdue.length} overdue — click to expand`}
            className="flex flex-col items-center gap-0.5 hover:scale-110 transition-transform">
            <AlertTriangle size={12} className="text-[#EF4444]" />
            <span className="text-[9px] font-mono font-bold text-[#EF4444]">{overdue.length}</span>
          </button>
        )}
        {staleNudges.length > 0 && (
          <button onClick={toggle}
            title={`${staleNudges.length} stale leads — click to expand`}
            className="flex flex-col items-center gap-0.5 hover:scale-110 transition-transform">
            <Clock size={12} className="text-[#A78BFA]" />
            <span className="text-[9px] font-mono font-bold text-[#A78BFA]">{staleNudges.length}</span>
          </button>
        )}
        {overdue.length === 0 && staleNudges.length === 0 && (
          <div title="Nothing overdue" className="p-0.5">
            <Check size={12} className="text-[#10B981]" />
          </div>
        )}
      </aside>
    )
  }

  return (
    <aside className="w-80 flex-shrink-0 border-l border-[#1A2130] overflow-y-auto" style={{ background: '#0A0E14' }}>
      <div className="p-3 space-y-4">
        {/* Collapse handle — top-right so the agent can shrink the rail
            without hunting for the button. Mirrors the collapsed-state expand
            button (ChevronRight → hide, ChevronLeft → show). */}
        <div className="flex items-center justify-end -mb-2">
          <button onClick={toggle}
            title="Minimize panel to give the calendar more room"
            className="p-1 rounded-md text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] transition-colors">
            <ChevronRight size={13} />
          </button>
        </div>
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
                <ReminderRow key={r.id} reminder={r} lead={leadById.get(r.lead_id)}
                  onComplete={onCompleteReminder} onSnooze={onSnoozeReminder} onDelete={onDeleteReminder}
                  onNavigate={onNavigate} logDialFor={logDialFor} />
              ))}
            </div>
          )}
        </section>
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
                  <div key={n.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-[#1A2130]" style={{ background: '#080B0F' }}>
                    <button onClick={() => onNavigate(lead.id)} className="flex-1 text-left min-w-0">
                      <p className="text-[11px] text-white truncate">{leadName(lead)}</p>
                      <p className="text-[9px] text-[#5A6A7A] font-mono truncate">{n.note}</p>
                    </button>
                    {lead.phone && (
                      <a href={`tel:${lead.phone}`} onClick={() => logDialFor(lead)}
                        className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-black flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>Call</a>
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
            You're all caught up.<br/>Click a day to add a reminder.
          </p>
        )}
      </div>
    </aside>
  )
}

function ReminderRow({ reminder, lead, onComplete, onSnooze, onDelete, onNavigate, logDialFor }) {
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
            className="text-[11px] font-medium text-white hover:text-[#00E5C3] truncate flex-1 text-left">{leadName(lead)}</button>
        ) : (
          <span className="text-[11px] text-[#5A6A7A] italic flex-1">(no lead)</span>
        )}
        <span className="text-[9px] font-mono flex-shrink-0" style={{ color: overdue ? '#EF4444' : '#5A6A7A' }}>{dueLabel}</span>
      </div>
      {reminder.note && <p className="text-[10px] text-[#8899AA] truncate mb-1.5">{reminder.note}</p>}
      <div className="flex items-center gap-1">
        {lead?.phone && (
          <a href={`tel:${lead.phone}`} onClick={() => logDialFor && logDialFor(lead)}
            className="flex-1 text-center py-0.5 rounded text-[9px] font-semibold text-black"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>Call</a>
        )}
        <button onClick={() => onComplete(reminder.id)}
          className="p-0.5 rounded text-[#10B981] hover:bg-[#10B98120]" title="Done"><Check size={11} /></button>
        <div className="relative">
          <button onClick={() => setSnoozeOpen(v => !v)}
            className="p-0.5 rounded text-[#5A6A7A] hover:text-white" title="Snooze"><Clock size={11} /></button>
          {snoozeOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 rounded-lg border border-[#1A2130] overflow-hidden shadow-xl min-w-[120px]" style={{ background: '#0A0E14' }}>
              <button onClick={() => snoozeBy(15)} className="block w-full text-left px-2 py-1 text-[10px] text-[#8899AA] hover:bg-[#1A2130]">+ 15 min</button>
              <button onClick={() => snoozeBy(60)} className="block w-full text-left px-2 py-1 text-[10px] text-[#8899AA] hover:bg-[#1A2130]">+ 1 hour</button>
              <button onClick={() => snoozeBy(180)} className="block w-full text-left px-2 py-1 text-[10px] text-[#8899AA] hover:bg-[#1A2130]">+ 3 hours</button>
              <button onClick={() => snoozeBy(d => addDays(d, 1))} className="block w-full text-left px-2 py-1 text-[10px] text-[#8899AA] hover:bg-[#1A2130]">+ 1 day</button>
              <button onClick={() => snoozeBy(d => addDays(d, 7))} className="block w-full text-left px-2 py-1 text-[10px] text-[#8899AA] hover:bg-[#1A2130]">+ 1 week</button>
            </div>
          )}
        </div>
        <button onClick={() => { if (confirm('Delete this reminder?')) onDelete(reminder.id) }}
          className="p-0.5 rounded text-[#3A4A5A] hover:text-[#EF4444]" title="Delete"><Trash2 size={10} /></button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Add / Edit reminder modal
// ─────────────────────────────────────────────────────────────────────────────
function ReminderModal({ leads, seed, editing, onClose, onSubmit, onDelete }) {
  const [kind, setKind] = useState(seed?.kind || 'call')
  const [leadId, setLeadId] = useState(seed?.lead_id || '')
  const [leadSearch, setLeadSearch] = useState('')
  const [due, setDue] = useState(seed?.due_at || defaultTomorrow9am())
  const [end, setEnd] = useState(seed?.end_at || '')
  const [multi, setMulti] = useState(!!seed?.end_at)
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
      const payload = {
        lead_id: leadId || null,
        kind,
        due_at: localInputToIso(due),
        note: note.trim() || null,
      }
      if (multi && end) payload.end_at = localInputToIso(end)
      else payload.end_at = null
      await onSubmit(payload)
    } finally { setSaving(false) }
  }
  const selectedLead = leads.find(l => l.id === leadId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]">
          <h3 className="text-base font-semibold text-white">{editing ? 'Edit reminder' : 'Add reminder'}</h3>
          <button onClick={onClose} className="text-[#5A6A7A] hover:text-white"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] block mb-2">Kind</label>
            <div className="flex gap-2">
              {Object.entries(KIND_META).map(([k, m]) => (
                <button type="button" key={k} onClick={() => setKind(k)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors"
                  style={kind === k ? { background: m.color + '15', color: m.color, borderColor: m.color + '60' } : { color: '#5A6A7A', borderColor: '#1A2130' }}>
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
                <button type="button" onClick={() => { setLeadId(''); setLeadSearch('') }} className="text-[#5A6A7A] hover:text-white"><X size={13} /></button>
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A]">
                {multi ? 'Starts' : 'When'}
              </label>
              <label className="flex items-center gap-1.5 text-[10px] text-[#5A6A7A] cursor-pointer">
                <input type="checkbox" checked={multi} onChange={e => setMulti(e.target.checked)} className="accent-[#00E5C3]" />
                Multi-day / spans time
              </label>
            </div>
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
          {multi && (
            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">Ends</label>
              <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)}
                className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
            </div>
          )}
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
              {saving ? 'Saving…' : (editing ? 'Save changes' : 'Add reminder')}
            </button>
            {editing && onDelete && (
              <button type="button" onClick={onDelete}
                className="px-3 py-2.5 rounded-lg text-sm border border-[#EF444440] text-[#EF4444] hover:bg-[#EF444415]"
                title="Delete this reminder">
                <Trash2 size={13} />
              </button>
            )}
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
