import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { X, Plus } from 'lucide-react'
import { normalizePhone, displayPhone } from '../lib/phone'

// Plain field — nothing required, label floats above the input
const Field = ({ label, type = 'text', value, onChange, placeholder }) => (
  <div>
    <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340] transition-colors" />
  </div>
)

// Phone input with a static "+1" prefix on the left. User types just the
// 10 digits; we normalize to E.164 on save. If they paste a +1-prefixed
// number, normalizePhone strips/handles it.
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

// Side tags multi-select chip input. Type, hit Enter (or comma) to add a chip.
// Saves as an array of lowercase strings on the lead's `tags` column.
const TagsField = ({ value, onChange }) => {
  const [text, setText] = useState('')
  const list = Array.isArray(value) ? value : []
  const add = (raw) => {
    const v = String(raw || '').trim().toLowerCase()
    if (!v) return
    if (list.includes(v)) { setText(''); return }
    onChange([...list, v])
    setText('')
  }
  const remove = (t) => onChange(list.filter(x => x !== t))
  return (
    <div>
      <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Side tags</label>
      <div className="flex flex-wrap items-center gap-1.5 bg-[#080B0F] border border-[#1A2130] rounded-lg px-2 py-2 focus-within:border-[#00E5C340] transition-colors min-h-[42px]">
        {list.map(t => (
          <span key={t} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono"
            style={{ background: '#1A2130', color: '#8899AA', border: '1px solid #2A3547' }}>
            #{t}
            <button type="button" onClick={() => remove(t)}
              className="text-[#5A6A7A] hover:text-[#EF4444] leading-none">
              <X size={9} />
            </button>
          </span>
        ))}
        <input value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text) }
            if (e.key === 'Backspace' && !text && list.length) remove(list[list.length - 1])
          }}
          onBlur={() => text && add(text)}
          placeholder={list.length ? '' : 'pitched, callback, voicemail…'}
          className="flex-1 min-w-[100px] bg-transparent text-sm text-white placeholder-[#3A4A5A] focus:outline-none px-1" />
      </div>
    </div>
  )
}

export default function AddLeadModal({ onClose }) {
  const { addLead, tags } = useApp()
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '',
    street_address: '', city: '', state: '', zip: '',
    age: '', dob: '', stage: 'not-started', tags: [], notes: '',
  })
  const set = (field) => (val) => setForm(prev => ({ ...prev, [field]: val }))

  const handleSubmit = (e) => {
    e.preventDefault()
    // Split full_name into first/last (rest of words go to last_name)
    const parts = (form.full_name || '').trim().split(/\s+/).filter(Boolean)
    const first_name = parts[0] || ''
    const last_name = parts.slice(1).join(' ')
    const payload = {
      first_name,
      last_name,
      phone: normalizePhone(form.phone),
      email: form.email || null,
      address: form.street_address || null,
      street_address: form.street_address || null,
      city: form.city || null,
      state: form.state || null,
      zip: form.zip || null,
      age: form.age ? parseInt(form.age) : null,
      dob: form.dob || null,
      stage: form.stage || 'not-started',
      tags: Array.isArray(form.tags) && form.tags.length ? form.tags : [],
      notes: form.notes || null,
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
                <Field label="City" value={form.city} onChange={set('city')} />
                <Field label="State" value={form.state} onChange={set('state')} placeholder="OH" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="ZIP code" value={form.zip} onChange={set('zip')} placeholder="44101" />
                <Field label="Age" type="number" value={form.age} onChange={set('age')} placeholder="42" />
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
              <TagsField value={form.tags} onChange={set('tags')} />
              <div>
                <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Notes</label>
                <textarea value={form.notes} onChange={e => set('notes')(e.target.value)} rows={6}
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
