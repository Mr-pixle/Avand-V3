import { TeamName } from '@/components/ItemIcon'
import { supervisionStatuses,supervisionStatus } from '@/lib/supervision'
import { SupervisionStatusSelect } from './SupervisionWorkflow'
import { TaskStageFields } from './ProjectStages'
import { taskScope, scopeTeam, SCOPE_FA } from '@/lib/organization'
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, CheckCircle2, CornerDownLeft, FileSpreadsheet, History, Link2, Lock, MapPin, MessageSquare, Pencil, Play, Plus, RotateCcw, Send, Sparkles, Undo2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ancestors, effectiveScope, FIN_SPACE_FA, finSpaceOf, flowOf, flowProgress, isFinTask, isFlowTask, isWorkItem, projectTeams, statusesFor, statusOf, useFmt, useStore, WRITEBACK_DELAY_SEC, type NewFile } from '@/lib/store'
import { canSeeFinSpace, isProjectWideManager } from '@/lib/policy'
import { isSupervisionMember } from '@/lib/domain'
import { FIELD_GROUPS, hasField, L, LU, type FieldGroupId } from '@/lib/taskFields'
import { TaskScore } from './PointsViews'
import { WorkLogPanel } from './WorkLogPanel'
import { toAllocations, type Resource } from '@/lib/planning'
import { TODAY } from '@/lib/seed'
import type { FlowState, Priority, Task, TaskType, User } from '@/lib/types'
import { Initials, JalaliDateField, ProgressRing, StatusPill } from './common'
import { MentionInput, RichText } from './Mention'
import { AttachmentList, FilePicker, FlowPill, PRIORITY_FA, PriorityChip, TYPE_FA, UserSelect } from './FlowViews'

const KIND_FA: Record<string, string> = { phase: 'Phase', stage: 'Stage', group: 'Group', doctype: 'Doc Type', document: 'Document', manual: 'New Manual Task', supervision: "Site Supervision Task", internal: "Team Task", finadmin: "Finance and Administration Task" }
/** Sections A–F come from lib/taskFields.ts: the same groups order every task table and filter bar */
const SECTIONS = FIELD_GROUPS
type SecId = FieldGroupId
const DetailTab = createContext<SecId>('a')

export function TaskDrawer() {
  const { state, dispatch, can } = useStore()
  const t = state.openTaskId ? state.tasks[state.openTaskId] : undefined
  const visible = !!t && can.viewTask(t)
  return (
    <Dialog open={visible} onOpenChange={(o) => !o && dispatch({ type: 'openTask', id: null })}>
      <DialogContent className="flex h-[min(92dvh,760px)] w-[calc(100%_-_1rem)] max-w-[920px] flex-col gap-0 overflow-hidden p-0" dir="ltr" id="task-drawer-scroll">
        {t && visible && <DrawerBody key={t.id} t={t} />}
      </DialogContent>
    </Dialog>
  )
}

