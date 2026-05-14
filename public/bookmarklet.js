// Infinite CRM — PitchPerfect bookmarklet
//
// Clicking the bookmark INJECTS a persistent floating "⚡ Send to CRM" button
// at the bottom-right of the page. The button stays until you refresh, so you
// only have to hit the bookmarks bar once per session.
//
// Click the floating button on any PitchPerfect contact panel → scrape the
// visible Contact Details → confirm in an overlay → POST to the worker.

;(function () {
  var AGENT_ID = window.__INFINITE_AGENT_ID
  var WORKER   = window.__INFINITE_WORKER
  if (!AGENT_ID || !WORKER) {
    alert('CRM bookmarklet not configured — reinstall from Settings → Integrations.')
    return
  }

  // ── Inject (or remove) the floating launcher button ─────────────────────
  var EXISTING_LAUNCHER = document.getElementById('infinite-crm-launcher')
  if (EXISTING_LAUNCHER) {
    EXISTING_LAUNCHER.remove()
    return
  }

  var launcher = document.createElement('button')
  launcher.id = 'infinite-crm-launcher'
  launcher.type = 'button'
  launcher.setAttribute('aria-label', 'Send current contact to CRM')
  launcher.title = 'Send current PitchPerfect contact to your CRM (Interested)'
  launcher.innerHTML = '<span style="font-size:18px;line-height:1">⚡</span><span>Send to CRM</span>'
  Object.assign(launcher.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483646',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderRadius: '999px',
    border: '0',
    background: 'linear-gradient(135deg, #00E5C3, #3B82F6)',
    color: '#000',
    font: '600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    cursor: 'pointer',
    boxShadow: '0 10px 25px rgba(0, 229, 195, 0.35), 0 4px 10px rgba(0,0,0,0.35)',
    transition: 'transform 120ms ease, box-shadow 120ms ease',
    userSelect: 'none',
  })
  launcher.addEventListener('mouseenter', function () { launcher.style.transform = 'translateY(-2px)' })
  launcher.addEventListener('mouseleave', function () { launcher.style.transform = '' })
  document.body.appendChild(launcher)

  // Subtle hint toast on first install so the user notices the button
  showToast('CRM button ready — click ⚡ on any contact', 1800)

  launcher.addEventListener('click', openOverlay)

  // Allow drag to reposition the launcher within the viewport
  ;(function makeDraggable() {
    var moved = false, startX, startY, baseRight, baseBottom
    launcher.addEventListener('mousedown', function (e) {
      moved = false
      startX = e.clientX; startY = e.clientY
      var r = launcher.getBoundingClientRect()
      baseRight = window.innerWidth - r.right
      baseBottom = window.innerHeight - r.bottom
      function move(ev) {
        var dx = ev.clientX - startX, dy = ev.clientY - startY
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
        if (moved) {
          launcher.style.right  = Math.max(8, baseRight  - dx) + 'px'
          launcher.style.bottom = Math.max(8, baseBottom - dy) + 'px'
        }
      }
      function up(ev) {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        // If user actually dragged, suppress the click that follows
        if (moved) ev.stopImmediatePropagation()
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }, true)
    launcher.addEventListener('click', function (e) {
      if (moved) { e.stopImmediatePropagation(); moved = false }
    }, true)
  })()

  // ── Scrape known PitchPerfect labels ────────────────────────────────────
  // The "Contact Details" panel renders label/value text pairs. We walk every
  // text node, identify the labels, then take the next non-empty text node
  // as their value.
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
    function isLabel(s) {
      var clean = String(s || '').replace(/:$/, '').trim()
      return LABELS[clean] || LABELS[LABEL_KEYS.find(function (k) { return k.toLowerCase() === clean.toLowerCase() })]
    }
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

  function openOverlay() {
    if (document.getElementById('infinite-crm-overlay')) return
    var scraped = scrapeFields()
    var wrap = el('div', { id: 'infinite-crm-overlay', style: {
      position: 'fixed', top: '20px', right: '20px', zIndex: '2147483647',
      width: '340px', maxHeight: '80vh', overflowY: 'auto',
      background: '#0E1318', border: '1px solid #1A2130', borderRadius: '14px',
      boxShadow: '0 20px 40px rgba(0,0,0,0.6)', color: '#E0E8F0',
      font: '13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '16px',
    }})

    wrap.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' }}, [
        el('div', { style: { width: '20px', height: '20px', borderRadius: '6px', background: 'linear-gradient(135deg,#00E5C3,#3B82F6)' }}),
        el('strong', null, 'Send to CRM'),
      ]),
      el('button', { style: { background: 'transparent', border: '0', color: '#8899AA', cursor: 'pointer', fontSize: '18px' }, onclick: close }, '×'),
    ]))

    var rows = []
    ;[['first_name','First name'],['last_name','Last name'],['phone','Phone'],['email','Email'],['state','State'],['zip','ZIP'],['age','Age'],['source','Source'],['notes','Notes']].forEach(function (pair) {
      var key = pair[0], label = pair[1], isNotes = key === 'notes'
      var row = el('div', { style: { marginBottom: '8px' }})
      row.appendChild(el('label', { style: { display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#5A6A7A', marginBottom: '3px' }}, label))
      var input = el(isNotes ? 'textarea' : 'input', {
        value: scraped[key] != null ? String(scraped[key]) : '',
        rows: isNotes ? 3 : undefined,
        style: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '6px', border: '1px solid #1A2130', background: '#080B0F', color: '#fff', font: 'inherit', resize: isNotes ? 'vertical' : 'none' },
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
    var submit = el('button', { style: { flex: '1', padding: '8px 12px', borderRadius: '8px', border: '0', background: 'linear-gradient(135deg,#00E5C3,#3B82F6)', color: 'black', fontWeight: '600', cursor: 'pointer', font: 'inherit' }}, 'Send to CRM')
    var cancel = el('button', { style: { padding: '8px 12px', borderRadius: '8px', border: '1px solid #1A2130', background: 'transparent', color: '#8899AA', cursor: 'pointer', font: 'inherit' }, onclick: close }, 'Cancel')
    btnRow.appendChild(submit); btnRow.appendChild(cancel)
    wrap.appendChild(btnRow)

    document.body.appendChild(wrap)
    rows[0] && rows[0].focus && rows[0].focus()

    function close() { try { document.body.removeChild(wrap) } catch (e) {} }

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
            close()
            showToast(res.body && res.body.duplicate ? '✓ Already in CRM — bumped activity' : '✓ Added to CRM (Interested)', 2200)
            flash(launcher)
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
  }

  function showToast(msg, ms) {
    var t = el('div', { style: {
      position: 'fixed', right: '20px', bottom: '70px', zIndex: '2147483646',
      background: '#0E1318', color: '#00E5C3', padding: '10px 14px',
      borderRadius: '10px', border: '1px solid #00E5C340',
      boxShadow: '0 10px 25px rgba(0,0,0,0.45)',
      font: '12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      transition: 'opacity 240ms ease, transform 240ms ease',
      opacity: '0', transform: 'translateY(10px)',
    }}, msg)
    document.body.appendChild(t)
    requestAnimationFrame(function () { t.style.opacity = '1'; t.style.transform = 'translateY(0)' })
    setTimeout(function () {
      t.style.opacity = '0'; t.style.transform = 'translateY(10px)'
      setTimeout(function () { try { t.remove() } catch (e) {} }, 300)
    }, ms || 2000)
  }

  function flash(button) {
    var old = button.style.boxShadow
    button.style.boxShadow = '0 0 0 6px rgba(0, 229, 195, 0.4), 0 10px 25px rgba(0, 229, 195, 0.5)'
    setTimeout(function () { button.style.boxShadow = old }, 600)
  }
})();
