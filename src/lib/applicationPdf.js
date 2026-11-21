// PDF generator for the in-CRM paper application. Takes the JSONB form state
// and produces a multi-page PDF matching the paper-app layout the agent is
// used to. Uses jsPDF (client-side, no server round-trip) so the file is
// ready the moment the agent clicks Finalize.
//
// Returns a Blob. Caller uploads it to Supabase Storage.
import { jsPDF } from 'jspdf'

// Keep these in one place so the form sheet and the PDF generator stay in
// lockstep when we tweak/reword a question.
export const MEDICAL_QUESTIONS = [
  'Lungs or Respiratory system (Asthma, Allergies, Pneumonia, Chronic Bronchitis, Emphysema, Sleep Apnea)?',
  'Heart or Circulatory system (High BP, CAD, Heart Attack, Stroke, Murmur, CHF, MVP, Irregular Heartbeat)?',
  'Blood or Blood-forming organs (Anemia, Hemophilia, Blood Clots)?',
  'Stomach, Esophagus, Intestines, Rectum, Digestive (Ulcers, Colitis, Gastritis, Crohn\'s, Hernia, Hemorrhoids, Gallbladder)?',
  'Liver (Hepatitis, Cirrhosis)?',
  'Kidneys or Urinary System (Kidney Stones, UTIs, Cystitis, Incontinence)?',
  'Pancreas (Pancreatitis, Diabetes, Sugar/Glucose Intolerance)?',
  'Thyroid, Pituitary, Adrenal, Endocrine (Hyperthyroidism, Graves\', Goiter)?',
  'Neuromuscular (Parkinson\'s, Muscular Dystrophy, ALS)?',
  'Muscles, Joints, Connective Tissues (Arthritis, RA, Gout, Fibromyalgia, TMJ, Carpal Tunnel, Lupus, Lyme)?',
  'Back, Neck or Spine (Sprain/Strain, Herniated Disc, Chiropractic Adjustments)?',
  'Brain or Central Nervous System (Convulsions, Epilepsy, Seizures, Migraines, Dementia, MS, Paralysis)?',
  'Skin (Psoriasis, Eczema)?',
  'Eyes, Ears, Nose or Throat (Glaucoma, Cataracts, Blindness, Deafness, Chronic Tonsillitis)?',
  'Male — Breast, Prostate, Male Reproductive (abnormal PSA, impotence)?',
  'Female — Breast or Female Reproductive (Endometriosis, Pelvic Pain, Menstruation Disorder, Abnormal Pap, Cyst, Fibroid)?',
  'Female — Ever had Cesarean, miscarriage, abortion, or premature delivery?',
  'Currently pregnant, expecting, or in process of adoption?',
  'Any applicant less than 30 days old?',
  'Ever consulted/tested/counseled for infertility, impotence, IVF, artificial insemination, or surrogacy?',
  'Ever treated for STD, hormone imbalance, or oral contraceptive reaction?',
  'Ever tested positive for HIV, AIDS, or ARC?',
  'Any cosmetic/reconstructive surgery, congenital birth defect, bodily deformity, or organ transplant?',
  'Any monitoring device, implants, amputation, prosthetic, internal fixations, walking aid, wheelchair?',
  'Ever had Leukemia, Hodgkin\'s Disease, Lymphoma, or any Cancer?',
  'Ever had a tumor, cyst, or any form of growth?',
  'Ever had mental/emotional/nervous disease (Depression, Anxiety, Bulimia, Anorexia, Bipolar, Learning/Behavior, ADD)?',
  'Ever advised/treated for alcohol/drug abuse, illegal drugs, or support group?',
  'In past 5 years — seen a health professional for any condition not listed above?',
  'DWI/DUI, license suspended/revoked in past 5 yrs, on probation, or felony in past 10 yrs?',
  'All applicants U.S. Citizen or Permanent Resident (Green Card or in process)?',
  'Hazardous avocation/sport (racing, skydiving, piloting, scuba, climbing, rodeo)?',
  'Traveled outside U.S. > 30 days in past 2 yrs, or plan to in next 2 yrs?',
  'Immediate family diagnosed with heart disease, heart attack, stroke, kidney disorder, diabetes, cancer, leukemia, or Hodgkin\'s?',
]

