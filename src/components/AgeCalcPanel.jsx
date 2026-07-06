import { useState, useEffect, useRef } from 'react'
import { Calculator, X, ArrowRight, RotateCcw } from 'lucide-react'

// Slide-in right panel with two tools:
//   1) Age → approximate DOB (year they were born, plus quick birth-year
//      picker so the agent can copy MM/DD/YYYY into the DOB field).
//   2) Standard 4-function calculator so the agent doesn't have to alt-tab
//      to macOS Calculator during a call.
//
// Toggle from the sidebar footer. Position: fixed right, escapes any
// container overflow. Keeps state between opens.
export default function AgeCalcPanel({ open, onClose }) {
  const [tab, setTab] = useState('age')  // 'age' | 'calc'
  const overlayRef = useRef(null)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {/* Backdrop — dim click-outside catcher */}
      <div ref={overlayRef}
        onClick={onClose}
        className="absolute inset-0 pointer-events-auto"
        style={{ background: 'rgba(0,0,0,0.35)' }} />
      {/* Panel */}
      <aside
        className="absolute right-0 top-0 bottom-0 w-full sm:w-[320px] flex flex-col shadow-2xl pointer-events-auto"
        style={{ background: '#0E1318', borderLeft: '1px solid #1A2130' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1A2130]">
          <div className="flex items-center gap-2">
            <Calculator size={14} className="text-[#00E5C3]" />
            <span className="text-xs font-mono uppercase tracking-wider text-white">Calc</span>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded text-[#5A6A7A] hover:text-white hover:bg-[#1A2130]"
            title="Close (Esc)">
            <X size={14} />
          </button>
        </div>

        <div className="flex border-b border-[#1A2130]">
          <button onClick={() => setTab('age')}
            className={`flex-1 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
              tab === 'age' ? 'text-[#00E5C3] border-b-2 border-[#00E5C3]' : 'text-[#5A6A7A] hover:text-white'
            }`}>
            Age → DOB
          </button>
          <button onClick={() => setTab('calc')}
            className={`flex-1 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
              tab === 'calc' ? 'text-[#00E5C3] border-b-2 border-[#00E5C3]' : 'text-[#5A6A7A] hover:text-white'
            }`}>
            Calculator
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'age' ? <AgeToDobTab /> : <StandardCalcTab />}
        </div>
      </aside>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Age → DOB tab
// ─────────────────────────────────────────────────────────────────────────────
function AgeToDobTab() {
  const [age, setAge] = useState('')
  const thisYear = new Date().getFullYear()
  const today = new Date()
  const parsed = parseInt(String(age).replace(/\D/g, ''), 10)
  const valid = isFinite(parsed) && parsed >= 0 && parsed <= 120
  // A person who is `age` right now was born EITHER `thisYear - age` (if their
  // birthday has already happened this year) OR `thisYear - age - 1` (if not).
  // Without a birthday, we can only give a range.
  const earliestYear = valid ? thisYear - parsed - 1 : null
  const latestYear = valid ? thisYear - parsed : null

  const copy = (text) => { try { navigator.clipboard.writeText(text) } catch {} }

  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1.5">
          Their age
        </label>
        <input type="number" min="0" max="120" value={age}
          onChange={e => setAge(e.target.value)}
          autoFocus
          placeholder="e.g. 53"
          className="w-full px-3 py-2.5 bg-[#080B0F] border border-[#1A2130] rounded-lg text-lg font-bold text-white focus:outline-none focus:border-[#00E5C3]" />
      </div>

      {valid && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">
            Suggested DOB — click to copy
          </p>
          <button onClick={() => copy(`01/01/${latestYear}`)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-[#00E5C340] hover:bg-[#00E5C310] transition-colors"
            title="Click to copy 01/01/YYYY">
            <span className="text-sm">
              <span className="font-mono text-[#00E5C3] text-lg font-bold">01/01/{latestYear}</span>
              <span className="text-[#8899AA] ml-2 text-xs block sm:inline">
                birthday already this year
              </span>
            </span>
            <span className="text-[9px] text-[#5A6A7A] flex-shrink-0 ml-2">copy</span>
          </button>
          <button onClick={() => copy(`01/01/${earliestYear}`)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-[#1A2130] hover:bg-[#0E1318] transition-colors"
            title="Click to copy 01/01/YYYY">
            <span className="text-sm">
              <span className="font-mono text-[#8899AA] text-lg">01/01/{earliestYear}</span>
              <span className="text-[#5A6A7A] ml-2 text-xs block sm:inline">
                birthday hasn't happened yet
              </span>
            </span>
            <span className="text-[9px] text-[#5A6A7A] flex-shrink-0 ml-2">copy</span>
          </button>
          <p className="text-[10px] text-[#3A4A5A] leading-relaxed">
            01/01 is a placeholder — replace the MM/DD with their real birth date once they tell you.
            The DOB field on the lead uses <code className="text-[#8899AA]">MM/DD/YYYY</code>.
          </p>
        </div>
      )}

      {/* Reverse — DOB year → current age */}
      <div className="pt-4 border-t border-[#1A2130]">
        <ReverseYearToAge thisYear={thisYear} today={today} />
      </div>
    </div>
  )
}

function ReverseYearToAge({ thisYear, today }) {
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const y = parseInt(year, 10)
  const m = parseInt(month, 10)
  const d = parseInt(day, 10)
  const validY = y >= 1900 && y <= thisYear
  const validM = !month || (m >= 1 && m <= 12)
  const validD = !day || (d >= 1 && d <= 31)
  let calcAge = null
  if (validY && validM && validD) {
    let a = thisYear - y
    if (month && day) {
      const bday = new Date(y, m - 1, d)
      const before = (today.getMonth() < m - 1) ||
        (today.getMonth() === m - 1 && today.getDate() < d)
      if (before) a -= 1
    }
    calcAge = a
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A]">DOB → age</p>
      <div className="flex gap-1.5">
        <input type="number" min="1" max="12" value={month}
          onChange={e => setMonth(e.target.value)}
          placeholder="MM"
          className="w-14 px-2 py-1.5 bg-[#080B0F] border border-[#1A2130] rounded text-sm text-white text-center focus:outline-none focus:border-[#00E5C340]" />
        <input type="number" min="1" max="31" value={day}
          onChange={e => setDay(e.target.value)}
          placeholder="DD"
          className="w-14 px-2 py-1.5 bg-[#080B0F] border border-[#1A2130] rounded text-sm text-white text-center focus:outline-none focus:border-[#00E5C340]" />
        <input type="number" min="1900" max={thisYear} value={year}
          onChange={e => setYear(e.target.value)}
          placeholder="YYYY"
          className="flex-1 px-2 py-1.5 bg-[#080B0F] border border-[#1A2130] rounded text-sm text-white text-center focus:outline-none focus:border-[#00E5C340]" />
      </div>
      {calcAge !== null && (
        <p className="text-sm text-[#C0D0E0]">
          They're <span className="font-bold text-[#00E5C3] text-base">{calcAge}</span> years old
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Standard 4-function calculator
// ─────────────────────────────────────────────────────────────────────────────
function StandardCalcTab() {
  const [display, setDisplay] = useState('0')
  const [pending, setPending] = useState(null)   // { op, operand }
  const [awaitingOperand, setAwaitingOperand] = useState(true)

  const pressDigit = (d) => {
    if (awaitingOperand) {
      setDisplay(String(d))
      setAwaitingOperand(false)
    } else {
      setDisplay(display === '0' ? String(d) : display + String(d))
    }
  }
  const pressDot = () => {
    if (awaitingOperand) {
      setDisplay('0.')
      setAwaitingOperand(false)
    } else if (!display.includes('.')) {
      setDisplay(display + '.')
    }
  }
  const clear = () => {
    setDisplay('0'); setPending(null); setAwaitingOperand(true)
  }
  const negate = () => {
    if (display === '0') return
    setDisplay(display.startsWith('-') ? display.slice(1) : '-' + display)
  }
  const percent = () => {
    const v = parseFloat(display)
    if (isFinite(v)) setDisplay(String(v / 100))
  }
  const applyOp = (op) => {
    const cur = parseFloat(display)
    if (pending && !awaitingOperand) {
      const result = compute(pending.operand, cur, pending.op)
      setDisplay(String(result))
      setPending({ op, operand: result })
    } else {
      setPending({ op, operand: cur })
    }
    setAwaitingOperand(true)
  }
  const equals = () => {
    if (!pending) return
    const cur = parseFloat(display)
    const result = compute(pending.operand, cur, pending.op)
    setDisplay(String(result))
    setPending(null)
    setAwaitingOperand(true)
  }
  function compute(a, b, op) {
    switch (op) {
      case '+': return a + b
      case '−': return a - b
      case '×': return a * b
      case '÷': return b === 0 ? 0 : a / b
      default:  return b
    }
  }

  // Keyboard support
  useEffect(() => {
    const onKey = (e) => {
      const t = document.activeElement
      // Only intercept when the panel is showing AND no input is focused inside
      // the app (so it doesn't hijack typing elsewhere)
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (/^[0-9]$/.test(e.key)) { pressDigit(parseInt(e.key, 10)); e.preventDefault() }
      else if (e.key === '.') { pressDot(); e.preventDefault() }
      else if (e.key === '+') { applyOp('+'); e.preventDefault() }
      else if (e.key === '-') { applyOp('−'); e.preventDefault() }
      else if (e.key === '*') { applyOp('×'); e.preventDefault() }
      else if (e.key === '/') { applyOp('÷'); e.preventDefault() }
      else if (e.key === 'Enter' || e.key === '=') { equals(); e.preventDefault() }
      else if (e.key === 'Escape') { clear(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, pending, awaitingOperand])

  const Key = ({ label, onClick, wide, accent, muted }) => (
    <button onClick={onClick}
      className={`rounded-lg font-mono text-lg font-semibold transition-transform active:scale-95 ${
        wide ? 'col-span-2' : ''
      } ${accent ? 'text-black' : muted ? 'text-[#8899AA]' : 'text-white'}`}
      style={{
        background: accent ? 'linear-gradient(135deg, #00E5C3, #3B82F6)'
          : muted ? '#1A2130' : '#0E1318',
        border: '1px solid ' + (accent ? 'transparent' : '#1A2130'),
        padding: '10px 0',
      }}>
      {label}
    </button>
  )

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="rounded-lg p-4 text-right" style={{ background: '#080B0F', border: '1px solid #1A2130' }}>
        <p className="text-[9px] font-mono text-[#3A4A5A] uppercase mb-1 h-3">{pending ? `${pending.operand} ${pending.op}` : ''}</p>
        <p className="text-3xl font-mono font-bold text-white truncate" title={display}>{display}</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Key label="AC" onClick={clear} muted />
        <Key label="±" onClick={negate} muted />
        <Key label="%" onClick={percent} muted />
        <Key label="÷" onClick={() => applyOp('÷')} accent />

        <Key label="7" onClick={() => pressDigit(7)} />
        <Key label="8" onClick={() => pressDigit(8)} />
        <Key label="9" onClick={() => pressDigit(9)} />
        <Key label="×" onClick={() => applyOp('×')} accent />

        <Key label="4" onClick={() => pressDigit(4)} />
        <Key label="5" onClick={() => pressDigit(5)} />
        <Key label="6" onClick={() => pressDigit(6)} />
        <Key label="−" onClick={() => applyOp('−')} accent />

        <Key label="1" onClick={() => pressDigit(1)} />
        <Key label="2" onClick={() => pressDigit(2)} />
        <Key label="3" onClick={() => pressDigit(3)} />
        <Key label="+" onClick={() => applyOp('+')} accent />

        <Key label="0" onClick={() => pressDigit(0)} wide />
        <Key label="." onClick={pressDot} />
        <Key label="=" onClick={equals} accent />
      </div>
      <p className="text-[9px] text-[#3A4A5A] text-center">
        Keyboard: 0-9, + − × ÷, Enter to =, Esc to clear
      </p>
    </div>
  )
}
