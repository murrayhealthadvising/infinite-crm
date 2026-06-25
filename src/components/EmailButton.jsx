import { useState } from 'react'
import { Mail } from 'lucide-react'
import ComposeEmailModal from './ComposeEmailModal'

// Small Email button that owns its own compose-modal state. Drop it next to
// the Call button on Pipeline / Leads cards — clicking opens a modal that
// sends via Gmail and auto-logs an activity row. Renders nothing if the lead
// has no email address.
//
// Props:
//   lead     — the lead object (used for id + email)
//   variant  — 'icon' for icon-only (cards), 'pill' for labeled pill (detail)
//   size     — 'sm' (default) or 'md'
//   onClick  — optional extra click handler (e.g. stopPropagation on cards
//              so the card's own click doesn't navigate)
export default function EmailButton({ lead, variant = 'icon', size = 'sm', onClick }) {
  const [open, setOpen] = useState(false)
  if (!lead?.email) return null

  const handleOpen = (e) => {
    if (e) { e.stopPropagation(); e.preventDefault() }
    if (onClick) onClick(e)
    setOpen(true)
  }

  const baseStyle = { background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)' }
  const iconSize = size === 'md' ? 13 : 11

  return (
    <>
      {variant === 'icon' ? (
        <button onClick={handleOpen}
          title={`Email ${lead.email}`}
          className={`inline-flex items-center justify-center rounded-[8px] text-white flex-shrink-0 transition-opacity hover:opacity-90 ${size === 'md' ? 'w-8 h-8' : 'w-7 h-7'}`}
          style={baseStyle}>
          <Mail size={iconSize} />
        </button>
      ) : (
        <button onClick={handleOpen}
          title={`Email ${lead.email}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-semibold text-white flex-shrink-0 transition-opacity hover:opacity-90"
          style={baseStyle}>
          <Mail size={iconSize} /> Email
        </button>
      )}
      {open && (
        <ComposeEmailModal leadId={lead.id} to={lead.email}
          onClose={() => setOpen(false)} />
      )}
    </>
  )
}
