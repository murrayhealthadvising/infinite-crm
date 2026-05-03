import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { CheckCircle, X, Award } from 'lucide-react'

export default function SoldDetailsModal() {
  const { leads, updateLead, pendingSoldLeadId, setPendingSoldLeadId } = useApp()
  const lead = (leads || []).find(l => l.id === pendingSoldLeadId)

  const [what, setWhat] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (lead) setWhat(lead.plan_choice || '')
  }, [pendingSoldLeadId])

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = Math.max(80, ref.current.scrollHeight) + 'px'
    }
  }, [what])

  if (!pendingSoldLeadId || !lead) return null

  const fullName = lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'this lead'
  const firstName = fullName.split(' ')[0] || 'they'
  const close = () => setPendingSoldLeadId(null)

  const save = async () => {
    setSaving(true)
    if (typeof updateLead === 'function' && what.trim()) {
      try { await updateLead(lead.id, { plan_choice: what.trim() }) } catch (e) { console.error('save sold details:', e) }
    }
    setSaving(false)
    close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md rounded-2xl border border-[#00E5C340] overflow-hidden shadow-2xl"
        style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]" style={{ background: '#00E5C310' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <Award size={18} className="text-black" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Sold! 🎉</h2>
              <p className="text-xs text-[#8899AA]">What did {firstName} buy?</p>
            </div>
          </div>
          <button onClick={close} className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130]">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <textarea ref={ref}
            value={what}
            onChange={e => setWhat(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
            placeholder="e.g. USHEALTH SecureAdvantage, $425/mo, effective 6/1, family plan…"
            className="w-full px-3 py-3 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3] resize-none"
            style={{ minHeight: '80px' }}
            autoFocus />

          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <CheckCircle size={14} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={close} disabled={saving}
              className="px-4 py-2.5 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
