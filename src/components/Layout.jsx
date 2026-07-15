import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useApp } from '../context/AppContext'
export default function Layout() {
  const { sidebarOpen } = useApp()
  // Use --app-height (100dvh on modern browsers) so the layout fills the true
  // visible viewport on iOS — not 100vh, which includes the hidden URL bar
  // and pushes content off-screen when Safari/Chrome show it.
  return (
    <div className="flex overflow-hidden" style={{ background: '#080B0F', height: 'var(--app-height, 100vh)' }}>
      <Sidebar />
      <main className="flex-1 overflow-auto transition-all duration-300"><Outlet /></main>
    </div>
  )
}