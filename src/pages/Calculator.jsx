import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Plus, Trash2, Save, Settings as SettingsIcon, X, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'

// USHA Association tiers — monthly cost (deducted from commissionable premium
// since you don't earn comm on association) AND quarterly residual the agent
// earns directly. Numbers from the official benefit chart.
const ASSOCIATION_TIERS = {
  none:     { label: 'None',         monthly: 0,     residual_q: 0 },
  ruby:     { label: 'Ruby',         monthly: 32.95, residual_q: 12.75 },
  sapphire: { label: 'Sapphire',     monthly: 42.95, residual_q: 16.50 },
  emerald:  { label: 'Emerald',      monthly: 52.95, residual_q: 27 },
  diamond:  { label: 'Diamond',      monthly: 62.95, residual_q: 39 },
  exec:     { label: 'Exec Diamond', monthly: 89.95, residual_q: 54 },
}
const TIER_KEYS = ['none','ruby','sapphire','emerald','diamond','exec']

const DEFAULT_PRODUCTS = [
  { key: 'med',    name: 'MED',    comm_pct: 75, advance_months: '', half: false, association_tier: 'diamond' },
  { key: 'ap',     name: 'AP',     comm_pct: 55, advance_months: '', half: false, association_tier: 'none' },
  { key: 'dental', name: 'Dental', comm_pct: 75, advance_months: '', half: false, association_tier: 'none' },
  { key: 'vision', name: 'Vision', comm_pct: 75, advance_months: '', half: false, association_tier: 'none' },
  { key: 'pa',     name: 'PA',     comm_pct: 75, advance_months: '', half: false, association_tier: 'none' },
  { key: 'sa',     name: 'SA',     comm_pct: 75, advance_months: '', half: false, association_tier: 'none' },
  { key: 'ha',     name: 'HA',     comm_pct: 75, advance_months: '', half: true,  association_tier: 'none' },
  { key: 'wraps',  name: 'Wraps',  comm_pct: 75, advance_months: '', half: true,  association_tier: 'none' },
]