// Build the PDF. app = the full application JSON state; lead = the lead row
// so we can backfill anything the form didn't capture. Returns a Blob.
export function generateApplicationPdf(app, lead = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MARGIN = 40
  let y = MARGIN

  const line = (gap = 14) => { y += gap; if (y > H - MARGIN) { doc.addPage(); y = MARGIN } }
  const h1 = (text) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
    doc.text(text, MARGIN, y); line(22)
  }
  const h2 = (text) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
    doc.text(text, MARGIN, y); line(18)
  }
  const field = (label, value) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    doc.setTextColor(100)
    doc.text(`${label}:`, MARGIN, y)
    doc.setTextColor(0)
    const v = String(value ?? '').trim() || '—'
    const labelW = doc.getTextWidth(`${label}: `)
    doc.text(v, MARGIN + labelW + 2, y)
    line(14)
  }
  const twoCol = (lLabel, lValue, rLabel, rValue) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    const mid = W / 2
    doc.setTextColor(100); doc.text(`${lLabel}:`, MARGIN, y)
    doc.setTextColor(0);   doc.text(String(lValue ?? '').trim() || '—', MARGIN + doc.getTextWidth(`${lLabel}: `) + 2, y)
    doc.setTextColor(100); doc.text(`${rLabel}:`, mid, y)
    doc.setTextColor(0);   doc.text(String(rValue ?? '').trim() || '—', mid + doc.getTextWidth(`${rLabel}: `) + 2, y)
    line(14)
  }
  // Mask sensitive data in print — last 4 only.
  const mask = (v, keep = 4) => {
    const s = String(v ?? '').replace(/\s/g, '')
    if (!s) return '—'
    if (s.length <= keep) return s
    return '••••' + s.slice(-keep)
  }

  // ── Title block
  h1('Health Insurance Application')
  const now = new Date()
  field('Generated', now.toLocaleString())
  if (app.quote?.monthlyPremium) field('Monthly Premium', `$${app.quote.monthlyPremium}`)
  if (app.quote?.carrier)        field('Carrier',          app.quote.carrier)
  if (app.quote?.effectiveDate)  field('Effective Date',   app.quote.effectiveDate)
  line(8)

  // ── CRM Info on File — pull every known fact about the lead so a hand-off
  //    agent has the whole file in ONE PDF. Only prints fields that exist;
  //    nulls/empties are skipped so the page doesn't bloat with "—" rows.
  const anyInfo = [
    lead.first_name, lead.last_name, lead.phone, lead.email, lead.dob, lead.age,
    lead.gender, lead.household, lead.household_size, lead.income, lead.state,
    lead.city, lead.zip, lead.campaign, lead.source, lead.carrier, lead.premium,
    lead.plan_choice, lead.monthly_budget, lead.smoker, lead.height, lead.weight,
    lead.effective_date, lead.comments, lead.notes, lead.notes_b,
  ].some(v => v !== null && v !== undefined && String(v).trim() !== '')
  if (anyInfo) {
    h2('CRM Info on File')
    const line2 = (label, value) => {
      const v = value === null || value === undefined ? '' : String(value).trim()
      if (!v) return
      field(label, v)
    }
    line2('Lead name',     `${lead.first_name || ''} ${lead.last_name || ''}`.trim())
    line2('Phone',         lead.phone)
    line2('Email',         lead.email)
    line2('DOB',           lead.dob)
    line2('Age',           lead.age || lead.age_range)
    line2('Gender',        lead.gender)
    line2('Household',     lead.household || lead.household_size)
    line2('Income',        lead.income ? (String(lead.income).startsWith('$') ? lead.income : `$${lead.income}`) : '')
    line2('State',         lead.state)
    line2('City',          lead.city)
    line2('ZIP',           lead.zip)
    line2('Campaign',      lead.campaign || lead.source)
    line2('Current carrier', lead.carrier)
    line2('Monthly budget', lead.monthly_budget)
    line2('Plan choice',   lead.plan_choice)
    line2('Smoker',        lead.smoker)
    line2('Received',      lead.created_at ? new Date(lead.created_at).toLocaleString() : '')
    // Marketplace comments — sometimes multi-line, so render as wrapped text
    if (lead.comments) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
      doc.text('Marketplace comments:', MARGIN, y); line(14)
      doc.setFont('helvetica', 'normal')
      const cLines = doc.splitTextToSize(String(lead.comments), W - MARGIN * 2)
      doc.text(cLines, MARGIN, y)
      y += cLines.length * 12
    }
    // Notes (A) and Notes (B) — the agent's own working notes on the lead.
    // Printed verbatim so a handoff agent reads exactly what Nic wrote.
    if (lead.notes) {
      line(4)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
      doc.text('Agent notes:', MARGIN, y); line(14)
      doc.setFont('helvetica', 'normal')
      const nLines = doc.splitTextToSize(String(lead.notes), W - MARGIN * 2)
      doc.text(nLines, MARGIN, y)
      y += nLines.length * 12
    }
    if (lead.notes_b) {
      line(4)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
      doc.text('Notes (B):', MARGIN, y); line(14)
      doc.setFont('helvetica', 'normal')
      const nLines = doc.splitTextToSize(String(lead.notes_b), W - MARGIN * 2)
      doc.text(nLines, MARGIN, y)
      y += nLines.length * 12
    }
    line(10)
  }

  // ── Primary applicant
  h2('Primary Applicant')
  field('Name',            app.primary?.fullName || `${lead.first_name || ''} ${lead.last_name || ''}`.trim())
  field('Email',           app.primary?.email || lead.email)
  twoCol('Date of Birth',  app.primary?.dob || lead.dob, 'Birth State', app.primary?.birthState || lead.state)
  twoCol('Phone',          app.primary?.phone || lead.phone, 'Gender', app.primary?.gender || lead.gender)
  field('SSN',             mask(app.primary?.ssn))
  twoCol('Height',         app.primary?.height, 'Weight', app.primary?.weight)
  twoCol('Employer',       app.primary?.employer, 'Occupation', app.primary?.occupation)
  field('Street Address',  app.primary?.street)
  twoCol('City',           app.primary?.city, 'ZIP', app.primary?.zip || lead.zip)
  field('Tobacco (12mo)',  app.primary?.tobacco ? 'Yes' : 'No')
  line(8)

  // ── Spouse (only if filled in)
  if (app.spouse && (app.spouse.fullName || app.spouse.dob)) {
    h2('Spouse')
    field('Name',            app.spouse.fullName)
    twoCol('Date of Birth',  app.spouse.dob, 'Gender', app.spouse.gender)
    field('SSN',             mask(app.spouse.ssn))
    twoCol('Height',         app.spouse.height, 'Weight', app.spouse.weight)
    twoCol('Employer',       app.spouse.employer, 'Occupation', app.spouse.occupation)
    field('Tobacco (12mo)',  app.spouse.tobacco ? 'Yes' : 'No')
    line(8)
  }

  // ── Dependents
  const deps = Array.isArray(app.dependents) ? app.dependents.filter(d => d && (d.name || d.dob)) : []
  if (deps.length) {
    h2(`Dependents (${deps.length})`)
    deps.forEach((d, i) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
      doc.text(`${i + 1}.`, MARGIN, y)
      doc.setFont('helvetica', 'normal')
      doc.text(`${d.name || '—'}  ·  ${d.dob || '—'}  ·  ${d.gender || '—'}  ·  ${d.height || '—'} / ${d.weight || '—'}`, MARGIN + 16, y)
      line(14)
    })
    line(4)
  }

  // ── Payment
  h2('Payment')
  if (app.payment?.method === 'card') {
    field('Method',     'Credit Card (8% processing fee)')
    field('Name on Card', app.payment?.nameOnCard)
    field('Card Number',  mask(app.payment?.cardNumber))
    twoCol('Expiration',  app.payment?.expiration, 'CVV', mask(app.payment?.cvv, 0))
    field('Billing Address', app.payment?.billingAddress)
  } else {
    field('Method',     'Bank Account (ACH)')
    field('Bank Name',  app.payment?.bankName)
    field('Routing',    mask(app.payment?.routing))
    field('Account',    mask(app.payment?.account))
    field('First Withdrawal / Effective Date', app.quote?.effectiveDate || app.payment?.firstWithdrawal)
  }
  line(8)

  // ── Medical — compact 2-col Yes/No table. Only the handful marked YES
  //    are highlighted in bold so underwriting sees them at a glance.
  h2('Medical History (34 questions)')
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const med = app.medical || {}
  MEDICAL_QUESTIONS.forEach((q, i) => {
    const ans = med[i] === true ? 'YES' : 'No'
    if (y > H - MARGIN - 20) { doc.addPage(); y = MARGIN }
    if (med[i] === true) doc.setFont('helvetica', 'bold')
    else doc.setFont('helvetica', 'normal')
    doc.setTextColor(med[i] === true ? '#B91C1C' : '#000')
    doc.text(`${(i + 1).toString().padStart(2, ' ')}. ${ans}`, MARGIN, y)
    doc.setTextColor(0)
    doc.setFont('helvetica', 'normal')
    // Wrap question text
    const qLines = doc.splitTextToSize(q, W - MARGIN * 2 - 50)
    doc.text(qLines, MARGIN + 50, y)
    y += Math.max(12, qLines.length * 10)
    if (y > H - MARGIN) { doc.addPage(); y = MARGIN }
  })
  line(8)

  // ── Medications list (if any)
  const meds = Array.isArray(app.medications) ? app.medications.filter(m => m && (m.name || m.reason)) : []
  if (meds.length) {
    if (y > H - MARGIN - 60) { doc.addPage(); y = MARGIN }
    h2(`Medications (${meds.length})`)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text('Applicant', MARGIN, y)
    doc.text('Medication', MARGIN + 90, y)
    doc.text('Reason', MARGIN + 220, y)
    doc.text('Length', MARGIN + 340, y)
    doc.text('Doctor', MARGIN + 420, y)
    line(12)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    meds.forEach(m => {
      if (y > H - MARGIN) { doc.addPage(); y = MARGIN }
      doc.text(String(m.applicant || '—'), MARGIN,       y)
      doc.text(String(m.name      || '—'), MARGIN + 90,  y)
      doc.text(String(m.reason    || '—'), MARGIN + 220, y)
      doc.text(String(m.length    || '—'), MARGIN + 340, y)
      doc.text(String(m.doctor    || '—'), MARGIN + 420, y)
      line(12)
    })
  }

  // ── Verification scheduling note
  if (app.verificationPreference) {
    line(8)
    h2('Verification Call Preference')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    const vLines = doc.splitTextToSize(app.verificationPreference, W - MARGIN * 2)
    doc.text(vLines, MARGIN, y)
    y += vLines.length * 12
  }

  return doc.output('blob')
}
