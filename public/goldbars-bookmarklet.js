// Infinite CRM — GoldBars (VanillaSoft) bookmarklet
//
// Click on a VanillaSoft "GoldBars" lead view → a native <dialog> opens with
// the lead's info prefilled. Submit pushes to the CRM via worker /leads.
//
// Defaults: stage = not-started, source = "GoldBars (VanillaSoft)".
// No PitchPrfct auto-enroll on this path — these leads land silently so the
// agent can decide whether to enroll manually.

;(function () {
  if (window.__INFINITE_BOOKMARKLET_OPEN) return
  window.__INFINITE_BOOKMARKLET_OPEN = true

  var AGENT_ID = window.__INFINITE_AGENT_ID
  var WORKER   = window.__INFINITE_WORKER
  if (!AGENT_ID || !WORKER) {
    alert('Bookmarklet not configured — reinstall from Settings → Integrations.')
    window.__INFINITE_BOOKMARKLET_OPEN = false
    return
  }

  // ── Field label dictionary ─────────────────────────────────────────────
  // VanillaSoft renders most fields as a left-column label / right-column
  // value. Parenthetical hints in labels (e.g. "Quoted Price (Great for SMS
  // Drip)") get stripped before matching so we don't have to enumerate every
  // variant.
  var LABELS = {
    'Name': '_fullname',                // composite — split into first/last
    'First Name': 'first_name',
    'Last Name': 'last_name',
    'Email': 'email',
    'Phone': 'phone',
    'Primary Phone': 'phone',
    'Original Phone Number': '_phone_alt', // backup if Primary blank
    'Address': 'address',
    'Street Address': 'street_address',
    'City': 'city',
    'State': 'state',
    'Zip': 'zip',
    'Zip Code': 'zip',
    'DOB': 'dob',
    'Date of Birth': 'dob',
    'Age': 'age',
    'Gender': 'gender',
    'Income': 'income',
    'Household Size': 'household',
    'Household': 'household',
    'Conditions': '_conditions',
    'Medications': '_medications',
    'Height': '_height',
    'Weight': '_weight',
    'Notes': 'notes',
    'Agent Price': 'price',
    'Quoted Price': '_quoted_price',
    'Price Range': '_price_range',
    'Marketplace Network ID': 'external_id',
    'Lead Id': 'external_id',
    'Lead Source': 'campaign',
    'Tags': '_tags',
    'Landing Page': '_landing_page',
    'Contact ID': '_contact_id',
    'Primary Phone Carrier': '_carrier',
  }
  function normalizeLabel(s) {
    return String(s || '')
      .replace(/\(.*?\)/g, '')          // strip (Great for SMS Drip), (Check For Similar Numbers), etc.
      .replace(/[*•]/g, '')             // strip bullets / asterisks
      .replace(/:$/, '')                // trailing colon
      .replace(/\s+/g, ' ')
      .trim()
  }
  var LABEL_LOOKUP = (function () {
    var m = {}
    Object.keys(LABELS).forEach(function (k) { m[k.toLowerCase()] = LABELS[k] })
    return m
  })()
  function fieldForLabel(s) {
    return LABEL_LOOKUP[normalizeLabel(s).toLowerCase()] || null
  }

  // ── Scrape ─────────────────────────────────────────────────────────────
  // Two passes:
  //   1. Walk text nodes, looking for label/value adjacency.
  //   2. Walk inputs/selects/textareas — if a labeled input has a value, use it.
  // Inputs are usually more reliable than text walk in single-page CRMs.

  // VanillaSoft is a frameset/legacy app: the actual lead data often lives in
  // an iframe, not the top document. Walk all accessible same-origin frames in
  // addition to the top doc so we don't miss data. Different-origin frames are
  // silently skipped (browser blocks access).
  function collectDocs() {
    var docs = []
    function visit(doc) {
      if (!doc) return
      docs.push(doc)
      var frames = doc.querySelectorAll ? doc.querySelectorAll('iframe, frame') : []
      for (var i = 0; i < frames.length; i++) {
        try {
          var sub = frames[i].contentDocument
          if (sub && sub !== doc) visit(sub)
        } catch (e) { /* cross-origin — skip */ }
      }
    }
    visit(document)
    return docs
  }

  function collectTextNodes(root) {
    var out = []
    if (!root || !root.createTreeWalker) return out
    try {
      var walker = root.createTreeWalker(root.body || root.documentElement || root, NodeFilter.SHOW_TEXT, null)
      var n
      while ((n = walker.nextNode())) {
        var t = (n.nodeValue || '').replace(/\s+/g, ' ').trim()
        if (t) out.push({ node: n, text: t })
      }
    } catch (e) { /* defensive */ }
    return out
  }

  function scrapeByText(doc) {
    var nodes = collectTextNodes(doc)
    var data = {}
    for (var i = 0; i < nodes.length; i++) {
      var key = fieldForLabel(nodes[i].text)
      if (!key) continue
      for (var j = i + 1; j < Math.min(i + 5, nodes.length); j++) {
        var v = nodes[j].text
        if (!v) continue
        if (fieldForLabel(v)) break
        if (v === '-' || v === '—' || v === ':') continue
        if (data[key] == null) data[key] = v
        break
      }
    }
    return data
  }

  function scrapeByInputs(doc) {
    var data = {}
    if (!doc || !doc.querySelectorAll) return data
    var inputs
    try { inputs = [].slice.call(doc.querySelectorAll('input, select, textarea')) }
    catch (e) { return data }
    inputs.forEach(function (inp) {
      if (!inp || inp.type === 'hidden' || inp.type === 'submit' || inp.type === 'button') return
      var val = (inp.value || '').trim()
      if (!val) return
      var label = ''
      if (inp.id) {
        try {
          var lbl = doc.querySelector('label[for="' + inp.id.replace(/"/g, '\\"') + '"]')
          if (lbl) label = lbl.textContent || ''
        } catch (e) {}
      }
      if (!label && inp.closest) {
        var parentLbl = inp.closest('label')
        if (parentLbl) label = parentLbl.textContent || ''
      }
      if (!label) label = inp.getAttribute('aria-label') || ''
      if (!label) label = inp.getAttribute('placeholder') || ''
      if (!label) label = inp.getAttribute('name') || ''
      var key = fieldForLabel(label)
      if (!key) return
      if (data[key] == null) data[key] = val
    })
    return data
  }

  function mergeScrapes() {
    var merged = {}
    var docs = collectDocs()
    // First pass: text walk on every accessible doc/frame
    docs.forEach(function (d) {
      var t = scrapeByText(d)
      Object.keys(t).forEach(function (k) { if (merged[k] == null) merged[k] = t[k] })
    })
    // Second pass: inputs (more reliable) — overwrite whatever text walk found
    docs.forEach(function (d) {
      var i = scrapeByInputs(d)
      Object.keys(i).forEach(function (k) { merged[k] = i[k] })
    })
    return merged
  }

  var raw = mergeScrapes()

  // ── Normalize ──────────────────────────────────────────────────────────
  // Split composite Name into first/last, fall back phone to Original Phone
  // Number if Primary blank, clean Agent Price ("$3.50" → 3.50), append the
  // medical-style aux fields ("Conditions", "Medications", etc.) into Notes
  // since the lead schema doesn't have dedicated columns for them.
  if (raw._fullname && !raw.first_name) {
    var parts = String(raw._fullname).trim().split(/\s+/)
    raw.first_name = parts[0] || ''
    raw.last_name  = parts.slice(1).join(' ') || ''
  }
  delete raw._fullname

  if (!raw.phone && raw._phone_alt) raw.phone = raw._phone_alt
  delete raw._phone_alt

  if (raw.price) {
    var p = String(raw.price).replace(/[^0-9.]/g, '')
    if (p) raw.price = Math.round(parseFloat(p) * 100) / 100
    else delete raw.price
  }

  // Roll medical fields + landing page + carrier into Notes so the agent
  // still has them on the lead even though we have no schema for them.
  var auxLines = []
  if (raw._conditions)   auxLines.push('Conditions: '   + raw._conditions)
  if (raw._medications)  auxLines.push('Medications: '  + raw._medications)
  if (raw._height)       auxLines.push('Height: '       + raw._height)
  if (raw._weight)       auxLines.push('Weight: '       + raw._weight)
  if (raw._quoted_price) auxLines.push('Quoted Price: ' + raw._quoted_price)
  if (raw._price_range)  auxLines.push('Price Range: '  + raw._price_range)
  if (raw._landing_page) auxLines.push('Landing Page: ' + raw._landing_page)
  if (raw._carrier)      auxLines.push('Carrier: '      + raw._carrier)
  ;['_conditions','_medications','_height','_weight','_quoted_price','_price_range','_landing_page','_carrier','_contact_id'].forEach(function (k) { delete raw[k] })
  if (auxLines.length) {
    var auxText = auxLines.join('\n')
    raw.notes = raw.notes ? (raw.notes + '\n\n' + auxText) : auxText
  }

  if (raw._tags) {
    raw.tags = String(raw._tags).split(/[,;|]/).map(function (s) { return s.trim().toLowerCase() }).filter(Boolean)
    delete raw._tags
  }

  if (raw.age) {
    var a = parseInt(String(raw.age).replace(/\D/g, ''))
    if (isFinite(a) && a > 0) raw.age = a; else delete raw.age
  }
  if (raw.household) {
    var h = parseInt(String(raw.household).replace(/\D/g, ''))
    if (isFinite(h) && h > 0) raw.household = h; else delete raw.household
  }

  // Default source: tag as GoldBars so we can tell these apart from email
  // imports and PitchPerfect bookmarklet imports. campaign (from Lead Source)
  // gets to keep marketplace branding e.g. "Sam Lamy Marketplace".
  raw.source = 'GoldBars (VanillaSoft)'

  // ── Dialog UI ──────────────────────────────────────────────────────────
  function el(tag, props, children) {
    var e = document.createElement(tag)
    if (props) for (var k in props) {
      if (k === 'style') Object.assign(e.style, props[k])
      else if (k.startsWith('on') && typeof props[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), props[k])
      else e[k] = props[k]
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null) return
      if (typeof c === 'string') e.appendChild(document.createTextNode(c))
      else e.appendChild(c)
    })
    return e
  }

  var dialog = document.createElement('dialog')
  dialog.id = 'infinite-crm-overlay'
  Object.assign(dialog.style, {
    width: '420px',
    maxWidth: '90vw',
    maxHeight: '85vh',
    overflowY: 'auto',
    background: '#0E1318',
    border: '1px solid #1A2130',
    borderRadius: '14px',
    boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
    color: '#E0E8F0',
    font: '13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '16px',
    margin: 'auto',
  })

  // Don't let VanillaSoft's own handlers re-process events that landed on
  // the dialog (they sometimes hijack click/keydown for retry pickers).
  ;['mousedown','mouseup','click','keydown','keyup','keypress','input','change','pointerdown','pointerup','focus','focusin','focusout'].forEach(function (ev) {
    dialog.addEventListener(ev, function (e) { e.stopPropagation() }, false)
  })

  dialog.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}, [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' }}, [
      el('div', { style: { width: '20px', height: '20px', borderRadius: '6px', background: 'linear-gradient(135deg,#F59E0B,#EF4444)' }}),
      el('strong', null, 'Send GoldBars lead to CRM'),
    ]),
    el('button', { type: 'button', style: { background: 'transparent', border: '0', color: '#8899AA', cursor: 'pointer', fontSize: '20px', lineHeight: '1' }, onclick: close }, '×'),
  ]))

  var rows = []
  var FIELDS = [
    ['first_name','First name'],
    ['last_name','Last name'],
    ['phone','Phone'],
    ['email','Email'],
    ['address','Address'],
    ['city','City'],
    ['state','State'],
    ['zip','ZIP'],
    ['dob','DOB'],
    ['age','Age'],
    ['gender','Gender'],
    ['income','Income'],
    ['household','Household size'],
    ['price','Agent price ($)'],
    ['campaign','Lead source (campaign)'],
    ['external_id','Marketplace network ID'],
    ['notes','Notes'],
  ]
  FIELDS.forEach(function (pair) {
    var key = pair[0], label = pair[1], isNotes = key === 'notes'
    var row = el('div', { style: { marginBottom: '8px' }})
    row.appendChild(el('label', { style: { display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#5A6A7A', marginBottom: '3px' }}, label))
    var input = el(isNotes ? 'textarea' : 'input', {
      value: raw[key] != null ? String(raw[key]) : '',
      rows: isNotes ? 5 : undefined,
      style: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '6px', border: '1px solid #1A2130', background: '#080B0F', color: '#fff', font: 'inherit', resize: isNotes ? 'vertical' : 'none' },
    })
    input.dataset.field = key
    rows.push(input)
    row.appendChild(input)
    dialog.appendChild(row)
  })

  if (Array.isArray(raw.tags) && raw.tags.length) {
    var tagsRow = el('div', { style: { marginBottom: '8px' }})
    tagsRow.appendChild(el('label', { style: { display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#5A6A7A', marginBottom: '3px' }}, 'Tags (chips)'))
    var tagsInput = el('input', {
      value: raw.tags.join(', '),
      style: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '6px', border: '1px solid #1A2130', background: '#080B0F', color: '#fff', font: 'inherit' }
    })
    tagsInput.dataset.field = '_tags'
    rows.push(tagsInput)
    tagsRow.appendChild(tagsInput)
    dialog.appendChild(tagsRow)
  }

  var status = el('div', { style: { fontSize: '11px', color: '#5A6A7A', marginTop: '4px', minHeight: '14px' }})
  dialog.appendChild(status)

  var btnRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' }})
  var submit = el('button', {
    type: 'button',
    style: { flex: '1', padding: '8px 12px', borderRadius: '8px', border: '0', background: 'linear-gradient(135deg,#F59E0B,#EF4444)', color: 'black', fontWeight: '600', cursor: 'pointer', font: 'inherit' }
  }, 'Send to CRM')
  var cancel = el('button', {
    type: 'button',
    style: { padding: '8px 12px', borderRadius: '8px', border: '1px solid #1A2130', background: 'transparent', color: '#8899AA', cursor: 'pointer', font: 'inherit' },
    onclick: close,
  }, 'Cancel')
  btnRow.appendChild(submit); btnRow.appendChild(cancel)
  dialog.appendChild(btnRow)

  var sheet = document.createElement('style')
  sheet.textContent = '#infinite-crm-overlay::backdrop { background: rgba(0,0,0,0.5) }'
  dialog.appendChild(sheet)

  // VanillaSoft frameset quirk: document.body sometimes isn't a normal Node.
  // Try body → documentElement → html element — whichever works.
  function safeMount(node) {
    var targets = [document.body, document.documentElement, document.getElementsByTagName('html')[0]]
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i]
      if (t && typeof t.appendChild === 'function') {
        try { t.appendChild(node); return true } catch (e) {}
      }
    }
    return false
  }
  if (!safeMount(dialog)) {
    alert('GoldBars: could not attach the lead overlay to this page. The data was still scraped — refresh and try again.')
    window.__INFINITE_BOOKMARKLET_OPEN = false
    return
  }
  try { dialog.showModal() } catch (e) {
    Object.assign(dialog.style, { position: 'fixed', inset: '20px auto auto auto', right: '20px', top: '20px', zIndex: '2147483647' })
    dialog.setAttribute('open', '')
  }
  setTimeout(function () { rows[0] && rows[0].focus && rows[0].focus() }, 30)

  function close() {
    try { dialog.close() } catch (e) {}
    try { (dialog.parentNode || document.body || document.documentElement).removeChild(dialog) } catch (e) {}
    window.__INFINITE_BOOKMARKLET_OPEN = false
  }

  submit.onclick = function () {
    var payload = { stage: 'not-started', source: 'GoldBars (VanillaSoft)' }
    rows.forEach(function (r) {
      var k = r.dataset.field
      var v = (r.value || '').trim()
      if (!v) return
      if (k === '_tags') payload.tags = v.split(/[,;|]/).map(function (s) { return s.trim().toLowerCase() }).filter(Boolean)
      else if (k === 'price') {
        var p = parseFloat(String(v).replace(/[^0-9.]/g, ''))
        if (isFinite(p) && p > 0) payload.price = p
      }
      else if (k === 'age' || k === 'household') {
        var n = parseInt(String(v).replace(/\D/g, ''))
        if (isFinite(n) && n > 0) payload[k] = n
      }
      else payload[k] = v
    })
    if (!payload.phone && !payload.email) {
      status.textContent = 'Need a phone or email at minimum.'
      status.style.color = '#EF4444'
      return
    }
    submit.disabled = true
    submit.textContent = 'Sending…'
    status.textContent = ''
    fetch(WORKER + '/leads?agent_id=' + encodeURIComponent(AGENT_ID), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, ok: r.ok, body: j } }, function () { return { status: r.status, ok: r.ok, body: {} } }) })
      .then(function (res) {
        if (res.ok) {
          var name = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || payload.phone || 'Lead'
          var msg = res.body && res.body.duplicate
            ? '↺ Already in CRM — bumped ' + name
            : '✓ Imported ' + name + ' from GoldBars'
          close()
          showToast(msg)
        } else {
          status.style.color = '#EF4444'
          status.textContent = 'Failed: ' + (res.body && res.body.error ? res.body.error : ('HTTP ' + res.status))
          submit.disabled = false
          submit.textContent = 'Send to CRM'
        }
      })
      .catch(function (e) {
        status.style.color = '#EF4444'
        status.textContent = 'Network error: ' + String(e)
        submit.disabled = false
        submit.textContent = 'Send to CRM'
      })
  }

  function showToast(msg) {
    var t = document.createElement('div')
    t.textContent = msg
    Object.assign(t.style, {
      position: 'fixed', left: '50%', bottom: '24px',
      transform: 'translateX(-50%) translateY(20px)',
      zIndex: '2147483647',
      background: '#0E1318', color: '#F59E0B',
      padding: '12px 18px', borderRadius: '999px',
      border: '1px solid #F59E0B40',
      boxShadow: '0 10px 30px rgba(245, 158, 11, 0.25), 0 4px 10px rgba(0,0,0,0.4)',
      font: '600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      opacity: '0', transition: 'opacity 280ms ease, transform 280ms ease',
    })
    var toastTarget = document.body || document.documentElement
    if (toastTarget && toastTarget.appendChild) toastTarget.appendChild(t)
    else return  // give up silently — the lead already imported, toast is cosmetic
    requestAnimationFrame(function () {
      t.style.opacity = '1'
      t.style.transform = 'translateX(-50%) translateY(0)'
    })
    setTimeout(function () {
      t.style.opacity = '0'
      t.style.transform = 'translateX(-50%) translateY(20px)'
      setTimeout(function () { try { t.remove() } catch (e) {} }, 320)
    }, 2400)
  }
})();
