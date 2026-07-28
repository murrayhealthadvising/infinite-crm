import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Thermometer, Search, X, Phone, Send, User, Clock,
  ChevronDown, ChevronLeft, ChevronRight,
  AlertCircle, CheckCircle, Loader, Copy, Check, MapPin, ExternalLink,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { displayPhone } from '../lib/phone'
import { timezoneFor, tzLabelFor, localTimeFor } from '../lib/timezone'
import { format, formatDistanceToNow } from 'date-fns'

// Warm Bucket — one contact at a time, everything you need to make the call.
// Left rail: minimized list to skip/next between contacts.
// Center: full conversation, existing lead context, notes, actions.

const WORKER_URL = (import.meta.env.VITE_CRM_WORKER_URL
  || 'https://infinite-crm-webhook.murrayhealthadvising.workers.dev').replace(/\/+$/, '')

function fullName(c) {
  return [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || '(no name)'
}

// Chat bubble — larger + spacious for the focus view.
// STRICT direction check — matches the worker's classifier so what you see
// here is what the warm-bucket filter used to include this contact.
function MessageBubble({ msg, spacious = false }) {
  const isOut = msg?.direction === 'outbound'
  const time = msg?.sent_at
    ? format(new Date(msg.sent_at), 'MMM d h:mma').toLowerCase()
    : ''
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`${spacious ? 'max-w-[75%] px-3 py-2' : 'max-w-[85%] px-2.5 py-1.5'} rounded-lg border`}
        style={{
          background: isOut ? '#3B82F615' : '#0E1318',
          borderColor: isOut ? '#3B82F640' : '#1A2130',
        }}>
        <p className={`text-[#E8EDF5] leading-snug whitespace-pre-wrap break-words ${spacious ? 'text-sm' : 'text-xs'}`}>
          {msg?.body || '(empty)'}
        </p>
        <p className={`${spacious ? 'text-[10px]' : 'text-[9px]'} text-[#5A6A7A] font-mono mt-1 ${isOut ? 'text-right' : ''}`}>
          {isOut ? 'you' : 'them'} · {time}
        </p>
      </div>
    </div>
  )
}

function StagePicker({ stages, onPick, onCancel, anchor = 'right' }) {
  const ref = useRef(null)
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) onCancel() }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onCancel])
  return (
    <div ref={ref}
      className={`absolute ${anchor === 'right' ? 'right-0' : 'left-0'} top-full mt-1 w-52 rounded-xl border border-[#1A2130] overflow-hidden z-30 shadow-2xl max-h-72 overflow-y-auto`}
      style={{ background: '#0E1318' }}>
      <div className="px-3 py-2 border-b border-[#1A2130]">
        <p className="text-[10px] font-mono uppercase tracking-wider text-[#00E5C3]">Set stage → add to CRM</p>
      </div>
      {stages.map(t => (
        <button key={t.id} onClick={() => onPick(t.id)}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#1A2130] transition-colors text-left"
          style={{ color: t.color }}>
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.color }} />
          <span className="truncate">{t.label}</span>
        </button>
      ))}
    </div>
  )
}

