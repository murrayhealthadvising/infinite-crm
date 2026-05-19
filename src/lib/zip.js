// US ZIP code → state lookup. Uses the first 3 digits (ZCTA prefix) which is
// the standard postal mapping. Covers all 50 states + DC + territories.
// Returns the 2-letter state code, or null if it's not a recognizable US ZIP.

// Ranges expressed as [start, end, state]. start/end inclusive, 3-digit prefixes.
const ZIP_RANGES = [
  ['005', '005', 'NY'], // Holtsville
  ['010', '027', 'MA'], ['028', '029', 'RI'],
  ['030', '038', 'NH'], ['039', '049', 'ME'],
  ['050', '059', 'VT'], ['060', '069', 'CT'],
  ['070', '089', 'NJ'],
  ['100', '149', 'NY'],
  ['150', '196', 'PA'], ['197', '199', 'DE'],
  ['200', '205', 'DC'], ['206', '219', 'MD'],
  ['220', '246', 'VA'], ['247', '268', 'WV'],
  ['270', '289', 'NC'], ['290', '299', 'SC'],
  ['300', '319', 'GA'], ['320', '349', 'FL'],
  ['350', '369', 'AL'], ['370', '385', 'TN'],
  ['386', '397', 'MS'], ['398', '399', 'GA'],
  ['400', '427', 'KY'], ['430', '459', 'OH'],
  ['460', '479', 'IN'], ['480', '499', 'MI'],
  ['500', '528', 'IA'], ['530', '549', 'WI'],
  ['550', '567', 'MN'], ['570', '577', 'SD'],
  ['580', '588', 'ND'], ['590', '599', 'MT'],
  ['600', '629', 'IL'], ['630', '658', 'MO'],
  ['660', '679', 'KS'], ['680', '693', 'NE'],
  ['700', '714', 'LA'], ['716', '729', 'AR'],
  ['730', '749', 'OK'], ['750', '799', 'TX'],
  ['800', '816', 'CO'], ['820', '831', 'WY'],
  ['832', '838', 'ID'], ['840', '847', 'UT'],
  ['850', '865', 'AZ'], ['870', '884', 'NM'],
  ['889', '898', 'NV'],
  ['900', '961', 'CA'],
  ['967', '968', 'HI'],
  ['970', '979', 'OR'], ['980', '994', 'WA'],
  ['995', '999', 'AK'],
]

// Compute age from a DOB string (ISO 'YYYY-MM-DD' or anything Date can parse).
// Returns an integer 0-129 or null if invalid.
export function ageFromDob(dob) {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--
  return age >= 0 && age < 130 ? age : null
}

export function stateFromZip(zip) {
  if (!zip) return null
  const digits = String(zip).replace(/\D/g, '')
  if (digits.length < 3) return null
  const prefix = digits.slice(0, 3)
  for (const [start, end, state] of ZIP_RANGES) {
    if (prefix >= start && prefix <= end) return state
  }
  return null
}
