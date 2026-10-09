import { useState, useEffect, useRef } from 'react'
import { Zap, ChevronDown, Check, X } from 'lucide-react'

// Cloudflare Worker URL — same env hook used elsewhere.
const WORKER_URL = (import.meta.env.VITE_CRM_WORKER_URL
  || 'https://infinite-crm-webhook.murrayhealthadvising.workers.dev').replace(/\/+$/, '')

// Bulk-enroll multiple leads into a single PitchPrfct workflow. Shows up on
// the Leads page toolbar whenever one or more leads are selected. Picks the
// workflow once, then fires /pp-enroll-manual sequentially for every selected
// lead — sequential rather than parallel so PP's rate limiter doesn't start
// rejecting mid-batch and leave the agent guessing which leads landed.
//
// Props:
//   leads     — array of selected { id, user_id } objects
//   agentId   — the signed-in user's id (used as agent_id for every enroll)
//   onDone    — optional callback after the batch finishes
export default function BulkEnrollButton({ leads = [], agentId, onDone }) {
  const [open, setOpen] = useState(false)
  const [workflows, setWorkflows] = useState(null)
  const [loadingList, setLoadingList] = useState(false)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)  // {done, total, failures: []}
  const ref = useRef(null)

  // Load workflows the first time the menu opens.
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

  // Click-outside to close.
  useEffect(() => {
    if (!open) return
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const runBatch = async (wf) => {
    if (!wf?.id || progress) return
    const total = leads.length
    const failures = []
    setProgress({ done: 0, total, failures: [] })
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i]
      try {
        const r = await fetch(`${WORKER_URL}/pp-enroll-manual`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agent_id: lead.user_id || agentId,
            lead_id: lead.id,
            workflow_id: wf.id,
            workflow_name: wf.name || '',
          }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.ok) failures.push({ lead_id: lead.id, reason: j.error || `HTTP ${r.status}` })
      } catch (e) {
        failures.push({ lead_id: lead.id, reason: String(e) })
      }
      setProgress({ done: i + 1, total, failures: [...failures] })
    }
    // Brief pause so the final count is visible, then close.
    setTimeout(() => {
      setOpen(false); setProgress(null)
      if (typeof onDone === 'function') onDone({ workflow: wf, total, failures })
    }, 1800)
  }

  if (!leads.length) return null

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#A78BFA40] text-[#A78BFA] hover:bg-[#A78BFA15] transition-colors"
        title={`Enroll ${leads.length} selected lead${leads.length === 1 ? '' : 's'} in a PitchPrfct workflow`}>
        <Zap size={13} /> Enroll · {leads.length}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 rounded-xl border border-[#1A2130] overflow-hidden z-30 shadow-xl"
          style={{ background: '#0E1318' }}>
          <div className="px-3 py-2 border-b border-[#1A2130] flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#A78BFA]">
                Enroll {leads.length} in…
              </p>
              <p className="text-[10px] text-[#3A4A5A] mt-0.5">Fires one at a time</p>
            </div>
            {progress && (
              <span className="text-[11px] font-mono text-[#C0D0E0]">
                {progress.done}/{progress.total}
              </span>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loadingList && <p className="px-3 py-3 text-xs text-[#5A6A7A]">Loading workflows…</p>}
            {error && !loadingList && (
              <p className="px-3 py-3 text-xs text-[#EF4444] break-words">{error}</p>
            )}
            {!loadingList && !error && workflows && workflows.length === 0 && (
              <p className="px-3 py-3 text-xs text-[#5A6A7A]">
                No workflows found. Save your PitchPrfct API key in Settings first.
              </p>
            )}
            {!progress && workflows && workflows.map(wf => {
              const paused = wf.status && String(wf.status).toLowerCase() !== 'active'
              return (
                <button key={wf.id} onClick={() => runBatch(wf)} disabled={paused}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#1A2130] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-xs text-white truncate">{wf.name || '(unnamed)'}</span>
                  <span className="text-[10px] text-[#5A6A7A] flex-shrink-0 font-mono">
                    {paused ? 'paused' : 'enroll →'}
                  </span>
                </button>
              )
            })}
            {progress && (
              <div className="px-3 py-3 space-y-2">
                <div className="flex items-center gap-2 text-xs text-[#C0D0E0]">
                  <Zap size={12} className="text-[#A78BFA]" />
                  <span>
                    {progress.done === progress.total
                      ? `Done — ${progress.total - progress.failures.length}/${progress.total} enrolled`
                      : `Enrolling ${progress.done}/${progress.total}…`}
                  </span>
                </div>
                {progress.failures.length > 0 && (
                  <div className="rounded-md border border-[#EF444430] p-2 bg-[#EF444408]">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-[#EF4444] mb-1 flex items-center gap-1">
                      <X size={10} /> {progress.failures.length} failed
                    </p>
                    <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                      {progress.failures.slice(0, 6).map((f, i) => (
                        <li key={i} className="text-[10px] text-[#8899AA] break-words">
                          · {f.reason}
                        </li>
                      ))}
                      {progress.failures.length > 6 && (
                        <li className="text-[10px] text-[#5A6A7A]">
                          + {progress.failures.length - 6} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}
                {progress.done === progress.total && progress.failures.length === 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] text-[#10B981]">
                    <Check size={12} /> All leads enrolled
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