function Section({ id, aside, children }: { id: SecId; aside?: React.ReactNode; children: React.ReactNode }) {
  const s = SECTIONS.find((x) => x.id === id)!
  const active = useContext(DetailTab)
  const heading = useId()
  return (
    <section hidden={active !== id} className="scroll-mt-14 border-b px-5 py-4" aria-labelledby={heading}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 id={heading} className="flex items-center gap-2 text-[13px] font-semibold" title={s.about}>
          <span className="mono inline-flex h-5 w-5 items-center justify-center rounded-md bg-foreground text-[10.5px] font-bold text-background" aria-hidden="true">{s.letter}</span>{s.title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}
const LockNote = ({ text }: { text: string }) => <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground"><Lock className="h-3 w-3" /> {text}</span>
const jump = (id: SecId) => document.getElementById(`detail-tab-${id}`)?.click()
/** Read-only value in the same label/value form everywhere on the task page */
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={cn('min-w-0', className)}><dt className="eyebrow">{label}</dt><dd className="mt-0.5 truncate text-[13px]">{children}</dd></div>
}

function DrawerBody({ t }: { t: Task }) {
  const store = useStore()
  const { state, projectById, teamById, dispatch } = store
  const path = ancestors(state.tasks, t).reverse()
  const project = projectById[t.projectId]
  const leaf = isWorkItem(t) || isFlowTask(t)
  const ip = t.internalProjectId ? state.internalProjects.find((p) => p.id === t.internalProjectId) : undefined
  const flowShown: FlowState | null = isFlowTask(t) ? flowOf(t) : t.flow === 'in_review' || t.flow === 'rework' ? t.flow : null
  const close = () => dispatch({ type: 'openTask', id: null })
  const [tab, setTab] = useState<SecId>('a')
  const [archiveConfirm,setArchiveConfirm]=useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const selectTab = (value: SecId) => { setTab(value); if (panel.current) panel.current.scrollTop = 0 }
  return (
    <DetailTab.Provider value={tab}><div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b bg-foreground/[0.03] px-5 pb-3 pt-5">
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {t.kind === 'internal' ? (
            <button className="hover:text-foreground hover:underline" onClick={() => { close(); dispatch({ type: 'nav', nav: { page: 'team', teamId: t.teamSpaceId } }) }}>Team Space <TeamName team={teamById[t.teamSpaceId ?? '']} /></button>
          ) : isFinTask(t) ? (
            <button className="hover:text-foreground hover:underline" onClick={() => { close(); dispatch({ type: 'nav', nav: { page: 'finadmin', space: finSpaceOf(t) } }) }}>Financial and Administrative Space › {FIN_SPACE_FA[finSpaceOf(t) ?? 'finance']}</button>
          ) : (
            <button className="hover:text-foreground hover:underline" onClick={() => { close(); dispatch({ type: 'nav', nav: { page: 'project', projectId: t.projectId } }) }}>{project?.name}</button>
          )}
          {t.kind === 'supervision' && <span>› Monitoring and Implementation</span>}
          {ip && <span>› {ip.name}</span>}
          {path.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5"><span>›</span>
              <button className="hover:text-foreground hover:underline" onClick={() => dispatch({ type: 'openTask', id: p.id })}>{p.name}</button>
            </span>
          ))}
        </div>
        <DialogTitle className="mt-2 pe-8 text-lg font-bold leading-snug">{t.name}</DialogTitle>
        <DialogDescription asChild>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="rounded border bg-background px-1.5 py-0.5">{isFinTask(t) ? (finSpaceOf(t) === 'office' ? "Office Task" : "Financial Task") : t.parentId && state.tasks[t.parentId]&&isWorkItem(state.tasks[t.parentId]) && t.kind === 'manual' ? 'SubTask' : KIND_FA[t.kind]}</span>
            {!isFlowTask(t) && (
              <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5', t.source === 'mdr' ? 'bg-azure-soft text-azure-ink' : 'bg-secondary text-secondary-foreground')}>
                {t.source === 'mdr' ? <><FileSpreadsheet className="h-3 w-3" /> the MDR</> : "Hand-held"}
              </span>
            )}
            {t.docNumber && <span className="mono text-foreground">{t.docNumber}</span>}
            {flowShown && <FlowPill state={flowShown} task={t} />}<SupervisionStatusSelect task={t} />
            <PriorityChip p={t.priority} />
            {t.removedFromMdr && <span className="rounded bg-danger-soft px-1.5 py-0.5 text-destructive">Removed from MDR — Automatic removal not done</span>}
          </div>
        </DialogDescription>
        {isFinTask(t)&&canSeeFinSpace(store.me,finSpaceOf(t))&&<div className="mt-2 flex flex-wrap items-center gap-2">{t.archivedAt?<Button size="sm" variant="outline" onClick={()=>dispatch({type:'finTaskArchive',taskId:t.id,archived:false})}>Restore Archived Task</Button>:archiveConfirm?<><span className="text-xs">Archive this task? History and attachments will be retained.</span><Button size="sm" variant="destructive" onClick={()=>{dispatch({type:'finTaskArchive',taskId:t.id,archived:true});setArchiveConfirm(false)}}>Confirm Archive</Button><Button size="sm" variant="ghost" onClick={()=>setArchiveConfirm(false)}>Cancel</Button></>:<Button size="sm" variant="outline" onClick={()=>setArchiveConfirm(true)}>Archive Task</Button>}</div>}
        {t.kind==='supervision'&&<div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">{t.creatorTeamId&&<span>Creator Team: {teamById[t.creatorTeamId]?.name??'—'}</span>}<span>Responsible Team: {teamById[t.assigneeTeamId??(t.assigneeUserId?store.userById[t.assigneeUserId]?.teamId:'')??'']?.name??'Unassigned'}</span>{t.reviewSourceTaskId&&<><span>Issued Date: {t.issuedDate??'—'}</span><span>Discipline: {teamById[t.disciplineTeamId??'']?.name??'—'}</span>{state.tasks[t.reviewSourceTaskId]&&<Button size="sm" variant="outline" onClick={()=>dispatch({type:'openTask',id:t.reviewSourceTaskId!})}>Source Task</Button>}</>}</div>}
        {!t.reviewSourceTaskId&&Object.values(state.tasks).filter(x=>x.reviewSourceTaskId===t.id&&store.can.viewTask(x)).map(x=><Button key={x.id} className="mt-2" size="sm" variant="outline" onClick={()=>dispatch({type:'openTask',id:x.id})}>Document Review</Button>)}
          <nav className="glass-seg mt-3 flex max-w-full gap-0.5 overflow-x-auto p-1 thin-scroll" role="tablist" aria-label="Entity details" onKeyDown={e => { const index = SECTIONS.findIndex(s => s.id === tab); const next = e.key === 'ArrowRight' ? (index + 1) % SECTIONS.length : e.key === 'ArrowLeft' ? (index + SECTIONS.length - 1) % SECTIONS.length : e.key === 'Home' ? 0 : e.key === 'End' ? SECTIONS.length - 1 : -1; if (next < 0) return; e.preventDefault(); selectTab(SECTIONS[next].id); document.getElementById(`detail-tab-${SECTIONS[next].id}`)?.focus() }}>
            {SECTIONS.map((s) => (
              <button key={s.id} id={`detail-tab-${s.id}`} role="tab" aria-selected={tab === s.id} aria-controls="entity-details-panel" tabIndex={tab === s.id ? 0 : -1} type="button" onClick={() => selectTab(s.id)} title={s.title} className={cn('inline-flex min-h-9 shrink-0 items-center rounded-lg px-2.5 text-xs transition-colors hover:bg-foreground/[0.06]', tab === s.id ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground')}>
                {s.title}
              </button>
            ))}
          </nav>
      </div>
      <div ref={panel} id="entity-details-panel" className="min-h-0 flex-1 overflow-y-auto thin-scroll" role="tabpanel" aria-labelledby={`detail-tab-${tab}`}>
      {leaf ? (isWorkItem(t) ? <WorkItemSections t={t} /> : <FlowSections t={t} />) : (
        <>
          <ParentBody t={t} />
          <Section id="e"><AttachmentList items={state.attachments.filter(a => a.taskId === t.id)} empty="No attachments." /></Section>
          <Section id="f"><CommentsSection t={t} /><AuditSection t={t} /></Section>
        </>
      )}
      </div></div></DetailTab.Provider>
  )
}

/** Project work items: assignment and schedule are one plan (capacity is checked on both), shared by sections B and C */
function WorkItemSections({ t }: { t: Task }) {
  const plan = usePlan(t)
  return (
    <>
      <SectionA t={t} />
      <SectionB t={t} plan={plan} />
      <PlanningSection t={t} plan={plan} />
      <Section id="c"><ActualDates t={t} /><WorkLogPanel t={t} /></Section>
      <SectionD t={t} />
      <SectionE t={t} />
      <Section id="f"><CommentsSection t={t} /><AuditSection t={t} /></Section>
    </>
  )
}
function FlowSections({ t }: { t: Task }) {
  return (
    <>
      <SectionA t={t} />
      <SectionB t={t} />
      <FlowPlanningSection t={t} />
      <Section id="c"><ActualDates t={t} />{hasField(t, 'worklog') && <WorkLogPanel t={t} />}</Section>
      <SectionD t={t} />
      <SectionE t={t} />
      <Section id="f"><CommentsSection t={t} /><AuditSection t={t} /></Section>
    </>
  )
}

// ---------------- parents (Phase / Stage / Group / Doc Type) ----------------
function ParentBody({ t }: { t: Task }) {
  const store = useStore()
  const { state, roll, kids, dispatch } = store
  const { n, d, pct } = useFmt()
  const r = roll[t.id]
  const ch = kids[t.id] ?? []
  const scope = effectiveScope(state, t)
  const own = !!state.statusSets[t.id]
  const canOverride = t.kind === 'phase' || t.kind === 'stage' || t.kind === 'group'
  const phase = taskScope(state.tasks, t)
  return (
    <>
      <Section id="a"><dl className="grid grid-cols-2 gap-3"><Field label="ID">{t.id}</Field><Field label="Title">{t.name}</Field><Field label="Project">{store.projectById[t.projectId]?.name ?? t.projectId}</Field>{phase && <Field label="Phase">{SCOPE_FA[phase]}</Field>}{t.description && <Field label="Description">{t.description}</Field>}</dl></Section>
      <Section id="b"><dl className="grid grid-cols-2 gap-3">{phase && store.projectById[t.projectId] && <Field label="Responsible team"><TeamName team={store.teamById[scopeTeam(store.projectById[t.projectId], phase)]} /></Field>}<Field label="Project manager">{store.userById[store.projectById[t.projectId]?.staffing?.[phase ?? 'phase1']?.managerId ?? store.projectById[t.projectId]?.managerId ?? '']?.name ?? 'Unassigned'}</Field></dl></Section>
      <Section id="c"><dl className="grid grid-cols-2 gap-3"><Field label="Estimation">{n(r?.est ?? 0)} h</Field><Field label="Date range">{d(r?.start)} – {d(r?.due)}</Field></dl></Section>
      <Section id="d">
        <h3 className="mb-3 text-[13px] font-semibold">Roll-up of subheadings</h3>
        <div className="flex items-center gap-4">
          <ProgressRing value={r?.progress ?? 0} size={64} stroke={5} />
          <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            <div><div className="eyebrow">Progress Weight</div><div className="num font-semibold">{pct(r?.progress ?? 0)}</div></div>
            <div><div className="eyebrow">Exported</div><div className="num font-semibold">{n(r?.done ?? 0)} from {n(r?.items ?? 0)}</div></div>
            <div><div className="eyebrow">Estimation</div><div className="num font-semibold">{n(r?.est ?? 0)} Person-hours</div></div>
            <div><div className="eyebrow">Date Range</div><div className="num font-semibold">{d(r?.start)} ← {d(r?.due)}</div></div>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">Parent’s Tasks Are Not Degradable And Estimation; Progress, Estimation, And Time Range Of Document And Sub-manual Tasks Are Collected. Parent’s Progress Is Weighted With Each Child’s Weight.</p>
        {(r?.unassigned ?? 0) > 0 && <p className="mt-2 text-[12px]"><span className="num font-semibold">{n(r.unassigned)}</span> This branch is located in the unassigned pool.</p>}
      </Section>
      {canOverride && (
        <Section id="d">
          <h3 className="mb-3 text-[13px] font-semibold">Status Set This section</h3>
          <div className="flex flex-wrap items-center gap-1.5">{state.statusSets[scope].map((s) => <StatusPill key={s.id} status={s} />)}</div>
          <p className="mt-2 text-[12px] text-muted-foreground">{own ? "This section has its own Status Set (Override) and subsections inherit it." : "It inherits from the higher part or project."} Management in “Management of States.”</p>
        </Section>
      )}
      <Section id="a">
        <h3 className="mb-3 text-[13px] font-semibold">Subdivisions ({n(ch.length)})</h3>
        <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-background/45">
          {ch.map((c) => {
            const cr = roll[c.id]
            return (
              <button key={c.id} className={cn('flex items-center gap-2 px-3 py-2 text-start text-[13px] hover:bg-foreground/[0.035]', c.removedFromMdr && 'opacity-60')} onClick={() => dispatch({ type: 'openTask', id: c.id })}>
                <ProgressRing task={c} value={cr?.progress ?? 0} size={18} stroke={2.5} label={false} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.weight != null && <span className={cn('num text-[11px]', c.weightDerived ? 'text-azure' : 'text-muted-foreground')}>Weight {n(c.weight, 1)}{c.weightDerived ? '*' : ''}</span>}
                {isWorkItem(c) && <StatusPill task={c} status={statusOf(state, c)} />}
              </button>
            )
          })}
        </div>
        {ch.some((c) => c.weightDerived) && <p className="mt-2 text-[11.5px] text-muted-foreground">* Weight of these documents was empty in MDR; the parent’s weight was equally divided.</p>}
      </Section>
    </>
  )
}

// ---------------- A. Identity and classification ----------------
function IdentityList({ t }: { t: Task }) {
  const { state, teamById } = useStore()
  const { n } = useFmt()
  const source = isWorkItem(t) ? (t.source === 'mdr' ? `MDR — Row ${n(t.mdrRow ?? 0)}` : "Hand-held")
    : t.kind === 'supervision' ? 'Site Supervision' : t.kind === 'internal' ? `Team Space ${teamById[t.teamSpaceId ?? '']?.name ?? ''}` : FIN_SPACE_FA[finSpaceOf(t) ?? 'finance']
  const parent = t.kind === 'manual' && t.parentId ? state.tasks[t.parentId] : undefined
  // a manual subtask is classified like the document it belongs to
  const pkg = t.pkg ?? parent?.pkg
  const floor = t.floor ?? parent?.floor
  return (
    <div className="mb-3 rounded-xl border bg-background/45 p-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Field label="ID"><span className="mono">{t.id}</span></Field>
        {hasField(t, 'docNumber') && <Field label={L('docNumber')}><span className="mono">{t.docNumber ?? parent?.docNumber ?? '—'}</span></Field>}
        <Field label={L('source')}>{source}</Field>
        {hasField(t, 'pkg') && <Field label={L('pkg')}><span className="mono">{pkg ?? '—'}</span></Field>}
        {hasField(t, 'floor') && <Field label={L('floor')}><span className="mono">{floor && floor !== '—' ? floor : '—'}</span></Field>}
      </dl>
      {t.source === 'mdr' && <p className="mt-2 text-[11px] text-muted-foreground">MDR identity and reference fields are synchronized. {t.mdrSourceName!==undefined?`Original MDR title: ${t.mdrSourceName}.`:'The display title may be edited locally.'}</p>}
      {parent && <p className="mt-2 text-[11px] text-muted-foreground">Zirtsk Document &quot;{parent.name}The package and floor are the same document.</p>}
    </div>
  )
}

function SectionA({ t }: { t: Task }) {
  const { state, dispatch, can, kids } = useStore()
  const { n } = useFmt()
  const editable = isFlowTask(t) ? can.manageFlow(t) : can.planTask(t)
  const init = { name: t.name, kind:t.kind, description: t.description ?? '', type: t.type ?? 'other', priority: t.priority ?? 'normal', location: t.location ?? '', ip: t.internalProjectId ?? 'none' }
  const [f, setF] = useState(init)
  const dirty = JSON.stringify(f) !== JSON.stringify(init)
  const save = () => {
    if (!f.name.trim()) { toast.error("The title is empty."); return }
    const patch: Partial<Task> = { description: f.description.trim() || undefined, priority: f.priority as Priority }
    if (hasField(t, 'type')) patch.type = f.type as TaskType
    if (isWorkItem(t)&&f.name.trim()!==t.name) patch.name = f.name.trim()
    if(isWorkItem(t)&&t.source==='manual'&&f.kind!==t.kind)patch.kind=f.kind
    if (isFlowTask(t)) Object.assign(patch, { name: f.name.trim(), location: t.kind === 'supervision' ? f.location.trim() || undefined : undefined })
    if (t.kind === 'internal' && !t.parentId) patch.internalProjectId = f.ip === 'none' ? undefined : f.ip
    dispatch({ type: 'updateTask', taskId: t.id, patch })
    toast.success("Specification of the relief is stored")
  }
  const sub = isWorkItem(t) ? (kids[t.id] ?? []).filter((c) => isWorkItem(c)&&!c.removedFromMdr&&!c.archivedAt) : t.kind === 'internal' ? Object.values(state.tasks).filter((c) => c.parentId === t.id) : []
  const [subName, setSubName] = useState('')
  const canAddSub = isWorkItem(t) ? can.perm('task.create')&&(can.planTask(t) || can.createProjectTask(t.projectId)) : t.kind === 'internal' && !t.parentId ? can.seeTeam(t.teamSpaceId ?? '') : false
  const addSub = () => {
    if (!subName.trim()) return
    if (isWorkItem(t)) {
      const statuses = statusesFor(state, t)
      dispatch({ type: 'addTask', task: { id: `M-${t.projectId}-${Date.now().toString(36)}`, projectId: t.projectId, parentId: t.id, kind: 'manual', workScope: taskScope(state.tasks, t), name: subName.trim(), source: 'manual', order: t.order + 0.5, statusId: statuses[0].id } })
    } else {
      dispatch({ type: 'createFlowTask', task: { id: `IN-${Date.now().toString(36).toUpperCase()}`, projectId: t.projectId, parentId: t.id, kind: 'internal', name: subName.trim(), source: 'manual', order: t.order + 0.5, teamSpaceId: t.teamSpaceId, internalProjectId: t.internalProjectId, priority: 'normal', type: t.type } })
    }
    setSubName('')
    toast.success("Zirtsk", { description: "For reference and planning, open it." })
  }
  return (
    <Section id="a" aside={!editable ? <LockNote text="Read Only" /> : undefined}>
      <IdentityList t={t} />
      {isWorkItem(t) && <TaskStageFields key={`${t.id}-${t.projectStage}-${t.workScope}`} task={t} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(isFlowTask(t) || isWorkItem(t)) && <div className="sm:col-span-2"><Label htmlFor="a-name" className="eyebrow">{L('name')}</Label><Input id="a-name" className="mt-1 h-9" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!editable||!!t.reviewSourceTaskId} /></div>}
        {isWorkItem(t)&&t.source==='manual'&&<div><Label htmlFor="a-kind" className="eyebrow">Item Type</Label><Select value={f.kind==='document'?'doctype':f.kind} onValueChange={v=>setF({...f,kind:v as Task['kind']})} disabled={!editable}><SelectTrigger id="a-kind" className="mt-1 h-9"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="manual">Task</SelectItem><SelectItem value="doctype">Doc Type</SelectItem></SelectContent></Select></div>}
        {hasField(t, 'type') && (
          <div>
            <Label htmlFor="a-type" className="eyebrow">{L('type')}</Label>
            <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v as TaskType })} disabled={!editable}>
              <SelectTrigger id="a-type" className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(TYPE_FA) as TaskType[]).map((k) => <SelectItem key={k} value={k}>{TYPE_FA[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="a-prio" className="eyebrow">{L('priority')}</Label>
          <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v as Priority })} disabled={!editable}>
            <SelectTrigger id="a-prio" className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(PRIORITY_FA) as Priority[]).map((k) => <SelectItem key={k} value={k}>{PRIORITY_FA[k]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {t.kind === 'supervision' && <div className="sm:col-span-2"><Label htmlFor="a-loc" className="eyebrow inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {L('location')}</Label><Input id="a-loc" className="mt-1 h-9" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} disabled={!editable} /></div>}
        {t.kind === 'internal' && !t.parentId && (
          <div className="sm:col-span-2">
            <Label htmlFor="a-ip" className="eyebrow">{L('internalProjectId')}</Label>
            <Select value={f.ip} onValueChange={(v) => setF({ ...f, ip: v })} disabled={!editable}>
              <SelectTrigger id="a-ip" className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Without an internal project</SelectItem>{state.internalProjects.filter((p) => p.teamId === t.teamSpaceId).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="sm:col-span-2"><Label htmlFor="a-desc" className="eyebrow">{L('description')}</Label><Textarea id="a-desc" className="mt-1 min-h-[64px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} disabled={!editable} placeholder={editable ? "Job Description, Range and Delivery Tips" : "Unregistered description"} /></div>
      </div>
      {editable && dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setF(init)}>Back!</Button>
          <Button size="sm" onClick={save}>Save Profile</Button>
        </div>
      )}

      {hasField(t, 'subtasks') && !(t.kind === 'internal' && t.parentId) && (
        <div className="mt-4">
          <div className="eyebrow mb-2">{L('subtasks')} ({n(sub.length)})</div>
          {!!t.mdrSubtasks?.length && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px]" id="mdr-subtasks">
              <span className="text-muted-foreground">Steps to work in MDR:</span>
              {t.mdrSubtasks.map((x) => <span key={x} className="rounded-full border bg-background/60 px-2 py-0.5">{x}</span>)}
            </div>
          )}
          {sub.length > 0 && (
            <div className="mb-2 flex flex-col divide-y overflow-hidden rounded-xl border bg-background/45">
              {sub.map((c) => (
                <button key={c.id} className="flex items-center gap-2 px-3 py-2 text-start text-[13px] hover:bg-foreground/[0.035]" onClick={() => dispatch({ type: 'openTask', id: c.id })}>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {isFlowTask(c) ? <FlowPill state={flowOf(c)} task={c} /> : <StatusPill task={c} status={statusOf(state, c)} />}
                </button>
              ))}
            </div>
          )}
          {canAddSub ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addSub() }}>
              <Input id="drawer-subtask" value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="For example: rendering, presentation, detail design" className="h-9" />
              <Button type="submit" variant="outline" className="h-9"><Plus className="h-4 w-4" /> Add</Button>
            </form>
          ) : <p className="text-[12px] text-muted-foreground">This makes it easy for the programmer to do so.</p>}
        </div>
      )}
    </Section>
  )
}

