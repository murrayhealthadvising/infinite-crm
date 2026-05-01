import { useApp } from '../context/AppContext'
import StatusTag from '../components/StatusTag'
import { TrendingUp, Users, CheckCircle, Calendar, Clock, ArrowUpRight, Zap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'

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

  const recentLeads = [...leads].sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity)).slice(0, 8)

  const stageBreakdown = tags.map(s => ({
    ...s,
    count: leads.filter(l => l.stage === s.id).length
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
                    {lead.first_name[0]}{lead.last_name[0]}
                  </div>
                  <div>
                    <p className="text-sm text-white font-medium group-hover:text-[#00E5C3] transition-colors">
                      {lead.first_name} {lead.last_name}
                    </p>
                    <p className="text-xs text-[#5A6A7A]">{lead.state} · {lead.source}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusTag stage={lead.stage} />
                  <span className="text-xs text-[#3A4A5A]">{formatDistanceToNow(new Date(lead.last_activity), { addSuffix: true })}</span>
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
                  <div className="h-1.5 rounded-full" style={{ width: `${Math.max(20, (s.count / leads.length) * 120)}px`, background: s.color + '40' }}>
                    <div className="h-full rounded-full" style={{ width: `${(s.count / leads.length) * 100}%`, background: s.color }} />
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