// ── Week math: Friday 00:00 → next Friday 00:00 ────────────────────────────
// User's commission week ends Thursday night. Anything sold Friday onward is
// in the new week. If today is Sunday, "this week" started last Friday.
function weekStartFriday(now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  // getDay: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
  const day = d.getDay()
  const daysSinceFriday = (day - 5 + 7) % 7  // Fri=0, Sat=1, Sun=2, Mon=3, Tue=4, Wed=5, Thu=6
  d.setDate(d.getDate() - daysSinceFriday)
  return d
}
function weekEndExclusive(now = new Date()) {
  const start = weekStartFriday(now)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return end
}
function weekKeyOf(date) {
  const start = weekStartFriday(date)
  return start.toISOString().slice(0, 10)
}
function weekLabelOf(start) {
  const end = new Date(start); end.setDate(end.getDate() + 6)  // inclusive Thursday
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`
}

// ── Math ────────────────────────────────────────────────────────────────────
function effectiveAdvance(p, defaultAdvance) {
  if (p.half) return Math.max(0, Math.floor((Number(defaultAdvance) || 0) / 2))
  const m = Number(p.advance_months)
  return isFinite(m) && m > 0 ? m : Number(defaultAdvance) || 0
}
function calcLine(premium, product, defaultAdvance, tierKeyOverride) {
  const p = Number(premium) || 0
  const tierKey = tierKeyOverride || product.association_tier || 'none'
  const tier = ASSOCIATION_TIERS[tierKey] || ASSOCIATION_TIERS.none
  const monthly = Math.max(0, p - tier.monthly)
  const annualized = monthly * 12
  const pct = Math.max(0, Math.min(100, Number(product.comm_pct) || 0))
  const total = annualized * (pct / 100)
  const months = Math.max(0, Math.min(12, effectiveAdvance(product, defaultAdvance)))
  const advance = total * (months / 12)
  return {
    annualized, total, advance, reserve: total - advance,
    tier, tierKey,
    residual_q: tier.residual_q,
    residual_y: tier.residual_q * 4,
  }
}

const fmt = (n) => isFinite(n) ? '$' + Math.round(n).toLocaleString() : '$0'
const fmt2 = (n) => isFinite(n) ? '$' + Number(n).toFixed(2) : '$0.00'

export default function Calculator() {
  const { commissionPresets, saveCommissionPresets, commissionEntries, addCommissionEntry, deleteCommissionEntry } = useApp()
  const [editingPresets, setEditingPresets] = useState(false)

  // Read structure (object or legacy array)
  const config = useMemo(() => {
    const stored = commissionPresets
    if (Array.isArray(stored)) return { default_advance: 9, products: stored.length ? stored : DEFAULT_PRODUCTS }
    if (stored && typeof stored === 'object' && Array.isArray(stored.products)) {
      return {
        default_advance: Number(stored.default_advance) || 9,
        products: stored.products.length ? stored.products : DEFAULT_PRODUCTS,
      }
    }
    return { default_advance: 9, products: DEFAULT_PRODUCTS }
  }, [commissionPresets])

  // Per-row inputs for the deal currently being built
  const [customerName, setCustomerName] = useState('')
  const [inputs, setInputs] = useState({})
  const [saving, setSaving] = useState(false)
  const setRow = (key, patch) => setInputs(s => ({ ...s, [key]: { ...(s[key] || {}), ...patch } }))
  const clearForm = () => { setInputs({}); setCustomerName('') }

  // Live calc for the in-progress deal
  const previewItems = config.products.map(p => {
    const inp = inputs[p.key] || {}
    const c = calcLine(inp.premium, p, config.default_advance, inp.tier)
    return { ...p, premium: inp.premium || '', advance_effective: effectiveAdvance(p, config.default_advance), ...c, _override_tier: inp.tier || null }
  }).filter(r => Number(r.premium) > 0)
  const previewTotals = previewItems.reduce((a, r) => ({
    advance: a.advance + r.advance, reserve: a.reserve + r.reserve, residual_y: a.residual_y + r.residual_y, total: a.total + r.total,
  }), { advance: 0, reserve: 0, residual_y: 0, total: 0 })
  const hasPreview = previewItems.length > 0

  // Bucket saved entries by week
  const entries = Array.isArray(commissionEntries) ? commissionEntries : []
  const weekStart = weekStartFriday()
  const weekEnd = weekEndExclusive()
  const thisWeek = entries.filter(e => {
    const t = new Date(e.sold_at).getTime()
    return t >= weekStart.getTime() && t < weekEnd.getTime()
  })
  const pastWeeks = useMemo(() => {
    const past = entries.filter(e => new Date(e.sold_at).getTime() < weekStart.getTime())
    const map = new Map()
    for (const e of past) {
      const key = weekKeyOf(new Date(e.sold_at))
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(e)
    }
    return Array.from(map.entries())  // [[isoDate, entries[]]]
      .sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries, weekStart])

  const sumTotals = (items) => items.reduce((a, e) => ({
    advance: a.advance + (Number(e.totals?.advance) || 0),
    reserve: a.reserve + (Number(e.totals?.reserve) || 0),
    residual_y: a.residual_y + (Number(e.totals?.residual_y) || 0),
  }), { advance: 0, reserve: 0, residual_y: 0 })

  const weekTotals = sumTotals(thisWeek)

  const saveDeal = async () => {
    if (!hasPreview) return
    setSaving(true)
    const items = previewItems.map(r => ({
      product_key: r.key,
      product_name: r.name,
      premium: Number(r.premium) || 0,
      comm_pct: r.comm_pct,
      advance_months: r.advance_effective,
      tier_key: r.tierKey,
      tier_label: r.tier.label,
      tier_monthly: r.tier.monthly,
      total: r.total,
      advance: r.advance,
      reserve: r.reserve,
      residual_q: r.residual_q,
      residual_y: r.residual_y,
    }))
    await addCommissionEntry({
      customer_name: customerName.trim() || null,
      sold_at: new Date().toISOString(),
      items,
      totals: previewTotals,
    })
    clearForm()
    setSaving(false)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130]">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Commission Calculator</h1>
          <p className="text-xs text-[#5A6A7A] mt-0.5">
            Week of <span className="text-white font-mono">{weekLabelOf(weekStart)}</span>
            <span className="text-[#3A4A5A]"> · Fri – Thu</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditingPresets(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547]">
            <SettingsIcon size={13} /> My commission structure
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-5">

        {/* Big weekly tiles — totals from saved deals only */}
        <div className="grid grid-cols-3 gap-3">
          <TotalCard label="This week's check" value={fmt(weekTotals.advance)} sub={`${thisWeek.length} deal${thisWeek.length === 1 ? '' : 's'} this week`} highlight />
          <TotalCard label="Reserve held" value={fmt(weekTotals.reserve)} sub="vests as policies stay active" />
          <TotalCard label="Annual residual" value={fmt(weekTotals.residual_y)} sub="from association · paid quarterly" residual />
        </div>

        {/* Add-a-deal form */}
        <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
          <div className="px-4 py-3 border-b border-[#1A2130] flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Log a new deal</h2>
            <input value={customerName} onChange={e => setCustomerName(e.target.value)}
              placeholder="Customer name (optional)"
              className="bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1 text-xs text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340] w-56" />
          </div>

          <div className="hidden lg:grid grid-cols-[100px_1fr_140px_auto] gap-3 px-4 py-2 border-b border-[#1A2130] text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">
            <div>Product</div>
            <div>Premium /mo</div>
            <div>Association tier</div>
            <div className="text-right w-32">Advance</div>
          </div>

          {config.products.map(p => {
            const inp = inputs[p.key] || {}
            const c = calcLine(inp.premium, p, config.default_advance, inp.tier)
            return (
              <div key={p.key} className="grid grid-cols-2 lg:grid-cols-[100px_1fr_140px_auto] gap-3 px-4 py-2.5 border-b border-[#1A2130] last:border-0 items-center">
                <div className="col-span-2 lg:col-span-1">
                  <span className="text-sm font-semibold text-white">{p.name}</span>
                  <div className="text-[10px] font-mono text-[#5A6A7A] mt-0.5">
                    {p.comm_pct}% · {effectiveAdvance(p, config.default_advance)}mo {p.half && <span className="text-[#A78BFA]">½</span>}
                  </div>
                </div>
                <CalcInput value={inp.premium || ''} onChange={v => setRow(p.key, { premium: v })} placeholder="0" prefix="$" label="Premium" />
                <div>
                  <select value={inp.tier || p.association_tier || 'none'} onChange={e => setRow(p.key, { tier: e.target.value })}
                    className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#00E5C340]">
                    {TIER_KEYS.map(k => (
                      <option key={k} value={k}>
                        {ASSOCIATION_TIERS[k].label}{ASSOCIATION_TIERS[k].monthly > 0 ? ` · $${ASSOCIATION_TIERS[k].monthly}` : ''}
                      </option>
                    ))}
                  </select>
                  {c.residual_q > 0 && Number(inp.premium) > 0 && (
                    <p className="text-[10px] font-mono text-[#A78BFA] mt-0.5">+ {fmt2(c.residual_q)}/qtr</p>
                  )}
                </div>
                <div className="text-right w-32">
                  <p className="lg:hidden text-[10px] font-mono uppercase text-[#5A6A7A]">Advance</p>
                  <p className="text-sm font-mono" style={{ color: c.advance > 0 ? '#00E5C3' : '#3A4A5A' }}>{fmt(c.advance)}</p>
                  {c.reserve > 0 && <p className="text-[10px] font-mono text-[#5A6A7A]">res {fmt(c.reserve)}</p>}
                </div>
              </div>
            )
          })}

          {/* Footer: deal preview totals + Add-to-week button */}
          <div className="px-4 py-3 border-t border-[#1A2130] flex items-center justify-between gap-3" style={{ background: '#080B0F40' }}>
            <div className="text-xs text-[#8899AA]">
              {hasPreview ? (
                <>This deal: <span className="font-mono text-[#00E5C3]">{fmt(previewTotals.advance)} advance</span>
                  {previewTotals.residual_y > 0 && <span className="text-[#A78BFA]"> · {fmt(previewTotals.residual_y)}/yr res</span>}
                </>
              ) : (
                <span className="text-[#5A6A7A]">Type a premium on any product line to start logging a deal.</span>
              )}
            </div>
            <div className="flex gap-2">
              {hasPreview && (
                <button onClick={clearForm}
                  className="px-3 py-1.5 rounded-lg text-xs text-[#5A6A7A] hover:text-white border border-[#1A2130]">
                  <RotateCcw size={11} className="inline -mt-0.5" /> Clear
                </button>
              )}
              <button onClick={saveDeal} disabled={!hasPreview || saving}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-black disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                <Plus size={12} /> {saving ? 'Saving…' : 'Add to this week'}
              </button>
            </div>
          </div>
        </div>

        {/* This week's deals */}
        <div>
          <h3 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-2">
            This week's deals · {weekLabelOf(weekStart)}
          </h3>
          {thisWeek.length === 0 ? (
            <div className="border border-dashed border-[#1A2130] rounded-lg py-8 text-center text-sm text-[#5A6A7A]">
              No deals logged yet — add your first sale above.
            </div>
          ) : (
            <div className="space-y-2">
              {thisWeek.map(e => <EntryRow key={e.id} entry={e} onDelete={deleteCommissionEntry} />)}
            </div>
          )}
        </div>

        {/* Past weeks */}
        {pastWeeks.length > 0 && (
          <details className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
            <summary className="px-4 py-3 cursor-pointer text-xs font-mono uppercase tracking-wider text-[#5A6A7A] hover:text-white select-none">
              Past weeks ({pastWeeks.length})
            </summary>
            <div className="divide-y divide-[#1A2130]">
              {pastWeeks.map(([key, items]) => {
                const start = new Date(key + 'T00:00:00')
                const t = sumTotals(items)
                return (
                  <details key={key} className="px-4 py-3" open={false}>
                    <summary className="cursor-pointer flex items-center justify-between gap-3">
                      <span className="text-sm text-white">{weekLabelOf(start)}</span>
                      <div className="flex items-center gap-3 text-xs font-mono">
                        <span className="text-[#5A6A7A]">{items.length} deal{items.length === 1 ? '' : 's'}</span>
                        <span className="text-[#00E5C3]">{fmt(t.advance)}</span>
                        {t.residual_y > 0 && <span className="text-[#A78BFA]">+{fmt(t.residual_y)}/y</span>}
                      </div>
                    </summary>
                    <div className="mt-3 space-y-2">
                      {items.map(e => <EntryRow key={e.id} entry={e} onDelete={deleteCommissionEntry} />)}
                    </div>
                  </details>
                )
              })}
            </div>
          </details>
        )}
      </div>

      {editingPresets && (
        <StructureModal config={config}
          onClose={() => setEditingPresets(false)}
          onSave={async (next) => { await saveCommissionPresets(next); setEditingPresets(false) }} />
      )}
    </div>
  )
}

function EntryRow({ entry, onDelete }) {
  const [open, setOpen] = useState(false)
  const t = entry.totals || {}
  const items = Array.isArray(entry.items) ? entry.items : []
  return (
    <div className="rounded-lg border border-[#1A2130]" style={{ background: '#080B0F' }}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#0E1318]">
        {open ? <ChevronDown size={12} className="text-[#5A6A7A]" /> : <ChevronRight size={12} className="text-[#5A6A7A]" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate">{entry.customer_name || `Deal · ${items.map(i => i.product_name).join(' + ') || 'no products'}`}</p>
          <p className="text-[10px] font-mono text-[#5A6A7A]">
            {format(new Date(entry.sold_at), 'EEE MMM d · h:mm a')} · {items.length} item{items.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-mono text-[#00E5C3]">{fmt(t.advance || 0)}</p>
          {t.residual_y > 0 && <p className="text-[10px] font-mono text-[#A78BFA]">+{fmt(t.residual_y)}/y</p>}
        </div>
        <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this deal?')) onDelete(entry.id) }}
          className="p-1.5 rounded text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415]">
          <Trash2 size={11} />
        </button>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-[#1A2130]">
          <table className="w-full text-xs">
            <thead className="text-[10px] font-mono uppercase text-[#5A6A7A]">
              <tr>
                <th className="text-left py-1">Product</th>
                <th className="text-right py-1">Premium</th>
                <th className="text-right py-1">Tier</th>
                <th className="text-right py-1">Advance</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="text-[#8899AA]">
                  <td className="py-1 text-white">{it.product_name}</td>
                  <td className="py-1 text-right font-mono">${it.premium}</td>
                  <td className="py-1 text-right text-[10px]">{it.tier_label || 'None'}</td>
                  <td className="py-1 text-right font-mono text-[#00E5C3]">{fmt(it.advance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CalcInput({ value, onChange, placeholder, prefix, label }) {
  return (
    <div>
      <p className="lg:hidden text-[10px] font-mono uppercase text-[#5A6A7A] mb-0.5">{label}</p>
      <div className="flex items-center bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 focus-within:border-[#00E5C340]">
        {prefix && <span className="text-xs text-[#5A6A7A] mr-1">{prefix}</span>}
        <input value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} inputMode="decimal"
          className="flex-1 bg-transparent text-sm text-white placeholder-[#3A4A5A] focus:outline-none min-w-0" />
      </div>
    </div>
  )
}

function TotalCard({ label, value, sub, highlight, residual }) {
  const accent = highlight ? '#00E5C3' : residual ? '#A78BFA' : 'white'
  const bg = highlight ? '#00E5C310' : residual ? '#A78BFA10' : '#0E1318'
  const border = highlight ? '#00E5C360' : residual ? '#A78BFA40' : '#1A2130'
  return (
    <div className="rounded-xl border p-5" style={{ background: bg, borderColor: border }}>
      <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">{label}</p>
      <p className="text-2xl lg:text-3xl font-display font-bold" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-[10px] text-[#3A4A5A] mt-1">{sub}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Structure modal (unchanged from prior commit)
// ─────────────────────────────────────────────────────────────────────────────
function StructureModal({ config, onClose, onSave }) {
  const [defaultAdvance, setDefaultAdvance] = useState(config.default_advance)
  const [products, setProducts] = useState(config.products)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const setProduct = (i, patch) => setProducts(ps => ps.map((p, idx) => idx === i ? { ...p, ...patch } : p))
  const addProduct = () => setProducts(ps => [...ps, {
    key: 'p_' + Date.now(),
    name: '', comm_pct: 75, advance_months: '', half: false, association_tier: 'none',
  }])
  const removeProduct = (i) => setProducts(ps => ps.filter((_, idx) => idx !== i))

  const save = async () => {
    setSaving(true); setSaveMsg('')
    const cleaned = products
      .filter(p => p.name && p.name.trim())
      .map(p => ({
        key: p.key || 'p_' + Math.random().toString(36).slice(2, 8),
        name: p.name.trim(),
        comm_pct: Math.max(0, Math.min(100, Number(p.comm_pct) || 0)),
        advance_months: p.half ? '' : (Number(p.advance_months) || ''),
        half: !!p.half,
        association_tier: TIER_KEYS.includes(p.association_tier) ? p.association_tier : 'none',
      }))
    try { await onSave({ default_advance: Number(defaultAdvance) || 0, products: cleaned }) }
    catch (e) { setSaveMsg('Save failed: ' + (e.message || e)); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-[#1A2130] overflow-hidden flex flex-col" style={{ background: '#0E1318', maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130] flex-shrink-0">
          <h3 className="text-base font-semibold text-white">My commission structure</h3>
          <button onClick={onClose} className="text-[#5A6A7A] hover:text-white"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="rounded-lg border border-[#1A2130] p-3" style={{ background: '#080B0F' }}>
            <label className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">Your default advance months</label>
            <div className="flex items-center gap-3">
              <input value={defaultAdvance} onChange={e => setDefaultAdvance(e.target.value)}
                inputMode="decimal" placeholder="9"
                className="w-24 bg-[#0E1318] border border-[#1A2130] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
              <p className="text-xs text-[#5A6A7A]">months — base for HA + Wraps (auto half = {Math.floor((Number(defaultAdvance) || 0) / 2)}mo).</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] px-2">
              <div className="col-span-3">Product</div>
              <div className="col-span-2">Comm %</div>
              <div className="col-span-2">Advance mo</div>
              <div className="col-span-3">Default tier</div>
              <div className="col-span-1 text-center">½</div>
              <div className="col-span-1"></div>
            </div>
            {products.map((p, i) => (
              <div key={p.key} className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F' }}>
                <input value={p.name} onChange={e => setProduct(i, { name: e.target.value })}
                  placeholder="Product"
                  className="col-span-3 bg-[#0E1318] border border-[#1A2130] rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
                <input value={p.comm_pct} onChange={e => setProduct(i, { comm_pct: e.target.value })}
                  placeholder="75" inputMode="decimal"
                  className="col-span-2 bg-[#0E1318] border border-[#1A2130] rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
                <div className="col-span-2">
                  {p.half ? (
                    <span className="text-xs text-[#A78BFA] block py-1">½ auto</span>
                  ) : (
                    <input value={p.advance_months} onChange={e => setProduct(i, { advance_months: e.target.value })}
                      placeholder={String(defaultAdvance || 9)} inputMode="decimal"
                      className="w-full bg-[#0E1318] border border-[#1A2130] rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
                  )}
                </div>
                <select value={p.association_tier || 'none'} onChange={e => setProduct(i, { association_tier: e.target.value })}
                  className="col-span-3 bg-[#0E1318] border border-[#1A2130] rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-[#00E5C340]">
                  {TIER_KEYS.map(k => (<option key={k} value={k}>{ASSOCIATION_TIERS[k].label}</option>))}
                </select>
                <label className="col-span-1 flex items-center justify-center cursor-pointer" title="Half of default advance">
                  <input type="checkbox" checked={!!p.half} onChange={e => setProduct(i, { half: e.target.checked })} className="accent-[#A78BFA]" />
                </label>
                <button onClick={() => removeProduct(i)} className="col-span-1 p-1.5 rounded text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415] flex justify-center">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button onClick={addProduct}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-dashed border-[#2A3547] text-[#8899AA] hover:text-white hover:border-[#00E5C340]">
              <Plus size={13} /> Add product
            </button>
          </div>

          <div className="rounded-lg border border-[#1A2130] p-3 text-[10px] text-[#5A6A7A]" style={{ background: '#080B0F' }}>
            <p className="text-[#8899AA] mb-1"><strong>Association tiers</strong> (USHA reference)</p>
            <table className="w-full font-mono">
              <thead className="text-[#3A4A5A]">
                <tr><th className="text-left">Tier</th><th className="text-right">$/mo</th><th className="text-right">Qtr residual</th></tr>
              </thead>
              <tbody>
                {TIER_KEYS.filter(k => k !== 'none').map(k => (
                  <tr key={k} className="text-[#8899AA]">
                    <td>{ASSOCIATION_TIERS[k].label}</td>
                    <td className="text-right">${ASSOCIATION_TIERS[k].monthly}</td>
                    <td className="text-right text-[#A78BFA]">${ASSOCIATION_TIERS[k].residual_q}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {saveMsg && <p className="text-xs text-[#EF4444]">{saveMsg}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#1A2130] flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-black disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Save size={13} /> {saving ? 'Saving…' : 'Save structure'}
          </button>
        </div>
      </div>
    </div>
  )
}