// ---------------- B. People ----------------
function PersonLine({ label, user, empty = '—' }: { label: string; user?: User; empty?: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 flex h-9 items-center gap-2 text-[13px]">{user ? <><Initials user={user} size={24} /><span className="truncate">{user.name}</span></> : <span className="text-muted-foreground">{empty}</span>}</div>
    </div>
  )
}

function SectionB({ t, plan }: { t: Task; plan?: Plan }) {
  const { state, dispatch, can, userById, teamById, activeUsers } = useStore()
  const flow = isFlowTask(t)
  const manage = flow ? can.manageFlow(t) : can.planTask(t)
  const f = flowOf(t)
  const [assignee, setAssignee] = useState<string | undefined>(t.assigneeUserId)
  const project = state.projects.find((p) => p.id === t.projectId)
  // the people a task can be given to are those of the space it lives in
  const executors = t.kind === 'internal' ? activeUsers.filter((u) => u.teamId === t.teamSpaceId) : isFinTask(t) ? activeUsers.filter((u) => canSeeFinSpace(u, finSpaceOf(t))) : project ? activeUsers.filter((u) => projectTeams(project).includes(u.teamId)) : activeUsers
  const reviewerPool = t.kind === 'supervision' ? activeUsers.filter((u) => isSupervisionMember(state,u)||u.role === 'inspector' || u.role === 'ceo') : t.kind === 'internal' || isFinTask(t) ? executors : activeUsers
  const reviewLocked = t.flow === 'in_review'
  const setReviewer = (id?: string) => {
    if (id && id === t.assigneeUserId) { toast.error("The reviewer cannot be responsible for this task."); return }
    if (t.kind === 'supervision' && !t.reviewSourceTaskId&&!id) { toast.error("The monitor should have a reviewer."); return }
    dispatch({ type: 'updateTask', taskId: t.id, patch: { reviewerId: id } })
    toast.success(id ? `Reviewer: ${userById[id]?.name}` : "Reviewer has been removed")
  }
  const parts = t.participantIds ?? []
  const addPart = (id?: string) => { if (id && !parts.includes(id)) dispatch({ type: 'updateTask', taskId: t.id, patch: { participantIds: [...parts, id] } }) }
  const removePart = (id: string) => dispatch({ type: 'updateTask', taskId: t.id, patch: { participantIds: parts.filter((x) => x !== id) } })
  const assignNow = () => {
    if (!assignee) return
    dispatch({ type: 'flow', taskId: t.id, op: 'assign', assigneeId: assignee })
    toast.success(`Reference to ${userById[assignee]?.name}`, { description: `${L('assignee')} was announced.` })
  }
  const lockText = !flow ? "Determine the people with the planner" : isFinTask(t) ? "Referral with a Task Manager or Manufacturer" : "Referral with supervisor or supervisor"
  return (
    <Section id="b" aside={!manage ? <LockNote text={lockText} /> : undefined}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {project && taskScope(state.tasks,t) && <><div><div className="eyebrow">Responsible team</div><TeamName team={teamById[scopeTeam(project,taskScope(state.tasks,t)!)]} /></div><PersonLine label="Project manager" user={userById[project.staffing?.[taskScope(state.tasks,t)!]?.managerId ?? project.managerId ?? '']} empty="Unassigned" /></>}
        {t.kind==='supervision'&&project&&<div className="sm:col-span-2"><Label>Responsible Team</Label><Select value={t.assigneeTeamId??(t.assigneeUserId?userById[t.assigneeUserId]?.teamId:undefined)??'none'} disabled={!manage||f==='closed'||f==='in_review'} onValueChange={v=>{if(v!=='none')dispatch({type:'flow',taskId:t.id,op:'assignTeam',assigneeId:v})}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none" disabled>Unassigned</SelectItem>{state.teams.filter(tm=>!tm.archived&&(t.reviewSourceTaskId?tm.kind==='supervision':projectTeams(project).includes(tm.id))).map(tm=><SelectItem key={tm.id} value={tm.id}>{tm.name}</SelectItem>)}</SelectContent></Select></div>}
        {flow ? (
          <div className="sm:col-span-2">
            <Label htmlFor="b-assignee" className="eyebrow">{L('assignee')}</Label>
            <div className="flex gap-2">
              <div className="flex-1"><UserSelect id="b-assignee" value={assignee} onChange={setAssignee} users={executors.filter((u) => u.id !== t.reviewerId&&(!t.reviewSourceTaskId||isSupervisionMember(state,u)))} grouped={t.kind === 'supervision'} noneLabel={`No ${L('assignee')}`} disabled={!manage || f === 'closed' || f === 'in_review'} /></div>
              {manage && assignee && assignee !== t.assigneeUserId && f !== 'closed' && f !== 'in_review' && <Button className="mt-1 h-9" onClick={assignNow}><Send className="h-4 w-4" /> References</Button>}
            </div>
          </div>
        ) : plan && <ResourceField t={t} plan={plan} />}
        <PersonLine label={L('reporter')} user={userById[t.reporterId ?? t.createdBy ?? '']} empty={t.source === 'mdr' ? 'MDR' : '—'} />
        <div>
          <Label htmlFor="b-reviewer" className="eyebrow">{L('reviewer')}</Label>
          <UserSelect id="b-reviewer" value={t.reviewerId} onChange={setReviewer} users={reviewerPool.filter((u) => u.id !== t.assigneeUserId)} noneLabel={t.kind === 'supervision' ? undefined : "No Reviewer"} disabled={!manage || reviewLocked} />
        </div>
        <div className="sm:col-span-2">
          <div className="eyebrow">{L('participants')}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {parts.map((id) => (
              <span key={id} className="inline-flex items-center gap-1.5 rounded-full border bg-background/60 py-0.5 pe-1 ps-0.5 text-[12px]">
                <Initials user={userById[id]} size={20} />{userById[id]?.name}
                {manage && <button type="button" className="rounded-full p-0.5 hover:bg-foreground/10" aria-label={`Deleted ${userById[id]?.name}`} onClick={() => removePart(id)}><X className="h-3 w-3" /></button>}
              </span>
            ))}
            {!parts.length && !manage && <span className="text-[12px] text-muted-foreground">—</span>}
            {manage && (
              <Select value="" onValueChange={(v) => addPart(v)}>
                <SelectTrigger id="b-add-part" className="h-8 w-[170px] text-[12px]"><SelectValue placeholder="+ Add Person" /></SelectTrigger>
                <SelectContent className="max-h-72">{executors.filter((u) => !parts.includes(u.id) && u.id !== t.assigneeUserId).map((u) => <SelectItem key={u.id} value={u.id}><span className="inline-flex items-center gap-2"><Initials user={u} size={18} />{u.name}</span></SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>
    </Section>
  )
}

/** Responsible person or team of a project work item. It is part of the plan: capacity is checked against the dates in section C. */
function ResourceField({ t, plan }: { t: Task; plan: Plan }) {
  const store = useStore()
  const { userById, teamById } = store
  const { res, setRes, canPlan, teamsOrdered, resDirty, validation, save } = plan
  return (
    <div className="sm:col-span-2">
      <Label htmlFor="drawer-assignee" className="eyebrow">{L('assignee')} (team or person)</Label>
      {canPlan ? (
        <Select value={resourceKey(res)} onValueChange={(v) => setRes(parseKey(v))}>
          <SelectTrigger id="drawer-assignee" className="mt-1 h-9"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-80">
            {store.can.assignTo(t, null) && <SelectItem value="none">Unassigned</SelectItem>}
            {store.activeUsers.filter((u) => !u.teamId && u.capacity > 0 && store.can.assignTo(t, { kind: 'user', id: u.id })).map((u) => <SelectItem key={u.id} value={`user:${u.id}`}>{u.name}</SelectItem>)}
            {teamsOrdered.map((tm) => (
              <SelectGroup key={tm.id}>
                <SelectLabel className="text-[11px] text-muted-foreground">{tm.name}</SelectLabel>
                {store.can.assignTo(t, { kind: 'team', id: tm.id }) && <SelectItem value={`team:${tm.id}`}><span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> The entire team {tm.name}</span></SelectItem>}
                {store.activeUsers.filter((u) => u.teamId === tm.id && u.capacity > 0 && store.can.assignTo(t, { kind: 'user', id: u.id })).map((u) => <SelectItem key={u.id} value={`user:${u.id}`}><span className="inline-flex items-center gap-2"><Initials user={u} size={20} />{u.name}</span></SelectItem>)}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div id="drawer-assignee" className="mt-1 flex h-9 items-center gap-2 text-[13px]">
          {t.assigneeUserId ? <><Initials user={userById[t.assigneeUserId]} size={24} />{userById[t.assigneeUserId]?.name}</>
            : t.assigneeTeamId ? <><Users className="h-4 w-4" /> Team <TeamName team={teamById[t.assigneeTeamId]} /></> : <span className="text-muted-foreground">Unassigned</span>}
        </div>
      )}
      {resDirty && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
          {validation && !validation.ok
            ? <button type="button" className="inline-flex items-center gap-1 font-medium text-destructive hover:underline" onClick={() => jump('c')}><AlertTriangle className="h-3.5 w-3.5" /> With Start and Due the current allocation becomes too much — Section C</button>
            : <span className="text-muted-foreground">The new allocation is measured with a starting to due (section C) range capacity.</span>}
          <Button size="sm" className="h-7" onClick={save}>Save allocation</Button>
        </div>
      )}
    </div>
  )
}

// ---------------- C. Schedule and effort (project work items) ----------------
function resourceKey(r: Resource | null) { return r ? `${r.kind}:${r.id}` : 'none' }
function parseKey(k: string): Resource | null {
  if (k === 'none') return null
  const [kind, id] = k.split(':')
  return { kind: kind as 'user' | 'team', id }
}

type Plan = ReturnType<typeof usePlan>
/** Draft of the plan of a work item: who (section B), how much and when (section C). One save, one capacity check. */
function usePlan(t: Task) {
  const store = useStore()
  const { state, dispatch, can, userById, teamById, projectById, me } = store
  const { n, d } = useFmt()
  const canPlan = can.planTask(t)
  const leadOnly = canPlan && me.role === 'lead' && !can.perm('plan.all') && !projectById[t.projectId]?.staffing && !isProjectWideManager(state,me,t.projectId) && !(t.source==='manual'&&t.createdBy===me.id)
  const initialRes: Resource | null = t.assigneeUserId ? { kind: 'user', id: t.assigneeUserId } : t.assigneeTeamId ? { kind: 'team', id: t.assigneeTeamId } : null
  const [res, setRes] = useState<Resource | null>(initialRes)
  const [est, setEst] = useState<string>(t.estimation ? String(t.estimation) : '')
  const [start, setStart] = useState<string | undefined>(t.start)
  const [due, setDue] = useState<string | undefined>(t.due)
  const estN = Number(est)
  const resDirty = resourceKey(res) !== resourceKey(initialRes)
  const dirty = resDirty || (t.estimation ?? '') !== (est ? estN : '') || t.start !== start || t.due !== due
  const planner = useMemo(() => store.planner(t.id), [state.allocations, state.leaves, state.holidays, t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const validation = useMemo(() => {
    if (!res || !start || !due || !estN) return null
    return planner.validate(res, start, due, estN)
  }, [planner, res, start, due, estN])
  const resName = res ? (res.kind === 'user' ? userById[res.id]?.name : `Team ${teamById[res.id]?.name}`) : ''
  const teamsOrdered = state.teams.filter((tm) => !tm.archived && (!leadOnly || tm.id === me.teamId) && (can.assignTo(t, { kind: 'team', id: tm.id }) || store.activeUsers.some((u) => u.teamId === tm.id && can.assignTo(t, { kind: 'user', id: u.id }))))
  const suggest = () => {
    if (!res || !start || !estN) { toast.error("For the Due Date offer, enter the responsible (section B), Start and Estimation."); return }
    const sd = planner.suggestDue(res, start, estN)
    if (!sd) { toast.error("There was not enough free capacity planning on the horizon."); return }
    setDue(sd)
    toast.success(`Due Date Offer: ${d(sd)}`, { description: `The nearest date ${n(estN)} is in free capacity ${resName}.` })
  }
  const save = () => {
    if (start && due && due < start) { toast.error("Due date is before the start."); return }
    if (res && start && due && estN) {
      const v = planner.validate(res, start, due, estN)
      if (!v.ok) { toast.error("Storage not done: Over-departure", { description: "See details in section C and change due date, start or responsible." }); jump('c'); return }
      const teamId = res.kind === 'team' ? res.id : userById[res.id].teamId
      dispatch({ type: 'savePlan', taskId: t.id, assignee: res, estimation: estN, start, due, allocations: toAllocations(t.id, res, teamId, v.days) })
    } else {
      dispatch({ type: 'savePlan', taskId: t.id, assignee: res, estimation: estN || undefined, start, due, allocations: [] })
    }
    toast.success("Scheduled Saved", { description: res ? undefined : "Task remained in the Unassigned Project Control Pool." })
  }
  const reset = () => { setRes(initialRes); setEst(t.estimation ? String(t.estimation) : ''); setStart(t.start); setDue(t.due) }
  return { res, setRes, est, setEst, estN, start, setStart, due, setDue, dirty, resDirty, validation, resName, suggest, save, reset, canPlan, leadOnly, teamsOrdered }
}

function PlanningSection({ t, plan }: { t: Task; plan: Plan }) {
  const { state, dispatch } = useStore()
  const { n, d, dShort, h } = useFmt()
  const { canPlan, leadOnly, est, setEst, estN, start, setStart, due, setDue, validation, resName, res, suggest, save, reset, dirty } = plan
  const deps = (t.dependsOn ?? []).map((id) => state.tasks[id]).filter(Boolean)
  const depOptions = useMemo(() => Object.values(state.tasks).filter((x) => isWorkItem(x) && x.projectId === t.projectId && x.id !== t.id && !(t.dependsOn ?? []).includes(x.id) && !(x.dependsOn ?? []).includes(t.id)).sort((a, b) => a.order - b.order).slice(0, 200), [state.tasks, t])
  const openDeps = deps.filter((x) => statusOf(state, x)?.category !== 'done')
  return (
    <Section id="c" aside={!canPlan ? <LockNote text="Project control, project manager or team supervisor" /> : leadOnly ? <span className="text-[11.5px] text-muted-foreground">Supervisor: Only inside your team</span> : undefined}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="drawer-est" className="eyebrow">{LU('estimation')}</Label>
          <Input id="drawer-est" type="number" min={0} step={0.5} inputMode="decimal" className="num mt-1 h-9" value={est} onChange={(e) => setEst(e.target.value)} disabled={!canPlan} />
          {t.baselineEstimation != null && <div className="mt-1 text-[11px] text-muted-foreground">{L('baselineEstimation')}: <span className="num">{n(t.baselineEstimation)}</span>{t.estimation != null && t.baselineEstimation !== t.estimation && <span className="text-destructive"> — has changed</span>}</div>}
        </div>
        <div className="flex items-end">
          <Button type="button" variant="outline" className="h-9 w-full" onClick={suggest} disabled={!canPlan}><Sparkles className="h-4 w-4 text-azure" /> Due Date Offer</Button>
        </div>
        <div>
          <Label htmlFor="drawer-start" className="eyebrow">{L('start')}</Label>
          <div className="mt-1"><JalaliDateField id="drawer-start" value={start} onChange={setStart} disabled={!canPlan} /></div>
        </div>
        <div>
          <Label htmlFor="drawer-due" className="eyebrow">{L('due')}</Label>
          <div className="mt-1"><JalaliDateField id="drawer-due" value={due} onChange={setDue} disabled={!canPlan} /></div>
          {t.baselineDue && <div className="mt-1 text-[11px] text-muted-foreground">{L('baselineDue')}: <span className="num">{d(t.baselineDue)}</span>{t.due && t.baselineDue !== t.due && <span className="text-destructive"> — has changed</span>}</div>}
        </div>
        {hasField(t, 'planIssue') && (
          <dl className="sm:col-span-2"><Field label={`${L('planIssue')} (MDR)`}><span className="num">{d(t.planIssue)}</span></Field></dl>
        )}
      </div>

      {validation && validation.ok && (
        <div className="mt-4 rounded-xl border border-leaf/30 bg-leaf-soft px-3 py-2.5 text-[12.5px] text-leaf-ink">
          <div className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-4 w-4" /> fit in capacity</div>
          <div className="num mt-0.5">Available Hours {resName} Between Start and Due: {h(validation.free)} — Estimation: {h(estN)}</div>
        </div>
      )}
      {validation && !validation.ok && (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-danger-soft px-3 py-2.5 text-[12.5px]" role="alert">
          <div className="flex items-center gap-1.5 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> Too much allocation</div>
          {validation.reason === 'range' ? <div className="mt-1">Due date is before the start.</div> : (
            <div className="num mt-1 leading-relaxed">
              {resName} Bian {d(start)} to {d(due)} Just... {h(validation.free)} The clock is free; <b>{h(validation.excess)} Extras</b> It's about Estimation.
              {validation.fullDays.length > 0 && <> Full days: {validation.fullDays.slice(0, 6).map((x) => dShort(x)).join(', ')}{validation.fullDays.length > 6 ? ' …' : ''}.</>}
              <div className="mt-1 text-muted-foreground">Take the Due Date back, take the Start forward, or give the Task to another person/team (section B). The “Due Date Offer” button will find the nearest date possible.</div>
            </div>
          )}
        </div>
      )}
      {res && (!start || !estN) && canPlan && <p className="mt-3 text-[12px] text-muted-foreground">It is necessary to build an everyday Allocation, Start and Estimation.</p>}
      {!res && canPlan && <p className="mt-3 text-[12px] text-muted-foreground">The responsible is determined in Section B; the location is built day by day with the same responsibility.</p>}
      {validation && validation.days.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow mb-2">{L('allocation')} Day by day (Filling from Start)</div>
          <div className="scroll-x thin-scroll">
            <div className="flex items-end gap-1 pb-1">
              {validation.days.map((x) => (
                <div key={x.date} className="flex w-9 shrink-0 flex-col items-center gap-1">
                  <span className="num text-[10px] text-muted-foreground">{n(x.hours, 1)}</span>
                  <div className="flex h-14 w-full items-end rounded-sm bg-secondary"><div className={cn('w-full rounded-sm', validation.ok ? 'bg-azure' : 'bg-destructive/70')} style={{ height: `${Math.min(100, (x.hours / (x.capacity || 8)) * 100)}%` }} /></div>
                  <span className="num text-[10px] text-muted-foreground">{dShort(x.date).split(' ')[0]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {canPlan && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {dirty && <Button variant="ghost" onClick={reset}>Back!</Button>}
          <Button onClick={save} disabled={!dirty}>Save Planning</Button>
        </div>
      )}
      <AllocationSummary t={t} />

      <div className="mt-4 min-w-0 border-t pt-4">
        <div className="eyebrow">{L('dependsOn')} (Finish-to-Start)</div>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {deps.map((x) => (
            <div key={x.id} className="flex items-center gap-2 rounded-lg border bg-background/45 px-2 py-1 text-[12.5px]">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <button className="min-w-0 flex-1 truncate text-start hover:underline" onClick={() => dispatch({ type: 'openTask', id: x.id })}>{x.docNumber ?? x.name}</button>
              <StatusPill task={x} status={statusOf(state, x)} />
              {canPlan && <button type="button" className="rounded-full p-0.5 hover:bg-foreground/10" aria-label="Remove Prerequisites" onClick={() => dispatch({ type: 'updateTask', taskId: t.id, patch: { dependsOn: (t.dependsOn ?? []).filter((y) => y !== x.id) } })}><X className="h-3 w-3" /></button>}
            </div>
          ))}
          {!deps.length && <span className="text-[12px] text-muted-foreground">No need to register.</span>}
          {canPlan && (
            <Select value="" onValueChange={(v) => dispatch({ type: 'updateTask', taskId: t.id, patch: { dependsOn: [...(t.dependsOn ?? []), v] } })}>
              <SelectTrigger id="c-add-dep" className="h-8 text-[12px]"><SelectValue placeholder="+ Add pre-requisites of the same project" /></SelectTrigger>
              <SelectContent className="max-h-72">{depOptions.map((x) => <SelectItem key={x.id} value={x.id}>{x.docNumber ? `${x.docNumber} — ` : ''}{x.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        {openDeps.length > 0 && <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> {n(openDeps.length)} The prerequisite is not finished yet.</p>}
      </div>
    </Section>
  )
}

function AllocationSummary({ t }: { t: Task }) {
  const { state } = useStore()
  const { n } = useFmt()
  const total = state.allocations.filter((a) => a.taskId === t.id).reduce((s, a) => s + a.hours, 0)
  if (!total) return null
  return <div className="pt-3 text-[12px] text-muted-foreground">Total {L('allocation')} Stored: <span className="num font-medium text-foreground">{n(total, 1)}</span> Person-hours</div>
}

// ---------------- C. Schedule (supervision / team / finance & admin) ----------------
function FlowPlanningSection({ t }: { t: Task }) {
  const { dispatch, can } = useStore()
  const { d, n } = useFmt()
  const manage = can.manageFlow(t)
  const withEst = hasField(t, 'estimation')
  const [est, setEst] = useState(t.estimation ? String(t.estimation) : '')
  const [start, setStart] = useState(t.start)
  const [due, setDue] = useState(t.due)
  const dirty = (withEst && (t.estimation ?? '') !== (est ? Number(est) : '')) || start !== t.start || due !== t.due
  const save = () => {
    if (start && due && due < start) { toast.error("Due date is before the start."); return }
    dispatch({ type: 'updateTask', taskId: t.id, patch: withEst ? { estimation: Number(est) || undefined, start, due } : { start, due } })
    toast.success("Task Program Saved")
  }
  return (
    <Section id="c" aside={!manage ? <LockNote text="Read Only" /> : undefined}>
      <div className={cn('grid grid-cols-1 gap-3', withEst ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {withEst && (
          <div>
            <Label htmlFor="fc-est" className="eyebrow">{LU('estimation')}</Label><Input id="fc-est" type="number" min={0} step={0.5} inputMode="decimal" className="num mt-1 h-9" value={est} onChange={(e) => setEst(e.target.value)} disabled={!manage} />
            {t.baselineEstimation != null && t.baselineEstimation !== t.estimation && <div className="mt-1 text-[11px] text-muted-foreground">{L('baselineEstimation')}: <span className="num">{n(t.baselineEstimation)}</span></div>}
          </div>
        )}
        <div><Label htmlFor="fc-start" className="eyebrow">{L('start')}</Label><div className="mt-1"><JalaliDateField id="fc-start" value={start} onChange={setStart} disabled={!manage} /></div></div>
        <div><Label htmlFor="fc-due" className="eyebrow">{L('due')}</Label><div className="mt-1"><JalaliDateField id="fc-due" value={due} onChange={setDue} disabled={!manage} /></div></div>
      </div>
      {t.baselineDue && <p className="mt-2 text-[11.5px] text-muted-foreground">{L('baselineDue')}: <span className="num">{d(t.baselineDue)}</span>{t.due && t.baselineDue !== t.due && <span className="text-destructive"> — has changed</span>}</p>}
      <p className="mt-1 text-[11.5px] text-muted-foreground">{isFinTask(t) ? "Tasks for financial space and office space are not included in the workload, work log, rating and project reports." : t.kind === 'internal' ? "Task Team does not take place on Workload projects; the time spent with Work Log (section D) is recorded." : "The actual time spent with Work Log (section D) is recorded."}</p>
      {manage && dirty && <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => { setEst(t.estimation ? String(t.estimation) : ''); setStart(t.start); setDue(t.due) }}>Back!</Button><Button size="sm" onClick={save}>Save</Button></div>}
    </Section>
  )
}

// ---------------- D. Status, flow and actual dates ----------------
const STEPS: { key: FlowState[]; label: string }[] = [
  { key: ['open'], label: 'Submit' }, { key: ['assigned'], label: "References" }, { key: ['in_progress', 'rework'], label: "Run" }, { key: ['in_review'], label: "Checkout" }, { key: ['closed'], label: 'Package' },
]
function FlowStepper({ f,task }: { f: FlowState;task:Task }) {
  const {state}=useStore()
  const steps=task.kind==='supervision'?supervisionStatuses(state).map(x=>({key:[x.phase],label:x.name,id:x.id})):STEPS.map(x=>({...x,id:x.label}))
  const at = task.kind==='supervision'?steps.findIndex(x=>x.id===supervisionStatus(state,task).id):steps.findIndex(s=>s.key.includes(f))
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Workflow Stages">
      {steps.map((s, i) => (
        <li key={s.label} className="flex min-w-0 flex-1 items-center gap-1" aria-current={i === at ? 'step' : undefined}>
          <span className={cn('flex h-6 min-w-0 flex-1 items-center justify-center rounded-full px-1.5 text-[11px] font-medium',
            i < at ? 'bg-leaf-soft text-leaf-ink' : i === at ? (f === 'rework' ? 'bg-destructive text-destructive-foreground' : f === 'closed' ? 'bg-leaf text-leaf-foreground' : 'bg-azure text-azure-foreground') : 'bg-secondary text-muted-foreground')}>
            <span className="truncate">{task.kind!=='supervision' && i === at && f === 'rework' ? "Modifications" : s.label}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

function ActualDates({ t }: { t: Task }) {
  const { dispatch, can } = useStore()
  const { d, n } = useFmt()
  const [edit, setEdit] = useState(false)
  const [a, setA] = useState({ s: t.actualStart, f: t.actualFinish, reason: '' })
  const late = t.actualFinish && t.due && t.actualFinish > t.due
  const save = () => {
    if (!a.reason.trim()) { toast.error("Write down the reason for the correction."); return }
    if (a.s && a.f && a.f < a.s) { toast.error("The actual final result is before the actual start."); return }
    dispatch({ type: 'setActual', taskId: t.id, actualStart: a.s, actualFinish: a.f, reason: a.reason.trim() })
    setEdit(false)
    toast.success("The real history has been corrected", { description: "It was recorded for a reason in history." })
  }
  const daysLate = t.actualFinish && t.due ? Math.round((new Date(t.actualFinish).getTime() - new Date(t.due).getTime()) / 86400000) : 0
  return (
    <div className="mt-4 rounded-xl border bg-background/45 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">Real Time</span>
        {can.perm('actual.edit') && !edit && <Button size="sm" variant="ghost" className="h-7" onClick={() => { setA({ s: t.actualStart, f: t.actualFinish, reason: '' }); setEdit(true) }}><Pencil className="h-3.5 w-3.5" /> Modifications</Button>}
      </div>
      {!edit ? (
        <dl className="mt-1.5 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3">
          <div><dt className="eyebrow">Actual Start</dt><dd className="num font-medium">{d(t.actualStart)}</dd></div>
          <div><dt className="eyebrow">Actual Finish</dt><dd className={cn('num font-medium', late && 'text-destructive')}>{d(t.actualFinish)}</dd></div>
          <div className="col-span-2 sm:col-span-1"><dt className="eyebrow">relative to due</dt><dd className="text-[12.5px]">{!t.actualFinish ? (t.due && t.due < TODAY ? <span className="font-semibold text-destructive">Overdue</span> : <span className="text-muted-foreground">Open</span>) : daysLate > 0 ? <span className="num text-destructive">{n(daysLate)} Later day</span> : daysLate < 0 ? <span className="num text-leaf-ink">{n(-daysLate)} Early day</span> : "Premature"}</dd></div>
        </dl>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div><Label htmlFor="act-s" className="eyebrow">Actual Start</Label><div className="mt-1"><JalaliDateField id="act-s" value={a.s} onChange={(v) => setA({ ...a, s: v })} /></div></div>
          <div><Label htmlFor="act-f" className="eyebrow">Actual Finish</Label><div className="mt-1"><JalaliDateField id="act-f" value={a.f} onChange={(v) => setA({ ...a, f: v })} /></div></div>
          <div className="sm:col-span-2"><Label htmlFor="act-r" className="eyebrow">Reason for correction (required)</Label><Input id="act-r" className="mt-1 h-9" value={a.reason} onChange={(e) => setA({ ...a, reason: e.target.value })} placeholder="For example: Work started before registration in the system" /></div>
          <div className="flex gap-2 sm:col-span-2"><Button size="sm" onClick={save}>Refinement Registration</Button><Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Cancel</Button></div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Auto: Start with the first start, Finish with closing or approval by reviewer. Manual modification only control the project and the CEO, with reason.</p>
    </div>
  )
}

function SectionD({ t }: { t: Task }) {
  const { state, dispatch, can } = useStore()
  const { n, pct } = useFmt()
  const [reason, setReason] = useState('')
  if (isWorkItem(t)) {
    const statuses = statusesFor(state, t)
    const s = statusOf(state, t)
    const scope = effectiveScope(state, t)
    const editStatus = can.editStatus(t) && t.flow !== 'in_review'
    const queued = state.writeQueue.find((w) => w.taskId === t.id)
    const options = t.reviewerId ? statuses.filter((x) => x.category !== 'done' || x.id === s?.id) : statuses
    return (
      <Section id="d" aside={!can.editStatus(t) ? <LockNote text="Only responsible, team responsible or planner" /> : t.flow === 'in_review' ? <LockNote text="Waiting for the reviewer’s decision" /> : undefined}>
        <div className="flex items-center gap-3">
          <ProgressRing task={t} value={s?.progress ?? 0} size={44} stroke={4} />
          <div className="flex-1">
            <Label htmlFor="drawer-status" className="sr-only">{L('status')}</Label>
            <Select value={s?.id} onValueChange={(v) => { dispatch({ type: 'setStatus', taskId: t.id, statusId: v }); toast.success("Status has changed", { description: t.source === 'mdr' ? `Writing-back to MDR is done with a delay of ${n(WRITEBACK_DELAY_SEC / 60)} minutes.` : undefined }) }} disabled={!editStatus}>
              <SelectTrigger id="drawer-status" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{options.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} ({pct(x.progress)})</SelectItem>)}</SelectContent>
            </Select>
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">
              Status Set: {scope === 'office' ? "Default Office" : state.tasks[scope] ? `Override in " ${state.tasks[scope].name} "` : "Project Level"}, {L('progress')} comes from the task status
              {t.reviewerId && <> — Final Status only with Reviewer confirmation (Section E)</>}
            </div>
          </div>
        </div>
        {hasField(t, 'weight') && (
          <dl className="mt-3 rounded-xl border bg-background/45 px-3 py-2">
            <Field label={`${L('weight')} Roll-up Parent (MDR)`}>
              <span className="num">{t.weight != null ? n(t.weight, 2) : '—'}</span>{t.weightDerived && <span className="ms-1 text-[11px] text-azure">equal division (was empty in MDR)</span>}
            </Field>
          </dl>
        )}
        {queued && <div className="mt-3 flex items-center gap-2 rounded-md bg-azure-soft px-3 py-2 text-[12px] text-azure-ink"><CornerDownLeft className="h-3.5 w-3.5" /> Writing-back: Last Status{queued.statusName}» and Progress {pct(queued.progress)}</div>}
        <PointArea t={t} />
      </Section>
    )
  }
  const f = flowOf(t)
  const executor = can.executor(t)
  const decide = can.decideReview(t)
  const manage = can.manageFlow(t)
  const selfClose = (t.kind === 'internal' || isFinTask(t)||!!t.reviewSourceTaskId) && !t.reviewerId
  return (
    <Section id="d">
      <FlowStepper f={f} task={t} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {executor && (f === 'assigned' || f === 'rework') && <Button onClick={() => { dispatch({ type: 'flow', taskId: t.id, op: 'start' }); toast.success(f === 'rework' ? "Modification has begun" : "Work started", { description: t.actualStart ? undefined : "It was actually started." }) }}><Play className="h-4 w-4" /> {f === 'rework' ? "Start Revisions" : 'Start Work'}</Button>}
        {executor && (f === 'in_progress' || f === 'rework') && (t.reviewerId || (t.kind === 'supervision'&&!t.reviewSourceTaskId)) && <Button variant="outline" onClick={() => jump('e')}><ArrowDown className="h-4 w-4" /> Submit for Review</Button>}
        {(executor || manage) && selfClose && (f === 'in_progress' || f === 'rework') && <Button onClick={() => { dispatch({ type: 'flow', taskId: t.id, op: 'complete' }); toast.success("It's closed", { description: "The actual final was recorded." }) }}><CheckCircle2 className="h-4 w-4" /> Close Task</Button>}
        {f === 'in_review' && decide && <Button variant="outline" onClick={() => jump('e')}><ArrowDown className="h-4 w-4" /> Decision on the review</Button>}
        {f === 'open' && manage && <span className="text-[12px] text-muted-foreground">To start the workflow, select and “reference” in the responsible section B.</span>}
        {f === 'assigned' && !executor && <span className="text-[12px] text-muted-foreground">Waiting for the start of work by the officer.</span>}
        {f === 'in_review' && !decide && <span className="text-[12px] text-muted-foreground">Waiting for the reviewer’s decision.</span>}
      </div>
      {f === 'closed' && (decide || manage) && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!reason.trim()) { toast.error("Write down the reason for reopening."); return } dispatch({ type: 'flow', taskId: t.id, op: 'reopen', note: reason.trim() }); setReason(''); toast("Task opened again", { description: "The actual final was cleared and the officer was notified." }) }}>
          <Input id="d-reopen" className="h-9" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for reopening" />
          <Button type="submit" variant="outline" className="h-9"><RotateCcw className="h-4 w-4" /> Reopen</Button>
        </form>
      )}
      <FlowProgress t={t} />
      {hasField(t, 'point') && <PointArea t={t} />}
    </Section>
  )
}

/** Progress of a flow task. Finance & admin tasks take a percentage from the person doing the work (or the managers of the task). */
function FlowProgress({ t }: { t: Task }) {
  const { dispatch, can, me } = useStore()
  const { pct, n } = useFmt()
  const f = flowOf(t)
  const value = flowProgress(t)
  const manual = isFinTask(t)
  const canEdit = manual && f !== 'closed' && f !== 'in_review' && (t.assigneeUserId === me.id || can.manageFlow(t))
  const [v, setV] = useState(t.progressPct ?? 0)
  const save = () => { dispatch({ type: 'updateTask', taskId: t.id, patch: { progressPct: v } }); toast.success(`Progress: ${pct(v)}`, { description: "It was recorded in the history of Task." }) }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border bg-background/45 p-3">
      <ProgressRing task={t} value={canEdit ? v : value} size={40} stroke={4} />
      <div className="min-w-0 flex-1">
        <Label htmlFor="d-progress" className="eyebrow">{L('progress')}</Label>
        {canEdit ? (
          <div className="mt-1 flex items-center gap-2">
            <input id="d-progress" type="range" min={0} max={100} step={5} value={v} onChange={(e) => setV(Number(e.target.value))} className="h-2 min-w-0 flex-1 accent-[hsl(var(--azure))]" aria-valuetext={pct(v)} />
            <span className="num w-10 shrink-0 text-end text-[12.5px] font-semibold">{n(v)}%</span>
            {v !== (t.progressPct ?? 0) && <Button size="sm" className="h-8" onClick={save}>Record progress</Button>}
          </div>
        ) : (
          <div className="num mt-0.5 text-[13px] font-semibold">{pct(value)}</div>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">{manual ? (f === 'closed' ? "Task is closed." : f === 'in_review' ? "The reviewer’s decision remains the same." : "The percentage of progress is responsible for the task (or its manager and manufacturer); it is 100% closed.") : "It comes from the work cycle."}</p>
      </div>
    </div>
  )
}

function PointArea({ t }: { t: Task }) { return <TaskPointBlock t={t} /> }

// ---------------- D. Point of the task ----------------
/** The assignee sees how the task affects their own points; CEO and Project Control see the full calculation and can act on it */
function TaskPointBlock({ t }: { t: Task }) { return <TaskScore taskId={t.id} /> }

// ---------------- E. Review rounds & attachments ----------------
function SectionE({ t }: { t: Task }) {
  const { state, dispatch, can, userById, me } = useStore()
  const { time, clock, n } = useFmt()
  const rounds = state.reviewRounds.filter((r) => r.taskId === t.id).sort((a, b) => a.round - b.round)
  const files = state.attachments.filter((a) => a.taskId === t.id)
  const loose = files.filter((f) => !f.roundId)
  const f = flowOf(t)
  const [note, setNote] = useState('')
  const [rfiles, setRfiles] = useState<NewFile[]>([])
  const [decision, setDecision] = useState('')
  const [extra, setExtra] = useState<NewFile[]>([])
  const work = isWorkItem(t)
  const done = work && statusOf(state, t)?.category === 'done'
  const canSubmit = work
    ? !!t.reviewerId && can.editStatus(t) && t.reviewerId !== me.id && t.flow !== 'in_review' && !done
    : can.executor(t) && (f === 'in_progress' || f === 'rework') && (!!t.reviewerId || (t.kind === 'supervision'&&!t.reviewSourceTaskId) || t.kind === 'internal')
  const canDecide = (work ? t.flow === 'in_review' : f === 'in_review') && can.decideReview(t)
  const involved = [t.assigneeUserId, t.reporterId, t.reviewerId, ...(t.participantIds ?? [])].includes(me.id)
  const canAttach = involved || can.planTask(t) || can.editStatus(t) || can.manageFlow(t)
  const submit = () => {
    if (!note.trim()) { toast.error("Write the description of the work done."); return }
    dispatch({ type: 'flow', taskId: t.id, op: 'submit', note: note.trim(), files: rfiles })
    setNote(''); setRfiles([])
    toast.success("Sent for review", { description: "The reviewer announced." })
  }
  const decideNow = (op: 'approve' | 'rework') => {
    if (op === 'rework' && !decision.trim()) { toast.error("Write down the reason for the return."); return }
    dispatch({ type: 'flow', taskId: t.id, op, note: decision.trim() || undefined })
    setDecision('')
    toast.success(op === 'approve' ? "It's confirmed and it's closed" : "Back to reform", { description: op === 'approve' ? "The actual final was recorded." : "The presenter declared." })
  }
  return (
    <Section id="e">
      {work && !t.reviewerId && <p className="mb-3 text-[12px] text-muted-foreground">This task does not have a reviewer and closes with the final status. For the review phase, set a reviewer in section B.</p>}
      {rounds.length > 0 && (
        <ol className="mb-4 flex flex-col gap-3 border-s ps-4">
          {rounds.map((r) => {
            const rf = files.filter((x) => x.roundId === r.id)
            return (
              <li key={r.id} className="relative">
                <span className={cn('absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background', r.decision === 'approve' ? 'bg-leaf' : r.decision === 'rework' ? 'bg-destructive' : 'bg-azure')} />
                <div className="text-[12px] text-muted-foreground"><b className="text-foreground">Round {n(r.round)}</b> — {userById[r.submittedBy]?.name}, {time(r.submittedAt)}, {clock(r.submittedAt)}</div>
                <div className="mt-0.5 whitespace-pre-wrap text-[13px] leading-6">{r.note}</div>
                {rf.length > 0 && <div className="mt-2"><AttachmentList items={rf} /></div>}
                {r.decision ? (
                  <div className={cn('mt-2 rounded-lg px-3 py-2 text-[12.5px]', r.decision === 'approve' ? 'bg-leaf-soft text-leaf-ink' : 'bg-danger-soft text-destructive')}>
                    <b>{r.decision === 'approve' ? 'Approve' : 'Rework'}</b> — {userById[r.decidedBy ?? '']?.name}, {time(r.decidedAt ?? '')}
                    {r.decisionNote && <div className="mt-0.5 text-foreground">{r.decisionNote}</div>}
                  </div>
                ) : <div className="mt-2 inline-flex rounded-full bg-azure px-2 py-0.5 text-[11.5px] text-azure-foreground">Waiting for decision {userById[t.reviewerId ?? '']?.name ?? 'Reviewer'}</div>}
              </li>
            )
          })}
        </ol>
      )}
      {canDecide && (
        <div className="mb-4 rounded-xl border border-azure/40 bg-azure-soft/40 p-3">
          <Label htmlFor="e-decision" className="eyebrow">Reviewer's decision</Label>
          <Textarea id="e-decision" className="mt-1 min-h-[60px]" value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="For return, write the reason and correction; for confirmation is optional;" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => decideNow('approve')}><CheckCircle2 className="h-4 w-4" /> Confirm and close</Button>
            <Button variant="outline" onClick={() => decideNow('rework')}><Undo2 className="h-4 w-4" /> Rework</Button>
          </div>
        </div>
      )}
      {canSubmit && (
        <div className="mb-4 rounded-xl border bg-background/45 p-3">
          <Label htmlFor="e-note" className="eyebrow">Submit for Review{rounds.length ? ` (Around ${n(rounds.length + 1)})` : ''}</Label>
          <Textarea id="e-note" className="mt-1 min-h-[64px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="If you have returned, write down the corrections." />
          <div className="mt-2"><FilePicker id="e-files" files={rfiles} onChange={setRfiles} /></div>
          <div className="mt-2"><Button onClick={submit}><Send className="h-4 w-4" /> Submit for Review</Button></div>
          {t.kind === 'internal' && !t.reviewerId && <p className="mt-1.5 text-[11.5px] text-muted-foreground">Undefined reviewer; the team supervisor checks. To close without checking, “Close Work” in section D.</p>}
        </div>
      )}
      <div className="eyebrow mb-2">Task Attachments ({n(loose.length)})</div>
      <AttachmentList items={loose} empty="No attachments." />
      {canAttach && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilePicker id="e-extra" files={extra} onChange={setExtra} label="Choose a File" />
          {extra.length > 0 && <Button size="sm" className="h-8" onClick={() => { dispatch({ type: 'addAttachments', taskId: t.id, files: extra }); setExtra([]); toast.success("Attachment added") }}>Add {n(extra.length)} Attachment</Button>}
        </div>
      )}
    </Section>
  )
}

// ---------------- F. Discussion & history ----------------
function CommentsSection({ t }: { t: Task }) {
  const { state, dispatch, userById, me } = useStore()
  const { time, clock } = useFmt()
  const [text, setText] = useState('')
  const list = state.comments.filter((c) => c.taskId === t.id).sort((a, b) => a.at.localeCompare(b.at))
  const send = () => {
    if (!text.trim()) return
    dispatch({ type: 'addComment', taskId: t.id, text: text.trim() })
    const tagged = (text.match(/@[a-z0-9._-]+/gi) ?? []).length
    setText('')
    toast.success("Comments are registered", { description: tagged ? "Members of the tag will be notified." : undefined })
  }
  return (
    <div>
      <h4 className="mb-3 flex items-center gap-1.5 text-[12.5px] font-semibold"><MessageSquare className="h-4 w-4" /> Category: Comments</h4>
      {list.length > 0 && (
        <ul className="mb-3 flex flex-col gap-3">
          {list.map((c) => {
            const u = userById[c.userId]
            return (
              <li key={c.id} className={cn('flex gap-2.5 rounded-lg p-1.5', c.mentions.includes(me.id) && 'bg-azure-soft/40')}>
                <Initials user={u} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]"><span className="font-semibold">{u?.name}</span><bdi className="mono text-[11px] text-muted-foreground">@{u?.username}</bdi><span className="num text-[11px] text-muted-foreground">{time(c.at)}, {clock(c.at)}</span></div>
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-6"><RichText text={c.text} /></div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <MentionInput id={`comment-${t.id}`} value={text} onChange={setText} onSubmit={send} placeholder="Write a comment; to announce to the colleague, write her @ID" submitLabel="Submit" />
    </div>
  )
}

function AuditSection({ t }: { t: Task }) {
  const { state, userById } = useStore()
  const fmt = useFmt()
  const entries = state.audit.filter((a) => a.taskId === t.id)
  const [, force] = useState(0)
  useEffect(() => { const h = setInterval(() => force((x) => x + 1), 30000); return () => clearInterval(h) }, [])
  return (
    <div className="mt-5">
      <h4 className="mb-3 flex items-center gap-1.5 text-[12.5px] font-semibold"><History className="h-4 w-4" /> History (AuditLog)</h4>
      {entries.length === 0 ? <p className="text-[12px] text-muted-foreground">No change has been recorded yet.</p> : (
        <ol className="flex flex-col gap-2.5 border-s ps-4">
          {entries.map((e) => (
            <li key={e.id} className="relative text-[12.5px]">
              <span className={cn('absolute -start-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-background', e.kind === 'security' ? 'bg-destructive' : e.kind === 'review' ? 'bg-leaf' : 'bg-azure')} />
              <div>{e.text}</div>
              <div className="text-[11px] text-muted-foreground">{userById[e.userId]?.name ?? "System"}, {fmt.time(e.at)}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}



