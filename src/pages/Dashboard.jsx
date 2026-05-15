import { useState } from 'react'
import { useApp } from '../context/AppContext'
import StatusTag from '../components/StatusTag'
import { TrendingUp, Users, CheckCircle, Calendar, Clock, ArrowUpRight, Zap, Check, X, Rocket } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'

function safeRel(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  try { return formatDistanceToNow(dt, { addSuffix: true }) } catch { return '' }
}
function leadName(lead) {
  if (lead?.name) return lead.name
  return [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim() || '—'
}
function leadInitials(lead) {
  const n = leadName(lead)
  if (n === '—' || !n) return '?'
  const parts = n.trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || '?'
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding checklist — shown on Dashboard until each new agent finishes
// setup. Each step is auto-detected; the bookmarklet is the only one the
// agent has to manually confirm (no clean way to detect a browser bookmark).
// Hides automatically once everything's done; also has a one-time Dismiss.
// ─────────────────────────────────────────────────────────────────────────────
function OnboardingChecklist() {
  const { profile, leadEmail, commissionPresets, leads, reminders } = useApp()
  const navigate = useNavigate()
  const lsKey = (k) => 'infinite-crm:' + (profile?.user_id || 'anon') + ':' + k
  const [bookmarkInstalled, setBookmarkInstalled] = useState(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem(lsKey('bookmarklet-installed')) === '1'
  )
  const [dismissed, setDismissed] = useState(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem(lsKey('onboarding-dismissed')) === '1'
  )

  const hasLeadEmail = !!leadEmail
  const hasCommissionStructure = (() => {
    const c = commissionPresets
    if (Array.isArray(c)) return c.length > 0
    if (c && typeof c === 'object') return Array.isArray(c.products) && c.products.length > 0
    return false
  })()
  const safeLeads = Array.isArray(leads) ? leads : []
  const safeReminders = Array.isArray(reminders) ? reminders : []
  const hasFirstWork = safeLeads.length > 0 || safeReminders.length > 0

  const steps = [
    { id: 'account', label: 'Account created', done: true },
    {
      id: 'leadEmail',
      label: hasLeadEmail
        ? `Marketplace address: ${leadEmail}`
        : 'Get your marketplace forwarding address from Murray',
      done: hasLeadEmail,
      hint: 'Murray (admin) sets this up — ask him in chat once.',
      action: { label: 'Open Settings', go: () => navigate('/settings') },
    },
    {
      id: 'commission',
      label: 'Set up your commission structure (per-product % + advance months)',
      done: hasCommissionStructure,
      action: { label: 'Open Calculator', go: () => navigate('/calculator') },
    },
    {
      id: 'bookmarklet',
      label: 'Install the PitchPerfect bookmarklet',
      done: bookmarkInstalled,
      action: { label: 'Open Settings', go: () => navigate('/settings') },
      manualConfirm: () => {
        try { localStorage.setItem(lsKey('bookmarklet-installed'), '1') } catch {}
        setBookmarkInstalled(true)
      },
    },
    {
      id: 'firstWork',
      label: 'Work your first lead or set a reminder',
      done: hasFirstWork,
      action: { label: 'Open Today', go: () => navigate('/today') },
    },
  ]

  const doneCount = steps.filter(s => s.done).length
  const allDone = doneCount === steps.length

  if (dismissed) return null
  if (allDone) return null

  const dismiss = () => {
    try { localStorage.setItem(lsKey('onboarding-dismissed'), '1') } catch {}
    setDismissed(true)
  }

  return (
    <div className="rounded-xl border border-[#00E5C340] p-5 mb-6" style={{ background: '#00E5C308' }}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Rocket size={18} className="text-black" />
          </div>
          <div>
            <h2 className="text-base font-display font-bold text-white">Welcome to Infinite</h2>
            <p className="text-xs text-[#5A6A7A] mt-0.5">
              {doneCount} of {steps.length} steps complete — let's get you running so leads start flowing.
            </p>
          </div>
        </div>
        <button onClick={dismiss}
          className="text-xs text-[#5A6A7A] hover:text-white flex items-center gap-1 flex-shrink-0"
          title="Hide this checklist">
          <X size={12} /> Dismiss
        </button>
      </div>

      <div className="space-y-2">
        {steps.map(s => (
          <div key={s.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors"
            style={{
              background: s.done ? '#080B0F60' : '#080B0F',
              borderColor: s.done ? '#1A2130' : '#2A3547',
            }}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: s.done ? '#00E5C320' : 'transparent',
                border: '1px solid ' + (s.done ? '#00E5C3' : '#2A3547'),
              }}>
              {s.done && <Check size={11} className="text-[#00E5C3]" />}
            </div>

            <div className="flex-1 min-w-0">
              <p className={'text-sm ' + (s.done ? 'text-[#5A6A7A]' : 'text-white')}>
                {s.label}
              </p>
              {!s.done && s.hint && <p className="text-[10px] text-[#5A6A7A] mt-0.5">{s.hint}</p>}
            </div>

            {!s.done && s.action && (
              <button onClick={s.action.go}
                className="text-xs px-3 py-1.5 rounded-lg text-black font-semibold flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
                {s.action.label}
              </button>
            )}
            {!s.done && s.manualConfirm && (
              <button onClick={s.manualConfirm}
                className="text-[10px] text-[#5A6A7A] hover:text-white flex-shrink-0 px-2"
                title="I've already installed it">
                Mark done
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const StatCard = ({ label, value, sub, color, icon: Icon }) => (
  <div className="rounded-xl p-5 border border-[#1A2130] relative overflow-hidden group hover:border-[#2A3547] transition-colors" style={{ background: '#0E1318' }}>
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs text-[#5A6A7A] font-mono uppercase tracking-wider mb-2">{label}</p>
        <p className="text-3xl font-display font-bold text-white">{value}</p>
        {sub && <p className="text-xs text-[#5A6A7A] mt-1">{sub}</p>}
      </div>
      <div className="p-2 rounded-lg" style={{ background: color + '15' }}>
        <Icon size={18} style={{ color }} />
      </div>
    </div>
    <div className="absolute bottom-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
  </div>
)

export default function Dashboard() {
  const { leads, stats, user, tags } = useApp()
  const navigate = useNavigate()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const safeLeads = Array.isArray(leads) ? leads : []
  const safeTags = Array.isArray(tags) ? tags : []

  const recentLeads = [...safeLeads].sort((a, b) => {
    const ad = new Date(a.last_activity || a.created_at || 0).getTime() || 0
    const bd = new Date(b.last_activity || b.created_at || 0).getTime() || 0
    return bd - ad
  }).slice(0, 8)

  const stageBreakdown = safeTags.map(s => ({
    ...s,
    count: safeLeads.filter(l => l.stage === s.id || (l.status && (l.status.toLowerCase() === (s.label || '').toLowerCase()))).length
  })).filter(s => s.count > 0)

  return (
    <div className="p-6 max-w-7xl animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00E5C3] animate-pulse" />
          <span className="text-xs text-[#5A6A7A] font-mono uppercase tracking-widest">Live</span>
        </div>
        <h1 className="text-3xl font-display font-bold text-white">{greeting}, {user?.name?.split(' ')[0] || 'there'}.</h1>
        <p className="text-[#5A6A7A] mt-1">Here's what's happening with your pipeline today.</p>
      </div>

      {/* Onboarding checklist — auto-hides once finished */}
      <OnboardingChecklist />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Leads" value={stats.total} sub="All time" color="#00E5C3" icon={Users} />
        <StatCard label="Interested" value={stats.interested} sub="Hot pipeline" color="#10B981" icon={TrendingUp} />
        <StatCard label="Apts Scheduled" value={stats.apt} sub="Upcoming" color="#3B82F6" icon={Calendar} />
        <StatCard label="Sold" value={stats.sold} sub="All time" color="#00E5C3" icon={CheckCircle} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2 rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A2130]">
            <h2 className="font-display font-semibold text-white">Recent Leads</h2>
            <button onClick={() => navigate('/leads')} className="text-xs text-[#00E5C3] hover:opacity-80 flex items-center gap-1 transition-opacity">
              View all <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="divide-y divide-[#1A2130]">
            {recentLeads.map(lead => (
              <div key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-[#0A0E14] cursor-pointer transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-black flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #00E5C340, #3B82F640)', color: '#00E5C3' }}>
                    {leadInitials(lead)}
                  </div>
                  <div>
                    <p className="text-sm text-white font-medium group-hover:text-[#00E5C3] transition-colors">
                      {leadName(lead)}
                    </p>
                    <p className="text-xs text-[#5A6A7A]">{[lead.state, lead.source].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusTag stage={lead.stage} status={lead.status} />
                  <span className="text-xs text-[#3A4A5A]">{safeRel(lead.last_activity || lead.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline Breakdown */}
        <div className="rounded-xl border border-[#1A2130] overflow-hidden" style={{ background: '#0E1318' }}>
          <div className="px-5 py-4 border-b border-[#1A2130]">
            <h2 className="font-display font-semibold text-white">Pipeline</h2>
          </div>
          <div className="p-5 space-y-3">
            {stageBreakdown.map(s => (
              <div key={s.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-sm text-[#8899AA]">{s.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-1.5 rounded-full" style={{ width: `${Math.max(20, (s.count / Math.max(safeLeads.length, 1)) * 120)}px`, background: s.color + '40' }}>
                    <div className="h-full rounded-full" style={{ width: `${(s.count / Math.max(safeLeads.length, 1)) * 100}%`, background: s.color }} />
                  </div>
                  <span className="text-sm font-mono text-white w-6 text-right">{s.count}</span>
                </div>
              </div>
            ))}
            {stageBreakdown.length === 0 && <p className="text-[#5A6A7A] text-sm">No leads yet</p>}
          </div>

          {/* AI Insight */}
          <div className="mx-4 mb-4 p-3 rounded-lg border border-[#00E5C320]" style={{ background: '#00E5C308' }}>
            <div className="flex items-center gap-2 mb-2">
              <Zap size={12} className="text-[#00E5C3]" />
              <span className="text-xs font-mono text-[#00E5C3] uppercase tracking-wider">AI Insight</span>
            </div>
            <p className="text-xs text-[#8899AA] leading-relaxed">
              {stats.ghosted > 0 ? `${stats.ghosted} ghosted leads could be re-engaged. Try a follow-up text sequence.` : `${stats.interested} leads in your pipeline need follow-up. Prioritize APT leads today.`}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
