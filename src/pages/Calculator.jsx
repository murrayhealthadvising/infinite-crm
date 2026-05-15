import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Plus, Trash2, Save, Settings as SettingsIcon, X, Check, RotateCcw } from 'lucide-react'

// Default product structure for a new agent. They can edit/add/remove in
// settings. HA + wraps automatically get half the agent's main advance months.
const DEFAULT_PRODUCTS = [
  { key: 'med',    name: 'MED',    comm_pct: 75, advance_months: '', half: false },
  { key: 'ap',     name: 'AP',     comm_pct: 55, advance_months: '', half: false },
  { key: 'dental', name: 'Dental', comm_pct: 75, advance_months: '', half: false },
  { key: 'vision', name: 'Vision', comm_pct: 75, advance_months: '', half: false },
  { key: 'pa',     name: 'PA',     comm_pct: 75, advance_months: '', half: false },
  { key: 'sa',     name: 'SA',     comm_pct: 75, advance_months: '', half: false },
  { key: 'ha',     name: 'HA',     comm_pct: 75, advance_months: '', half: true },
  { key: 'wraps',  name: 'Wraps',  comm_pct: 75, advance_months: '', half: true },
]

// Each product preset can have its own advance_months OR inherit half of the
// "default advance months" the agent set.
function effectiveAdvance(p, defaultAdvance) {
  if (p.half) return Math.max(0, Math.floor((Number(defaultAdvance) || 0) / 2))
  const m = Number(p.advance_months)
  return isFinite(m) && m > 0 ? m : Number(defaultAdvance) || 0
}

function calcRow(premium, association, commPct, advanceMonths) {
  const p = Number(premium) || 0
  const a = Number(association) || 0
  const monthly = Math.max(0, p - a)
  const annualized = monthly * 12
  const pct = Math.max(0, Math.min(100, Number(commPct) || 0))
  const total = annualized * (pct / 100)
  const months = Math.max(0, Math.min(12, Number(advanceMonths) || 0))
  const advance = total * (months / 12)
  return { annualized, total, advance, reserve: total - advance }
}

const fmt = (n) => isFinite(n) ? '$' + Math.round(n).toLocaleString() : '$0'

