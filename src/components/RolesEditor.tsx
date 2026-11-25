import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { defaultRole, roleLabel, type RoleDefinition } from '@/lib/accessRoles'
import { PERM_FA, ROLE_ORDER, type Perm } from '@/lib/policy'
import { useStore } from '@/lib/store'
import { useWorkspaceSave } from '@/lib/useWorkspaceSave'

const columns = ['View', 'Create', 'Edit', 'Delete', 'Approve', 'Manage'] as const
type Group = [string, Partial<Record<(typeof columns)[number], Perm[]>>]
const groups: Group[] = [
  ['Projects', { View: ['project.view'], Create: ['project.create'], Edit: ['project.edit', 'staffing.edit'], Manage: ['project.define', 'sync.run'] }],
  ["Teams and Users", { View: ['teamspace.all'], Create: ['team.create'], Edit: ['team.edit'], Approve: ['users.approve'], Manage: ['users.manage', 'roles.manage'] }],
  ["Tasks", { View: ['task.view'], Create: ['task.create', 'supervision.create'], Edit: ['task.edit', 'plan.all', 'status.all', 'actual.edit'], Delete: ['task.delete'], Approve: ['supervision.review.all'], Manage: ['statuses.manage'] }],
  ["Requests and Timesheets", { View: ['timesheet.view.all'], Create: ['requests.create', 'leave.direct'], Edit: ['requests.it', 'timesheet.edit.all'], Approve: ['requests.office', 'requests.ceo'], Manage: ['timesheet.close'] }],
  ["Reports and System", { View: ['admin.view', 'control.section', 'audit.view', 'workload.view', 'admin.reports', 'worklog.view.all'], Create: ['announce.post'], Manage: ['calendar.manage', 'points.manage', 'worklog.manage'] }],
  ["Finance and Administrative", { Manage: ['fin.finance', 'fin.office', 'fin.shared'] }],
  ["Library", { View: ['library.view'], Create: ['library.create'], Edit: ['library.edit'], Delete: ['library.delete'] }],
  ['Whiteboard', { View: ['whiteboard.view'], Create: ['whiteboard.create'], Edit: ['whiteboard.edit'], Delete: ['whiteboard.delete'] }],
]

export function RolesEditor() {
  const { state, can } = useStore()
  const { save, busy } = useWorkspaceSave()
  const [draft, setDraft] = useState<RoleDefinition>()
  const [userId, setUserId] = useState('')
  const [assignId, setAssignId] = useState('')
  const [confirmation, setConfirmation] = useState<'save' | 'delete' | 'assign'>()
  const roles = [...ROLE_ORDER.map(id => state.roleDefinitions[id] ?? defaultRole(id)), ...Object.values(state.roleDefinitions).filter(r => r.id.startsWith('role-'))]
  const writable = can.perm('roles.manage')
  const locked = !writable || draft?.id === 'ceo'
  const toggle = (permissions: Perm[], checked: boolean) => setDraft(role => role && ({
    ...role, permissions: checked ? [...new Set([...role.permissions, ...permissions])] : role.permissions.filter(p => !permissions.includes(p)),
  }))
  const confirm = async () => {
    const ok = confirmation === 'assign' ? await save({ type: 'roleAssign', userId, roleId: assignId }) :
      confirmation === 'save' && draft ? await save({ type: 'roleSave', role: draft }) :
      confirmation === 'delete' && draft ? await save({ type: 'roleDelete', id: draft.id }) : false
    if (!ok) return
    if (confirmation === 'delete') setDraft(undefined)
    setConfirmation(undefined)
  }

  return <section className="glass-card space-y-4 p-4">
    <div className="flex flex-wrap gap-2">
      <select className="rounded-md border bg-card p-2" aria-label="Role selection" value={draft?.id ?? ''} onChange={e => { setConfirmation(undefined); setDraft(roles.find(role => role.id === e.target.value)) }}>
        <option value="">Role selection</option>
        {draft && !roles.some(r => r.id === draft.id) && <option value={draft.id}>New Role</option>}
        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {writable && <Button variant="outline" onClick={() => { setConfirmation(undefined); setDraft({ id: 'role-' + crypto.randomUUID(), name: '', description: '', permissions: [] }) }}>New Role</Button>}
    </div>
    {draft && <>
      <label className="block">Role Name<Input maxLength={80} disabled={locked} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="block">Description<Textarea maxLength={400} disabled={locked} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[850px] text-start text-sm">
          <thead><tr><th className="p-2 text-start">Modules</th>{columns.map(col => <th key={col} className="p-2 text-start">{col}</th>)}</tr></thead>
          <tbody>{groups.map(([name, cells]) => {
            const all = Object.values(cells).flat().filter(p => p !== 'roles.manage')
            return <tr key={name} className="border-t align-top">
              <th className="p-2 text-start"><label className="flex gap-2"><input type="checkbox" disabled={locked} checked={all.every(p => draft.permissions.includes(p))} onChange={e => toggle(all, e.target.checked)} />{name}</label></th>
              {columns.map(col => <td className="p-2" key={col}>{(cells[col] ?? []).map(p => <label key={p} className="mb-1 flex gap-2"><input type="checkbox" disabled={locked || p === 'roles.manage'} checked={draft.permissions.includes(p)} onChange={e => toggle([p], e.target.checked)} />{PERM_FA[p]}</label>)}</td>)}
            </tr>
          })}</tbody>
        </table>
      </div>
      {draft.id === 'ceo' && <p className="text-sm text-muted-foreground">The role of the manager is protected to maintain system management access.</p>}
      {!locked && <div className="flex gap-2">
        <Button disabled={!draft.name.trim() || busy} onClick={() => setConfirmation('save')}>Review and Save</Button>
        {state.roleDefinitions[draft.id] && draft.id.startsWith('role-') && <Button variant="destructive" disabled={busy} onClick={() => setConfirmation('delete')}>Remove Role</Button>}
      </div>}
    </>}
    {writable && <fieldset className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
      <legend>Role allocation to the user</legend>
      <label className="grid gap-1">User<select className="rounded-md border bg-card p-2" value={userId} onChange={e => { setUserId(e.target.value); setConfirmation(undefined) }}><option value="">Select user</option>{state.users.filter(u => u.role !== 'ceo' && u.status !== 'pending').map(u => <option key={u.id} value={u.id}>{u.name} · {roleLabel(state.roleDefinitions, u)}</option>)}</select></label>
      <label className="grid gap-1">Role<select className="rounded-md border bg-card p-2" value={assignId} onChange={e => { setAssignId(e.target.value); setConfirmation(undefined) }}><option value="">Role selection</option>{roles.filter(r => r.id !== 'ceo').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <Button variant="outline" disabled={!userId || !assignId || busy} onClick={() => setConfirmation('assign')}>Revision of allocation</Button>
    </fieldset>}
    {confirmation && <div role="alert" className="rounded-lg border bg-warning-soft p-3 text-warning-ink">
      <p>{confirmation === 'save' ? "The selected permissions apply to all users of this role." : confirmation === 'delete' ? "This custom role will be removed." : "Permissions for the chosen role apply to the user."}</p>
      <div className="mt-2 flex gap-2"><Button disabled={busy} onClick={() => void confirm()}>Final Approval</Button><Button variant="outline" disabled={busy} onClick={() => setConfirmation(undefined)}>Cancel</Button></div>
    </div>}
  </section>
}
