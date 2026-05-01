import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Shield, Users, GitBranch, Calendar, Clock,
  CheckSquare, Mail, Calculator, TrendingUp, Settings, ChevronLeft,
  ChevronRight, Menu
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import clsx from 'clsx'

const NAV = [
  { to: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/leads',        icon: Users,            label: 'Leads' },
  { to: '/pipeline',     icon: GitBranch,        label: 'Pipeline' },
  { to: '/appointments', icon: Calendar,         label: 'Appointments' },
  { to: '/follow-ups',   icon: Clock,            label: 'Follow-Ups' },
  { to: '/tasks',        icon: CheckSquare,      label: 'Tasks' },
  { to: '/gmail',        icon: Mail,             label: 'Gmail Leads' },
  null, // divider
  { to: '/calculator',   icon: Calculator,       label: 'Calculator' },
  { to: '/roi',          icon: TrendingUp,       label: 'Lead ROI' },
  null,
  { to: '/settings',     icon: Settings,         label: 'Settings' },
]

export default function Sidebar() {
  const { sidebarOpen, setSidebarOpen, stats, user, profile } = useApp()

  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        className={`flex-shrink-0 h-full flex flex-col transition-all duration-300 border-r border-[#1A2130] ${sidebarOpen ? 'w-56' : 'w-16'} max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-30 ${sidebarOpen ? '' : 'max-lg:hidden'}`}
        style={{ background: '#0A0E14' }}
      >
        <div className={`flex items-center h-16 px-4 border-b border-[#1A2130] ${sidebarOpen ? 'justify-between' : 'justify-center'}`}>
          {sidebarOpen && <div className="flex items-center gap-2"><div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{background:'linear-gradient(135deg,#00D4FF,#0099CC)'}}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 10 C3 7.5 5 6 7 6 C9 6 10 8 10 10 C10 12 11 14 13 14 C15 14 17 12.5 17 10" stroke="black" strokeWidth="1.8" strokeLinecap="round"/></svg></div><span className="font-bold text-white text-base">Infinite</span></div>}
          {!sidebarOpen && <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{background:'linear-gradient(135deg,#00D4FF,#0099CC)'}}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 10 C3 7.5 5 6 7 6 C9 6 10 8 10 10 C10 12 11 14 13 14 C15 14 17 12.5 17 10" stroke="black" strokeWidth="1.8" strokeLinecap="round"/></svg></div>}
          {sidebarOpen && <button onClick={() => setSidebarOpen(false)} className="p-1 rounded text-[#8899AA] hover:text-white"><ChevronLeft size={16} /></button>}
        </div>
        {!sidebarOpen && <button onClick={() => setSidebarOpen(true)} className="mx-auto mt-3 p-1.5 rounded text-[#8899AA] hover:text-white"><ChevronRight size={16} /></button>}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV.map((item, i) => {
            if (item === null) return <div key={i} className="my-2 border-t border-[#1A2130]" />
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to}
                className={({isActive}) => `flex items-center gap-3 px-2 py-2 rounded-lg transition-all duration-150 ${sidebarOpen ? 'w-full' : 'w-10 justify-center'} ${isActive ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'text-[#8899AA] hover:bg-[#1A2130] hover:text-white'}`}
                title={!sidebarOpen ? item.label : undefined}>
                <Icon size={17} className="flex-shrink-0" />
                {sidebarOpen && <span className="text-sm font-medium truncate">{item.label}</span>}
              </NavLink>
            )
          })}
          {(profile?.role === 'admin' || user?.email === 'murrayhealthadvising@gmail.com') && (
            <>
              <div className="my-2 border-t border-[#1A2130]" />
              <NavLink to="/admin"
                className={({isActive}) => `flex items-center gap-3 px-2 py-2 rounded-lg transition-all duration-150 ${sidebarOpen ? 'w-full' : 'w-10 justify-center'} ${isActive ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'text-[#8899AA] hover:bg-[#1A2130] hover:text-white'}`}
                title={!sidebarOpen ? 'Admin' : undefined}>
                <Shield size={17} className="flex-shrink-0" />
                {sidebarOpen && <span className="text-sm font-medium">Admin</span>}
              </NavLink>
            </>
          )}
        </nav>
        {sidebarOpen ? (
          <div className="border-t border-[#1A2130] p-3 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black flex-shrink-0" style={{background:'linear-gradient(135deg,#00D4FF,#0099CC)'}}>{user?.email?.[0]?.toUpperCase() ?? 'U'}</div>
            <div className="flex-1 min-w-0"><div className="text-xs text-white font-medium truncate">{user?.email?.split('@')[0] ?? 'Agent'}</div><div className="text-[10px] text-[#8899AA] capitalize">{profile?.role ?? 'Agent'}</div></div>
          </div>
        ) : (
          <div className="border-t border-[#1A2130] p-2 flex justify-center">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black" style={{background:'linear-gradient(135deg,#00D4FF,#0099CC)'}}>{user?.email?.[0]?.toUpperCase() ?? 'U'}</div>
          </div>
        )}
      </aside>
      {!sidebarOpen && <button className="fixed top-4 left-4 z-30 p-1.5 rounded-lg bg-[#0A0E14] border border-[#1A2130] text-[#8899AA] hover:text-white lg:hidden" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button>}
    </>
  )
}
