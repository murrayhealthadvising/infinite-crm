import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { Users, Mail, Shield, RefreshCw, Copy, Check, Edit2, Trash2 } from 'lucide-react'

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
    // When leaving the runner role, clear lead_agent_id so a subsequent
    // "make runner" always starts fresh.
    const patch = { role }
    if (role !== 'runner') patch.lead_agent_id = null
    await supabase.from('profiles').update(patch).eq('user_id', userId)
    loadAgents()
  }

  // Approve a pending sign-up. Flips the profile from 'pending' → 'agent'
  // so the user can access the CRM. Called from the Pending Approvals
  // section at the top of the admin list.
  const approvePending = async (userId) => {
    await supabase.from('profiles').update({ role: 'agent' }).eq('user_id', userId)
    setMsg({ type: 'success', text: 'Approved. They can now access the CRM.' })
    loadAgents()
    setTimeout(() => setMsg(null), 4000)
  }
  const rejectPending = async (agent) => {
    if (!confirm(`Reject sign-up from ${agent.email}? Their profile will be deleted (they can re-request).`)) return
    await supabase.from('profiles').delete().eq('user_id', agent.user_id)
    setMsg({ type: 'info', text: 'Rejected.' })
    loadAgents()
    setTimeout(() => setMsg(null), 4000)
  }

  // Make an agent a runner working under a specific lead-agent. Sets BOTH
  // role='runner' AND lead_agent_id in one write.
  const [runnerPickerFor, setRunnerPickerFor] = useState(null)  // agent being made-runner
  const makeRunner = async (runnerAgent, leadAgentUserId) => {
    if (!leadAgentUserId) return
    const { error } = await supabase.from('profiles')
      .update({ role: 'runner', lead_agent_id: leadAgentUserId })
      .eq('user_id', runnerAgent.user_id)
    if (error) {
      setMsg({ type: 'error', text: `Failed: ${error.message}` })
    } else {
      const leadAgent = agents.find(a => a.user_id === leadAgentUserId)
      setMsg({ type: 'success', text: `${runnerAgent.full_name || runnerAgent.email} is now a runner for ${leadAgent?.full_name || leadAgent?.email}.` })
      loadAgents()
    }
    setRunnerPickerFor(null)
    setTimeout(() => setMsg(null), 6000)
  }
  // Full account deletion — calls the admin_delete_user RPC. Nukes leads,
  // activities, reminders, tags, integrations, profile, and finally auth.users
  // so they can't sign back in. Requires TWO confirms because there's no undo.
  const deleteAccount = async (agent) => {
    if (!agent?.user_id) return
    const label = agent.full_name || agent.email
    // First confirm — reality check
    if (!confirm(
      `Delete ${label}'s account?\n\n` +
      `This will PERMANENTLY remove:\n` +
      `• Their profile\n` +
      `• All their leads, activities, and reminders\n` +
      `• Their pipeline stages\n` +
      `• Their PitchPrfct key, Gmail token, calendar tokens\n` +
      `• Their auth account (they can't sign back in)\n\n` +
      `There is no undo.`
    )) return
    // Second confirm — force typing the email to prevent mis-clicks
    const typed = prompt(`Type ${agent.email} to confirm deletion:`)
    if (!typed || typed.trim().toLowerCase() !== String(agent.email).toLowerCase()) {
      setMsg({ type: 'info', text: 'Deletion cancelled (email did not match).' })
      setTimeout(() => setMsg(null), 3500)
      return
    }
    const { data, error } = await supabase.rpc('admin_delete_user', { target_user_id: agent.user_id })
    if (error) {
      setMsg({ type: 'error', text: `Delete failed: ${error.message}` })
    } else {
      const counts = data?.counts || {}
      const summary = Object.entries(counts)
        .filter(([, n]) => Number(n) > 0)
        .map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`)
        .join(', ') || 'account only'
      setMsg({ type: 'success', text: `Deleted ${label} — cleaned up: ${summary}.` })
      loadAgents()
    }
    setTimeout(() => setMsg(null), 8000)
  }

  const changeLeadAgent = async (runnerAgent, newLeadAgentUserId) => {
    if (!newLeadAgentUserId) return
    const { error } = await supabase.from('profiles')
      .update({ lead_agent_id: newLeadAgentUserId })
      .eq('user_id', runnerAgent.user_id)
    if (error) {
      setMsg({ type: 'error', text: `Failed: ${error.message}` })
    } else {
      const leadAgent = agents.find(a => a.user_id === newLeadAgentUserId)
      setMsg({ type: 'success', text: `${runnerAgent.full_name || runnerAgent.email} now runs for ${leadAgent?.full_name || leadAgent?.email}.` })
      loadAgents()
    }
    setRunnerPickerFor(null)
    setTimeout(() => setMsg(null), 4000)
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

      {/* Pending approvals — accounts that signed up and haven't been let in
          yet. Shown above the main list, in orange, so admin can't miss them. */}
      {(() => {
        const pending = agents.filter(a => a.role === 'pending')
        if (pending.length === 0) return null
        return (
          <div className="rounded-xl border border-[#F59E0B40] overflow-hidden mb-4" style={{ background: '#F59E0B08' }}>
            <div className="px-6 py-4 border-b border-[#F59E0B30] flex items-center gap-2">
              <Shield size={14} className="text-[#F59E0B]" />
              <span className="text-sm font-semibold text-[#F59E0B]">
                {pending.length} pending sign-up{pending.length === 1 ? '' : 's'} waiting for you
              </span>
            </div>
            <div className="divide-y divide-[#F59E0B20]">
              {pending.map(a => (
                <div key={a.id} className="px-6 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-black flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #F59E0B, #EF4444)' }}>
                    {a.full_name?.[0]?.toUpperCase() || a.email?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{a.full_name || '—'}</p>
                    <p className="text-xs text-[#8899AA] truncate">{a.email}</p>
                  </div>
                  <button onClick={() => approvePending(a.user_id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-black"
                    style={{ background: 'linear-gradient(135deg, #10B981, #00E5C3)' }}>
                    ✓ Approve
                  </button>
                  <button onClick={() => rejectPending(a)}
                    className="px-3 py-1.5 rounded-lg text-xs border border-[#EF444440] text-[#EF4444] hover:bg-[#EF444415]">
                    Reject
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Agent list */}
      <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0D1117' }}>
        <div className="px-6 py-4 border-b border-[#1A2130] flex items-center gap-2">
          <Users size={14} className="text-[#8899AA]" />
          <span className="text-sm font-semibold text-white">{agents.filter(a => a.role !== 'pending').length} approved accounts</span>
        </div>
        {loading ? (
          <div className="p-6 text-center text-[#8899AA] text-sm">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="p-6 text-center text-[#8899AA] text-sm">No agents yet</div>
        ) : (
          <div className="divide-y divide-[#1A2130]">
            {agents.filter(a => a.role !== 'pending').map(agent => {
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
                    {/* Role actions — Make Admin / Make Runner / Demote */}
                    {agent.role !== 'admin' && agent.role !== 'runner' && (
                      <>
                        <button onClick={() => updateRole(agent.user_id, 'admin')}
                          className="text-xs text-[#8899AA] hover:text-[#00E5C3]">
                          Make Admin
                        </button>
                        <button onClick={() => setRunnerPickerFor(agent)}
                          className="text-xs text-[#8899AA] hover:text-[#A78BFA]">
                          Make Runner
                        </button>
                      </>
                    )}
                    {agent.role === 'runner' && (
                      <button onClick={() => updateRole(agent.user_id, 'agent')}
                        className="text-xs text-[#8899AA] hover:text-[#EF4444]">
                        Demote to agent
                      </button>
                    )}
                    {agent.role === 'admin' && agent.email !== 'murrayhealthadvising@gmail.com' && (
                      <button onClick={() => updateRole(agent.user_id, 'agent')}
                        className="text-xs text-[#8899AA] hover:text-[#EF4444]">
                        Demote
                      </button>
                    )}
                    {/* Delete account — hidden for self and bootstrap admin.
                        Two confirms (dialog + email retype) before it fires.
                        Wipes everything: profile, leads, activities, tokens. */}
                    {agent.email !== 'murrayhealthadvising@gmail.com'
                      && agent.user_id !== profile?.user_id && (
                      <button onClick={() => deleteAccount(agent)}
                        title="Delete this account and all their data"
                        className="p-1 rounded text-[#5A6A7A] hover:text-[#EF4444] hover:bg-[#EF444415] transition-colors">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  {/* Runner's lead-agent — shown for runner rows only */}
                  {agent.role === 'runner' && (
                    <div className="mt-3 flex items-center gap-2 flex-wrap" style={{ paddingLeft: '52px' }}>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">Running for</span>
                      {(() => {
                        const leadAgent = agents.find(a => a.user_id === agent.lead_agent_id)
                        return (
                          <code className={`text-xs font-mono ${leadAgent ? 'text-[#A78BFA]' : 'text-[#EF4444]'}`}>
                            {leadAgent?.full_name || leadAgent?.email || '(NOT SET — click Change)'}
                          </code>
                        )
                      })()}
                      <button onClick={() => setRunnerPickerFor(agent)}
                        className="text-xs text-[#5A6A7A] hover:text-white inline-flex items-center gap-1">
                        <Edit2 size={11} /> Change
                      </button>
                    </div>
                  )}

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

      {/* Runner picker modal — used both to convert an agent → runner and to
          change the lead-agent an existing runner works under. */}
      {runnerPickerFor && (() => {
        const target = runnerPickerFor
        // Candidate lead-agents: everyone except the target themselves, admins
        // (fine to run under), and NOT other pending / runner accounts.
        const candidates = agents.filter(a =>
          a.user_id !== target.user_id &&
          a.role !== 'pending' &&
          a.role !== 'runner'
        )
        const isConvert = target.role !== 'runner'
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setRunnerPickerFor(null)} />
            <div className="relative w-full max-w-md rounded-2xl border border-[#A78BFA40] overflow-hidden shadow-2xl" style={{ background: '#0E1318' }}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]" style={{ background: '#A78BFA10' }}>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {isConvert ? `Make ${target.full_name || target.email} a runner` : `Change ${target.full_name || target.email}'s lead-agent`}
                  </h3>
                  <p className="text-xs text-[#8899AA] mt-0.5">Pick whose leads they'll work.</p>
                </div>
                <button onClick={() => setRunnerPickerFor(null)} className="p-1.5 rounded text-[#5A6A7A] hover:text-white hover:bg-[#1A2130]">✕</button>
              </div>
              <div className="p-2 max-h-[60vh] overflow-y-auto">
                {candidates.length === 0 ? (
                  <p className="text-xs text-[#8899AA] p-4 text-center">No candidate lead-agents. Add another admin/agent first.</p>
                ) : candidates.map(c => (
                  <button key={c.user_id}
                    onClick={() => isConvert ? makeRunner(target, c.user_id) : changeLeadAgent(target, c.user_id)}
                    disabled={c.user_id === target.lead_agent_id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#1A2130] transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                      {c.full_name?.[0]?.toUpperCase() || c.email?.[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{c.full_name || '—'}</p>
                      <p className="text-xs text-[#5A6A7A] truncate">{c.email} · {c.role || 'agent'}</p>
                    </div>
                    {c.user_id === target.lead_agent_id && (
                      <span className="text-[10px] text-[#A78BFA]">current</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
