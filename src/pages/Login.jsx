import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('login') // login | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name, role: 'agent' } }
      })
      if (error) setError(error.message)
      else setSuccess('Account created! Check your email to confirm, or log in now.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#080B0F' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none">
              <path d="M3 10 C3 7.5 5 6 7 6 C9 6 10 8 10 10 C10 12 11 14 13 14 C15 14 17 12.5 17 10 C17 7.5 15 6 13 6 C11 6 10 8 10 10 C10 12 9 14 7 14 C5 14 3 12.5 3 10 Z"
                stroke="black" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">Infinite</span>
        </div>

        <div className="rounded-2xl border border-[#1A2130] p-8" style={{ background: '#0D1117' }}>
          <h2 className="text-xl font-semibold text-white mb-1">
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-sm text-[#8899AA] mb-6">
            {mode === 'login' ? 'Sign in to your CRM' : 'Join Murray Health Advising CRM'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs text-[#8899AA] mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3] transition-colors placeholder-[#3A4A5A]"
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-[#8899AA] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3] transition-colors placeholder-[#3A4A5A]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#8899AA] mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3] transition-colors placeholder-[#3A4A5A]"
              />
            </div>

            {error && (
              <div className="text-xs text-[#EF4444] bg-[#EF444410] border border-[#EF444430] rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            {success && (
              <div className="text-xs text-[#00E5C3] bg-[#00E5C310] border border-[#00E5C330] rounded-lg px-3 py-2">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-black transition-opacity disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}
            >
              {loading ? '...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-5 text-center text-xs text-[#8899AA]">
            {mode === 'login' ? (
              <>Don't have an account? <button onClick={() => { setMode('signup'); setError('') }} className="text-[#00E5C3] hover:underline">Sign up</button></>
            ) : (
              <>Already have an account? <button onClick={() => { setMode('login'); setError('') }} className="text-[#00E5C3] hover:underline">Sign in</button></>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-[#3A4A5A] mt-6">Murray Health Advising · USHEALTH Advisors</p>
      </div>
    </div>
  )
}
