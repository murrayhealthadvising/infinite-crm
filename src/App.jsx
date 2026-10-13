import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { Component } from 'react'
import Layout from './components/Layout'
import Login from './pages/Login'
import PendingApproval from './pages/PendingApproval'
import Dashboard from './pages/Dashboard'
import Leads from './pages/Leads'
import Pipeline from './pages/Pipeline'
import WarmBucket from './pages/WarmBucket'
import Today from './pages/Today'
import GmailLeads from './pages/Gmail'
import Calculator from './pages/Calculator'
import Settings from './pages/Settings'
import LeadDetail from './pages/LeadDetail'
import Admin from './pages/Admin'
import SoldDetailsModal from './components/SoldDetailsModal'

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
              <button onClick={this.reset} style={{ padding: '8px 16px', borderRadius: 4, background: '#1A2130', color: 'white', border: '1px solid #2A3547', fontSize: 13, cursor: 'pointer' }}>Try again</button>
              <button onClick={this.reload} style={{ padding: '8px 16px', borderRadius: 4, background: 'linear-gradient(135deg, #00E5C3, #3B82F6)', color: 'black', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Reload page</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// Full-screen splash with the brand mark + spinner. Used for both auth
// bootstrap AND first-data load so an agent on a slow connection sees "the
// app is working on it" instead of a blank screen for 30-60 seconds.
function LoadingSplash({ label = 'Loading your CRM…', sub = null }) {
  return (
    <div style={{ background: '#080B0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: 4, background: 'linear-gradient(135deg, #00E5C3, #3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 20 20" width="20" height="20" fill="none">
            <path d="M3 10 C3 7.5 5 6 7 6 C9 6 10 8 10 10 C10 12 11 14 13 14 C15 14 17 12.5 17 10 C17 7.5 15 6 13 6 C11 6 10 8 10 10 C10 12 9 14 7 14 C5 14 3 12.5 3 10 Z" stroke="black" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </div>
        <div style={{ width: 20, height: 20, border: '2px solid #00E5C3', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        {label && <div style={{ color: '#8899AA', fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{label}</div>}
        {sub && <div style={{ color: '#5A6A7A', fontSize: 11, maxWidth: 320 }}>{sub}</div>}
      </div>
    </div>
  )
}

// Thin top-of-screen progress bar — shown while a background refresh happens
// after the initial load (so the agent sees "something is updating" without
// the whole screen going blank). Pure CSS, no deps.
function TopProgressBar({ active }) {
  if (!active) return null
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 9999, pointerEvents: 'none' }}>
      <div style={{
        height: '100%',
        width: '35%',
        background: 'linear-gradient(90deg, transparent, #00E5C3, #3B82F6, transparent)',
        animation: 'topprog 1.1s linear infinite',
      }} />
      <style>{`@keyframes topprog { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
    </div>
  )
}

function AuthGate() {
  const { session, authLoading, profile, loading, leads, loadError, refreshLeads } = useApp()

  if (authLoading) {
    return <LoadingSplash label="Signing you in…" />
  }

  if (!session) return <Login />

  // Sign-up gate: pending role means an admin hasn't approved this user yet.
  // Everyone starts here except murrayhealthadvising@gmail.com (bootstrap admin)
  // — the AppContext creates new profiles with role='pending'.
  if (profile?.role === 'pending') return <PendingApproval />

  // Data-load splash: AppContext.loading flips true on fetch. On the FIRST
  // load (no leads cached yet) we show the full-screen splash so agents on a
  // slow connection don't stare at a blank page for 30-60s. On subsequent
  // refreshes we show the thin top progress bar instead so the screen
  // doesn't flash blank for a background refresh.
  const firstLoad = loading && (!Array.isArray(leads) || leads.length === 0)
  if (firstLoad) {
    return <LoadingSplash label="Loading your leads…" sub="This can take up to a minute on first load if you have a lot of leads. Grab a coffee." />
  }

  // Load error on an EMPTY cache — don't drop the user into a blank CRM
  // without telling them. Show a clear error + Retry so they know this
  // wasn't just "I have no leads yet". Supabase throttling, RLS misconfig,
  // and network blips all land here.
  if (loadError && (!Array.isArray(leads) || leads.length === 0)) {
    return (
      <div style={{ background: '#080B0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, borderRadius: 4, background: 'linear-gradient(135deg, #EF4444, #F59E0B)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 20 }}>⚠</div>
          <h2 style={{ color: 'white', fontSize: 18, marginBottom: 8 }}>Couldn't load your leads</h2>
          <p style={{ color: '#8899AA', fontSize: 13, marginBottom: 4 }}>{loadError}</p>
          <p style={{ color: '#5A6A7A', fontSize: 11, marginBottom: 20 }}>
            Usually this is a brief Supabase hiccup. Try again in a few seconds, or sign out + back in if it persists.
          </p>
          <button onClick={() => refreshLeads()}
            style={{ padding: '10px 20px', borderRadius: 8, background: 'linear-gradient(135deg, #00E5C3, #3B82F6)', color: 'black', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      {/* Thin top progress bar — only shows during background refreshes
          after the initial load, so agents see "something is updating" */}
      <TopProgressBar active={loading} />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="leads" element={<Leads />} />
            <Route path="leads/:id" element={<LeadDetail />} />
            {/* Old /dial-bucket route redirects to /pipeline — buckets are stages now */}
            <Route path="dial-bucket" element={<Navigate to="/warm-bucket" replace />} />
            <Route path="warm-bucket" element={<WarmBucket />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="today" element={<Today />} />
            {/* Old workflow routes redirect to the unified Today page */}
            <Route path="appointments" element={<Navigate to="/today" replace />} />
            <Route path="follow-ups"   element={<Navigate to="/today" replace />} />
            <Route path="tasks"        element={<Navigate to="/today" replace />} />
            <Route path="gmail-leads" element={<GmailLeads />} />
            <Route path="calculator" element={<Calculator />} />
            <Route path="settings" element={<Settings />} />
            <Route path="admin" element={<Admin />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        {/* Global Sold-product prompt — fires whenever a lead moves to Sold */}
        <SoldDetailsModal />
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
