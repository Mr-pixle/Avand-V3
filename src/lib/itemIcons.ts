export const ICON_GROUPS = {
  'Links': { globe: "Website", link: "Link", mail: "Email" },
  'Documents': { folder: "Folder", file: "Document", book: "Book", clipboard: "Checklist" },
  'Teams': { users: "Team", building: "Building", pencil: "Design", monitor: "Computer", shield: "Supervision" },
} as const

const names = new Set(Object.values(ICON_GROUPS).flatMap((group) => Object.keys(group)))
export const ICON_MAX_BYTES = 48 * 1024
const raster = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

export function isCustomIcon(value: string) {
  if (value.length > Math.ceil(ICON_MAX_BYTES / 3) * 4 + 32 || !raster.test(value)) return false
  const payload = value.slice(value.indexOf(',') + 1)
  if (payload.length % 4 !== 0) return false
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return payload.length * 3 / 4 - padding <= ICON_MAX_BYTES
}

export function validIcon(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || names.has(value) || isCustomIcon(value))
}
