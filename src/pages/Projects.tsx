import { projectTypeLabel } from '@/lib/displayLabels'
import { activeProject, categoryOfProject, compareProjectNames, projectCategories, projectDocumentCounts } from '@/lib/projectDetails'
import { projectTeams, statusOf } from '@/lib/domain'
import { guard } from '@/lib/policy'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ProjectCover } from '@/components/ProjectCover'
import { taskScope } from '@/lib/organization'
import { isSiteIssue, isWorkItem } from '@/lib/domain'
import { canViewBoard } from '@/lib/whiteboards'
import { TeamName } from '@/components/ItemIcon'
import {teamOutline, teamCode, orderTeamGroups} from '@/lib/brand'
import {projectProgressStyle} from '@/lib/brand'
import { MindMapView } from '@/components/MindMap'
import { projectProgress, taskStage } from '@/lib/projectProgress'
import { ProjectStages } from '@/components/ProjectStages'
import { ManualProjectTaskDialog } from '@/components/ManualProjectTaskDialog'
import { lazy, Suspense, useMemo, useState } from 'react'
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useFmt, useStore } from '@/lib/store'
import { navigationSelection } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { TaskViews, TreeView } from '@/components/TaskViews'
import { Empty, PageHeader, Segmented, TitleBlock } from '@/components/common'
import { runManualSync } from './SyncRuns'
import { SupervisionPanel } from '@/components/FlowViews'
import { MdrButton, useMdrShortcut } from '@/components/MdrLink'
import { ProjectEditor, ProjectResponsibilities } from '@/components/ProjectEditor'
import type { Task } from '@/lib/types'

export function useProjectProgress() {
  const { state } = useStore()
  return (pid: string) => {
    const result = projectProgress(state, pid)
    return { ...result, total: result.total ?? 0 }
  }
}

const Whiteboards = lazy(() => import('@/components/Whiteboards'))

export function Projects() {
  const store = useStore()
  const { state, dispatch, teamById, can } = store
  const { n } = useFmt()
  const { value: mode, onChange: setMode } = navigationSelection(state.nav, dispatch, 'tab', 'cards', ['cards', 'tree'])
  const [newOpen, setNewOpen] = useState(false)
  const [lifecycle,setLifecycle]=useState('active')
  const [category,setCategory]=useState('')
  const [categoriesOpen,setCategoriesOpen]=useState(false)
  const categories=projectCategories(state)
  const selectedCategory=categories.includes(category)?category:''
  const canManage=can.perm('project.define')&&can.perm('project.edit')
  const projects=state.projects.filter(p=>(lifecycle==='deleted'?canManage&&can.admin&&!!p.deletedAt:lifecycle==='archived'?!!p.archivedAt&&!p.deletedAt:activeProject(p))&&(!selectedCategory||categoryOfProject(p)===selectedCategory)).sort((a,b)=>compareProjectNames(a.name,b.name))
  const visibleTasks=Object.values(state.tasks).filter(t=>projects.some(p=>p.id===t.projectId)&&can.viewTask(t)&&!t.removedFromMdr)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Projects" title={lifecycle==='archived'?'Archived Projects':lifecycle==='deleted'?'Deleted Projects':'Active Projects'} actions={
        <>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'cards', label: 'Cards' }, { value: 'tree', label: 'All WBS' }]} />
          <select aria-label="Project lifecycle" className="rounded-md border bg-background px-2 py-2 text-sm" value={lifecycle} onChange={e=>setLifecycle(e.target.value)}><option value="active">Active Projects</option><option value="archived">Archived Projects</option>{canManage&&can.admin&&<option value="deleted">Deleted Projects</option>}</select>
          <select aria-label="Project category" className="rounded-md border bg-background px-2 py-2 text-sm" value={selectedCategory} onChange={e=>setCategory(e.target.value)}><option value="">All Categories</option>{categories.map(c=><option key={c} value={c}>{projectTypeLabel(c)}</option>)}</select>
          {canManage&&<Button variant="outline" onClick={()=>setCategoriesOpen(true)}>Manage Categories</Button>}
          {can.perm('project.define') && can.perm('project.create') && <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New Project</Button>}
        </>
      }>
        {n(projects.length)} projects
      </PageHeader>

      {!projects.length?<Empty title="No projects match these filters."/>:mode === 'tree' ? <TreeView tasks={visibleTasks.filter(isWorkItem)} depth={1} /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {projects.map((p) => {
            const docs = projectDocumentCounts(visibleTasks,p.id,t=>statusOf(state,t))
            return (
              <button key={p.id} onClick={() => dispatch({ type: 'nav', nav: { page: 'project', projectId: p.id } })}
                className="glass-card min-w-0 flex flex-col gap-2 p-3 text-start hover:bg-foreground/[0.035]">
                <ProjectCover image={p.coverImage} className="w-full rounded-lg" />
                <span className="truncate text-[15px] font-bold" title={p.name}>{p.name}</span>
                <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">{projectTeams(p).filter(id=>teamById[id]&&!teamById[id].archived).map(id=><TeamName key={id} team={teamById[id]} />)}</div>
                <div className="grid w-full grid-cols-2 gap-2 border-t pt-2 text-xs"><div><div className="eyebrow">Total Documents</div><div className="num font-semibold">{n(docs.total)}</div></div><div><div className="eyebrow">Issued Documents</div><div className="num font-semibold text-primary">{n(docs.issued)}</div></div></div>
              </button>
            )
          })}
        </div>
      )}
      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
      {categoriesOpen&&<CategoryManager onClose={()=>setCategoriesOpen(false)} />}
    </div>
  )
}

