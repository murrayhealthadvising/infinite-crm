import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import {
  Key, CheckCircle, XCircle, Eye, EyeOff,
  Plus, Trash2, Check, X, GripVertical, AlertTriangle, Tags as TagsIcon,
} from 'lucide-react'

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

function TagRow({ tag, count, onUpdate, onDelete, isDefault }) {
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
    <div className="flex items-start gap-3 py-3 border-b border-[#1A2130] last:border-0">
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

export default function Settings() {
  const { user, profile, leads, tags, addTag, updateTag, deleteTag } = useApp()

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

      {/* Pipeline stages / tags */}
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
              isDefault={DEFAULT_TAG_IDS.has(t.id)} />
          ))}
          {sortedTags.length === 0 && (
            <p className="text-sm text-[#5A6A7A] py-6 text-center">No stages yet — add your first one above.</p>
          )}
        </div>

        <p className="text-[10px] text-[#3A4A5A] mt-4">
          Default stages can be re-labeled and re-colored but not deleted (the system uses their IDs to map Ringy/USHA tags). Custom stages can be deleted only when no leads are using them.
        </p>
      </div>

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
