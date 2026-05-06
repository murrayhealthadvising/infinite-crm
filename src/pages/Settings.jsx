import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { createClient } from '@supabase/supabase-js'
import {
  Key, CheckCircle, XCircle, Eye, EyeOff, Copy,
  Plus, Trash2, Check, X, GripVertical, AlertTriangle, Tags as TagsIcon,
  UserPlus, Users as UsersIcon, RefreshCw,
} from 'lucide-react'

// Headless secondary Supabase client — used to create a runner account
// WITHOUT logging the current agent out. persistSession=false so it leaves
// no trace in localStorage; the agent's own session stays untouched.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
let _headless = null
function headlessClient() {
  if (_headless) return _headless
  if (!SUPABASE_URL || !SUPABASE_KEY) return null
  _headless = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  return _headless
}

function randomPassword(len = 12) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

const PRESET_COLORS = [
  '#00E5C3','#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#F97316','#EC4899','#14B8A6','#64748B','#8899AA','#A3E635',
  '#06B6D4','#D946EF','#FB7185','#22D3EE',
]

// Default tag IDs that ship with the CRM (cannot be deleted, but can be re-colored/re-labeled)
const DEFAULT_TAG_IDS = new Set(['not-started','interested','apt','ghosted','sold','aged','stop','long-term'])

// Soften a hex color into a dark tinted background
function darken(hex) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return '#1A2130'
  return hex + '18'
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PRESET_COLORS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)}
          className="w-6 h-6 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
          style={{ background: c, outline: value === c ? '2px solid white' : 'none', outlineOffset: 2 }}>
          {value === c && <Check size={11} className="text-black" />}
        </button>
      ))}
      <label className="relative inline-flex items-center justify-center w-6 h-6 rounded-full overflow-hidden cursor-pointer border border-[#2A3547]"
        title="Custom color"
        style={{ background: value || '#fff' }}>
        <input type="color" value={value || '#00E5C3'} onChange={e => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer" />
      </label>
    </div>
  )
}

