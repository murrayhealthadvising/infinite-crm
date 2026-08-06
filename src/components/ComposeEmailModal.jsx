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

  // Extract the plain-text content that lives inside an HTML string, using
  // the browser's DOM parser. Preserves visible whitespace/newlines so the
  // body is close to what the recipient sees, and matches what's actually in
  // the HTML (Gmail's separate plain MIME part uses formatting markers like
  // *bold* that don't appear in the HTML — using THAT as our "original body"
  // meant the substring-match on send always failed for edited templates).
  const htmlToPlain = (html) => {
    if (!html || typeof document === 'undefined') return ''
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      // Replace <br> and block-level closing tags with newlines so the plain
      // text has the same shape as what the recipient sees.
      doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
      doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote').forEach(el => {
        // Append a newline after each block so consecutive blocks separate.
        el.appendChild(doc.createTextNode('\n'))
      })
      return (doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
    } catch { return '' }
  }

  // When a template is picked, we capture BOTH the plain and HTML versions
  // (with variables substituted). We ALSO remember the untouched plain body
  // (`originalTemplateBody`) so that when the agent edits the textarea, we
  // can detect the diff on send and merge those edits back into the HTML.
  const [templateHtml, setTemplateHtml] = useState('')
  const [originalTemplateBody, setOriginalTemplateBody] = useState('')
  // Ref for the WYSIWYG contentEditable div. When a template with HTML is
  // picked, we render its markup into this div and let Nic edit it directly.
  // Whatever's in the div's innerHTML at send time IS what gets sent — no
  // fragile substring substitution, no "template body couldn't be located"
  // messages. What you see is what sends.
  const editableRef = useRef(null)
  const applyTemplate = (tplId) => {
    setSelectedTpl(tplId)
    if (!tplId) {
      setTemplateHtml('')
      setOriginalTemplateBody('')
      if (editableRef.current) editableRef.current.innerHTML = ''
      return
    }
    const t = (templates || []).find(t => t.id === tplId)
    if (!t) return
    const html = t.html ? substituteVars(t.html) : ''
    const filledBody = html ? htmlToPlain(html) : substituteVars(t.body || '')
    setSubject(substituteVars(t.subject || ''))
    setBody(filledBody)
    setOriginalTemplateBody(filledBody)
    setTemplateHtml(html)
    // Note: DON'T set innerHTML here — the div hasn't rendered yet on the
    // FIRST template pick (the conditional-render only mounts it when
    // templateHtml is truthy, which happens on the NEXT render). The effect
    // below runs post-mount and handles both first-time and subsequent picks.
  }

  // Sync template HTML into the editor after React has mounted the div.
  // Runs on every template change — including the very first pick, which was
  // the "goes blank first time" bug. We only push into the div when the
  // incoming HTML differs from what's already there so we don't wipe an
  // in-progress edit if templateHtml is re-set to the same value.
  useEffect(() => {
    if (!editableRef.current) return
    if (templateHtml && editableRef.current.innerHTML !== templateHtml) {
      editableRef.current.innerHTML = templateHtml
    } else if (!templateHtml) {
      editableRef.current.innerHTML = ''
    }
  }, [templateHtml])

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
  //
  // Three-tier matching, cheapest first:
  //   1) Direct substring — works when the plain body is literally in the HTML
  //      (which is the common case now that originalTemplateBody is DERIVED
  //      from the HTML via htmlToPlain).
  //   2) DOM walk — parse HTML into a tree, find the text nodes that together
  //      contain the body, and replace them (handles templates where each
  //      paragraph is wrapped in tags but the visible text is unchanged).
  //   3) First/last-line anchor — last-resort fallback that gives up cleanly.
  const escapeAsHtml = (text) => String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

  const substituteBodyInHtml = (html, oldBody, newBody) => {
    if (!html || !oldBody) return null

    // 1) Direct substring match
    if (html.includes(oldBody)) {
      return html.replace(oldBody, escapeAsHtml(newBody))
    }

    // 2) DOM walk — find contiguous text nodes whose combined textContent
    //    contains oldBody, then splice in newBody. Handles the common case
    //    where the HTML has <div>/<span>/<b> tags between visible words.
    if (typeof document !== 'undefined') {
      try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')
        const root = doc.body || doc.documentElement
        // Collect all text nodes with their offsets in a combined string.
        const nodes = []
        let combined = ''
        const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
        let n
        while ((n = walker.nextNode())) {
          nodes.push({ node: n, start: combined.length, end: combined.length + n.textContent.length })
          combined += n.textContent
        }
        // Normalize both for matching (collapse whitespace).
        const norm = (s) => s.replace(/\s+/g, ' ').trim()
        const needle = norm(oldBody)
        const haystack = norm(combined)
        if (needle && haystack.includes(needle)) {
          // Find the same range in the ORIGINAL (non-normalized) combined text
          // by matching whitespace-insensitively.
          const startInHay = haystack.indexOf(needle)
          const endInHay = startInHay + needle.length
          // Walk combined and skip whitespace runs to map back to original offsets.
          const mapNormToRaw = (targetNormOffset) => {
            let rawOffset = 0, normOffset = 0, lastCharWasWs = true
            while (rawOffset < combined.length && normOffset < targetNormOffset) {
              const c = combined[rawOffset]
              if (/\s/.test(c)) {
                if (!lastCharWasWs) normOffset++
                lastCharWasWs = true
              } else {
                normOffset++
                lastCharWasWs = false
              }
              rawOffset++
            }
            return rawOffset
          }
          const rawStart = mapNormToRaw(startInHay)
          const rawEnd = mapNormToRaw(endInHay)
          // Identify text nodes covered by [rawStart, rawEnd).
          const covered = nodes.filter(x => x.end > rawStart && x.start < rawEnd)
          if (covered.length) {
            // Replace the first covered node's slice with newBody (as text +
            // <br> for line breaks), and clear the rest.
            const first = covered[0]
            const prefix = first.node.textContent.slice(0, Math.max(0, rawStart - first.start))
            const last = covered[covered.length - 1]
            const suffix = last.node.textContent.slice(Math.max(0, rawEnd - last.start))
            // Build a fragment of new content: prefix text, then <br>-split newBody, then suffix text.
            const parent = first.node.parentNode
            const frag = doc.createDocumentFragment()
            if (prefix) frag.appendChild(doc.createTextNode(prefix))
            const lines = String(newBody).split('\n')
            lines.forEach((line, i) => {
              if (i > 0) frag.appendChild(doc.createElement('br'))
              if (line) frag.appendChild(doc.createTextNode(line))
            })
            if (suffix) frag.appendChild(doc.createTextNode(suffix))
            parent.replaceChild(frag, first.node)
            // Remove the other covered nodes
            for (let i = 1; i < covered.length; i++) {
              const c = covered[i]
              if (c.node.parentNode) c.node.parentNode.removeChild(c.node)
            }
            return root.innerHTML
          }
        }
      } catch { /* fall through */ }
    }

    // 3) Anchor-based fallback: first + last non-empty line
    const lines = oldBody.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) return null
    const first = lines[0]
    const last = lines[lines.length - 1]
    const startIdx = html.indexOf(first)
    const endIdx = html.lastIndexOf(last)
    if (startIdx < 0 || endIdx <= startIdx) return null
    return html.slice(0, startIdx) + escapeAsHtml(newBody) + html.slice(endIdx + last.length)
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
    // Send whatever's currently in the WYSIWYG editor as HTML (that IS what
    // the recipient will see). Also derive plain text from the same div so
    // the plain-text fallback matches. If no template, fall back to the
    // previous plainToHtml / textarea behavior.
    let htmlToSend = previewHtml || undefined
    let plainToSend = body
    if (templateHtml && editableRef.current) {
      htmlToSend = editableRef.current.innerHTML
      const derivedPlain = editableRef.current.innerText || editableRef.current.textContent || ''
      if (derivedPlain.trim()) plainToSend = derivedPlain
    }
    const res = await sendGmailMessage({
      to,
      subject,
      body: plainToSend,
      html: htmlToSend,
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

          {/* Body: two modes.
              • Template picked → WYSIWYG contentEditable div. Click anywhere
                on the rendered email and start typing. What you see is what
                sends. No fragile substitution.
              • No template → plain textarea. Wraps to simple HTML on send. */}
          {templateHtml ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">
                  Email <span className="text-[#10B981] normal-case">· click any text to edit — what you see is what sends</span>
                </label>
                <button onClick={() => {
                  if (editableRef.current) editableRef.current.innerHTML = templateHtml
                }}
                  className="text-[10px] text-[#5A6A7A] hover:text-white underline whitespace-nowrap"
                  title="Restore the original template">
                  Reset to template
                </button>
              </div>
              <div
                ref={editableRef}
                contentEditable
                suppressContentEditableWarning
                spellCheck
                // Sync the text-only representation into `body` on each keystroke
                // so counters / activity log get the current text (not the HTML).
                onInput={e => {
                  const el = e.currentTarget
                  setBody(el.innerText || el.textContent || '')
                }}
                className="w-full px-4 py-3 rounded-lg text-sm text-black focus:outline-none overflow-y-auto"
                style={{
                  background: 'white',
                  border: '1px solid #1A2130',
                  borderRadius: '8px',
                  minHeight: '320px',
                  maxHeight: '55vh',
                  lineHeight: 1.5,
                }}
              />
              <p className="text-[10px] text-[#5A6A7A] mt-1">
                Bold/italic/link formatting from the template is preserved.
                Cmd+B for bold, Cmd+I for italic while editing.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">Body</label>
              <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)}
                rows={10}
                placeholder="Hi —&#10;&#10;Wanted to follow up on…"
                className="w-full px-3 py-2.5 bg-[#080B0F] border border-[#1A2130] rounded-lg text-sm text-white focus:outline-none focus:border-[#3B82F6] resize-y" />
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
