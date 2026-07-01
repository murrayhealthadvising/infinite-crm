import { useApp } from '../context/AppContext'
import { Shield, LogOut, RefreshCw, Mail } from 'lucide-react'

// Rendered by the auth gate when a signed-in user's profile.role === 'pending'.
// New sign-ups land here until an admin approves them from the Admin panel.
// Two escape hatches: sign out (to try a different account) and refresh (to
// pull the latest role in case the admin just clicked Approve).
export default function PendingApproval() {
  const { user, signOut } = useApp()
  return (
    <div style={{ minHeight: '100vh', background: '#080B0F', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="w-full max-w-md rounded-2xl border border-[#F59E0B40] p-8 text-center" style={{ background: '#0D1117' }}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: 'linear-gradient(135deg, #F59E0B, #EF4444)' }}>
          <Shield size={22} className="text-black" />
        </div>
        <h1 className="text-lg font-bold text-white mb-2">Waiting for admin approval</h1>
        <p className="text-sm text-[#8899AA] leading-relaxed mb-1">
          Your Infinite CRM account was created but hasn't been approved yet.
        </p>
        <p className="text-sm text-[#8899AA] leading-relaxed mb-5">
          Nic will get you access shortly. Reach out if you haven't heard back in a day.
        </p>

        <div className="rounded-lg border border-[#1A2130] p-3 mb-5 text-left" style={{ background: '#080B0F' }}>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#5A6A7A] mb-1">Your sign-in</p>
          <p className="text-sm text-white truncate">{user?.email || '—'}</p>
        </div>

        <a href="mailto:murrayhealthadvising@gmail.com?subject=Infinite CRM access request"
          className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-black mb-2"
          style={{ background: 'linear-gradient(135deg, #F59E0B, #EF4444)' }}>
          <Mail size={13} /> Email Nic to speed it up
        </a>

        <div className="flex items-center gap-2 mt-3">
          <button onClick={() => window.location.reload()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-white hover:border-[#2A3547]">
            <RefreshCw size={12} /> Check again
          </button>
          <button onClick={() => typeof signOut === 'function' && signOut()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-[#1A2130] text-[#8899AA] hover:text-[#EF4444] hover:border-[#EF444440]">
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
