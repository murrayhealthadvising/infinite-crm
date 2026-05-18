import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { X } from 'lucide-react'
import { normalizePhone } from '../lib/phone'
import { stateFromZip } from '../lib/zip'

// Plain field — nothing required
const Field = ({ label, type = 'text', value, onChange, placeholder }) => (
  <div>
    <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340] transition-colors" />
  </div>
)

const PhoneField = ({ value, onChange }) => (
  <div>
    <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Phone</label>
    <div className="flex items-center bg-[#080B0F] border border-[#1A2130] rounded-lg overflow-hidden focus-within:border-[#00E5C340] transition-colors">
      <span className="pl-3 pr-1 text-sm text-[#5A6A7A] font-mono select-none">+1</span>
      <input type="tel" value={value} onChange={e => onChange(e.target.value)}
        placeholder="(555) 000-0000"
        className="flex-1 bg-transparent px-2 py-2.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none" />
    </div>
  </div>
)

// Side tags multi-select — pulls suggestions from the agent's library
// (Settings → Side Tags) plus tags already used on their leads. Chips look
// the same as on lead cards; click an existing chip in the dropdown to add.
const SideTagsField = ({ value, onChange, suggestionPool, styles }) => {
  const list = Array.isArray(value) ? value : []
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)

  const add = (raw) => {
    const v = String(raw || '').trim().toLowerCase()
    if (!v) return
    if (list.includes(v)) { setText(''); return }
    onChange([...list, v])
    setText('')
  }
  const remove = (t) => onChange(list.filter(x => x !== t))

  const filtered = (suggestionPool || [])
    .filter(s => s && !list.includes(s) && s !== 'starred')
    .filter(s => !text || s.toLowerCase().includes(text.toLowerCase()))
    .slice(0, 8)
  const trimmed = text.trim().toLowerCase()
  const showCreate = trimmed && !suggestionPool.some(s => s.toLowerCase() === trimmed) && !list.includes(trimmed)

  return (
    <div className="relative">
      <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Side tags</label>
      <div className="flex flex-wrap items-center gap-1.5 bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-2 focus-within:border-[#00E5C340] transition-colors min-h-[42px]">
        {list.map(t => {
          const c = styles?.[t]?.color
          const chipStyle = c
            ? { background: c + '15', color: c, border: `1px solid ${c}40` }
            : { background: '#1A2130', color: '#8899AA', border: '1px solid #2A3547' }
          return (
            <span key={t} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono" style={chipStyle}>
              #{t}
              <button type="button" onClick={() => remove(t)}
                className="opacity-60 hover:opacity-100 leading-none"><X size={9} /></button>
            </span>
          )
        })}
        <input value={text}
          onChange={e => { setText(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); add(text) }
            if (e.key === ',') { e.preventDefault(); add(text) }
            if (e.key === 'Backspace' && !text && list.length) remove(list[list.length - 1])
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder={list.length ? 'add another…' : 'search or create…'}
          className="flex-1 min-w-[100px] bg-transparent text-sm text-white placeholder-[#3A4A5A] focus:outline-none px-1" />
      </div>
      {open && (filtered.length > 0 || showCreate) && (
        <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-lg border border-[#1A2130] overflow-hidden max-h-56 overflow-y-auto"
          style={{ background: '#0A0E14', boxShadow: '0 10px 20px rgba(0,0,0,0.5)' }}>
          {showCreate && (
            <button type="button" onMouseDown={e => { e.preventDefault(); add(trimmed) }}
              className="block w-full text-left px-2.5 py-2 text-[11px] font-mono text-[#00E5C3] hover:bg-[#1A2130] border-b border-[#1A2130]">
              + Create <strong>#{trimmed}</strong>
            </button>
          )}
          {filtered.map(s => {
            const c = styles?.[s]?.color
            return (
              <button type="button" key={s} onMouseDown={e => { e.preventDefault(); add(s) }}
                className="block w-full text-left px-2.5 py-1.5 text-[11px] font-mono hover:bg-[#1A2130]"
                style={{ color: c || '#8899AA' }}>
                #{s}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Single-select campaign dropdown — pulls from agent's saved campaigns. Type
// to filter; create-new affordance saves to library + selects in one click.
const CampaignField = ({ value, onChange, campaigns, onCreate }) => {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const safe = Array.isArray(campaigns) ? campaigns : []
  const filtered = safe.filter(c => !text || c.toLowerCase().includes(text.toLowerCase()))
  const trimmed = text.trim()
  const exists = safe.some(c => c.toLowerCase() === trimmed.toLowerCase())
  const showCreate = trimmed && !exists

  const pick = (c) => { onChange(c || null); setText(''); setOpen(false) }
  const createAndPick = async (raw) => {
    const v = String(raw || '').trim()
    if (!v) return
    if (onCreate) await onCreate(v)
    pick(v)
  }

  return (
    <div className="relative">
      <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Campaign</label>
      <div className="flex items-center bg-[#080B0F] border border-[#1A2130] rounded-lg overflow-hidden focus-within:border-[#00E5C340] transition-colors">
        {value && !open && (
          <span className="pl-3 pr-1 text-sm text-[#00E5C3] font-mono select-none truncate">{value}</span>
        )}
        <input value={text}
          onChange={e => { setText(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); showCreate ? createAndPick(trimmed) : (filtered[0] && pick(filtered[0])) }
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder={value ? 'change…' : 'pick or type a campaign…'}
          className="flex-1 bg-transparent px-2 py-2.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none min-w-0" />
        {value && (
          <button type="button" onClick={() => pick(null)}
            className="px-2 text-[#5A6A7A] hover:text-white"><X size={13} /></button>
        )}
      </div>
      {open && (filtered.length > 0 || showCreate) && (
        <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-lg border border-[#1A2130] overflow-hidden max-h-56 overflow-y-auto"
          style={{ background: '#0A0E14', boxShadow: '0 10px 20px rgba(0,0,0,0.5)' }}>
          {filtered.map(c => (
            <button type="button" key={c} onMouseDown={e => { e.preventDefault(); pick(c) }}
              className="block w-full text-left px-2.5 py-1.5 text-xs font-mono text-[#8899AA] hover:bg-[#1A2130]">
              {c}
            </button>
          ))}
          {showCreate && (
            <button type="button" onMouseDown={e => { e.preventDefault(); createAndPick(trimmed) }}
              className="block w-full text-left px-2.5 py-2 text-xs font-mono text-[#00E5C3] hover:bg-[#1A2130] border-t border-[#1A2130]">
              + Create <strong>{trimmed}</strong>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// "Received" datetime field with handy preset buttons (now / yesterday / etc.)
const ReceivedField = ({ value, onChange }) => {
  const pad = n => String(n).padStart(2, '0')
  const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  const setBy = (fn) => onChange(toLocal(fn(new Date())))
  return (
    <div>
      <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Received date</label>
      <input type="datetime-local" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#00E5C340]" />
      <div className="flex gap-1.5 mt-1.5 flex-wrap">
        <button type="button" onClick={() => setBy(d => d)} className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">Now</button>
        <button type="button" onClick={() => setBy(d => { d.setHours(d.getHours() - 1); return d })} className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">−1h</button>
        <button type="button" onClick={() => setBy(d => { d.setHours(9, 0, 0, 0); return d })} className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">Today 9am</button>
        <button type="button" onClick={() => setBy(d => { d.setDate(d.getDate() - 1); d.setHours(9, 0, 0, 0); return d })} className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">Yest 9am</button>
        <button type="button" onClick={() => setBy(d => { d.setDate(d.getDate() - 7); return d })} className="text-[10px] px-2 py-0.5 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white">−1 wk</button>
      </div>
    </div>
  )
}

export default function AddLeadModal({ onClose }) {
  const { addLead, tags, campaigns, saveCampaigns, sideTagStyles, leads } = useApp()
  const pad = n => String(n).padStart(2, '0')
  const nowLocal = () => {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '',
    street_address: '', city: '', state: '', zip: '',
    age: '', dob: '', income: '', household: '', gender: '',
    stage: 'not-started', tags: [], notes: '',
    campaign: '', received: nowLocal(),
  })
  const [zipTouched, setZipTouched] = useState(false)
  const set = (field) => (val) => setForm(prev => ({ ...prev, [field]: val }))

  // Auto-populate state from ZIP — only fills if state is empty so we don't
  // overwrite a manual entry. Re-runs whenever ZIP changes.
  useEffect(() => {
    if (!zipTouched) return
    const guess = stateFromZip(form.zip)
    if (guess && !form.state) setForm(prev => ({ ...prev, state: guess }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.zip, zipTouched])

  // Pool of side-tag suggestions = library entries + tags already in use across leads
  const safeLeads = Array.isArray(leads) ? leads : []
  const suggestionPool = useMemo(() => {
    const usedOnLeads = new Set(safeLeads.flatMap(l => Array.isArray(l.tags) ? l.tags : []).filter(Boolean))
    const libraryKeys = Object.keys(sideTagStyles || {}).filter(k => !sideTagStyles[k]?.hidden)
    return Array.from(new Set([...usedOnLeads, ...libraryKeys])).filter(t => t && t !== 'starred').sort()
  }, [safeLeads, sideTagStyles])

  const handleSubmit = (e) => {
    e.preventDefault()
    const parts = (form.full_name || '').trim().split(/\s+/).filter(Boolean)
    const first_name = parts[0] || ''
    const last_name = parts.slice(1).join(' ')
    const payload = {
      first_name, last_name,
      phone: normalizePhone(form.phone),
      email: form.email || null,
      address: form.street_address || null,
      street_address: form.street_address || null,
      city: form.city || null,
      state: form.state || null,
      zip: form.zip || null,
      age: form.age ? parseInt(form.age) : null,
      dob: form.dob || null,
      income: form.income || null,  // TEXT column — preserves ranges like "50k-75k"
      household: form.household ? parseInt(form.household) : null,
      gender: form.gender || null,
      stage: form.stage || 'not-started',
      tags: Array.isArray(form.tags) && form.tags.length ? form.tags : [],
      notes: form.notes || null,
      campaign: form.campaign || null,
      created_at: form.received ? new Date(form.received).toISOString() : undefined,
      last_activity: form.received ? new Date(form.received).toISOString() : undefined,
    }
    addLead(payload)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-[#1A2130] overflow-hidden animate-slide-up" style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130]">
          <h2 className="text-base font-display font-bold text-white">Create Lead</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] transition-colors"><X size={15} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left column */}
            <div className="space-y-4">
              <PhoneField value={form.phone} onChange={set('phone')} />
              <Field label="Full Name" value={form.full_name} onChange={set('full_name')} placeholder="Jane Doe" />
              <Field label="Email" type="email" value={form.email} onChange={set('email')} placeholder="jane@example.com" />
              <Field label="Street Address" value={form.street_address} onChange={set('street_address')} placeholder="123 Main St" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">ZIP code</label>
                  <input value={form.zip}
                    onChange={e => { set('zip')(e.target.value); setZipTouched(true) }}
                    placeholder="44101"
                    inputMode="numeric"
                    className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
                </div>
                <div>
                  <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">State</label>
                  <input value={form.state} onChange={e => set('state')(e.target.value)}
                    placeholder={stateFromZip(form.zip) || 'OH'}
                    className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340]" />
                  {stateFromZip(form.zip) && stateFromZip(form.zip) === form.state && (
                    <p className="text-[10px] text-[#00E5C3] mt-0.5">✓ auto-filled from ZIP</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="City" value={form.city} onChange={set('city')} />
                <Field label="Age" type="number" value={form.age} onChange={set('age')} placeholder="42" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="DOB" type="date" value={form.dob} onChange={set('dob')} />
                <Field label="Income" value={form.income} onChange={set('income')} placeholder="65000 or 50k-75k" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Household" type="number" value={form.household} onChange={set('household')} placeholder="2" />
                <Field label="Gender" value={form.gender} onChange={set('gender')} placeholder="M / F" />
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Stage</label>
                <select value={form.stage} onChange={e => set('stage')(e.target.value)}
                  className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#00E5C340]">
                  {(Array.isArray(tags) ? tags : []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <CampaignField value={form.campaign} onChange={set('campaign')}
                campaigns={campaigns}
                onCreate={async (v) => {
                  const next = Array.from(new Set([...(campaigns || []), v]))
                  try { await saveCampaigns(next) } catch {}
                }} />
              <SideTagsField value={form.tags} onChange={set('tags')}
                suggestionPool={suggestionPool}
                styles={sideTagStyles} />
              <ReceivedField value={form.received} onChange={set('received')} />
              <div>
                <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Notes</label>
                <textarea value={form.notes} onChange={e => set('notes')(e.target.value)} rows={4}
                  placeholder="Anything you want to remember about this lead…"
                  className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340] resize-y" />
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <button type="submit"
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-black transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              Create Lead
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
