import { projectTypeLabel } from '@/lib/displayLabels'
import { activeProject, isActiveProjectId } from '@/lib/projectDetails'
import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowRight, BarChart3, Box, ChevronDown, ChevronLeft, ChevronRight, Flag, MoreHorizontal } from 'lucide-react'
import { Bar } from '@/components/common'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ProjectCover } from '@/components/ProjectCover'
import { activityStatus, TeamActivity } from '@/components/TeamActivity'
import { useFmt, useStore } from '@/lib/store'
import { addDays, startOfWeek } from '@/lib/jalali'
import { projectProgress } from '@/lib/projectProgress'
import { staffingOf, WORK_SCOPES } from '@/lib/organization'
import { isFlowTask } from '@/lib/domain'
import { TODAY } from '@/lib/seed'
import type { Project, Task } from '@/lib/types'

const dateLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const weekDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })

function projectSchedule(project: Project, tasks: Task[]) {
  const starts = tasks.flatMap((t) => t.start ? [t.start] : []).sort()
  const dates = tasks.flatMap((t) => t.due ? [t.due] : []).sort()
  return { project, start: starts[0], due: dates.at(-1) }
}

function ProjectTimeline({ entries }: { entries: ReturnType<typeof projectSchedule>[] }) {
  const { dispatch } = useStore()
  const [week, setWeek] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(TODAY), week * 7 + i))
  const scheduled = entries.filter((row) => {
    if (!row.start && !row.due) return false
    return (row.start ?? row.due!) <= days[6] && (row.due ?? row.start!) >= days[0]
  })
  return <section className="glass-card min-w-0">
    <header className="studio-panel-header flex-wrap">
      <h2 className="studio-heading">Project Timeline</h2>
      <div className="flex items-center gap-1 text-xs">
        <button className="studio-week-btn" aria-label="Previous week" onClick={() => { setWeek(week - 1); setShowAll(false) }}><ChevronLeft className="size-4" /></button>
        <button className="studio-week-btn" aria-label="Next week" onClick={() => { setWeek(week + 1); setShowAll(false) }}><ChevronRight className="size-4" /></button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="glass-btn inline-flex items-center gap-2 rounded-full px-3 py-2 tabular-nums" aria-label="Select timeline week">{dateLabel.format(new Date(days[0]))} – {dateLabel.format(new Date(days[6]))}<ChevronDown className="size-3.5" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {[[-1, 'Last week'], [0, 'This week'], [1, 'Next week']].map(([value, label]) => <DropdownMenuItem key={value} onSelect={() => { setWeek(Number(value)); setShowAll(false) }}>{label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    <div className="scroll-x thin-scroll">
      <div className="studio-timeline">
        <div className="studio-timeline-row studio-timeline-labels"><span>Project</span>{days.map((day) => <span key={day} className={day === TODAY ? 'studio-current-day font-semibold text-azure' : undefined}>{weekDay.format(new Date(day))}</span>)}</div>
        {scheduled.length === 0 && <p className="studio-empty studio-timeline-empty">No scheduled projects this week.</p>}
        {(showAll ? scheduled : scheduled.slice(0, 4)).map(({ project, start, due }) => {
          const first = days.findIndex((d) => d >= (start ?? due!))
          const last = days.filter((d) => d <= (due ?? start!)).length - 1
          return <button className="studio-timeline-row studio-timeline-project w-full text-start hover:bg-foreground/[0.04]" key={project.id} onClick={() => dispatch({ type: 'nav', nav: { page: 'project', projectId: project.id } })} title={project.name}>
            <span className="truncate"><bdi>{project.name}</bdi></span>
            {days.map((day, i) => <span key={day} className={day === TODAY ? 'studio-timeline-today' : undefined} style={{ gridColumn: i + 2 }} aria-hidden="true" />)}
            <span className={due && due <= days[6] ? "studio-timeline-bar studio-milestone" : "studio-timeline-bar"} style={{ gridColumn: (first + 2) + ' / ' + (last + 3) }} />
          </button>
        })}
      </div>
    </div>
    {scheduled.length > 4 && <div className="border-t px-4 py-2"><button className="studio-link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : 'View all projects this week'}</button></div>}
  </section>
}

function TodayFocus({ tasks }: { tasks: Task[] }) {
  const { state, projectById, dispatch } = useStore()
  const { dShort } = useFmt()
  const [expanded, setExpanded] = useState(false)
  const focus = tasks.flatMap((t) => {
    const done = activityStatus(state, t) === 'done'
    if (done && t.due !== TODAY) return []
    const overdue = !!t.due && t.due < TODAY && !done
    const dueToday = t.due === TODAY
    const critical = !done && t.priority === 'urgent'
    const priority = !done && t.priority === 'high'
    const upcoming = !done && !!t.due && t.due > TODAY && t.due <= addDays(TODAY, 7)
    const label = overdue ? 'Overdue' : dueToday ? 'Today' : critical ? 'Critical' : priority ? 'High priority' : upcoming ? 'Upcoming' : null
    const order = overdue ? 0 : critical ? 1 : dueToday ? 2 : priority ? 3 : 4
    return label ? [{ t, label, order, done }] : []
  }).sort((a, b) => Number(a.done) - Number(b.done) || a.order - b.order || (a.t.due ?? '9999').localeCompare(b.t.due ?? '9999'))
  const todayRows = focus.filter(({ t }) => t.due === TODAY)
  const finished = todayRows.filter(({ done }) => done).length
  return <section className="glass-card min-w-0">
    <header className="studio-panel-header"><h2 className="studio-heading">Today's Focus</h2>{focus.length > 4 && <button className="studio-link" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'View all'}</button>}</header>
    {focus.length === 0 && <p className="studio-empty">No urgent, due or upcoming work.</p>}
    <ul className="divide-y px-4">{(expanded ? focus : focus.slice(0, 4)).map(({ t, label, done }) => <li key={t.id}>
      <button className="flex min-h-12 w-full items-center gap-2.5 py-2 text-start hover:text-azure" onClick={() => dispatch({ type: 'openTask', id: t.id })}>
        {done ? <span className="studio-task-complete size-5 shrink-0" aria-hidden="true">✓</span> : <span className="size-5 shrink-0 rounded-full border border-muted-foreground/50" aria-hidden="true" />}
        <span className="min-w-0 flex-1"><span className="block truncate text-sm"><bdi>{t.name}</bdi></span><span className="block truncate text-xs text-muted-foreground"><bdi>{projectById[t.projectId]?.name}</bdi>{t.due && ' · ' + dShort(t.due)}</span></span>
        <span className={label === 'Overdue' || label === 'Critical' ? 'shrink-0 text-xs text-destructive' : label === 'Today' && !done ? 'studio-focus-today shrink-0 text-xs' : 'shrink-0 text-xs text-azure'}>{done ? 'Completed' : label}</span>
      </button>
    </li>)}</ul>
    {!!todayRows.length && <div className="flex items-center gap-3 px-4 py-3 text-sm" aria-label={finished + ' of ' + todayRows.length + ' due today completed'}><Bar className="h-1" value={100 * finished / todayRows.length} /><span className="shrink-0">{finished} / {todayRows.length}</span></div>}
  </section>
}

function ProjectPortfolio({ entries, progress }: { entries: ReturnType<typeof projectSchedule>[]; progress: Map<string, number | null> }) {
  const { state, userById, dispatch } = useStore()
  const { dShort, pct } = useFmt()
  const portfolio = useRef<HTMLDivElement>(null)
  const showNext = () => {
    const row = portfolio.current
    if (!row) return
    const atEnd = row.scrollLeft >= row.scrollWidth - row.clientWidth - 2
    row.scrollTo({ left: atEnd ? 0 : row.scrollLeft + row.clientWidth, behavior: 'auto' })
  }
  return <section className="glass-card relative min-w-0">
    <header className="studio-panel-header"><h2 className="studio-heading">Project Portfolio</h2><button className="studio-link" onClick={() => dispatch({ type: 'nav', nav: { page: 'projects' } })}>View all <ArrowRight className="size-4" /></button></header>
    {!entries.length ? <p className="studio-empty">No projects to show.</p> : <><div ref={portfolio} className="studio-portfolio thin-scroll p-4 pt-3">
      {entries.map(({ project, start, due }) => {
        const value = progress.get(project.id) ?? null
        const staffing = staffingOf(project, state.users)
        const managers = project.managerId ? [project.managerId] : WORK_SCOPES.flatMap((scope) => staffing[scope].managerId ?? [])
        const leadNames = [...new Set(managers)].flatMap((id) => userById[id]?.name ?? []).join(', ')
        const openProject = () => dispatch({ type: 'nav', nav: { page: 'project', projectId: project.id } })
        return <article key={project.id} className="glass-item is-interactive relative min-w-0 overflow-hidden rounded-xl">
          <button className="block w-full text-start" aria-label={'Open ' + project.name} onClick={openProject}>
            <ProjectCover image={project.coverImage} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="studio-cover-menu" aria-label={'Actions for ' + project.name}><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem onSelect={openProject}>Open project</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
          <div className="space-y-1.5 p-3">
            <h3 className="break-words text-base font-medium leading-snug"><button className="text-start hover:underline" onClick={openProject}><bdi>{project.name}</bdi></button></h3>
            <p className="text-xs text-muted-foreground"><bdi>{projectTypeLabel(project.type)}</bdi></p>
            <div className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5"><span className="size-2 shrink-0 rounded-full bg-azure" />{(value ?? 0) >= 100 ? 'Completed' : value ? 'In Progress' : start || due ? 'Scheduled' : 'No tracked progress'}</span><span className="num">{value == null ? '—' : pct(value)}</span></div>
            {value != null && <Bar value={value} />}
            <dl className="grid gap-1 border-t pt-2 text-[11px]">
              <div className="flex flex-wrap justify-between gap-x-1"><dt className="text-muted-foreground">Project Manager</dt><dd><bdi>{leadNames || '—'}</bdi></dd></div>
              <div className="flex flex-wrap justify-between gap-x-1"><dt className="text-muted-foreground">Start Date</dt><dd>{start ? dShort(start) : '—'}</dd></div>
              <div className="flex flex-wrap justify-between gap-x-1"><dt className="text-muted-foreground">Due Date</dt><dd>{due ? dShort(due) : '—'}</dd></div>
            </dl>
          </div>
        </article>
      })}
    </div>{entries.length > 1 && <button className="studio-portfolio-next glass-btn" aria-label="Show more projects" onClick={showNext}><ChevronRight className="size-4" /></button>}</>}
  </section>
}

export function OverviewHeading({ className }: { className?: string }) {
  const { locale } = useFmt()
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(TODAY))
  return <div className={className}><h1 className="studio-title">Studio Overview</h1><p className="mt-2 text-sm text-muted-foreground">{date}</p></div>
}

export function StudioOverview({ utilization, hasCapacity }: { utilization: number; hasCapacity: boolean }) {
  const { state, workItems, can, dispatch } = useStore()
  const { n, dShort, pct } = useFmt()
  const { tasks, projects, progress } = useMemo(() => {
    const visible = workItems.filter((t) => !t.removedFromMdr)
    const byProject = new Map<string, Task[]>()
    for (const task of visible) {
      const list = byProject.get(task.projectId) ?? []
      list.push(task)
      byProject.set(task.projectId, list)
    }
    const projects = state.projects.filter(activeProject).map((project) => projectSchedule(project, byProject.get(project.id) ?? []))
    const progress = new Map(projects.map(({ project }) => [project.id, projectProgress(state, project.id).total]))
    return { tasks: visible, projects, progress }
  }, [state.projects, state.tasks, state.statusSets, workItems])
  const focusTasks = [...tasks, ...Object.values(state.tasks).filter((t) => isFlowTask(t) && !t.removedFromMdr && can.viewTask(t)&&isActiveProjectId(state.projects,t.projectId))]
  const active = projects.filter(({ project }) => (progress.get(project.id) ?? 0) < 100)
  const doing = tasks.filter((t) => activityStatus(state, t) === 'doing')
  const upcoming = tasks.filter((t) => t.due && t.due >= TODAY && t.due <= addDays(TODAY, 7) && activityStatus(state, t) !== 'done').sort((a, b) => a.due!.localeCompare(b.due!))
  const stats = [
    { label: 'Active Projects', value: n(active.length), sub: n(projects.length) + ' total projects', icon: Box },
    { label: 'Tasks in Progress', value: n(doing.length), sub: (tasks.length ? pct(100 * doing.length / tasks.length) : '0%') + ' of visible project tasks', icon: null },
    { label: 'Upcoming Deadlines', value: n(upcoming.length), sub: upcoming.length ? 'Next: ' + dShort(upcoming[0].due!) : 'Next 7 days', icon: Flag },
    { label: 'Utilization', value: hasCapacity ? pct(utilization) : '—', sub: 'Planned capacity this week', icon: BarChart3 },
  ]
  return <div className="space-y-4">
    <div className="studio-stats">{stats.map(({ label, value, sub, icon: Icon }) => <section key={label} className="glass-card studio-stat">
      <div><h2 className="text-sm font-medium">{label}</h2><p className="num studio-stat-value">{value}</p><p className="text-xs text-muted-foreground">{sub}</p></div>
      {Icon ? <Icon className="size-8 shrink-0 text-azure" strokeWidth={1.25} aria-hidden="true" /> : <span className="studio-kpi-donut" style={{ "--progress": tasks.length ? 100 * doing.length / tasks.length + "%" : "0%" } as CSSProperties} aria-hidden="true" />}
    </section>)}</div>
    <div className="studio-overview-grid">
      <ProjectTimeline entries={projects} />
      <TodayFocus tasks={focusTasks} />
      <ProjectPortfolio entries={[...active, ...projects.filter((row) => !active.includes(row))]} progress={progress} />
      <TeamActivity compact onViewAll={can.page('adminreports') ? () => dispatch({ type: 'nav', nav: { page: 'adminreports' } }) : undefined} />
    </div>
  </div>
}
