// Build a Google Calendar "create event" URL that the user can open in a new
// tab and confirm. No OAuth required — Google handles the auth when the user
// clicks the link. The event is 15 minutes by default.
//
// Example output:
// https://calendar.google.com/calendar/render?action=TEMPLATE&text=Call+Jane+Doe&dates=20260317T143000Z/20260317T144500Z&details=...

function pad(n) { return String(n).padStart(2, '0') }

// Format a Date as YYYYMMDDTHHMMSSZ (Google's expected UTC format)
function toGCalDate(d) {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  )
}

export function googleCalendarUrl({ title, startsAt, durationMinutes = 15, details = '', location = '' }) {
  if (!title || !startsAt) return null
  const start = new Date(startsAt)
  if (isNaN(start.getTime())) return null
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toGCalDate(start)}/${toGCalDate(end)}`,
    details,
    location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
