import { useState, useRef, useEffect } from 'react'
import { MessageCircle, RefreshCw, Send, ArrowDown, AlertCircle } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { formatDistanceToNow, format } from 'date-fns'

// Worker URL — same env hook as the other PitchPrfct integrations
const WORKER_URL = (import.meta.env.VITE_CRM_WORKER_URL
  || 'https://infinite-crm-webhook.murrayhealthadvising.workers.dev').replace(/\/+$/, '')

// Quick-look PitchPrfct conversation scan for the lead currently open. Empty
// state shows a single "Scan conversation" button so we don't burn API calls
// or screen real estate on every lead open. Click → fetches via the worker
// (which has the agent's API key) and renders the last few messages between
// the agent's PP account and the lead's phone number.
//
// Direction is shown with an arrow + color so the agent can tell at a glance
// "did we already say something" vs "did they reply or opt out".
export default function ConversationPanel({ lead }) {
  const { user } = useApp()
  const [state, setState] = useState('idle')   // idle | loading | ok | err | none
  const [messages, setMessages] = useState([])
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const scrollRef = useRef(null)

  const agentId = lead?.user_id || lead?.agent_id || user?.id
  const phone = lead?.phone

  // Reset the panel back to idle whenever the parent hands us a different
  // lead — otherwise ←/→ nav in LeadDetail leaves the previous lead's
  // messages on screen until the agent clicks Refresh, which is exactly
  // the "wrong details on new contact" bug we're fixing.
  useEffect(() => {
    setState('idle')
    setMessages([])
    setError(null)
    setNote(null)
  }, [lead?.id])

  const fetchMessages = async () => {
    if (!agentId || !phone) {
      setState('err'); setError('Need both an agent and a phone on the lead.')
      return
    }
    setState('loading'); setError(null); setNote(null)
    try {
      const url = `${WORKER_URL}/pp-conversation?agent_id=${encodeURIComponent(agentId)}&phone=${encodeURIComponent(phone)}&limit=5`
      const r = await fetch(url)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setState('err')
        setError(j?.error || `HTTP ${r.status}`)
        return
      }
      const msgs = Array.isArray(j.messages) ? j.messages : []
      // Sort oldest→newest so the latest is at the bottom (chat-style).
      msgs.sort((a, b) => {
        const ta = a.sent_at ? new Date(a.sent_at).getTime() : 0
        const tb = b.sent_at ? new Date(b.sent_at).getTime() : 0
        return ta - tb
      })
      setMessages(msgs)
      setNote(j.note || null)
      setState(msgs.length === 0 ? 'none' : 'ok')
      // Scroll to bottom after render so the most recent message is visible
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }, 50)
    } catch (e) {
      setState('err'); setError(String(e?.message || e))
    }
  }

  return (
    <div className="rounded-xl border border-[#1A2130] overflow-hidden flex flex-col" style={{ background: '#0E1318' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1A2130]">
        <div className="flex items-center gap-2">
          <MessageCircle size={13} className="text-[#A78BFA]" />
          <span className="text-xs font-mono uppercase tracking-wider text-[#8899AA]">PitchPrfct conversation</span>
          {state === 'ok' && (
            <span className="text-[10px] text-[#3A4A5A] font-mono">· last {messages.length}</span>
          )}
        </div>
        {state !== 'idle' && (
          <button onClick={fetchMessages} disabled={state === 'loading'}
            className="text-[10px] text-[#5A6A7A] hover:text-white inline-flex items-center gap-1 disabled:opacity-40"
            title="Re-fetch the latest messages">
            <RefreshCw size={10} className={state === 'loading' ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      </div>

      {/* Body — scrollable to match the action log panel sizing */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2" style={{ maxHeight: '190px', minHeight: '160px' }}>
        {state === 'idle' && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-2">
            <p className="text-[11px] text-[#5A6A7A] max-w-[260px]">
              See the last 5 messages between you and this lead in PitchPrfct — find out if they replied, opted out, or you never reached them.
            </p>
            <button onClick={fetchMessages}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-black"
              style={{ background: 'linear-gradient(135deg, #A78BFA, #3B82F6)' }}>
              <MessageCircle size={12} /> Scan conversation
            </button>
          </div>
        )}

        {state === 'loading' && (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-[#5A6A7A] inline-flex items-center gap-2">
              <RefreshCw size={11} className="animate-spin" /> Loading…
            </p>
          </div>
        )}

        {state === 'err' && (
          <div className="rounded-lg border border-[#EF444440] px-3 py-2.5 flex items-start gap-2" style={{ background: '#EF444408' }}>
            <AlertCircle size={12} className="text-[#EF4444] flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-[#EF4444] font-semibold">Couldn't scan</p>
              <p className="text-[10px] text-[#8899AA] mt-1 break-words">{error}</p>
            </div>
          </div>
        )}

        {state === 'none' && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2">
            <p className="text-xs text-[#5A6A7A]">No messages found for this number in PitchPrfct.</p>
            {note && <p className="text-[10px] text-[#3A4A5A]">{note}</p>}
          </div>
        )}

        {state === 'ok' && messages.map((m, i) => {
          const isOut = /out/.test(m.direction || '')
          const when = m.sent_at ? new Date(m.sent_at) : null
          const rel = when && isFinite(when.getTime()) ? formatDistanceToNow(when, { addSuffix: true }) : ''
          const abs = when && isFinite(when.getTime()) ? format(when, 'EEE h:mm a') : ''
          return (
            <div key={m.id || i} className={`flex flex-col ${isOut ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] px-2.5 py-1.5 rounded-lg text-[11px] leading-snug border ${
                isOut
                  ? 'bg-[#3B82F615] border-[#3B82F640] text-[#C0D0E0]'
                  : 'bg-[#A78BFA15] border-[#A78BFA40] text-[#E5D9FF]'
              }`}>
                <div className="flex items-center gap-1.5 mb-1">
                  {isOut
                    ? <Send size={9} className="text-[#3B82F6]" />
                    : <ArrowDown size={9} className="text-[#A78BFA]" />}
                  <span className="text-[9px] font-mono uppercase tracking-wider opacity-70">
                    {isOut ? 'you' : 'lead'}
                  </span>
                  {m.status && (
                    <span className="text-[9px] text-[#5A6A7A] font-mono">· {m.status}</span>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words">{m.body || <em className="opacity-50">(no body)</em>}</p>
              </div>
              {rel && <p className="text-[9px] text-[#3A4A5A] font-mono mt-0.5" title={abs}>{rel}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
