// US phone helpers — we only do US numbers (+1).
//
// normalizePhone: takes any input (with or without +1, with or without
//   formatting) and returns the canonical E.164 storage form +1XXXXXXXXXX,
//   or '' if it's not a valid US 10-digit number.
//
// displayPhone: takes a stored phone and returns a clean (XXX) XXX-XXXX
//   string, dropping the +1 prefix. Use for everything visible in the UI.
//
// Calling/dialing (tel: links) and clipboard copy should always use the
// raw stored value (which includes +1) so dialers route correctly.

export function normalizePhone(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  // Pasting "+19702380425" → 12 chars total but 11 digits with leading 1 → handled above.
  // Anything else: return empty so we don't store junk.
  return ''
}

export function displayPhone(phone) {
  if (!phone) return ''
  const digits = String(phone).replace(/\D/g, '')
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  // Fallback: raw value if we can't parse it as US (shouldn't happen for new data
  // since normalizePhone rejects non-US, but old rows might exist).
  return String(phone)
}
