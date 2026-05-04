import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import {
  Phone, Copy, Check, Star, ChevronLeft, ChevronRight, ExternalLink,
  PhoneCall, MessageSquare, AtSign, StickyNote, Zap, X, Trash2,
} from 'lucide-react'

const STAR_TAG = 'starred'

function isStarred(lead) {
  return Array.isArray(lead?.tags) && lead.tags.includes(STAR_TAG)
}
function leadName(lead) {
  if (!lead) return ''
  if (lead.name && lead.name.trim()) return lead.name.trim()
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || '—'
}
function leadInitials(lead) {
  const n = leadName(lead)
  if (n === '—' || !n) return '?'
  const parts = n.trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || '?'
}

export default function DialBucket() {
  const { leads, updateLead, addActivity, getTag } = useApp()
  const navigate = useNavigate()
  const [idx, setIdx] = useState(0)
  const [logNote, setLogNote] = useState('')
  const [logType, setLogType] = useState('call')
  const [savingNote, setSavingNote] = useState(false)
  const [copied, setCopied] = useState(false)

  const starredLeads = useMemo(() => {
    return (Array.isArray(leads) ? leads : []).filter(isStarred)
      .sort((a, b) => (new Date(b.created_at || 0) - new Date(a.created_at || 0)))
  }, [leads])

  const lead = starredLeads[idx] || null
  const tag = lead ? (typeof getTag === 'function' ? getTag(lead.stage || lead.status) : null) : null
  const sColor = tag?.color || '#00E5C3'

  const next = () => setIdx(i => Math.min(i + 1, starredLeads.length - 1))
  const prev = () => setIdx(i => Math.max(i - 1, 0))

  const removeFromBucket = async () => {
    if (!lead) return
    const tags = Array.isArray(lead.tags) ? lead.tags.filter(t => t !== STAR_TAG) : []
    if (typeof updateLead === 'function') await updateLead(lead.id, { tags })
    setIdx(i => Math.min(i, Math.max(0, starredLeads.length - 2)))
  }

  const copyPhone = () => {
    if (!lead?.phone) return
    navigator.clipboard.writeText(lead.phone)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  const logActivity = async () => {
    if (!lead || !logNote.trim()) return
    setSavingNote(true)
    try {
      if (typeof addActivity === 'function') await addActivity(lead.id, logType, logNote.trim())
      // Append to notes too so it's visible on the card without opening detail
      const newNotes = (lead.notes ? lead.notes + '\n' : '') + `[${logType}] ${logNote.trim()}`
      if (typeof updateLead === 'function') await updateLead(lead.id, { notes: newNotes })
    } catch {}
    setLogNote('')
    setSavingNote(false)
  }

  if (starredLeads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-fade-in">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ background: 'linear-gradient(135deg, #F59E0B40, #EF444440)', color: '#F59E0B' }}>
          <Star size={28} />
        </div>
        <h1 className="text-xl font-display font-bold text-white mb-2">Dial Bucket is empty</h1>
        <p className="text-sm text-[#8899AA] max-w-sm mb-4">
          Star leads from the Leads page (the ☆ button on each card) to queue them up here for focused dialing sessions.
        </p>
        <button onClick={() => navigate('/leads')}
          className="px-4 py-2 rounded-lg text-sm font-medium text-black"
          style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          Go to Leads
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130] flex-shrink-0">
        <div className="flex items-center gap-3">
          <Star size={18} style={{ color: '#F59E0B' }} fill="#F59E0B" />
          <div>
            <h1 className="text-xl font-display font-bold text-white">Dial Bucket</h1>
            <p className="text-xs text-[#5A6A7A]">{starredLeads.length} starred · {idx + 1} of {starredLeads.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prev} disabled={idx === 0}
            className="p-2 rounded-lg border border-[#1A2130] text-[#8899AA] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronLeft size={16} />
          </button>
          <button onClick={next} disabled={idx >= starredLeads.length - 1}
            className="p-2 rounded-lg border border-[#1A2130] text-[#8899AA] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Big focused dialer panel */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl mx-auto">
          <div className="rounded-2xl border overflow-hidden" style={{ background: '#0E1318', borderColor: sColor + '40' }}>
            {/* Identity */}
            <div className="px-6 py-5 border-b border-[#1A2130]" style={{ background: sColor + '08' }}>
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
                  style={{ background: sColor + '25', color: sColor }}>
                  {leadInitials(lead)}
                </div>
                <div className="flex-1 min-w-0">
                  <button onClick={() => navigate(`/leads/${lead.id}`)}
                    className="text-2xl font-display font-bold text-white hover:underline text-left flex items-center gap-2">
                    {leadName(lead)}
                    <ExternalLink size={15} className="text-[#5A6A7A]" />
                  </button>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded-full font-mono uppercase tracking-wider"
                      style={{ background: tag?.bg, color: tag?.color, border: `1px solid ${sColor}40` }}>
                      {tag?.label || 'Not Started'}
                    </span>
                    <span className="text-xs text-[#5A6A7A]">{[lead.state, lead.zip].filter(Boolean).join(' ')}</span>
                    {(lead.campaign || lead.source) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: sColor + '15', color: sColor }}>
                        {lead.campaign || lead.source}
                      </span>
                    )}
                    {lead.comments && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: '#F59E0B15', color: '#F59E0B', border: '1px solid #F59E0B30' }}>
                        {lead.comments}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={removeFromBucket}
                  className="p-2 rounded-lg text-[#5A6A7A] hover:text-[#EF4444] hover:bg-[#EF444415]"
                  title="Remove from dial bucket">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Phone — big, click-to-call */}
            <div className="px-6 py-6">
              {lead.phone ? (
                <div className="flex items-center justify-between gap-4">
                  <a href={`tel:${lead.phone}`}
                    className="flex items-center gap-3 px-5 py-4 rounded-xl text-2xl font-mono font-bold text-black flex-1 justify-center hover:opacity-90 transition-opacity"
                    style={{ background: `linear-gradient(135deg, ${sColor}, ${sColor}AA)` }}>
                    <PhoneCall size={20} /> {lead.phone}
                  </a>
                  <button onClick={copyPhone}
                    className="p-4 rounded-xl border border-[#1A2130] text-[#8899AA] hover:text-white"
                    title="Copy">
                    {copied ? <Check size={18} className="text-[#00E5C3]" /> : <Copy size={18} />}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-[#5A6A7A] italic text-center py-4">No phone on file for this lead.</p>
              )}
              {lead.email && (
                <p className="text-xs text-[#8899AA] mt-3 text-center">{lead.email}</p>
              )}
            </div>

            {/* Existing notes */}
            {lead.notes && (
              <div className="px-6 pb-4">
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-2">Notes on file</p>
                <div className="rounded-lg border border-[#1A2130] p-3 text-sm text-[#C0D0E0] whitespace-pre-wrap"
                  style={{ background: '#080B0F' }}>
                  {lead.notes}
                </div>
              </div>
            )}

            {/* Quick log */}
            <div className="px-6 pb-6">
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-2">Log this call</p>
              <div className="flex gap-1.5 mb-2 flex-wrap">
                {[
                  { id: 'call', icon: PhoneCall, label: 'call' },
                  { id: 'text', icon: MessageSquare, label: 'text' },
                  { id: 'email', icon: AtSign, label: 'email' },
                  { id: 'note', icon: StickyNote, label: 'note' },
                  { id: 'apt', icon: Zap, label: 'apt' },
                ].map(t => (
                  <button key={t.id} onClick={() => setLogType(t.id)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs capitalize border"
                    style={logType === t.id
                      ? { background: sColor + '15', borderColor: sColor + '60', color: sColor }
                      : { borderColor: '#1A2130', color: '#5A6A7A' }}>
                    <t.icon size={11} /> {t.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={logNote} onChange={e => setLogNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') logActivity() }}
                  placeholder={`Log a ${logType} — what happened? (Enter to save & next)`}
                  className="flex-1 bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#2A3547]" />
                <button onClick={async () => { await logActivity(); next() }}
                  disabled={savingNote || !logNote.trim()}
                  className="px-4 py-2.5 rounded-lg text-sm font-semibold text-black disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                  {savingNote ? 'Saving…' : 'Save & Next →'}
                </button>
              </div>
            </div>
          </div>

          {/* Mini-pager: thumbnails of next few leads */}
          <div className="mt-6 flex items-center gap-3 overflow-x-auto pb-2"
            style={{ scrollbarWidth: 'thin' }}>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] flex-shrink-0">Up next</span>
            {starredLeads.slice(idx + 1, idx + 8).map((l, i) => (
              <button key={l.id} onClick={() => setIdx(idx + 1 + i)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1A2130] text-xs text-[#8899AA] hover:text-white hover:border-[#2A3547] flex-shrink-0">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ background: '#1A2130', color: '#8899AA' }}>
                  {leadInitials(l)}
                </span>
                {leadName(l).split(' ')[0]}
              </button>
            ))}
            {starredLeads.length - idx - 1 <= 0 && (
              <span className="text-xs text-[#3A4A5A]">— last one</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
