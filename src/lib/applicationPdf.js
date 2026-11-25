// PDF generator for the in-CRM paper application. Takes the JSONB form state
// and produces a multi-page PDF matching the paper-app layout the agent is
// used to. Uses jsPDF (client-side, no server round-trip) so the file is
// ready the moment the agent clicks Finalize.
//
// Returns a Blob. Caller uploads it to Supabase Storage.
import { jsPDF } from 'jspdf'

// Keep these in one place so the form sheet and the PDF generator stay in
// lockstep when we tweak/reword a question. Each question stands alone — the
// paper-app preambles ("Has any applicant been diagnosed with…" / "Has any
// Applicant ever…") are baked into the wording so nothing is missed during a
// live read-through.
export const MEDICAL_QUESTIONS = [
  'Has any applicant been diagnosed with, treated for, taken medications for, had symptoms of, or been advised to seek treatment for any disease or disorder of the LUNGS or RESPIRATORY SYSTEM — including but not limited to Asthma, Allergies, Pneumonia, Chronic Bronchitis, Emphysema, or Sleep Apnea?',
  'Has any applicant been diagnosed with, treated for, taken medications for, had symptoms of, or been advised to seek treatment for the HEART or CIRCULATORY SYSTEM — High Blood Pressure, Coronary Artery Disease, Heart Attack, Stroke, Heart Murmur, Congestive Heart Failure, Mitral Valve Prolapse, or Irregular Heartbeat?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the BLOOD or BLOOD-FORMING ORGANS — Anemia, Hemophilia, or Blood Clots?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the STOMACH, ESOPHAGUS, INTESTINES, RECTUM, or DIGESTIVE SYSTEM — Ulcers, Colitis, Gastritis, Crohn\'s Disease, Hernia, Hemorrhoids, or Gallbladder disease?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the LIVER — Hepatitis or Cirrhosis?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the KIDNEYS or URINARY SYSTEM — Kidney Stones, Urinary Tract Infections, Cystitis, or Urinary Incontinence?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the PANCREAS — Pancreatitis, Diabetes, or Sugar/Glucose Intolerance?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the THYROID, PITUITARY, ADRENAL, or ENDOCRINE GLANDS — Hyperthyroidism, Graves\' Disease, or Goiter?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the NEUROMUSCULAR SYSTEM — Parkinson\'s Disease, Muscular Dystrophy, or Lou Gehrig\'s Disease (ALS)?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the MUSCLES, JOINTS, or CONNECTIVE TISSUES — Rheumatism, Arthritis, Rheumatoid Arthritis, Gout, Fibromyalgia, TMJ, Carpal Tunnel Syndrome, Lupus, or Lyme disease?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the BACK, NECK, or SPINE — Sprain or Strain, Herniated or Slipped Disc, Chiropractic Adjustments, or Spinal Manipulations?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the BRAIN or CENTRAL NERVOUS SYSTEM — Convulsions, Epilepsy, Seizures, Recurrent Headaches, Migraines, Dementia, Multiple Sclerosis, or Paralysis?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the SKIN — Psoriasis or Eczema?',
  'Has any applicant been diagnosed/treated/medicated/had symptoms of any disorder of the EYES, EARS, NOSE, or THROAT — Glaucoma, Cataracts, Blindness, Tubes in Ears, Deafness or Hearing Loss, Cochlear Implants, or Chronic Tonsillitis?',
  'MALE APPLICANTS only — Has any male applicant been diagnosed/treated/medicated for any disorder of the BREAST, PROSTATE, or MALE REPRODUCTIVE SYSTEM — including an abnormal PSA test or impotence?',
  'FEMALE APPLICANTS only — Has any female applicant been diagnosed/treated/medicated for any disorder of the BREAST or FEMALE REPRODUCTIVE SYSTEM — Endometriosis, Pelvic Pain, Menstruation Disorder, Abnormal Pap Test, Cyst, or Fibroid Tumors?',
  'FEMALE APPLICANTS only — Has any applicant ever had a Cesarean Section, miscarriage, abortion, or premature delivery?',
  'Is any applicant listed currently pregnant, or expecting a child with anyone (whether or not listed on this application), or in the process of adoption?',
  'Is any applicant listed who is less than 30 days old?',
  'Has any applicant ever received consultation, testing, or counseling for infertility, impotence, in-vitro fertilization, artificial insemination, or surrogacy?',
  'Has any applicant ever been treated for Sexually Transmitted Disease, hormone imbalance, or oral contraceptive reaction of any kind?',
  'Has any applicant ever tested positive for HIV infection, or been diagnosed as having Acquired Immune Deficiency Syndrome (AIDS) or AIDS Related Complex (ARC)?',
  'Has any applicant ever had, or is considering, any cosmetic or reconstructive surgery, or ever been diagnosed/treated for a congenital birth defect or bodily deformity, or had or is considering an organ transplant?',
  'Does any applicant have a monitoring device, implants, amputation(s), prosthetic, or internal fixations (pins, plates, screws, shunt, pacemaker), or been advised to use a walking aid, wheelchair, or any other device/equipment?',
  'Has any applicant ever had Leukemia, Hodgkin\'s Disease, Lymphoma, or any other form of Cancer?',
  'Has any applicant ever had a tumor, cyst, or any form of growth?',
  'Has any applicant ever had a mental, emotional, or nervous disease or disorder — including Depression, Anxiety, Bulimia, Anorexia, Bipolar Disorder, Mental Retardation, Learning/Behavior Disorder, or Attention Deficit Disorder (ADD)?',
  'Has any applicant ever been advised or treated for alcohol or drug abuse, used illegal drugs, been a member of any alcohol/drug support group, or been given counseling or directive to seek treatment for use or abuse of alcohol or drugs?',
  'In the past 5 years, has any applicant gone to any health care professional for diagnosis, advice, treatment, checkup or consultation, been recommended treatment, or been confined to a hospital, clinic, or other medical facility for any condition, disease, or disorder not listed above?',
  'Has any applicant been cited for a DWI/DUI, had their driver\'s license suspended or revoked in the past 5 years, or currently on probation or been convicted of a felony in the past 10 years?',
  'Are all applicants U.S. Citizens, or do all applicants have Permanent Residence status (Green Card) or in the process of permanent resident?',
  'Do any applicants participate in any hazardous avocation or sport — vehicle racing, skydiving, pilot or student pilot, scuba diving, rock or mountain climbing, or rodeo?',
  'Has any applicant traveled outside the U.S. for more than 30 days in the past 2 years, or does any applicant plan to travel outside the U.S. for more than 30 days in the next 2 years?',
  'Has any person proposed for coverage had an immediate family member (father, mother, brother, sister) diagnosed with heart disease, heart attack, stroke, kidney disorder, diabetes, cancer, leukemia, or Hodgkin\'s Disease?',
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
