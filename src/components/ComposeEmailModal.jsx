import { useState, useEffect, useRef } from 'react'
import { Mail, Send, X, Check, AlertCircle, Loader, FileText, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { isGmailConnected, sendGmailMessage, connectGmail, listGmailDrafts } from '../lib/gmail'

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
  const { addActivity, user, profile, leads } = useApp()
  const lead = (leads || []).find(l => l.id === leadId)

  const [to, setTo] = useState(initialTo || '')
  const [subject, setSubject] = useState(defaults?.subject || '')
  const [body, setBody] = useState(defaults?.body || '')
  const [connected, setConnected] = useState(() => isGmailConnected())
  const [sending, setSending] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState(null)
  const [templates, setTemplates] = useState(null)  // null = not loaded, [] = loaded empty
  const [loadingTpl, setLoadingTpl] = useState(false)
  const [tplError, setTplError] = useState(null)
  const [selectedTpl, setSelectedTpl] = useState('')
  const subjectRef = useRef(null)
  const bodyRef = useRef(null)

  // Variable substitution — supports BOTH {first_name} AND {First Name}
  // AND {firstname}. Key normalization: lowercase + strip spaces/underscores.
  // Leaves unknown tokens alone so the user can spot them.
  const substituteVars = (text) => {
    if (!text || !lead) return text
    const vars = {
      firstname: lead.first_name || '',
      lastname: lead.last_name || '',
      name: (lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`).trim(),
      fullname: (lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`).trim(),
      email: lead.email || '',
      phone: lead.phone || '',
      state: lead.state || '',
      sc: lead.state || '',           // common alias for State Code
      city: lead.city || '',
      zip: lead.zip || '',
      agentfirstname: (user?.name || '').split(' ')[0] || (user?.email || '').split('@')[0] || '',
      agentname: user?.name || (user?.email || '').split('@')[0] || '',
      agentemail: user?.email || '',
    }
    // Match anything inside braces (handles "{First Name}", "{State}", etc.)
    return text.replace(/\{([^}]+)\}/g, (m, key) => {
      const norm = String(key).toLowerCase().replace(/[\s_]/g, '')
      return norm in vars ? vars[norm] : m
    })
  }

  const loadTemplates = async () => {
    if (!connected) return
    setLoadingTpl(true); setTplError(null)
    const res = await listGmailDrafts({ maxResults: 25 })
    if (res.ok) setTemplates(res.drafts)
    else { setTemplates([]); setTplError(res.error) }
    setLoadingTpl(false)
  }

  // Load templates the first time the modal opens (if connected)
  useEffect(() => { if (connected && templates === null) loadTemplates() }, [connected])

  // When a template is picked, we capture BOTH the plain and HTML versions
  // (with variables substituted). We ALSO remember the untouched plain body
  // (`originalTemplateBody`) so that when the agent edits the textarea, we
  // can detect the diff on send and merge those edits back into the HTML —
  // otherwise the recipient sees the template unchanged and the agent's
  // tweaks are silently lost. This was the "just goes off the template" bug.
  const [templateHtml, setTemplateHtml] = useState('')
  const [originalTemplateBody, setOriginalTemplateBody] = useState('')
  const applyTemplate = (tplId) => {
    setSelectedTpl(tplId)
    if (!tplId) {
      setTemplateHtml('')
      setOriginalTemplateBody('')
      return
    }
    const t = (templates || []).find(t => t.id === tplId)
    if (!t) return
    const filledBody = substituteVars(t.body || '')
    setSubject(substituteVars(t.subject || ''))
    setBody(filledBody)
    setOriginalTemplateBody(filledBody)
    setTemplateHtml(t.html ? substituteVars(t.html) : '')
  }

  // Has the agent edited the body since the template was applied?
  const hasBodyEdits = !!(originalTemplateBody && body !== originalTemplateBody)

  // Escape a plain-text body so it renders safely inside HTML. Preserves line
  // breaks with <br> and collapses runs of empty lines with &nbsp; so blank
  // paragraphs don't collapse in the rendered email.
  const plainToHtml = (text) => {
    if (!text) return ''
    const escaped = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const withBreaks = escaped.split('\n').map(l => l || '&nbsp;').join('<br>')
    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #222;">${withBreaks}</div>`
  }

  // Attempt to swap the original plain body OUT of the HTML template and the
  // agent's edited body IN, preserving whatever header/footer/signature
  // styling the template had. Returns null if we can't confidently locate
  // the original body inside the HTML (caller then falls back to plainToHtml).
  const substituteBodyInHtml = (html, oldBody, newBody) => {
    if (!html || !oldBody) return null
    // Direct substring match — works when the template stores the body verbatim
    if (html.includes(oldBody)) {
      const escaped = String(newBody)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
      return html.replace(oldBody, escaped)
    }
    // Anchor-based fallback: find the first and last non-empty line of the
    // original body inside the HTML. If both are found and in order, replace
    // everything between with the edited body.
    const lines = oldBody.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) return null
    const first = lines[0]
    const last = lines[lines.length - 1]
    const startIdx = html.indexOf(first)
    const endIdx = html.lastIndexOf(last)
    if (startIdx < 0 || endIdx <= startIdx) return null
    const escaped = String(newBody)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
    return html.slice(0, startIdx) + escaped + html.slice(endIdx + last.length)
  }

  // Preview HTML — reflects whatever WILL actually be sent (with edits applied).
  // Computed live so the iframe preview stays in sync as the agent types.
  const previewHtml = (() => {
    if (!templateHtml && !hasBodyEdits) return ''
    if (!hasBodyEdits) return templateHtml
    if (templateHtml) {
      const swapped = substituteBodyInHtml(templateHtml, originalTemplateBody, body)
      if (swapped) return swapped
    }
    return plainToHtml(body)
  })()
  // Was the smart substitution successful (edits went into the styled template)
  // or did we have to fall back to a plain-text-as-HTML render (edits are shown
  // but the template's styling is lost)? Used to color the status message.
  const editsMergedIntoTemplate = hasBodyEdits && templateHtml
    && !!substituteBodyInHtml(templateHtml, originalTemplateBody, body)

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
    // Send the HTML that reflects the agent's edits (previewHtml handles the
    // merge). If no template + no edits, previewHtml is empty and we fall
    // back to plain-only, same as before.
    const res = await sendGmailMessage({
      to,
      subject,
      body,
      html: previewHtml || undefined,
      fromName,
    })
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

          {connected && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] inline-flex items-center gap-1.5">
                  <FileText size={11} /> Template (from your Gmail drafts)
                </label>
                <button onClick={loadTemplates} disabled={loadingTpl}
                  className="text-[10px] text-[#5A6A7A] hover:text-white inline-flex items-center gap-1 disabled:opacity-40"
                  title="Reload templates from Gmail">
                  <RefreshCw size={10} className={loadingTpl ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
              <select value={selectedTpl} onChange={e => applyTemplate(e.target.value)}
                disabled={loadingTpl}
                className="w-full px-3 py-2 bg-[#080B0F] border border-[#1A2130] rounded-lg text-sm text-white focus:outline-none focus:border-[#3B82F6] disabled:opacity-50">
                <option value="">— start blank or pick a template —</option>
                {loadingTpl && <option disabled>Loading your Gmail drafts…</option>}
                {templates && templates.length === 0 && !loadingTpl && (
                  <option disabled>No drafts/templates found in your Gmail</option>
                )}
                {(templates || []).map(t => (
                  <option key={t.id} value={t.id}>{t.subject}</option>
                ))}
              </select>
              {tplError && (
                <p className="text-[10px] text-[#EF4444] mt-1">{tplError}</p>
              )}
              {!tplError && lead && (
                <p className="text-[10px] text-[#5A6A7A] mt-1">
                  Variables auto-filled from the lead: <code className="text-[#8899AA]">{'{first_name}'}</code>, <code className="text-[#8899AA]">{'{last_name}'}</code>, <code className="text-[#8899AA]">{'{name}'}</code>, <code className="text-[#8899AA]">{'{state}'}</code>, <code className="text-[#8899AA]">{'{agent_name}'}</code>, etc.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">Subject</label>
            <input ref={subjectRef} value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Quick question about your coverage"
              className="w-full px-3 py-2 bg-[#080B0F] border border-[#1A2130] rounded-lg text-sm text-white focus:outline-none focus:border-[#3B82F6]" />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">
              Body
              {templateHtml && !hasBodyEdits && <span className="text-[#3B82F6] normal-case"> · HTML template — preview below</span>}
              {hasBodyEdits && editsMergedIntoTemplate && <span className="text-[#10B981] normal-case"> · edits merged into HTML template ✓</span>}
              {hasBodyEdits && !editsMergedIntoTemplate && <span className="text-[#F59E0B] normal-case"> · sending as plain text (template body couldn't be located)</span>}
            </label>
            <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)}
              rows={templateHtml ? 5 : 10}
              placeholder="Hi —&#10;&#10;Wanted to follow up on…"
              className="w-full px-3 py-2.5 bg-[#080B0F] border border-[#1A2130] rounded-lg text-sm text-white focus:outline-none focus:border-[#3B82F6] resize-y" />
            {templateHtml && hasBodyEdits && (
              <div className="flex items-center justify-between gap-2 mt-1">
                <p className="text-[10px] text-[#5A6A7A]">
                  {editsMergedIntoTemplate
                    ? 'Edits are baked into the HTML preview below — that\'s what the recipient sees.'
                    : 'Couldn\'t match the template body — we\'ll send your edits as plain-formatted HTML so nothing is lost.'}
                </p>
                <button onClick={() => setBody(originalTemplateBody)}
                  className="text-[10px] text-[#5A6A7A] hover:text-white underline whitespace-nowrap"
                  title="Discard edits and restore the template body"
                >
                  Reset to template
                </button>
              </div>
            )}
          </div>

          {previewHtml && (
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">Preview (what the recipient will see)</label>
              <iframe
                title="Email preview"
                srcDoc={previewHtml}
                sandbox=""
                style={{ width: '100%', minHeight: '320px', maxHeight: '50vh', border: '1px solid #1A2130', borderRadius: '8px', background: 'white' }}
              />
            </div>
          )}

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
