import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { X } from 'lucide-react'

const Field = ({ label, type = 'text', value, onChange, placeholder, required }) => (
  <div>
    <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">{label}{required && ' *'}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required}
      className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340] transition-colors" />
  </div>
)

export default function AddLeadModal({ onClose }) {
  const { addLead, tags } = useApp()
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', email: '', state: '', stage: 'not-started', source: '', dob: '', household: '', income: '', notes: '' })
  const set = (field) => (val) => setForm(prev => ({ ...prev, [field]: val }))

  const handleSubmit = (e) => {
    e.preventDefault()
    addLead({ ...form, household: form.household ? parseInt(form.household) : null, income: form.income ? parseInt(form.income) : null })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-[#1A2130] overflow-hidden animate-slide-up" style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130]">
          <h2 className="text-base font-display font-bold text-white">Add New Lead</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] transition-colors"><X size={15} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <Field label="First Name" value={form.first_name} onChange={set('first_name')} required />
            <Field label="Last Name" value={form.last_name} onChange={set('last_name')} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Phone" value={form.phone} onChange={set('phone')} placeholder="(555) 000-0000" required />
            <Field label="Email" type="email" value={form.email} onChange={set('email')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State" value={form.state} onChange={set('state')} placeholder="OH" required />
            <div>
              <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Stage</label>
              <select value={form.stage} onChange={e => set('stage')(e.target.value)}
                className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#00E5C340]">
                {tags.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Source" value={form.source} onChange={set('source')} placeholder="LeadSweep, ACN..." />
            <Field label="DOB" type="date" value={form.dob} onChange={set('dob')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Household Size" type="number" value={form.household} onChange={set('household')} placeholder="3" />
            <Field label="Annual Income" type="number" value={form.income} onChange={set('income')} placeholder="55000" />
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5 block">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes')(e.target.value)} rows={3}
              className="w-full bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340] resize-none" />
          </div>
          <button type="submit"
            className="w-full py-3 rounded-xl text-sm font-semibold text-black transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            Add Lead
          </button>
        </form>
      </div>
    </div>
  )
}
