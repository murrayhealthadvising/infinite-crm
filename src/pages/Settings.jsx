import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { createClient } from '@supabase/supabase-js'
import {
  Key, CheckCircle, XCircle, Eye, EyeOff, Copy,
  Plus, Trash2, Check, X, GripVertical, AlertTriangle, Tags as TagsIcon,
  UserPlus, Users as UsersIcon, RefreshCw, Calendar as CalendarIcon,
  Link as LinkIcon, Unlink, Zap,
} from 'lucide-react'
import { format } from 'date-fns'
import { connectGoogleCalendar, clearGcalToken, isGcalConnected, getGoogleClientId, createCalendarEvent } from '../lib/gcal'

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
    // 1) Primary: the SECURITY DEFINER RPC (only returns confirmed runners)
    let combined = []
    try {
      const { data } = await supabase.rpc('list_my_runners')
      if (Array.isArray(data)) combined = data
    } catch {}
    // 2) Fallback: direct profiles query — catches runners who signed up but
    //    haven't confirmed email yet, or runners promoted manually in Admin.
    //    This way an agent can ALWAYS see + delete people attached to them.
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.id) {
        const { data: extra } = await supabase
          .from('profiles')
          .select('id:user_id, user_id, email, full_name, role, lead_agent_id, created_at')
          .eq('lead_agent_id', user.id)
        if (Array.isArray(extra)) {
          const seen = new Set(combined.map(r => r.id || r.user_id))
          for (const p of extra) {
            const pid = p.id || p.user_id
            if (!seen.has(pid)) {
              combined.push({ ...p, id: pid, _pending: p.role !== 'runner' })
              seen.add(pid)
            }
          }
        }
      }
    } catch {}
    setRunners(combined)
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
    if (!confirm(`Revoke runner access for ${r.email}? They'll no longer see your leads, but their account stays so you can re-activate later.`)) return
    const { error } = await supabase.rpc('deactivate_runner', { rid: r.id })
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setMsg({ type: 'success', text: `${r.email} deactivated.` })
    refresh()
    setTimeout(() => setMsg(null), 4000)
  }

  const handleDelete = async (r) => {
    if (!confirm(`PERMANENTLY delete ${r.email}? Their account is wiped — they can never log in again with this email. This cannot be undone.`)) return
    if (!confirm(`Really delete? Type their email in the next prompt if you're sure.`)) return
    const conf = window.prompt(`Type "${r.email}" to confirm full deletion:`)
    if (conf !== r.email) { setMsg({ type: 'error', text: 'Email did not match — cancelled.' }); return }
    // Try the SECURITY DEFINER RPC first — it cleans up auth.users + profiles atomically
    let rpcErr = null
    try {
      const { error } = await supabase.rpc('delete_runner', { rid: r.id })
      if (error) rpcErr = error
    } catch (e) { rpcErr = e }
    if (rpcErr) {
      // Fallback: profile-only delete via RLS (works for pre-signup runners
      // whose auth.users entry doesn't exist OR whose RPC isn't installed yet)
      try {
        const { error: pErr } = await supabase.from('profiles').delete().eq('user_id', r.id)
        if (pErr) {
          setMsg({ type: 'error', text: `Delete failed: ${rpcErr.message || rpcErr}. (Fallback also failed: ${pErr.message}.) Run the delete_runner SQL in Supabase, then retry.` })
          return
        }
        setMsg({ type: 'success', text: `${r.email} profile removed (auth account may still exist — full delete needs the SQL function).` })
        refresh()
        setTimeout(() => setMsg(null), 5000)
        return
      } catch (e2) {
        setMsg({ type: 'error', text: `Delete failed: ${rpcErr.message || rpcErr}` })
        return
      }
    }
    setMsg({ type: 'success', text: `${r.email} permanently deleted.` })
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
              {r._pending ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                  style={{ background: '#F59E0B15', color: '#F59E0B', border: '1px solid #F59E0B40' }}
                  title="Signed up but not yet activated as your runner — confirm email or click Deactivate to reset.">
                  pending
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                  style={{ background: '#A78BFA15', color: '#A78BFA', border: '1px solid #A78BFA40' }}>
                  runner
                </span>
              )}
              <button onClick={() => handleDeactivate(r)}
                className="text-xs px-2 py-1 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white hover:border-[#2A3547]"
                title="Revoke runner access (keeps account)">
                Deactivate
              </button>
              <button onClick={() => handleDelete(r)}
                className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-[#EF4444] hover:bg-[#EF444415]"
                title="Permanently delete this runner account">
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
  const { leads, updateLead, sideTagStyles, setSideTagStyles } = useApp()
  const [renaming, setRenaming] = useState(null)
  const [renameText, setRenameText] = useState('')
  const [working, setWorking] = useState(null)
  const [msg, setMsg] = useState(null)
  const [addingTag, setAddingTag] = useState('')

  const safeLeads = Array.isArray(leads) ? leads : []
  const styles = sideTagStyles || {}

  // Build the union: every tag actually used on a lead AND every tag in the
  // user's library (so they can pre-create tags before applying to any lead).
  const tagCounts = useMemo(() => {
    const c = new Map()
    for (const l of safeLeads) {
      for (const t of (Array.isArray(l.tags) ? l.tags : [])) {
        if (!t || t === 'starred') continue
        c.set(t, (c.get(t) || 0) + 1)
      }
    }
    // Library entries with count 0 if not used anywhere yet
    for (const t of Object.keys(styles)) {
      if (!c.has(t)) c.set(t, 0)
    }
    return c
  }, [safeLeads, styles])

  // Sort: library entries first in their saved `order`, then any extras
  // (tags used on leads but not yet in the library) at the bottom, alpha.
  const sorted = useMemo(() => {
    const entries = Array.from(tagCounts.entries())
    const orderOf = (name) => {
      const o = styles[name]?.order
      return typeof o === 'number' ? o : 9999  // un-ordered → bottom
    }
    return entries.sort((a, b) => {
      const oa = orderOf(a[0]), ob = orderOf(b[0])
      if (oa !== ob) return oa - ob
      return a[0].localeCompare(b[0])
    })
  }, [tagCounts, styles])

  // Drag-reorder
  const [dragName, setDragName] = useState(null)
  const reorder = async (fromIdx, toIdx) => {
    if (fromIdx === toIdx || toIdx < 0 || toIdx >= sorted.length) return
    const next = sorted.map(([n]) => n)
    const [item] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, item)
    // Write the new order to every tag's style entry (including ones that
    // weren't in the library yet — promote them so they stick).
    const nextStyles = { ...styles }
    next.forEach((name, i) => {
      nextStyles[name] = { ...(nextStyles[name] || {}), order: i }
    })
    await setSideTagStyles(nextStyles)
  }
  const onDragStart = (name) => setDragName(name)
  const onDragOver = (e) => e.preventDefault()
  const onDrop = (e, targetName) => {
    e.preventDefault()
    if (!dragName || dragName === targetName) { setDragName(null); return }
    const ids = sorted.map(([n]) => n)
    reorder(ids.indexOf(dragName), ids.indexOf(targetName))
    setDragName(null)
  }

  // Style helpers
  const PALETTE = ['#A78BFA','#3B82F6','#10B981','#F59E0B','#EF4444','#EC4899','#22D3EE','#F97316','#84CC16','#FB7185','#06B6D4']
  const updateStyle = async (name, patch) => {
    const next = { ...styles, [name]: { ...(styles[name] || {}), ...patch } }
    await setSideTagStyles(next)
  }
  const clearColor = async (name) => {
    const next = { ...styles, [name]: { ...(styles[name] || {}), color: null } }
    await setSideTagStyles(next)
  }
  const handleAddNew = async () => {
    const v = String(addingTag || '').trim().toLowerCase()
    if (!v) return
    if (tagCounts.has(v)) { setAddingTag(''); return }
    const next = { ...styles, [v]: { color: PALETTE[Object.keys(styles).length % PALETTE.length] } }
    await setSideTagStyles(next)
    setAddingTag('')
  }

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
    // Also remove from the library/styles map so it stops showing on this page.
    if (styles[name]) {
      const nextStyles = { ...styles }
      delete nextStyles[name]
      try { await setSideTagStyles(nextStyles) } catch {}
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

      {/* Add new */}
      <div className="flex items-center gap-2 mb-3">
        <input value={addingTag}
          onChange={e => setAddingTag(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAddNew() }}
          placeholder="Add a new side tag (e.g. pitched, callback)…"
          className="flex-1 px-3 py-2 rounded-lg text-sm text-white bg-[#080B0F] border border-[#1A2130] focus:outline-none focus:border-[#00E5C340] font-mono" />
        <button onClick={handleAddNew} disabled={!addingTag.trim()}
          className="px-3 py-2 rounded-lg text-xs font-semibold text-black disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          <Plus size={12} className="inline -mt-0.5" /> Add
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="border border-dashed border-[#1A2130] rounded-lg py-6 text-center">
          <p className="text-sm text-[#5A6A7A]">No side tags yet.</p>
          <p className="text-xs text-[#3A4A5A] mt-1">Add one above or add chips on a lead card.</p>
        </div>
      ) : (
        <div className="border border-[#1A2130] rounded-lg overflow-hidden divide-y divide-[#1A2130]">
          {sorted.map(([name, count], i) => {
            const s = styles[name] || {}
            const hidden = !!s.hidden
            const color = s.color || null
            const chipStyle = color
              ? { background: color + '15', color, border: `1px solid ${color}60` }
              : { background: '#1A2130', color: '#8899AA', border: '1px solid #2A3547' }
            return (
              <div key={name}
                draggable={renaming !== name}
                onDragStart={() => onDragStart(name)}
                onDragOver={onDragOver}
                onDrop={(e) => onDrop(e, name)}
                className={'flex items-center gap-2 px-3 py-2.5 flex-wrap ' + (hidden ? 'opacity-50 ' : '') + (dragName === name ? 'opacity-40 ' : '')}
                style={{ cursor: renaming === name ? 'default' : 'grab' }}>
                {renaming !== name && <GripVertical size={12} className="text-[#3A4A5A] flex-shrink-0" />}
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
                    <span className="text-[11px] px-1.5 py-0.5 rounded font-mono" style={chipStyle}>
                      #{name}
                    </span>
                    <span className="text-xs text-[#5A6A7A]">{count} lead{count === 1 ? '' : 's'}</span>

                    {/* Color swatches */}
                    <div className="flex items-center gap-0.5 ml-2">
                      {PALETTE.map(c => (
                        <button key={c} onClick={() => updateStyle(name, { color: c })}
                          className="w-4 h-4 rounded-full border"
                          style={{ background: c, borderColor: color === c ? '#fff' : 'transparent' }}
                          title={c} />
                      ))}
                      <label className="relative w-4 h-4 rounded-full border border-[#2A3547] cursor-pointer overflow-hidden ml-0.5"
                        style={{ background: color || '#1A2130' }}
                        title="Custom color">
                        <input type="color" value={color || '#A78BFA'}
                          onChange={e => updateStyle(name, { color: e.target.value })}
                          className="absolute inset-0 opacity-0 cursor-pointer" />
                      </label>
                      {color && (
                        <button onClick={() => clearColor(name)}
                          className="ml-1 text-[10px] text-[#5A6A7A] hover:text-white"
                          title="Reset to default gray">
                          ×
                        </button>
                      )}
                    </div>

                    <div className="flex-1" />

                    {/* Hide toggle */}
                    <label className="flex items-center gap-1 text-[10px] text-[#5A6A7A] cursor-pointer mr-1" title="Hidden tags stay on leads but don't show on cards">
                      <input type="checkbox" checked={hidden}
                        onChange={e => updateStyle(name, { hidden: e.target.checked })}
                        className="accent-[#A78BFA]" />
                      hide
                    </label>

                    <button onClick={() => { setRenaming(name); setRenameText(name) }}
                      className="text-xs px-2 py-1 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white hover:border-[#2A3547]">
                      Rename
                    </button>
                    <button onClick={() => handleDelete(name)}
                      disabled={working === name}
                      className="p-1.5 rounded text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415] disabled:opacity-30"
                      title="Remove from all leads + library">
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Cloudflare Worker URL — exposed via env so it can change without code edits.
// Falls back to the known production URL for the infinite-crm-webhook worker.
const WORKER_URL = (import.meta.env.VITE_CRM_WORKER_URL
  || 'https://infinite-crm-webhook.murrayhealthadvising.workers.dev').replace(/\/+$/, '')

// ─────────────────────────────────────────────────────────────────────────────
// Integrations panel — currently houses the PitchPerfect bookmarklet. The
// agent drags a snippet to their bookmarks bar; clicking it on a PitchPerfect
// contact page scrapes the visible details and POSTs into their CRM.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Campaigns panel — manage the saved campaign list (drag-reorder + delete +
// inline add). The campaign pill dropdown on lead cards reads from here.
// ─────────────────────────────────────────────────────────────────────────────
function CampaignsPanel() {
  const { campaigns, saveCampaigns } = useApp()
  const [adding, setAdding] = useState('')
  const [dragId, setDragId] = useState(null)
  const safe = Array.isArray(campaigns) ? campaigns : []

  const add = async () => {
    const v = String(adding || '').trim()
    if (!v) return
    if (safe.includes(v)) { setAdding(''); return }
    await saveCampaigns([...safe, v])
    setAdding('')
  }
  const remove = async (c) => {
    if (!confirm(`Remove "${c}" from your campaign list? (Leads with this campaign keep the label.)`)) return
    await saveCampaigns(safe.filter(x => x !== c))
  }
  const move = async (fromIdx, toIdx) => {
    if (fromIdx === toIdx || toIdx < 0 || toIdx >= safe.length) return
    const next = [...safe]
    const [item] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, item)
    await saveCampaigns(next)
  }
  const onDragStart = (c) => setDragId(c)
  const onDragOver = (e) => e.preventDefault()
  const onDrop = (e, targetC) => {
    e.preventDefault()
    if (!dragId || dragId === targetC) { setDragId(null); return }
    move(safe.indexOf(dragId), safe.indexOf(targetC))
    setDragId(null)
  }

  return (
    <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
      <div className="mb-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] flex items-center gap-2">
          <TagsIcon size={12} /> Campaigns
        </h2>
        <p className="text-xs text-[#3A4A5A] mt-1">
          Pick list for the campaign pill on lead cards. Drag to reorder · click ➕ to add · ✕ to remove. Removing a campaign here doesn't change leads that already have that label.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <input value={adding}
          onChange={e => setAdding(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="Add a new campaign (e.g. GoldBar, Quote Yeti)…"
          className="flex-1 px-3 py-2 rounded-lg text-sm text-white bg-[#080B0F] border border-[#1A2130] focus:outline-none focus:border-[#00E5C340] font-mono" />
        <button onClick={add} disabled={!adding.trim()}
          className="px-3 py-2 rounded-lg text-xs font-semibold text-black disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          <Plus size={12} className="inline -mt-0.5" /> Add
        </button>
      </div>

      {safe.length === 0 ? (
        <div className="border border-dashed border-[#1A2130] rounded-lg py-6 text-center text-sm text-[#5A6A7A]">
          No campaigns yet — add one above.
        </div>
      ) : (
        <div className="border border-[#1A2130] rounded-lg overflow-hidden divide-y divide-[#1A2130]">
          {safe.map((c, i) => (
            <div key={c}
              draggable
              onDragStart={() => onDragStart(c)}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, c)}
              className={'flex items-center gap-3 px-3 py-2.5 cursor-grab active:cursor-grabbing ' + (dragId === c ? 'opacity-40' : '')}>
              <GripVertical size={13} className="text-[#3A4A5A] flex-shrink-0" />
              <span className="text-sm text-white flex-1 font-mono">{c}</span>
              <span className="text-[10px] text-[#3A4A5A] font-mono">#{i + 1}</span>
              <button onClick={() => move(i, i - 1)} disabled={i === 0}
                className="text-[#3A4A5A] hover:text-white disabled:opacity-20" title="Move up">↑</button>
              <button onClick={() => move(i, i + 1)} disabled={i === safe.length - 1}
                className="text-[#3A4A5A] hover:text-white disabled:opacity-20" title="Move down">↓</button>
              <button onClick={() => remove(c)}
                className="p-1.5 rounded text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415]">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar panel — explains how the Google Calendar integration works (no
// OAuth required) + gives the agent a quick link to their primary calendar.
// Every reminder you set in a lead drawer / detail page has a "+ add 15-min
// slot to Google Calendar" link that opens a pre-filled event in a new tab.
// ─────────────────────────────────────────────────────────────────────────────
function CalendarPanel() {
  const { reminders } = useApp()
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const clientId = getGoogleClientId()
  const hasClientId = !!clientId

  // Re-check connection on mount and after connect/disconnect actions
  const refreshStatus = () => setConnected(isGcalConnected())
  useEffect(() => { refreshStatus() }, [])

  const upcoming = (Array.isArray(reminders) ? reminders : [])
    .filter(r => !r.done_at && r.due_at)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .slice(0, 3)

  const handleConnect = async () => {
    setBusy(true); setMsg(null)
    try {
      await connectGoogleCalendar()
      refreshStatus()
      setMsg({ type: 'success', text: 'Connected. Reminders will now create real calendar events.' })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Connect failed' })
    } finally { setBusy(false) }
  }

  const handleDisconnect = () => {
    if (!confirm('Disconnect Google Calendar? Future reminders will fall back to the popup link.')) return
    clearGcalToken()
    refreshStatus()
    setMsg({ type: 'info', text: 'Disconnected. Reminders will use the URL fallback until you reconnect.' })
  }

  const handleTest = async () => {
    setBusy(true); setMsg(null)
    try {
      const when = new Date(Date.now() + 5 * 60 * 1000)
      const res = await createCalendarEvent({
        title: 'Infinite CRM · test event',
        startsAt: when.toISOString(),
        durationMinutes: 15,
        details: 'You can delete this — Infinite CRM is testing your calendar connection.',
      })
      if (res.ok) setMsg({ type: 'success', text: `Test event created on your calendar (5 min from now). View: ${res.htmlLink}` })
      else setMsg({ type: 'error', text: `Test failed: ${res.error}` })
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Test failed' })
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] flex items-center gap-2">
            <CalendarIcon size={12} /> Google Calendar
            {connected && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: '#10B98115', color: '#10B981', border: '1px solid #10B98140' }}>
                connected
              </span>
            )}
          </h2>
          <p className="text-xs text-[#3A4A5A] mt-1">
            When connected, reminders create real 15-min events on your primary Google Calendar — no popup, no clicking Save. The connection lives in your browser only (no token stored on a server), so you'll re-authorize about once an hour.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {connected ? (
            <>
              <button onClick={handleTest} disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547] disabled:opacity-40">
                Send test event
              </button>
              <button onClick={handleDisconnect} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#EF444440] text-[#EF4444] hover:bg-[#EF444415] disabled:opacity-40">
                <Unlink size={11} /> Disconnect
              </button>
            </>
          ) : (
            <button onClick={handleConnect} disabled={busy || !hasClientId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-black disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <LinkIcon size={11} /> {busy ? 'Connecting…' : 'Connect Google Calendar'}
            </button>
          )}
        </div>
      </div>

      {!hasClientId && (
        <div className="mb-3 rounded-lg border border-[#F59E0B40] px-3 py-2 text-xs text-[#F59E0B]" style={{ background: '#F59E0B08' }}>
          <strong>Setup required.</strong> Google OAuth client ID is missing. Admin: set <code className="px-1 py-0.5 bg-black/30 rounded text-[10px] font-mono">VITE_GOOGLE_CLIENT_ID</code> in Vercel env vars and redeploy. Until then, reminders use the popup link fallback.
        </div>
      )}

      {msg && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs flex items-start gap-2 ${
          msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : msg.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20'
          : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
        }`}>
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)}><X size={12} /></button>
        </div>
      )}

      <div className="rounded-lg border border-[#1A2130] p-3" style={{ background: '#080B0F' }}>
        <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-2">How it works</p>
        <ol className="text-xs text-[#8899AA] space-y-1 list-decimal ml-4">
          <li>Click <span className="text-white font-mono">Connect Google Calendar</span> above — Google asks you to authorize.</li>
          <li>Open any lead → <span className="text-white font-mono">Remind</span> → pick date/time → <span className="text-white font-mono">Set reminder</span>.</li>
          <li>15-min event appears on your calendar instantly. You'll see a green checkmark + a "view ↗" link.</li>
          <li>If the connection expires, the next reminder triggers a silent re-auth (or shows a popup fallback).</li>
        </ol>
      </div>

      {upcoming.length > 0 && (
        <div className="mt-3 rounded-lg border border-[#1A2130] p-3" style={{ background: '#080B0F' }}>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-2">
            Next 3 reminders
          </p>
          <div className="space-y-1.5">
            {upcoming.map(r => {
              let when = ''
              try { when = format(new Date(r.due_at), 'EEE MMM d · h:mm a') } catch {}
              return (
                <div key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="text-[#00E5C3] font-mono w-32 truncate">{when}</span>
                  <span className="text-[#C0D0E0] truncate">{r.note || `(${r.kind || 'reminder'})`}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function IntegrationsPanel() {
  const { user, leadEmail } = useApp()
  const [showInstructions, setShowInstructions] = useState(false)
  const [copyHit, setCopyHit] = useState(false)
  const [leadCopyHit, setLeadCopyHit] = useState(false)
  const agentId = user?.id || ''
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  // The bookmarklet itself is a small loader. It stashes the agent id + worker
  // URL on `window`, then loads /bookmarklet.js (cache-busted) from the CRM,
  // which does the scrape + overlay + POST.
  const snippet = `javascript:(function(){window.__INFINITE_AGENT_ID=${JSON.stringify(agentId)};window.__INFINITE_WORKER=${JSON.stringify(WORKER_URL)};var s=document.createElement('script');s.src=${JSON.stringify(appOrigin + '/bookmarklet.js')}+'?'+Date.now();s.onerror=function(){alert('Could not load CRM bookmarklet — check internet connection.')};document.body.appendChild(s)})();`

  const copySnippet = () => {
    navigator.clipboard.writeText(snippet)
    setCopyHit(true); setTimeout(() => setCopyHit(false), 1500)
  }

  return (
    <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
      <div className="mb-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] flex items-center gap-2">
          <UsersIcon size={12} /> Integrations
        </h2>
        <p className="text-xs text-[#3A4A5A] mt-1">
          Pull leads from your texting platform straight into the CRM with one click.
        </p>
      </div>

      {/* Marketplace forwarding address — the email USHA Lead Arena / Ringy / etc.
          should send leads to. Each agent has their own; show it prominently. */}
      <div className="rounded-lg border border-[#00E5C320] p-4 mb-3" style={{ background: '#00E5C308' }}>
        <p className="text-sm font-semibold text-white mb-1">Marketplace forwarding address</p>
        <p className="text-xs text-[#5A6A7A] mb-3">
          Give this to USHA Lead Arena (or whatever marketplace is sending you leads) as your destination email.
          Anything sent here lands directly in your CRM as a new lead.
        </p>
        {leadEmail ? (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#00E5C340]" style={{ background: '#080B0F' }}>
            <code className="flex-1 text-sm text-[#00E5C3] font-mono truncate select-all">{leadEmail}</code>
            <button onClick={() => { navigator.clipboard.writeText(leadEmail); setLeadCopyHit(true); setTimeout(() => setLeadCopyHit(false), 1500) }}
              className="text-[#5A6A7A] hover:text-white p-1.5 rounded hover:bg-[#1A2130]"
              title="Copy address">
              {leadCopyHit ? <Check size={14} className="text-[#00E5C3]" /> : <Copy size={14} />}
            </button>
          </div>
        ) : (
          <div className="px-3 py-2.5 rounded-lg border border-dashed border-[#1A2130] text-xs text-[#8899AA]">
            Not set up yet. Ask your admin to configure your marketplace address.
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[#A78BFA20] p-4" style={{ background: '#A78BFA08' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">PitchPerfect bookmarklet</p>
            <p className="text-xs text-[#5A6A7A] mt-0.5">
              Drag the <strong className="text-[#A78BFA]">Send to CRM</strong> button below to your browser's bookmarks bar.
              Then on any PitchPerfect contact panel, click it and the lead lands in <strong className="text-[#10B981]">Interested</strong>.
            </p>
          </div>
        </div>

        {/* The actual draggable bookmarklet link */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
          <a
            href={snippet}
            onClick={(e) => e.preventDefault()}
            draggable={true}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-black cursor-grab active:cursor-grabbing select-none"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}
            title="Drag me to your bookmarks bar">
            ⚡ Send to CRM
          </a>
          <button onClick={copySnippet}
            className="text-xs px-3 py-2 rounded-lg border border-[#1A2130] text-[#8899AA] hover:text-white">
            {copyHit ? <span className="inline-flex items-center gap-1 text-[#00E5C3]"><Check size={11} /> copied</span> : 'Copy snippet'}
          </button>
          <button onClick={() => setShowInstructions(v => !v)}
            className="text-xs text-[#A78BFA] hover:underline">
            {showInstructions ? 'Hide' : 'Show'} install steps
          </button>
        </div>

        {showInstructions && (
          <div className="mt-4 text-xs text-[#8899AA] leading-relaxed space-y-2">
            <p><strong className="text-white">Install (once):</strong></p>
            <ol className="list-decimal ml-5 space-y-1 text-[#8899AA]">
              <li>If your browser doesn't show a bookmarks bar, enable it with <kbd className="px-1 py-0.5 rounded bg-[#1A2130] font-mono text-[10px]">⌘+Shift+B</kbd> (Mac) / <kbd className="px-1 py-0.5 rounded bg-[#1A2130] font-mono text-[10px]">Ctrl+Shift+B</kbd> (Windows).</li>
              <li>Drag the teal <strong className="text-[#00E5C3]">⚡ Send to CRM</strong> button above onto the bookmarks bar.</li>
              <li>Or, right-click the bookmarks bar → Add Page → Name "Send to CRM" → paste the snippet (Copy snippet button above) into the URL field.</li>
            </ol>
            <p className="mt-3"><strong className="text-white">Use:</strong></p>
            <ol className="list-decimal ml-5 space-y-1 text-[#8899AA]">
              <li>Open a PitchPerfect contact — click into one of the messages so the "Contact Details" panel is visible on the right.</li>
              <li>Click the bookmarklet in your bar.</li>
              <li>A small "Send to CRM" overlay appears with the contact prefilled. Verify, hit Send.</li>
              <li>Lead lands in <strong className="text-[#10B981]">Interested</strong> on your Pipeline.</li>
            </ol>
            <p className="mt-3 text-[10px] text-[#5A6A7A]">
              Personal to your account (agent id is baked into the snippet). Don't share with other agents — they'd want their own from their Settings page.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PitchPrfct Automation panel — per-agent. Each agent connects their OWN
// PitchPrfct account: their API key is saved (privately, row-level secured) to
// the pitchprfct_keys table, and their keyword→workflow rules to their profile.
// The email Worker looks both up by the lead's owning agent. The workflow list
// is pulled live via the Worker proxy so the key never sits in the browser.
// ─────────────────────────────────────────────────────────────────────────────
function PitchPerfectPanel() {
  const { pitchprfctRules, savePitchprfctRules, user } = useApp()
  const uid = user?.id
  const [workflows, setWorkflows] = useState([])
  const [wfState, setWfState] = useState('idle')   // idle | loading | ok | error
  const [wfError, setWfError] = useState('')
  const [rules, setRules] = useState([])
  const [defaultWorkflowId, setDefaultWorkflowId] = useState('')
  const [delayMinutes, setDelayMinutes] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Per-agent API key (stored in pitchprfct_keys, never rendered back)
  const [keyState, setKeyState] = useState('loading')   // loading | set | unset
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [editingKey, setEditingKey] = useState(false)
  const [keySaving, setKeySaving] = useState(false)
  const [keyMsg, setKeyMsg] = useState(null)

  // Seed the editor from the saved rules. Keyed on a stable JSON string so it
  // re-seeds when the saved data actually changes (incl. profile load) but NOT
  // on every render — otherwise in-progress edits would get wiped.
  const rulesKey = JSON.stringify(pitchprfctRules || {})
  useEffect(() => {
    const r = Array.isArray(pitchprfctRules?.rules) ? pitchprfctRules.rules : []
    setRules(r.map((x, i) => ({
      id: x.id || `r${i}_${Date.now()}`,
      keyword: x.keyword || '',
      workflowId: x.workflowId || '',
    })))
    setDefaultWorkflowId(pitchprfctRules?.defaultWorkflowId || '')
    setDelayMinutes(Math.max(0, parseInt(pitchprfctRules?.delayMinutes, 10) || 0))
  }, [rulesKey])

  // Check whether this agent has an API key saved (just the boolean — the key
  // value is never kept in component state or rendered).
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    supabase.from('pitchprfct_keys').select('api_key').eq('user_id', uid).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setKeyState('unset')
          setKeyMsg({ type: 'error', text: 'Could not check key — has SUPABASE_PITCHPRFCT_SQL.sql been run in Supabase?' })
          return
        }
        setKeyState(data && data.api_key ? 'set' : 'unset')
      })
      .catch(() => { if (!cancelled) setKeyState('unset') })
    return () => { cancelled = true }
  }, [uid])

  const saveKey = async () => {
    const v = keyInput.trim()
    if (!v || !uid) return
    setKeySaving(true); setKeyMsg(null)
    const { error } = await supabase.from('pitchprfct_keys')
      .upsert({ user_id: uid, api_key: v, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setKeySaving(false)
    if (error) { setKeyMsg({ type: 'error', text: 'Save failed: ' + error.message }); return }
    setKeyInput(''); setShowKey(false); setEditingKey(false); setKeyState('set')
    setKeyMsg({ type: 'success', text: 'API key saved.' })
    setReloadKey(k => k + 1)
  }

  // Pull the agent's real PitchPrfct workflows through the Worker proxy — only
  // once a key is saved (the proxy looks the key up by agent_id).
  useEffect(() => {
    if (keyState !== 'set' || !uid) { setWfState('idle'); setWorkflows([]); return }
    let cancelled = false
    setWfState('loading'); setWfError('')
    fetch(`${WORKER_URL}/pp-workflows?agent_id=${encodeURIComponent(uid)}`)
      .then(async (resp) => {
        let data = null
        try { data = await resp.json() } catch { data = null }
        if (!resp.ok) throw new Error((data && data.error) || `HTTP ${resp.status}`)
        if (data == null) throw new Error('Worker returned no data — make sure the v4.7 worker is deployed.')
        // PitchPrfct shape: { status, message, data: { rows: [...], metadata } }.
        const container = (data && data.data) || data || {}
        const raw = Array.isArray(data) ? data
          : Array.isArray(container) ? container
          : (container.rows || container.workflows || container.items || container.results || [])
        const list = (Array.isArray(raw) ? raw : []).map(w => ({
          id: String(w.id ?? w.uuid ?? w.workflowId ?? ''),
          name: String(w.name ?? w.title ?? w.label ?? 'Untitled workflow'),
          status: String(w.status ?? '').toLowerCase(),
        })).filter(w => w.id)
        if (!cancelled) { setWorkflows(list); setWfState('ok') }
      })
      .catch((e) => { if (!cancelled) { setWfError(String(e.message || e)); setWfState('error') } })
    return () => { cancelled = true }
  }, [reloadKey, keyState, uid])

  const wfName = (id) => (workflows.find(w => w.id === id) || {}).name || ''
  const addRule = () => setRules(rs => [...rs, { id: `r${Date.now()}`, keyword: '', workflowId: '' }])
  const removeRule = (id) => setRules(rs => rs.filter(r => r.id !== id))
  const patchRule = (id, patch) => setRules(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))

  const save = async () => {
    setSaving(true); setMsg(null)
    const cleanRules = rules
      .filter(r => r.keyword.trim() && r.workflowId)
      .map(r => ({ id: r.id, keyword: r.keyword.trim(), workflowId: r.workflowId, workflowName: wfName(r.workflowId) }))
    const res = await savePitchprfctRules({
      rules: cleanRules,
      defaultWorkflowId,
      defaultWorkflowName: wfName(defaultWorkflowId),
      delayMinutes,
    })
    setSaving(false)
    if (res && res.ok) setMsg({ type: 'success', text: 'Saved — new leads enroll automatically.' })
    else setMsg({ type: 'error', text: 'Save failed: ' + ((res && res.error) || 'unknown error') })
  }

  const selectCls = 'min-w-0 flex-1 bg-[#080B0F] border border-[#1A2130] text-white text-sm rounded-lg px-2 py-2 focus:outline-none focus:border-[#00E5C340]'
  const workflowSelect = (value, onChange) => (
    <select value={value} onChange={e => onChange(e.target.value)}
      disabled={wfState !== 'ok'} className={selectCls}>
      <option value="">— none —</option>
      {workflows.map(w => (
        <option key={w.id} value={w.id}>
          {w.name}{w.status && w.status !== 'active' ? ` — ${w.status}` : ''}
        </option>
      ))}
      {value && !workflows.some(w => w.id === value) && <option value={value}>(saved workflow)</option>}
    </select>
  )

  return (
    <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
      <div className="mb-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] flex items-center gap-2">
          <Zap size={12} /> PitchPrfct Automation
        </h2>
        <p className="text-xs text-[#3A4A5A] mt-1">
          When a new lead lands it's pushed into PitchPrfct and enrolled in a workflow. The workflow is
          chosen by what the lead's marketplace comments contain — the top rule that matches wins.
        </p>
      </div>

      {/* Per-agent API key */}
      <div className="rounded-lg border border-[#1A2130] p-3 mb-3" style={{ background: '#080B0F' }}>
        <p className="text-sm text-white mb-0.5">Your PitchPrfct API key</p>
        <p className="text-xs text-[#5A6A7A] mb-2">
          Connect your own PitchPrfct account. Generate a key in PitchPrfct → Settings → API Keys (tick all
          scopes). It's stored privately — only you and the lead worker can read it.
        </p>
        {keyState === 'loading' && <p className="text-xs text-[#5A6A7A]">Checking…</p>}
        {keyState === 'set' && !editingKey && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle size={13} /> Connected</span>
            <button onClick={() => { setEditingKey(true); setKeyMsg(null) }}
              className="text-xs text-[#8899AA] hover:text-white underline">Replace key</button>
          </div>
        )}
        {(keyState === 'unset' || editingKey) && (
          <div className="flex items-center gap-2">
            <input type={showKey ? 'text' : 'password'} value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="Paste your PitchPrfct API key"
              className="flex-1 min-w-0 px-2 py-2 rounded-lg text-sm text-white bg-[#0D1117] border border-[#1A2130] focus:outline-none focus:border-[#00E5C340] font-mono" />
            <button onClick={() => setShowKey(s => !s)} className="p-2 text-[#5A6A7A] hover:text-white flex-shrink-0" title={showKey ? 'Hide' : 'Show'}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button onClick={saveKey} disabled={keySaving || !keyInput.trim()}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-black disabled:opacity-40 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              {keySaving ? 'Saving…' : 'Save key'}
            </button>
            {editingKey && keyState === 'set' && (
              <button onClick={() => { setEditingKey(false); setKeyInput('') }}
                className="text-xs text-[#5A6A7A] hover:text-white flex-shrink-0">Cancel</button>
            )}
          </div>
        )}
        {keyMsg && (
          <p className={`text-xs mt-2 ${keyMsg.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{keyMsg.text}</p>
        )}
      </div>

      {keyState !== 'set' && keyState !== 'loading' && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs border border-[#1A2130] text-[#5A6A7A]" style={{ background: '#080B0F' }}>
          Add your PitchPrfct API key above to load your workflows.
        </div>
      )}
      {keyState === 'set' && wfState === 'loading' && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs text-[#8899AA] border border-[#1A2130]" style={{ background: '#080B0F' }}>
          Loading your PitchPrfct workflows…
        </div>
      )}
      {keyState === 'set' && wfState === 'error' && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs border border-red-500/20 bg-red-500/10 text-red-400 flex items-center gap-2">
          <AlertTriangle size={13} className="flex-shrink-0" />
          <span className="flex-1">Couldn't load workflows: {wfError}</span>
          <button onClick={() => setReloadKey(k => k + 1)} className="underline hover:text-white flex-shrink-0">Retry</button>
        </div>
      )}
      {keyState === 'set' && wfState === 'ok' && workflows.length === 0 && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs border border-amber-500/20 bg-amber-500/10 text-amber-400">
          No workflows found in PitchPrfct. Create one there first, then hit Retry.
        </div>
      )}
      {keyState === 'set' && wfState === 'ok' && workflows.length > 0 && (
        <p className="text-[11px] text-[#5A6A7A] mb-3">
          Only <span className="text-[#8899AA]">active</span> workflows enroll leads — paused ones are labeled and PitchPrfct will reject them.
        </p>
      )}

      {/* Default / generic workflow */}
      <div className="rounded-lg border border-[#1A2130] p-3 mb-3" style={{ background: '#080B0F' }}>
        <p className="text-sm text-white mb-0.5">Default workflow</p>
        <p className="text-xs text-[#5A6A7A] mb-2">Every lead that doesn't match a keyword rule below goes here.</p>
        <div className="flex">{workflowSelect(defaultWorkflowId, setDefaultWorkflowId)}</div>
      </div>

      {/* Call-first delay */}
      <div className="rounded-lg border border-[#1A2130] p-3 mb-3" style={{ background: '#080B0F' }}>
        <p className="text-sm text-white mb-0.5">Call-first delay</p>
        <p className="text-xs text-[#5A6A7A] mb-2">
          Hold a new lead this many minutes before enrolling it — your window to call them first. You'll
          get a live countdown with a Cancel button on the lead card. Set 0 to enroll instantly.
        </p>
        <div className="flex items-center gap-2">
          <input type="number" min="0" max="120" value={delayMinutes}
            onChange={e => setDelayMinutes(Math.max(0, Math.min(120, parseInt(e.target.value, 10) || 0)))}
            className="w-20 px-2 py-2 rounded-lg text-sm text-white bg-[#0D1117] border border-[#1A2130] focus:outline-none focus:border-[#00E5C340]" />
          <span className="text-xs text-[#5A6A7A]">minutes {delayMinutes > 0 ? '' : '(instant)'}</span>
        </div>
      </div>

      {/* Keyword rules */}
      <p className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-2">Keyword rules</p>
      <div className="space-y-2 mb-3">
        {rules.length === 0 && (
          <div className="border border-dashed border-[#1A2130] rounded-lg py-4 text-center text-xs text-[#5A6A7A]">
            No rules yet — every lead uses the default workflow. Add a rule to route specific leads.
          </div>
        )}
        {rules.map(r => (
          <div key={r.id} className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[#5A6A7A] flex-shrink-0">Comments contain</span>
            <input value={r.keyword} onChange={e => patchRule(r.id, { keyword: e.target.value })}
              placeholder="e.g. ACN"
              className="w-32 px-2 py-2 rounded-lg text-sm text-white bg-[#080B0F] border border-[#1A2130] focus:outline-none focus:border-[#00E5C340]" />
            <span className="text-xs text-[#5A6A7A] flex-shrink-0">enroll in</span>
            {workflowSelect(r.workflowId, (v) => patchRule(r.id, { workflowId: v }))}
            <button onClick={() => removeRule(r.id)}
              className="p-1.5 rounded text-[#3A4A5A] hover:text-[#EF4444] hover:bg-[#EF444415] flex-shrink-0">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={addRule}
          className="px-3 py-2 rounded-lg text-xs font-medium border border-[#1A2130] text-[#8899AA] hover:text-white">
          <Plus size={12} className="inline -mt-0.5" /> Add rule
        </button>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 rounded-lg text-xs font-semibold text-black disabled:opacity-40 ml-auto"
          style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          {saving ? 'Saving…' : 'Save rules'}
        </button>
      </div>

      {msg && (
        <div className={`mt-3 px-3 py-2 rounded-lg flex items-center gap-2 text-xs ${
          msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.type === 'success' ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
          {msg.text}
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const { user, profile, leads, tags, addTag, updateTag, deleteTag, reorderTags, isRunner, isAdmin, splitNotes, setSplitNotes, pipelineCardFields, setPipelineCardFields } = useApp()
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

      {/* Integrations — bookmarklets / webhooks for external tools */}
      {!isRunner && <IntegrationsPanel />}

      {/* PitchPrfct Automation — campaign/comment → workflow enrollment rules */}
      {!isRunner && <PitchPerfectPanel />}

      {/* Calendar — Google Calendar shortcuts for reminders */}
      <CalendarPanel />

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

      {/* Pipeline card details — per-agent toggles for what shows on each card */}
      <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">Pipeline card details</h2>
        <p className="text-xs text-[#3A4A5A] mb-4">
          Pick which info shows on each lead card in the Pipeline. Helps keep cards compact OR pack in everything you need at a glance.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ['call', 'Call button'],
            ['phone', 'Phone number'],
            ['time_in_stage', 'Time-in-stage badge'],
            ['local_time', 'Local time (lead\'s timezone)'],
            ['state', 'State'],
            ['zip', 'ZIP code'],
            ['comments', 'Marketplace comments chip'],
            ['runner', 'Runner pill (who worked the lead)'],
            ['notes_preview', 'Notes preview (2 lines)'],
            ['campaign', 'Campaign chip'],
            ['email', 'Email address'],
            ['received_date', 'Received date'],
          ].map(([key, label]) => {
            const on = pipelineCardFields?.[key] !== false
            return (
              <label key={key} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#1A2130] cursor-pointer hover:border-[#2A3547]"
                style={{ background: '#080B0F' }}>
                <button type="button"
                  onClick={() => setPipelineCardFields({ [key]: !on })}
                  role="switch" aria-checked={on}
                  className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors"
                  style={{ background: on ? '#00E5C3' : '#1A2130', border: `1px solid ${on ? '#00E5C3' : '#2A3547'}` }}>
                  <span className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all"
                    style={{ left: on ? '18px' : '2px' }} />
                </button>
                <span className="text-sm text-white flex-1">{label}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* Side Tags — chip tags on lead cards, central rename/delete editor */}
      <SideTagsPanel />

      {/* Campaigns — pick-list for the campaign pill */}
      <CampaignsPanel />

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