export default function WarmBucket() {
  const { user, tags, leads, addLead } = useApp()
  const navigate = useNavigate()

  const [hours, setHours] = useState(24)
  const [scanning, setScanning] = useState(false)
  const [matches, setMatches] = useState([])
  const [queueEntries, setQueueEntries] = useState([])  // pushed via public API by Kam
  const [scanNote, setScanNote] = useState(null)
  const [error, setError] = useState(null)
  const [dismissed, setDismissed] = useState(() => new Set())
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [notes, setNotes] = useState({})
  const [notesDirty, setNotesDirty] = useState({})
  const [savingNote, setSavingNote] = useState({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [promoting, setPromoting] = useState(null)
  const [msg, setMsg] = useState(null)
  const [copiedField, setCopiedField] = useState('')

  const safeTags = Array.isArray(tags) && tags.length ? tags : [
    { id: 'interested', label: 'Interested', color: '#3B82F6' },
    { id: 'apt', label: 'Appointment', color: '#F59E0B' },
  ]
  const safeLeads = Array.isArray(leads) ? leads : []

  // Load persistent notes AND the manual queue (entries Kam pushed via API).
  // Queue entries render as bucket contacts too, sitting alongside the PP
  // scan results in the left rail — higher priority first.
  const loadState = useCallback(async () => {
    if (!user?.id) return
    const [notesRes, queueRes] = await Promise.all([
      supabase.from('warm_bucket_notes').select('pp_contact_uuid, note').eq('user_id', user.id),
      supabase.from('warm_bucket_queue').select('*').eq('user_id', user.id).eq('status', 'pending').order('priority', { ascending: false }).order('created_at', { ascending: false }),
    ])
    const nm = {}
    for (const r of (notesRes.data || [])) nm[r.pp_contact_uuid] = r.note || ''
    setNotes(nm)
    setQueueEntries(Array.isArray(queueRes.data) ? queueRes.data : [])
  }, [user?.id])
  useEffect(() => { loadState() }, [loadState])

  // Record where LeadDetail's X should return to when opening a lead from
  // the Warm Bucket (via the In-CRM badge). Same pattern as Leads/Pipeline.
  useEffect(() => {
    try { sessionStorage.setItem('leads:returnTo', '/warm-bucket') } catch {}
  }, [])

  const runScan = async () => {
    if (!user?.id) return
    setScanning(true); setError(null); setScanNote(null)
    try {
      const url = `${WORKER_URL}/warm-bucket/scan?agent_id=${encodeURIComponent(user.id)}&hours=${hours}`
      const r = await fetch(url)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(j?.error || `HTTP ${r.status}`)
        setMatches([])
      } else {
        setMatches(Array.isArray(j.matches) ? j.matches : [])
        setSelectedIdx(0)
        setDismissed(new Set())
        if (j.note) setScanNote(j.note)
        // Diagnostic surface when the scan returns empty. Shows the skip-
        // reason breakdown so we can see exactly WHY nothing landed in the
        // bucket (never was warm, still within the 2h grace, tag not
        // returning contacts, etc.).
        else if (j.debug && (!j.matches || j.matches.length === 0)) {
          const c = j.debug.skip_counts || {}
          const parts = []
          if (c.no_msgs) parts.push(`${c.no_msgs} had no PP messages`)
          if (c.out_of_window) parts.push(`${c.out_of_window} last activity outside your ${hours}h window`)
          if (c.newest_not_out) parts.push(`${c.newest_not_out} newest message wasn't outbound (they replied last)`)
          if (c.still_within_grace) parts.push(`${c.still_within_grace} still within the 2h silent grace`)
          if (c.no_inbound) parts.push(`${c.no_inbound} never replied at least once (cold drip)`)
          if (c.bad_ts) parts.push(`${c.bad_ts} messages had no timestamp`)
          const summary = parts.length
            ? `Found ${j.debug.contacts_found_by_tag} Positive-tagged contacts. Scanned ${j.debug.scanned}. Reasons none matched: ${parts.join(' · ')}.`
            : `Found ${j.debug.contacts_found_by_tag} Positive-tagged contacts but scanned 0.`
          setScanNote(summary)
        }
      }
    } catch (e) {
      setError(String(e?.message || e))
    }
    setScanning(false)
  }

  // Unified visible list — PP scan matches + queue entries pushed via API.
  // Queue entries first (they're explicitly high-priority via Kam), then PP
  // scan results ordered as returned by the scan.
  const visible = useMemo(() => {
    const q = (queueEntries || []).map(e => ({
      _kind: 'queue',
      _key: `q:${e.id}`,
      pp_contact_uuid: e.phone,  // used as identifier in dismissed set
      queue_id: e.id,
      first_name: e.first_name,
      last_name: e.last_name,
      phone: e.phone,
      email: e.email,
      state: e.state,
      zip: e.zip,
      priority: e.priority,
      reason: e.reason,
      queued_note: e.note,
      source_label: `Pushed via API${e.external_id ? ` · ext:${e.external_id.slice(0, 8)}` : ''}`,
      last_outbound_at: e.created_at,
      recent_messages: [],  // no PP messages for queue-pushed contacts unless we look them up
    }))
    const pp = (matches || []).map(m => ({ _kind: 'pp', _key: `p:${m.pp_contact_uuid}`, ...m }))
    return [...q, ...pp].filter(x => !dismissed.has(x.pp_contact_uuid))
  }, [matches, queueEntries, dismissed])

  // Keep selectedIdx in bounds when visible list shrinks
  useEffect(() => {
    if (selectedIdx >= visible.length && visible.length > 0) setSelectedIdx(0)
  }, [visible.length, selectedIdx])

  const current = visible[selectedIdx] || null

  // Look up any existing lead for the current contact by phone. Gives the
  // focus view lead-context (state, income, DOB, etc.) if they were previously
  // imported. Falls back to warm-bucket-only display when nothing matches.
  const existingLead = useMemo(() => {
    if (!current?.phone) return null
    const digits = String(current.phone).replace(/\D/g, '')
    return safeLeads.find(l => {
      const lp = String(l.phone || '').replace(/\D/g, '')
      return lp && (lp === digits || lp.endsWith(digits.slice(-10)))
    }) || null
  }, [current?.phone, safeLeads])

  // Save note (debounced-ish via blur + explicit save)
  const saveNote = useCallback(async (uuid) => {
    if (!user?.id || !uuid) return
    setSavingNote(prev => ({ ...prev, [uuid]: true }))
    try {
      const text = notes[uuid] || ''
      await supabase.from('warm_bucket_notes')
        .upsert({ user_id: user.id, pp_contact_uuid: uuid, note: text }, { onConflict: 'user_id,pp_contact_uuid' })
      setNotesDirty(prev => ({ ...prev, [uuid]: false }))
    } catch (e) { console.error('save note failed:', e) }
    setSavingNote(prev => ({ ...prev, [uuid]: false }))
  }, [notes, user?.id])

  const dismiss = async (item) => {
    // `item` can be the string uuid (backward-compat) or the visible entry.
    const entry = typeof item === 'string' ? visible.find(x => x.pp_contact_uuid === item) : item
    const key = entry?.pp_contact_uuid || item
    setDismissed(prev => { const n = new Set(prev); n.add(key); return n })
    // For queue-pushed entries, persist the dismissal so a page reload doesn't
    // resurrect it. PP scan matches stay session-only (re-scan brings them back).
    if (entry?._kind === 'queue' && entry.queue_id) {
      try {
        await supabase.from('warm_bucket_queue')
          .update({ status: 'dismissed' })
          .eq('id', entry.queue_id)
      } catch (e) { console.error('dismiss queue entry failed:', e) }
    }
    setSelectedIdx(i => Math.max(0, i))
  }

  const promote = async (stageId) => {
    if (!current || !user?.id || typeof addLead !== 'function') return
    setPromoting(current.pp_contact_uuid)
    setPickerOpen(false)
    try {
      const note = notes[current.pp_contact_uuid] || ''
      const messagesRecap = (current.recent_messages || []).map(m => {
        const dir = /out/.test(m.direction || '') && !/in/.test(m.direction || '') ? '→' : '←'
        const t = m.sent_at ? format(new Date(m.sent_at), 'MMM d h:mma').toLowerCase() : ''
        return `${dir} ${t}: ${(m.body || '').slice(0, 240)}`
      }).join('\n')
      const combinedNote = [
        note.trim(),
        note.trim() && messagesRecap ? '\n─── from PitchPrfct ───' : '',
        messagesRecap,
      ].filter(Boolean).join('\n')

      const newLead = await addLead({
        first_name: current.first_name || '',
        last_name: current.last_name || '',
        phone: current.phone,
        source: 'warm-bucket',
        campaign: 'Warm Bucket (positive from PP)',
        stage: stageId,
        stage_changed_at: new Date().toISOString(),
        notes: combinedNote,
        pp_response_status: 'responded',
      })
      try {
        await supabase.from('warm_bucket_notes').delete()
          .eq('user_id', user.id).eq('pp_contact_uuid', current.pp_contact_uuid)
      } catch {}
      // Queue entries get marked 'contacted' so they don't come back either.
      if (current._kind === 'queue' && current.queue_id) {
        try {
          await supabase.from('warm_bucket_queue')
            .update({ status: 'contacted' })
            .eq('id', current.queue_id)
        } catch (e) { console.error('mark queue entry contacted failed:', e) }
      }
      dismiss(current)
      const label = safeTags.find(t => t.id === stageId)?.label || stageId
      setMsg({ type: 'success', text: `${fullName(current)} → ${label}`, leadId: newLead?.id })
      setTimeout(() => setMsg(null), 6000)
    } catch (e) {
      console.error('promote failed:', e)
      setMsg({ type: 'error', text: 'Could not add to CRM: ' + (e?.message || String(e)) })
      setTimeout(() => setMsg(null), 6000)
    }
    setPromoting(null)
  }

  // Keyboard: j/k = next/prev, ↓/↑, x = dismiss, c = call, m = focus note, / = new scan
  useEffect(() => {
    const onKey = (e) => {
      const t = document.activeElement
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (inField) return
      if (!visible.length) return
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(visible.length - 1, i + 1)) }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(0, i - 1)) }
      else if (e.key === 'x' && current) { dismiss(current) }
      else if (e.key === 'c' && current?.phone) { window.location.href = `tel:${current.phone}` }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, visible.length])

  const copy = async (label, value) => {
    if (!value) return
    try { await navigator.clipboard.writeText(value); setCopiedField(label); setTimeout(() => setCopiedField(''), 1200) } catch {}
  }

  // Build a synthetic "lead-shaped" object so timezoneFor + localTimeFor
  // work whether the contact has an existing lead or not.
  const contactAsLead = useMemo(() => {
    if (!current) return null
    if (existingLead) return existingLead
    return { phone: current.phone, state: '', zip: '' }
  }, [current, existingLead])
  const localTime = current ? localTimeFor(contactAsLead) : ''
  const tzLabel = current ? tzLabelFor(contactAsLead) : ''

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-3 md:px-6 py-3 border-b border-[#1A2130] flex-shrink-0"
        style={{ background: '#0A0E14' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #F97316, #EF4444)' }}>
            <Thermometer size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-display font-bold text-white">Warm Bucket</h1>
            <p className="text-[11px] text-[#5A6A7A] mt-0.5 truncate">
              {visible.length > 0
                ? `${selectedIdx + 1} of ${visible.length} · ↑↓ or j/k to move · c = call · x = dismiss`
                : `Positive PitchPrfct contacts who went quiet after your last text`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-[#8899AA] px-2 py-1.5 rounded-lg border border-[#1A2130]">
            <Clock size={12} />
            <span>Last</span>
            <input type="number" min="1" max="720" value={hours}
              onChange={e => setHours(Math.max(1, Math.min(720, parseInt(e.target.value, 10) || 24)))}
              className="w-14 bg-transparent border-b border-[#1A2130] text-center text-white focus:outline-none focus:border-[#00E5C340]" />
            <span>hrs</span>
          </label>
          <div className="flex items-center gap-0.5">
            {[6, 24, 72, 168].map(h => (
              <button key={h} onClick={() => setHours(h)}
                className={`px-2 py-1 rounded text-[10px] font-mono ${
                  hours === h ? 'bg-[#1A2130] text-white' : 'text-[#5A6A7A] hover:text-white'
                }`}>
                {h < 24 ? `${h}h` : `${h/24}d`}
              </button>
            ))}
          </div>
          <button onClick={runScan} disabled={scanning}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #F97316, #EF4444)' }}>
            {scanning ? <><Loader size={13} className="animate-spin" /> Scanning…</> : <><Search size={13} /> Scan</>}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`mx-3 md:mx-6 mt-3 flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
          msg.type === 'success'
            ? 'bg-[#10B98115] text-[#10B981] border-[#10B98140]'
            : 'bg-[#EF444415] text-[#EF4444] border-[#EF444440]'
        }`}>
          {msg.type === 'success' ? <CheckCircle size={13} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />}
          <div className="flex-1">
            <p>{msg.text}</p>
            {msg.leadId && (
              <button onClick={() => navigate(`/leads/${msg.leadId}`)} className="mt-1 underline hover:text-white">
                Open lead →
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mx-3 md:mx-6 mt-3 p-3 rounded-lg border border-[#EF444440] text-xs text-[#EF4444]" style={{ background: '#EF444408' }}>
          <p className="font-semibold mb-1">Scan failed</p>
          <p>{error}</p>
        </div>
      )}
      {scanNote && (
        <div className="mx-3 md:mx-6 mt-3 p-3 rounded-lg border border-[#F59E0B40] text-xs text-[#F59E0B]" style={{ background: '#F59E0B08' }}>
          {scanNote}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Minimized rail */}
        <aside className="w-56 flex-shrink-0 border-r border-[#1A2130] overflow-y-auto"
          style={{ background: '#0A0E14' }}>
          <div className="px-3 py-2 border-b border-[#1A2130] sticky top-0 z-10"
            style={{ background: '#0A0E14' }}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#F97316]">
              Queue · {visible.length}
            </p>
          </div>
          {visible.length === 0 ? (
            <p className="p-3 text-[11px] text-[#5A6A7A] italic">
              {matches.length === 0 ? 'Scan to load queue.' : 'All caught up.'}
            </p>
          ) : (
            <div className="py-1">
              {visible.map((c, i) => {
                const isSelected = i === selectedIdx
                const since = c.last_outbound_at ? formatDistanceToNow(new Date(c.last_outbound_at)) : ''
                return (
                  <button key={c._key || c.pp_contact_uuid}
                    onClick={() => setSelectedIdx(i)}
                    className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${
                      isSelected ? 'border-[#F97316] bg-[#F9731615]' : 'border-transparent hover:bg-[#0E1318]'
                    }`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-[#C0D0E0]'}`}>
                        {fullName(c)}
                      </p>
                      {c._kind === 'queue' && (
                        <span className="text-[9px] font-mono px-1 rounded flex-shrink-0"
                          style={{ background: '#F9731625', color: '#F97316' }}
                          title="High-priority push via API">
                          P{c.priority || 3}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-[#5A6A7A] font-mono truncate">{displayPhone(c.phone) || c.phone}</p>
                    <p className="text-[10px] text-[#F97316] font-mono mt-0.5">
                      {c._kind === 'queue' ? 'API push' : `silent ${since}`}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </aside>

        {/* Focus view */}
        <main className="flex-1 overflow-y-auto">
          {!current ? (
            <div className="text-center py-20 text-[#5A6A7A]">
              <Thermometer size={40} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">
                {matches.length === 0
                  ? 'Nothing scanned yet — hit Scan above.'
                  : 'Every contact in the scan has been dismissed or promoted.'}
              </p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
              {/* Header card */}
              <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
                <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#1A2130]"
                  style={{ background: '#F9731608' }}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: '#F9731620', color: '#F97316' }}>
                      <User size={20} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-bold text-white truncate">{fullName(current)}</h2>
                        {current._kind === 'queue' && (
                          <span className="text-[10px] px-2 py-0.5 rounded font-mono inline-flex items-center gap-1"
                            style={{ background: '#F9731615', color: '#F97316', border: '1px solid #F9731640' }}
                            title="Pushed to your bucket via the Infinite API">
                            High priority · P{current.priority || 3}
                          </span>
                        )}
                        {existingLead && (
                          <button onClick={() => navigate(`/leads/${existingLead.id}`)}
                            className="text-[10px] px-2 py-0.5 rounded font-mono inline-flex items-center gap-1"
                            style={{ background: '#00E5C315', color: '#00E5C3', border: '1px solid #00E5C340' }}
                            title="This contact is already in your CRM">
                            In CRM <ExternalLink size={10} />
                          </button>
                        )}
                      </div>
                      <button onClick={() => copy('phone', current.phone)}
                        className="text-sm font-mono text-[#8899AA] hover:text-white inline-flex items-center gap-1.5">
                        {displayPhone(current.phone) || current.phone}
                        {copiedField === 'phone' ? <Check size={11} className="text-[#00E5C3]" /> : <Copy size={11} />}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <div className="text-xs text-[#F97316] font-mono">
                      Silent {current.last_outbound_at ? formatDistanceToNow(new Date(current.last_outbound_at)) : ''}
                    </div>
                    {(localTime || tzLabel) && (
                      <div className="text-xs text-[#8899AA] font-mono inline-flex items-center gap-1">
                        <MapPin size={11} /> {tzLabel} · {localTime}
                      </div>
                    )}
                  </div>
                </div>

                {/* Action row */}
                <div className="flex items-center flex-wrap gap-2 px-5 py-3">
                  {current.phone && (
                    <a href={`tel:${current.phone}`}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-black transition-opacity hover:opacity-90"
                      style={{ background: 'linear-gradient(135deg, #10B981, #00E5C3)' }}>
                      <Phone size={14} /> Call
                    </a>
                  )}
                  {current.phone && (
                    <a href={`sms:${current.phone}`}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)' }}>
                      <Send size={13} /> Text
                    </a>
                  )}
                  <div className="relative">
                    <button onClick={() => setPickerOpen(v => !v)}
                      disabled={promoting === current.pp_contact_uuid}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-black disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                      {promoting === current.pp_contact_uuid
                        ? <><Loader size={13} className="animate-spin" /> Adding…</>
                        : <>Promote to CRM <ChevronDown size={13} /></>}
                    </button>
                    {pickerOpen && (
                      <StagePicker stages={safeTags} onPick={promote} onCancel={() => setPickerOpen(false)} anchor="left" />
                    )}
                  </div>
                  <button onClick={() => dismiss(current)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[#EF444440] text-[#EF4444] hover:bg-[#EF444415]">
                    <X size={13} /> Dismiss (x)
                  </button>
                  <div className="flex-1" />
                  <button onClick={() => setSelectedIdx(i => Math.max(0, i - 1))}
                    disabled={selectedIdx === 0}
                    className="p-2 rounded-lg text-[#8899AA] hover:text-white hover:bg-[#1A2130] disabled:opacity-30"
                    title="Previous (k / ↑)">
                    <ChevronLeft size={14} />
                  </button>
                  <button onClick={() => setSelectedIdx(i => Math.min(visible.length - 1, i + 1))}
                    disabled={selectedIdx >= visible.length - 1}
                    className="p-2 rounded-lg text-[#8899AA] hover:text-white hover:bg-[#1A2130] disabled:opacity-30"
                    title="Next (j / ↓)">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              {/* Queue-push reason (only for entries pushed via API by Kam etc.) */}
              {current._kind === 'queue' && (current.reason || current.queued_note) && (
                <div className="rounded-xl border border-[#F9731640] overflow-hidden"
                  style={{ background: '#F9731608' }}>
                  <div className="px-4 py-2 border-b border-[#F9731640] flex items-center justify-between">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-[#F97316]">
                      Why this is in your bucket
                    </p>
                    <span className="text-[10px] text-[#5A6A7A] font-mono">
                      {current.source_label || 'pushed'} · priority {current.priority || 3}
                    </span>
                  </div>
                  <div className="px-4 py-3">
                    {current.reason && (
                      <p className="text-sm text-[#F97316] mb-2">{current.reason}</p>
                    )}
                    {current.queued_note && (
                      <p className="text-xs text-[#C0D0E0] whitespace-pre-wrap leading-snug">{current.queued_note}</p>
                    )}
                  </div>
                </div>
              )}

              {/* PitchPrfct contact context — fields PP knows about this person.
                  Only shows for PP-scanned contacts (queue entries have their
                  own info block above). */}
              {current._kind === 'pp' && (current.email || current.state || current.zip || current.city || current.dob || current.source || current.campaign || (current.custom_fields && Object.keys(current.custom_fields).length > 0)) && (
                <div className="rounded-xl border border-[#8B5CF640] overflow-hidden"
                  style={{ background: '#8B5CF608' }}>
                  <div className="px-4 py-2 border-b border-[#8B5CF640]">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-[#8B5CF6]">From PitchPrfct contact record</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 px-4 py-3">
                    {[
                      { label: 'Email', value: current.email },
                      { label: 'State', value: current.state },
                      { label: 'City', value: current.city },
                      { label: 'Zip', value: current.zip },
                      { label: 'DOB', value: current.dob },
                      { label: 'Source', value: current.source },
                      { label: 'Campaign', value: current.campaign },
                      ...Object.entries(current.custom_fields || {}).map(([k, v]) => ({ label: k, value: v })),
                    ].filter(f => f.value).map((f, i) => (
                      <div key={f.label + i} className="min-w-0">
                        <p className="text-[9px] uppercase tracking-wider text-[#5A6A7A] mb-0.5">{f.label}</p>
                        <p className="text-xs text-white truncate" title={f.value}>{f.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Lead context (if they're already in Infinite) */}
              {existingLead && (
                <div className="rounded-xl border border-[#00E5C320] overflow-hidden"
                  style={{ background: '#00E5C308' }}>
                  <div className="px-4 py-2 border-b border-[#00E5C320]">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-[#00E5C3]">CRM record</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3">
                    {[
                      { label: 'State', value: existingLead.state },
                      { label: 'Zip', value: existingLead.zip },
                      { label: 'DOB', value: existingLead.dob ? String(existingLead.dob).slice(0, 10) : '' },
                      { label: 'Household', value: existingLead.household || existingLead.household_size },
                      { label: 'Income', value: existingLead.income },
                      { label: 'Campaign', value: existingLead.campaign },
                      { label: 'Stage', value: safeTags.find(t => t.id === existingLead.stage)?.label || existingLead.stage },
                      { label: 'Email', value: existingLead.email },
                    ].filter(f => f.value).map(f => (
                      <div key={f.label}>
                        <p className="text-[9px] uppercase tracking-wider text-[#5A6A7A] mb-0.5">{f.label}</p>
                        <p className="text-xs text-white truncate">{f.value}</p>
                      </div>
                    ))}
                  </div>
                  {existingLead.notes && (
                    <div className="px-4 py-2 border-t border-[#00E5C320]">
                      <p className="text-[9px] uppercase tracking-wider text-[#5A6A7A] mb-1">Previous notes</p>
                      <p className="text-xs text-[#C0D0E0] whitespace-pre-wrap leading-snug">{existingLead.notes}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Full conversation */}
              <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
                <div className="flex items-center justify-between px-4 py-2 border-b border-[#1A2130]">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[#8899AA]">
                    Conversation · {(current.recent_messages || []).length} messages
                  </p>
                  <p className="text-[10px] text-[#5A6A7A]">Read this before the call</p>
                </div>
                <div className="p-4 space-y-2" style={{ background: '#080B0F', maxHeight: '50vh', overflowY: 'auto' }}>
                  {(current.recent_messages || []).length === 0 ? (
                    <p className="text-xs text-[#5A6A7A] italic">No message history returned by PitchPrfct.</p>
                  ) : (
                    (current.recent_messages || []).map((m, i) => (
                      <MessageBubble key={m.id || i} msg={m} spacious />
                    ))
                  )}
                </div>
              </div>

              {/* Notes */}
              <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
                <div className="flex items-center justify-between px-4 py-2 border-b border-[#1A2130]">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[#F59E0B]">Note</p>
                  {notesDirty[current.pp_contact_uuid] ? (
                    <button onClick={() => saveNote(current.pp_contact_uuid)}
                      disabled={savingNote[current.pp_contact_uuid]}
                      className="text-[10px] px-2 py-0.5 rounded font-semibold text-black disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                      {savingNote[current.pp_contact_uuid] ? 'Saving…' : 'Save'}
                    </button>
                  ) : (notes[current.pp_contact_uuid] ? (
                    <span className="text-[10px] text-[#10B981] inline-flex items-center gap-1">
                      <CheckCircle size={10} /> Saved
                    </span>
                  ) : null)}
                </div>
                <textarea
                  value={notes[current.pp_contact_uuid] || ''}
                  onChange={e => {
                    const v = e.target.value
                    setNotes(prev => ({ ...prev, [current.pp_contact_uuid]: v }))
                    setNotesDirty(prev => ({ ...prev, [current.pp_contact_uuid]: true }))
                  }}
                  onBlur={() => { if (notesDirty[current.pp_contact_uuid]) saveNote(current.pp_contact_uuid) }}
                  placeholder="What jumped out? Talking points, family size, budget, callback prefs — whatever you'll want in front of you when they pick up."
                  rows={4}
                  className="w-full text-sm bg-[#080B0F] border-0 px-4 py-3 text-white focus:outline-none resize-y" />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
