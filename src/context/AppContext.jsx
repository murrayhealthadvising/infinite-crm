import { createContext, useContext, useState, useEffect } from 'react'
import { supabase, DEFAULT_TAGS } from '../lib/supabase'
const AppContext = createContext(null)
export function AppProvider({ children }) {
  const [leads, setLeads] = useState([])
  const [activities, setActivities] = useState({})
  const [tags, setTags] = useState(DEFAULT_TAGS)
  const [loading, setLoading] = useState(true)
  const [authLoading, setAuthLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); setAuthLoading(false) })
    return () => subscription.unsubscribe()
  }, [])
  useEffect(() => { if (session?.user) loadProfile(session.user); else setProfile(null) }, [session?.user?.id])
  const loadProfile = async (user) => {
    let { data, error } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
    if (error?.code === 'PGRST116' || !data) {
      const isAdmin = user.email === 'murrayhealthadvising@gmail.com'
      const { data: newProfile } = await supabase.from('profiles').upsert({ user_id: user.id, email: user.email, full_name: user.user_metadata?.full_name || user.email?.split('@')[0], role: isAdmin ? 'admin' : 'agent' }, { onConflict: 'user_id' }).select().single()
      setProfile(newProfile || { user_id: user.id, email: user.email, role: isAdmin ? 'admin' : 'agent' })
    } else {
      if (user.email === 'murrayhealthadvising@gmail.com' && data?.role !== 'admin') { await supabase.from('profiles').update({ role: 'admin' }).eq('user_id', user.id); data = { ...data, role: 'admin' } }
      setProfile(data)
    }
  }
  const stats = { total: leads.length, interested: leads.filter(l => l.status === 'Interested').length, aptsScheduled: leads.filter(l => l.status === 'Apt').length, sold: leads.filter(l => l.status === 'Sold').length }
  return (<AppContext.Provider value={{ leads, setLeads, activities, setActivities, tags, setTags, loading, setLoading, authLoading, session, user: session?.user || null, profile, stats, sidebarOpen, setSidebarOpen }}>{children}</AppContext.Provider>)
}
export function useApp() { const ctx = useContext(AppContext); if (!ctx) throw new Error('useApp must be used within AppProvider'); return ctx }