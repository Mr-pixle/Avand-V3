import {newId} from '@/lib/id'
import { IconPicker, TeamName } from './ItemIcon'
import {teamCode,TEAM_GROUP_ORDER,teamOutline} from '@/lib/brand'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { useStore } from '@/lib/store'
import { guard } from '@/lib/policy'
import type { TeamKind } from '@/lib/types'
import type { Action } from '@/lib/state'
import { toast } from 'sonner'

const KINDS: Record<TeamKind, string> = { fixed: "Fixed", phase1: 'CD', phase2: 'DD', revit: 'DD / Revit', other: "Independently", supervision: 'CA', management: 'MG' }
const selectClass = 'h-9 rounded-md border bg-background px-2 text-[13px]'

export function TeamsAdmin() {
  const { state, dispatch, can } = useStore()
  const [icon, setIcon] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TeamKind>('other')
  const [editing, setEditing] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const send = (a: Action) => {
    const reason = guard(state, a)
    if (reason) { toast.error(reason); return false }
    dispatch(a); return true
  }
  const save = () => {
    const a: Action = editing ? { type: 'teamUpdate', id: editing, patch: { name, kind, icon } } : { type: 'teamAdd', team: { id: `team-${newId()}`, name, kind, icon } }
    if (send(a)) { setEditing(null); setName(''); setKind('other'); setIcon('') }
  }
  return <div className="flex flex-col gap-4">
    <p className="text-sm text-muted-foreground">The organizational team is independent of the project responsibilities. Each person has an organizational team; moving members does not change their registered role in the projects.</p>
    {can.perm('users.manage') && can.perm(editing ? 'team.edit' : 'team.create') && <form className="glass-card flex flex-wrap items-end gap-3 p-4" onSubmit={(e) => { e.preventDefault(); save() }}>
      <div className="min-w-48 flex-1"><Label htmlFor="team-name">Team Name</Label><Input id="team-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></div>
      <div><Label htmlFor="team-kind">Team Type</Label><select id="team-kind" className={selectClass + ' block'} value={kind} onChange={(e) => setKind(e.target.value as TeamKind)}>{Object.entries(KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></div>
      <IconPicker value={icon} onChange={setIcon} fallback="users" />
      <Button type="submit"><Plus className="h-4 w-4" />{editing ? "Save Team" : "Create team"}</Button>
      {editing && <Button variant="ghost" type="button" onClick={() => { setEditing(null); setName(''); setIcon('') }}>Cancel</Button>}
    </form>}
    <div className="grid gap-3 md:grid-cols-2">{TEAM_GROUP_ORDER.map(code=>code==='SD'?<fieldset key="SD" className="rounded-xl border p-3" style={teamOutline(undefined,'CD')}><legend className="px-2 font-semibold">SD</legend><p className="glass-card p-4 text-sm text-muted-foreground">SD uses the existing CD team pool. Configure its responsible team independently in each project's settings.</p></fieldset>:<fieldset key={code} className="rounded-xl border p-3" style={teamOutline(state.teams.find(t => teamCode(t) === code), code)}><legend className="px-2 font-semibold">{code}</legend>{state.teams.filter(t=>teamCode(t)===code).map((t) => <section key={t.id} className="glass-card p-4">
      <div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold"><TeamName team={t} />{t.archived ? " — Archives" : ''}</h3><p className="text-xs text-muted-foreground">{KINDS[t.kind]} · {state.users.filter((u) => u.teamId === t.id).length} Member</p></div>
        {can.perm('users.manage') && can.perm('team.edit') && <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => { setEditing(t.id); setName(t.name); setKind(t.kind); setIcon(t.icon ?? '') }}>Edit {t.name}</Button><Button size="sm" variant="ghost" onClick={() => send({ type: 'teamArchive', id: t.id, archived: !t.archived })}>{t.archived ? 'Enable' : 'Archive'}</Button></div>}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{state.users.filter((u) => u.teamId === t.id).map((u) => u.name).join(', ') || "No members"}</p>
    </section>)}</fieldset>)}</div>
    <section className="glass-card p-4"><h3 className="mb-3 font-semibold">Add, move or exit members from the team</h3>
      <Input aria-label="Search Team Members" placeholder="User Name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-96 divide-y overflow-auto">{state.users.filter((u) => u.status !== 'pending' && (!q || u.name.includes(q) || u.username.includes(q))).map((u) => <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{u.name} <bdi className="text-xs text-muted-foreground">@{u.username}</bdi></span><select className={selectClass} aria-label={`Organizational team ${u.username}`} disabled={!can.perm('users.manage') || !can.perm('team.edit')} value={u.teamId} onChange={(e) => send({ type: 'teamMember', userId: u.id, teamId: e.target.value })}><option value="">No team</option>{state.teams.filter((t) => !t.archived || t.id === u.teamId).map((t) => <option key={t.id} value={t.id} disabled={t.archived}>{t.name}</option>)}</select></div>)}</div>
    </section>
  </div>
}
