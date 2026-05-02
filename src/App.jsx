import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { Component } from 'react'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Leads from './pages/Leads'
import Pipeline from './pages/Pipeline'
import Appointments from './pages/Appointments'
import FollowUps from './pages/FollowUps'
import Tasks from './pages/Tasks'
import GmailLeads from './pages/Gmail'
import Calculator from './pages/Calculator'
import LeadROI from './pages/ROI'
import Settings from './pages/Settings'
import LeadDetail from './pages/LeadDetail'
import Admin from './pages/Admin'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, info: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    this.setState({ info })
    try { console.error('[ErrorBoundary]', error, info?.componentStack) } catch {}
  }
  reset = () => this.setState({ error: null, info: null })
  reload = () => { try { window.location.reload() } catch {} }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background: '#080B0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', padding: 40 }}>
          <div style={{ maxWidth: 720 }}>
            <h2 style={{ color: '#EF4444', marginBottom: 16 }}>Something crashed</h2>
            <p style={{ color: '#8899AA', fontSize: 13, marginBottom: 12 }}>
              {this.state.error?.message || 'Unknown error'}
            </p>
            <details style={{ color: '#5A6A7A', fontSize: 11, marginBottom: 16 }} open>
              <summary style={{ cursor: 'pointer', color: '#8899AA' }}>Stack & component trail</summary>
              <pre style={{ color: '#8899AA', fontSize: 11, whiteSpace: 'pre-wrap', overflowX: 'auto', marginTop: 8 }}>
                {this.state.error?.stack?.slice(0, 1200)}
                {this.state.info?.componentStack ? `\n\n--- Component stack ---${this.state.info.componentStack.slice(0, 1200)}` : ''}
              </pre>
            </details>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={this.reset} style={{ padding: '8px 16px', borderRadius: 8, background: '#1A2130', color: 'white', border: '1px solid #2A3547', fontSize: 13, cursor: 'pointer' }}>Try again</button>
              <button onClick={this.reload} style={{ padding: '8px 16px', borderRadius: 8, background: 'linear-gradient(135deg, #00E5C3, #3B82F6)', color: 'black', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Reload page</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function AuthGate() {
  const { session, authLoading } = useApp()

  if (authLoading) {
    return (
      <div style={{ background: '#080B0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #00E5C3, #3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none">
              <path d="M3 10 C3 7.5 5 6 7 6 C9 6 10 8 10 10 C10 12 11 14 13 14 C15 14 17 12.5 17 10 C17 7.5 15 6 13 6 C11 6 10 8 10 10 C10 12 9 14 7 14 C5 14 3 12.5 3 10 Z" stroke="black" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ width: 20, height: 20, border: '2px solid #00E5C3', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      </div>
    )
  }

  if (!session) return <Login />

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="leads" element={<Leads />} />
            <Route path="leads/:id" element={<LeadDetail />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="appointments" element={<Appointments />} />
            <Route path="follow-ups" element={<FollowUps />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="gmail-leads" element={<GmailLeads />} />
            <Route path="calculator" element={<Calculator />} />
            <Route path="lead-roi" element={<LeadROI />} />
            <Route path="settings" element={<Settings />} />
            <Route path="admin" element={<Admin />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}



export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AuthGate />
      </AppProvider>
    </ErrorBoundary>
  )
}
