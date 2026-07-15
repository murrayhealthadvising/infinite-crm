import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Thermometer, RefreshCw, Search, X, Phone, Send, User, Clock,
  ChevronDown, AlertCircle, CheckCircle, Loader,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { displayPhone } from '../lib/phone'
import { format, formatDistanceToNow } from 'date-fns'

// Warm Bucket — pulls contacts tagged "Positive" in PitchPrfct who've gone
// quiet after Nic's last outbound. Manually triggered (Scan button + hours
// input), keeps everyone visible until Nic X's them out or promotes them
// to a real lead in the CRM.

const WORKER_URL = (import.meta.env.VITE_CRM_WORKER_URL
  || 'https://infinite-crm-webhook.murrayhealthadvising.workers.dev').replace(/\/+$/, '')

function fullName(c) {
  return [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || '(no name)'
}

// Compact message bubble — matches the ConversationPanel style.
function MessageBubble({ msg }) {
  const isOut = /out/.test(msg?.direction || '') && !/in/.test(msg?.direction || '')
  const time = msg?.sent_at
    ? format(new Date(msg.sent_at), 'MMM d h:mma').toLowerCase()
    : ''
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 border`}
        style={{
          background: isOut ? '#3B82F615' : '#0E1318',
          borderColor: isOut ? '#3B82F640' : '#1A2130',
        }}>
        <p className="text-xs text-[#C0D0E0] leading-snug whitespace-pre-wrap break-words">{msg?.body || '(empty)'}</p>
        <p className="text-[9px] text-[#5A6A7A] font-mono mt-0.5">{time}</p>
      </div>
    </div>
  )
}

// Stage picker dropdown — used when promoting a warm-bucket contact to a
// real lead. No default; Nic must pick.
function StagePicker({ stages, onPick, onCancel }) {
  const ref = useRef(null)
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) onCancel() }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onCancel])
  return (
    <div ref={ref} className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-[#1A2130] overflow-hidden z-30 shadow-xl max-h-72 overflow-y-auto"
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
  const { user, tags, addLead } = useApp()
  const navigate = useNavigate()
  const [hours, setHours] = useState(24)
  const [scanning, setScanning] = useState(false)
  const [matches, setMatches] = useState([])
  const [scanNote, setScanNote] = useState(null)
  const [error, setError] = useState(null)
  const [dismissed, setDismissed] = useState(() => new Set())  // session-only
  const [notes, setNotes] = useState({})  // uuid → text
  const [notesDirty, setNotesDirty] = useState({})  // uuid → boolean
  const [savingNote, setSavingNote] = useState({})
  const [pickerOpenFor, setPickerOpenFor] = useState(null)
  const [promoting, setPromoting] = useState(null)
  const [msg, setMsg] = useState(null)

  const safeTags = Array.isArray(tags) && tags.length ? tags : [
    { id: 'interested', label: 'Interested', color: '#3B82F6' },
    { id: 'apt', label: 'Appointment', color: '#F59E0B' },
  ]

  // Load any existing notes for the current user from Supabase on mount.
  // Keyed by pp_contact_uuid so a note survives the contact leaving and
  // re-entering the bucket on subsequent scans.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    supabase.from('warm_bucket_notes')
      .select('pp_contact_uuid, note')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (cancelled) return
        const m = {}
        for (const r of (data || [])) m[r.pp_contact_uuid] = r.note || ''
        setNotes(m)
      })
    return () => { cancelled = true }
  }, [user?.id])

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
        if (j.note) setScanNote(j.note)
      }
    } catch (e) {
      setError(String(e?.message || e))
    }
    setScanning(false)
  }

  const dismiss = (uuid) => {
    setDismissed(prev => { const n = new Set(prev); n.add(uuid); return n })
  }

  const saveNote = async (uuid) => {
    if (!user?.id) return
    setSavingNote(prev => ({ ...prev, [uuid]: true }))
    try {
      const text = notes[uuid] || ''
      await supabase.from('warm_bucket_notes')
        .upsert({ user_id: user.id, pp_contact_uuid: uuid, note: text }, { onConflict: 'user_id,pp_contact_uuid' })
      setNotesDirty(prev => ({ ...prev, [uuid]: false }))
    } catch (e) {
      console.error('save note failed:', e)
    }
    setSavingNote(prev => ({ ...prev, [uuid]: false }))
  }

  const promote = async (contact, stageId) => {
    if (!user?.id || typeof addLead !== 'function') return
    setPromoting(contact.pp_contact_uuid)
    setPickerOpenFor(null)
    try {
      const note = notes[contact.pp_contact_uuid] || ''
      // Compose a starting notes body: Nic's warm-bucket note (if any) + a
      // condensed record of the last few PP messages so context follows the
      // lead into the CRM.
      const messagesRecap = (contact.recent_messages || []).map(m => {
        const dir = /out/.test(m.direction || '') && !/in/.test(m.direction || '') ? '→' : '←'
        const t = m.sent_at ? format(new Date(m.sent_at), 'MMM d h:mma').toLowerCase() : ''
        return `${dir} ${t}: ${(m.body || '').slice(0, 200)}`
      }).join('\n')
      const combinedNote = [
        note.trim(),
        note.trim() && messagesRecap ? '\n─── from PitchPrfct ───' : '',
        messagesRecap,
      ].filter(Boolean).join('\n')

      const newLead = await addLead({
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        phone: contact.phone,
        source: 'warm-bucket',
        campaign: 'Warm Bucket (positive from PP)',
        stage: stageId,
        stage_changed_at: new Date().toISOString(),
        notes: combinedNote,
        pp_response_status: 'responded',  // they're positive; keep the tag consistent
      })
      // Clean up the note from warm_bucket_notes since it's now on the lead.
      try {
        await supabase.from('warm_bucket_notes').delete()
          .eq('user_id', user.id).eq('pp_contact_uuid', contact.pp_contact_uuid)
      } catch {}
      dismiss(contact.pp_contact_uuid)
      const label = safeTags.find(t => t.id === stageId)?.label || stageId
      setMsg({ type: 'success', text: `${fullName(contact)} → CRM as ${label}. Click name to open.`, leadId: newLead?.id })
      setTimeout(() => setMsg(null), 6000)
    } catch (e) {
      console.error('promote failed:', e)
      setMsg({ type: 'error', text: 'Could not add to CRM: ' + (e?.message || String(e)) })
      setTimeout(() => setMsg(null), 6000)
    }
    setPromoting(null)
  }

  const visible = useMemo(() =>
    matches.filter(m => !dismissed.has(m.pp_contact_uuid))
  , [matches, dismissed])

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-3 md:px-6 py-3 md:py-4 border-b border-[#1A2130] flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #F97316, #EF4444)' }}>
            <Thermometer size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-display font-bold text-white">Warm Bucket</h1>
            <p className="text-xs text-[#5A6A7A] mt-0.5 truncate">
              Positive PitchPrfct contacts who went quiet after your last text.
              Scan to pull the latest — dismissed contacts return on the next scan.
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
          {/* Quick shortcuts */}
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
            {scanning ? <><Loader size={13} className="animate-spin" /> Scanning…</> : <><Search size={13} /> Scan PitchPrfct</>}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 md:p-6">
        {msg && (
          <div className={`mb-4 flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
            msg.type === 'success'
              ? 'bg-[#10B98115] text-[#10B981] border-[#10B98140]'
              : 'bg-[#EF444415] text-[#EF4444] border-[#EF444440]'
          }`}>
            {msg.type === 'success' ? <CheckCircle size={13} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />}
            <div className="flex-1">
              <p>{msg.text}</p>
              {msg.leadId && (
                <button onClick={() => navigate(`/leads/${msg.leadId}`)}
                  className="mt-1 underline hover:text-white">
                  Open lead →
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-[#EF444440] text-xs text-[#EF4444]" style={{ background: '#EF444408' }}>
            <p className="font-semibold mb-1">Scan failed</p>
            <p>{error}</p>
          </div>
        )}
        {scanNote && (
          <div className="mb-4 p-3 rounded-lg border border-[#F59E0B40] text-xs text-[#F59E0B]" style={{ background: '#F59E0B08' }}>
            {scanNote}
          </div>
        )}

        {!scanning && matches.length === 0 && !error && (
          <div className="text-center py-16 text-[#5A6A7A]">
            <Thermometer size={32} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">Nothing scanned yet.</p>
            <p className="text-xs mt-1">Click <span className="text-white">Scan PitchPrfct</span> above to pull positive contacts who went quiet.</p>
          </div>
        )}

        {visible.length === 0 && matches.length > 0 && (
          <div className="text-center py-16 text-[#5A6A7A]">
            <CheckCircle size={32} className="mx-auto mb-3 text-[#10B981] opacity-70" />
            <p className="text-sm">You're all caught up.</p>
            <p className="text-xs mt-1">Every contact in the scan has been dismissed or promoted.</p>
          </div>
        )}

        <div className="space-y-3">
          {visible.map(c => {
            const noteText = notes[c.pp_contact_uuid] || ''
            const isDirty = !!notesDirty[c.pp_contact_uuid]
            const isSaving = !!savingNote[c.pp_contact_uuid]
            const isPromoting = promoting === c.pp_contact_uuid
            const sinceLastOut = c.last_outbound_at
              ? formatDistanceToNow(new Date(c.last_outbound_at), { addSuffix: true })
              : ''
            return (
              <div key={c.pp_contact_uuid}
                className="rounded-xl border border-[#1A2130] overflow-hidden"
                style={{ background: '#0E1318' }}>
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[#1A2130]"
                  style={{ background: '#F9731608' }}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: '#F9731620', color: '#F97316' }}>
                      <User size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{fullName(c)}</p>
                      <p className="text-xs text-[#8899AA] font-mono">{displayPhone(c.phone) || c.phone}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="text-[10px] text-[#F97316] font-mono uppercase tracking-wider">
                      Silent {sinceLastOut}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {c.phone && (
                        <a href={`tel:${c.phone}`}
                          className="p-1.5 rounded text-[#10B981] hover:bg-[#10B98115]"
                          title="Call">
                          <Phone size={13} />
                        </a>
                      )}
                      {c.phone && (
                        <a href={`sms:${c.phone}`}
                          className="p-1.5 rounded text-[#3B82F6] hover:bg-[#3B82F615]"
                          title="Text">
                          <Send size={13} />
                        </a>
                      )}
                      <div className="relative">
                        <button onClick={() => setPickerOpenFor(pickerOpenFor === c.pp_contact_uuid ? null : c.pp_contact_uuid)}
                          disabled={isPromoting}
                          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-black disabled:opacity-50"
                          style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                          {isPromoting ? <><Loader size={11} className="animate-spin" /> Adding…</> : <>Promote <ChevronDown size={11} /></>}
                        </button>
                        {pickerOpenFor === c.pp_contact_uuid && (
                          <StagePicker
                            stages={safeTags}
                            onPick={(stageId) => promote(c, stageId)}
                            onCancel={() => setPickerOpenFor(null)} />
                        )}
                      </div>
                      <button onClick={() => dismiss(c.pp_contact_uuid)}
                        className="p-1.5 rounded text-[#5A6A7A] hover:text-[#EF4444] hover:bg-[#EF444415]"
                        title="Dismiss (returns on next scan)">
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Message thread */}
                <div className="px-4 py-3 space-y-1.5" style={{ background: '#080B0F' }}>
                  {(c.recent_messages || []).length === 0 ? (
                    <p className="text-xs text-[#5A6A7A] italic">No recent messages returned by PitchPrfct.</p>
                  ) : (
                    (c.recent_messages || []).map((m, i) => (
                      <MessageBubble key={m.id || i} msg={m} />
                    ))
                  )}
                </div>

                {/* Notes */}
                <div className="px-4 py-3 border-t border-[#1A2130]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">Note</span>
                    {isDirty && (
                      <button onClick={() => saveNote(c.pp_contact_uuid)}
                        disabled={isSaving}
                        className="text-[10px] px-2 py-0.5 rounded font-semibold text-black disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                        {isSaving ? 'Saving…' : 'Save'}
                      </button>
                    )}
                    {!isDirty && noteText && (
                      <span className="text-[10px] text-[#10B981] inline-flex items-center gap-1">
                        <CheckCircle size={10} /> Saved
                      </span>
                    )}
                  </div>
                  <textarea
                    value={noteText}
                    onChange={e => {
                      const v = e.target.value
                      setNotes(prev => ({ ...prev, [c.pp_contact_uuid]: v }))
                      setNotesDirty(prev => ({ ...prev, [c.pp_contact_uuid]: true }))
                    }}
                    onBlur={() => { if (isDirty) saveNote(c.pp_contact_uuid) }}
                    placeholder="Quick note — what caught your attention, what to say when you call…"
                    rows={2}
                    className="w-full text-xs bg-[#080B0F] border border-[#1A2130] rounded px-2 py-1.5 text-white focus:outline-none focus:border-[#00E5C340] resize-y" />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
