// The MDR of a project is a Google Sheet; every project has its own. This module only checks and normalises the link,
// so the same rule runs in the form, in the permission guard and in the project page shortcut.

/** Google Sheets spreadsheet links only: https://docs.google.com/spreadsheets/d/<id>/… (a #gid=… opens a specific tab) */
const SHEET = /^\/spreadsheets\/(u\/\d+\/)?d\/[A-Za-z0-9_-]{20,}(\/.*)?$/

/** Normalised https link of an MDR, or null when the text is not a Google Sheets spreadsheet link */
export function mdrHref(raw: string | undefined | null): string | null {
  const s = String(raw ?? '').trim()
  if (!s || /\s/.test(s)) return null
  let u: URL
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.hostname !== 'docs.google.com' || !SHEET.test(u.pathname)) return null
  u.protocol = 'https:'
  return u.toString()
}

export const isMdrUrl = (raw: string | undefined | null) => mdrHref(raw) !== null

export const MDR_URL_HINT = "The project’s MDR’s own Google Sheet link, such as https://docs.google.com/streamsheets/d/.../edit (if you link a given tab, the same tab will open)."
