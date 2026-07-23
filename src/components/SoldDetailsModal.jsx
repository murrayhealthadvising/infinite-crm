import { useState, useEffect, useRef, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { CheckCircle, X, Award, Calendar, Cake, Info } from 'lucide-react'
import { buildRetentionSchedule, buildBirthdaySchedule, buildACAPaymentSchedule, findExistingRetentionReminders } from '../lib/retention'
import { format } from 'date-fns'

export default function SoldDetailsModal() {
  const { leads, updateLead, pendingSoldLeadId, setPendingSoldLeadId, reminders, addReminder, deleteReminder, addActivity } = useApp()
  const lead = (leads || []).find(l => l.id === pendingSoldLeadId)

  const [what, setWhat] = useState('')
  const [price, setPrice] = useState('')
  const [effective, setEffective] = useState('')  // YYYY-MM-DD from <input type=date>
  const [saving, setSaving] = useState(false)
  // Which retention steps to actually schedule. Keyed by the schedule item's
  // `key` (welcome / live / firstpay / checkin30 / referral90 / renewal).
  // Defaults ON so the "advisor system" fires by default — Nic can uncheck
  // any he doesn't want per-lead.
  const [enabledSteps, setEnabledSteps] = useState({})
  const ref = useRef(null)

  useEffect(() => {
    if (lead) {
      setWhat(lead.plan_choice || '')
      setPrice(lead.premium ? String(lead.premium) : '')
      // effective_date is stored as YYYY-MM-DD or an ISO string — take the
      // date portion so the <input type=date> can display it.
      const eff = lead.effective_date || ''
      setEffective(eff ? String(eff).slice(0, 10) : '')
      setEnabledSteps({})  // reset checkboxes when opening a new lead
    }
  }, [pendingSoldLeadId])

  // Live-computed retention preview based on the current effective date input.
  // Recomputes on every keystroke so Nic sees exact dates before saving.
  const schedule = useMemo(() => buildRetentionSchedule(effective), [effective])

  // Birthday schedule — 5 years of annual reminders on the client's DOB.
  // Only meaningful if the lead has a DOB on file. Independent of the
  // effective-date checkbox so it works even for backdated policies.
  const birthdays = useMemo(() => buildBirthdaySchedule(lead?.dob), [lead?.dob])
  const [birthdayEnabled, setBirthdayEnabled] = useState(true)
  // ACA / government-plan flag — off by default. When on, generates 12 monthly
  // payment reminders on the 1st of each month after the effective date.
  const [acaEnabled, setAcaEnabled] = useState(false)
  const acaPayments = useMemo(() => buildACAPaymentSchedule(effective), [effective])

  const isStepEnabled = (key) => enabledSteps[key] !== false  // default true
  const toggleStep = (key) => setEnabledSteps(prev => ({ ...prev, [key]: !isStepEnabled(key) }))

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = Math.max(80, ref.current.scrollHeight) + 'px'
    }
  }, [what])

  if (!pendingSoldLeadId || !lead) return null

  const fullName = lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'this lead'
  const firstName = fullName.split(' ')[0] || 'they'
  const close = () => setPendingSoldLeadId(null)

  const save = async () => {
    setSaving(true)
    let planSummary = ''
    if (typeof updateLead === 'function' && (what.trim() || price.trim() || effective)) {
      try {
        const patch = {}
        if (what.trim()) patch.plan_choice = what.trim()
        // Premium = monthly price. Strip non-digits; null clears.
        const cleanPrice = price.replace(/[^\d.]/g, '')
        if (cleanPrice) patch.premium = Math.round(parseFloat(cleanPrice)) || null
        if (effective) patch.effective_date = effective  // YYYY-MM-DD
        await updateLead(lead.id, patch)
        // Compose a one-line summary for the activity log so the timeline
        // shows the actual sale details, not just the Sold badge.
        const parts = []
        if (what.trim()) parts.push(what.trim())
        if (cleanPrice) parts.push(`$${Math.round(parseFloat(cleanPrice))}/mo`)
        if (effective) parts.push(`eff. ${effective}`)
        planSummary = parts.join(' · ')
      } catch (e) { console.error('save sold details:', e) }
    }

    // Log a "Policy sold" activity so the timeline has an anchor row for the
    // sale. The Sold badge on the card is quicker to scan, but the log gives
    // us an auditable "when did we close this + what did they buy" entry.
    if (planSummary && typeof addActivity === 'function') {
      try { await addActivity(lead.id, 'status', `Policy sold — ${planSummary}`) } catch {}
    }

    // Retention + birthday reminders. Wipe any previously auto-generated
    // ones for this lead first (identified by the [Rx] / [BDAY] markers) so
    // re-saving replaces cleanly rather than duplicating. Manual reminders
    // are left untouched.
    if (typeof addReminder === 'function' && typeof deleteReminder === 'function') {
      try {
        const existing = findExistingRetentionReminders(reminders, lead.id)
        for (const r of existing) {
          if (r.id) { try { await deleteReminder(r.id) } catch {} }
        }
        // Effective-date-anchored reminders
        if (effective && Array.isArray(schedule)) {
          for (const step of schedule) {
            if (!isStepEnabled(step.key)) continue
            try {
              await addReminder({
                lead_id: lead.id,
                kind: step.kind,
                due_at: step.due_at,
                note: step.note,
              })
            } catch (e) { console.error('add retention reminder failed:', step.key, e) }
          }
        }
        // Birthday reminders — independent of effective date. Only fire if
        // the client has a DOB on file and the checkbox is on.
        // ACA monthly payment reminders on the 1st.
        if (acaEnabled && Array.isArray(acaPayments) && acaPayments.length) {
          for (const p of acaPayments) {
            try {
              await addReminder({
                lead_id: lead.id,
                kind: p.kind,
                due_at: p.due_at,
                note: p.note,
              })
            } catch (e) { console.error('add ACA reminder failed:', p.key, e) }
          }
        }
        if (birthdayEnabled && Array.isArray(birthdays) && birthdays.length) {
          for (const b of birthdays) {
            try {
              await addReminder({
                lead_id: lead.id,
                kind: b.kind,
                due_at: b.due_at,
                note: b.note,
              })
            } catch (e) { console.error('add birthday reminder failed:', b.key, e) }
          }
        }
      } catch (e) { console.error('retention save:', e) }
    }

    setSaving(false)
    close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md rounded-2xl border border-[#00E5C340] overflow-hidden shadow-2xl"
        style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]" style={{ background: '#00E5C310' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <Award size={18} className="text-black" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Sold! 🎉</h2>
              <p className="text-xs text-[#8899AA]">What did {firstName} buy?</p>
            </div>
          </div>
          <button onClick={close} className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130]">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#8899AA] mb-1.5">Plan / product</label>
            <textarea ref={ref}
              value={what}
              onChange={e => setWhat(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
              placeholder="e.g. USHEALTH SecureAdvantage — family plan, effective 6/1"
              className="w-full px-3 py-3 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3] resize-none"
              style={{ minHeight: '80px' }}
              autoFocus />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#8899AA] mb-1.5">Monthly premium ($)</label>
            <div className="flex items-center gap-2">
              <span className="text-lg text-[#5A6A7A] font-mono">$</span>
              <input
                value={price}
                onChange={e => setPrice(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
                placeholder="425"
                inputMode="numeric"
                className="flex-1 px-3 py-2.5 rounded-lg text-base font-bold text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3]" />
              <span className="text-xs text-[#5A6A7A] font-mono">/mo</span>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#8899AA] mb-1.5">Effective date</label>
            <input
              type="date"
              value={effective}
              onChange={e => setEffective(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3]" />
          </div>

          {/* Retention schedule preview — only appears when there's an
              effective date. Simple: effective-date marker + 30-day check-in.
              Both default on; uncheck to skip. */}
          {effective && schedule.length > 0 && (
            <div className="p-3 rounded-lg border border-[#00E5C320]" style={{ background: '#00E5C308' }}>
              <div className="flex items-center gap-2 mb-2">
                <Calendar size={12} className="text-[#00E5C3]" />
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#00E5C3]">Auto reminders</p>
              </div>
              <div className="space-y-1">
                {schedule.map(step => {
                  const enabled = isStepEnabled(step.key)
                  const when = new Date(step.due_at)
                  const dateLabel = format(when, 'EEE MMM d')
                  const kindColor = step.kind === 'call' ? '#10B981' : step.kind === 'appt' ? '#3B82F6' : '#F59E0B'
                  return (
                    <label key={step.key}
                      className="flex items-center gap-2 p-1.5 rounded-md hover:bg-[#00E5C308] cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleStep(step.key)}
                        className="accent-[#00E5C3] flex-shrink-0" />
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: kindColor + '15', color: kindColor, border: `1px solid ${kindColor}40` }}>
                        {dateLabel}
                      </span>
                      <span className={`text-[11px] flex-1 ${enabled ? 'text-[#C0D0E0]' : 'text-[#3A4A5A] line-through'}`}>
                        {step.note.replace(/^\[R[+-]?\d+\]\s*/, '')}
                      </span>
                    </label>
                  )
                })}
              </div>
              {/* Birthday sub-section — only shows if lead has a DOB. Compact
                  because it's a "yes / no" not a per-year decision. */}
              {birthdays.length > 0 && (
                <label className="flex items-center gap-2 p-1.5 rounded-md hover:bg-[#00E5C308] cursor-pointer transition-colors border-t border-[#00E5C320] mt-2 pt-2">
                  <input
                    type="checkbox"
                    checked={birthdayEnabled}
                    onChange={() => setBirthdayEnabled(v => !v)}
                    className="accent-[#F59E0B] flex-shrink-0" />
                  <Cake size={12} className="text-[#F59E0B] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] ${birthdayEnabled ? 'text-[#C0D0E0]' : 'text-[#3A4A5A] line-through'}`}>
                      Birthday texts — next {birthdays.length} years
                    </p>
                    <p className="text-[9px] text-[#5A6A7A] font-mono">
                      Starts {format(new Date(birthdays[0].due_at), 'MMM d, yyyy')}
                    </p>
                  </div>
                </label>
              )}
              {/* ACA / government plan sub-section — for policies that pay on
                  the 1st every month. Off by default (most policies aren't
                  government). Requires an effective date to compute the
                  monthly cadence. */}
              {acaPayments.length > 0 && (
                <label className="flex items-center gap-2 p-1.5 rounded-md hover:bg-[#00E5C308] cursor-pointer transition-colors border-t border-[#00E5C320] mt-2 pt-2">
                  <input
                    type="checkbox"
                    checked={acaEnabled}
                    onChange={() => setAcaEnabled(v => !v)}
                    className="accent-[#3B82F6] flex-shrink-0" />
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background: '#3B82F615', color: '#3B82F6', border: '1px solid #3B82F640' }}>
                    ACA
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] ${acaEnabled ? 'text-[#C0D0E0]' : 'text-[#3A4A5A] line-through'}`}>
                      ACA / government plan — remind on the 1st every month
                    </p>
                    <p className="text-[9px] text-[#5A6A7A] font-mono">
                      {acaPayments.length} monthly payment reminders starting {format(new Date(acaPayments[0].due_at), 'MMM 1, yyyy')}
                    </p>
                  </div>
                </label>
              )}
              <div className="flex items-start gap-1.5 mt-2 pt-2 border-t border-[#00E5C320]">
                <Info size={10} className="text-[#5A6A7A] mt-0.5 flex-shrink-0" />
                <p className="text-[9px] text-[#5A6A7A] leading-snug">
                  Re-saving replaces the auto-schedule. Reminders you added by hand stay put.
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <CheckCircle size={14} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={close} disabled={saving}
              className="px-4 py-2.5 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
