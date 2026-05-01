import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { Users, Mail, Shield, Trash2, RefreshCw, Copy } from 'lucide-react'

export default function Admin() {
  const { user, profile } = useApp()
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviting, setInviting] = useState(false)
  const [msg, setMsg] = useState(null)

  const loadAgents = async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    if (data) setAgents(data)
    setLoading(false)
  }

  useEffect(() => { loadAgents() }, [])

  const inviteAgent = async (e) => {
    e.preventDefault()
    if (!inviteEmail) return
    setInviting(true)
    setMsg(null)
    // Create user via Supabase admin (uses service role in prod - for now use signUp)
    const { data, error } = await supabase.auth.admin?.createUser({
      email: inviteEmail,
      email_confirm: true,
      user_metadata: { full_name: inviteName, role: 'agent' }
    }) || { error: { message: 'Admin API not available from browser' } }
    
    if (error) {
      // Fallback: just show the signup link
      setMsg({ type: 'info', text: `Send this link to ${inviteName || inviteEmail}: infinite-crm.vercel.app — they sign up with ${inviteEmail}` })
    } else {
      setMsg({ type: 'success', text: `Account created for ${inviteName || inviteEmail}` })
      loadAgents()
    }
    setInviteEmail('')
    setInviteName('')
    setInviting(false)
  }

  const updateRole = async (userId, role) => {
    await supabase.from('profiles').update({ role }).eq('user_id', userId)
    loadAgents()
  }

  const getLeadCount = async (userId) => {
    const { count } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('user_id', userId)
    return count || 0
  }

  if (profile?.role !== 'admin') {
    return (
      <div className="p-8 text-[#8899AA]">You need admin access to view this page.</div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          <Shield size={18} className="text-black" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Team Admin</h1>
          <p className="text-sm text-[#8899AA]">Manage agent accounts</p>
        </div>
        <button onClick={loadAgents} className="ml-auto text-[#8899AA] hover:text-white">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Invite */}
      <div className="rounded-xl border border-[#1A2130] p-6 mb-6" style={{ background: '#0D1117' }}>
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Mail size={14} /> Add Agent</h2>
        <form onSubmit={inviteAgent} className="flex gap-3">
          <input
            value={inviteName}
            onChange={e => setInviteName(e.target.value)}
            placeholder="Full name"
            className="flex-1 px-3 py-2 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3]"
          />
          <input
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="Email address"
            type="email"
            required
            className="flex-1 px-3 py-2 rounded-lg text-sm text-white border border-[#1A2130] bg-[#080B0F] outline-none focus:border-[#00E5C3]"
          />
          <button type="submit" disabled={inviting}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-black disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            {inviting ? '...' : 'Add'}
          </button>
        </form>
        {msg && (
          <div className={`mt-3 text-xs p-3 rounded-lg flex items-center gap-2 ${msg.type === 'success' ? 'bg-[#00E5C310] text-[#00E5C3] border border-[#00E5C330]' : 'bg-[#3B82F610] text-[#3B82F6] border border-[#3B82F630]'}`}>
            {msg.text}
            {msg.type === 'info' && (
              <button onClick={() => navigator.clipboard.writeText('https://infinite-crm.vercel.app')} className="ml-auto hover:opacity-70">
                <Copy size={12} />
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-[#3A4A5A] mt-3">
          💡 Tip: Send agents to <span className="text-[#00E5C3]">infinite-crm.vercel.app</span> to sign up themselves — or create accounts below via Supabase.
        </p>
      </div>

      {/* Agent list */}
      <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0D1117' }}>
        <div className="px-6 py-4 border-b border-[#1A2130] flex items-center gap-2">
          <Users size={14} className="text-[#8899AA]" />
          <span className="text-sm font-semibold text-white">{agents.length} accounts</span>
        </div>
        {loading ? (
          <div className="p-6 text-center text-[#8899AA] text-sm">Loading...</div>
        ) : agents.length === 0 ? (
          <div className="p-6 text-center text-[#8899AA] text-sm">No agents yet</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1A2130]">
                <th className="px-6 py-3 text-left text-xs text-[#8899AA] font-medium">Name</th>
                <th className="px-6 py-3 text-left text-xs text-[#8899AA] font-medium">Email</th>
                <th className="px-6 py-3 text-left text-xs text-[#8899AA] font-medium">Role</th>
                <th className="px-6 py-3 text-left text-xs text-[#8899AA] font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(agent => (
                <tr key={agent.id} className="border-b border-[#1A2130] last:border-0 hover:bg-[#0E1318]">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-black flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                        {agent.full_name?.[0]?.toUpperCase() || agent.email?.[0]?.toUpperCase()}
                      </div>
                      <span className="text-sm text-white">{agent.full_name || '—'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-[#8899AA]">{agent.email}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${agent.role === 'admin' ? 'bg-[#00E5C310] text-[#00E5C3]' : 'bg-[#1A2130] text-[#8899AA]'}`}>
                      {agent.role || 'agent'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {agent.role !== 'admin' ? (
                        <button onClick={() => updateRole(agent.user_id, 'admin')}
                          className="text-xs text-[#8899AA] hover:text-[#00E5C3] transition-colors">
                          Make Admin
                        </button>
                      ) : agent.email !== 'murrayhealthadvising@gmail.com' && (
                        <button onClick={() => updateRole(agent.user_id, 'agent')}
                          className="text-xs text-[#8899AA] hover:text-[#EF4444] transition-colors">
                          Remove Admin
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
