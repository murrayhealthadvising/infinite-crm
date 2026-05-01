import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import StatusTag from '../components/StatusTag'
import {
  Search, Plus, Upload, Download, LayoutGrid, List,
  Phone, Mail, MapPin, X, AlertCircle, CheckCircle, ChevronDown
} from 'lucide-react'

const STATUSES = ['All', 'Not Started', 'Interested', 'Apt', 'Ghosted', 'Sold', 'Aged', 'Stop', 'Long Term']

// ─── Ringy / ISalesCRM CSV column map ────────────────────────────────────────
// Every known Ringy export header → our DB field name
const RINGY_MAP = {
  // Name
  'first name': 'first_name', 'firstname': 'first_name', 'fname': 'first_name',
  'last name': 'last_name',  'lastname':  'last_name',  'lname': 'last_name',
  'full name': 'name', 'name': 'name', 'contact name': 'name', 'contact': 'name',

  // Phone — Ringy exports these
  'phone': 'phone', 'phone number': 'phone', 'phonenumber': 'phone',
  'mobile': 'phone', 'mobile phone': 'phone', 'cell': 'phone',
  'cell phone': 'phone', 'primary phone': 'phone', 'phone 1': 'phone',

  // Email
  'email': 'email', 'email address': 'email', 'emailaddress': 'email',

  // Address
  'address': 'address', 'street': 'address', 'address 1': 'address', 'street address': 'address',
  'city': 'city',
  'state': 'state', 'state/province': 'state', 'province': 'state',
  'zip': 'zip', 'zip code': 'zip', 'zipcode': 'zip', 'postal code': 'zip', 'postal': 'zip',

  // Lead metadata
  'source': 'source', 'lead source': 'source',
  'status': 'status', 'lead status': 'status', 'stage': 'status',
  'notes': 'notes', 'note': 'notes', 'comments': 'notes', 'description': 'notes',
  'tags': 'tags_raw',

  // Ringy specific
  'contact id': 'external_id', 'id': 'external_id', 'lead id': 'external_id', 'ringy id': 'external_id',
  'date added': 'imported_at', 'created': 'imported_at', 'date created': 'imported_at',
  'created at': 'imported_at', 'created_at': 'imported_at',

  // ISalesCRM specific
  'company': 'company', 'company name': 'company',
  'dob': 'dob', 'date of birth': 'dob', 'birthday': 'dob',
  'income': 'income', 'annual income': 'income',
  'household size': 'household_size', 'family size': 'household_size',
  'county': 'county',
}

// Status mapping from Ringy labels → our status values
const STATUS_MAP = {
  'new': 'Not Started', 'fresh': 'Not Started', 'new lead': 'Not Started',
  'not started': 'Not Started', 'not contacted': 'Not Started', 'uncontacted': 'Not Started',
  'interested': 'Interested', 'hot': 'Interested', 'warm': 'Interested',
  'apt': 'Apt', 'appointment': 'Apt', 'scheduled': 'Apt', 'appointment set': 'Apt',
  'sold': 'Sold', 'closed': 'Sold', 'won': 'Sold', 'enrolled': 'Sold',
  'ghosted': 'Ghosted', 'no answer': 'Ghosted', 'no response': 'Ghosted',
  'aged': 'Aged', 'old': 'Aged', 'stale': 'Aged',
  'stop': 'Stop', 'do not call': 'Stop', 'dnc': 'Stop', 'not interested': 'Stop',
  'long term': 'Long Term', 'future': 'Long Term', 'follow up later': 'Long Term',
}

function normalizePhone(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  if (digits.length > 6) return raw.trim() // keep as-is if odd format
  return '' // too short to be real
}

