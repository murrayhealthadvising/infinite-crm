import { useState, useEffect } from 'react'
import { Clock, Check, X } from 'lucide-react'
import { useApp } from '../context/AppContext'

// Live countdown for a lead waiting out its PitchPrfct delay window.
//   ✓  send now — skip the wait (enrolls within ~1 min)
//   ✕  cancel — stop the auto-text entirely
// Renders nothing unless the lead is currently queued.
export default function PitchCountdown({ leadId, className = '' }) {
  const { pitchQueue, cancelPitchQueue, bypassPitchQueue } = useApp()
  const q = pitchQueue && pitchQueue[leadId]
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!q) return
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [q])

  if (!q || !q.enroll_at) return null

  const secsLeft = Math.round((new Date(q.enroll_at).getTime() - now) / 1000)
  const live = secsLeft > 0
  const mm = Math.max(0, Math.floor(secsLeft / 60))
  const ss = Math.max(0, secsLeft % 60)

  const act = (fn) => async (e) => {
    e.stopPropagation(); e.preventDefault()
    if (busy) return
    setBusy(true)
    await fn(leadId)
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${className}`}
      style={{ background: '#F59E0B14', color: '#F59E0B', borderColor: '#F59E0B40' }}
      title="PitchPrfct auto-text countdown">
      <Clock size={10} className="flex-shrink-0" />
      {live ? `Auto-text in ${mm}:${String(ss).padStart(2, '0')}` : 'Sending…'}
      {live && (
        <>
          <button
            onClick={act(bypassPitchQueue)}
            disabled={busy}
            className="ml-0.5 inline-flex items-center rounded hover:bg-[#F59E0B26] disabled:opacity-40"
            title="Send now — skip the wait">
            <Check size={11} />
          </button>
          <button
            onClick={act(cancelPitchQueue)}
            disabled={busy}
            className="inline-flex items-center rounded hover:bg-[#F59E0B26] disabled:opacity-40"
            title="Cancel the auto-text">
            <X size={11} />
          </button>
        </>
      )}
    </span>
  )
}
