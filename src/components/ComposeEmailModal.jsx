import { useState, useEffect, useRef } from 'react'
import { Mail, Send, X, Check, AlertCircle, Loader } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { isGmailConnected, sendGmailMessage, connectGmail } from '../lib/gmail'

// Quick compose modal — fires from the small email button on LeadDetail.
// Sends through the Gmail API so the email lands in the agent's own Sent
// folder (no SMTP, no relay, no spoofing). Auto-logs the send as an activity
// row on the lead so it shows up in the Action Log.
//
// Props:
//   leadId   — the lead being emailed (used for activity log)
//   to       — initial recipient (typically lead.email)
//   onClose  — close callback
//   defaults — optional { subject, body, fromName }
export default function ComposeEmailModal({ leadId, to: initialTo, onClose, defaults }) {
  const { addActivity, user, profile } = useApp()

  const [to, setTo] = useState(initialTo || '')
  const [subject, setSubject] = useState(defaults?.subject || '')
  const [body, setBody] = useState(defaults?.body || '')
  const [connected, setConnected] = useState(() => isGmailConnected())
  const [sending, setSending] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState(null)  // { type: 'ok'|'err'|'info', text }
  const subjectRef = useRef(null)
  const bodyRef = useRef(null)

  // Auto-focus subject when modal opens (To is usually pre-filled)
  useEffect(() => {
    setTimeout(() => {
      if (initialTo && subjectRef.current) subjectRef.current.focus()
      else if (!initialTo && bodyRef.current) bodyRef.current.focus()
    }, 30)
  }, [initialTo])

  // ESC to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleConnect = async () => {
    setConnecting(true); setStatus(null)
    try {
      await connectGmail()
      setConnected(true)
      setStatus({ type: 'ok', text: 'Gmail connected — try Send again.' })
    } catch (e) {
      setStatus({ type: 'err', text: e?.message || 'Failed to connect.' })
    }
    setConnecting(false)
  }

  const handleSend = async () => {
    if (!to || !subject || !body) {
      setStatus({ type: 'err', text: 'Recipient, subject, and body are all required.' })
      return
    }
    setSending(true); setStatus(null)
    // Display name = agent name (falls back to email local-part)
    const fromName = user?.name
      ? `${user.name} <${user.email}>`
      : user?.email
      ? `${user.email.split('@')[0]} <${user.email}>`
      : undefined
    const res = await sendGmailMessage({ to, subject, body, fromName })
    if (res.ok) {
      // Auto-log as 'email' activity so it shows up in the lead's Action Log.
      try {
        if (leadId && typeof addActivity === 'function') {
          await addActivity(leadId, 'email', `Emailed: ${subject}`)
        }
      } catch {}
      setStatus({ type: 'ok', text: '✓ Sent. Closing…' })
      setTimeout(() => onClose(), 900)
    } else {
      setStatus({ type: 'err', text: res.error || 'Send failed.' })
      if (/not connected|reconnect/i.test(res.error || '')) setConnected(false)
    }
    setSending(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-[#1A2130] overflow-hidden shadow-2xl"
        style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]" style={{ background: '#3B82F608' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)' }}>
              <Mail size={16} className="text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Compose email</h3>
              <p className="text-xs text-[#8899AA]">
                {connected ? 'Sends via your Gmail · auto-logs to Action Log' : 'Connect Gmail to send from here'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#5A6A7A] hover:text-white p-1.5 rounded hover:bg-[#1A2130]">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {!connected && (
            <div className="rounded-lg border border-[#F59E0B30] px-3 py-3 flex items-start gap-3" style={{ background: '#F59E0B08' }}>
              <AlertCircle size={14} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#F59E0B] font-semibold">Gmail not connected</p>
                <p className="text-[11px] text-[#8899AA] mt-0.5">Click Connect to authorize — Gmail's consent popup will open. One-time.</p>
              </div>
              <button onClick={handleConnect} disabled={connecting}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-black disabled:opacity-50 whitespace-nowrap"
                style={{ background: 'linear-gradient(135deg, #F59E0B, #EF4444)' }}>
                {connecting ? 'Connecting…' : 'Connect Gmail'}
              </button>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">To</label>
            <input type="email" value={to} onChange={e => setTo(e.target.value)}
              placeholder="lead@example.com"
              className="w-full px-3 py-2 bg-[#080B0F] border border-[#1A2130] rounded-lg text-sm text-white focus:outline-none focus:border-[#3B82F6]" />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">Subject</label>
            <input ref={subjectRef} value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Quick question about your coverage"
              className="w-full px-3 py-2 bg-[#080B0F] border border-[#1A2130] rounded-lg text-sm text-white focus:outline-none focus:border-[#3B82F6]" />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">Body</label>
            <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)}
              rows={10}
              placeholder="Hi —&#10;&#10;Wanted to follow up on…"
              className="w-full px-3 py-2.5 bg-[#080B0F] border border-[#1A2130] rounded-lg text-sm text-white focus:outline-none focus:border-[#3B82F6] resize-y" />
          </div>

          {status && (
            <div className={`px-3 py-2 rounded-lg text-xs border ${
              status.type === 'ok' ? 'bg-[#10B98115] text-[#10B981] border-[#10B98140]'
              : status.type === 'err' ? 'bg-[#EF444415] text-[#EF4444] border-[#EF444440]'
              : 'bg-[#3B82F615] text-[#3B82F6] border-[#3B82F640]'
            }`}>
              {status.text}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={handleSend} disabled={sending || !connected}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)' }}>
              {sending ? <><Loader size={13} className="animate-spin" /> Sending…</> : <><Send size={13} /> Send</>}
            </button>
            <button onClick={onClose} disabled={sending}
              className="px-4 py-2.5 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
