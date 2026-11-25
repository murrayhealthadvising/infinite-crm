import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Save, FileText, Check, Plus, Trash2, Download, User, Users, CreditCard, Stethoscope, Pill, Loader2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { generateApplicationPdf, MEDICAL_QUESTIONS } from '../lib/applicationPdf'

// Paper-application-in-the-CRM. Opens as a right-side sheet on desktop,
// bottom sheet on mobile. Pre-fills from the lead row, saves as the agent
// types to leads.application (jsonb), and on Finalize generates a PDF via
// jsPDF, uploads it to private Supabase Storage, and saves the file path
// on the lead so there's a secure-signed-URL "View PDF" button later.
//
// Section order (reordered 2026-11-23 per Nic): Quote → Primary → Spouse →
// Dependents → Medications → Medical → Payment → Verification. Payment at
// the end so the agent reads medical disclosures BEFORE asking for bank info.
//
// ── CRITICAL: Section, Field, and inputCls are declared at MODULE level,
//    not inside the component. Defining them inside caused React to see
//    "new" component identities on every parent render, which unmounted
//    and remounted every input on every keystroke — making the agent lose
//    focus after every single character. Keep them out here.

const inputCls = 'w-full px-2 py-1.5 rounded-md text-sm text-white bg-[#080B0F] border border-[#1A2130] focus:outline-none focus:border-[#00E5C340]'

function Section({ id, title, icon: Icon, badge, openState, setOpenState, children }) {
  const isOpen = !!openState[id]
  return (
    <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0D1117' }}>
      <button type="button" onClick={() => setOpenState(s => ({ ...s, [id]: !isOpen }))}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[#1A2130] transition-colors">
        <Icon size={13} className="text-[#00E5C3]" />
        <span className="text-xs font-mono uppercase tracking-wider text-white flex-1 text-left">{title}</span>
        {badge && <span className="text-[10px] text-[#8899AA] font-mono">{badge}</span>}
        <span className="text-[#5A6A7A] text-xs">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="p-3 border-t border-[#1A2130] space-y-2">{children}</div>}
    </div>
  )
}

function Field({ label, children, half }) {
  return (
    <label className={`block ${half ? 'inline-block w-1/2 pr-1' : ''}`}>
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  )
}

const DEFAULT_APP = {
  quote:   { monthlyPremium: '', carrier: '', effectiveDate: '' },
  primary: { fullName: '', email: '', dob: '', birthState: '', phone: '', gender: '', ssn: '', height: '', weight: '', employer: '', occupation: '', street: '', city: '', zip: '', tobacco: false },
  married: false,
  spouse:  { fullName: '', dob: '', gender: '', ssn: '', height: '', weight: '', employer: '', occupation: '', tobacco: false },
  dependents: [],
  payment: { method: 'bank', bankName: '', routing: '', account: '', firstWithdrawal: '', nameOnCard: '', cardNumber: '', expiration: '', cvv: '', billingAddress: '' },
  medications: [],
  medical: {}, // {0: true/false, ...}  default (missing) = No
  verificationPreference: '',
}

function hydrate(saved, lead) {
  const base = JSON.parse(JSON.stringify(DEFAULT_APP))
  const merged = {
    ...base,
    ...(saved || {}),
    quote:    { ...base.quote,    ...(saved?.quote   || {}) },
    primary:  { ...base.primary,  ...(saved?.primary || {}) },
    spouse:   { ...base.spouse,   ...(saved?.spouse  || {}) },
    payment:  { ...base.payment,  ...(saved?.payment || {}) },
    medical:  { ...(saved?.medical || {}) },
    dependents:  Array.isArray(saved?.dependents)  ? saved.dependents  : [],
    medications: Array.isArray(saved?.medications) ? saved.medications : [],
  }
  if (!merged.primary.fullName) merged.primary.fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim()
  if (!merged.primary.email)    merged.primary.email    = lead.email  || ''
  if (!merged.primary.phone)    merged.primary.phone    = lead.phone  || ''
  if (!merged.primary.dob)      merged.primary.dob      = lead.dob    || ''
  if (!merged.primary.gender)   merged.primary.gender   = lead.gender || ''
  if (!merged.primary.city)     merged.primary.city     = lead.city   || ''
  if (!merged.primary.zip)      merged.primary.zip      = lead.zip    || ''
  if (!merged.primary.birthState) merged.primary.birthState = lead.state || ''
  if (!merged.quote.monthlyPremium && lead.premium) merged.quote.monthlyPremium = String(lead.premium)
  if (!merged.quote.carrier && lead.carrier)        merged.quote.carrier         = lead.carrier
  if (!merged.quote.effectiveDate && lead.effective_date) merged.quote.effectiveDate = String(lead.effective_date).slice(0, 10)
  return merged
}

