import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Shield, Users, GitBranch, Calendar, Clock, CheckSquare, Calculator, TrendingUp, Settings, ChevronLeft, Zap, Mail } from 'lucide-react'
import { useApp } from '../context/AppContext'
import clsx from 'clsx'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/leads',     icon: Users,           label: 'Leads' },
  { to: '/pipeline',  icon: GitBranch,       label: 'Pipeline' },
  { to: '/appointments', icon: Calendar,     label: 'Appointments' },
  { to: '/follow-ups',   icon: Clock,        label: 'Follow-Ups' },
  { to: '/tasks',        icon: CheckSquare,  label: 'Tasks' },
  { to: '/gmail',        icon: Mail,         label: 'Gmail Leads' },
  null, // divider
  { to: '/calculator',  icon: Calculator,   label: 'Calculator' },
  { to: '/roi',         icon: TrendingUp,   label: 'Lead ROI' },
  null,
  { to: '/settings',    icon: Settings,     label: 'Settings' },
]

export default function Sidebar() {
  const { sidebarOpen, setSidebarOpen, stats, user } = useApp()

  return (
    <aside className={clsx(
      'flex-shrink-0 h-full z-30 flex flex-col transition-all duration-300 ease-in-out',
      'border-r border-[#1A2130]',
      sidebarOpen ? 'w-56' : 'w-16',
    )} style={{ background: '#0A0E14' }}>
      {/* Logo */}
      <div className={clsx('flex items-center h-16 px-4 border-b border-[#1A2130]', sidebarOpen ? 'justify-between' : 'justify-center')}>
        {sidebarOpen && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 10 C3 7.5 5 6 7 6 C9 6 10 8 10 10 C10 12 11 14 13 14 C15 14 17 12.5 17 10 C17 7.5 15 6 13 6 C11 6 10 8 10 10 C10 12 9 14 7 14 C5 14 3 12.5 3 10 Z" 
                  stroke="black" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="font-display font-700 text-white tracking-tight text-lg" style={{ fontWeight: 700 }}>Infinite</span>
          </div>
        )}
        {!sidebarOpen && (
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 10 C3 7.5 5 6 7 6 C9 6 10 8 10 10 C10 12 11 14 13 14 C15 14 17 12.5 17 10 C17 7.5 15 6 13 6 C11 6 10 8 10 10 C10 12 9 14 7 14 C5 14 3 12.5 3 10 Z" 
                stroke="black" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
        )}
        {sidebarOpen && (
          <button onClick={() => setSidebarOpen(false)} className="p-1 rounded text-[#4A5568] hover:text-white transition-colors">
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {NAV.map((item, i) => {
          if (!item) return <div key={i} className="my-3 mx-4 border-t border-[#1A2130]" />
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group',
                isActive
                  ? 'text-white'
                  : 'text-[#5A6A7A] hover:text-[#B0C0D0] hover:bg-[#0E1318]',
                !sidebarOpen && 'justify-center px-0'
              )}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, #00E5C315, #3B82F615)', borderLeft: '2px solid #00E5C3', paddingLeft: sidebarOpen ? '10px' : '0' } : {}}
            >
              <item.icon size={17} className="flex-shrink-0" />
              {sidebarOpen && <span className="font-body">{item.label}</span>}
            </NavLink>
          )
        })}
      </nav>

      {/* User footer */}
      {sidebarOpen && (
        <div className="p-4 border-t border-[#1A2130]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-black text-xs font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              {user?.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm text-white font-medium truncate">{user?.name}</p>
              <p className="text-xs text-[#4A5568] truncate">Admin</p>
            </div>
          </div>
        </div>
      )}

      {/* Collapsed expand button */}
      {!sidebarOpen && (
        <button onClick={() => setSidebarOpen(true)} className="p-4 border-t border-[#1A2130] flex justify-center text-[#4A5568] hover:text-white transition-colors">
          <ChevronLeft size={16} className="rotate-180" />
        </button>
      )}
    </aside>
  )
}
