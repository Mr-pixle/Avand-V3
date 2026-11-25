import { systemLabel } from '@/lib/displayLabels'
import { TeamName } from '@/components/ItemIcon'
import { TeamsAdmin } from '@/components/TeamsAdmin'
import { useMemo, useState } from 'react'
import { ArrowUpLeft, Check, Plus, Trash2, Undo2, UserPen } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { effectiveScope, isWorkItem, parentScopeOf, useFmt, useStore } from '@/lib/store'
import { navigationSelection } from '@/lib/navigation'
import type { Role, StatusCategory, Task } from '@/lib/types'
import { Initials, JalaliDateField, PageHeader, StatusPill } from '@/components/common'
import { NewProjectDialog } from './Projects'
import { USERNAME_RE } from '@/components/Profile'
import { RolesEditor } from '@/components/RolesEditor'
import { roleLabel } from '@/lib/accessRoles'
import { assignableRoles, has, ROLE_FA } from '@/lib/policy'
import { ProjectEditor } from '@/components/ProjectEditor'
import { BackupSettings } from '@/components/BackupSettings'

const CAT: Record<StatusCategory, string> = { todo: 'To Do', doing: 'In Progress', done: 'Done' }

export function Admin() {
  const { state, dispatch, can, me } = useStore()
  const { n } = useFmt()
  const pendingCount = state.users.filter((u) => u.status === 'pending').length
  const users = can.perm('users.approve') || can.perm('users.manage')
  const audit = can.perm('audit.view')
  const tabs = navigationSelection(state.nav, dispatch, 'tab', pendingCount && users ? 'users' : 'status', [
    'status', 'teams', 'projects', 'calendar', 'roles', 'decisions',
    ...(users ? ['users'] : []), ...(audit ? ['audit'] : []),
    ...(me.role==='ceo' ? ['settings'] : []),
  ])
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Project Controls" title="Administration">Manage users, membership requests, teams, projects, statuses, calendars and the audit log.</PageHeader>
      <Tabs value={tabs.value} onValueChange={tabs.onChange} dir="ltr">
        <div className="scroll-x thin-scroll -mx-1 px-1">
          <TabsList className="h-auto w-max justify-start gap-0.5">
            {users && <TabsTrigger value="users" className="text-[13px]">Users and Requests{pendingCount > 0 && <span className="num ms-1.5 rounded-full bg-azure px-1.5 text-[10.5px] font-semibold text-azure-foreground">{n(pendingCount)}</span>}</TabsTrigger>}
            <TabsTrigger value="status" className="text-[13px]">Statuses</TabsTrigger>
            <TabsTrigger value="teams" className="text-[13px]">Teams and Users</TabsTrigger>
            <TabsTrigger value="projects" className="text-[13px]">Projects</TabsTrigger>
            <TabsTrigger value="calendar" className="text-[13px]">Holidays and Leave</TabsTrigger>
            {audit && <TabsTrigger value="audit" className="text-[13px]">AuditLog</TabsTrigger>}
            <TabsTrigger value="roles" className="text-[13px]">Roles and Permissions</TabsTrigger>
            <TabsTrigger value="decisions" className="text-[13px]">Decisions and Assumptions</TabsTrigger>
            {me.role==='ceo' && <TabsTrigger value="settings" className="text-[13px]">Settings</TabsTrigger>}
          </TabsList>
        </div>
        {users && <TabsContent value="users" className="mt-4"><UsersAdmin /></TabsContent>}
        <TabsContent value="status" className="mt-4"><StatusAdmin /></TabsContent>
        <TabsContent value="teams" className="mt-4"><TeamsAdmin /></TabsContent>
        <TabsContent value="projects" className="mt-4"><ProjectsAdmin /></TabsContent>
        <TabsContent value="calendar" className="mt-4"><CalendarAdmin /></TabsContent>
        {audit && <TabsContent value="audit" className="mt-4"><AuditAdmin /></TabsContent>}
        <TabsContent value="roles" className="mt-4"><RolesEditor /></TabsContent>
        <TabsContent value="decisions" className="mt-4"><Decisions /></TabsContent>
        {me.role==='ceo' && <TabsContent value="settings" className="mt-4"><BackupSettings /></TabsContent>}
      </Tabs>
    </div>
  )
}

