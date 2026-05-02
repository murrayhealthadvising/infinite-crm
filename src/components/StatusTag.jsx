import { useApp } from '../context/AppContext'
import clsx from 'clsx'

// Accepts EITHER `stage` (legacy id like "interested") OR `status` (new label like "Interested")
// Also supports `small` boolean used by new Leads.jsx grid view
export default function StatusTag({ stage, status, size = 'sm', small, onClick }) {
  const { getTag } = useApp()
  const key = stage || status
  const tag = (typeof getTag === 'function' ? getTag(key) : null) || { id: 'not-started', label: status || 'Not Started', color: '#8899AA', bg: '#1A2130' }
  const effectiveSize = small ? 'sm' : size
  const safeColor = tag?.color || '#8899AA'
  const safeBg = tag?.bg || '#1A2130'
  const label = tag?.label || status || 'Not Started'
  return (
    <span onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full font-mono uppercase tracking-wider',
        effectiveSize === 'sm' && 'text-[10px] px-2 py-0.5',
        effectiveSize === 'md' && 'text-xs px-3 py-1',
        onClick && 'cursor-pointer hover:opacity-80 transition-opacity'
      )}
      style={{ background: safeBg, color: safeColor, border: `1px solid ${safeColor}40` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: safeColor }} />
      {label}
    </span>
  )
}