function normalizeStatus(raw) {
  if (!raw) return 'Not Started'
  const lower = raw.trim().toLowerCase()
  return STATUS_MAP[lower] || STATUSES.find(s => s.toLowerCase() === lower) || 'Not Started'
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/)
  const nonEmpty = lines.filter(l => l.trim())
  if (nonEmpty.length < 2) return { headers: [], rows: [] }

  // Detect delimiter
  const firstLine = nonEmpty[0]
  const delim = firstLine.includes('\t') ? '\t' : ','

  function parseLine(line) {
    const result = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === delim && !inQ) {
        result.push(cur.trim()); cur = ''
      } else cur += ch
    }
    result.push(cur.trim())
    return result
  }

  const rawHeaders = parseLine(nonEmpty[0])
  const rows = []
  for (let i = 1; i < nonEmpty.length; i++) {
    const vals = parseLine(nonEmpty[i])
    if (vals.every(v => !v)) continue
    const row = {}
    rawHeaders.forEach((h, idx) => { row[h] = vals[idx] || '' })
    rows.push(row)
  }
  return { headers: rawHeaders, rows }
}

function mapRow(row) {
  const out = {}

  for (const [col, val] of Object.entries(row)) {
    const key = col.toLowerCase().trim()
    const field = RINGY_MAP[key]
    if (field && val && val.trim()) out[field] = val.trim()
  }

  // Build full name from parts
  if (!out.name) {
    const parts = [out.first_name, out.last_name].filter(Boolean)
    if (parts.length) out.name = parts.join(' ')
  }

  // Normalize phone
  if (out.phone) out.phone = normalizePhone(out.phone)

  // Normalize status
  out.status = normalizeStatus(out.status)

  // Parse tags string → array
  if (out.tags_raw) {
    out.tags = out.tags_raw.split(/[,;|]/).map(t => t.trim()).filter(Boolean)
    delete out.tags_raw
  } else {
    out.tags = []
  }

  // Drop fields that aren't in our schema
  delete out.imported_at

  return out
}

