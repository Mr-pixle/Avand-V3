import { Monitor, Moon, Sun, UserPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DeadlineSettings } from '@/components/DeadlineSettings'
import { Initials } from '@/components/common'
import { saveEnglishLocale, useEnglishLocale } from '@/lib/preferences'
import { useStore } from '@/lib/store'
import { BackupSettings } from '@/components/BackupSettings'

const themes = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

export function SettingsPage() {
  const { state, me, dispatch } = useStore()
  const locale = useEnglishLocale(me.id)
  const openProfile = () => dispatch({ type: 'openProfile', id: me.id })
  return <div className="space-y-5">
    <h1 className="studio-title">Settings</h1>
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="glass-card p-5">
        <h2 className="studio-heading">Profile Settings</h2>
        <div className="my-4 flex items-center gap-3">
          <Initials user={me} size={52} />
          <div className="min-w-0"><p className="break-words font-medium" dir="auto">{me.name}</p><p className="break-words text-sm text-muted-foreground">{me.email || '@' + me.username}</p></div>
        </div>
        <Button variant="outline" onClick={openProfile}><UserPen className="size-4" /> Edit Profile and Password</Button>
      </section>
      <section className="glass-card p-5">
        <h2 className="studio-heading">Application Preferences</h2>
        <fieldset className="my-3">
          <legend className="mb-2 text-sm font-medium">Appearance</legend>
          <div className="flex flex-wrap gap-2">{themes.map(({ value, label, icon: Icon }) => <Button key={value} type="button" aria-pressed={state.theme === value} variant={state.theme === value ? 'default' : 'outline'} onClick={() => dispatch({ type: 'setTheme', theme: value })}><Icon className="size-4" /> {label}</Button>)}</div>
        </fieldset>
        <div className="border-t pt-3">
          <label htmlFor="display-language" className="mb-1 block text-sm font-medium">Display Language</label>
          <select id="display-language" className="min-h-10 w-full rounded-lg border bg-background px-2 text-sm sm:w-56" value={locale} onChange={(e) => saveEnglishLocale(me.id, e.currentTarget.value === 'en-US' ? 'en-US' : 'en-GB')}>
            <option value="en-GB">English (United Kingdom)</option>
            <option value="en-US">English (United States)</option>
          </select>
        </div>
      </section>
    </div>
    <DeadlineSettings />
    {me.role==='ceo' && <BackupSettings />}
  </div>
}
