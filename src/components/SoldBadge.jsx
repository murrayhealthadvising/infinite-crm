import { Award, DollarSign, Calendar } from 'lucide-react'

// Parse a YYYY-MM-DD (or ISO datetime) string as a LOCAL date and return a
// MM/DD/YYYY / MM/DD label — never let the browser interpret bare YYYY-MM-DD
// as UTC midnight (which slips the date west of the Prime Meridian).
function fmtEffective(raw, { yearAlways = false, includeYear = true } = {}) {
  if (!raw) return null
  const [y, m, d] = String(raw).slice(0, 10).split('-').map(n => parseInt(n, 10))
  if (!y || !m || !d) return null
  const mm = String(m).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  // Same-year policies drop the year on compact cards to save space,
  // unless yearAlways is set (detail hero).
  const nowYear = new Date().getFullYear()
  if (yearAlways || (includeYear && y !== nowYear)) return `${mm}/${dd}/${y}`
  return `${mm}/${dd}`
}

// Visible "Sold" badge — plan + monthly premium + effective date, prominent.
// Used wherever a sold lead is shown: Pipeline cards, Leads list cards,
// LeadDetail header. Skips itself unless the lead's stage is sold and there's
// something to show.
//
// `size`:
//   compact — for inline card placement (Pipeline / Leads cards). One line.
//   detail  — for LeadDetail's hero placement. Larger, two lines.
export default function SoldBadge({ lead, size = 'compact' }) {
  if (!lead || lead.stage !== 'sold') return null
  const plan = (lead.plan_choice || '').trim()
  const premium = Number(lead.premium) || 0
  const effLabelCompact = fmtEffective(lead.effective_date)
  const effLabelDetail  = fmtEffective(lead.effective_date, { yearAlways: true })
  if (!plan && !premium && !effLabelCompact) return null

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
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#00E5C3]">Sold</span>
            {moneyLabel && (
              <span className="text-base font-bold text-[#00E5C3]">{moneyLabel}</span>
            )}
            {effLabelDetail && (
              <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded"
                style={{ background: '#3B82F615', color: '#3B82F6', border: '1px solid #3B82F640' }}
                title={`Policy effective ${effLabelDetail}`}>
                <Calendar size={10} /> Eff {effLabelDetail}
              </span>
            )}
          </div>
          {plan && <p className="text-sm text-[#C0D0E0] whitespace-pre-wrap leading-snug">{plan}</p>}
        </div>
      </div>
    )
  }

  // compact — single-row, big enough to spot on a busy card
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border mb-2 flex-wrap"
      style={{ background: '#00E5C310', borderColor: '#00E5C340' }}
      title={[plan, effLabelDetail ? `Effective ${effLabelDetail}` : null].filter(Boolean).join(' · ') || undefined}>
      <Award size={11} className="text-[#00E5C3] flex-shrink-0" />
      {moneyLabel && (
        <span className="text-xs font-bold text-[#00E5C3] tabular-nums flex-shrink-0">{moneyLabel}</span>
      )}
      {effLabelCompact && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-mono flex-shrink-0 tabular-nums"
          style={{ color: '#8AB4F8' }}
          title={`Policy effective ${effLabelDetail}`}>
          <Calendar size={9} /> {effLabelCompact}
        </span>
      )}
      {plan && (
        <span className="text-xs text-[#C0D0E0] truncate flex-1 min-w-0">{plan}</span>
      )}
    </div>
  )
}
