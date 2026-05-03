import { createContext, useContext, useState, useEffect } from 'react'
import { supabase, DEFAULT_TAGS } from '../lib/supabase'

const AppContext = createContext(null)

// ---- Stage <-> Status compatibility ---------------------------------------
// The DB uses `status` (capitalized labels like "Not Started", "Interested"),
// but a lot of legacy components still pass `stage` ids ("not-started", etc.)
// These helpers let new + old code coexist.
const STATUS_LABELS = ['Not Started','Interested','Apt','Ghosted','Sold','Aged','Stop','Long Term']
const stageIdToStatus = {
  'not-started': 'Not Started', 'interested': 'Interested', 'apt': 'Apt',
  'ghosted': 'Ghosted', 'sold': 'Sold', 'aged': 'Aged', 'stop': 'Stop', 'long-term': 'Long Term',
}
const statusToStageId = Object.fromEntries(Object.entries(stageIdToStatus).map(([id, s]) => [s, id]))
function leadStatusOf(lead) {
  if (!lead) return 'Not Started'
  if (lead.status) return lead.status
  if (lead.stage) return stageIdToStatus[lead.stage] || 'Not Started'
  return 'Not Started'
}

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
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); setAuthLoading(false) })
    return () => { try { subscription?.unsubscribe?.() } catch {} }
  }, [])

  // Load profile when session changes (auto-promotes Murray to admin)
  useEffect(() => {
    if (session?.user) loadProfile(session.user); else setProfile(null)
  }, [session?.user?.id])

  const loadProfile = async (sUser) => {
    try {
      let { data, error } = await supabase.from('profiles').select('*').eq('user_id', sUser.id).maybeSingle()
      if (error && error.code !== 'PGRST116') { console.error('loadProfile error:', error) }
      const isMurray = sUser.email === 'murrayhealthadvising@gmail.com'
      if (!data) {
        const fallback = {
          user_id: sUser.id,
          email: sUser.email || '',
          full_name: sUser.user_metadata?.full_name || (sUser.email ? sUser.email.split('@')[0] : 'Agent'),
          role: isMurray ? 'admin' : 'agent',
        }
        try {
          const { data: newProfile } = await supabase.from('profiles').upsert(fallback, { onConflict: 'user_id' }).select().maybeSingle()
          setProfile(newProfile || fallback)
        } catch (e) { setProfile(fallback) }
      } else {
        if (isMurray && data.role !== 'admin') {
          try { await supabase.from('profiles').update({ role: 'admin' }).eq('user_id', sUser.id) } catch {}
          data = { ...data, role: 'admin' }
        }
        if (!data.full_name) data.full_name = (sUser.email ? sUser.email.split('@')[0] : 'Agent')
        setProfile(data)
      }
    } catch (e) {
      console.error('loadProfile exception:', e)
      setProfile({
        user_id: sUser.id,
        email: sUser.email || '',
        full_name: sUser.email ? sUser.email.split('@')[0] : 'Agent',
        role: sUser.email === 'murrayhealthadvising@gmail.com' ? 'admin' : 'agent',
      })
    }
  }

  // Load leads + realtime subscription so worker-inserted leads appear live
  useEffect(() => {
    if (!session?.user) { setLeads([]); setLoading(false); return }
    refreshLeads()
    let channel
    try {
      channel = supabase
        .channel('leads-changes-' + session.user.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
          const row = payload.new; if (!row) return
          if (row.user_id && row.user_id !== session.user.id) return
          setLeads(prev => prev.find(l => l.id === row.id) ? prev : [row, ...prev])
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
          const row = payload.new; if (!row) return
          setLeads(prev => prev.map(l => l.id === row.id ? { ...l, ...row } : l))
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'leads' }, (payload) => {
          const oldRow = payload.old; if (!oldRow) return
          setLeads(prev => prev.filter(l => l.id !== oldRow.id))
        })
        .subscribe()
    } catch (e) { console.error('realtime subscribe failed:', e) }
    return () => { try { if (channel) supabase.removeChannel(channel) } catch {} }
  }, [session?.user?.id])

  const refreshLeads = async () => {
    if (!session?.user) { setLoading(false); return }
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('leads').select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
      if (error) console.error('refreshLeads error:', error)
      if (Array.isArray(data)) setLeads(data)
    } catch (e) { console.error('refreshLeads exception:', e) }
    setLoading(false)
  }

  // Tags
  useEffect(() => {
    if (!session) return
    const loadTags = async () => {
      try {
        const { data } = await supabase.from('tags').select('*').order('sort_order')
        if (data && data.length > 0) setTags(data)
      } catch (e) { /* keep DEFAULT_TAGS */ }
    }
    loadTags()
  }, [session?.user?.id])

  // ---- API exposed to consumers --------------------------------------------
  const signOut = async () => {
    try { await supabase.auth.signOut() } catch {}
    setLeads([]); setProfile(null); setSession(null)
  }

  const getTag = (stageOrStatus) => {
    if (!Array.isArray(tags) || tags.length === 0) return DEFAULT_TAGS[0]
    if (!stageOrStatus) return tags[0]
    // Try to match by id (legacy "stage" id), label (status), or both
    const id = String(stageOrStatus).toLowerCase()
    const exactId = tags.find(t => t.id === stageOrStatus || t.id === id)
    if (exactId) return exactId
    const exactLabel = tags.find(t => (t.label || '').toLowerCase() === id)
    if (exactLabel) return exactLabel
    // Map status string → stage id and try
    const mapped = statusToStageId[stageOrStatus]
    if (mapped) {
      const m = tags.find(t => t.id === mapped)
      if (m) return m
    }
    return tags[0]
  }

  const addTag = async (tag) => {
    const newTag = { ...tag, id: tag.label.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(), sort_order: tags.length }
    try {
      const { data } = await supabase.from('tags').insert([newTag]).select().single()
      if (data) setTags(prev => [...prev, data])
    } catch (e) { setTags(prev => [...prev, newTag]) }
  }
  const updateTag = async (id, updates) => {
    try { await supabase.from('tags').update(updates).eq('id', id) } catch {}
    setTags(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }
  const deleteTag = async (id) => {
    try { await supabase.from('tags').delete().eq('id', id) } catch {}
    setTags(prev => prev.filter(t => t.id !== id))
  }

  const updateLead = async (id, updates) => {
    const now = new Date().toISOString()
    try { await supabase.from('leads').update({ ...updates, last_activity: now }).eq('id', id) } catch (e) { console.error('updateLead error:', e) }
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates, last_activity: now } : l))
  }

  const deleteLead = async (id) => {
    if (!id) return false
    try {
      const { error } = await supabase.from('leads').delete().eq('id', id)
      if (error) { console.error('deleteLead error:', error); return false }
      setLeads(prev => prev.filter(l => l.id !== id))
      return true
    } catch (e) { console.error('deleteLead exception:', e); return false }
  }

  const deleteLeads = async (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return 0
    let deleted = 0
    const CHUNK = 100
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      try {
        const { error } = await supabase.from('leads').delete().in('id', chunk)
        if (error) { console.error('deleteLeads chunk error:', error) }
        else deleted += chunk.length
      } catch (e) { console.error('deleteLeads exception:', e) }
    }
    if (deleted > 0) setLeads(prev => prev.filter(l => !ids.includes(l.id)))
    return deleted
  }

  // Wipe ALL leads for the current user — used by "Delete all" button
  const deleteAllLeadsForUser = async () => {
    if (!session?.user?.id) return 0
    const before = leads.length
    try {
      const { error } = await supabase.from('leads').delete().eq('user_id', session.user.id)
      if (error) { console.error('deleteAllLeadsForUser error:', error); return 0 }
      setLeads([])
      return before
    } catch (e) { console.error('deleteAllLeadsForUser exception:', e); return 0 }
  }

  const updateLeadStage = async (leadId, newStage) => {
    // newStage may be a stage id ("interested") OR a status label ("Interested")
    const status = stageIdToStatus[newStage] || (STATUS_LABELS.includes(newStage) ? newStage : 'Not Started')
    const stageId = statusToStageId[status] || newStage
    await updateLead(leadId, { stage: stageId, status })
    try { await addActivity(leadId, 'status', `Stage changed to: ${status}`) } catch {}
  }

  const addLead = async (lead) => {
    try {
      const newLead = { ...lead }
      delete newLead.id
      newLead.user_id = session?.user?.id
      newLead.status = newLead.status || stageIdToStatus[newLead.stage] || 'Not Started'
      if (!newLead.stage) newLead.stage = statusToStageId[newLead.status] || 'not-started'
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
    if (!Array.isArray(leadsToAdd) || leadsToAdd.length === 0) return 0
    const now = new Date().toISOString()
    const cleaned = leadsToAdd.map(lead => {
      const l = { ...lead }
      l.user_id = session?.user?.id
      l.status = l.status || stageIdToStatus[l.stage] || 'Not Started'
      if (!l.stage) l.stage = statusToStageId[l.status] || 'not-started'
      l.created_at = l.created_at || now
      l.last_activity = l.last_activity || now
      Object.keys(l).forEach(k => { if (l[k] === undefined) delete l[k] })
      return l
    })
    let inserted = 0
    const BATCH = 50
    for (let i = 0; i < cleaned.length; i += BATCH) {
      const batch = cleaned.slice(i, i + BATCH)
      try {
        const { data, error } = await supabase.from('leads').insert(batch).select('id')
        if (error) {
          console.error('bulkAddLeads batch error:', error)
          // fallback to one-by-one
          for (const l of batch) {
            try { const { error: e2 } = await supabase.from('leads').insert([l]); if (!e2) inserted++ } catch {}
          }
        } else inserted += (data?.length || batch.length)
      } catch (e) { console.error('bulkAddLeads exception:', e) }
    }
    try { await refreshLeads() } catch {}
    return inserted
  }

  const addActivity = async (leadId, type, note) => {
    const entry = { lead_id: leadId, type, note, user_id: session?.user?.id, created_at: new Date().toISOString() }
    try {
      const { data } = await supabase.from('activities').insert([entry]).select().single()
      const saved = data || { ...entry, id: 'tmp-' + Date.now() }
      setActivities(prev => ({ ...prev, [leadId]: [saved, ...(prev[leadId] || [])] }))
      return saved
    } catch (e) {
      const saved = { ...entry, id: 'tmp-' + Date.now() }
      setActivities(prev => ({ ...prev, [leadId]: [saved, ...(prev[leadId] || [])] }))
      return saved
    }
  }

  const getLeadActivities = async (leadId) => {
    if (activities[leadId]) return activities[leadId]
    try {
      const { data } = await supabase.from('activities').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
      if (data) setActivities(prev => ({ ...prev, [leadId]: data }))
      return data || []
    } catch { return [] }
  }

  // Combined user object — has both session.user fields (id, email) AND legacy display fields (name, role)
  const user = session?.user ? {
    ...session.user,
    name: profile?.full_name || (session.user.email ? session.user.email.split('@')[0] : 'Agent'),
    role: profile?.role || (session.user.email === 'murrayhealthadvising@gmail.com' ? 'admin' : 'agent'),
    agency: 'Murray Health Advising',
  } : null

  // Stats supporting BOTH `stage` (legacy) and `status` (new) schemas
  const safeArr = Array.isArray(leads) ? leads : []
  const stats = {
    total: safeArr.length,
    today: safeArr.filter(l => { try { return new Date(l.created_at).toDateString() === new Date().toDateString() } catch { return false } }).length,
    interested: safeArr.filter(l => leadStatusOf(l) === 'Interested').length,
    apt: safeArr.filter(l => leadStatusOf(l) === 'Apt').length,
    aptsScheduled: safeArr.filter(l => leadStatusOf(l) === 'Apt').length,
    sold: safeArr.filter(l => leadStatusOf(l) === 'Sold').length,
    ghosted: safeArr.filter(l => leadStatusOf(l) === 'Ghosted').length,
  }

  return (
    <AppContext.Provider value={{
      leads, setLeads, activities, setActivities, tags, setTags,
      loading, setLoading, authLoading, session, user, profile, stats,
      sidebarOpen, setSidebarOpen,
      // helpers
      getTag, signOut, refreshLeads,
      addLead, bulkAddLeads, updateLead, updateLeadStage,
      deleteLead, deleteLeads, deleteAllLeadsForUser,
      addActivity, getLeadActivities,
      addTag, updateTag, deleteTag,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