export default function ApplicationSheet({ lead, open, onClose }) {
  const { updateLead } = useApp()
  const [state, setState] = useState(() => hydrate(lead?.application, lead || {}))
  const [savedAt, setSavedAt] = useState(null)
  const [savingPdf, setSavingPdf] = useState(false)
  const [pdfError, setPdfError] = useState(null)
  const [openSection, setOpenSection] = useState({ quote: true, primary: true })
  const [openingPdf, setOpeningPdf] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    if (open && lead) {
      setState(hydrate(lead.application, lead))
      setPdfError(null)
    }
  }, [open, lead?.id])

  const persist = useCallback((next) => {
    if (!lead?.id || typeof updateLead !== 'function') return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await updateLead(lead.id, { application: next })
        setSavedAt(new Date())
      } catch (e) { console.error('[app-sheet] save failed', e) }
    }, 600)
  }, [lead?.id, updateLead])

  const update = (patch) => setState(prev => { const n = { ...prev, ...patch }; persist(n); return n })
  const updateIn = (section, patch) => setState(prev => {
    const n = { ...prev, [section]: { ...prev[section], ...patch } }; persist(n); return n
  })
  const setMedical = (i, value) => setState(prev => {
    const n = { ...prev, medical: { ...prev.medical, [i]: value } }; persist(n); return n
  })
  const addDep = () => setState(prev => {
    if (prev.dependents.length >= 6) return prev
    const n = { ...prev, dependents: [...prev.dependents, { name: '', dob: '', gender: '', height: '', weight: '' }] }; persist(n); return n
  })
  const setDep = (idx, patch) => setState(prev => {
    const deps = prev.dependents.map((d, i) => i === idx ? { ...d, ...patch } : d)
    const n = { ...prev, dependents: deps }; persist(n); return n
  })
  const delDep = (idx) => setState(prev => {
    const n = { ...prev, dependents: prev.dependents.filter((_, i) => i !== idx) }; persist(n); return n
  })
  const addMed = () => setState(prev => {
    const n = { ...prev, medications: [...prev.medications, { applicant: '', name: '', reason: '', length: '', doctor: '' }] }; persist(n); return n
  })
  const setMed = (idx, patch) => setState(prev => {
    const meds = prev.medications.map((m, i) => i === idx ? { ...m, ...patch } : m)
    const n = { ...prev, medications: meds }; persist(n); return n
  })
  const delMed = (idx) => setState(prev => {
    const n = { ...prev, medications: prev.medications.filter((_, i) => i !== idx) }; persist(n); return n
  })

  const finalize = async () => {
    if (savingPdf) return
    setSavingPdf(true); setPdfError(null)
    try {
      clearTimeout(saveTimer.current)
      await updateLead(lead.id, { application: state })
      const blob = generateApplicationPdf(state, lead)
      const safeName = `${(lead.first_name || '').trim()}_${(lead.last_name || '').trim()}`
        .replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'application'
      const file = new File([blob], `${safeName}.pdf`, { type: 'application/pdf' })
      const path = `${lead.user_id || 'unknown'}/${lead.id}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('applications').upload(path, file, {
        contentType: 'application/pdf', upsert: false,
      })
      if (upErr) throw upErr
      await updateLead(lead.id, { application_pdf_path: path })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      setSavedAt(new Date())
    } catch (e) {
      console.error('[app-sheet] finalize failed', e)
      setPdfError(e.message || String(e))
    } finally { setSavingPdf(false) }
  }

  const openSavedPdf = async () => {
    if (!lead.application_pdf_path || openingPdf) return
    setOpeningPdf(true)
    try {
      const { data, error } = await supabase.storage.from('applications')
        .createSignedUrl(lead.application_pdf_path, 60 * 60)
      if (error) throw error
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      console.error('[app-sheet] signed url failed', e)
      setPdfError(`Couldn't open PDF: ${e.message || e}`)
    } finally { setOpeningPdf(false) }
  }

  if (!open || !lead) return null

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <aside className="fixed z-50 flex flex-col shadow-2xl
        inset-x-0 bottom-0 top-10 rounded-t-2xl
        lg:inset-auto lg:right-0 lg:top-0 lg:bottom-0 lg:w-[520px] lg:rounded-none"
        style={{
          background: '#0E1318',
          borderLeft: '1px solid #1A2130',
          borderTop: '1px solid #1A2130',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          isolation: 'isolate',
          transform: 'translateZ(0)',
        }}>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#1A2130] flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-[#00E5C3]" />
              <h2 className="text-sm font-bold text-white truncate">
                Application · {`${lead.first_name || ''} ${lead.last_name || ''}`.trim() || '—'}
              </h2>
            </div>
            <p className="text-[10px] text-[#5A6A7A] font-mono mt-0.5">
              {savedAt ? `Auto-saved ${savedAt.toLocaleTimeString()}` : 'Edits save automatically'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130] flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3">

          <Section id="quote" title="Quote" icon={FileText} openState={openSection} setOpenState={setOpenSection}>
            <Field label="Monthly Premium ($)">
              <input className={inputCls} value={state.quote.monthlyPremium}
                onChange={e => updateIn('quote', { monthlyPremium: e.target.value })}
                placeholder="356.78" inputMode="decimal" />
            </Field>
            <Field label="Carrier">
              <input className={inputCls} value={state.quote.carrier}
                onChange={e => updateIn('quote', { carrier: e.target.value })}
                placeholder="Ambetter, Cigna, etc." />
            </Field>
            <Field label="Effective date (also first-withdrawal date)">
              <input type="date" className={inputCls} value={state.quote.effectiveDate}
                onChange={e => updateIn('quote', { effectiveDate: e.target.value })} />
            </Field>
          </Section>

          <Section id="primary" title="Primary applicant" icon={User} openState={openSection} setOpenState={setOpenSection}>
            <Field label="Full name">
              <input className={inputCls} value={state.primary.fullName}
                onChange={e => updateIn('primary', { fullName: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className={inputCls} type="email" value={state.primary.email}
                onChange={e => updateIn('primary', { email: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <Field label="DOB" half>
                <input type="date" className={inputCls} value={state.primary.dob}
                  onChange={e => updateIn('primary', { dob: e.target.value })} />
              </Field>
              <Field label="Birth state" half>
                <input className={inputCls} value={state.primary.birthState}
                  onChange={e => updateIn('primary', { birthState: e.target.value })}
                  placeholder="MS" maxLength="2" />
              </Field>
            </div>
            <div className="flex gap-2">
              <Field label="Phone" half>
                <input className={inputCls} value={state.primary.phone}
                  onChange={e => updateIn('primary', { phone: e.target.value })} inputMode="tel" />
              </Field>
              <Field label="Gender" half>
                <select className={inputCls} value={state.primary.gender}
                  onChange={e => updateIn('primary', { gender: e.target.value })}>
                  <option value="">—</option><option>Male</option><option>Female</option>
                </select>
              </Field>
            </div>
            <Field label="SSN">
              <input className={inputCls} value={state.primary.ssn}
                onChange={e => updateIn('primary', { ssn: e.target.value })}
                placeholder="xxx-xx-xxxx" inputMode="numeric" />
            </Field>
            <div className="flex gap-2">
              <Field label="Height (ft/in)" half>
                <input className={inputCls} value={state.primary.height}
                  onChange={e => updateIn('primary', { height: e.target.value })}
                  placeholder="6'0&quot;" />
              </Field>
              <Field label="Weight (lbs)" half>
                <input className={inputCls} value={state.primary.weight}
                  onChange={e => updateIn('primary', { weight: e.target.value })} inputMode="numeric" />
              </Field>
            </div>
            <div className="flex gap-2">
              <Field label="Employer" half>
                <input className={inputCls} value={state.primary.employer}
                  onChange={e => updateIn('primary', { employer: e.target.value })} />
              </Field>
              <Field label="Occupation" half>
                <input className={inputCls} value={state.primary.occupation}
                  onChange={e => updateIn('primary', { occupation: e.target.value })} />
              </Field>
            </div>
            <Field label="Street address">
              <input className={inputCls} value={state.primary.street}
                onChange={e => updateIn('primary', { street: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <Field label="City" half>
                <input className={inputCls} value={state.primary.city}
                  onChange={e => updateIn('primary', { city: e.target.value })} />
              </Field>
              <Field label="ZIP" half>
                <input className={inputCls} value={state.primary.zip}
                  onChange={e => updateIn('primary', { zip: e.target.value })} inputMode="numeric" />
              </Field>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-[#C0D0E0] mt-1">
              <input type="checkbox" checked={state.primary.tobacco}
                onChange={e => updateIn('primary', { tobacco: e.target.checked })} />
              Tobacco use in past 12 months
            </label>
          </Section>

          <Section id="spouse" title="Spouse" icon={Users} badge={state.married ? 'married' : 'single'} openState={openSection} setOpenState={setOpenSection}>
            <label className="inline-flex items-center gap-2 text-xs text-[#C0D0E0] mb-2">
              <input type="checkbox" checked={state.married} onChange={e => update({ married: e.target.checked })} />
              Married — include spouse
            </label>
            {state.married && (
              <>
                <Field label="Full name">
                  <input className={inputCls} value={state.spouse.fullName}
                    onChange={e => updateIn('spouse', { fullName: e.target.value })} />
                </Field>
                <div className="flex gap-2">
                  <Field label="DOB" half>
                    <input type="date" className={inputCls} value={state.spouse.dob}
                      onChange={e => updateIn('spouse', { dob: e.target.value })} />
                  </Field>
                  <Field label="Gender" half>
                    <select className={inputCls} value={state.spouse.gender}
                      onChange={e => updateIn('spouse', { gender: e.target.value })}>
                      <option value="">—</option><option>Male</option><option>Female</option>
                    </select>
                  </Field>
                </div>
                <Field label="SSN">
                  <input className={inputCls} value={state.spouse.ssn}
                    onChange={e => updateIn('spouse', { ssn: e.target.value })} />
                </Field>
                <div className="flex gap-2">
                  <Field label="Height" half>
                    <input className={inputCls} value={state.spouse.height}
                      onChange={e => updateIn('spouse', { height: e.target.value })} />
                  </Field>
                  <Field label="Weight" half>
                    <input className={inputCls} value={state.spouse.weight}
                      onChange={e => updateIn('spouse', { weight: e.target.value })} />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Field label="Employer" half>
                    <input className={inputCls} value={state.spouse.employer}
                      onChange={e => updateIn('spouse', { employer: e.target.value })} />
                  </Field>
                  <Field label="Occupation" half>
                    <input className={inputCls} value={state.spouse.occupation}
                      onChange={e => updateIn('spouse', { occupation: e.target.value })} />
                  </Field>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-[#C0D0E0] mt-1">
                  <input type="checkbox" checked={state.spouse.tobacco}
                    onChange={e => updateIn('spouse', { tobacco: e.target.checked })} />
                  Tobacco use in past 12 months
                </label>
              </>
            )}
          </Section>

          <Section id="deps" title="Dependents" icon={Users} badge={state.dependents.length ? `${state.dependents.length}` : null} openState={openSection} setOpenState={setOpenSection}>
            {state.dependents.map((d, idx) => (
              <div key={idx} className="rounded-md border border-[#1A2130] p-2 space-y-1.5" style={{ background: '#080B0F' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-[#5A6A7A]">Dependent {idx + 1}</span>
                  <button onClick={() => delDep(idx)} className="p-0.5 text-[#5A6A7A] hover:text-[#EF4444]">
                    <Trash2 size={11} />
                  </button>
                </div>
                <input className={inputCls} value={d.name} placeholder="Name"
                  onChange={e => setDep(idx, { name: e.target.value })} />
                <div className="flex gap-2">
                  <input type="date" className={inputCls} value={d.dob}
                    onChange={e => setDep(idx, { dob: e.target.value })} />
                  <select className={inputCls} value={d.gender}
                    onChange={e => setDep(idx, { gender: e.target.value })}>
                    <option value="">Gender</option><option>Male</option><option>Female</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <input className={inputCls} value={d.height} placeholder="Height"
                    onChange={e => setDep(idx, { height: e.target.value })} />
                  <input className={inputCls} value={d.weight} placeholder="Weight"
                    onChange={e => setDep(idx, { weight: e.target.value })} inputMode="numeric" />
                </div>
              </div>
            ))}
            {state.dependents.length < 6 && (
              <button onClick={addDep} className="w-full py-1.5 rounded-md border border-dashed border-[#2A3547] text-xs text-[#8899AA] hover:text-white hover:border-[#00E5C340]">
                <Plus size={11} className="inline mr-1" /> Add dependent
              </button>
            )}
          </Section>

          <Section id="meds" title="Medications" icon={Pill} badge={state.medications.length ? `${state.medications.length}` : null} openState={openSection} setOpenState={setOpenSection}>
            {state.medications.map((m, idx) => (
              <div key={idx} className="rounded-md border border-[#1A2130] p-2 space-y-1.5" style={{ background: '#080B0F' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-[#5A6A7A]">Med {idx + 1}</span>
                  <button onClick={() => delMed(idx)} className="p-0.5 text-[#5A6A7A] hover:text-[#EF4444]">
                    <Trash2 size={11} />
                  </button>
                </div>
                <input className={inputCls} value={m.applicant} placeholder="Applicant (Primary / Spouse / Dep X)"
                  onChange={e => setMed(idx, { applicant: e.target.value })} />
                <input className={inputCls} value={m.name} placeholder="Medication"
                  onChange={e => setMed(idx, { name: e.target.value })} />
                <input className={inputCls} value={m.reason} placeholder="Reason"
                  onChange={e => setMed(idx, { reason: e.target.value })} />
                <div className="flex gap-2">
                  <input className={inputCls} value={m.length} placeholder="Length on med"
                    onChange={e => setMed(idx, { length: e.target.value })} />
                  <input className={inputCls} value={m.doctor} placeholder="Doctor"
                    onChange={e => setMed(idx, { doctor: e.target.value })} />
                </div>
              </div>
            ))}
            <button onClick={addMed} className="w-full py-1.5 rounded-md border border-dashed border-[#2A3547] text-xs text-[#8899AA] hover:text-white hover:border-[#00E5C340]">
              <Plus size={11} className="inline mr-1" /> Add medication
            </button>
          </Section>

          <Section id="medical" title="Medical history (34 questions)" icon={Stethoscope}
            badge={`${Object.values(state.medical).filter(v => v === true).length} Yes`}
            openState={openSection} setOpenState={setOpenSection}>
            <p className="text-[10px] text-[#5A6A7A] mb-2">
              Read each one to the client. Defaults to No — tap Yes for anything that applies.
            </p>
            <div className="space-y-1">
              {MEDICAL_QUESTIONS.map((q, i) => {
                const isYes = state.medical[i] === true
                return (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-md border"
                    style={{ background: isYes ? '#EF444408' : '#080B0F', borderColor: isYes ? '#EF444430' : '#1A2130' }}>
                    <span className="text-[10px] font-mono text-[#5A6A7A] pt-0.5 flex-shrink-0 w-5">{i + 1}.</span>
                    <p className="text-[11px] text-[#C0D0E0] leading-snug flex-1">{q}</p>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => setMedical(i, false)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${!isYes ? 'bg-[#1A2130] text-white' : 'bg-transparent text-[#5A6A7A]'}`}>
                        No
                      </button>
                      <button onClick={() => setMedical(i, true)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${isYes ? 'bg-[#EF4444] text-white' : 'bg-transparent text-[#5A6A7A]'}`}>
                        Yes
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>

          <Section id="payment" title="Payment" icon={CreditCard} openState={openSection} setOpenState={setOpenSection}>
            <div className="flex gap-2 mb-2">
              {['bank', 'card'].map(m => (
                <button key={m} onClick={() => updateIn('payment', { method: m })}
                  className={`flex-1 py-1.5 rounded-md text-xs border ${state.payment.method === m ? 'border-[#00E5C340] bg-[#00E5C310] text-[#00E5C3]' : 'border-[#1A2130] text-[#8899AA]'}`}>
                  {m === 'bank' ? 'Bank (preferred)' : 'Card (+8% fee)'}
                </button>
              ))}
            </div>
            {state.payment.method === 'bank' ? (
              <>
                <Field label="Bank name">
                  <input className={inputCls} value={state.payment.bankName}
                    onChange={e => updateIn('payment', { bankName: e.target.value })} />
                </Field>
                <Field label="Routing">
                  <input className={inputCls} value={state.payment.routing}
                    onChange={e => updateIn('payment', { routing: e.target.value })} inputMode="numeric" />
                </Field>
                <Field label="Account number">
                  <input className={inputCls} value={state.payment.account}
                    onChange={e => updateIn('payment', { account: e.target.value })} inputMode="numeric" />
                </Field>
                <p className="text-[10px] text-[#5A6A7A]">
                  First withdrawal fires on the effective date set in the Quote section above.
                </p>
              </>
            ) : (
              <>
                <Field label="Name on card">
                  <input className={inputCls} value={state.payment.nameOnCard}
                    onChange={e => updateIn('payment', { nameOnCard: e.target.value })} />
                </Field>
                <Field label="Card number">
                  <input className={inputCls} value={state.payment.cardNumber}
                    onChange={e => updateIn('payment', { cardNumber: e.target.value })} inputMode="numeric" />
                </Field>
                <div className="flex gap-2">
                  <Field label="Expiration (MM/YY)" half>
                    <input className={inputCls} value={state.payment.expiration}
                      onChange={e => updateIn('payment', { expiration: e.target.value })}
                      placeholder="12/28" />
                  </Field>
                  <Field label="CVV" half>
                    <input className={inputCls} value={state.payment.cvv}
                      onChange={e => updateIn('payment', { cvv: e.target.value })} inputMode="numeric" maxLength="4" />
                  </Field>
                </div>
                <Field label="Billing address">
                  <input className={inputCls} value={state.payment.billingAddress}
                    onChange={e => updateIn('payment', { billingAddress: e.target.value })} />
                </Field>
              </>
            )}
          </Section>

          <Section id="verify" title="Verification call preference" icon={FileText} openState={openSection} setOpenState={setOpenSection}>
            <p className="text-[10px] text-[#5A6A7A] mb-1">
              When should underwriting call? (Calls run 15–25 min.)
            </p>
            <textarea rows={2} className={inputCls}
              value={state.verificationPreference}
              onChange={e => update({ verificationPreference: e.target.value })}
              placeholder="e.g. Weekdays after 5pm CST, or next Tue 10am" />
          </Section>

          {pdfError && (
            <div className="text-xs text-[#EF4444] px-2 py-1.5 rounded-md border border-[#EF444440]" style={{ background: '#EF444410' }}>
              PDF save failed: {pdfError}. The form state is saved — you can retry Finalize.
            </div>
          )}

          {lead.application_pdf_path && (
            <button onClick={openSavedPdf} disabled={openingPdf}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs text-[#00E5C3] border border-[#00E5C340] hover:bg-[#00E5C310] disabled:opacity-50">
              {openingPdf
                ? <><Loader2 size={12} className="animate-spin" /> Generating secure link…</>
                : <><Download size={12} /> View last saved PDF (secure)</>}
            </button>
          )}

          <div className="h-16" />
        </div>

        <div className="flex-shrink-0 border-t border-[#1A2130] p-3 flex items-center gap-2" style={{ background: '#0E1318' }}>
          <button onClick={onClose}
            className="px-3 py-2 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white">
            Close
          </button>
          <div className="flex-1 text-[10px] text-[#5A6A7A] font-mono text-center">
            {savedAt
              ? <><Check size={10} className="inline" /> Saved {savedAt.toLocaleTimeString()}</>
              : <><Save size={10} className="inline" /> Edits save automatically</>}
          </div>
          <button onClick={finalize} disabled={savingPdf}
            className="px-3 py-2 rounded-lg text-xs font-semibold text-black disabled:opacity-40 flex items-center gap-1.5"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            {savingPdf
              ? <><Loader2 size={12} className="animate-spin" /> Saving PDF…</>
              : <><FileText size={12} /> Finalize → PDF</>}
          </button>
        </div>
      </aside>
    </>
  )
}