// ---------------- Statuses ----------------
function StatusAdmin() {
  const store = useStore()
  const { state, dispatch, can } = store
  const { n } = useFmt()
  const [pid, setPid] = useState(state.projects[0]?.id ?? 'office')
  const [scope, setScope] = useState<string>(pid)
  const nodes = useMemo(() => Object.values(state.tasks).filter((t) => t.projectId === pid && (t.kind === 'phase' || t.kind === 'stage' || t.kind === 'group')).sort((a, b) => a.order - b.order), [state.tasks, pid])
  const own = !!state.statusSets[scope]
  const eff = scope === 'office' || scope === pid ? (state.statusSets[scope] ? scope : 'office') : effectiveScope(state, state.tasks[scope])
  const list = state.statusSets[eff]
  const parent = parentScopeOf(state, scope)
  const usage = (statusId: string) => Object.values(state.tasks).filter((t) => isWorkItem(t) && t.statusId === statusId && effectiveScope(state, t) === scope).length
  const scopeName = (k: string) => (k === 'office' ? 'Studio Default' : store.projectById[k] ? `Project ${store.projectById[k].name}` : state.tasks[k]?.name ?? k)
  const [del, setDel] = useState<{ id: string; moveTo: string } | null>(null)

  const ScopeBtn = ({ k, label, level, t }: { k: string; label: string; level: number; t?: Task }) => (
    <button onClick={() => { setScope(k); setDel(null) }} className={cn('flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start text-[13px] hover:bg-accent', scope === k && 'bg-azure-soft text-azure-ink')} style={{ paddingInlineStart: 8 + level * 14 }}>
      <span className="min-w-0 truncate">{t && <span className="me-1.5 text-[10.5px] text-muted-foreground">{t.kind === 'phase' ? 'Phase' : t.kind === 'stage' ? 'Stage' : 'Group'}</span>}{label}</span>
      {state.statusSets[k] ? <span className="shrink-0 rounded bg-foreground px-1.5 text-[10px] font-medium text-background">Override</span> : <span className="shrink-0 text-[10.5px] text-muted-foreground">Inherited</span>}
    </button>
  )
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="glass-card p-3">
        <Label htmlFor="st-project" className="eyebrow">Project</Label>
        <Select value={pid} onValueChange={(v) => { setPid(v); setScope(v) }}>
          <SelectTrigger id="st-project" className="mt-1 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{state.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="mt-3 flex max-h-[520px] flex-col gap-0.5 overflow-y-auto thin-scroll">
          <ScopeBtn k="office" label="Studio Default" level={0} />
          <ScopeBtn k={pid} label={store.projectById[pid]?.name ?? 'Project'} level={1} />
          {nodes.map((t) => <ScopeBtn key={t.id} k={t.id} label={t.name} level={t.kind === 'phase' ? 2 : t.kind === 'stage' ? 3 : 4} t={t} />)}
        </div>
      </div>
      <div className="min-w-0 glass-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <div className="font-semibold">{scopeName(scope)}</div>
            <div className="text-[12px] text-muted-foreground">
              {scope === 'office' ? "All projects start from this list." : own ? "Override; sub-categories inherit from this list." : `Inherits from “${scopeName(eff)}”.`}
            </div>
          </div>
          {can.perm('statuses.manage') && scope !== 'office' && (own
            ? <Button variant="outline" size="sm" onClick={() => { dispatch({ type: 'statusInherit', scope }); toast.success("He's back in inheritance", { description: `Tasks whose Status was not listed on the ${scopeName(parent ?? 'office')} list were also moved to the Status category.` }) }}><Undo2 className="h-3.5 w-3.5" /> Return to inheritance</Button>
            : <Button size="sm" onClick={() => dispatch({ type: 'statusOverride', scope })}>Override This Section</Button>)}
        </div>
        <div className="divide-y">
          {list.map((s) => {
            const editable = can.perm('statuses.manage') && (own || scope === 'office')
            const used = editable ? usage(s.id) : 0
            return (
              <div key={s.id} className="px-4 py-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_150px_110px_auto]">
                  {editable ? (
                    <Input id={`st-name-${s.id}`} value={s.name} className="h-8" onChange={(e) => dispatch({ type: 'statusUpdate', scope, id: s.id, patch: { name: e.target.value } })} />
                  ) : <div><StatusPill status={s} /></div>}
                  {editable ? (
                    <Select value={s.category} onValueChange={(v) => dispatch({ type: 'statusUpdate', scope, id: s.id, patch: { category: v as StatusCategory } })}>
                      <SelectTrigger id={`st-cat-${s.id}`} className="hidden h-8 sm:flex"><SelectValue /></SelectTrigger>
                      <SelectContent>{(Object.keys(CAT) as StatusCategory[]).map((c) => <SelectItem key={c} value={c}>{CAT[c]}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : <span className="hidden text-[12px] text-muted-foreground sm:inline">{CAT[s.category]}</span>}
                  {editable ? (
                    <div className="hidden items-center gap-1 sm:flex"><Input id={`st-pg-${s.id}`} type="number" min={0} max={100} value={s.progress} className="num h-8" onChange={(e) => dispatch({ type: 'statusUpdate', scope, id: s.id, patch: { progress: Math.max(0, Math.min(100, Number(e.target.value))) } })} /><span className="text-muted-foreground">%</span></div>
                  ) : <span className="num hidden text-[12px] sm:inline">{n(s.progress)}%</span>}
                  {editable ? (
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete Status" onClick={() => {
                      if (list.length <= 1) { toast.error('At least one status is required.'); return }
                      if (used) setDel({ id: s.id, moveTo: list.find((x) => x.id !== s.id)!.id })
                      else { dispatch({ type: 'statusDelete', scope, id: s.id }); toast.success(`“${s.name}” deleted`) }
                    }}><Trash2 className="h-4 w-4" /></Button>
                  ) : <span />}
                </div>
                {del?.id === s.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-[12.5px]">
                    <span><span className="num font-semibold">{n(used)}</span> Tasks have this Status. To remove, move them to:</span>
                    <Select value={del.moveTo} onValueChange={(v) => setDel({ ...del, moveTo: v })}>
                      <SelectTrigger id="st-move" className="h-8 w-[170px] bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>{list.filter((x) => x.id !== s.id).map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" variant="destructive" onClick={() => { dispatch({ type: 'statusDelete', scope, id: s.id, moveTo: del.moveTo }); setDel(null); toast.success(`${n(used)} Task Transfer and " ${s.name} " Removed`) }}>Transfer and Remove</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDel(null)}>Cancel</Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {can.perm('statuses.manage') && (own || scope === 'office') && (
          <div className="border-t px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'statusAdd', scope, status: { id: `st-${Date.now().toString(36)}`, name: "New Status", category: 'doing', progress: 50 } })}><Plus className="h-3.5 w-3.5" /> Add Status</Button>
          </div>
        )}
        <p className="border-t px-4 py-3 text-[12px] text-muted-foreground">Each Status has a category (To Do / In Progress / Done) and a percentage of Progress. Progress Task comes from its Status. Delete Status Status Status is only allowed by transferring the Tasks.</p>
      </div>
    </div>
  )
}

// ---------------- Users & sign-up requests ----------------
function UsersAdmin() {
  const { state, dispatch, me, teamById, can } = useStore()
  const { time, n } = useFmt()
  const roles = assignableRoles(me)
  const pending = state.users.filter((u) => u.status === 'pending')
  const [pick, setPick] = useState<Record<string, { teamId: string; role: Role }>>({})
  const [q, setQ] = useState('')
  const [nu, setNu] = useState({ name: '', username: '', password: '', teamId: 'p1a', role: 'member' as Role,email:'',phone:'',nationalId:'',birthday:'',telegramId:'',workScope:'' })
  const others = state.users.filter((u) => u.status !== 'pending' && (!q || u.name.includes(q) || u.username.includes(q.toLowerCase())))
  const STATUS: Record<string, { l: string; c: string }> = { active: { l: 'Active', c: 'bg-leaf-soft text-leaf-ink' }, disabled: { l: 'Disabled', c: 'bg-secondary text-muted-foreground' }, rejected: { l: 'Rejected', c: 'bg-danger-soft text-destructive' }, pending: { l: 'Pending', c: 'bg-azure-soft text-azure-ink' } }
  const create = () => {
    const username = nu.username.trim().toLowerCase()
    if (!nu.name.trim()) { toast.error('Enter your full name.'); return }
    if (!USERNAME_RE.test(username)) { toast.error("User name is not valid, such as s.ahmadi"); return }
    if (state.users.some((x) => x.username === username)) { toast.error(`User name ${username} has already been taken.`); return }
    if (nu.password.length < 6) { toast.error("The password must be at least 6 characters."); return }
    dispatch({ type: 'addUser', user: { id: `u-new-${Date.now().toString(36)}`, name: nu.name.trim(), username, password: nu.password, teamId: nu.teamId, role: nu.role, workScope:nu.workScope.trim()||null,...(me.role==='ceo'?{email:nu.email.trim()||null,phone:nu.phone.trim(),nationalId:nu.nationalId.trim()||null,birthday:nu.birthday.trim()||null,telegramId:nu.telegramId.trim()||null}:{}),capacity: 8, status: 'active', createdAt: new Date().toISOString() } })
    setNu({ ...nu, name: '', username: '', password: '',email:'',phone:'',nationalId:'',birthday:'',telegramId:'',workScope:'' })
    toast.success(`User ${username} Defined and activated`)
  }
  return (
    <div className="flex flex-col gap-5">
      <section className="overflow-hidden glass-card">
        <div className="border-b bg-foreground/[0.03] px-4 py-3">
          <div className="font-semibold">Membership Requests <span className="num text-muted-foreground">({n(pending.length)})</span></div>
          <div className="text-[12px] text-muted-foreground">The user registers with a username, full name and password (without email). Access the site by confirming you and determining your team and role.</div>
        </div>
        {pending.length === 0 ? <div className="px-4 py-5 text-[12.5px] text-muted-foreground">There is no demand waiting.</div> : (
          <ul className="divide-y">
            {pending.map((u) => {
              const sel = pick[u.id] ?? { teamId: '', role: 'member' as Role }
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Initials user={u} size={32} />
                  <div className="min-w-[160px] flex-1">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-[11.5px] text-muted-foreground"><bdi className="mono">@{u.username}</bdi>the Request {time(u.createdAt)}</div>
                  </div>
                  <Select value={sel.teamId ?? ''} onValueChange={(v) => setPick({ ...pick, [u.id]: { ...sel, teamId: v } })}>
                    <SelectTrigger id={`rq-team-${u.id}`} className="h-9 w-[160px]"><SelectValue placeholder="Choose the team" /></SelectTrigger>
                    <SelectContent>{state.teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={sel.role} onValueChange={(v) => setPick({ ...pick, [u.id]: { ...sel, role: v as Role } })}>
                    <SelectTrigger id={`rq-role-${u.id}`} className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{roles.map((r) => <SelectItem key={r} value={r}>{ROLE_FA[r]}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => { if (!sel.teamId) { toast.error("To confirm, select the user team."); return } dispatch({ type: 'approveUser', id: u.id, teamId: sel.teamId, role: sel.role }); toast.success(`Account ${u.username} Confirmed`, { description: `He became a member of the team ${teamById[sel.teamId]?.name} and now he can enter.` }) }}><Check className="h-3.5 w-3.5" /> Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => { dispatch({ type: 'rejectUser', id: u.id }); toast(`Request ${u.username} Rejected`) }}>Reject</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {has(me, 'users.manage') && <section className="glass-card">
        <div className="border-b px-4 py-3"><div className="font-semibold">New User</div><div className="text-[12px] text-muted-foreground">The user who defines a direct project manager or control is activated without confirmation.</div></div>
        <form className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto] lg:items-end" onSubmit={(e) => { e.preventDefault(); create() }}>
          <div><Label htmlFor="nu-name" className="eyebrow">Full Name</Label><Input id="nu-name" className="mt-1 h-9" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} /></div>
          <div><Label htmlFor="nu-user" className="eyebrow">Username</Label><Input id="nu-user" dir="ltr" className="mono mt-1 h-9" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} placeholder="s.ahmadi" /></div>
          <div><Label htmlFor="nu-pass" className="eyebrow">Primary code</Label><Input id="nu-pass" type="password" autoComplete="new-password" className="mt-1 h-9" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></div>
          <div><Label htmlFor="nu-team" className="eyebrow">Team</Label><Select value={nu.teamId} onValueChange={(v) => setNu({ ...nu, teamId: v })}><SelectTrigger id="nu-team" className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent>{state.teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label htmlFor="nu-role" className="eyebrow">Role</Label><Select value={nu.role} onValueChange={(v) => setNu({ ...nu, role: v as Role })}><SelectTrigger id="nu-role" className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent>{roles.map((r) => <SelectItem key={r} value={r}>{ROLE_FA[r]}</SelectItem>)}</SelectContent></Select></div>
          <div><Label htmlFor="nu-work-scope">Work Scope</Label><Input id="nu-work-scope" value={nu.workScope} onChange={e=>setNu({...nu,workScope:e.target.value})}/></div>
          {me.role==='ceo'&&(['email','phone','nationalId','birthday','telegramId'] as const).map(key=><div key={key}><Label htmlFor={`nu-${key}`}>{({email:'Email',phone:'Phone Number',nationalId:'National ID',birthday:'Birthday',telegramId:'Telegram ID'})[key]}</Label><Input id={`nu-${key}`} type={key==='email'?'email':'text'} value={nu[key]} onChange={e=>setNu({...nu,[key]:e.target.value})}/></div>)}
          <Button type="submit" className="h-9"><Plus className="h-4 w-4" /> Definitions</Button>
        </form>
      </section>}

      <section className="overflow-hidden glass-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <span className="font-semibold">All Users</span>
          <Input id="users-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Name or ID" className="h-8 w-[200px] text-[12.5px]" />
        </div>
        <div className="scroll-x thin-scroll">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="border-b bg-foreground/[0.03] text-[11.5px] text-muted-foreground"><tr>{['Name', 'ID', 'Team', 'Role', 'Job Title', 'Status', ''].map((h, i) => <th key={i} className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {others.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-3 py-1.5"><span className="flex items-center gap-2"><Initials user={u} size={22} />{u.name}</span></td>
                  <td className="px-3 py-1.5"><bdi className="mono text-[12px]">@{u.username}</bdi></td>
                  <td className="px-3 py-1.5 text-muted-foreground"><TeamName team={teamById[u.teamId]} /></td>
                  <td className="px-3 py-1.5 text-muted-foreground">{roleLabel(state.roleDefinitions, u)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{u.title ?? '—'}</td>
                  <td className="px-3 py-1.5"><span className={cn('rounded px-1.5 py-0.5 text-[11px]', STATUS[u.status].c)}>{STATUS[u.status].l}</span></td>
                  <td className="px-3 py-1.5 text-end">{can.editUser(u.id) && <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'openProfile', id: u.id })}><UserPen className="h-3.5 w-3.5" /> Edit</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ---------------- Teams ----------------
// ---------------- Projects ----------------
function ProjectsAdmin() {
  const { state, dispatch, can } = useStore()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const project = state.projects.find((p) => p.id === editing)
  return <div className="flex flex-col gap-3">
    <p className="text-sm text-muted-foreground">Set up the organizational teams and executive responsibilities of each project in an integrated form of project specifications.</p>
    {can.perm('project.define') && <Button className="self-start" onClick={() => setOpen(true)}>New Project</Button>}
    <div className="glass-card divide-y">{state.projects.map((p) => <div className="flex flex-wrap items-center justify-between gap-3 p-4" key={p.id}><button className="font-semibold" onClick={() => dispatch({ type: 'nav', nav: { page: 'project', projectId: p.id } })}>{p.code} — {p.name}</button>{can.perm('project.define') && <Button variant="outline" onClick={() => setEditing(p.id)}>Edit profile and responsibilities {p.name}</Button>}</div>)}</div>
    <NewProjectDialog open={open} onOpenChange={setOpen} />
    {project && <ProjectEditor project={project} open onOpenChange={() => setEditing(null)} />}
  </div>
}

// ---------------- Holidays & leaves ----------------
function CalendarAdmin() {
  const { state, dispatch, userById, can } = useStore()
  const { d, n } = useFmt()
  const [hDate, setHDate] = useState<string | undefined>()
  const [hTitle, setHTitle] = useState('')
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="min-w-0 glass-card">
        <div className="border-b px-4 py-3"><div className="font-semibold">Official Holiday</div><div className="text-[12px] text-muted-foreground">Thursday and Friday are always closed. Enter the lunar holiday here every year.</div></div>
        <ul className="max-h-[360px] divide-y overflow-y-auto thin-scroll">
          {state.holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
              <span className="num w-24 shrink-0">{d(h.date)}</span><span className="min-w-0 flex-1 truncate">{systemLabel(h.title)}</span>
              {can.perm('calendar.manage') && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete" onClick={() => dispatch({ type: 'removeHoliday', id: h.id })}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </li>
          ))}
        </ul>
        {can.perm('calendar.manage') && (
          <form className="flex flex-wrap items-end gap-2 border-t px-4 py-3" onSubmit={(e) => { e.preventDefault(); if (!hDate || !hTitle.trim()) { toast.error("Enter the date and title."); return } dispatch({ type: 'addHoliday', holiday: { id: `h-${Date.now()}`, date: hDate, title: hTitle.trim() } }); setHTitle(''); setHDate(undefined); toast.success("Closed added", { description: "The capacity of that day in workload and validation is zero." }) }}>
            <div className="w-36"><Label htmlFor="h-date" className="eyebrow">Date</Label><div className="mt-1"><JalaliDateField id="h-date" value={hDate} onChange={setHDate} /></div></div>
            <div className="min-w-[140px] flex-1"><Label htmlFor="h-title" className="eyebrow">Title</Label><Input id="h-title" className="mt-1 h-9" value={hTitle} onChange={(e) => setHTitle(e.target.value)} /></div>
            <Button type="submit" className="h-9"><Plus className="h-4 w-4" /> Add</Button>
          </form>
        )}
      </div>
      <div className="min-w-0 glass-card">
        <div className="border-b px-4 py-3"><div className="font-semibold">Leaves</div><div className="text-[12px] text-muted-foreground">Leaves are reduced from the capacity of that person’s day. Leaves come from “office requests” after final approval; direct registration is for exceptions with the administrative manager.</div></div>
        <ul className="max-h-[360px] divide-y overflow-y-auto thin-scroll">
          {[...state.leaves].sort((a, b) => a.date.localeCompare(b.date)).map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
              <span className="num w-24 shrink-0">{d(l.date)}</span>
              <span className="min-w-0 flex-1 truncate">{userById[l.userId]?.name} <span className="text-muted-foreground">, {n(l.hours)} The clock, {l.requestId ? `Request # ${n(state.adminRequests.find((r) => r.id === l.requestId)?.no ?? 0)}` : l.by ? "Direct Registration of Administrative Director" : "Register before the office module"}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------------- Audit ----------------
function AuditAdmin() {
  const { state, userById, dispatch, can } = useStore()
  const { time } = useFmt()
  const [kind, setKind] = useState('all')
  const KINDS: Record<string, string> = { status: 'Status', allocation: 'Assignment', dates: 'Date', estimation: 'Estimation', sync: 'Sync', admin: 'Administration', task: 'Task', review: "Checkout", actual: 'Actual Date', security: "Access Rejection", points: 'Points', worklog: 'Work Log', request: 'Office Request', timesheet: 'Timesheet' }
  // lines about tasks the viewer may not open (the Finance & Administration space for Project Control) are not listed
  const list = state.audit.filter((a) => (kind === 'all' || a.kind === kind) && can.seeAudit(a))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger id="audit-kind" className="h-8 w-[160px] text-[12.5px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All changes</SelectItem>{Object.entries(KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-[12px] text-muted-foreground">Any status changes, allocations, dates, workflows and any rejected attempts are recorded without access.</span>
      </div>
      <div className="overflow-hidden glass-card">
        <ul className="divide-y">
          {list.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
              <span className="w-24 shrink-0 text-[11.5px] text-muted-foreground">{time(a.at)}</span>
              <span className={cn('rounded px-1.5 py-0.5 text-[11px]', a.kind === 'security' ? 'bg-danger-soft text-destructive' : 'bg-secondary')}>{KINDS[a.kind]}</span>
              <span className="min-w-0 flex-1">{a.text}</span>
              {a.taskId && state.tasks[a.taskId] && can.viewTask(state.tasks[a.taskId]) && <button className="inline-flex items-center gap-1 text-[12px] text-azure hover:underline" onClick={() => dispatch({ type: 'openTask', id: a.taskId! })}>{state.tasks[a.taskId].docNumber ?? state.tasks[a.taskId].name}<ArrowUpLeft className="h-3 w-3" /></button>}
              <span className="text-[12px] text-muted-foreground">{userById[a.userId]?.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------------- Decisions log ----------------
const DECISIONS: { tag: 'prompt' | 'demo' | 'open'; text: string }[] = [
  { tag: 'prompt', text: "The Revit team is connected to the project along with Phase 2 work. In this example, Stage \"BIM model\" goes to the Revit team." },
  { tag: 'prompt', text: "The main database is PostgreSQL. Google Sheet is the MDR source and destination of 3 columns, not original databases." },
  { tag: 'prompt', text: "Weight is given on parent rows. If the weight of children is empty, the weight of the parent is divided equally and reported in Sync Review." },
  { tag: 'prompt', text: "The change of available rows (name, weight, floor, displacement) is also Diffused and confirmed in the queue. The deleted row will only get a \"Removed from MDR\" sign." },
  { tag: 'prompt', text: "Due Date is the same as Plan Issue Date. The Map Issue Date in MDR is only a demo reference and does not sync." },
  { tag: 'prompt', text: "Progress Task comes from its Status, and Parent Progress is calculated with Weight." },
  { tag: 'prompt', text: "R&D is like fixed team project control (Fixed) and involved in all projects: on each project's page it has its own fever, the task of the project is assigned to it or its members, its members see the tasks and chats of all projects, and it's also counted in Workload." },
  { tag: 'demo', text: "The CEO, technical manager and project managers are members of the management team." },
  { tag: 'demo', text: "Roles replaced three previous roles: Admin → Manager, Control ← Project Control, Member ↑ Team member and supervisor of each team ↡ Team Supervisor. System manager is the same as Project Control (users, roles and settings). Matrix is in the tab \"Rolls and Permissions\"." },
  { tag: 'demo', text: "The project control section (Workload, Sync queues and performances, management and privileges report) is only for the manager and control of the project; in the menu, dashboard and project page are not displayed to others and its operations are recorded for others." },
  { tag: 'demo', text: "Rating: Point = (W.F. ÷ Estimation) × 100 × person hours of acceleration or delay; person hours = working day (Saturday to Wednesday, no holidays) ñ 8. The actual end is the basis for the task of the reviewer, the date of approval." },
  { tag: 'demo', text: "The rating office is only add-on: reopening, changing Due/Estimation/W.F or recalculating a return row and making a new row if needed; for each task there is always a maximum of one active row." },
  { tag: 'demo', text: "The score of the sample data's finished tasks was calculated with version 1 of the parameters once during launch (the \"primary calculation\" tag). The default W.F. was determined and can be changed based on the type of work." },
  { tag: 'demo', text: "Each pre-executive operation is checked by access rules (not just by hiding the button). The rejected operation does not change any data and is recorded in AuditLog with the label \"Reject Access\"." },
  { tag: 'demo', text: "Actual Start is recorded by first going to the working situation, and true Finish is recorded by reaching Down status or approval from the reviewer. Manual modification is only done by controlling the project or the manager and by mentioning the reason." },
  { tag: 'demo', text: "The note that the reviewer is not directly down; the performer “sends to check” and the reviewer confirms or returns with reason. Each review round is recorded separately." },
  { tag: 'demo', text: "Team space tasks are not counted in Progress, Report, and Workload projects, and only members of the same team and their CEO see them." },
  { tag: 'demo', text: "Work Log: Each user record has the duration, date, explanation and time of registration, and the project and team keep the same moment until future reports (each person, each team, each project) remain true. Edit keeps the previous value in the record history and deletion only removes the mark." },
  { tag: 'demo', text: "Time registration: responsible, participants, reviewer, reporter and team responsible, just for themselves and not for the future date; total one person in a day up to 24 hours. Everyone sees their own records; manager, project management, project manager and supervisor of the same team records all. Their record is editable and deleteable until the closure of the task; CEO and project control make each record with reason." },
  { tag: 'demo', text: "Time Progress = Logged Time ÷ Original Estimation × 100. Original Estimation is the first stimulator and does not change; if Estimation changes later, the current value will be displayed next to it. Below 80% normal, 80 to 100% close to the ceiling, more than 100% pass through Estimation." },
  { tag: 'open', text: "Attachments in this version are kept in the memory of the page (up to 3 MB per file) and deleted by reloading; in the server version they are stored in the storage space of the file." },
  { tag: 'open', text: "Lunar holidays move every year. In this example, only a fixed solar holiday and a test break have arrived." },
  { tag: 'demo', text: "The allocation to one person is reduced both from the capacity of that person and from the remaining capacity of the team, so that the team will never exceed the capacity." },
  { tag: 'demo', text: "Manual subtasks under a document are not counted in the progress of that document; Progress document is from its own status and is written into the MDR." },
  { tag: 'demo', text: "\"Removed from MDR\" tasks are not considered progress by the parent in Roll-up." },
  { tag: 'demo', text: "Because statuses can vary in each section, the Kanban board is displayed for each Status Set separately." },
  { tag: 'demo', text: "Member only changes the status of his or her own and team's tasks. The task is manual, sub-task and allocation with project control." },
  { tag: 'demo', text: "Write-back delay two minutes after the last status change, and periodic sync every two hours on working days; both adjustable." },
  { tag: 'demo', text: "Sign in with username and password, without email. The user registers himself and does not log in until the administrator approves or controls the project (along with setting the team and role). This was replaced by the assumption of \"Login with Google\" in Prompt." },
  { tag: 'open', text: "Password policy (minimum length, forgotten password reset without email) should be specified. Proposal: Resetting only by the administrator or controlling the project from the user profile page." },
  { tag: 'demo', text: "Each project has a chat where members of the same project teams (fixed teams, Phase 1, Phase 2, Revit) and the CEO, manager and manager of the same Project are included; the monitoring and execution team is also a member of all the projects. Sync events, document issuance and auto-write-back are recorded in it." },
  { tag: 'demo', text: "Notifications for: assignment, change the Status of personal or team tasks, issue a document (for project control), tag with @ in comment or chat, new comments on your task, organizational notification, Sync events and request or account confirmation." },
  { tag: 'demo', text: "All hours and “today” are calculated and displayed in Tehran time, independent of the clock of the user’s device." },
  { tag: 'demo', text: "The post-planning leave does not rule out allocation; it is seen in the Workload as “over capacity” to reprogram project control." },
  { tag: 'prompt', text: "The manager and control of the project see the space of all teams, enter each team, take a rest and refer to the members of the same team. The task made is recorded in the same team space and the ownership of the team does not change. The construction of the \"internal project\" (the structure of the team space) is the same with the supervisor and CEO as before." },
  { tag: 'prompt', text: "Task fields are arranged in six groups A to F (identification and classification, people, timing and estimation, status and progress, review and attachment, dialogue and history). Package and Floor in ID, Plan Issue Date in Schedule, Weight and W.F. and Point in Status and Progress and are responsible for only in \"people\"." },
  { tag: 'prompt', text: "The “Financial and Administrative Space” section has two separate spaces: the financial space for the manager and the financial manager, the office space for the director and the administrative manager; each reading and writing in the service is reviewed for the same space, and the reviewer and contributors are responsible for the same spaces." },
  { tag: 'prompt', text: "Each project takes its own MDR link (Google Sheet) and is not defined without it. On each project's page, the \"MDR Project\" button (and Alt+M shortcut key) opens the same MDR in the new tab; the manager and control of the project register or change the link." },
  { tag: 'demo', text: "Tasks in the financial space and office space of Work Log are not rated, and in Workload, Report Points, Work Log Reports, Overtime Requests and AuditLog the management department (for project control) do not come, because they see those reports as other roles." },
]
function Decisions() {
  const { n } = useFmt()
  const TAG = { prompt: { l: "Supposedly fast", c: 'bg-secondary text-foreground' }, demo: { l: "Decision of this sample", c: 'bg-azure-soft text-azure-ink' }, open: { l: "Need for decision", c: 'bg-foreground text-background' } }
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-[12.5px] text-muted-foreground">The equivalent of docs/decisions-log.md. prompt assumptions and decisions made in making this sample, to confirm the CEO.</p>
      <ol className="overflow-hidden glass-card">
        {DECISIONS.map((x, i) => (
          <li key={i} className="flex items-start gap-3 border-b px-4 py-3 text-[13px] last:border-0">
            <span className="num mt-0.5 w-6 shrink-0 text-muted-foreground">{n(i + 1)}</span>
            <span className="min-w-0 flex-1 leading-relaxed">{x.text}</span>
            <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', TAG[x.tag].c)}>{TAG[x.tag].l}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
