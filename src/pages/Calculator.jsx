import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Plus, Trash2, Save, Settings as SettingsIcon, X, Check, Pencil } from 'lucide-react'

// Commission math helper.
//   commissionable = (premium - association) × 12      (annualized)
//   total          = commissionable × commPct/100      (full 12-month commission)
//   advance        = total × advanceMonths / 12        (paid up-front)
//   reserve        = total - advance                   (vests month 9-12 typically)
function calcRow(row) {
  const premium = Number(row.premium) || 0
  const association = Number(row.association) || 0
  const monthlyCommissionable = Math.max(0, premium - association)
  const commissionable = monthlyCommissionable * 12
  const pct = Math.max(0, Math.min(100, Number(row.commPct) || 0))
  const total = commissionable * (pct / 100)
  const months = Math.max(0, Math.min(12, Number(row.advanceMonths) || 0))
  const advance = total * (months / 12)
  const reserve = total - advance
  return { commissionable, total, advance, reserve }
}

const fmt = (n) => {
  if (!isFinite(n)) return '$0'
  const v = Math.round(n)
  return '$' + v.toLocaleString()
}

const blankRow = (preset) => ({
  id: 'r' + Math.random().toString(36).slice(2, 8),
  name: preset?.name || '',
  premium: '',
  association: '',
  commPct: preset?.comm_pct ?? '',
  advanceMonths: preset?.advance_months ?? '',
  presetId: preset?.id || '',
})

