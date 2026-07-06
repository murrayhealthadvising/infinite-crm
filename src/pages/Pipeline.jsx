import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import StatusTag from '../components/StatusTag'
import LeadDrawer from '../components/LeadDrawer'
import PitchCountdown from '../components/PitchCountdown'
import ManualEnrollButton from '../components/ManualEnrollButton'
import EmailButton from '../components/EmailButton'
import CalendlyButton from '../components/CalendlyButton'
import SoldBadge from '../components/SoldBadge'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { formatDistanceToNow, formatDistanceToNowStrict } from 'date-fns'
import { GripHorizontal, Phone, Search, X, RefreshCw, Copy, Check } from 'lucide-react'
import clsx from 'clsx'
import { displayPhone, copyPhoneValue } from '../lib/phone'
import { localTimeFor, localHourFor, timezoneFor } from '../lib/timezone'

// IANA → short TZ label for the filter pills (same map used on /leads)
const TZ_LABEL = {
  'America/New_York': 'EST', 'America/Detroit': 'EST', 'America/Indiana/Indianapolis': 'EST',
  'America/Chicago': 'CST',
  'America/Denver': 'MST', 'America/Boise': 'MST',
  'America/Phoenix': 'AZ',
  'America/Los_Angeles': 'PST',
  'America/Anchorage': 'AK',
  'Pacific/Honolulu': 'HI',
}
function tzShortFor(lead) { const tz = timezoneFor(lead); return tz ? (TZ_LABEL[tz] || null) : null }
const TZ_ORDER = ['EST','CST','MST','PST','AZ','AK','HI']

