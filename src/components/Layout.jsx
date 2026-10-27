import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import { useApp } from '../context/AppContext'
export default function Layout() {
  const { sidebarOpen } = useApp()
  // Use --app-height (100dvh on modern browsers) so the layout fills the true
  // visible viewport on iOS — not 100vh, which includes the hidden URL bar
  // and pushes content off-screen when Safari/Chrome show it.
  //
  // Mobile (< lg): Sidebar is hidden by its own responsive classes, and the
  // MobileNav bottom bar takes over. Main content gets bottom padding equal
  // to the bar height + the device safe-area so pages aren't hidden under it.
  return (
    <div className="flex overflow-hidden" style={{ background: '#080B0F', height: 'var(--app-height, 100vh)' }}>
      <Sidebar />
      <main
        className="flex-1 overflow-auto transition-all duration-300"
        style={{ paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}>
        <Outlet />
      </main>
      <MobileNav />
    </div>
  )
}