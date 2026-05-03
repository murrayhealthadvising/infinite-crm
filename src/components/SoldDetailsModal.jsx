import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { CheckCircle, X, Award, DollarSign, Calendar } from 'lucide-react'

// Common products / carriers — quick-pick chips, plus free-text fallback
const COMMON_CARRIERS = [
  'USHEALTH Advisors',
  'Aetna',
  'United Healthcare',
  'BlueCross BlueShield',
  'Cigna',
  'Humana',
  'Ambetter',
  'Oscar',
]
const COMMON_PLANS = [
  'SecureAdvantage',
  'PremierAdvantage',
  'HealthAccess III',
  'Premier Choice',
  'Bronze',
  'Silver',
  'Gold',
  'Catastrophic',
]

export default function SoldDetailsModal() {
  const { leads, updateLead, pendingSoldLeadId, setPendingSoldLeadId } = useApp()
  const lead = (leads || []).find(l => l.id === pendingSoldLeadId)

  const [carrier, setCarrier] = useState('')
  const [plan, setPlan] = useState('')
  const [premium, setPremium] = useState('')
  const [effective, setEffective] = useState('')
  const [policyNumber, setPolicyNumber] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (lead) {
      setCarrier(lead.carrier || '')
      setPlan(lead.plan_choice || '')
      setPremium(lead.premium ? String(lead.premium) : '')
      setEffective(lead.effective_date || '')
      setPolicyNumber(lead.external_id || '')
    }
  }, [pendingSoldLeadId])

  if (!pendingSoldLeadId || !lead) return null

  const fullName = lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'this lead'

  const close = () => { setPendingSoldLeadId(null) }

  const save = async () => {
    setSaving(true)
    const updates = {}
    if (carrier.trim()) updates.carrier = carrier.trim()
    if (plan.trim()) updates.plan_choice = plan.trim()
    if (premium) updates.premium = parseInt(String(premium).replace(/[^0-9.\-]/g, '')) || null
    if (effective) updates.effective_date = effective
    if (policyNumber.trim()) updates.external_id = policyNumber.trim()
    if (typeof updateLead === 'function' && Object.keys(updates).length > 0) {
      try { await updateLead(lead.id, updates) } catch (e) { console.error('save sold details:', e) }
    }
    setSaving(false)
    close()
  }

  const skip = () => { close() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={skip} />
      <div className="relative w-full max-w-lg rounded-2xl border border-[#00E5C340] overflow-hidden shadow-2xl"
        style={{ background: '#0E1318' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]" style={{ background: '#00E5C310' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <Award size={18} className="text-black" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Sold! 🎉 What did {fullName.split(' ')[0] || 'they'} buy?</h2>
              <p className="text-xs text-[#8899AA]">So you know what to service later. Skip if you'll fill it in later.</p>
            </div>
          </div>
          <button onClick={skip} className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130]">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Carrier */}
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Carrier</label>
            <input value={carrier} onChange={e => setCarrier(e.target.value)}
              placeholder="e.g. USHEALTH Advisors"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3]" />
            <div className="flex flex-wrap gap-1 mt-2">
              {COMMON_CARRIERS.map(c => (
                <button key={c} type="button" onClick={() => setCarrier(c)}
                  className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#00E5C340]">
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Plan */}
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Plan / Product</label>
            <input value={plan} onChange={e => setPlan(e.target.value)}
              placeholder="e.g. SecureAdvantage"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3]" />
            <div className="flex flex-wrap gap-1 mt-2">
              {COMMON_PLANS.map(p => (
                <button key={p} type="button" onClick={() => setPlan(p)}
                  className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#00E5C340]">
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Premium + Effective Date side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block flex items-center gap-1">
                <DollarSign size={11} /> Premium /mo
              </label>
              <input type="number" value={premium} onChange={e => setPremium(e.target.value)}
                placeholder="e.g. 425"
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3]" />
            </div>
            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block flex items-center gap-1">
                <Calendar size={11} /> Effective Date
              </label>
              <input type="date" value={effective} onChange={e => setEffective(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3]" />
            </div>
          </div>

          {/* Policy number (optional) */}
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Policy # (optional)</label>
            <input value={policyNumber} onChange={e => setPolicyNumber(e.target.value)}
              placeholder="Carrier-issued policy or member ID"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3]" />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <CheckCircle size={14} /> {saving ? 'Saving…' : 'Save Sale Details'}
            </button>
            <button onClick={skip} disabled={saving}
              className="px-4 py-2.5 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">
              Fill in later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
