import { useState, useEffect, useRef } from 'react'
import { Zap, Check } from 'lucide-react'

// Cloudflare Worker URL — same env hook as Settings.jsx. Drives /pp-workflows
// (list this agent's workflows) + /pp-enroll-manual (fire one workflow now).
const WORKER_URL = (import.meta.env.VITE_CRM_WORKER_URL
  || 'https://infinite-crm-webhook.murrayhealthadvising.workers.dev').replace(/\/+$/, '')

// Manual workflow enrollment button — pick any of the lead-owner's PitchPrfct
// workflows and drop this lead into it RIGHT NOW (no delay, no queue). Used
// occasionally; lives in two surfaces:
//   • LeadDetail header  — full size "Enroll" with label
//   • Pipeline card      — compact icon-only ⚡ button
// Pass `compact` to switch to the icon-only Pipeline variant. On Pipeline cards
// the parent passes `onOpen` so we can stopPropagation and not trigger the
// card's own click handler (which opens the drawer).
export default function ManualEnrollButton({ lead, compact = false }) {
  const [open, setOpen] = useState(false)
  const [workflows, setWorkflows] = useState(null) // null = not loaded yet
  const [loadingList, setLoadingList] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const ref = useRef(null)
  const agentId = lead?.user_id || lead?.agent_id

  // Load workflows the first time the menu opens. Cached in state thereafter.
  useEffect(() => {
    if (!open || workflows || !agentId) return
    setLoadingList(true); setError(null)
    fetch(`${WORKER_URL}/pp-workflows?agent_id=${encodeURIComponent(agentId)}`)
      .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => {
        if (!ok) { setError(j?.error || 'Failed to load workflows'); return }
        const rows = (j && j.data && (j.data.rows || j.data)) || j.rows || (Array.isArray(j) ? j : [])
        setWorkflows(Array.isArray(rows) ? rows : [])
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoadingList(false))
  }, [open, agentId, workflows])

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const enroll = async (wf, e) => {
    if (e) { e.stopPropagation(); e.preventDefault() }
    if (!wf?.id || !agentId || busyId) return
    setBusyId(wf.id); setError(null); setSuccess(null)
    try {
      const r = await fetch(`${WORKER_URL}/pp-enroll-manual`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, lead_id: lead.id, workflow_id: wf.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setError(j.error || `HTTP ${r.status}`); return }
      setSuccess(wf.name || 'workflow')
      setTimeout(() => { setOpen(false); setSuccess(null) }, 1500)
    } catch (e) { setError(String(e)) }
    finally { setBusyId(null) }
  }

  // stopPropagation on the toggle click so the Pipeline card's onClick (which
  // opens the lead drawer) doesn't fire when you tap Enroll
  const toggle = (e) => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o) }

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      {compact ? (
        <button onClick={toggle}
          title="Enroll in a PitchPrfct workflow"
          className="p-1.5 rounded-[6px] border border-[#1A2130] text-[#8899AA] hover:text-[#A78BFA] hover:border-[#A78BFA40] transition-colors">
          <Zap size={11} />
        </button>
      ) : (
        <button onClick={toggle}
          title="Enroll this lead in a PitchPrfct workflow now"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1A2130] text-sm text-[#8899AA] hover:text-white hover:border-[#2A3547]">
          <Zap size={13} /> Enroll
        </button>
      )}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-xl border border-[#1A2130] overflow-hidden z-30 shadow-xl"
          style={{ background: '#0E1318' }}
          onClick={e => e.stopPropagation()}>
          <div className="px-3 py-2 border-b border-[#1A2130]">
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#A78BFA]">Manual enroll</p>
            <p className="text-[10px] text-[#3A4A5A] mt-0.5">Sends now — no delay</p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loadingList && <p className="px-3 py-3 text-xs text-[#5A6A7A]">Loading workflows…</p>}
            {error && !loadingList && (
              <p className="px-3 py-3 text-xs text-[#EF4444] break-words">{error}</p>
            )}
            {success && (
              <p className="px-3 py-3 text-xs text-[#10B981] flex items-center gap-1.5">
                <Check size={12} /> Enrolled in “{success}”
              </p>
            )}
            {!loadingList && !error && !success && workflows && workflows.length === 0 && (
              <p className="px-3 py-3 text-xs text-[#5A6A7A]">No workflows found. Save your PitchPrfct API key in Settings first.</p>
            )}
            {!success && workflows && workflows.map(wf => {
              const paused = wf.status && String(wf.status).toLowerCase() !== 'active'
              return (
                <button key={wf.id} onClick={(e) => enroll(wf, e)} disabled={!!busyId || paused}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#1A2130] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-xs text-white truncate">{wf.name || '(unnamed)'}</span>
                  <span className="text-[10px] text-[#5A6A7A] flex-shrink-0 font-mono">
                    {busyId === wf.id ? 'enrolling…' : paused ? 'paused' : 'enroll →'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
