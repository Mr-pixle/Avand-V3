import { useState } from 'react'
import { BookOpen, Building, ClipboardList, FileText, Folder, Globe, Link, Mail, Monitor, Pencil, Shield, Users } from 'lucide-react'
import { ICON_GROUPS, ICON_MAX_BYTES, isCustomIcon } from '@/lib/itemIcons'
import { Input } from './ui/input'

const icons = { globe: Globe, link: Link, mail: Mail, folder: Folder, file: FileText, book: BookOpen, clipboard: ClipboardList, users: Users, building: Building, pencil: Pencil, monitor: Monitor, shield: Shield }

export function ItemIcon({ icon, fallback = 'file', className = 'size-4 shrink-0' }: { icon?: string; fallback?: keyof typeof icons; className?: string }) {
  if (icon && isCustomIcon(icon)) return <img src={icon} alt="" className={`${className} object-contain`} />
  const Icon = icon && Object.hasOwn(icons, icon) ? icons[icon as keyof typeof icons] : icons[fallback]
  return <Icon aria-hidden="true" className={className} />
}

export function TeamName({ team, label }: { team?: { name: string; icon?: string }; label?: string }) {
  return <span className="inline-flex min-w-0 items-center gap-1.5 align-middle"><ItemIcon icon={team?.icon} fallback="users" /><span className="truncate">{label ?? team?.name ?? '—'}</span></span>
}

export function IconPicker({ value, onChange, fallback }: { value?: string; onChange: (value: string) => void; fallback: keyof typeof icons }) {
  const [error, setError] = useState('')
  const upload = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > ICON_MAX_BYTES) {
      setError("Choose a PNG, JPEG, or WebP image of up to 48 cm.")
      return
    }
    try {
      const bitmap = await createImageBitmap(file)
      bitmap.close()
      const reader = new FileReader()
      reader.onload = () => { onChange(String(reader.result)); setError('') }
      reader.onerror = () => setError("No image reading was done.")
      reader.readAsDataURL(file)
    } catch { setError("The image is not valid.") }
  }
  const custom = !!value && isCustomIcon(value)
  return <fieldset className="grid gap-2 rounded-lg border p-2">
    <legend className="px-1 text-sm font-medium">Icon</legend>
    <div className="flex items-center gap-2">
      <ItemIcon icon={value} fallback={fallback} className="size-6 shrink-0" />
      <select aria-label="Default Icon" className="h-10 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" value={custom ? 'custom' : value ?? ''} onChange={(e) => { onChange(e.target.value); setError('') }}>
        <option value="">Default</option>
        {custom && <option value="custom" disabled>Uploaded Image</option>}
        {Object.entries(ICON_GROUPS).map(([group, entries]) => <optgroup key={group} label={group}>{Object.entries(entries).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</optgroup>)}
      </select>
    </div>
    <Input aria-label="Upload Icon" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void upload(e.currentTarget.files?.[0]); e.currentTarget.value = '' }} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </fieldset>
}