export default function Leads() {
  const { user } = useApp()
  const navigate = useNavigate()
  const fileRef = useRef()

  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [view, setView] = useState('list')

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importPreview, setImportPreview] = useState(null)
  const [unmappedCols, setUnmappedCols] = useState([])

  const loadLeads = useCallback(async () => {
    if (!user) return
    setLoading(true)
    let q = supabase
      .from('leads')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (statusFilter !== 'All') q = q.eq('status', statusFilter)
    if (search.trim()) q = q.or(
      `name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%,zip.ilike.%${search}%,city.ilike.%${search}%`
    )
    const { data, error } = await q
    if (!error) setLeads(data || [])
    setLoading(false)
  }, [user, statusFilter, search])

  useEffect(() => { loadLeads() }, [loadLeads])

  // ── CSV file selected ────────────────────────────────────────────────────
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const text = await file.text()
    const { headers, rows } = parseCSV(text)

    if (!rows.length) {
      setImportResult({ error: 'No data rows found in CSV.' })
      return
    }

    const mapped = rows.map(mapRow)

    // Detect which columns didn't map to anything
    const unmapped = headers.filter(h => {
      const key = h.toLowerCase().trim()
      return !RINGY_MAP[key] && h.trim()
    })
    setUnmappedCols(unmapped)

    // Count how many have phones
    const withPhone = mapped.filter(r => r.phone).length

    setImportPreview({
      rows: mapped,
      total: mapped.length,
      withPhone,
      filename: file.name,
      sample: mapped.slice(0, 3),
    })
    setImportResult(null)
  }

  // ── Confirm import ───────────────────────────────────────────────────────
  const confirmImport = async () => {
    if (!importPreview) return
    setImporting(true)
    setImportResult(null)

    const { rows } = importPreview
    let imported = 0, dupes = 0, errors = 0
    const CHUNK = 100

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map(r => ({
        ...r,
        user_id: user.id,
        source: r.source || 'Ringy Import',
        tags: r.tags || [],
      }))

      // Separate rows with phones (can dedupe) from those without
      const withPhone = chunk.filter(r => r.phone)
      const withoutPhone = chunk.filter(r => !r.phone)

      // Upsert phone rows with dedup
      if (withPhone.length) {
        const { error, data } = await supabase
          .from('leads')
          .upsert(withPhone, { onConflict: 'user_id,phone', ignoreDuplicates: true })
        if (error) { console.error(error); errors += withPhone.length }
        else imported += withPhone.length
      }

      // Insert no-phone rows (no dedup possible)
      if (withoutPhone.length) {
        const { error } = await supabase.from('leads').insert(withoutPhone)
        if (error) { console.error(error); errors += withoutPhone.length }
        else imported += withoutPhone.length
      }
    }

    setImportResult({ ok: true, imported, dupes, errors, total: rows.length })
    setImportPreview(null)
    setImporting(false)
    loadLeads()
  }

  // ── Export ───────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['Name', 'Phone', 'Email', 'City', 'State', 'Zip', 'Status', 'Source', 'Notes']
    const rows = leads.map(l =>
      [l.name, l.phone, l.email, l.city, l.state, l.zip, l.status, l.source, l.notes]
        .map(v => `"${(v || '').replace(/"/g, '""')}"`)
        .join(',')
    )
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const statusCounts = {}
  STATUSES.forEach(s => {
    statusCounts[s] = s === 'All' ? leads.length : leads.filter(l => l.status === s).length
  })

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-10 px-6 py-4 border-b border-[#1A2130] flex items-center gap-3 flex-wrap"
        style={{ background: '#080B0F' }}>
        <h1 className="text-xl font-bold text-white">Leads</h1>
        <span className="text-sm text-[#8899AA]">{leads.length} total</span>
        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8899AA]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, email, zip..."
            className="pl-9 pr-8 py-2 rounded-lg text-sm bg-[#0D1117] border border-[#1A2130] text-white focus:outline-none focus:border-[#00D4FF]/50 w-64" />
          {search && <button onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8899AA] hover:text-white"><X size={12} /></button>}
        </div>

        <button onClick={exportCSV}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">
          <Download size={14} /> Export
        </button>

        {/* Import CSV */}
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">
          <Upload size={14} /> Import CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFileSelect} />

        {/* View toggle */}
        <div className="flex rounded-lg border border-[#1A2130] overflow-hidden">
          {[['list', List], ['grid', LayoutGrid]].map(([v, Icon]) => (
            <button key={v} onClick={() => setView(v)}
              className={`p-2 ${view === v ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'text-[#8899AA] hover:text-white'}`}>
              <Icon size={14} />
            </button>
          ))}
        </div>

        <button onClick={() => navigate('/leads/new')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-black"
          style={{ background: 'linear-gradient(135deg, #00D4FF, #0099CC)' }}>
          <Plus size={14} /> Add Lead
        </button>
      </div>

      {/* ── Import result banner ── */}
      {importResult && (
        <div className={`mx-6 mt-3 px-4 py-3 rounded-lg flex items-start gap-2 text-sm ${
          importResult.error
            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
        }`}>
          {importResult.error
            ? <><AlertCircle size={16} className="mt-0.5 flex-shrink-0" />{importResult.error}</>
            : <><CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>
                  Imported <strong>{importResult.imported}</strong> leads successfully.
                  {importResult.errors > 0 && ` ${importResult.errors} failed.`}
                </span>
              </>
          }
          <button onClick={() => setImportResult(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* ── Import preview ── */}
      {importPreview && (
        <div className="mx-6 mt-3 rounded-xl border border-[#00D4FF]/30 p-4" style={{ background: '#00D4FF08' }}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-white">
                Ready to import <strong>{importPreview.total}</strong> leads from <span className="text-[#00D4FF]">{importPreview.filename}</span>
              </p>
              <p className="text-xs text-[#8899AA] mt-0.5">
                {importPreview.withPhone} have phone numbers · {importPreview.total - importPreview.withPhone} without phone
              </p>
              {unmappedCols.length > 0 && (
                <p className="text-xs text-yellow-500/80 mt-1">
                  Skipped columns (not recognized): {unmappedCols.join(', ')}
                </p>
              )}
            </div>
            <button onClick={() => setImportPreview(null)} className="text-[#8899AA] hover:text-white"><X size={14} /></button>
          </div>

          {/* Sample preview */}
          <div className="space-y-1 mb-3 bg-[#0A0E14] rounded-lg p-3">
            <p className="text-xs text-[#556677] mb-2">Preview (first 3 rows):</p>
            {importPreview.sample.map((r, i) => (
              <div key={i} className="text-xs text-[#8899AA] font-mono">
                {r.name || '(no name)'} · {r.phone || '(no phone)'} · {r.status}
                {r.city && ` · ${r.city}, ${r.state || ''}`}
              </div>
            ))}
            {importPreview.total > 3 && (
              <div className="text-xs text-[#445566]">...and {importPreview.total - 3} more</div>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={confirmImport} disabled={importing}
              className="px-4 py-2 rounded-lg text-sm font-medium text-black"
              style={{ background: importing ? '#446677' : 'linear-gradient(135deg, #00D4FF, #0099CC)' }}>
              {importing ? `Importing...` : `Import ${importPreview.total} Leads`}
            </button>
            <button onClick={() => setImportPreview(null)}
              className="px-4 py-2 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Status filter tabs ── */}
      <div className="px-6 pt-3 flex gap-1.5 overflow-x-auto flex-shrink-0">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              statusFilter === s
                ? 'bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/30'
                : 'text-[#8899AA] border border-transparent hover:text-white hover:border-[#1A2130]'
            }`}>
            {s} ({statusCounts[s]})
          </button>
        ))}
      </div>

      {/* ── Lead list / grid ── */}
      <div className="flex-1 overflow-auto p-6 pt-3">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-[#8899AA] text-sm">Loading leads...</div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-[#1A2130]">
              <Upload size={20} className="text-[#8899AA]" />
            </div>
            <p className="text-[#8899AA] text-sm">No leads yet</p>
            <button onClick={() => fileRef.current?.click()}
              className="text-sm text-[#00D4FF] hover:underline">Import your Ringy CSV</button>
          </div>
        ) : view === 'list' ? (
          <div className="rounded-xl border border-[#1A2130] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1A2130]" style={{ background: '#0D1117' }}>
                  {['Name', 'Phone', 'Location', 'Status', 'Source'].map(h => (
                    <th key={h} className={`text-left px-4 py-3 text-xs text-[#8899AA] font-medium ${
                      h === 'Location' ? 'hidden md:table-cell' : h === 'Source' ? 'hidden lg:table-cell' : ''
                    }`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1A2130]">
                {leads.map(lead => (
                  <tr key={lead.id}
                    className="hover:bg-[#1A2130]/50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/leads/${lead.id}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: '#00D4FF20', color: '#00D4FF' }}>
                          {(lead.name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="text-white font-medium">{lead.name || '—'}</div>
                          {lead.email && <div className="text-xs text-[#8899AA] truncate max-w-[180px]">{lead.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#8899AA] font-mono text-xs">{lead.phone || '—'}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-[#8899AA]">
                      {[lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3"><StatusTag status={lead.status} /></td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-[#8899AA]">{lead.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {leads.map(lead => (
              <div key={lead.id}
                className="rounded-xl border border-[#1A2130] p-4 cursor-pointer hover:border-[#00D4FF]/30 transition-all"
                style={{ background: '#0D1117' }}
                onClick={() => navigate(`/leads/${lead.id}`)}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{ background: '#00D4FF20', color: '#00D4FF' }}>
                    {(lead.name || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-white font-medium truncate">{lead.name || '—'}</div>
                    <StatusTag status={lead.status} small />
                  </div>
                </div>
                {lead.phone && <div className="flex items-center gap-1.5 text-xs text-[#8899AA] mt-1"><Phone size={10}/>{lead.phone}</div>}
                {lead.email && <div className="flex items-center gap-1.5 text-xs text-[#8899AA] mt-1 truncate"><Mail size={10}/>{lead.email}</div>}
                {(lead.city || lead.state) && <div className="flex items-center gap-1.5 text-xs text-[#8899AA] mt-1"><MapPin size={10}/>{[lead.city, lead.state].filter(Boolean).join(', ')}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