function TagRow({ tag, count, onUpdate, onDelete, isDefault, onDragStart, onDragOver, onDrop, dragging }) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(tag.label)
  const [color, setColor] = useState(tag.color)

  useEffect(() => { setLabel(tag.label); setColor(tag.color) }, [tag.label, tag.color])

  const save = async () => {
    if (!label.trim()) return
    await onUpdate(tag.id, { label: label.trim(), color, bg: darken(color) })
    setEditing(false)
  }
  const cancel = () => { setLabel(tag.label); setColor(tag.color); setEditing(false) }

  return (
    <div
      draggable={!editing}
      onDragStart={(e) => onDragStart?.(e, tag.id)}
      onDragOver={(e) => onDragOver?.(e, tag.id)}
      onDrop={(e) => onDrop?.(e, tag.id)}
      className={`flex items-start gap-3 py-3 border-b border-[#1A2130] last:border-0 ${dragging ? 'opacity-40' : ''}`}
      style={{ cursor: editing ? 'default' : 'grab' }}>
      <GripVertical size={14} className="text-[#3A4A5A] mt-1 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="space-y-2">
            <input value={label} onChange={e => setLabel(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
              className="bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#00E5C340] w-full max-w-xs" />
            <ColorPicker value={color} onChange={setColor} />
            <div className="flex items-center gap-1 pt-1">
              <button onClick={save}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-black"
                style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                <Check size={11} /> Save
              </button>
              <button onClick={cancel}
                className="px-2 py-1 rounded text-xs text-[#5A6A7A] hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: tag.color }} />
            <span className="text-sm text-white font-medium">{tag.label}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-mono uppercase tracking-wider"
              style={{ background: tag.bg, color: tag.color, border: `1px solid ${tag.color}40` }}>
              preview
            </span>
            <span className="text-xs text-[#5A6A7A]">
              {count} lead{count === 1 ? '' : 's'} · id: <code className="text-[#3A4A5A]">{tag.id}</code>
            </span>
            {isDefault && <span className="text-[10px] text-[#3A4A5A] font-mono uppercase">default</span>}
          </div>
        )}
      </div>
      {!editing && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setEditing(true)}
            className="text-xs px-2 py-1 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white hover:border-[#2A3547]">
            Edit
          </button>
          {!isDefault && (
            <button onClick={() => onDelete(tag, count)}
              disabled={count > 0}
              className="p-1.5 rounded text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title={count > 0 ? `Reassign the ${count} lead${count === 1 ? '' : 's'} first` : 'Delete stage'}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner Access — manage temp runner accounts that work UNDER this agent
// Each runner gets their own login but sees this agent's leads (RLS enforced).
// Creation uses a headless Supabase client so the current agent stays signed in.
// ─────────────────────────────────────────────────────────────────────────────
function RunnerAccessPanel() {
  const [runners, setRunners] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [msg, setMsg] = useState(null)

  // Add-runner form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null)  // {email, password} after success
  const [showPw, setShowPw] = useState(false)
  const [copyHit, setCopyHit] = useState('')

  const refresh = async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('list_my_runners')
    if (!error) setRunners(Array.isArray(data) ? data : [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  const resetForm = () => {
    setEmail(''); setPassword(''); setCreated(null); setMsg(null); setShowPw(false)
  }
  const closeModal = () => { setShowAdd(false); resetForm() }

  const handleCreate = async (e) => {
    e?.preventDefault()
    setMsg(null)
    if (!email.trim()) { setMsg({ type: 'error', text: 'Email required' }); return }
    if (!password || password.length < 6) { setMsg({ type: 'error', text: 'Password must be 6+ characters' }); return }
    setCreating(true)
    try {
      const tmp = headlessClient()
      if (!tmp) throw new Error('Supabase env vars missing')
      // Create the auth account (without disturbing the agent's session)
      const { error: signErr } = await tmp.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { full_name: email.split('@')[0], role: 'runner' } },
      })
      if (signErr && !/already registered/i.test(signErr.message)) {
        throw signErr
      }
      // Promote them to runner under this agent
      const { error: actErr } = await supabase.rpc('activate_runner', { runner_email: email.trim().toLowerCase() })
      if (actErr) throw actErr
      setCreated({ email: email.trim().toLowerCase(), password })
      setMsg({ type: 'success', text: 'Runner created. Share these credentials with them.' })
      refresh()
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Failed to create runner.' })
    } finally {
      setCreating(false)
    }
  }

  const handleDeactivate = async (r) => {
    if (!confirm(`Revoke runner access for ${r.email}? They will no longer see your leads.`)) return
    const { error } = await supabase.rpc('deactivate_runner', { rid: r.id })
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setMsg({ type: 'success', text: `${r.email} deactivated.` })
    refresh()
    setTimeout(() => setMsg(null), 4000)
  }

  const copy = (text, key) => {
    navigator.clipboard.writeText(text); setCopyHit(key); setTimeout(() => setCopyHit(''), 1200)
  }

  return (
    <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] flex items-center gap-2">
            <UsersIcon size={12} /> Runner Access
          </h2>
          <p className="text-xs text-[#3A4A5A] mt-1">
            Create logins for people working under you. Runners see and edit your leads (notes, stage, runner pill) but cannot delete, import, or invite. Each runner gets their own login.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={refresh} title="Refresh"
            className="p-2 rounded-lg text-[#5A6A7A] hover:text-white hover:bg-[#1A2130]">
            <RefreshCw size={13} />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-black"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <UserPlus size={13} /> Add Runner
          </button>
        </div>
      </div>

      {msg && !showAdd && (
        <div className={`mb-3 px-3 py-2 rounded-lg flex items-center gap-2 text-xs ${
          msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.type === 'success' ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-[#5A6A7A] py-3">Loading runners…</p>
      ) : runners.length === 0 ? (
        <div className="border border-dashed border-[#1A2130] rounded-lg py-6 text-center">
          <p className="text-sm text-[#5A6A7A]">No runners yet.</p>
          <p className="text-xs text-[#3A4A5A] mt-1">Click <strong className="text-[#8899AA]">Add Runner</strong> to create one.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#1A2130] border border-[#1A2130] rounded-lg overflow-hidden">
          {runners.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-black flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #A78BFA, #7C3AED)' }}>
                {(r.email || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{r.full_name || r.email.split('@')[0]}</p>
                <p className="text-xs text-[#5A6A7A] truncate">{r.email}</p>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: '#A78BFA15', color: '#A78BFA', border: '1px solid #A78BFA40' }}>
                runner
              </span>
              <button onClick={() => handleDeactivate(r)}
                className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-[#EF4444] hover:bg-[#EF444415]"
                title="Revoke access">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Runner modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !creating && closeModal()} />
          <div className="relative w-full max-w-md rounded-2xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <UserPlus size={15} /> {created ? 'Runner created' : 'Add a runner'}
              </h3>
              <button onClick={closeModal} disabled={creating} className="text-[#5A6A7A] hover:text-white">
                <X size={16} />
              </button>
            </div>

            {created ? (
              <div className="p-5 space-y-4">
                <div className="px-3 py-2 rounded-lg text-xs flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle size={13} /> Send these credentials to your runner. They can change the password later from their own Settings.
                </div>
                <div className="rounded-lg border border-[#1A2130] p-3 space-y-3" style={{ background: '#080B0F' }}>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">Email</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm text-white font-mono truncate">{created.email}</code>
                      <button onClick={() => copy(created.email, 'em')}
                        className="text-[#5A6A7A] hover:text-white">
                        {copyHit === 'em' ? <Check size={13} className="text-[#00E5C3]" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] block mb-1">Password</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm text-white font-mono truncate">{created.password}</code>
                      <button onClick={() => copy(created.password, 'pw')}
                        className="text-[#5A6A7A] hover:text-white">
                        {copyHit === 'pw' ? <Check size={13} className="text-[#00E5C3]" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>
                </div>
                <button onClick={closeModal}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold text-black"
                  style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="p-5 space-y-3">
                {msg && (
                  <div className={`px-3 py-2 rounded-lg flex items-center gap-2 text-xs ${
                    msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                    {msg.type === 'success' ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
                    {msg.text}
                  </div>
                )}
                <div>
                  <label className="text-xs text-[#8899AA] block mb-1">Runner's email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="alex-runner@example.com" required
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-[#080B0F] border border-[#1A2130] focus:outline-none focus:border-[#00E5C340]" />
                </div>
                <div>
                  <label className="text-xs text-[#8899AA] block mb-1">Password</label>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="At least 6 characters" required minLength={6}
                      className="w-full px-3 py-2 pr-20 rounded-lg text-sm text-white bg-[#080B0F] border border-[#1A2130] focus:outline-none focus:border-[#00E5C340] font-mono" />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button type="button" onClick={() => setShowPw(v => !v)} className="text-[#5A6A7A] hover:text-white p-1">
                        {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button type="button" onClick={() => { setPassword(randomPassword()); setShowPw(true) }}
                        className="text-[10px] font-mono text-[#00E5C3] hover:underline px-1">
                        gen
                      </button>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-[#5A6A7A] leading-relaxed">
                  We'll create the account in the background — you stay signed in. The runner uses these credentials at <span className="text-[#00E5C3] font-mono">/login</span> and lands in your CRM with read/edit access (no delete, no import).
                </p>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={creating}
                    className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-black transition-opacity disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                    {creating ? 'Creating…' : 'Create runner'}
                  </button>
                  <button type="button" onClick={closeModal} disabled={creating}
                    className="px-4 py-2.5 rounded-lg text-sm bg-[#1A2130] text-[#8899AA] hover:text-white">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Side Tags panel — central editor for the chip tags (lead.tags array values).
// Rename/delete here propagates across every lead that uses that tag.
// ─────────────────────────────────────────────────────────────────────────────
function SideTagsPanel() {
  const { leads, updateLead } = useApp()
  const [renaming, setRenaming] = useState(null)
  const [renameText, setRenameText] = useState('')
  const [working, setWorking] = useState(null)
  const [msg, setMsg] = useState(null)

  // Add-tag (creates a placeholder by attaching to no lead — we just track the
  // user's library so it shows up in autocomplete). To make it visible without
  // touching any lead, we keep a local-only set; real persistence happens the
  // moment a tag lands on its first lead.
  const safeLeads = Array.isArray(leads) ? leads : []
  const tagCounts = useMemo(() => {
    const c = new Map()
    for (const l of safeLeads) {
      for (const t of (Array.isArray(l.tags) ? l.tags : [])) {
        if (!t || t === 'starred') continue
        c.set(t, (c.get(t) || 0) + 1)
      }
    }
    return c
  }, [safeLeads])

  const sorted = useMemo(
    () => Array.from(tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    [tagCounts]
  )

  const handleRename = async (oldName) => {
    const next = renameText.trim().toLowerCase()
    if (!next || next === oldName) { setRenaming(null); setRenameText(''); return }
    setWorking(oldName); setMsg(null)
    const affected = safeLeads.filter(l => Array.isArray(l.tags) && l.tags.includes(oldName))
    for (const l of affected) {
      const merged = Array.from(new Set(l.tags.map(t => t === oldName ? next : t)))
      try { await updateLead(l.id, { tags: merged }) } catch {}
    }
    setMsg({ type: 'success', text: `Renamed "${oldName}" → "${next}" on ${affected.length} lead${affected.length === 1 ? '' : 's'}` })
    setTimeout(() => setMsg(null), 4000)
    setWorking(null); setRenaming(null); setRenameText('')
  }

  const handleDelete = async (name) => {
    const count = tagCounts.get(name) || 0
    if (!confirm(`Remove the "${name}" tag from ${count} lead${count === 1 ? '' : 's'}? The tag will disappear from those cards.`)) return
    setWorking(name); setMsg(null)
    const affected = safeLeads.filter(l => Array.isArray(l.tags) && l.tags.includes(name))
    for (const l of affected) {
      const next = l.tags.filter(t => t !== name)
      try { await updateLead(l.id, { tags: next }) } catch {}
    }
    setMsg({ type: 'success', text: `Removed "${name}" from ${affected.length} lead${affected.length === 1 ? '' : 's'}` })
    setTimeout(() => setMsg(null), 4000)
    setWorking(null)
  }

  return (
    <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
      <div className="mb-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] flex items-center gap-2">
          <TagsIcon size={12} /> Side Tags
        </h2>
        <p className="text-xs text-[#3A4A5A] mt-1">
          Chip tags on lead cards (pitched, callback, voicemail, etc.). Rename or delete here and it updates across every lead using that tag.
        </p>
      </div>

      {msg && (
        <div className={`mb-3 px-3 py-2 rounded-lg flex items-center gap-2 text-xs ${
          msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.type === 'success' ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="border border-dashed border-[#1A2130] rounded-lg py-6 text-center">
          <p className="text-sm text-[#5A6A7A]">No side tags yet.</p>
          <p className="text-xs text-[#3A4A5A] mt-1">Add chips on a lead card and they'll show up here.</p>
        </div>
      ) : (
        <div className="border border-[#1A2130] rounded-lg overflow-hidden divide-y divide-[#1A2130]">
          {sorted.map(([name, count]) => (
            <div key={name} className="flex items-center gap-2 px-3 py-2.5">
              {renaming === name ? (
                <>
                  <input autoFocus value={renameText}
                    onChange={e => setRenameText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(name)
                      if (e.key === 'Escape') { setRenaming(null); setRenameText('') }
                    }}
                    className="flex-1 px-2 py-1 rounded text-sm text-white bg-[#080B0F] border border-[#1A2130] focus:outline-none focus:border-[#00E5C340] font-mono" />
                  <button onClick={() => handleRename(name)}
                    disabled={!renameText.trim() || working === name}
                    className="px-2 py-1 rounded text-xs font-medium text-black disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                    {working === name ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => { setRenaming(null); setRenameText('') }}
                    className="px-2 py-1 rounded text-xs text-[#5A6A7A] hover:text-white">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[11px] px-1.5 py-0.5 rounded font-mono"
                    style={{ background: '#1A2130', color: '#8899AA', border: '1px solid #2A3547' }}>
                    #{name}
                  </span>
                  <span className="text-xs text-[#5A6A7A]">{count} lead{count === 1 ? '' : 's'}</span>
                  <div className="flex-1" />
                  <button onClick={() => { setRenaming(name); setRenameText(name) }}
                    className="text-xs px-2 py-1 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white hover:border-[#2A3547]">
                    Rename
                  </button>
                  <button onClick={() => handleDelete(name)}
                    disabled={working === name}
                    className="p-1.5 rounded text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415] disabled:opacity-30">
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const { user, profile, leads, tags, addTag, updateTag, deleteTag, reorderTags, isRunner, isAdmin, splitNotes, setSplitNotes } = useApp()
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  // Password state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState(null)

  // Tag editor state
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState('#00E5C3')
  const [tagMsg, setTagMsg] = useState(null)

  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('type=recovery')) {
      setPwMsg({ type: 'info', text: 'Enter your new password below.' })
    }
  }, [])

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    if (!newPassword) return
    if (newPassword !== confirmPassword) { setPwMsg({ type: 'error', text: 'Passwords do not match.' }); return }
    if (newPassword.length < 6) { setPwMsg({ type: 'error', text: 'Password must be at least 6 characters.' }); return }
    setPwSaving(true); setPwMsg(null)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) setPwMsg({ type: 'error', text: error.message })
    else { setPwMsg({ type: 'success', text: 'Password updated! You can now log in with your new password.' }); setNewPassword(''); setConfirmPassword('') }
    setPwSaving(false)
  }

  const safeLeads = Array.isArray(leads) ? leads : []
  const safeTags = Array.isArray(tags) ? tags : []
  const leadCounts = useMemo(() => {
    const out = {}
    for (const t of safeTags) out[t.id] = 0
    for (const l of safeLeads) {
      if (l.stage && out[l.stage] !== undefined) out[l.stage]++
      else if (out['not-started'] !== undefined) out['not-started']++
    }
    return out
  }, [safeLeads, safeTags])

  const handleAdd = async () => {
    if (!newLabel.trim()) return
    setTagMsg(null)
    try {
      await addTag({ label: newLabel.trim(), color: newColor, bg: darken(newColor) })
      setNewLabel(''); setNewColor('#00E5C3'); setAdding(false)
      setTagMsg({ type: 'success', text: `Added "${newLabel.trim()}" stage` })
      setTimeout(() => setTagMsg(null), 3000)
    } catch (e) { setTagMsg({ type: 'error', text: 'Could not add stage: ' + e.message }) }
  }

  const handleDelete = async (tag, count) => {
    if (count > 0) { setTagMsg({ type: 'error', text: `Move the ${count} lead${count === 1 ? '' : 's'} off "${tag.label}" before deleting it.` }); return }
    if (!confirm(`Delete the "${tag.label}" stage? This cannot be undone.`)) return
    try {
      await deleteTag(tag.id)
      setTagMsg({ type: 'success', text: `Deleted "${tag.label}"` })
      setTimeout(() => setTagMsg(null), 3000)
    } catch (e) { setTagMsg({ type: 'error', text: 'Delete failed: ' + e.message }) }
  }

  const handleDragStart = (e, id) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', id) } catch {}
  }
  const handleDragOver = (e, id) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== dragOverId) setDragOverId(id)
  }
  const handleDrop = async (e, targetId) => {
    e.preventDefault()
    const sourceId = dragId
    setDragId(null); setDragOverId(null)
    if (!sourceId || sourceId === targetId) return
    const ids = sortedTags.map(t => t.id)
    const fromIdx = ids.indexOf(sourceId)
    const toIdx = ids.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0])
    if (typeof reorderTags === 'function') await reorderTags(ids)
  }

  const initials = (user?.email || '?')[0].toUpperCase()
  const emailDisplay = user?.email || ''
  const nameDisplay = profile?.full_name || emailDisplay.split('@')[0] || 'Agent'

  // Sort tags by sort_order, fall back to label
  const sortedTags = [...safeTags].sort((a, b) => {
    const ao = a.sort_order ?? 999, bo = b.sort_order ?? 999
    if (ao !== bo) return ao - bo
    return (a.label || '').localeCompare(b.label || '')
  })

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white mb-2">Settings</h1>

      {/* Profile */}
      <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-4">Profile</h2>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-black flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            {initials}
          </div>
          <div>
            <p className="text-white font-semibold">{nameDisplay}</p>
            <p className="text-[#5A6A7A] text-sm">{emailDisplay}</p>
            <p className="text-[#5A6A7A] text-sm capitalize">{profile?.role || 'Agent'}</p>
          </div>
        </div>
      </div>

      {/* Runner Access — hidden for runners themselves (they only manage their own profile + password) */}
      {!isRunner && <RunnerAccessPanel />}

      {/* Preferences — per-user UI toggles */}
      <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-4">Preferences</h2>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <button
            type="button"
            onClick={() => setSplitNotes(!splitNotes)}
            role="switch"
            aria-checked={splitNotes}
            className="relative w-10 h-6 rounded-full flex-shrink-0 mt-0.5 transition-colors"
            style={{ background: splitNotes ? '#00E5C3' : '#1A2130', border: `1px solid ${splitNotes ? '#00E5C3' : '#2A3547'}` }}>
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
              style={{ left: splitNotes ? '20px' : '2px' }} />
          </button>
          <div className="flex-1">
            <p className="text-sm text-white">Split notes layout</p>
            <p className="text-xs text-[#5A6A7A] mt-0.5">
              Show two side-by-side notes textareas on every lead card and lead detail page. The second one starts blank for every lead. Useful if you want a separate place for, say, "history" vs "next steps".
            </p>
          </div>
        </label>
      </div>

      {/* Side Tags — chip tags on lead cards, central rename/delete editor */}
      <SideTagsPanel />

      {/* Pipeline stages / tags — runners don't get to edit stages */}
      {!isRunner && (
      <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
        <div className="flex items-start justify-between mb-4 gap-3">
          <div>
            <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] flex items-center gap-2">
              <TagsIcon size={12} /> Pipeline Stages & Tags
            </h2>
            <p className="text-xs text-[#3A4A5A] mt-1">
              Customize labels and colors. Add as many stages as your workflow needs — they show up everywhere a status pill appears.
            </p>
          </div>
          <button onClick={() => setAdding(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-black flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Plus size={13} /> {adding ? 'Cancel' : 'Add Stage'}
          </button>
        </div>

        {tagMsg && (
          <div className={`mb-3 px-3 py-2 rounded-lg flex items-center gap-2 text-xs ${
            tagMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            {tagMsg.type === 'success' ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
            {tagMsg.text}
            <button onClick={() => setTagMsg(null)} className="ml-auto"><X size={12} /></button>
          </div>
        )}

        {adding && (
          <div className="rounded-lg border border-[#00E5C320] p-3 mb-3 space-y-2" style={{ background: '#00E5C308' }}>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAdding(false); setNewLabel('') } }}
              autoFocus
              placeholder="Stage name (e.g. 'Quoted', 'Underwriting', 'Renewal')"
              className="bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-[#00E5C340]" />
            <ColorPicker value={newColor} onChange={setNewColor} />
            <button onClick={handleAdd}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-black"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              Add Stage
            </button>
          </div>
        )}

        <div>
          {sortedTags.map(t => (
            <TagRow key={t.id} tag={t} count={leadCounts[t.id] || 0}
              onUpdate={updateTag} onDelete={handleDelete}
              isDefault={DEFAULT_TAG_IDS.has(t.id)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              dragging={dragId === t.id} />
          ))}
          {sortedTags.length === 0 && (
            <p className="text-sm text-[#5A6A7A] py-6 text-center">No stages yet — add your first one above.</p>
          )}
        </div>

        <p className="text-[10px] text-[#3A4A5A] mt-4">
          Drag any row by its handle to reorder — the order here drives column order on Pipeline and pill order on Leads. Every stage is yours to edit (label + color). Custom stages can be deleted when no leads use them; the 8 default IDs (used to map Ringy/USHA dispositions) cannot be deleted but can be re-labeled or re-colored. Your changes don't affect teammates.
        </p>
      </div>
      )}

      {/* Change password */}
      <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-4 flex items-center gap-2">
          <Key size={12} /> Change Password
        </h2>

        {pwMsg && (
          <div className={`mb-4 px-4 py-3 rounded-lg flex items-center gap-2 text-sm ${
            pwMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : pwMsg.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20'
            : 'bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/20'
          }`}>
            {pwMsg.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {pwMsg.text}
          </div>
        )}

        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div className="relative">
            <label className="text-xs text-[#8899AA] block mb-1">New Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="w-full px-3 py-2 pr-10 rounded-lg text-sm text-white bg-[#0A0E14] border border-[#1A2130] focus:border-[#00D4FF]/50 focus:outline-none"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-7 text-[#8899AA] hover:text-white">
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div>
            <label className="text-xs text-[#8899AA] block mb-1">Confirm Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              className="w-full px-3 py-2 rounded-lg text-sm text-white bg-[#0A0E14] border border-[#1A2130] focus:border-[#00D4FF]/50 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pwSaving || !newPassword}
            className="w-full py-2 rounded-lg text-sm font-medium text-black transition-all"
            style={{ background: pwSaving || !newPassword ? '#446677' : 'linear-gradient(135deg, #00D4FF, #0099CC)' }}>
            {pwSaving ? 'Saving...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
