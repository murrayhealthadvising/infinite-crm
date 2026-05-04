import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import StatusTag from '../components/StatusTag'
import { useState, useRef, useEffect, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { GripHorizontal } from 'lucide-react'
import clsx from 'clsx'

function safeRel(d) { if (!d) return ''; const dt = new Date(d); if (isNaN(dt.getTime())) return ''; try { return formatDistanceToNow(dt, { addSuffix: true }) } catch { return '' } }
function leadName(lead) { if (lead?.name) return lead.name; return [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim() || '—' }
function leadInitials(lead) { const n = leadName(lead); if (n === '—' || !n) return '?'; const parts = n.trim().split(/\s+/).slice(0, 2); return parts.map(p => p[0]?.toUpperCase() || '').join('') || '?' }

function PipelineCard({ lead, onDragStart, onDragEnd, onClick }) {
  const { getTag } = useApp()
  const stage = (typeof getTag === 'function' ? getTag(lead.stage || lead.status) : null) || { color: '#5A6A7A' }
  const sColor = stage?.color || '#5A6A7A'
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="p-3.5 rounded-xl border border-[#1A2130] hover:border-[#2A3547] cursor-pointer transition-all group hover:shadow-lg"
      style={{ background: '#080B0F' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: sColor + '25', color: sColor }}>
            {leadInitials(lead)}
          </div>
          <p className="text-sm font-medium text-white group-hover:text-[#00E5C3] transition-colors">{leadName(lead)}</p>
        </div>
      </div>
      <p className="text-xs text-[#5A6A7A] font-mono mb-1">{lead.phone}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-[#3A4A5A]">{[lead.state, lead.campaign || lead.source].filter(Boolean).join(' · ') || '—'}</span>
        <span className="text-[10px] text-[#3A4A5A]">{safeRel(lead.last_activity || lead.created_at)}</span>
      </div>
      {lead.premium && (
        <div className="mt-2 pt-2 border-t border-[#1A2130] flex items-center justify-between">
          <span className="text-[10px] text-[#5A6A7A]">{lead.carrier}</span>
          <span className="text-xs font-mono text-[#00E5C3]">${lead.premium}/mo</span>
        </div>
      )}
    </div>
  )
}

export default function Pipeline() {
  const { leads, tags, updateLeadStage, updateTag } = useApp()
  const navigate = useNavigate()

  // Card-drag (lead → another stage) state
  const [dragLeadId, setDragLeadId] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)

  // Column-drag (reorder stages) state
  const [dragStageId, setDragStageId] = useState(null)
  const [dragOverStageCol, setDragOverStageCol] = useState(null)

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

  const totalValue = safeLeads.filter(l => l.premium).reduce((sum, l) => sum + (Number(l.premium) || 0) * 12, 0)

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130]">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Pipeline</h1>
          <p className="text-xs text-[#5A6A7A] mt-0.5">{safeLeads.length} leads · scroll wheel pans · drag column header to reorder</p>
        </div>
        {totalValue > 0 && (
          <div className="text-right">
            <p className="text-xs text-[#5A6A7A] font-mono uppercase tracking-wider">Annual Value</p>
            <p className="text-lg font-display font-bold text-[#00E5C3]">${totalValue.toLocaleString()}</p>
          </div>
        )}
      </div>

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
              const stageLeads = safeLeads.filter(l => l.stage === stage.id || (l.status && (l.status.toLowerCase() === (stage.label || '').toLowerCase())))
              const isCardDragOver = dragOverStage === stage.id && !dragStageId
              const isColTargetOver = dragOverStageCol === stage.id
              return (
                <div key={stage.id}
                  data-kanban-col="1"
                  className={clsx('flex flex-col rounded-xl border w-64 flex-shrink-0 transition-all',
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
                  {/* Column header — itself draggable for reorder */}
                  <div
                    draggable
                    onDragStart={e => handleColumnDragStart(e, stage.id)}
                    onDragEnd={() => { setDragStageId(null); setDragOverStageCol(null); stopAutoScroll() }}
                    className="flex items-center justify-between px-4 py-3.5 border-b border-[#1A2130] cursor-grab active:cursor-grabbing select-none"
                    title="Drag to reorder this stage">
                    <div className="flex items-center gap-2">
                      <GripHorizontal size={12} className="text-[#3A4A5A] flex-shrink-0" />
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                      <span className="text-xs font-mono uppercase tracking-wider" style={{ color: stage.color }}>{stage.label}</span>
                    </div>
                    <span className="text-xs font-mono text-white bg-[#1A2130] px-2 py-0.5 rounded-full">{stageLeads.length}</span>
                  </div>
                  {/* Cards (vertical scroll) */}
                  <div data-col-cards="1" className="flex-1 overflow-y-auto p-3 space-y-2">
                    {stageLeads.map(lead => (
                      <PipelineCard key={lead.id} lead={lead}
                        onDragStart={e => { e.dataTransfer.setData('leadId', lead.id); e.dataTransfer.effectAllowed = 'move'; setDragLeadId(lead.id) }}
                        onDragEnd={handleDragEnd}
                        onClick={() => navigate(`/leads/${lead.id}`)} />
                    ))}
                    {stageLeads.length === 0 && (
                      <div className={clsx('flex items-center justify-center h-16 border border-dashed rounded-lg transition-colors', isCardDragOver ? 'border-opacity-60' : 'border-[#1A2130]')}
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
            className="absolute top-1/2 left-2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#0E1318] border border-[#2A3547] text-[#8899AA] hover:text-white hover:bg-[#1A2130] flex items-center justify-center transition-colors z-10 shadow-lg"
            title="Scroll left">‹</button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scrollRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
            className="absolute top-1/2 right-2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#0E1318] border border-[#2A3547] text-[#8899AA] hover:text-white hover:bg-[#1A2130] flex items-center justify-center transition-colors z-10 shadow-lg"
            title="Scroll right">›</button>
        )}
      </div>
    </div>
  )
}
