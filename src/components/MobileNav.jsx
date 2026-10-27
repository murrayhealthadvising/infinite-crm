import { NavLink } from 'react-router-dom'
import { Users, GitBranch, Sun, Thermometer, Settings } from 'lucide-react'
import { useApp } from '../context/AppContext'

// Mobile bottom nav bar — shown only below the lg breakpoint (which is where
// the desktop sidebar is hidden). Five fixed slots, thumb-reachable, bigger
// than the sidebar icons so they're easier to hit on an iPhone. The icon list
// mirrors the mobile-essential surfaces: Leads / Pipeline / Today / Warm /
// Settings. Dashboard / Calculator / Gmail Leads intentionally live only in
// the desktop sidebar — they're reference / power-user surfaces, not what
// an agent needs while actively calling on their phone.
//
// Fixed to the bottom of the viewport with safe-area padding so it clears
// the home indicator on notched iPhones. Height matches macOS/iOS native
// tab bars (~56px + safe area) and is accounted for in Layout via pb-14 on
// the main scroll region.
const ITEMS = [
  { to: '/leads',       icon: Users,       label: 'Leads' },
  { to: '/pipeline',    icon: GitBranch,   label: 'Pipeline' },
  { to: '/today',       icon: Sun,         label: 'Today' },
  { to: '/warm-bucket', icon: Thermometer, label: 'Warm' },
  { to: '/settings',    icon: Settings,    label: 'Settings' },
]

export default function MobileNav() {
  const { isRunner } = useApp()
  // Runners get the same set — none of these are gated. Keeps the muscle
  // memory identical for solo agents and runners on the phone.
  const items = ITEMS
  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch justify-around border-t"
      style={{
        background: '#0D1117',
        borderTopColor: '#1A2130',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      aria-label="Primary navigation">
      {items.map(item => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 px-1 transition-colors ${
                isActive ? 'text-[#00E5C3]' : 'text-[#5A6A7A] active:text-white'
              }`
            }
            style={{ minHeight: 56, WebkitTapHighlightColor: 'transparent' }}>
            {({ isActive }) => (
              <>
                <Icon size={20} strokeWidth={isActive ? 2.4 : 2} />
                <span className="text-[10px] font-medium leading-tight">{item.label}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
