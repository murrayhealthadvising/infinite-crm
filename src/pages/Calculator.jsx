import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Plus, Trash2, Save, Settings as SettingsIcon, X, RotateCcw } from 'lucide-react'

// USHA Association tiers — each has a monthly price (deducted from commissionable
// premium since you don't earn comm on association) AND a quarterly residual
// the agent earns directly. Numbers from the official benefit chart.
const ASSOCIATION_TIERS = {
  none:     { label: 'None',         monthly: 0,     residual_q: 0 },
  ruby:     { label: 'Ruby',         monthly: 32.95, residual_q: 12.75 },
  sapphire: { label: 'Sapphire',     monthly: 42.95, residual_q: 16.50 },
  emerald:  { label: 'Emerald',      monthly: 52.95, residual_q: 27 },
  diamond:  { label: 'Diamond',      monthly: 62.95, residual_q: 39 },
  exec:     { label: 'Exec Diamond', monthly: 89.95, residual_q: 54 },
}
const TIER_KEYS = ['none','ruby','sapphire','emerald','diamond','exec']

// Default product list for fresh agents. HA + Wraps auto-half advance.
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

function effectiveAdvance(p, defaultAdvance) {
  if (p.half) return Math.max(0, Math.floor((Number(defaultAdvance) || 0) / 2))
  const m = Number(p.advance_months)
  return isFinite(m) && m > 0 ? m : Number(defaultAdvance) || 0
}

