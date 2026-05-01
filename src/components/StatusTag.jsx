import { useApp } from '../context/AppContext'
import clsx from 'clsx'

export default function StatusTag({ stage, size = 'sm', onClick }) {
  const { getTag } = useApp()
  const tag = getTag(stage)
  return (
    <span onClick={onClick}
      className={clsx('inline-flex items-center gap-1 rounded-full font-mono uppercase tracking-wider', size === 'sm' && 'text-[10px] px-2 py-0.5', size === 'md' && 'text-xs px-3 py-1', onClick && 'cursor-pointer hover:opacity-80 transition-opacity')}
      style={{ background: tag.bg, color: tag.color, border: `1px solid ${tag.color}40` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: tag.color }} />
      {tag.label}
    </span>
  )
}
