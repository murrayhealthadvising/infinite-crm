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
  // When a lead is moved to "Sold", we fire a modal asking for product details.
  // The modal lives at the App level so any caller (Leads card, Pipeline drag,
  // LeadDetail dropdown, kanban) automatically triggers it.
  const [pendingSoldLeadId, setPendingSoldLeadId] = useState(null)

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

  // Load leads + realtime subscription so worker-inserted leads appear live.
  // Re-run when profile changes too, since runners filter by their lead_agent_id.
  useEffect(() => {
    if (!session?.user) { setLeads([]); setLoading(false); return }
    refreshLeads()
    const targetId = (profile?.role === 'runner' && profile?.lead_agent_id)
      ? profile.lead_agent_id
      : session.user.id
    let channel
    try {
      channel = supabase
        .channel('leads-changes-' + targetId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
          const row = payload.new; if (!row) return
          if (row.user_id && row.user_id !== targetId) return
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
  }, [session?.user?.id, profile?.role, profile?.lead_agent_id])

  const refreshLeads = async () => {
    if (!session?.user) { setLoading(false); return }
    // Runners pull their lead-agent's leads; everyone else pulls their own.
    const targetId = (profile?.role === 'runner' && profile?.lead_agent_id)
      ? profile.lead_agent_id
      : session.user.id
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('leads').select('*')
        .eq('user_id', targetId)
        .order('created_at', { ascending: false })
      if (error) console.error('refreshLeads error:', error)
      if (Array.isArray(data)) setLeads(data)
    } catch (e) { console.error('refreshLeads exception:', e) }
    setLoading(false)
  }

  // Tags (pipeline stages) — every agent owns a personal copy of the 8 defaults
  // PLUS any custom stages they add. They can edit/recolor/reorder/delete any
  // of them independently of teammates. Runners see their lead-agent's stages
  // via RLS, read-only.
  useEffect(() => {
    if (!session) return
    const loadTags = async () => {
      try {
        const { data } = await supabase.from('tags').select('*').order('sort_order')
        if (data && data.length > 0) { setTags(data); return }
        // Fresh agent (no rows yet) → seed their own copies of the 8 defaults
        if (profile?.role === 'runner') { setTags([]); return }
        const seed = DEFAULT_TAGS.map((t, i) => ({ ...t, user_id: session.user.id, sort_order: i }))
        const { data: inserted, error } = await supabase.from('tags').insert(seed).select()
        if (!error && inserted) setTags(inserted)
        else setTags(DEFAULT_TAGS)
      } catch (e) { /* keep DEFAULT_TAGS */ }
    }
    loadTags()
  }, [session?.user?.id, profile?.role])

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
    const uid = session?.user?.id
    const newTag = {
      ...tag,
      id: tag.label.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
      sort_order: tags.length,
      user_id: uid,
    }
    try {
      const { data } = await supabase.from('tags').insert([newTag]).select().single()
      if (data) setTags(prev => [...prev, data])
    } catch (e) { setTags(prev => [...prev, newTag]) }
  }
  // Tags table now uses composite key (id, user_id) — scope updates/deletes
  // to the current user so RLS doesn't reject and we can't accidentally touch
  // someone else's row of the same id.
  const updateTag = async (id, updates) => {
    const uid = session?.user?.id
    try { await supabase.from('tags').update(updates).eq('id', id).eq('user_id', uid) } catch {}
    setTags(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }
  const deleteTag = async (id) => {
    const uid = session?.user?.id
    try { await supabase.from('tags').delete().eq('id', id).eq('user_id', uid) } catch {}
    setTags(prev => prev.filter(t => t.id !== id))
  }

  // Persist a new ordering of stage IDs by writing sort_order back to the DB.
  // Optimistic: update local state immediately, then fan out per-row updates.
  const reorderTags = async (orderedIds) => {
    const uid = session?.user?.id
    setTags(prev => {
      const map = new Map(prev.map(t => [t.id, t]))
      return orderedIds.map((id, i) => ({ ...(map.get(id) || { id }), sort_order: i }))
    })
    try {
      await Promise.all(orderedIds.map((id, i) =>
        supabase.from('tags').update({ sort_order: i }).eq('id', id).eq('user_id', uid)
      ))
    } catch (e) { console.error('reorderTags failed:', e) }
  }

  const updateLead = async (id, updates) => {
    const now = new Date().toISOString()
    try { await supabase.from('leads').update({ ...updates, last_activity: now }).eq('id', id) } catch (e) { console.error('updateLead error:', e) }
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates, last_activity: now } : l))
  }

  const deleteLead = async (id) => {
    if (!id) return false
    if (profile?.role === 'runner') { console.warn('runners cannot delete leads'); return false }
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
    // newStage may be a stage id ("interested", "quoted-1730000000") OR a
    // status label ("Interested"). Resolve in priority order:
    //   1. Exact match on a tag's id (covers custom stages too)
    //   2. Status label → stage id (legacy)
    //   3. Stage id → status label (legacy)
    //   4. Pass through as-is (assume it's a valid id)
    let stageId = newStage
    let stageLabel = ''
    const safeTags = Array.isArray(tags) ? tags : []
    const matchById = safeTags.find(t => t.id === newStage)
    if (matchById) { stageId = matchById.id; stageLabel = matchById.label }
    else {
      const matchByLabel = safeTags.find(t => (t.label || '').toLowerCase() === String(newStage).toLowerCase())
      if (matchByLabel) { stageId = matchByLabel.id; stageLabel = matchByLabel.label }
      else if (stageIdToStatus[newStage]) { stageId = newStage; stageLabel = stageIdToStatus[newStage] }
      else if (STATUS_LABELS.includes(newStage)) { stageLabel = newStage; stageId = statusToStageId[newStage] || newStage }
      else { stageId = newStage; stageLabel = newStage }
    }
    // No-op guard: dragging a lead back into the SAME column it's already in
    // shouldn't reset the "Xd in stage" badge or spam the activity log.
    const current = leads.find(l => l.id === leadId)
    if (current && current.stage === stageId) return

    // Stamp stage_changed_at so the "Xd in stage" badge on Pipeline cards
    // tracks how long the lead has been sitting in this bucket.
    await updateLead(leadId, { stage: stageId, stage_changed_at: new Date().toISOString() })
    try { await addActivity(leadId, 'status', `Stage changed to: ${stageLabel || stageId}`) } catch {}
    if (stageId === 'sold') {
      const lead = leads.find(l => l.id === leadId)
      const hasDetails = lead && (lead.carrier || lead.plan_choice || lead.premium)
      if (!hasDetails) setPendingSoldLeadId(leadId)
    }
  }

  // Whitelist of columns the leads table actually has. Prevents PGRST204
  // ("column not found in schema cache") when callers hand us extra fields.
  const LEADS_COLUMNS = new Set([
    'first_name','last_name','phone','email','city','state','zip','address','street_address',
    'source','notes','notes_b','comments','dob','gender','age','age_range','smoker','spouse_age','num_children',
    'income','household','external_id','agent','agent_id','campaign','price',
    'premium','carrier','current_carrier','effective_date','plan_choice','monthly_budget','best_contact_time',
    'tags','stage','is_sold','user_id','created_at','last_activity',
    'runner',  // free-text attribution: who actually worked the lead
    'stage_changed_at',  // when the lead's stage was last updated (drives "time in stage" badge)
    'custom_fields',  // user-defined {key: value} pairs the agent adds in Edit
  ])
  const sanitizeForInsert = (lead) => {
    const out = {}
    for (const [k, v] of Object.entries(lead)) {
      if (LEADS_COLUMNS.has(k) && v !== undefined && v !== '') out[k] = v
    }
    return out
  }
  // status -> stage id resolver (only stage exists in schema)
  const resolveStage = (lead) => {
    if (lead.stage) return lead.stage
    if (lead.status) return statusToStageId[lead.status] || 'not-started'
    return 'not-started'
  }

  const addLead = async (lead) => {
    try {
      const merged = { ...lead }
      delete merged.id
      merged.user_id = session?.user?.id
      merged.stage = resolveStage(merged)
      merged.created_at = merged.created_at || new Date().toISOString()
      merged.last_activity = merged.last_activity || new Date().toISOString()
      const newLead = sanitizeForInsert(merged)
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
      const merged = { ...lead }
      merged.user_id = session?.user?.id
      merged.stage = resolveStage(merged)
      merged.created_at = merged.created_at || now
      merged.last_activity = merged.last_activity || now
      return sanitizeForInsert(merged)
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
    // Daily dial tracker — every logged 'call' bumps today's count optimistically
    if (type === 'call') setDialsToday(d => d + 1)
    try {
      const { data, error } = await supabase.from('activities').insert([entry]).select().single()
      if (error) {
        // Surface the failure loudly so silent drops never happen again
        console.error('[addActivity] insert FAILED for lead', leadId, 'type', type, '— error:', error)
        if (type === 'call') setDialsToday(d => Math.max(0, d - 1))  // roll back
        const saved = { ...entry, id: 'tmp-' + Date.now(), _failed: true }
        setActivities(prev => ({ ...prev, [leadId]: [saved, ...(prev[leadId] || [])] }))
        return saved
      }
      const saved = data || { ...entry, id: 'tmp-' + Date.now() }
      setActivities(prev => ({ ...prev, [leadId]: [saved, ...(prev[leadId] || [])] }))
      return saved
    } catch (e) {
      console.error('[addActivity] insert THREW for lead', leadId, 'type', type, '— exception:', e)
      if (type === 'call') setDialsToday(d => Math.max(0, d - 1))
      const saved = { ...entry, id: 'tmp-' + Date.now(), _failed: true }
      setActivities(prev => ({ ...prev, [leadId]: [saved, ...(prev[leadId] || [])] }))
      return saved
    }
  }

  // ── Daily dial tracker ─────────────────────────────────────────────────────
  // Counts 'call'-type activities created TODAY by the current user. Resets
  // naturally at midnight (the query window starts at local midnight). Each
  // dial click bumps the count optimistically; a full refresh runs on load.
  const [dialsToday, setDialsToday] = useState(0)
  const refreshDialsToday = async () => {
    if (!session?.user?.id) { setDialsToday(0); return }
    try {
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const { count, error } = await supabase
        .from('activities')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'call')
        .eq('user_id', session.user.id)
        .gte('created_at', start.toISOString())
      if (error) { console.error('[refreshDialsToday]', error); return }
      if (typeof count === 'number') setDialsToday(count)
    } catch (e) { console.error('[refreshDialsToday] threw', e) }
  }
  useEffect(() => {
    if (!session?.user) { setDialsToday(0); return }
    refreshDialsToday()
    // Re-check at the next local midnight so the counter rolls over live
    const now = new Date()
    const midnight = new Date(now); midnight.setHours(24, 0, 0, 0)
    const t = setTimeout(() => refreshDialsToday(), midnight.getTime() - now.getTime() + 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  // Delete a single activity by id. Optimistic — removes from cache first,
  // then deletes from Supabase. If the server rejects (RLS / not yours / etc.)
  // we re-fetch to restore truth.
  const deleteActivity = async (activityId, leadId) => {
    if (!activityId) return false
    // Optimistic local remove
    setActivities(prev => {
      const next = { ...prev }
      if (leadId && Array.isArray(next[leadId])) {
        next[leadId] = next[leadId].filter(a => a.id !== activityId)
      } else {
        // Unknown leadId — scan all buckets
        for (const k of Object.keys(next)) {
          next[k] = (next[k] || []).filter(a => a.id !== activityId)
        }
      }
      return next
    })
    try {
      const { error } = await supabase.from('activities').delete().eq('id', activityId)
      if (error) {
        console.error('[deleteActivity] failed for', activityId, error)
        // Re-fetch to restore truth
        if (leadId) {
          try {
            const { data } = await supabase.from('activities').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
            if (data) setActivities(prev => ({ ...prev, [leadId]: data }))
          } catch {}
        }
        return false
      }
      return true
    } catch (e) {
      console.error('[deleteActivity] threw for', activityId, e)
      return false
    }
  }

  // getLeadActivities: by default returns cached activities for snappy UI.
  // Pass { force: true } to bypass cache — used by lead-detail and drawer on
  // open so teammate activities (created since last open) are always visible.
  const getLeadActivities = async (leadId, opts = {}) => {
    const force = !!opts?.force
    if (!force && activities[leadId]) return activities[leadId]
    try {
      const { data, error } = await supabase.from('activities').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
      if (error) console.error('[getLeadActivities] fetch failed for lead', leadId, error)
      if (data) setActivities(prev => ({ ...prev, [leadId]: data }))
      return data || []
    } catch (e) {
      console.error('[getLeadActivities] threw for lead', leadId, e)
      return []
    }
  }

  // Combined user object — has both session.user fields (id, email) AND legacy display fields (name, role)
  const user = session?.user ? {
    ...session.user,
    name: profile?.full_name || (session.user.email ? session.user.email.split('@')[0] : 'Agent'),
    role: profile?.role || (session.user.email === 'murrayhealthadvising@gmail.com' ? 'admin' : 'agent'),
    agency: 'Murray Health Advising',
  } : null

  // Marketplace forwarding address — set per agent so they know what to give
  // USHA Lead Arena / Ringy / etc. Comes from profiles.lead_email.
  const leadEmail = profile?.lead_email || null

  // Per-agent campaign library — string array. Falls back to a sensible set
  // of defaults (the most common lead vendors) until the agent customizes.
  const DEFAULT_CAMPAIGNS = ['GoldBar', 'RedMedia', 'Dynasty', 'Exclusive', 'Performance']
  const campaigns = Array.isArray(profile?.campaigns) && profile.campaigns.length
    ? profile.campaigns
    : DEFAULT_CAMPAIGNS
  const saveCampaigns = async (next) => {
    const uid = session?.user?.id
    if (!uid) return
    const arr = Array.from(new Set((next || []).map(c => String(c).trim()).filter(Boolean)))
    setProfile(p => p ? { ...p, campaigns: arr } : p)
    try { await supabase.from('profiles').update({ campaigns: arr }).eq('user_id', uid) } catch (e) { console.error('saveCampaigns failed:', e) }
  }

  // Per-agent side-tag library — { tagName: { color, hidden } }. Drives the
  // color of chips on lead cards + lets the agent hide tags from the picker.
  const sideTagStyles = (profile?.side_tag_styles && typeof profile.side_tag_styles === 'object') ? profile.side_tag_styles : {}
  const setSideTagStyles = async (next) => {
    const uid = session?.user?.id
    if (!uid) return
    setProfile(p => p ? { ...p, side_tag_styles: next } : p)
    try { await supabase.from('profiles').update({ side_tag_styles: next }).eq('user_id', uid) } catch (e) { console.error('setSideTagStyles failed:', e) }
  }

  // Per-agent pipeline-card field toggles — picks which info shows on each
  // pipeline card. Stored as { call, phone, time_in_stage, local_time, zip,
  // comments, notes_preview, source, email } booleans on profile.pipeline_card_fields.
  // null/missing = use defaults.
  const PIPELINE_CARD_DEFAULTS = {
    call: true, phone: true, time_in_stage: true, local_time: true,
    state: true, zip: true, comments: true, runner: true,
    notes_preview: false, campaign: false, email: false, received_date: false,
  }
  const pipelineCardFields = { ...PIPELINE_CARD_DEFAULTS, ...(profile?.pipeline_card_fields || {}) }
  const setPipelineCardFields = async (next) => {
    const uid = session?.user?.id
    if (!uid) return
    const merged = { ...pipelineCardFields, ...next }
    setProfile(p => p ? { ...p, pipeline_card_fields: merged } : p)
    try { await supabase.from('profiles').update({ pipeline_card_fields: merged }).eq('user_id', uid) } catch (e) { console.error('setPipelineCardFields failed:', e) }
  }

  // Split-notes preference — boolean on profiles. Persisted per-user.
  const splitNotes = !!profile?.split_notes
  const setSplitNotes = async (next) => {
    const uid = session?.user?.id
    if (!uid) return
    setProfile(p => p ? { ...p, split_notes: !!next } : p)
    try { await supabase.from('profiles').update({ split_notes: !!next }).eq('user_id', uid) } catch {}
  }

  // PitchPrfct workflow automation — per-agent rules, stored as JSONB on
  // profiles.pitchprfct_rules. The email Worker reads this live: when a new
  // lead lands, it scans the lead's marketplace comments for a rule keyword
  // and enrolls the lead into the matched PitchPrfct workflow (or the default).
  // Shape: { rules: [{ id, keyword, workflowId, workflowName }],
  //          defaultWorkflowId, defaultWorkflowName, delayMinutes }
  const PITCHPRFCT_RULES_DEFAULT = { rules: [], defaultWorkflowId: '', defaultWorkflowName: '', delayMinutes: 0 }
  const pitchprfctRules = (profile?.pitchprfct_rules && typeof profile.pitchprfct_rules === 'object')
    ? { ...PITCHPRFCT_RULES_DEFAULT, ...profile.pitchprfct_rules }
    : PITCHPRFCT_RULES_DEFAULT
  const savePitchprfctRules = async (next) => {
    const uid = session?.user?.id
    if (!uid) return { ok: false, error: 'Not signed in' }
    const clean = {
      rules: Array.isArray(next?.rules) ? next.rules : [],
      defaultWorkflowId: next?.defaultWorkflowId || '',
      defaultWorkflowName: next?.defaultWorkflowName || '',
      delayMinutes: Math.max(0, parseInt(next?.delayMinutes, 10) || 0),
    }
    setProfile(p => p ? { ...p, pitchprfct_rules: clean } : p)
    try {
      const { error } = await supabase.from('profiles').update({ pitchprfct_rules: clean }).eq('user_id', uid)
      if (error) { console.error('savePitchprfctRules failed:', error); return { ok: false, error: error.message } }
      return { ok: true }
    } catch (e) { console.error('savePitchprfctRules threw:', e); return { ok: false, error: String(e) } }
  }

  // PitchPrfct delay queue — leads waiting out their delay window before the
  // Worker enrolls them. Loaded as a { leadId: { id, enroll_at } } map so cards
  // can show a live countdown + Cancel button. Refreshed on a 60s poll.
  const [pitchQueue, setPitchQueue] = useState({})
  const refreshPitchQueue = async () => {
    if (!session?.user?.id) { setPitchQueue({}); return }
    try {
      const { data, error } = await supabase
        .from('pitchprfct_queue')
        .select('id, lead_id, enroll_at, status')
        .eq('status', 'pending')
      if (error) { console.error('[pitchQueue] load failed:', error); return }
      const map = {}
      for (const row of (data || [])) map[row.lead_id] = { id: row.id, enroll_at: row.enroll_at }
      setPitchQueue(map)
    } catch (e) { console.error('[pitchQueue] load threw:', e) }
  }
  const cancelPitchQueue = async (leadId) => {
    const row = pitchQueue[leadId]
    if (!row) return { ok: false, error: 'Not queued' }
    setPitchQueue(prev => { const n = { ...prev }; delete n[leadId]; return n })  // optimistic
    try {
      const { error } = await supabase
        .from('pitchprfct_queue')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) { console.error('[pitchQueue] cancel failed:', error); refreshPitchQueue(); return { ok: false, error: error.message } }
      return { ok: true }
    } catch (e) { console.error('[pitchQueue] cancel threw:', e); refreshPitchQueue(); return { ok: false, error: String(e) } }
  }
  useEffect(() => {
    if (!session?.user) { setPitchQueue({}); return }
    refreshPitchQueue()
    const iv = setInterval(refreshPitchQueue, 60000)
    return () => clearInterval(iv)
  }, [session?.user?.id])

  // Commission structure — per-agent JSONB on profiles. Stored shape:
  //   { default_advance, products: [{ key, name, comm_pct, advance_months, half, association }] }
  // For backwards compatibility, also accepts a legacy array of products.
  //
  // localStorage mirror: the `commission_presets` column may not exist yet on
  // every Supabase deployment. If the server update fails (404/no column/RLS),
  // we fall back to localStorage so the agent's structure still persists across
  // reloads on the same device — better than silently reverting to defaults.
  const COMM_LS_KEY = (uid) => `infinite_crm_commission_${uid}`
  const readLocalCommission = (uid) => {
    if (!uid) return null
    try { const v = localStorage.getItem(COMM_LS_KEY(uid)); return v ? JSON.parse(v) : null } catch { return null }
  }
  const writeLocalCommission = (uid, val) => {
    if (!uid) return
    try { localStorage.setItem(COMM_LS_KEY(uid), JSON.stringify(val)) } catch {}
  }
  const commissionPresets = profile?.commission_presets ?? readLocalCommission(session?.user?.id) ?? null
  const saveCommissionPresets = async (next) => {
    const uid = session?.user?.id
    if (!uid) return { ok: false, error: 'Not signed in' }
    // 1) Mirror locally first so even a server failure doesn't lose the user's work
    writeLocalCommission(uid, next)
    setProfile(p => p ? { ...p, commission_presets: next } : p)
    // 2) Try to persist to Supabase
    try {
      const { error } = await supabase.from('profiles').update({ commission_presets: next }).eq('user_id', uid)
      if (error) { console.error('saveCommissionPresets failed:', error); return { ok: false, error: error.message } }
      return { ok: true }
    } catch (e) {
      console.error('saveCommissionPresets exception:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  }

  // Commission entries — each saved deal. { id, user_id, customer_name, sold_at, items, totals }
  const [commissionEntries, setCommissionEntries] = useState([])
  const refreshCommissionEntries = async () => {
    if (!session?.user) return
    try {
      const { data } = await supabase.from('commission_entries').select('*').order('sold_at', { ascending: false })
      if (Array.isArray(data)) setCommissionEntries(data)
    } catch {}
  }
  useEffect(() => {
    if (!session?.user) { setCommissionEntries([]); return }
    refreshCommissionEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])
  const addCommissionEntry = async (entry) => {
    const uid = session?.user?.id
    if (!uid) return null
    const row = {
      user_id: uid,
      customer_name: entry.customer_name || null,
      sold_at: entry.sold_at || new Date().toISOString(),
      items: entry.items || [],
      totals: entry.totals || {},
    }
    try {
      const { data } = await supabase.from('commission_entries').insert([row]).select().single()
      if (data) { setCommissionEntries(prev => [data, ...prev]); return data }
    } catch (e) { console.error('addCommissionEntry failed:', e) }
    return null
  }
  const deleteCommissionEntry = async (id) => {
    setCommissionEntries(prev => prev.filter(e => e.id !== id))
    try { await supabase.from('commission_entries').delete().eq('id', id) } catch {}
  }

  // Lead reminders (Today page) — { id, user_id, lead_id, kind, due_at, note, done_at }
  const [reminders, setReminders] = useState([])
  const refreshReminders = async () => {
    if (!session?.user) return
    try {
      const { data } = await supabase.from('lead_reminders').select('*').order('due_at', { ascending: true })
      if (Array.isArray(data)) setReminders(data)
    } catch {}
  }
  useEffect(() => {
    if (!session?.user) { setReminders([]); return }
    refreshReminders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, profile?.role, profile?.lead_agent_id])

  const addReminder = async ({ lead_id, kind, due_at, note }) => {
    const uid = (profile?.role === 'runner' && profile?.lead_agent_id) ? profile.lead_agent_id : session?.user?.id
    if (!uid) return null
    const row = {
      user_id: uid,
      lead_id: lead_id || null,
      kind: kind || 'call',
      due_at: due_at || null,
      note: note || null,
    }
    try {
      const { data } = await supabase.from('lead_reminders').insert([row]).select().single()
      if (data) { setReminders(prev => [...prev, data].sort((a, b) => new Date(a.due_at || 0) - new Date(b.due_at || 0))); return data }
    } catch (e) { console.error('addReminder failed:', e) }
    return null
  }

  const completeReminder = async (id) => {
    const now = new Date().toISOString()
    setReminders(prev => prev.map(r => r.id === id ? { ...r, done_at: now } : r))
    try { await supabase.from('lead_reminders').update({ done_at: now }).eq('id', id) } catch {}
  }
  const uncompleteReminder = async (id) => {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, done_at: null } : r))
    try { await supabase.from('lead_reminders').update({ done_at: null }).eq('id', id) } catch {}
  }
  const snoozeReminder = async (id, due_at) => {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, due_at } : r))
    try { await supabase.from('lead_reminders').update({ due_at }).eq('id', id) } catch {}
  }
  const deleteReminder = async (id) => {
    setReminders(prev => prev.filter(r => r.id !== id))
    try { await supabase.from('lead_reminders').delete().eq('id', id) } catch {}
  }

  // Permission helpers for the 'runner' role — they work UNDER a specific
  // lead agent and see/edit that agent's leads but can't delete or admin.
  const isRunner = profile?.role === 'runner'
  const isAdmin = profile?.role === 'admin'
  const isAgent = !isRunner && !!profile  // admin or agent
  // The user_id whose leads we should be operating on. For runners this is
  // their lead_agent_id; for everyone else it's their own id.
  const effectiveAgentId = isRunner && profile?.lead_agent_id
    ? profile.lead_agent_id
    : session?.user?.id
  const can = {
    deleteLeads:      isAdmin || isAgent,
    addLeads:         isAdmin || isAgent,
    manageTags:       isAdmin,
    accessAdmin:      isAdmin,
    bulkActions:      isAdmin || isAgent,
    editLeads:        true,  // runners can edit notes, stage, etc.
  }

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
      addActivity, getLeadActivities, deleteActivity,
      dialsToday, refreshDialsToday,
      addTag, updateTag, deleteTag, reorderTags,
      // sold-prompt globals
      pendingSoldLeadId, setPendingSoldLeadId,
      // role + permission helpers
      isAdmin, isRunner, isAgent, can, effectiveAgentId,
      // user preferences
      splitNotes, setSplitNotes,
      commissionPresets, saveCommissionPresets,
      leadEmail,
      pipelineCardFields, setPipelineCardFields,
      sideTagStyles, setSideTagStyles,
      campaigns, saveCampaigns,
      pitchprfctRules, savePitchprfctRules,
      pitchQueue, refreshPitchQueue, cancelPitchQueue,
      // reminders (Today page)
      reminders, refreshReminders, addReminder, completeReminder, uncompleteReminder, snoozeReminder, deleteReminder,
      // commission entries (Calculator weekly tracker)
      commissionEntries, refreshCommissionEntries, addCommissionEntry, deleteCommissionEntry,
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