function CategoryManager({onClose}:{onClose:()=>void}) {
  const {state,dispatch}=useStore()
  const [name,setName]=useState(''),[selected,setSelected]=useState(''),[replacement,setReplacement]=useState('Other')
  const names=projectCategories(state)
  const act=(op:'create'|'rename'|'remove')=>{const action={type:'projectCategory' as const,op,name:op==='create'?name.trim():selected,replacement:op==='rename'?name.trim():replacement};const error=guard(state,action);if(error){toast.error(error);return}dispatch(action);setName('');setSelected('')}
  return <Dialog open onOpenChange={v=>{if(!v)onClose()}}><DialogContent><DialogHeader><DialogTitle>Manage Project Categories</DialogTitle><DialogDescription>Rename or move existing projects to another category without deleting project data.</DialogDescription></DialogHeader><Input aria-label="Category name" value={name} onChange={e=>setName(e.target.value)} placeholder="New category name"/><Button onClick={()=>act('create')}>Create Category</Button><select aria-label="Existing category" className="border rounded-md bg-background p-2" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select Category</option>{names.filter(n=>n!=='Other').map(n=><option key={n}>{n}</option>)}</select><Button variant="outline" disabled={!selected} onClick={()=>act('rename')}>Rename to entered name</Button><select aria-label="Replacement category" className="border rounded-md bg-background p-2" value={replacement} onChange={e=>setReplacement(e.target.value)}>{names.filter(n=>n!==selected).map(n=><option key={n}>{n}</option>)}</select><Button variant="outline" disabled={!selected} onClick={()=>{if(window.confirm(`Move all projects in ${selected} to ${replacement} and remove the category?`))act('remove')}}>Remove Category</Button></DialogContent></Dialog>
}

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return open ? <ProjectEditor open={open} onOpenChange={onOpenChange} /> : null
}

