import { systemLabel } from '@/lib/displayLabels'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Initials, Bar } from '@/components/common'
import { isFlowTask, statusOf, taskProgress } from '@/lib/domain'
import { TODAY } from '@/lib/seed'
import { has } from '@/lib/policy'
import { useFmt, useStore, type State } from '@/lib/store'
import type { Task } from '@/lib/types'

export function activityStatus(state: State, task: Task) {
  if (isFlowTask(task)) {
    if (task.flow === 'closed') return 'done'
    return task.flow && !['open', 'assigned'].includes(task.flow) ? 'doing' : 'todo'
  }
  return statusOf(state, task)?.category ?? 'todo'
}

export function TeamActivity({ compact = false, onViewAll, teamId, userId }: { compact?: boolean; onViewAll?: () => void; teamId?: string; userId?: string }) {
  const { state, me, activeUsers, workItems, dispatch, teamById, can } = useStore()
  const { dShort, n, pct } = useFmt()
  const [showAll, setShowAll] = useState(false)
  const tasksByPerson = new Map<string, Task[]>()
  const tasks = [...workItems, ...Object.values(state.tasks).filter((task) => isFlowTask(task) && can.viewTask(task))]
  for (const task of tasks) {
    if (task.removedFromMdr || !task.assigneeUserId) continue
    const assigned = tasksByPerson.get(task.assigneeUserId) ?? []
    assigned.push(task)
    tasksByPerson.set(task.assigneeUserId, assigned)
  }
  const members = activeUsers.filter((user) => user.id === me.id || user.teamId === me.teamId || has(me, 'plan.all') || has(me, 'admin.reports') || tasksByPerson.has(user.id))
    .filter((user) => (!teamId || user.teamId === teamId) && (!userId || user.id === userId))
    .sort((a, b) => (tasksByPerson.get(b.id)?.length ?? 0) - (tasksByPerson.get(a.id)?.length ?? 0) || a.name.localeCompare(b.name))
  const visibleMembers = compact && !showAll ? members.slice(0, 3) : members
  return <section className="glass-card min-w-0">
    <header className="studio-panel-header"><h2 className="studio-heading">Team Activity</h2>
      {compact && (onViewAll || members.length > 3) && <button type="button" className="studio-link" onClick={onViewAll ?? (() => setShowAll(!showAll))}>{showAll ? 'Show less' : 'View all'}</button>}
    </header>
    {members.length === 0 && <p className="studio-empty">No active team members.</p>}
    <div className={compact ? 'px-4 pb-3' : 'grid gap-3 p-4 lg:grid-cols-2'}>
      {visibleMembers.map((user) => {
        const assigned = tasksByPerson.get(user.id) ?? []
        const completed = assigned.filter((t) => activityStatus(state, t) === 'done')
        const active = assigned.filter((t) => activityStatus(state, t) === 'doing')
        const backlog = assigned.filter((t) => activityStatus(state, t) === 'todo')
        const pending = [...active, ...backlog].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
        const overdue = pending.filter((t) => t.due && t.due < TODAY)
        const upcoming = pending.filter((t) => t.due && t.due >= TODAY)
        const current = active[0] ?? overdue[0] ?? upcoming[0] ?? backlog[0]
        const groups = [
          { label: 'Overdue', tasks: overdue },
          { label: 'In Progress', tasks: active.filter((t) => !overdue.includes(t)) },
          { label: 'To Do', tasks: backlog.filter((t) => !overdue.includes(t)) },
          { label: 'Completed', tasks: completed },
        ]
        return <article key={user.id} className={compact ? 'studio-activity-entry border-b py-3 last:border-0' : 'glass-item min-w-0 rounded-xl p-4'}>
          <div className="flex items-start gap-3">
            <div className={compact ? "studio-activity-avatar" : undefined}><Initials user={user} size={compact ? 32 : 38} /></div>
            <div className="min-w-0 flex-1">
              <h3 className="break-words text-sm font-semibold"><bdi>{user.name}</bdi></h3>
              {user.title && <p className="text-xs text-muted-foreground"><bdi>{systemLabel(user.title)}</bdi></p>}
              {!compact && <p className="text-xs text-muted-foreground"><bdi>{teamById[user.teamId]?.name}</bdi></p>}
              {compact && <p className="text-xs text-muted-foreground">{n(assigned.length)} assigned · {n(active.length)} in progress · {n(completed.length)} completed</p>}
              {compact && current && <button className="mt-1 block w-full truncate text-start text-xs hover:underline" onClick={() => dispatch({ type: 'openTask', id: current.id })}><bdi>{current.name}</bdi> {current.due && <span className="text-muted-foreground">· {dShort(current.due)}</span>}</button>}
              {compact && <p className="text-xs text-muted-foreground">{upcoming.length ? n(upcoming.length) + ' upcoming' : 'No upcoming due dates'}</p>}
            </div>
          </div>
          {!compact && <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">{n(assigned.length)} assigned · {n(upcoming.length)} upcoming</p>
            {groups.map(({ label, tasks }) => <details key={label} className="group rounded-lg border px-3">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-sm"><span>{label} <span className="num text-muted-foreground">{n(tasks.length)}</span></span><ChevronDown className="size-4 group-open:rotate-180" /></summary>
              {tasks.length === 0 ? <p className="pb-2 text-xs text-muted-foreground">No tasks.</p> : <ul className="divide-y">{tasks.map((t) => <li key={t.id}>
                <button className="grid w-full gap-1 py-2 text-start hover:text-azure" onClick={() => dispatch({ type: 'openTask', id: t.id })}>
                  <span className="flex flex-wrap justify-between gap-1 text-sm"><bdi>{t.name}</bdi><span className="text-xs text-muted-foreground">{t.due ? 'Due ' + dShort(t.due) : 'No due date'}</span></span>
                  <span className="flex items-center gap-2 text-xs"><Bar value={taskProgress(state, t)} />{pct(taskProgress(state, t))}</span>
                </button>
              </li>)}</ul>}
            </details>)}
          </div>}
        </article>
      })}
    </div>
  </section>
}
