import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://rgezxiouusvfutabpwkw.supabase.co'
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnZXp4aW91dXN2ZnV0YWJwd2t3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4ODk2ODYsImV4cCI6MjA5MTQ2NTY4Nn0.zY5H878qZiTrYK4dZ3Vb3NkzfojLlyMOfYsISOa2eKI'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Default tags (fallback if DB not loaded yet)
export const DEFAULT_TAGS = [
  { id: 'not-started', label: 'Not Started', color: '#8899AA', bg: '#1A2130' },
  { id: 'interested',  label: 'Interested',  color: '#10B981', bg: '#0A1F15' },
  { id: 'apt',         label: 'Apt',         color: '#3B82F6', bg: '#0A1525' },
  { id: 'ghosted',     label: 'Ghosted',     color: '#F97316', bg: '#1F1005' },
  { id: 'sold',        label: 'Sold',        color: '#00E5C3', bg: '#051F1A' },
  { id: 'aged',        label: 'Aged',        color: '#8B5CF6', bg: '#120F20' },
  { id: 'stop',        label: 'Stop',        color: '#EF4444', bg: '#200808' },
  { id: 'long-term',   label: 'Long Term',   color: '#F59E0B', bg: '#1F1505' },
]

// Demo leads for first load
export const DEMO_LEADS = []
export const DEMO_ACTIVITIES = {}