function safeRel(d) { if (!d) return ''; const dt = new Date(d); if (isNaN(dt.getTime())) return ''; try { return formatDistanceToNow(dt, { addSuffix: true }) } catch { return '' } }
// Strict "5d", "2h", "3mo" form for the time-in-stage badge
function shortAge(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  try {
    return formatDistanceToNowStrict(dt, { roundingMethod: 'floor' })
      .replace('seconds', 's').replace('second', 's')
      .replace('minutes', 'm').replace('minute', 'm')
      .replace('hours', 'h').replace('hour', 'h')
      .replace('days', 'd').replace('day', 'd')
      .replace('months', 'mo').replace('month', 'mo')
      .replace('years', 'y').replace('year', 'y')
      .replace(/\s+/g, '')
  } catch { return '' }
}
function leadName(lead) { if (lead?.name) return lead.name; return [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim() || '—' }
function leadInitials(lead) { const n = leadName(lead); if (n === '—' || !n) return '?'; const parts = n.trim().split(/\s+/).slice(0, 2); return parts.map(p => p[0]?.toUpperCase() || '').join('') || '?' }

// Rich dial-ready lead card. Always shows the full info — name, Call button,
// notes preview, comments chip, ZIP, time-in-stage, local time.
// Each agent toggles which fields appear via Settings → Pipeline cards.
function PipelineCard({ lead, onDragStart, onDragEnd, onClick }) {
  const { getTag, pipelineCardFields, addActivity, recentActivitiesByLead } = useApp()
  const fields = pipelineCardFields || {}
  // Log a dial when the card's Call button is clicked. 2-min per-card coalesce
  // so an accidental double-tap doesn't double-count.
  const lastCallRef = useRef(0)
  const logDial = () => {
    const now = Date.now()
    if (now - lastCallRef.current < 2 * 60 * 1000) return
    lastCallRef.current = now
    if (typeof addActivity === 'function') {
      addActivity(lead.id, 'call', `Called ${displayPhone(lead.phone) || lead.phone || ''}`.trim())
        .catch(e => console.error('[Pipeline] dial log failed', e))
    }
  }
  // Copy the bare 10-digit number (no +1) to clipboard
  const [phoneCopied, setPhoneCopied] = useState(false)
  const copyPhone = (e) => {
    e.stopPropagation()
    if (lead.phone) navigator.clipboard.writeText(copyPhoneValue(lead.phone))
    setPhoneCopied(true); setTimeout(() => setPhoneCopied(false), 1500)
  }
  const stage = (typeof getTag === 'function' ? getTag(lead.stage || lead.status) : null) || { color: '#5A6A7A' }
  const sColor = stage?.color || '#5A6A7A'
  const phoneVisible = displayPhone(lead.phone)
  const time = localTimeFor(lead)
  const hour = localHourFor(lead)
  const offHours = hour != null && (hour < 8 || hour >= 21)
  const inStageSince = lead.stage_changed_at || lead.created_at
  const inStage = shortAge(inStageSince)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="p-3 rounded-[12px] border cursor-pointer transition-all group hover:shadow-lg"
      style={{ background: '#080B0F', borderColor: sColor + '30' }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-[9999px] flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: sColor + '25', color: sColor }}>
            {leadInitials(lead)}
          </div>
          <p className="text-sm font-medium text-white group-hover:text-[#00E5C3] transition-colors truncate">{leadName(lead)}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {fields.time_in_stage !== false && inStage && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[4px]"
              style={{ background: sColor + '15', color: sColor, border: `1px solid ${sColor}40` }}
              title={`In ${stage.label || 'stage'} for ${inStage}`}>
              {inStage}
            </span>
          )}
          <ManualEnrollButton lead={lead} compact />
        </div>
      </div>

      <SoldBadge lead={lead} />
      <div className="mb-2 empty:hidden"><PitchCountdown leadId={lead.id} /></div>

      {fields.email && lead.email && (
        <p className="text-[11px] text-[#5A6A7A] truncate mb-1.5">{lead.email}</p>
      )}

      {fields.phone !== false && phoneVisible && (
        <div className="flex items-center gap-2 mb-2">
          {fields.call !== false && (
            <a href={`tel:${lead.phone}`} onClick={(e) => { e.stopPropagation(); logDial() }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-semibold text-black flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${sColor}, ${sColor}AA)` }}>
              <Phone size={11} /> Call
            </a>
          )}
          <span className="text-xs font-mono text-[#8899AA] truncate">{phoneVisible}</span>
          <button onClick={copyPhone}
            className="text-[#3A4A5A] hover:text-[#00E5C3] transition-colors flex-shrink-0"
            title="Copy phone number">
            {phoneCopied ? <Check size={12} className="text-[#00E5C3]" /> : <Copy size={12} />}
          </button>
        </div>
      )}

      {fields.notes_preview && lead.notes && (
        <p className="text-xs text-[#8899AA] mb-2 overflow-hidden"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.4 }}>
          {lead.notes}
        </p>
      )}
      {/* (Inline recent-actions panel removed from cards by request — same
          info is visible in the LeadDrawer that opens on card click.) */}

      <div className="flex items-center gap-1.5 flex-wrap">
        {fields.comments !== false && lead.comments && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] font-mono max-w-[140px] truncate"
            title={lead.comments}
            style={{ background: '#F59E0B15', color: '#F59E0B', border: '1px solid #F59E0B30' }}>
            {lead.comments}
          </span>
        )}
        {fields.campaign && lead.campaign && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] font-mono max-w-[140px] truncate"
            style={{ background: sColor + '15', color: sColor }}>
            {lead.campaign}
          </span>
        )}
        {fields.state !== false && lead.state && <span className="text-[10px] text-[#5A6A7A] font-mono">{lead.state}</span>}
        {fields.zip !== false && lead.zip && <span className="text-[10px] text-[#5A6A7A] font-mono">{lead.zip}</span>}
        {fields.received_date && lead.created_at && (
          <span className="text-[10px] text-[#5A6A7A] font-mono" title="Received date">
            {(() => { try { return formatDistanceToNowStrict(new Date(lead.created_at), { addSuffix: false }) + ' ago' } catch { return '' } })()}
          </span>
        )}
        {fields.local_time !== false && time && (
          <span className="text-[10px] font-mono ml-auto"
            style={{ color: offHours ? '#F59E0B' : '#3A4A5A' }}
            title={offHours ? 'Outside 8a–9p local time' : 'Local time'}>
            {time}
          </span>
        )}
      </div>
    </div>
  )
}

export default function Pipeline() {
  const { leads, tags, updateLeadStage, updateTag, refreshLeads, user, dialsToday } = useApp()
  const navigate = useNavigate()
  const [drawerLeadId, setDrawerLeadId] = useState(null)
  const [drawerBucket, setDrawerBucket] = useState([])  // ids of leads in the column the drawer was opened from
  const openDrawer = (leadId, bucketIds) => {
    setDrawerLeadId(leadId)
    setDrawerBucket(Array.isArray(bucketIds) ? bucketIds : [])
  }
  const [refreshing, setRefreshing] = useState(false)
  const doRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try { await refreshLeads?.() } catch {}
    setTimeout(() => setRefreshing(false), 400)
  }

  // Card-drag (lead → another stage) state
  const [dragLeadId, setDragLeadId] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)

  // Column-drag (reorder stages) state
  const [dragStageId, setDragStageId] = useState(null)
  const [dragOverStageCol, setDragOverStageCol] = useState(null)

  // Sort + filter
  const [sortBy, setSortBy] = useState('stage_newest')  // newest in stage first
  const [search, setSearch] = useState('')
  const [tagFilters, setTagFilters] = useState(() => new Set())
  const [tzFilters, setTzFilters] = useState(() => new Set())
  const [showFilters, setShowFilters] = useState(false)

  // Collapsed stage columns — persisted per-agent in localStorage so the
  // pipeline remembers which buckets you had compacted between sessions.
  const lsKey = 'pipeline:collapsed-stages:' + (user?.id || 'anon')
  const [collapsedStages, setCollapsedStages] = useState(() => {
    try {
      const raw = typeof localStorage !== 'undefined' && localStorage.getItem(lsKey)
      if (raw) return new Set(JSON.parse(raw))
    } catch {}
    return new Set()
  })
  useEffect(() => {
    try { localStorage.setItem(lsKey, JSON.stringify(Array.from(collapsedStages))) } catch {}
  }, [collapsedStages, lsKey])
  const toggleStageCollapse = (id) => setCollapsedStages(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const expandAll = () => setCollapsedStages(new Set())
  const collapseAll = () => {
    const sorted = [...(Array.isArray(tags) ? tags : [])]
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
    setCollapsedStages(new Set(sorted.map(t => t.id)))
  }

  // Scroll affordances
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const scrollRef = useRef(null)
  const autoScrollRAF = useRef(null)
  const autoScrollSpeedRef = useRef(0)

  // Click+drag empty bg to pan
  const panRef = useRef({ active: false, startX: 0, startScroll: 0 })

  const safeLeads = Array.isArray(leads) ? leads : []
  const safeTags = Array.isArray(tags) ? tags : []

  const sortedTags = [...safeTags].sort((a, b) => {
    const ao = a.sort_order ?? 999, bo = b.sort_order ?? 999
    if (ao !== bo) return ao - bo
    return (a.label || '').localeCompare(b.label || '')
  })

  // ── Scroll indicators ──
  const updateScrollIndicators = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    updateScrollIndicators()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateScrollIndicators)
    window.addEventListener('resize', updateScrollIndicators)
    return () => {
      el.removeEventListener('scroll', updateScrollIndicators)
      window.removeEventListener('resize', updateScrollIndicators)
    }
  }, [sortedTags.length, updateScrollIndicators])

  // ── Wheel → horizontal scroll ──
  // Translate vertical wheel deltas (mouse / trackpad) into horizontal kanban scroll.
  // Don't hijack when the cursor is inside a column's vertical scroller (so column
  // contents can still scroll up/down). We let the container itself handle wheel
  // and only convert when its own scroll dimension is horizontal.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = (e) => {
      // If the user is over a column's inner card list and that list has overflow
      // (i.e. the column is taller than viewport), let it scroll vertically.
      let t = e.target
      while (t && t !== el) {
        if (t.dataset?.colCards === '1') {
          const overflow = t.scrollHeight > t.clientHeight + 1
          if (overflow) return // let column take vertical wheel
          break
        }
        t = t.parentElement
      }
      // Otherwise convert vertical wheel to horizontal kanban scroll
      const delta = (Math.abs(e.deltaY) > Math.abs(e.deltaX)) ? e.deltaY : e.deltaX
      if (delta) {
        e.preventDefault()
        el.scrollLeft += delta
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // ── Click+drag empty background to pan-scroll ──
  const onPanMouseDown = (e) => {
    // Only start panning if user clicks on the container background, not a card/column
    if (e.target.closest('[data-kanban-col]') || e.target.closest('button') || e.target.closest('a')) return
    panRef.current = { active: true, startX: e.clientX, startScroll: scrollRef.current?.scrollLeft || 0 }
    if (scrollRef.current) scrollRef.current.style.cursor = 'grabbing'
  }
  useEffect(() => {
    const onMove = (e) => {
      if (!panRef.current.active) return
      const dx = e.clientX - panRef.current.startX
      if (scrollRef.current) scrollRef.current.scrollLeft = panRef.current.startScroll - dx
    }
    const onUp = () => {
      panRef.current.active = false
      if (scrollRef.current) scrollRef.current.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── Auto-scroll while dragging a card near edges ──
  const tickAutoScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || autoScrollSpeedRef.current === 0) { autoScrollRAF.current = null; return }
    el.scrollLeft += autoScrollSpeedRef.current
    autoScrollRAF.current = requestAnimationFrame(tickAutoScroll)
  }, [])
  const stopAutoScroll = useCallback(() => {
    autoScrollSpeedRef.current = 0
    if (autoScrollRAF.current) { cancelAnimationFrame(autoScrollRAF.current); autoScrollRAF.current = null }
  }, [])
  const handleContainerDragOver = (e) => {
    if (!dragLeadId && !dragStageId) return
    e.preventDefault()
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const EDGE = 100, MAX_SPEED = 24
    const leftDist = e.clientX - rect.left
    const rightDist = rect.right - e.clientX
    let speed = 0
    if (rightDist < EDGE) speed = ((EDGE - rightDist) / EDGE) * MAX_SPEED
    else if (leftDist < EDGE) speed = -((EDGE - leftDist) / EDGE) * MAX_SPEED
    autoScrollSpeedRef.current = speed
    if (speed !== 0 && !autoScrollRAF.current) autoScrollRAF.current = requestAnimationFrame(tickAutoScroll)
  }

  // ── Lead card drop onto a stage column ──
  const handleDrop = (stageId) => {
    stopAutoScroll()
    if (dragLeadId && typeof updateLeadStage === 'function') {
      updateLeadStage(dragLeadId, stageId)
    }
    setDragLeadId(null); setDragOverStage(null)
  }
  const handleDragEnd = () => { stopAutoScroll(); setDragLeadId(null); setDragOverStage(null) }

  // ── Stage column reorder ──
  const handleColumnDragStart = (e, stageId) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('stageId', stageId)
    setDragStageId(stageId)
  }
  const handleColumnDragOver = (e, stageId) => {
    if (!dragStageId || dragStageId === stageId) return
    e.preventDefault()
    setDragOverStageCol(stageId)
  }
  const handleColumnDrop = async (e, targetStageId) => {
    e.preventDefault(); e.stopPropagation()
    stopAutoScroll()
    const sourceId = dragStageId
    setDragStageId(null); setDragOverStageCol(null)
    if (!sourceId || sourceId === targetStageId || typeof updateTag !== 'function') return

    // Compute new sort_orders. Move source to occupy target's slot, shift others.
    const ordered = [...sortedTags]
    const srcIdx = ordered.findIndex(t => t.id === sourceId)
    const tgtIdx = ordered.findIndex(t => t.id === targetStageId)
    if (srcIdx < 0 || tgtIdx < 0) return
    const [moved] = ordered.splice(srcIdx, 1)
    ordered.splice(tgtIdx, 0, moved)
    // Persist updated sort_order for each tag whose position changed
    await Promise.all(ordered.map((t, i) => (t.sort_order !== i ? updateTag(t.id, { sort_order: i }) : Promise.resolve())))
  }

  // Annualized book = sum of premium × 12 for SOLD leads only. Hides for new
  // agents who haven't closed yet, and stops counting unsold pipeline as if
  // it were income.
  const totalValue = safeLeads
    .filter(l => l.stage === 'sold' && l.premium)
    .reduce((sum, l) => sum + (Number(l.premium) || 0) * 12, 0)

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {(() => {
        // Build the side-tag + TZ option lists once per render (depend on leads)
        const tagCounts = (() => {
          const m = new Map()
          for (const l of safeLeads) for (const t of (Array.isArray(l.tags) ? l.tags : [])) {
            if (!t || t === 'starred') continue
            m.set(t, (m.get(t) || 0) + 1)
          }
          return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
        })()
        const tzCounts = (() => {
          const m = new Map()
          for (const l of safeLeads) { const z = tzShortFor(l); if (z) m.set(z, (m.get(z) || 0) + 1) }
          return m
        })()
        const tzVisible = TZ_ORDER.filter(z => tzCounts.has(z))
        const activeCount = (search ? 1 : 0) + tagFilters.size + tzFilters.size
        return (
      <div className="border-b border-[#1A2130]">
        <div className="flex items-center justify-between px-6 py-4 gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-display font-bold text-white">Pipeline</h1>
            <p className="text-xs text-[#5A6A7A] mt-0.5 truncate">{safeLeads.length} leads · click a card to work it · drag to move between buckets</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A6A7A]" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search name, phone, tag…"
                className="bg-[#0E1318] border border-[#1A2130] rounded-[8px] pl-8 pr-7 py-1.5 text-xs text-white placeholder-[#3A4A5A] focus:outline-none focus:border-[#00E5C340] w-56" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#5A6A7A] hover:text-white">
                  <X size={11} />
                </button>
              )}
            </div>
            {/* Sort dropdown */}
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="bg-[#0E1318] border border-[#1A2130] rounded-[8px] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#00E5C340]">
              <option value="stage_newest">Newest in stage</option>
              <option value="stage_oldest">Oldest in stage</option>
              <option value="created_newest">Newest lead</option>
              <option value="created_oldest">Oldest lead</option>
              <option value="name_asc">Name A→Z</option>
              <option value="price_desc">Highest cost first</option>
              <option value="campaign_asc">Campaign A→Z</option>
            </select>
            {/* Filters toggle */}
            <button onClick={() => setShowFilters(v => !v)}
              className="px-2.5 py-1.5 rounded-[8px] text-xs border transition-colors"
              style={activeCount > 0
                ? { background: '#A78BFA15', color: '#A78BFA', borderColor: '#A78BFA60' }
                : { color: '#8899AA', borderColor: '#1A2130' }}>
              Filters{activeCount > 0 ? ` (${activeCount})` : ''}
            </button>
            {/* Collapse/Expand all stages */}
            <button onClick={() => collapsedStages.size === sortedTags.length ? expandAll() : collapseAll()}
              className="px-2.5 py-1.5 rounded-[8px] text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547] transition-colors"
              title={collapsedStages.size === sortedTags.length ? 'Expand all stages' : 'Collapse all stages'}>
              {collapsedStages.size === sortedTags.length ? 'Expand all' : 'Collapse all'}
            </button>
            {/* Refresh — pulls latest leads without reloading the page */}
            <button onClick={doRefresh}
              disabled={refreshing}
              className="p-1.5 rounded-[8px] border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547] transition-colors disabled:opacity-50"
              title="Refresh leads">
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
            {/* Daily dial tracker — counts every Call click today, resets at midnight */}
            <div className="text-right pl-3 border-l border-[#1A2130]" title="Dials you've made today (resets at midnight)">
              <p className="text-[10px] text-[#5A6A7A] font-mono uppercase tracking-wider">Dials today</p>
              <p className="text-sm font-display font-bold flex items-center justify-end gap-1"
                style={{ color: dialsToday > 0 ? '#00E5C3' : '#5A6A7A' }}>
                <Phone size={11} /> {dialsToday}
              </p>
            </div>
            {totalValue > 0 && (
              <div className="text-right pl-3 border-l border-[#1A2130]" title="Annualized premium of your sold leads">
                <p className="text-[10px] text-[#5A6A7A] font-mono uppercase tracking-wider">Sold annual</p>
                <p className="text-sm font-display font-bold text-[#00E5C3]">${totalValue.toLocaleString()}</p>
              </div>
            )}
          </div>
        </div>

        {/* Collapsible filter strip — side tags + time zones */}
        {showFilters && (
          <div className="px-6 pb-3 space-y-2">
            {tagCounts.length > 0 && (
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#3A4A5A] mr-1">Side tags</span>
                {tagCounts.map(([t, count]) => {
                  const active = tagFilters.has(t)
                  return (
                    <button key={t}
                      onClick={() => setTagFilters(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })}
                      className="px-2.5 py-1 rounded-[9999px] text-xs font-mono"
                      style={active
                        ? { background: '#A78BFA15', color: '#A78BFA', border: '1px solid #A78BFA60' }
                        : { color: '#5A6A7A', border: '1px solid #1A2130' }}>
                      #{t} <span className="opacity-60">({count})</span>
                    </button>
                  )
                })}
                {tagFilters.size > 0 && (
                  <button onClick={() => setTagFilters(new Set())}
                    className="text-[10px] text-[#5A6A7A] hover:text-white px-1">clear</button>
                )}
              </div>
            )}
            {tzVisible.length > 0 && (
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#3A4A5A] mr-1">Time zones</span>
                {tzVisible.map(z => {
                  const active = tzFilters.has(z)
                  return (
                    <button key={z}
                      onClick={() => setTzFilters(prev => { const n = new Set(prev); n.has(z) ? n.delete(z) : n.add(z); return n })}
                      className="px-2.5 py-1 rounded-[9999px] text-xs font-mono"
                      style={active
                        ? { background: '#22D3EE15', color: '#22D3EE', border: '1px solid #22D3EE60' }
                        : { color: '#5A6A7A', border: '1px solid #1A2130' }}>
                      {z} <span className="opacity-60">({tzCounts.get(z)})</span>
                    </button>
                  )
                })}
                {tzFilters.size > 0 && (
                  <button onClick={() => setTzFilters(new Set())}
                    className="text-[10px] text-[#5A6A7A] hover:text-white px-1">clear</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
        )
      })()}

      <div className="flex-1 relative overflow-hidden">
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-x-auto overflow-y-hidden p-6"
          style={{ cursor: 'grab' }}
          onMouseDown={onPanMouseDown}
          onDragOver={handleContainerDragOver}
        >
          <div className="flex gap-4 h-full" style={{ minWidth: 'max-content', minHeight: 'calc(100vh - 200px)' }}>
            {sortedTags.map(stage => {
              // Build this column: in-stage leads → search → tag/TZ filters → sort
              const inStage = safeLeads.filter(l => l.stage === stage.id || (l.status && (l.status.toLowerCase() === (stage.label || '').toLowerCase())))
              const q = search.trim().toLowerCase()
              const stageLeads = inStage
                .filter(l => {
                  if (q) {
                    const name = [l.first_name, l.last_name, l.name].filter(Boolean).join(' ')
                    const haystack = `${name} ${l.phone || ''} ${l.email || ''} ${l.state || ''} ${l.zip || ''} ${l.city || ''} ${l.comments || ''} ${(l.tags || []).join(' ')}`.toLowerCase()
                    if (!haystack.includes(q)) return false
                  }
                  if (tagFilters.size > 0) {
                    if (!Array.isArray(l.tags) || !Array.from(tagFilters).every(t => l.tags.includes(t))) return false
                  }
                  if (tzFilters.size > 0 && !tzFilters.has(tzShortFor(l))) return false
                  return true
                })
                .sort((a, b) => {
                  const tin = (l) => new Date(l.stage_changed_at || l.created_at || 0).getTime() || 0
                  const tcr = (l) => new Date(l.created_at || 0).getTime() || 0
                  const nm  = (l) => [l.first_name, l.last_name, l.name].filter(Boolean).join(' ').toLowerCase()
                  switch (sortBy) {
                    case 'stage_oldest': return tin(a) - tin(b)
                    case 'created_newest': return tcr(b) - tcr(a)
                    case 'created_oldest': return tcr(a) - tcr(b)
                    case 'name_asc': return nm(a).localeCompare(nm(b))
                    case 'price_desc': return (Number(b.price) || 0) - (Number(a.price) || 0)
                    case 'campaign_asc': return String(a.campaign || a.source || '').toLowerCase().localeCompare(String(b.campaign || b.source || '').toLowerCase())
                    case 'stage_newest':
                    default: return tin(b) - tin(a)  // newest in stage first
                  }
                })
              const isCardDragOver = dragOverStage === stage.id && !dragStageId
              const isColTargetOver = dragOverStageCol === stage.id
              const isCollapsed = collapsedStages.has(stage.id)

              // SKINNY: just a narrow strip showing the stage name + count.
              // Click toggles expand. Drag still reorders (HTML5 drag fires
              // on movement, click only on stationary mouseup).
              if (isCollapsed) {
                return (
                  <div key={stage.id}
                    data-kanban-col="1"
                    draggable
                    onDragStart={e => handleColumnDragStart(e, stage.id)}
                    onDragEnd={() => { setDragStageId(null); setDragOverStageCol(null); stopAutoScroll() }}
                    onDragOver={e => {
                      e.preventDefault()
                      if (dragStageId) handleColumnDragOver(e, stage.id)
                      else if (dragLeadId) setDragOverStage(stage.id)
                    }}
                    onDragLeave={() => { setDragOverStage(null); setDragOverStageCol(null) }}
                    onDrop={(e) => {
                      if (dragStageId) handleColumnDrop(e, stage.id)
                      else handleDrop(stage.id)
                    }}
                    className={clsx('flex flex-col rounded-[12px] border w-12 flex-shrink-0 transition-all overflow-hidden',
                      isColTargetOver && 'ring-2 ring-[#00E5C3]'
                    )}
                    style={{
                      background: isCardDragOver ? stage.color + '12' : '#0E1318',
                      borderColor: isCardDragOver ? stage.color : '#1A2130',
                      minHeight: '400px',
                      cursor: 'grab',
                    }}
                    onClick={() => toggleStageCollapse(stage.id)}
                    title={`${stage.label} · ${stageLeads.length} — click to expand`}>
                    <div className="flex flex-col items-center gap-2 py-3 flex-1">
                      <div className="w-2.5 h-2.5 rounded-[9999px] flex-shrink-0" style={{ background: stage.color }} />
                      <span className="text-xs font-mono text-white bg-[#1A2130] px-2 py-0.5 rounded-[9999px] flex-shrink-0">
                        {stageLeads.length}
                      </span>
                      {/* Vertical stage label */}
                      <span className="text-[10px] font-mono uppercase tracking-wider mt-1 select-none"
                        style={{
                          color: stage.color,
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          letterSpacing: '0.15em',
                        }}>
                        {stage.label}
                      </span>
                    </div>
                  </div>
                )
              }

              // EXPANDED: full kanban column with cards
              return (
                <div key={stage.id}
                  data-kanban-col="1"
                  className={clsx('flex flex-col rounded-[12px] border w-80 flex-shrink-0 transition-all',
                    isCardDragOver ? 'border-opacity-100' : 'border-[#1A2130]',
                    isColTargetOver && 'ring-2 ring-[#00E5C3]'
                  )}
                  style={{ background: isCardDragOver ? stage.color + '08' : '#0E1318', borderColor: isCardDragOver ? stage.color : undefined, minHeight: '400px' }}
                  onDragOver={e => {
                    e.preventDefault()
                    if (dragStageId) handleColumnDragOver(e, stage.id)
                    else if (dragLeadId) setDragOverStage(stage.id)
                  }}
                  onDragLeave={() => { setDragOverStage(null); setDragOverStageCol(null) }}
                  onDrop={(e) => {
                    if (dragStageId) handleColumnDrop(e, stage.id)
                    else handleDrop(stage.id)
                  }}>
                  {/* Column header — draggable for reorder, click to collapse */}
                  <div
                    draggable
                    onDragStart={e => handleColumnDragStart(e, stage.id)}
                    onDragEnd={() => { setDragStageId(null); setDragOverStageCol(null); stopAutoScroll() }}
                    onClick={() => toggleStageCollapse(stage.id)}
                    className="flex items-center justify-between px-4 py-3.5 border-b border-[#1A2130] cursor-grab active:cursor-grabbing select-none"
                    title="Drag to reorder · click to collapse">
                    <div className="flex items-center gap-2">
                      <GripHorizontal size={12} className="text-[#3A4A5A] flex-shrink-0" />
                      <div className="w-2.5 h-2.5 rounded-[9999px]" style={{ background: stage.color }} />
                      <span className="text-xs font-mono uppercase tracking-wider" style={{ color: stage.color }}>{stage.label}</span>
                    </div>
                    <span className="text-xs font-mono text-white bg-[#1A2130] px-2 py-0.5 rounded-[9999px]">{stageLeads.length}</span>
                  </div>
                  {/* Cards (vertical scroll) */}
                  <div data-col-cards="1" className="flex-1 overflow-y-auto p-3 space-y-2">
                    {stageLeads.map(lead => (
                      <PipelineCard key={lead.id} lead={lead}
                        onDragStart={e => { e.dataTransfer.setData('leadId', lead.id); e.dataTransfer.effectAllowed = 'move'; setDragLeadId(lead.id) }}
                        onDragEnd={handleDragEnd}
                        onClick={() => openDrawer(lead.id, stageLeads.map(l => l.id))} />
                    ))}
                    {stageLeads.length === 0 && (
                      <div className={clsx('flex items-center justify-center h-16 border border-dashed rounded-[8px] transition-colors', isCardDragOver ? 'border-opacity-60' : 'border-[#1A2130]')}
                        style={{ borderColor: isCardDragOver ? stage.color : undefined }}>
                        <p className="text-xs" style={{ color: isCardDragOver ? stage.color : '#3A4A5A' }}>
                          {isCardDragOver ? 'Drop here' : 'Empty'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Edge fades */}
        {canScrollLeft && (
          <div className="pointer-events-none absolute top-0 bottom-0 left-0 w-12"
            style={{ background: 'linear-gradient(to right, #080B0F, transparent)' }} />
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute top-0 bottom-0 right-0 w-12"
            style={{ background: 'linear-gradient(to left, #080B0F, transparent)' }} />
        )}
        {canScrollLeft && (
          <button
            onClick={() => scrollRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
            className="absolute top-1/2 left-2 -translate-y-1/2 w-9 h-9 rounded-[9999px] bg-[#0E1318] border border-[#2A3547] text-[#8899AA] hover:text-white hover:bg-[#1A2130] flex items-center justify-center transition-colors z-10 shadow-lg"
            title="Scroll left">‹</button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scrollRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
            className="absolute top-1/2 right-2 -translate-y-1/2 w-9 h-9 rounded-[9999px] bg-[#0E1318] border border-[#2A3547] text-[#8899AA] hover:text-white hover:bg-[#1A2130] flex items-center justify-center transition-colors z-10 shadow-lg"
            title="Scroll right">›</button>
        )}
      </div>

      {/* Right-side drawer for working a lead without leaving the pipeline */}
      {drawerLeadId && (
        <LeadDrawer leadId={drawerLeadId}
          bucket={drawerBucket}
          onNavigate={(id) => setDrawerLeadId(id)}
          onClose={() => setDrawerLeadId(null)} />
      )}
    </div>
  )
}
