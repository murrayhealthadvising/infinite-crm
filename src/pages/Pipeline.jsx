import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import StatusTag from '../components/StatusTag'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import clsx from 'clsx'

function PipelineCard({ lead, onDragStart, onClick }) {
  const { getTag } = useApp()
  const stage = getTag(lead.stage)
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="p-3.5 rounded-xl border border-[#1A2130] hover:border-[#2A3547] cursor-pointer transition-all group hover:shadow-lg"
      style={{ background: '#080B0F' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: stage.color + '25', color: stage.color }}>
            {lead.first_name[0]}{lead.last_name[0]}
          </div>
          <p className="text-sm font-medium text-white group-hover:text-[#00E5C3] transition-colors">{lead.first_name} {lead.last_name}</p>
        </div>
      </div>
      <p className="text-xs text-[#5A6A7A] font-mono mb-1">{lead.phone}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-[#3A4A5A]">{lead.state} · {lead.source}</span>
        <span className="text-[10px] text-[#3A4A5A]">{formatDistanceToNow(new Date(lead.last_activity), { addSuffix: true })}</span>
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
  const { leads, tags, updateLeadStage } = useApp()
  const navigate = useNavigate()
  const [dragLeadId, setDragLeadId] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)

  const handleDrop = (stageId) => {
    if (dragLeadId) { updateLeadStage(dragLeadId, stageId); setDragLeadId(null); setDragOverStage(null) }
  }

  const totalValue = leads.filter(l => l.premium).reduce((sum, l) => sum + (l.premium * 12), 0)

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2130]">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Pipeline</h1>
          <p className="text-xs text-[#5A6A7A] mt-0.5">{leads.length} leads · drag cards to move stages</p>
        </div>
        {totalValue > 0 && (
          <div className="text-right">
            <p className="text-xs text-[#5A6A7A] font-mono uppercase tracking-wider">Annual Value</p>
            <p className="text-lg font-display font-bold text-[#00E5C3]">${totalValue.toLocaleString()}</p>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-4" style={{ minWidth: 'max-content', minHeight: 'calc(100vh - 160px)' }}>
          {tags.map(stage => {
            const stageLeads = leads.filter(l => l.stage === stage.id)
            const isDragOver = dragOverStage === stage.id
            return (
              <div key={stage.id}
                className={clsx('flex flex-col rounded-xl border w-64 transition-all', isDragOver ? 'border-opacity-100' : 'border-[#1A2130]')}
                style={{ background: isDragOver ? stage.color + '08' : '#0E1318', borderColor: isDragOver ? stage.color : undefined, minHeight: '400px' }}
                onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id) }}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={() => handleDrop(stage.id)}>
                {/* Column header */}
                <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#1A2130]">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                    <span className="text-xs font-mono uppercase tracking-wider" style={{ color: stage.color }}>{stage.label}</span>
                  </div>
                  <span className="text-xs font-mono text-white bg-[#1A2130] px-2 py-0.5 rounded-full">{stageLeads.length}</span>
                </div>
                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {stageLeads.map(lead => (
                    <PipelineCard key={lead.id} lead={lead}
                      onDragStart={e => { e.dataTransfer.setData('leadId', lead.id); setDragLeadId(lead.id) }}
                      onClick={() => navigate(`/leads/${lead.id}`)} />
                  ))}
                  {stageLeads.length === 0 && (
                    <div className={clsx('flex items-center justify-center h-16 border border-dashed rounded-lg transition-colors', isDragOver ? 'border-opacity-60' : 'border-[#1A2130]')}
                      style={{ borderColor: isDragOver ? stage.color : undefined }}>
                      <p className="text-xs" style={{ color: isDragOver ? stage.color : '#3A4A5A' }}>
                        {isDragOver ? 'Drop here' : 'Empty'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