export default function Calculator() {
  const { commissionPresets, saveCommissionPresets } = useApp()
  const [editingPresets, setEditingPresets] = useState(false)

  // Hydrate presets — on first render with no saved presets, use defaults.
  // Stored shape on profiles.commission_presets:
  //   { default_advance: number, products: [{ key, name, comm_pct, advance_months, half }] }
  // Backwards compat: if presets is just an array, treat as products list.
  const stored = commissionPresets
  const config = useMemo(() => {
    if (Array.isArray(stored)) return { default_advance: 9, products: stored.length ? stored : DEFAULT_PRODUCTS }
    if (stored && typeof stored === 'object' && Array.isArray(stored.products)) {
      return { default_advance: Number(stored.default_advance) || 9, products: stored.products.length ? stored.products : DEFAULT_PRODUCTS }
    }
    return { default_advance: 9, products: DEFAULT_PRODUCTS }
  }, [stored])

  // Per-row premium input — { [productKey]: { premium, association } }
  const [inputs, setInputs] = useState({})
  const setInput = (key, patch) => setInputs(s => ({ ...s, [key]: { ...(s[key] || {}), ...patch } }))
  const reset = () => setInputs({})

  const rows = config.products.map(p => {
    const inp = inputs[p.key] || {}
    const adv = effectiveAdvance(p, config.default_advance)
    const c = calcRow(inp.premium, inp.association, p.comm_pct, adv)
    return { ...p, ...inp, advance_effective: adv, ...c }
  })
  const totals = rows.reduce((a, r) => ({
    annualized: a.annualized + r.annualized,
    total: a.total + r.total,
    advance: a.advance + r.advance,
    reserve: a.reserve + r.reserve,
  }), { annualized: 0, total: 0, advance: 0, reserve: 0 })

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130]">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Commission Calculator</h1>
          <p className="text-xs text-[#5A6A7A] mt-0.5">Enter premiums per product · this-week advance updates live</p>
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

      <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full space-y-4">

        {/* Big totals at top */}
        <div className="grid grid-cols-2 gap-3">
          <TotalCard label="This week's advance check" value={fmt(totals.advance)} sub="paid up front" highlight />
          <TotalCard label="Reserve held" value={fmt(totals.reserve)} sub="vests as policy stays in force" />
        </div>

        {/* Product rows */}
        <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
          <div className="hidden lg:grid grid-cols-[100px_1fr_1fr_90px_90px_120px] gap-3 px-4 py-2 border-b border-[#1A2130] text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">
            <div>Product</div>
            <div>Premium /mo</div>
            <div>Association /mo</div>
            <div>Comm %</div>
            <div>Adv mo</div>
            <div className="text-right">Advance</div>
          </div>
          {rows.map(r => (
            <div key={r.key} className="grid grid-cols-2 lg:grid-cols-[100px_1fr_1fr_90px_90px_120px] gap-3 px-4 py-2.5 border-b border-[#1A2130] last:border-0 items-center">
              <div className="col-span-2 lg:col-span-1">
                <span className="text-sm font-semibold text-white">{r.name}</span>
                {r.half && <span className="block text-[9px] text-[#5A6A7A]">half advance</span>}
              </div>
              <CalcInput value={r.premium || ''} onChange={v => setInput(r.key, { premium: v })} placeholder="0" prefix="$" label="Premium" />
              <CalcInput value={r.association || ''} onChange={v => setInput(r.key, { association: v })} placeholder="0" prefix="$" label="Assoc" />
              <div className="text-xs font-mono text-[#5A6A7A] hidden lg:block">{r.comm_pct}%</div>
              <div className="text-xs font-mono text-[#5A6A7A] hidden lg:block">{r.advance_effective}mo</div>
              <div className="text-right">
                <p className="text-sm font-mono" style={{ color: r.advance > 0 ? '#00E5C3' : '#3A4A5A' }}>{fmt(r.advance)}</p>
                {r.reserve > 0 && <p className="text-[10px] font-mono text-[#5A6A7A]">res {fmt(r.reserve)}</p>}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-[#3A4A5A] leading-relaxed">
          <strong>How it works:</strong> Set your commission structure once (top-right). Each row uses your saved % and advance months. Just type the premium (and Association if applicable) for each product on the deal — totals update live.
          {' '}HA and Wraps use <strong>half</strong> your default advance months automatically. Math: <code>(Premium − Association) × 12 × Comm%</code> = total commission, advance = total × (Adv months / 12).
        </p>
      </div>

      {editingPresets && (
        <StructureModal config={config}
          onClose={() => setEditingPresets(false)}
          onSave={async (next) => {
            await saveCommissionPresets(next)
            setEditingPresets(false)
          }} />
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

function TotalCard({ label, value, sub, highlight }) {
  return (
    <div className="rounded-xl border p-5"
      style={{ background: highlight ? '#00E5C310' : '#0E1318', borderColor: highlight ? '#00E5C360' : '#1A2130' }}>
      <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">{label}</p>
      <p className="text-3xl font-display font-bold" style={{ color: highlight ? '#00E5C3' : 'white' }}>{value}</p>
      {sub && <p className="text-[10px] text-[#3A4A5A] mt-1">{sub}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Structure modal — agent's commission % + advance months per product
// ─────────────────────────────────────────────────────────────────────────────
function StructureModal({ config, onClose, onSave }) {
  const [defaultAdvance, setDefaultAdvance] = useState(config.default_advance)
  const [products, setProducts] = useState(config.products)
  const setProduct = (i, patch) => setProducts(ps => ps.map((p, idx) => idx === i ? { ...p, ...patch } : p))
  const addProduct = () => setProducts(ps => [...ps, { key: 'p_' + Date.now(), name: '', comm_pct: 75, advance_months: '', half: false }])
  const removeProduct = (i) => setProducts(ps => ps.filter((_, idx) => idx !== i))

  const save = async () => {
    const cleaned = products
      .filter(p => p.name && p.name.trim())
      .map(p => ({
        key: p.key || 'p_' + Math.random().toString(36).slice(2, 8),
        name: p.name.trim(),
        comm_pct: Math.max(0, Math.min(100, Number(p.comm_pct) || 0)),
        advance_months: p.half ? '' : (Number(p.advance_months) || ''),
        half: !!p.half,
      }))
    await onSave({ default_advance: Number(defaultAdvance) || 0, products: cleaned })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-2xl border border-[#1A2130] overflow-hidden flex flex-col" style={{ background: '#0E1318', maxHeight: '90vh' }}>
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
              <p className="text-xs text-[#5A6A7A]">months — used as the base for HA / Wraps (which get half this).</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">Products</p>
            {products.map((p, i) => (
              <div key={p.key} className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F' }}>
                <input value={p.name} onChange={e => setProduct(i, { name: e.target.value })}
                  placeholder="Product"
                  className="col-span-3 bg-[#0E1318] border border-[#1A2130] rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
                <div className="col-span-3 flex items-center gap-1">
                  <input value={p.comm_pct} onChange={e => setProduct(i, { comm_pct: e.target.value })}
                    placeholder="75" inputMode="decimal"
                    className="w-full bg-[#0E1318] border border-[#1A2130] rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
                  <span className="text-xs text-[#5A6A7A]">%</span>
                </div>
                <div className="col-span-4 flex items-center gap-1">
                  {p.half ? (
                    <span className="text-xs text-[#A78BFA] flex-1">half of {defaultAdvance || '0'} = {Math.floor((Number(defaultAdvance) || 0) / 2)}mo</span>
                  ) : (
                    <>
                      <input value={p.advance_months} onChange={e => setProduct(i, { advance_months: e.target.value })}
                        placeholder={String(defaultAdvance || 9)} inputMode="decimal"
                        className="w-full bg-[#0E1318] border border-[#1A2130] rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
                      <span className="text-xs text-[#5A6A7A]">mo</span>
                    </>
                  )}
                </div>
                <label className="col-span-1 flex items-center gap-1 text-[10px] text-[#5A6A7A] cursor-pointer" title="Half of default advance">
                  <input type="checkbox" checked={!!p.half} onChange={e => setProduct(i, { half: e.target.checked })}
                    className="accent-[#A78BFA]" />
                  ½
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

          <p className="text-[10px] text-[#3A4A5A]">
            Per-product %: this is YOUR commission rate (e.g., MedGuard 75%, AP 55%). Advance months: how many months of the annualized commission you get up front. Check <strong>½</strong> for any product that should automatically use half your default advance (HA, wraps).
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#1A2130] flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">Cancel</button>
          <button onClick={save}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-black"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Save size={13} /> Save structure
          </button>
        </div>
      </div>
    </div>
  )
}
