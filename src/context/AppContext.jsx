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

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setAuthLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load profile when session changes
  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    const loadProfile = async () => {
      const ADMIN_EMAIL = 'murrayhealthadvising@gmail.com'
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('user_id', session.user.id).single()
        if (data) {
          // Auto-fix admin role if email matches but role isn't set
          if (session.user.email === ADMIN_EMAIL && data.role !== 'admin') {
            await supabase.from('profiles').update({ role: 'admin' }).eq('user_id', session.user.id)
            setProfile({ ...data, role: 'admin' })
          } else {
            setProfile(data)
          }
        } else {
          // Profile doesn't exist yet - create it
          const isAdmin = session.user.email === ADMIN_EMAIL
          const fallback = { user_id: session.user.id, email: session.user.email, full_name: session.user.user_metadata?.full_name || session.user.email.split('@')[0], role: isAdmin ? 'admin' : 'agent' }
          setProfile(fallback)
          await supabase.from('profiles').upsert([fallback], { onConflict: 'user_id' })
        }
      } catch(e) {
        const isAdmin = session.user.email === ADMIN_EMAIL
        setProfile({ user_id: session.user.id, email: session.user.email, full_name: session.user.email.split('@')[0], role: isAdmin ? 'admin' : 'agent' })
      }
    }
    loadProfile()
  }, [session])

  // Load tags
  useEffect(() => {
    if (!session) return
    const loadTags = async () => {
      const { data } = await supabase.from('tags').select('*').order('sort_order')
      if (data && data.length > 0) setTags(data)
    }
    loadTags()
  }, [session])

  // Load leads when session ready
  useEffect(() => {
    if (!session) { setLeads([]); setLoading(false); return }
    refreshLeads()
  }, [session])

  const refreshLeads = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
      if (error) console.error('refreshLeads error:', error)
      if (data) setLeads(data)
    } catch(e) {
      console.error('refreshLeads exception:', e)
    }
    setLoading(false)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setLeads([])
    setProfile(null)
  }

  const getTag = (id) => tags.find(t => t.id === id) || tags[0]

  const addTag = async (tag) => {
    const newTag = { ...tag, id: tag.label.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(), sort_order: tags.length }
    const { data } = await supabase.from('tags').insert([newTag]).select().single()
    if (data) setTags(prev => [...prev, data])
  }

  const updateTag = async (id, updates) => {
    await supabase.from('tags').update(updates).eq('id', id)
    setTags(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }

  const deleteTag = async (id) => {
    await supabase.from('tags').delete().eq('id', id)
    setTags(prev => prev.filter(t => t.id !== id))
  }

  const updateLeadStage = async (leadId, newStage) => {
    const now = new Date().toISOString()
    await supabase.from('leads').update({ stage: newStage, last_activity: now }).eq('id', leadId)
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: newStage, last_activity: now } : l))
    await addActivity(leadId, 'status', `Stage changed to: ${newStage.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`)
  }

  const addLead = async (lead) => {
    try {
      const newLead = { ...lead }
      delete newLead.id
      newLead.stage = newLead.stage || 'not-started'
      newLead.agent = newLead.agent || profile?.full_name || 'Agent'
      newLead.user_id = session?.user?.id
      newLead.created_at = newLead.created_at || new Date().toISOString()
      newLead.last_activity = newLead.last_activity || new Date().toISOString()
      Object.keys(newLead).forEach(k => { if (newLead[k] === undefined) delete newLead[k] })
      const { data, error } = await supabase.from('leads').insert([newLead]).select().single()
      if (error) { console.error('addLead error:', error); return newLead }
      if (data) { setLeads(prev => [data, ...prev]); return data }
    } catch (e) { console.error('addLead exception:', e) }
    return lead
  }

  const bulkAddLeads = async (leadsToAdd) => {
    const ALLOWED = ['first_name','last_name','phone','email','state','city','zip','street_address','stage','source','campaign','price','dob','gender','age','age_range','household','income','smoker','spouse_age','num_children','notes','comments','premium','carrier','effective_date','plan_choice','monthly_budget','current_carrier','best_contact_time','agent','is_sold','created_at','last_activity','user_id']
    const now = new Date().toISOString()
    const cleaned = leadsToAdd.map(lead => {
      const l = {}
      ALLOWED.forEach(k => { l[k] = null })
      ALLOWED.forEach(k => { if (lead[k] !== undefined && lead[k] !== null && lead[k] !== '') l[k] = lead[k] })
      l.stage = l.stage || 'not-started'
      l.agent = l.agent || profile?.full_name || 'Agent'
      l.user_id = session?.user?.id
      l.created_at = now
      l.last_activity = now
      if (typeof l.is_sold === 'string') l.is_sold = l.is_sold.toLowerCase() === 'yes' || l.is_sold === '1'
      else if (l.is_sold === null) l.is_sold = false
      if (l.household !== null) l.household = parseInt(l.household) || null
      if (l.income !== null) l.income = parseInt(String(l.income).replace(/[$,]/g, '')) || null
      if (l.premium !== null) l.premium = parseInt(String(l.premium).replace(/[$,]/g, '')) || null
      return l
    })
    const BATCH = 50
    let inserted = 0
    for (let i = 0; i < cleaned.length; i += BATCH) {
      const batch = cleaned.slice(i, i + BATCH)
      const { data, error } = await supabase.from('leads').insert(batch).select('id')
      if (error) {
        console.error('Batch error:', JSON.stringify(error))
        for (const lead of batch) {
          const { error: e2 } = await supabase.from('leads').insert([lead])
          if (!e2) inserted++
          else console.error('Single error:', e2.message, lead.first_name)
        }
      } else {
        inserted += (data?.length || batch.length)
      }
    }
    return inserted
  }

  const updateLead = async (id, updates) => {
    const now = new Date().toISOString()
    await supabase.from('leads').update({ ...updates, last_activity: now }).eq('id', id)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates, last_activity: now } : l))
  }

  const addActivity = async (leadId, type, note) => {
    const entry = { lead_id: leadId, type, note, user_id: session?.user?.id, created_at: new Date().toISOString() }
    const { data } = await supabase.from('activities').insert([entry]).select().single()
    const saved = data || { ...entry, id: Date.now().toString() }
    setActivities(prev => ({ ...prev, [leadId]: [saved, ...(prev[leadId] || [])] }))
    return saved
  }

  const getLeadActivities = async (leadId) => {
    if (activities[leadId]) return activities[leadId]
    const { data } = await supabase.from('activities').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
    if (data) setActivities(prev => ({ ...prev, [leadId]: data }))
    return data || []
  }

  const user = profile ? {
    name: profile.full_name || profile.email,
    email: profile.email,
    role: profile.role || 'agent',
    agency: 'Murray Health Advising'
  } : null

  const stats = {
    total: leads.length,
    today: leads.filter(l => new Date(l.created_at).toDateString() === new Date().toDateString()).length,
    sold: leads.filter(l => l.stage === 'sold').length,
    interested: leads.filter(l => l.stage === 'interested').length,
    apt: leads.filter(l => l.stage === 'apt').length,
    ghosted: leads.filter(l => l.stage === 'ghosted').length,
  }

  return (
    <AppContext.Provider value={{
      leads, user, stats, loading, authLoading, session, profile,
      sidebarOpen, setSidebarOpen,
      tags, addTag, updateTag, deleteTag, getTag,
      updateLeadStage, addLead, bulkAddLeads, updateLead,
      addActivity, getLeadActivities, refreshLeads, signOut
    }}>
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => useContext(AppContext)
