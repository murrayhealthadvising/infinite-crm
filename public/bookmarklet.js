// Infinite CRM — PitchPerfect bookmarklet
//
// Click the bookmark on a PitchPerfect contact panel → a native <dialog>
// opens with the contact's info prefilled. Editing AND submit work even
// when PitchPerfect has its own modal open, because <dialog>.showModal()
// puts our content in the browser's top layer above any inert parents.

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

  // ── Scrape known PitchPerfect labels ────────────────────────────────────
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
  function isLabel(s) {
    var clean = String(s || '').replace(/:$/, '').trim()
    return LABELS[clean] || LABELS[LABEL_KEYS.find(function (k) { return k.toLowerCase() === clean.toLowerCase() })]
  }
  function scrapeFields() {
    var nodes = collectTextNodes(document.body)
    var data = {}
    for (var i = 0; i < nodes.length; i++) {
      var key = isLabel(nodes[i].text)
      if (!key) continue
      for (var j = i + 1; j < nodes.length; j++) {
        var v = nodes[j].text
        if (!v) continue
        if (isLabel(v)) break
        if (v === '-' || v === '—') break
        data[key] = v
        break
      }
    }
    if (data._tags) {
      data.tags = String(data._tags).split(/[,;|]/).map(function (s) { return s.trim().toLowerCase() }).filter(Boolean)
      delete data._tags
    }
    if (data._company && !data.source) data.source = data._company
    delete data._company
    if (!data.source) data.source = 'PitchPerfect'
    if (data.age) { var a = parseInt(String(data.age).replace(/\D/g, '')); if (isFinite(a) && a > 0) data.age = a; else delete data.age }
    if (data.household) { var h = parseInt(String(data.household).replace(/\D/g, '')); if (isFinite(h) && h > 0) data.household = h; else delete data.household }
    if (data.income) {
      var s = String(data.income).trim()
      if (!/[-–~]/.test(s)) data.income = s.replace(/[^0-9.]/g, '') || s
    }
    return data
  }

  var scraped = scrapeFields()

  // ── DOM helpers ─────────────────────────────────────────────────────────
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

  // ── Native <dialog> escapes PitchPerfect's inert/focus-trap ─────────────
  var dialog = document.createElement('dialog')
  dialog.id = 'infinite-crm-overlay'
  Object.assign(dialog.style, {
    width: '380px',
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

  // Block PitchPerfect's global handlers from seeing our events AFTER our
  // buttons/inputs have processed them. BUBBLE phase only — capture-phase
  // stopPropagation would prevent clicks from ever reaching our buttons.
  ;['mousedown','mouseup','click','keydown','keyup','keypress','input','change','pointerdown','pointerup','focus','focusin','focusout'].forEach(function (ev) {
    dialog.addEventListener(ev, function (e) { e.stopPropagation() }, false)
  })

  dialog.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}, [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' }}, [
      el('div', { style: { width: '20px', height: '20px', borderRadius: '6px', background: 'linear-gradient(135deg,#00E5C3,#3B82F6)' }}),
      el('strong', null, 'Send to CRM'),
    ]),
    el('button', { type: 'button', style: { background: 'transparent', border: '0', color: '#8899AA', cursor: 'pointer', fontSize: '20px', lineHeight: '1' }, onclick: close }, '×'),
  ]))

  var rows = []
  ;[['first_name','First name'],['last_name','Last name'],['phone','Phone'],['email','Email'],['state','State'],['zip','ZIP'],['age','Age'],['source','Source'],['notes','Notes']].forEach(function (pair) {
    var key = pair[0], label = pair[1], isNotes = key === 'notes'
    var row = el('div', { style: { marginBottom: '8px' }})
    row.appendChild(el('label', { style: { display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#5A6A7A', marginBottom: '3px' }}, label))
    var input = el(isNotes ? 'textarea' : 'input', {
      value: scraped[key] != null ? String(scraped[key]) : '',
      rows: isNotes ? 4 : undefined,
      style: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '6px', border: '1px solid #1A2130', background: '#080B0F', color: '#fff', font: 'inherit', resize: isNotes ? 'vertical' : 'none' },
    })
    input.dataset.field = key
    rows.push(input)
    row.appendChild(input)
    dialog.appendChild(row)
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
    dialog.appendChild(tagsRow)
  }

  var status = el('div', { style: { fontSize: '11px', color: '#5A6A7A', marginTop: '4px', minHeight: '14px' }})
  dialog.appendChild(status)

  var btnRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' }})
  var submit = el('button', {
    type: 'button',
    style: { flex: '1', padding: '8px 12px', borderRadius: '8px', border: '0', background: 'linear-gradient(135deg,#00E5C3,#3B82F6)', color: 'black', fontWeight: '600', cursor: 'pointer', font: 'inherit' }
  }, 'Send to CRM')
  var cancel = el('button', {
    type: 'button',
    style: { padding: '8px 12px', borderRadius: '8px', border: '1px solid #1A2130', background: 'transparent', color: '#8899AA', cursor: 'pointer', font: 'inherit' },
    onclick: close,
  }, 'Cancel')
  btnRow.appendChild(submit); btnRow.appendChild(cancel)
  dialog.appendChild(btnRow)

  // Style the ::backdrop so the page dims behind us
  var sheet = document.createElement('style')
  sheet.textContent = '#infinite-crm-overlay::backdrop { background: rgba(0,0,0,0.5) }'
  dialog.appendChild(sheet)

  document.body.appendChild(dialog)
  try { dialog.showModal() } catch (e) {
    // Fallback for old browsers
    Object.assign(dialog.style, { position: 'fixed', inset: '20px auto auto auto', right: '20px', top: '20px' })
    dialog.setAttribute('open', '')
  }
  setTimeout(function () { rows[0] && rows[0].focus && rows[0].focus() }, 30)

  function close() {
    try { dialog.close() } catch (e) {}
    try { document.body.removeChild(dialog) } catch (e) {}
    window.__INFINITE_BOOKMARKLET_OPEN = false
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  submit.onclick = function () {
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
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, ok: r.ok, body: j } }, function () { return { status: r.status, ok: r.ok, body: {} } }) })
      .then(function (res) {
        if (res.ok) {
          var name = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || payload.phone || 'Lead'
          var msg = res.body && res.body.duplicate
            ? '↺ Already in CRM — bumped ' + name
            : '✓ Successfully imported ' + name
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

  // ── Success toast at the bottom of the screen ───────────────────────────
  function showToast(msg) {
    var t = document.createElement('div')
    t.textContent = msg
    Object.assign(t.style, {
      position: 'fixed', left: '50%', bottom: '24px',
      transform: 'translateX(-50%) translateY(20px)',
      zIndex: '2147483647',
      background: '#0E1318', color: '#00E5C3',
      padding: '12px 18px', borderRadius: '999px',
      border: '1px solid #00E5C340',
      boxShadow: '0 10px 30px rgba(0, 229, 195, 0.25), 0 4px 10px rgba(0,0,0,0.4)',
      font: '600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      opacity: '0', transition: 'opacity 280ms ease, transform 280ms ease',
    })
    document.body.appendChild(t)
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
