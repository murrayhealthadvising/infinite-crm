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

// ZIP-prefix overrides for multi-zone state edge cases. (5-digit ZIP, we look
// at the first 3.) Sources: USPS ZIP-code zone assignments cross-referenced
// with the IANA timezone database. Where a 3-digit prefix straddles a zone
// boundary we pick the dominant zone for that prefix — the misses fall back
// to state-level default, which is close enough for "is it OK to dial now."
const ZIP3_TZ = {
  // Florida panhandle Central (west of Apalachicola River)
  '324': 'America/Chicago', // Panama City
  '325': 'America/Chicago', // Pensacola / Milton

  // Texas — El Paso & Hudspeth counties Mountain
  '798': 'America/Denver', // El Paso
  '799': 'America/Denver', // El Paso metro / Van Horn

  // Oregon — Malheur County Mountain
  '979': 'America/Denver', // Ontario, Vale, Nyssa

  // Idaho northern panhandle (10 counties) Pacific
  '832': 'America/Los_Angeles', // Sandpoint (Bonner)
  '833': 'America/Los_Angeles', // Kellogg / Wallace (Shoshone)
  '834': 'America/Los_Angeles', // Coeur d'Alene (Kootenai)
  '835': 'America/Los_Angeles', // Lewiston (Nez Perce, part)
  '838': 'America/Los_Angeles', // Moscow / Grangeville

  // Tennessee eastern third Eastern
  '373': 'America/New_York', // Chattanooga
  '374': 'America/New_York', // Cleveland
  '376': 'America/New_York', // Johnson City / Kingsport
  '377': 'America/New_York', // Knoxville
  '378': 'America/New_York', // Knoxville area
  '379': 'America/New_York', // Knoxville area

  // Kentucky western third Central
  '420': 'America/Chicago', // Paducah
  '421': 'America/Chicago', // Bowling Green area
  '422': 'America/Chicago', // Bowling Green
  '423': 'America/Chicago', // Owensboro
  '424': 'America/Chicago', // Owensboro area

  // Indiana SW & NW pockets Central (most of IN is Eastern)
  '463': 'America/Chicago', // Gary / Hammond
  '464': 'America/Chicago', // Gary metro
  '476': 'America/Chicago', // Evansville
  '477': 'America/Chicago', // Evansville metro

  // Michigan — 4 western UP counties Central
  '499': 'America/Chicago', // Iron Mountain / Ironwood

  // Kansas — 4 far-western counties Mountain
  '677': 'America/Denver', // Colby / Goodland
  '679': 'America/Denver', // NW Kansas edge

  // Nebraska western panhandle Mountain
  '691': 'America/Denver', // Scottsbluff area
  '693': 'America/Denver', // Valentine (Cherry county)
  '695': 'America/Denver', // Alliance / Chadron

  // North Dakota western Mountain
  '586': 'America/Denver', // Dickinson
  '588': 'America/Denver', // Williston

  // South Dakota western half Mountain
  '577': 'America/Denver', // Rapid City
  '578': 'America/Denver', // Rapid City west

  // Nevada — West Wendover Mountain (rest of NV is Pacific)
  '898': 'America/Denver', // West Wendover (Elko county corner)
}

function zipOverride(zip) {
  if (!zip) return null
  const z = String(zip).trim().slice(0, 3)
  return ZIP3_TZ[z] || null
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
