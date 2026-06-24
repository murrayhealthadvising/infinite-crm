import { Award, DollarSign } from 'lucide-react'

// Visible "Sold" badge — plan + monthly premium, prominent. Used wherever a
// sold lead is shown: Pipeline cards, Leads list cards, LeadDetail header.
// Skips itself unless the lead's stage is sold and there's something to show.
//
// `size`:
//   compact — for inline card placement (Pipeline / Leads cards). One line.
//   detail  — for LeadDetail's hero placement. Larger, two lines.
export default function SoldBadge({ lead, size = 'compact' }) {
  if (!lead || lead.stage !== 'sold') return null
  const plan = (lead.plan_choice || '').trim()
  const premium = Number(lead.premium) || 0
  if (!plan && !premium) return null

  const moneyLabel = premium ? `$${premium.toLocaleString()}/mo` : null

  if (size === 'detail') {
    return (
      <div className="p-4 rounded-xl border border-[#00E5C340] flex items-start gap-3"
        style={{ background: 'linear-gradient(135deg, #00E5C310, #3B82F608)' }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          <Award size={16} className="text-black" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#00E5C3]">Sold</span>
            {moneyLabel && (
              <span className="text-base font-bold text-[#00E5C3]">{moneyLabel}</span>
            )}
          </div>
          {plan && <p className="text-sm text-[#C0D0E0] whitespace-pre-wrap leading-snug">{plan}</p>}
        </div>
      </div>
    )
  }

  // compact — single-row, big enough to spot on a busy card
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border mb-2"
      style={{ background: '#00E5C310', borderColor: '#00E5C340' }}
      title={plan || undefined}>
      <Award size={11} className="text-[#00E5C3] flex-shrink-0" />
      {moneyLabel && (
        <span className="text-xs font-bold text-[#00E5C3] tabular-nums">{moneyLabel}</span>
      )}
      {plan && (
        <span className="text-xs text-[#C0D0E0] truncate flex-1 min-w-0">{plan}</span>
      )}
    </div>
  )
}
