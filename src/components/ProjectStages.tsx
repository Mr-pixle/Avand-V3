import {projectProgressStyle} from '@/lib/brand'
import { useState } from 'react'
import { toast } from 'sonner'
import { useStore, useFmt, ancestors, isWorkItem } from '@/lib/store'
import { PROJECT_STAGES, STAGE_FA, projectProgress, taskStage } from '@/lib/projectProgress'
import { SCOPE_FA, taskScope, WORK_SCOPES } from '@/lib/organization'
import { guard } from '@/lib/policy'
import type { ProjectStage, Task, WorkScope } from '@/lib/types'
import { Bar } from './common'
import { Button } from './ui/button'
import { Label } from './ui/label'

const css = 'mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm'
export function StageSummary({ projectId }: { projectId: string }) {
  const { state } = useStore()
  const { n } = useFmt()
  const report = projectProgress(state, projectId)
  return <div className="flex flex-col gap-2">{report.stages.map((row) => <div key={row.stage} className="grid grid-cols-[minmax(0,1fr)_70px_40px] items-center gap-2 text-xs"><span>{STAGE_FA[row.stage]}</span><Bar project value={row.progress ?? 0} /><span className="num text-end">{row.progress == null ? '—' : `${n(Math.round(row.progress))}%`}</span></div>)}<p className="text-xs text-muted-foreground">{n(report.classifiedCount)} from {n(report.totalCount)} Task Classified{report.unclassified.length ? ` · ${n(report.unclassified.length)} need a stage` : ''}</p></div>
}

export function ProjectStages({ projectId, selected, onSelect }: { projectId: string; selected: string; onSelect: (v: string) => void }) {
  const { state, can, dispatch } = useStore()
  const { n } = useFmt()
  const report = projectProgress(state, projectId)
  const [branch, setBranch] = useState('unclassified')
  const [stage, setStage] = useState<ProjectStage>('studies')
  const [scope, setScope] = useState('')
  const nodes = Object.values(state.tasks).filter((t) => t.projectId === projectId && !isWorkItem(t) && ['phase', 'stage', 'group', 'doctype'].includes(t.kind))
  const editable = Object.values(state.tasks).filter((t) => t.projectId === projectId && isWorkItem(t) && !t.removedFromMdr && can.planTask(t))
  const targets = editable.filter((t) => branch === 'all' || (branch === 'unclassified' ? !taskStage(state.tasks, t) : ancestors(state.tasks, t).some((p) => p.id === branch)))
  const apply = () => {
    const action = { type: 'classifyTasks', ids: targets.map((t) => t.id), projectStage: stage, ...(scope ? { workScope: scope as WorkScope } : {}) } as const
    const error = guard(state, action)
    if (error) { toast.error(error); return }
    dispatch(action)
  }
  return <section className="glass-card p-4" aria-label="Project Stages Report"><h2 className="font-semibold">Progress of architectural stages</h2><p className="mt-1 text-xs text-muted-foreground">Common basis of calculation: {report.mode === 'weight' ? "Recorded Weight of Tasks" : report.mode === 'effort' ? "The clock is estimated" : "Weight equal to Tasks (weight or estimate is not complete)"}The underlying documents and items removed from the MDR are not re-counted. &quot;&quot; — That is, the stage still has no computable task.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{report.stages.map((r) => <button key={r.stage} onClick={() => onSelect(r.stage)} aria-pressed={selected === r.stage} className={`rounded-xl border p-3 text-start ${selected === r.stage ? 'border-azure bg-azure-soft' : ''}`}><div className="text-xs">{STAGE_FA[r.stage]}</div><div className="num my-2 text-lg font-semibold" style={r.progress==null?undefined:projectProgressStyle(r.progress)}>{r.progress == null ? '—' : `${n(Math.round(r.progress))}%`}</div><Bar project value={r.progress ?? 0} /><div className="num mt-2 text-xs text-muted-foreground">{n(r.count)} Task</div></button>)}</div>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><Button variant={selected === 'all' ? 'default' : 'outline'} size="sm" onClick={() => onSelect('all')}>All stages</Button><Button variant={selected === 'unclassified' ? 'default' : 'outline'} size="sm" onClick={() => onSelect('unclassified')}>Unclassified ({n(report.unclassified.length)})</Button><span>The progress of the stages is classified: <b className="num">{report.total == null ? '—' : `${n(Math.round(report.total))}%`}</b></span></div>
    {report.unclassified.length > 0 && <p className="mt-2 text-xs text-warning-ink">{n(report.unclassified.length)} The task is not yet stage; the percentage displayed to determine the stage is not the complete view of the project.</p>}
    {editable.length > 0 && <details className="mt-4 rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">I'm a member of the group of self-indulgence</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><Label htmlFor="stage-branch">Branch or Set</Label><select id="stage-branch" className={css} value={branch} onChange={(e) => setBranch(e.target.value)}><option value="unclassified">Non-staged</option><option value="all">All project editable tasks</option>{nodes.map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}</select></div><div><Label htmlFor="stage-bulk">Stage of architecture</Label><select id="stage-bulk" className={css} value={stage} onChange={(e) => setStage(e.target.value as ProjectStage)}>{PROJECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_FA[s]}</option>)}</select></div>{can.perm('plan.all') && <div><Label htmlFor="scope-bulk">Responsible Phase</Label><select id="scope-bulk" className={css} value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Maintain current phase</option>{WORK_SCOPES.map((s) => <option key={s} value={s}>{SCOPE_FA[s]}</option>)}</select></div>}<div className="flex items-end"><Button disabled={!targets.length} onClick={apply}>Apply Zinc {n(targets.length)} Task</Button></div></div><p className="mt-2 text-xs text-muted-foreground">The current phase of the tasks of this complex is replaced by the above choice; other projects and responsibilities of individuals do not change.</p></details>}
  </section>
}

export function TaskStageFields({ task }: { task: Task }) {
  const { state, can, dispatch } = useStore()
  const [stage, setStage] = useState(taskStage(state.tasks, task) ?? '')
  const [scope, setScope] = useState(taskScope(state.tasks, task) ?? '')
  const save = () => {
    const patch = { ...(stage ? { projectStage: stage as ProjectStage } : {}), ...(can.perm('plan.all') && scope ? { workScope: scope as WorkScope } : {}) }
    const action = { type: 'updateTask', taskId: task.id, patch } as const
    const error = guard(state, action)
    if (error) { toast.error(error); return }
    dispatch(action)
  }
  return <div className="my-3 grid gap-3 rounded-xl border p-3 sm:grid-cols-2"><div><Label htmlFor="task-project-stage">Stage of architecture</Label><select id="task-project-stage" className={css} disabled={!can.planTask(task)} value={stage} onChange={(e) => setStage(e.target.value)}><option value="" disabled>Uncategorized</option>{PROJECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_FA[s]}</option>)}</select></div><div><Label htmlFor="task-work-scope">Responsible Phase</Label><select id="task-work-scope" className={css} disabled={!can.perm('plan.all')} value={scope} onChange={(e) => setScope(e.target.value)}><option value="" disabled>Unassigned</option>{WORK_SCOPES.map((s) => <option key={s} value={s}>{SCOPE_FA[s]}</option>)}</select></div>{can.planTask(task) && <Button size="sm" variant="outline" onClick={save}>Save the responsible stage and phase</Button>}</div>
}