export default function Calculator() {
  const { commissionPresets, saveCommissionPresets } = useApp()
  const [rows, setRows] = useState(() => [blankRow()])
  const [editingPresets, setEditingPresets] = useState(false)

  // Mirror local edits of presets so the modal feels responsive
  const [presetDraft, setPresetDraft] = useState(commissionPresets || [])
  useEffect(() => { setPresetDraft(commissionPresets || []) }, [commissionPresets])

  const updateRow = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  const removeRow = (id) => setRows(rs => rs.length > 1 ? rs.filter(r => r.id !== id) : rs)
  const addRow = (preset) => setRows(rs => [...rs, blankRow(preset)])

  const computed = useMemo(() => rows.map(calcRow), [rows])
  const totals = useMemo(() => computed.reduce((a, c) => ({
    total: a.total + c.total,
    advance: a.advance + c.advance,
    reserve: a.reserve + c.reserve,
    commissionable: a.commissionable + c.commissionable,
  }), { total: 0, advance: 0, reserve: 0, commissionable: 0 }), [computed])

  const applyPreset = (rowId, presetId) => {
    if (!presetId) { updateRow(rowId, { presetId: '' }); return }
    const p = commissionPresets.find(x => x.id === presetId)
    if (!p) return
    updateRow(rowId, { presetId, name: p.name, commPct: p.comm_pct, advanceMonths: p.advance_months })
  }

  const reset = () => setRows([blankRow()])

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130]">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Commission Calculator</h1>
          <p className="text-xs text-[#5A6A7A] mt-0.5">Add a product per row · totals update live · advance vs reserve split</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditingPresets(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547]">
            <SettingsIcon size={13} /> Presets ({commissionPresets.length})
          </button>
          <button onClick={reset}
            className="px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547]">
            Reset
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-4">

        <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
          <div className="hidden lg:grid grid-cols-[1.4fr_1fr_1fr_0.9fr_0.9fr_1fr_1fr_36px] gap-2 px-4 py-2 border-b border-[#1A2130] text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">
            <div>Product</div>
            <div>Premium /mo</div>
            <div>Association /mo</div>
            <div>Comm %</div>
            <div>Advance mo</div>
            <div className="text-right">Total comm</div>
            <div className="text-right">Advance</div>
            <div></div>
          </div>

          {rows.map((row, i) => {
            const c = computed[i]
            return (
              <div key={row.id} className="grid grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_0.9fr_0.9fr_1fr_1fr_36px] gap-2 px-4 py-3 border-b border-[#1A2130] last:border-0 items-center">
                <div className="col-span-2 lg:col-span-1">
                  <select value={row.presetId || ''} onChange={e => applyPreset(row.id, e.target.value)}
                    className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#00E5C340] mb-1">
                    <option value="">— Custom —</option>
                    {commissionPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input value={row.name}
                    onChange={e => updateRow(row.id, { name: e.target.value, presetId: '' })}
                    placeholder="Product name (e.g. Med-Sup)"
                    className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 text-xs text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
                </div>

                <CalcInput label="$ /mo" value={row.premium} onChange={v => updateRow(row.id, { premium: v })} placeholder="450" prefix="$" />
                <CalcInput label="Assoc $ /mo" value={row.association} onChange={v => updateRow(row.id, { association: v })} placeholder="80" prefix="$" />
                <CalcInput label="Comm %" value={row.commPct} onChange={v => updateRow(row.id, { commPct: v, presetId: '' })} placeholder="75" suffix="%" />
                <CalcInput label="Advance" value={row.advanceMonths} onChange={v => updateRow(row.id, { advanceMonths: v, presetId: '' })} placeholder="9" suffix="mo" />

                <div className="text-right">
                  <p className="lg:hidden text-[10px] font-mono uppercase text-[#5A6A7A]">Total</p>
                  <p className="text-sm font-mono text-white">{fmt(c.total)}</p>
                </div>
                <div className="text-right">
                  <p className="lg:hidden text-[10px] font-mono uppercase text-[#5A6A7A]">Advance</p>
                  <p className="text-sm font-mono text-[#00E5C3]">{fmt(c.advance)}</p>
                  <p className="text-[10px] font-mono text-[#5A6A7A]">res {fmt(c.reserve)}</p>
                </div>

                <div className="flex justify-end">
                  <button onClick={() => removeRow(row.id)}
                    disabled={rows.length === 1}
                    className="p-1.5 rounded-lg text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415] disabled:opacity-30">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}

          <div className="px-4 py-3 border-t border-[#1A2130]" style={{ background: '#080B0F40' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => addRow()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-dashed border-[#2A3547] text-[#8899AA] hover:text-white hover:border-[#00E5C340]">
                <Plus size={13} /> Add product
              </button>
              {commissionPresets.length > 0 && (
                <>
                  <span className="text-[10px] font-mono text-[#3A4A5A] uppercase tracking-wider mx-1">or quick-add</span>
                  {commissionPresets.map(p => (
                    <button key={p.id} onClick={() => addRow(p)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-[#1A2130] text-[#A78BFA] hover:bg-[#A78BFA15]">
                      + {p.name} <span className="opacity-60">({p.comm_pct}% / {p.advance_months}mo)</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TotalCard label="Annualized commissionable" value={fmt(totals.commissionable)} sub="(Premium − Association) × 12" />
          <TotalCard label="Total commission" value={fmt(totals.total)} sub="across all 12 months" />
          <TotalCard label="Advance check" value={fmt(totals.advance)} sub="paid up front" highlight />
          <TotalCard label="Reserve" value={fmt(totals.reserve)} sub="vests as policy stays in force" />
        </div>

        <p className="text-[10px] text-[#3A4A5A] leading-relaxed">
          Math: <code>(Premium − Association) × 12 × Comm%</code> = total commission. Advance = total × (Advance months / 12). The remainder is reserve, released as the policy stays active past the advance period. Each row is independent — set its own Comm % and Advance months, or pick a Preset to autofill.
        </p>
      </div>

      {editingPresets && (
        <PresetsModal presets={presetDraft} onChange={setPresetDraft}
          onClose={() => setEditingPresets(false)}
          onSave={async () => { await saveCommissionPresets(presetDraft); setEditingPresets(false) }} />
      )}
    </div>
  )
}

function CalcInput({ label, value, onChange, placeholder, prefix, suffix }) {
  return (
    <div className="lg:block">
      <p className="lg:hidden text-[10px] font-mono uppercase text-[#5A6A7A] mb-0.5">{label}</p>
      <div className="flex items-center bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 focus-within:border-[#00E5C340]">
        {prefix && <span className="text-xs text-[#5A6A7A] mr-1">{prefix}</span>}
        <input value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} inputMode="decimal"
          className="flex-1 bg-transparent text-sm text-white placeholder-[#3A4A5A] focus:outline-none min-w-0" />
        {suffix && <span className="text-xs text-[#5A6A7A] ml-1">{suffix}</span>}
      </div>
    </div>
  )
}

function TotalCard({ label, value, sub, highlight }) {
  return (
    <div className="rounded-xl border p-4"
      style={{ background: highlight ? '#00E5C308' : '#0E1318', borderColor: highlight ? '#00E5C340' : '#1A2130' }}>
      <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">{label}</p>
      <p className="text-2xl font-display font-bold" style={{ color: highlight ? '#00E5C3' : 'white' }}>{value}</p>
      {sub && <p className="text-[10px] text-[#3A4A5A] mt-0.5">{sub}</p>}
    </div>
  )
}

function PresetsModal({ presets, onChange, onClose, onSave }) {
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState({ name: '', comm_pct: '', advance_months: '' })

  const startNew = () => { setEditId('new'); setDraft({ name: '', comm_pct: '', advance_months: '' }) }
  const startEdit = (p) => { setEditId(p.id); setDraft({ name: p.name, comm_pct: p.comm_pct, advance_months: p.advance_months }) }
  const cancelEdit = () => { setEditId(null); setDraft({ name: '', comm_pct: '', advance_months: '' }) }
  const commitEdit = () => {
    const name = String(draft.name || '').trim()
    const pct = Number(draft.comm_pct)
    const months = Number(draft.advance_months)
    if (!name) return
    if (!isFinite(pct) || pct < 0 || pct > 100) return
    if (!isFinite(months) || months < 0 || months > 12) return
    if (editId === 'new') onChange([...presets, { id: 'p_' + Date.now(), name, comm_pct: pct, advance_months: months }])
    else onChange(presets.map(p => p.id === editId ? { ...p, name, comm_pct: pct, advance_months: months } : p))
    cancelEdit()
  }
  const remove = (id) => onChange(presets.filter(p => p.id !== id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]">
          <h3 className="text-base font-semibold text-white">Commission presets</h3>
          <button onClick={onClose} className="text-[#5A6A7A] hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-2 max-h-[70vh] overflow-y-auto">
          <p className="text-xs text-[#5A6A7A] mb-2">
            Each agent has their own. Save once, then pick from the dropdown on the calculator to autofill comm % + advance months.
          </p>

          {presets.length === 0 && editId !== 'new' && (
            <div className="border border-dashed border-[#1A2130] rounded-lg py-6 text-center text-sm text-[#5A6A7A]">
              No presets yet — click <strong>+ Add preset</strong> to create your first.
            </div>
          )}

          {presets.map(p => (
            <div key={p.id}>
              {editId === p.id ? (
                <PresetEditor draft={draft} setDraft={setDraft} onSave={commitEdit} onCancel={cancelEdit} />
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#1A2130]" style={{ background: '#080B0F' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{p.name}</p>
                    <p className="text-xs text-[#5A6A7A]">{p.comm_pct}% comm · {p.advance_months}mo advance</p>
                  </div>
                  <button onClick={() => startEdit(p)}
                    className="text-xs px-2 py-1 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white hover:border-[#2A3547]">
                    <Pencil size={11} />
                  </button>
                  <button onClick={() => remove(p.id)}
                    className="p-1.5 rounded text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415]">
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {editId === 'new' && (
            <PresetEditor draft={draft} setDraft={setDraft} onSave={commitEdit} onCancel={cancelEdit} />
          )}

          {editId === null && (
            <button onClick={startNew}
              className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-dashed border-[#2A3547] text-[#8899AA] hover:text-white hover:border-[#00E5C340]">
              <Plus size={13} /> Add preset
            </button>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#1A2130]">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">
            Cancel
          </button>
          <button onClick={onSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-black"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Save size={13} /> Save presets
          </button>
        </div>
      </div>
    </div>
  )
}

function PresetEditor({ draft, setDraft, onSave, onCancel }) {
  return (
    <div className="px-3 py-2.5 rounded-lg border border-[#00E5C340] space-y-2" style={{ background: '#00E5C308' }}>
      <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
        placeholder='Product name (e.g. "Med-Sup", "AP", "MedGuard")'
        className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">Comm %</label>
          <input value={draft.comm_pct} onChange={e => setDraft(d => ({ ...d, comm_pct: e.target.value }))}
            placeholder="75" inputMode="decimal"
            className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">Advance months</label>
          <input value={draft.advance_months} onChange={e => setDraft(d => ({ ...d, advance_months: e.target.value }))}
            placeholder="9" inputMode="decimal"
            className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-black"
          style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          <Check size={11} className="inline -mt-0.5" /> Save preset
        </button>
        <button onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs text-[#5A6A7A] hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  )
}