function calcRow(premium, product, defaultAdvance, tierKeyOverride) {
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
  const { commissionPresets, saveCommissionPresets } = useApp()
  const [editingPresets, setEditingPresets] = useState(false)

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

  // Per-row inputs: { [key]: { premium, tier } } — tier overrides product default
  const [inputs, setInputs] = useState({})
  const setRow = (key, patch) => setInputs(s => ({ ...s, [key]: { ...(s[key] || {}), ...patch } }))
  const reset = () => setInputs({})

  const rows = config.products.map(p => {
    const inp = inputs[p.key] || {}
    const tierOverride = inp.tier || null
    const c = calcRow(inp.premium, p, config.default_advance, tierOverride)
    return { ...p, premium: inp.premium || '', advance_effective: effectiveAdvance(p, config.default_advance), ...c }
  })

  const totals = rows.reduce((a, r) => ({
    advance: a.advance + r.advance,
    reserve: a.reserve + r.reserve,
    residual_y: a.residual_y + (Number(r.premium) > 0 ? r.residual_y : 0),
  }), { advance: 0, reserve: 0, residual_y: 0 })

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130]">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Commission Calculator</h1>
          <p className="text-xs text-[#5A6A7A] mt-0.5">Enter premium per product · advance + residual update live</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditingPresets(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547]">
            <SettingsIcon size={13} /> My commission structure
          </button>
          <button onClick={reset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547]"
            title="Clear all premiums">
            <RotateCcw size={11} /> Reset
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <TotalCard label="This week's advance check" value={fmt(totals.advance)} sub="paid up front" highlight />
          <TotalCard label="Reserve held" value={fmt(totals.reserve)} sub="vests as policy stays in force" />
          <TotalCard label="Annual residual" value={fmt(totals.residual_y)} sub="from association — paid quarterly" residual />
        </div>

        <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
          <div className="hidden lg:grid grid-cols-[100px_1fr_140px_auto] gap-3 px-4 py-2 border-b border-[#1A2130] text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">
            <div>Product</div>
            <div>Premium /mo</div>
            <div>Association tier</div>
            <div className="text-right w-32">Advance</div>
          </div>

          {rows.map(r => (
            <div key={r.key} className="grid grid-cols-2 lg:grid-cols-[100px_1fr_140px_auto] gap-3 px-4 py-2.5 border-b border-[#1A2130] last:border-0 items-center">
              <div className="col-span-2 lg:col-span-1">
                <span className="text-sm font-semibold text-white">{r.name}</span>
                <div className="text-[10px] font-mono text-[#5A6A7A] mt-0.5">
                  {r.comm_pct}% · {r.advance_effective}mo {r.half && <span className="text-[#A78BFA]">½</span>}
                </div>
              </div>

              <CalcInput value={r.premium} onChange={v => setRow(r.key, { premium: v })} placeholder="0" prefix="$" label="Premium" />

              <div>
                <select value={r.tierKey} onChange={e => setRow(r.key, { tier: e.target.value })}
                  className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#00E5C340]">
                  {TIER_KEYS.map(k => (
                    <option key={k} value={k}>
                      {ASSOCIATION_TIERS[k].label}{ASSOCIATION_TIERS[k].monthly > 0 ? ` · $${ASSOCIATION_TIERS[k].monthly}` : ''}
                    </option>
                  ))}
                </select>
                {r.residual_q > 0 && Number(r.premium) > 0 && (
                  <p className="text-[10px] font-mono text-[#A78BFA] mt-0.5">+ {fmt2(r.residual_q)}/qtr residual</p>
                )}
              </div>

              <div className="text-right w-32">
                <p className="lg:hidden text-[10px] font-mono uppercase text-[#5A6A7A]">Advance</p>
                <p className="text-sm font-mono" style={{ color: r.advance > 0 ? '#00E5C3' : '#3A4A5A' }}>{fmt(r.advance)}</p>
                {r.reserve > 0 && <p className="text-[10px] font-mono text-[#5A6A7A]">res {fmt(r.reserve)}</p>}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-[#3A4A5A] leading-relaxed">
          <strong>How it works:</strong> Pick the customer's association tier per product (defaults to whatever you set in Structure). The monthly cost (Ruby $32.95 → Exec Diamond $89.95) is auto-subtracted from the premium before commission. You also earn a separate quarterly residual on the association: Ruby $12.75, Sapphire $16.50, Emerald $27, Diamond $39, Exec Diamond $54. That's totaled annually in the "Annual residual" card. Advance = (Premium − Assoc) × 12 × Comm% × (advance months / 12). HA + Wraps auto-use half your default advance.
        </p>
      </div>

      {editingPresets && (
        <StructureModal config={config}
          onClose={() => setEditingPresets(false)}
          onSave={async (next) => { await saveCommissionPresets(next); setEditingPresets(false) }} />
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
// Structure modal — per-product: comm %, advance months, ½, default tier
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
    try {
      await onSave({ default_advance: Number(defaultAdvance) || 0, products: cleaned })
    } catch (e) {
      setSaveMsg('Save failed: ' + (e.message || e))
      setSaving(false)
    }
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
                  {TIER_KEYS.map(k => (
                    <option key={k} value={k}>{ASSOCIATION_TIERS[k].label}</option>
                  ))}
                </select>
                <label className="col-span-1 flex items-center justify-center cursor-pointer" title="Half of default advance">
                  <input type="checkbox" checked={!!p.half} onChange={e => setProduct(i, { half: e.target.checked })}
                    className="accent-[#A78BFA]" />
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

          <div className="rounded-lg border border-[#1A2130] p-3 text-[10px] text-[#5A6A7A] leading-relaxed" style={{ background: '#080B0F' }}>
            <p className="text-[#8899AA] mb-1"><strong>Association tiers</strong> (USHA reference)</p>
            <table className="w-full font-mono">
              <thead className="text-[#3A4A5A]">
                <tr><th className="text-left">Tier</th><th className="text-right">$/mo (cost)</th><th className="text-right">Qtr residual</th></tr>
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
            <p className="mt-2">The tier you set here is the default — you can override per-deal on the calculator without touching settings.</p>
          </div>

          {saveMsg && <p className="text-xs text-[#EF4444]">{saveMsg}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#1A2130] flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">Cancel</button>
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
