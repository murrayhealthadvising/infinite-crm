import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { Key, User, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react'

export default function Settings() {
  const { user, profile } = useApp()
  const navigate = useNavigate()

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  // Handle password reset redirect from magic link/recovery email
  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('type=recovery')) {
      setMsg({ type: 'info', text: 'Enter your new password below.' })
    }
  }, [])

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    if (!newPassword) return
    if (newPassword !== confirmPassword) {
      setMsg({ type: 'error', text: 'Passwords do not match.' })
      return
    }
    if (newPassword.length < 6) {
      setMsg({ type: 'error', text: 'Password must be at least 6 characters.' })
      return
    }
    setSaving(true)
    setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setMsg({ type: 'error', text: error.message })
    } else {
      setMsg({ type: 'success', text: 'Password updated! You can now log in with your new password.' })
      setNewPassword('')
      setConfirmPassword('')
    }
    setSaving(false)
  }

  const initials = (user?.email || '?')[0].toUpperCase()
  const emailDisplay = user?.email || ''
  const nameDisplay = profile?.full_name || emailDisplay.split('@')[0] || 'Agent'

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>

      {/* Profile card */}
      <div className="rounded-xl border border-[#1A2130] p-5 mb-4" style={{ background: '#0D1117' }}>
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-4">Profile</h2>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-black flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3BB2F6)' }}>
            {initials}
          </div>
          <div>
            <p className="text-white font-semibold">{nameDisplay}</p>
            <p className="text-[#5A6A7A] text-sm">{emailDisplay}</p>
            <p className="text-[#5A6A7A] text-sm capitalize">{profile?.role || 'Agent'}</p>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0D1117' }}>
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-4 flex items-center gap-2">
          <Key size={12} /> Change Password
        </h2>

        {msg && (
          <div className={`mb-4 px-4 py-3 rounded-lg flex items-center gap-2 text-sm ${
            msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : msg.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20'
            : 'bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/20'
          }`}>
            {msg.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {msg.text}
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
            disabled={saving || !newPassword}
            className="w-full py-2 rounded-lg text-sm font-medium text-black transition-all"
            style={{ background: saving || !newPassword ? '#446677' : 'linear-gradient(135deg, #00D4FF, #0099CC)' }}>
            {saving ? 'Saving...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  )
}