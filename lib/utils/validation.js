const h5074_uuid_rev = '88ec'
const h5075_uuid_rev = '88ec'
const h5101_uuid_rev = '0100'
const h5179_uuid_rev = '0188'

export function isHt5074(hex) { // Govee H5074
  return hex.includes(h5074_uuid_rev) && hex.length === 18
}

export function isHt5075(hex) { // Govee H5072/H5075
  return hex.includes(h5075_uuid_rev) && hex.length === 16
}

// Govee H5100/H5101/H5102
//
// ⚠️ The length check matters as much as the marker. `0100` is only four hex
// digits, and plenty of Govee broadcasts happen to contain it - a light sending
// `4388ec00020100` did, which claimed the broadcast for the H5101 decoder, and
// that decoder reads sixteen characters and threw on fourteen (#1350). The
// throw surfaced as `error processing discovered peripheral` on every broadcast
// from a light that was working perfectly well.
//
// This is `>=` rather than the `===` its siblings use, deliberately: the
// decoder only ever reads the first sixteen characters, so anything at least
// that long decodes correctly today. Pinning an exact length would reject a
// longer payload from an H5111 or H5220 - both documented as sharing this
// format - and there is no sample of either to check that against.
export function isHt5101(hex) {
  return hex.includes(h5101_uuid_rev) && hex.length >= 16
}

export function isHt5179(hex) { // Govee H5179
  return hex.includes(h5179_uuid_rev) && hex.length === 22
}

export function isValidPeripheral(peripheral) {
  const { advertisement } = peripheral

  if (!advertisement || !advertisement.manufacturerData) {
    return false
  }

  const hex = advertisement.manufacturerData.toString('hex')

  return !(!isHt5074(hex) && !isHt5075(hex) && !isHt5101(hex) && !isHt5179(hex))
}
