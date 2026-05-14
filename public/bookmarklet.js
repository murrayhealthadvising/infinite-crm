// Infinite CRM — PitchPerfect bookmarklet
// Drag the snippet from Settings → Integrations → "PitchPerfect bookmarklet"
// to your bookmarks bar. Click it on any PitchPerfect contact panel and the
// lead lands in your CRM in the "Interested" stage.
//
// The bookmarklet loader sets window.__INFINITE_AGENT_ID + __INFINITE_WORKER
// then loads THIS file. We scrape the visible "Contact Details" panel
// (label/value pairs like "First Name: Amanda"), confirm with a small
// overlay so the agent can verify before sending, then POST to the worker.

;(function () {
  if (window.__INFINITE_BOOKMARKLET_OPEN) return
  window.__INFINITE_BOOKMARKLET_OPEN = true

  var AGENT_ID = window.__INFINITE_AGENT_ID
  var WORKER   = window.__INFINITE_WORKER   // e.g. 'https://infinite-crm-webhook.your-subdomain.workers.dev'
  if (!AGENT_ID || !WORKER) {
    alert('Bookmarklet not configured — reinstall from Settings → Integrations.')
    window.__INFINITE_BOOKMARKLET_OPEN = false
    return
  }

  // ── Scrape known PitchPerfect labels ────────────────────────────────────
  // The contact details panel renders rows like:
  //   <... text="First Name"> <... text="Amanda">
  // We walk every text node, identify ones whose trimmed value matches a
  // known label, then take the next non-empty text node as its value.
  var LABELS = {
    'First Name': 'first_name',
    'Last Name': 'last_name',
    'Phone Number': 'phone',
    'Phone': 'phone',
    'Email': 'email',
    'Tags': '_tags',
    'Company': '_company',
    'Address': 'address',
    'Street Address': 'street_address',
    'City': 'city',
    'State': 'state',
    'Zip Code': 'zip',
    'Zip': 'zip',
    'Age': 'age',
    'Hh Size': 'household',
    'Household Size': 'household',
    'Income': 'income',
    'Gender': 'gender',
    'Campaign': 'campaign',
    'Source': 'source',
    'Notes': 'notes',
  }
  var LABEL_KEYS = Object.keys(LABELS)

  function collectTextNodes(root) {
    var out = []
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null)
    var n
    while ((n = walker.nextNode())) {
      var t = (n.nodeValue || '').replace(/\s+/g, ' ').trim()
      if (t) out.push({ node: n, text: t })
    }
    return out
  }

  function scrapeFields() {
    var nodes = collectTextNodes(document.body)
    var data = {}
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i].text
      // Allow either "Label" or "Label:" rendering
      var clean = t.replace(/:$/, '').trim()
      var key = LABELS[clean] || LABELS[LABEL_KEYS.find(function (k) { return k.toLowerCase() === clean.toLowerCase() })]
      if (!key) continue
      // Find the next non-empty text node that isn't itself a label
      for (var j = i + 1; j < nodes.length; j++) {
        var v = nodes[j].text
        if (!v) continue
        var cv = v.replace(/:$/, '').trim()
        if (LABELS[cv] || LABELS[LABEL_KEYS.find(function (k) { return k.toLowerCase() === cv.toLowerCase() })]) break
        // Skip dash placeholders PitchPerfect uses for empty fields
        if (v === '-' || v === '—') break
        data[key] = v
        break
      }
    }

    // Tags may come as a single string (one chip) or multiple — split on commas
    if (data._tags) {
      var rawTags = String(data._tags).split(/[,;|]/).map(function (s) { return s.trim().toLowerCase() }).filter(Boolean)
      data.tags = rawTags
      delete data._tags
    }
    // Company maps into source if no source was set
    if (data._company && !data.source) data.source = data._company
    delete data._company

    // Default source label
    if (!data.source) data.source = 'PitchPerfect'

    // Normalize numeric fields
    if (data.age) { var a = parseInt(String(data.age).replace(/\D/g, '')); if (isFinite(a) && a > 0) data.age = a; else delete data.age }
    if (data.household) { var h = parseInt(String(data.household).replace(/\D/g, '')); if (isFinite(h) && h > 0) data.household = h; else delete data.household }
    if (data.income) {
      // Keep range strings verbatim (income is TEXT column); only strip $ from simple integers
      var s = String(data.income).trim()
      if (!/[-–~]/.test(s)) data.income = s.replace(/[^0-9.]/g, '') || s
    }

    return data
  }

  var scraped = scrapeFields()

  // ── Overlay UI ──────────────────────────────────────────────────────────
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

  var wrap = el('div', { style: {
    position: 'fixed', top: '20px', right: '20px', zIndex: '2147483647',
    width: '340px', maxHeight: '80vh', overflowY: 'auto',
    background: '#0E1318', border: '1px solid #1A2130', borderRadius: '14px',
    boxShadow: '0 20px 40px rgba(0,0,0,0.6)', color: '#E0E8F0',
    font: '13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '16px',
  }})

  var header = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}, [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' }}, [
      el('div', { style: { width: '20px', height: '20px', borderRadius: '6px', background: 'linear-gradient(135deg,#00E5C3,#3B82F6)' }}),
      el('strong', null, 'Send to CRM'),
    ]),
    el('button', { style: { background: 'transparent', border: '0', color: '#8899AA', cursor: 'pointer', fontSize: '18px' }, onclick: close }, '×'),
  ])
  wrap.appendChild(header)

  var rows = []
  var FIELD_ORDER = [
    ['first_name', 'First name'],
    ['last_name', 'Last name'],
    ['phone', 'Phone'],
    ['email', 'Email'],
    ['state', 'State'],
    ['zip', 'ZIP'],
    ['age', 'Age'],
    ['source', 'Source'],
    ['notes', 'Notes'],
  ]
  FIELD_ORDER.forEach(function (pair) {
    var key = pair[0], label = pair[1]
    var row = el('div', { style: { marginBottom: '8px' }})
    row.appendChild(el('label', { style: { display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#5A6A7A', marginBottom: '3px' }}, label))
    var isNotes = key === 'notes'
    var input = el(isNotes ? 'textarea' : 'input', {
      value: scraped[key] != null ? String(scraped[key]) : '',
      rows: isNotes ? 3 : undefined,
      style: {
        width: '100%', boxSizing: 'border-box',
        padding: '6px 8px',
        borderRadius: '6px',
        border: '1px solid #1A2130',
        background: '#080B0F',
        color: '#fff',
        font: 'inherit',
        resize: isNotes ? 'vertical' : 'none',
      },
    })
    input.dataset.field = key
    rows.push(input)
    row.appendChild(input)
    wrap.appendChild(row)
  })

  if (Array.isArray(scraped.tags) && scraped.tags.length) {
    var tagsRow = el('div', { style: { marginBottom: '8px' }})
    tagsRow.appendChild(el('label', { style: { display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#5A6A7A', marginBottom: '3px' }}, 'Tags (chips)'))
    var tagsInput = el('input', {
      value: scraped.tags.join(', '),
      style: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '6px', border: '1px solid #1A2130', background: '#080B0F', color: '#fff', font: 'inherit' }
    })
    tagsInput.dataset.field = '_tags'
    rows.push(tagsInput)
    tagsRow.appendChild(tagsInput)
    wrap.appendChild(tagsRow)
  }

  var status = el('div', { style: { fontSize: '11px', color: '#5A6A7A', marginTop: '4px', minHeight: '14px' }})
  wrap.appendChild(status)

  var btnRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' }})
  var submit = el('button', {
    style: {
      flex: '1', padding: '8px 12px', borderRadius: '8px', border: '0',
      background: 'linear-gradient(135deg,#00E5C3,#3B82F6)',
      color: 'black', fontWeight: '600', cursor: 'pointer', font: 'inherit',
    }
  }, 'Send to CRM')
  var cancel = el('button', {
    style: { padding: '8px 12px', borderRadius: '8px', border: '1px solid #1A2130', background: 'transparent', color: '#8899AA', cursor: 'pointer', font: 'inherit' },
    onclick: close
  }, 'Cancel')
  btnRow.appendChild(submit)
  btnRow.appendChild(cancel)
  wrap.appendChild(btnRow)

  document.body.appendChild(wrap)
  rows[0] && rows[0].focus && rows[0].focus()

  function close() {
    try { document.body.removeChild(wrap) } catch (e) {}
    window.__INFINITE_BOOKMARKLET_OPEN = false
  }

  submit.addEventListener('click', function () {
    var payload = { stage: 'interested' }
    rows.forEach(function (r) {
      var k = r.dataset.field
      var v = (r.value || '').trim()
      if (!v) return
      if (k === '_tags') payload.tags = v.split(/[,;|]/).map(function (s) { return s.trim().toLowerCase() }).filter(Boolean)
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
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, ok: r.ok, body: j } }) })
      .then(function (res) {
        if (res.ok) {
          status.style.color = '#00E5C3'
          status.textContent = res.body && res.body.duplicate ? '✓ Already in CRM — bumped activity' : '✓ Added to CRM (Interested)'
          submit.textContent = 'Sent'
          setTimeout(close, 1200)
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
  })
})();
