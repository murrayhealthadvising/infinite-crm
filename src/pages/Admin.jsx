import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { Users, Mail, Shield, RefreshCw, Copy, Check, Edit2 } from 'lucide-react'

// Derive a routing local-part from a first name OR an email. Lowercase, strips
// punctuation, kept short. "Doug" → "doug" · "Murray Health" → "murray".
function deriveLocal(input) {
  if (!input) return ''
  const first = String(input).trim().split(/\s+/)[0] || ''
  return first.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)
}

export default function Admin() {
  const { user, profile } = useApp()
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [editingAgentId, setEditingAgentId] = useState(null)
  const [firstNameDraft, setFirstNameDraft] = useState('')
  const [copyHit, setCopyHit] = useState('')

  const loadAgents = async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    if (data) setAgents(data)
    setLoading(false)
  }

  useEffect(() => { loadAgents() }, [])

  const updateRole = async (userId, role) => {
    await supabase.from('profiles').update({ role }).eq('user_id', userId)
    loadAgents()
  }

  const startEditing = (agent) => {
    setEditingAgentId(agent.id)
    // Default to first name from profile, OR email local-part
    const firstFromName = (agent.full_name || '').split(/\s+/)[0]
    const firstFromEmail = (agent.email || '').split('@')[0]
    setFirstNameDraft(deriveLocal(firstFromName || firstFromEmail))
  }
  const cancelEditing = () => { setEditingAgentId(null); setFirstNameDraft('') }

  const saveLeadEmail = async (agent) => {
    const local = deriveLocal(firstNameDraft)
    if (!local) return
    const leadEmail = `${local}-leads@infinite-crm.net`
    const { error } = await supabase.from('profiles').update({ lead_email: leadEmail }).eq('user_id', agent.user_id)
    if (error) {
      setMsg({ type: 'error', text: `Failed: ${error.message}` })
    } else {
      setMsg({ type: 'success', text: `Set ${agent.full_name || agent.email} → ${leadEmail}. Now add the Cloudflare route + worker entry.` })
      loadAgents()
    }
    setEditingAgentId(null)
    setFirstNameDraft('')
    setTimeout(() => setMsg(null), 8000)
  }

  const clearLeadEmail = async (agent) => {
    if (!confirm(`Remove forwarding address for ${agent.full_name || agent.email}?`)) return
    await supabase.from('profiles').update({ lead_email: null }).eq('user_id', agent.user_id)
    loadAgents()
  }

  const copy = (text, key) => {
    try { navigator.clipboard.writeText(text) } catch {}
    setCopyHit(key); setTimeout(() => setCopyHit(''), 1500)
  }

  if (profile?.role !== 'admin') {
    return <div className="p-8 text-[#8899AA]">You need admin access to view this page.</div>
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
          <Shield size={18} className="text-black" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Team Admin</h1>
          <p className="text-sm text-[#8899AA]">Manage agent accounts + marketplace forwarding addresses</p>
        </div>
        <button onClick={loadAgents} className="ml-auto text-[#8899AA] hover:text-white" title="Reload list">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* New-agent workflow hint */}
      <div className="rounded-xl border border-[#1A2130] p-5 mb-6" style={{ background: '#0D1117' }}>
        <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><Mail size={14} /> Onboarding a new agent</h2>
        <ol className="text-xs text-[#8899AA] space-y-1 list-decimal ml-5">
          <li>Send them <span className="text-[#00E5C3] font-mono">infinite-crm.vercel.app</span>. They sign up with their own email + password.</li>
          <li>Their row appears below. Click <strong className="text-white">Set address</strong>, confirm the first name → forwarding email saves to their profile.</li>
          <li>Copy the suggested Cloudflare route + worker AGENT_ROUTING entry shown after saving, apply both.</li>
          <li>Have them open Settings → Integrations to see their address + install the bookmarklet.</li>
        </ol>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
          msg.type === 'success' ? 'bg-[#00E5C310] text-[#00E5C3] border border-[#00E5C330]'
            : msg.type === 'error' ? 'bg-[#EF444410] text-[#EF4444] border border-[#EF444430]'
            : 'bg-[#3B82F610] text-[#3B82F6] border border-[#3B82F630]'
        }`}>{msg.text}</div>
      )}

      {/* Agent list */}
      <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0D1117' }}>
        <div className="px-6 py-4 border-b border-[#1A2130] flex items-center gap-2">
          <Users size={14} className="text-[#8899AA]" />
          <span className="text-sm font-semibold text-white">{agents.length} accounts</span>
        </div>
        {loading ? (
          <div className="p-6 text-center text-[#8899AA] text-sm">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="p-6 text-center text-[#8899AA] text-sm">No agents yet</div>
        ) : (
          <div className="divide-y divide-[#1A2130]">
            {agents.map(agent => {
              const isEditing = editingAgentId === agent.id
              const previewLocal = deriveLocal(firstNameDraft || (agent.full_name || agent.email || '').split('@')[0])
              const previewAddr = previewLocal ? `${previewLocal}-leads@infinite-crm.net` : ''
              return (
                <div key={agent.id} className="px-6 py-4">
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-black flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                      {agent.full_name?.[0]?.toUpperCase() || agent.email?.[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{agent.full_name || '—'}</p>
                      <p className="text-xs text-[#5A6A7A] truncate">{agent.email}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${agent.role === 'admin' ? 'bg-[#00E5C310] text-[#00E5C3]' : agent.role === 'runner' ? 'bg-[#A78BFA15] text-[#A78BFA]' : 'bg-[#1A2130] text-[#8899AA]'}`}>
                      {agent.role || 'agent'}
                    </span>
                    {agent.role !== 'admin' && agent.role !== 'runner' && (
                      <button onClick={() => updateRole(agent.user_id, 'admin')}
                        className="text-xs text-[#8899AA] hover:text-[#00E5C3]">
                        Make Admin
                      </button>
                    )}
                    {agent.role === 'admin' && agent.email !== 'murrayhealthadvising@gmail.com' && (
                      <button onClick={() => updateRole(agent.user_id, 'agent')}
                        className="text-xs text-[#8899AA] hover:text-[#EF4444]">
                        Demote
                      </button>
                    )}
                  </div>

                  {/* Lead email row */}
                  {agent.role !== 'runner' && (
                    <div className="mt-3 ml-13 pl-13 flex items-center gap-2 flex-wrap" style={{ paddingLeft: '52px' }}>
                      {isEditing ? (
                        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                          <input value={firstNameDraft}
                            onChange={e => setFirstNameDraft(e.target.value)}
                            autoFocus
                            placeholder="first name (e.g. doug)"
                            className="bg-[#080B0F] border border-[#00E5C340] rounded-lg px-2 py-1 text-xs text-white focus:outline-none w-40 font-mono" />
                          <code className="text-xs text-[#5A6A7A] font-mono">{previewAddr || '— enter a first name'}</code>
                          <button onClick={() => saveLeadEmail(agent)} disabled={!previewLocal}
                            className="px-2.5 py-1 rounded text-xs font-semibold text-black disabled:opacity-40"
                            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                            Save
                          </button>
                          <button onClick={cancelEditing} className="px-2 py-1 rounded text-xs text-[#5A6A7A] hover:text-white">
                            Cancel
                          </button>
                        </div>
                      ) : agent.lead_email ? (
                        <>
                          <span className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">Lead email</span>
                          <code className="text-xs text-[#00E5C3] font-mono">{agent.lead_email}</code>
                          <button onClick={() => copy(agent.lead_email, agent.id)}
                            className="text-[#5A6A7A] hover:text-white p-1" title="Copy">
                            {copyHit === agent.id ? <Check size={11} className="text-[#00E5C3]" /> : <Copy size={11} />}
                          </button>
                          <button onClick={() => startEditing(agent)}
                            className="text-xs text-[#5A6A7A] hover:text-white inline-flex items-center gap-1">
                            <Edit2 size={10} /> Change
                          </button>
                          <button onClick={() => clearLeadEmail(agent)}
                            className="text-xs text-[#5A6A7A] hover:text-[#EF4444]">
                            Unset
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">No marketplace address</span>
                          <button onClick={() => startEditing(agent)}
                            className="text-xs px-2.5 py-1 rounded border border-[#00E5C340] text-[#00E5C3] hover:bg-[#00E5C310]">
                            Set address
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* After-save snippet: Cloudflare instructions + worker line */}
                  {agent.lead_email && (
                    <details className="mt-2 ml-13 pl-13" style={{ paddingLeft: '52px' }}>
                      <summary className="text-[10px] text-[#3A4A5A] cursor-pointer hover:text-[#5A6A7A] uppercase tracking-wider font-mono">
                        Show wiring steps
                      </summary>
                      <div className="mt-2 space-y-2 text-xs">
                        <div className="rounded-lg border border-[#1A2130] p-3" style={{ background: '#080B0F' }}>
                          <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">1. Cloudflare route</p>
                          <p className="text-[11px] text-[#8899AA]">
                            Email → Email Routing → Routing rules → <strong>Create address</strong>:<br />
                            Custom address: <code className="text-[#00E5C3]">{agent.lead_email.split('@')[0]}</code><br />
                            Action: Send to Worker → <code className="text-[#00E5C3]">infinite-crm-webhook</code>
                          </p>
                        </div>
                        <div className="rounded-lg border border-[#1A2130] p-3" style={{ background: '#080B0F' }}>
                          <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">2. Worker AGENT_ROUTING entry</p>
                          <code className="text-[10px] text-[#8899AA] font-mono block whitespace-pre overflow-x-auto">{`'${agent.lead_email}':${' '.repeat(Math.max(1, 36 - agent.lead_email.length))}'${agent.user_id}',`}</code>
                          <button onClick={() => copy(`  '${agent.lead_email}': '${agent.user_id}',`, agent.id + '-line')}
                            className="mt-1 text-[10px] text-[#00E5C3] hover:underline inline-flex items-center gap-1">
                            {copyHit === agent.id + '-line' ? <Check size={9} /> : <Copy size={9} />}
                            {copyHit === agent.id + '-line' ? 'Copied' : 'Copy line'}
                          </button>
                          <p className="text-[10px] text-[#5A6A7A] mt-1">Paste into <code>cloudflare-worker/worker-v4.js</code> AGENT_ROUTING, then redeploy with <code>npx wrangler deploy</code>.</p>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
