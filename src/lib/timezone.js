// US state → IANA timezone mapping. Used to render "local time" for a lead so
// you know whether it's an OK time to dial. Most states have a single zone; for
// the multi-zone ones we use the dominant zone and add ZIP-prefix overrides
// below for the chunks that fall into a different zone.

const STATE_TZ = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',                  // no DST
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DE: 'America/New_York',
  DC: 'America/New_York',
  FL: 'America/New_York',                 // panhandle is Central — see ZIP override
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',                 // no DST
  ID: 'America/Boise',                    // northern panhandle is Pacific — ZIP override
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago',
  KS: 'America/Chicago',                  // 4 western counties Mountain
  KY: 'America/New_York',                 // western Central — ZIP override
  LA: 'America/Chicago',
  ME: 'America/New_York',
  MD: 'America/New_York',
  MA: 'America/New_York',
  MI: 'America/Detroit',                  // 4 western UP counties Central
  MN: 'America/Chicago',
  MS: 'America/Chicago',
  MO: 'America/Chicago',
  MT: 'America/Denver',
  NE: 'America/Chicago',                  // western panhandle Mountain
  NV: 'America/Los_Angeles',              // West Wendover Mountain
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NY: 'America/New_York',
  NC: 'America/New_York',
  ND: 'America/Chicago',                  // western Mountain
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',              // Malheur county Mountain — ZIP override
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',                  // western Mountain
  TN: 'America/Chicago',                  // east Eastern — ZIP override
  TX: 'America/Chicago',                  // El Paso area Mountain — ZIP override
  UT: 'America/Denver',
  VT: 'America/New_York',
  VA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WV: 'America/New_York',
  WI: 'America/Chicago',
  WY: 'America/Denver',
}

// ZIP-prefix overrides for the most common multi-zone state edge cases.
// (5-digit ZIP, we look at the first 3.)
function zipOverride(zip) {
  if (!zip) return null
  const z = String(zip).trim().slice(0, 3)
  if (z === '324' || z === '325') return 'America/Chicago'    // FL panhandle (Pensacola/Panama City)
  if (z === '798' || z === '799') return 'America/Denver'      // TX El Paso
  if (z === '979')                  return 'America/Denver'      // OR Malheur
  if (z === '838')                  return 'America/Los_Angeles' // ID panhandle
  if (z === '376' || z === '377' || z === '378') return 'America/New_York' // TN eastern (Knoxville/Chattanooga)
  if (z === '420' || z === '421' || z === '422') return 'America/Chicago'  // KY western (Paducah/Bowling Green)
  return null
}

export function timezoneFor(lead) {
  if (!lead) return null
  const zo = zipOverride(lead.zip)
  if (zo) return zo
  const st = String(lead.state || '').trim().toUpperCase()
  return STATE_TZ[st] || null
}

// Returns "3:45 PM" or "" if we can't figure out the timezone.
export function localTimeFor(lead, now = new Date()) {
  const tz = timezoneFor(lead)
  if (!tz) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
    }).format(now)
  } catch { return '' }
}

// Useful for the dial bucket: hour-of-day in the lead's local zone (0-23),
// so callers can warn if it's outside business hours.
export function localHourFor(lead, now = new Date()) {
  const tz = timezoneFor(lead)
  if (!tz) return null
  try {
    const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now)
    return parseInt(h, 10)
  } catch { return null }
}

// Short, human label for the lead's time zone. e.g. 'EST', 'CST', 'PST', 'AZ'.
// Returns null when the zone isn't recognized as a US zone.
const TZ_SHORT = {
  'America/New_York': 'EST', 'America/Detroit': 'EST', 'America/Indiana/Indianapolis': 'EST',
  'America/Chicago': 'CST',
  'America/Denver': 'MST', 'America/Boise': 'MST',
  'America/Phoenix': 'AZ',
  'America/Los_Angeles': 'PST',
  'America/Anchorage': 'AK',
  'Pacific/Honolulu': 'HI',
}
export function tzLabelFor(lead) {
  const tz = timezoneFor(lead)
  return tz ? (TZ_SHORT[tz] || null) : null
}
