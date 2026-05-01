import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Plus, Trash2, Check, X } from 'lucide-react'

const PRESET_COLORS = ['#00E5C3','#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#F97316','#EC4899','#14B8A6','#64748B','#8899AA','#A3E635']

function TagRow({ tag, onUpdate, onDelete, isDefault }) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(tag.label)
  const [color, setColor] = useState(tag.color)

  const save = () => {
    // auto-generate bg as darkened version of color
    const bg = color + '18'
    onUpdate(tag.id, { label, color, bg })
    setEditing(false)
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-[#1A2130] last:border-0">
      {editing ? (
        <div className="flex items-center gap-3 flex-1">
          <input value={label} onChange={e => setLabel(e.target.value)}
            className="bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#00E5C340] w-36" />
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)}
                className="w-5 h-5 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
                style={{ background: c }}>
                {color === c && <Check size={10} className="text-black" />}
              </button>
            ))}
          </div>
          <input type="color" value={color} onChange={e => setColor(e.target.value)}
            className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" title="Custom color" />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: tag.color }} />
          <span className="text-sm text-white">{tag.label}</span>
          <span className="text-xs px-2 py-0.5 rounded-full font-mono" style={{ background: tag.bg, color: tag.color, border: `1px solid ${tag.color}40` }}>
            preview
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 ml-4">
        {editing ? (
          <>
            <button onClick={save} className="p-1.5 rounded-lg text-[#00E5C3] hover:bg-[#00E5C315] transition-colors"><Check size={14} /></button>
            <button onClick={() => setEditing(false)} className="p-1.5 rounded-lg text-[#5A6A7A] hover:text-white transition-colors"><X size={14} /></button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="text-xs px-2 py-1 rounded border border-[#1A2130] text-[#5A6A7A] hover:text-white hover:border-[#2A3547] transition-colors">Edit</button>
            {!isDefault && (
              <button onClick={() => onDelete(tag.id)} className="p-1.5 rounded-lg text-[#3A4A5A] hover:text-[#EF4444] transition-colors"><Trash2 size={14} /></button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function Settings() {
  const { user, tags, addTag, updateTag, deleteTag } = useApp()
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState('#00E5C3')
  const [adding, setAdding] = useState(false)

  const handleAdd = () => {
    if (!newLabel.trim()) return
    addTag({ label: newLabel.trim(), color: newColor, bg: newColor + '18' })
    setNewLabel('')
    setNewColor('#00E5C3')
    setAdding(false)
  }

  return (
    <div className="p-6 max-w-2xl animate-fade-in space-y-6">
      <h1 className="text-xl font-display font-bold text-white">Settings</h1>

      {/* Profile */}
      <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0E1318' }}>
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A] mb-4">Profile</h2>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-black font-bold text-lg"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            {user?.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <p className="text-white font-semibold">{user?.name}</p>
            <p className="text-[#5A6A7A] text-sm">{user?.email}</p>
            <p className="text-[#5A6A7A] text-sm">{user?.agency} · Admin</p>
          </div>
        </div>
      </div>

      {/* Tags / Stages */}
      <div className="rounded-xl border border-[#1A2130] p-5" style={{ background: '#0E1318' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xs font-mono uppercase tracking-wider text-[#5A6A7A]">Lead Stages & Tags</h2>
            <p className="text-xs text-[#3A4A5A] mt-0.5">Customize colors and labels. These tag leads throughout the CRM.</p>
          </div>
          <button onClick={() => setAdding(!adding)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-black"
            style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
            <Plus size={13} /> Add Tag
          </button>
        </div>

        {/* Add new tag row */}
        {adding && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-[#00E5C320] mb-3" style={{ background: '#00E5C308' }}>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Tag name..."
              className="bg-[#080B0F] border border-[#1A2130] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#00E5C340] w-40" />
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setNewColor(c)}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
                  style={{ background: c }}>
                  {newColor === c && <Check size={10} className="text-black" />}
                </button>
              ))}
            </div>
            <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
            <button onClick={handleAdd}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-black"
              style={{ background: 'linear-gradient(135deg, #00E5C3, #3B82F6)' }}>
              Save
            </button>
            <button onClick={() => setAdding(false)} className="text-[#5A6A7A] hover:text-white"><X size={14} /></button>
          </div>
        )}

        <div>
          {tags.map((tag, i) => (
            <TagRow key={tag.id} tag={tag} onUpdate={updateTag} onDelete={deleteTag} isDefault={i < 8} />
          ))}
        </div>
      </div>
    </div>
  )
}