export function ProjectPage({ projectId }: { projectId: string }) {
  const store = useStore()
  const { state, dispatch, projectById, teamById, teamOf, can, me } = store
  const { n, time, pct } = useFmt()
  const p = projectById[projectId]
  const progress = useProjectProgress()
  const [manualOpen, setManualOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen,setDeleteOpen]=useState(false)
  const [deleteName,setDeleteName]=useState('')
  const [selectedStage, setSelectedStage] = useState('all')
  const tasks = useMemo(() => Object.values(state.tasks).filter((t) => isWorkItem(t)&&!t.archivedAt&&can.viewTask(t)&&t.projectId === projectId && (selectedStage === 'all' || (selectedStage === 'unclassified' ? !taskStage(state.tasks, t) : taskStage(state.tasks, t) === selectedStage))), [state.tasks, projectId, selectedStage, me.id])
  useMdrShortcut(p)
  if (!p) return <Empty title="Project not found" hint="Select a project from the Projects list." />
  const pr = progress(p.id)
  const lifecycle=(op:'archive'|'unarchive'|'delete'|'restore')=>{const action={type:'projectLifecycle' as const,id:p.id,op,confirmation:op==='delete'?deleteName:undefined};const error=guard(state,action);if(error)toast.error(error);else{dispatch(action);setDeleteOpen(false);dispatch({type:'nav',nav:{page:'projects'}})}}
  const sdTeam = p.sdTeamId ?? p.phase1TeamId
  const teamTabs = [...new Set(['ctl', 'rd', 'int', 'ren', 'prs', p.phase1TeamId, p.phase2TeamId, ...(p.teamIds ?? [])])].filter((id) => id !== 'sup' && teamById[id] && teamById[id].kind !== 'management')
  const pool = tasks.filter((t) => !t.assigneeUserId && !t.assigneeTeamId)
  const pend = state.syncItems.filter((x) => x.projectId === p.id && x.state === 'pending').length
  const syncing = state.syncRuns.some((r) => r.state === 'running' && (r.projectId === p.id || r.projectId === 'all'))
  const supOpen = Object.values(state.tasks).filter((t) => isSiteIssue(state,t) && t.projectId === p.id && t.flow !== 'closed').length
  const supTasks = Object.values(state.tasks).filter((t) => isSiteIssue(state,t) && t.projectId === p.id && can.viewTask(t))
  const supGantt = supTasks.length ? { key: 'sup', label: 'Site Supervision', tasks: supTasks } : undefined
  const showWhiteboard = canViewBoard(state, me, p.id)
  const showSupervision = can.viewSupervision(p.id)
  const showPool = can.createProjectTask(p.id)
  const orderedTabs = orderTeamGroups([...teamTabs.map(id=>({id,code:teamCode(teamById[id])})), {id:'phase-sd',code:'SD' as const}, ...(showSupervision?[{id:'sup',code:'CA' as const}]:[])])
  const matchesStage = (t:Task) => selectedStage==='all'||(selectedStage==='unclassified'?!taskStage(state.tasks,t):taskStage(state.tasks,t)===selectedStage)
  const tabs = navigationSelection(state.nav, dispatch, 'tab', 'wbs', [
    'wbs', 'mindmap', ...orderedTabs.map(t=>t.id),
    ...(showWhiteboard ? ['whiteboard'] : []),
    ...(showPool ? ['pool'] : []),
  ])
  return (
    <div className="flex flex-col gap-5">
      <div>
        <button className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground" onClick={() => dispatch({ type: 'nav', nav: { page: 'projects' } })}>
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </button>
        <PageHeader eyebrow={`${p.code}, ${projectTypeLabel(p.type)}`} title={p.name} actions={(
          <>
            <MdrButton project={p} />
            {can.perm('project.define')&&can.perm('project.edit')&&<><Button variant="outline" onClick={()=>lifecycle(p.deletedAt?'restore':p.archivedAt?'unarchive':'archive')}>{p.deletedAt?'Restore Project':p.archivedAt?'Unarchive Project':'Archive Project'}</Button>{!p.deletedAt&&can.admin&&<Button variant="outline" onClick={()=>{setDeleteName('');setDeleteOpen(true)}}>Delete Project</Button>}</>}
            {can.perm('project.define') && can.perm('project.edit') && <Button variant="outline" onClick={() => setEditOpen(true)}>Details and Responsibilities</Button>}
            {can.syncProject(p.id) && <Button variant="outline" onClick={() => runManualSync(store, p.id)} disabled={syncing} aria-busy={syncing}><RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} /> {syncing ? 'Syncing…' : 'MDR Sync'}</Button>}
            {showPool && <Button onClick={() => setManualOpen(true)}><Plus className="h-4 w-4" /> New Manual Task</Button>}
          </>
        )} />
      </div>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent><DialogHeader><DialogTitle>Delete Project: {p.name}</DialogTitle><DialogDescription>This will remove the project, associated documents, tasks and history from active views. Data will remain recoverable in Deleted Projects. Enter the exact project name to confirm.</DialogDescription></DialogHeader><Input aria-label="Confirm project name" placeholder={p.name} value={deleteName} onChange={e=>setDeleteName(e.target.value)}/><div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setDeleteOpen(false)}>Cancel</Button><Button variant="destructive" disabled={deleteName!==p.name} onClick={()=>lifecycle('delete')}>Delete Project</Button></div></DialogContent></Dialog>
      <TitleBlock cells={[
        { label: 'Progress by Assigned Stage', value: <span className="num" style={projectProgressStyle(pr.total)}>{pct(pr.total)}</span> },
        { label: 'Project Manager', value: p.managerId ? store.userById[p.managerId]?.name : '—' },
        { label: 'PD', value: <TeamName team={teamById.rd} /> },
        { label: 'CD', value: <TeamName team={teamById[p.phase1TeamId]} /> },
        { label: 'SD', value: <TeamName team={teamById[sdTeam]} /> },
        { label: 'DD', value: <TeamName team={teamById[p.phase2TeamId]} /> },
        { label: 'MDR / Tab', value: `${p.mdrTab}`, mono: true },
        { label: 'Last Sync', value: p.lastSync ? time(p.lastSync) : '—' },
        can.control
          ? { label: 'Pending Sync Review', value: pend ? <button className="num text-azure hover:underline" onClick={() => dispatch({ type: 'nav', nav: { page: 'review' } })}>{n(pend)} rows</button> : <span className="num">{n(0)}</span> }
          : { label: 'Project Tasks', value: <span className="num">{n(tasks.length)}</span> },
      ]} />
      <ProjectResponsibilities project={p} />
      <ProjectStages projectId={p.id} selected={selectedStage} onSelect={setSelectedStage} />
      {editOpen && <ProjectEditor project={p} open onOpenChange={setEditOpen} />}
      <Tabs value={tabs.value} onValueChange={tabs.onChange} dir="ltr">
        <div className="scroll-x thin-scroll -mx-1 px-1">
          <TabsList className="h-auto w-max justify-start gap-0.5">
            {showWhiteboard && <TabsTrigger value="whiteboard">Whiteboard</TabsTrigger>}
            <TabsTrigger value="mindmap">Mind Map</TabsTrigger>
            <TabsTrigger value="wbs" className="text-[13px]">WBS</TabsTrigger>
            {orderedTabs.map(({id,code}) => <TabsTrigger key={id} value={id} style={id==='phase-sd'?teamOutline(teamById[sdTeam],'CD'):teamOutline(teamById[id])} className="team-tab text-[13px]"><TeamName team={teamById[id==='phase-sd'?sdTeam:id]} label={id==='phase-sd'?'SD':id===p.phase1TeamId?'CD':id===p.phase2TeamId?(teamById[id]?.kind==='revit'?'DD / Revit':'DD'):id==='sup'?'CA':undefined} />{code==='CA'&&id==='sup'&&supOpen>0&&<span className="num ms-1.5 rounded-full bg-azure px-1.5 text-[10.5px] font-semibold text-azure-foreground">{n(supOpen)}</span>}</TabsTrigger>)}
            {showPool && <TabsTrigger value="pool" className="text-[13px]">Unassigned <span className="num ms-1.5 text-[11px] text-muted-foreground">{n(pool.length)}</span></TabsTrigger>}
          </TabsList>
        </div>
        {showWhiteboard && <TabsContent value="whiteboard"><Suspense fallback={<p role="status">Loading whiteboard…</p>}><Whiteboards projectId={p.id} /></Suspense></TabsContent>}
        <TabsContent value="mindmap"><MindMapView key={p.id} projectId={p.id} /></TabsContent>
        <TabsContent value="wbs" className="mt-4">
          <TaskViews tasks={tasks} structuralTasks={Object.values(state.tasks).filter(t=>t.projectId===p.id&&!isWorkItem(t)&&['phase','stage','group','doctype'].includes(t.kind)&&!t.removedFromMdr&&can.viewTask(t)&&matchesStage(t))} idPrefix={`p-${p.id}-wbs`} defaultView="tree" hideProject treeDepth={4} ganttExtras={supGantt} />
        </TabsContent>
        <TabsContent value="phase-sd" className="mt-4"><TaskViews tasks={tasks.filter(t => taskScope(state.tasks, t) === 'sd')} structuralTasks={Object.values(state.tasks).filter(t => t.projectId === p.id && !isWorkItem(t)&&['phase','stage','group','doctype'].includes(t.kind) && taskScope(state.tasks,t) === 'sd' && !t.removedFromMdr && can.viewTask(t)&&matchesStage(t))} colorTeamId={sdTeam} idPrefix={`p-${p.id}-sd`} defaultView="kanban" hideProject hideTeam treeDepth={4} /></TabsContent>
        {teamTabs.map((id) => {
          const list = tasks.filter((t) => {
            const scope = taskScope(state.tasks, t)
            const team = teamOf(t)
            if (scope === 'sd' && (id === p.phase1TeamId || teamById[id]?.kind === 'phase1')) return false
            if (scope === 'phase1' && (!team || teamById[team]?.kind === 'phase1')) return id === p.phase1TeamId
            if (scope === 'pd' && (!team || team === 'rd')) return id === 'rd'
            if (scope === 'phase2' && (!team || ['phase2', 'revit'].includes(teamById[team]?.kind))) return id === p.phase2TeamId
            return team === id
          })
          return (
            <TabsContent key={id} value={id} className="mt-4">
              <TaskViews tasks={list} colorTeamId={id} idPrefix={`p-${p.id}-${id}`} defaultView="kanban" hideProject hideTeam treeDepth={4} />
            </TabsContent>
          )
        })}
        {showSupervision && (
          <TabsContent value="sup" className="mt-4"><SupervisionPanel projectId={p.id} /></TabsContent>
        )}
        {showPool && (
          <TabsContent value="pool" className="mt-4">
            {pool.length ? <TaskViews tasks={pool} idPrefix={`p-${p.id}-pool`} defaultView="list" hideProject treeDepth={4} />
              : <Empty title="All tasks in this project have been assigned." />}
          </TabsContent>
        )}
      </Tabs>
      {manualOpen && <ManualProjectTaskDialog projectId={p.id} onOpenChange={setManualOpen} />}
    </div>
  )
}
