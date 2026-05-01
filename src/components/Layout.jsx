import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useApp } from '../context/AppContext'

export default function Layout() {
  const { sidebarOpen } = useApp()
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#080B0F' }}>
      <Sidebar />
      <main className={`flex-1 overflow-auto transition-all duration-300`}>
        <Outlet />
      </main>
    </div>
  )
}
