import { emptyOffice, applyOffice, OFFICE_ACTIONS, type OfficeData, type OfficeAction } from './office'
import { applyRoleAction, resolveRole, type RoleAction, type RoleDefinition } from './accessRoles'
import { applyWhiteboard, type WhiteboardAction } from './whiteboards'
import { emptyWorkspace, applyWorkspace, WORKSPACE_ACTIONS, type WorkspaceData, type WorkspaceAction } from './workspace'
// Pure application state: types, actions and the guarded reducer. Shared by the browser and the server — no React, DOM or storage here.
import { buildSeed, TODAY } from './seed'
import type { Resource } from './planning'
import { J_MONTHS, jalaliFa, tehranTime, toJalali } from './jalali'
import type {
  Allocation, Attachment, AuditEntry, ChatMessage, Comment, FlowState, Holiday, InternalProject, Leave, Notification, NotifLink, PointConfig, PointEntry, Project, ReviewRound, WorkLog, Role, Status, SyncItem, SyncRun, Task, Team, User, WriteBackItem, MdrRefresh,
  AdminRequest, LeaveDetails, MonthClose, OtherDetails, RequestStep, TimesheetCalc, TimesheetConfig, TimesheetDay,
  PersonalBoard, PersonalStatus, PersonalTask, Priority, ProjectStage, WorkScope,
} from './types'
import { emptyStaffing, ensureProjectPhases } from './organization'
import { boardOf, descendants, nextOrder, tasksOf } from './personal'
import {
  configFor, dayKey, hm, hourLeaveMinutes, isOffDay, KIND_FA, LEAVE_CAT_FA, leaveDates, monthRange, settleDays, STATUS_FA,
} from './admin'
import { activeOf, channelMembers, effectiveScope, finSpaceOf, flowOf, isFinTask, isFlowTask, isWorkItem, parentScopeOf, parseMentions, statusesFor, statusOf, FIN_SPACE_FA, FLOW_FA, type FinSpace } from './domain'
import { AUDIT_FIELD } from './taskFields'
import type { ScoreRecord, ScoreOverride } from './scores'
import { categoryOfProject, projectCategories, type ProjectCategoryConfig } from './projectDetails'
import { canViewTask, guard, has } from './policy'

export type Page = 'settings' | 'home' | 'projects' | 'project' | 'workload' | 'review' | 'runs' | 'admin' | 'notifications' | 'pchat' | 'chat' | 'team' | 'supervision' | 'points'
  | 'documents' | 'links' | 'requests' | 'timesheet' | 'inbox' | 'adminreports' | 'personal' | 'finadmin'
/** Pages of the Project Control section: CEO and Project Control only */
export const CONTROL_PAGES: Page[] = ['workload', 'review', 'runs', 'points', 'admin']
export interface Nav { page: Page; projectId?: string; channelId?: string; teamId?: string; date?: string; userId?: string; requestId?: string; space?: FinSpace; tab?: string; taskView?: string }

export interface State extends WorkspaceData, OfficeData {
  teams: Team[]; users: User[]; projects: Project[]; tasks: Record<string, Task>
  projectCategories?: Record<string, ProjectCategoryConfig>
  statusSets: Record<string, Status[]>; allocations: Allocation[]; holidays: Holiday[]; leaves: Leave[]
  syncItems: SyncItem[]; syncRuns: SyncRun[]; audit: AuditEntry[]; writeQueue: WriteBackItem[]
  comments: Comment[]; messages: ChatMessage[]; notifications: Notification[]; lastRead: Record<string, string>
  roleDefinitions: Record<string, RoleDefinition>; whiteboards: Record<string, import('./whiteboards').Whiteboard>
  session: string | null; nav: Nav; openTaskId: string | null; profileUserId: string | null
  theme: ThemeChoice
  internalProjects: InternalProject[]; reviewRounds: ReviewRound[]; attachments: Attachment[]
  scores?: Record<string, ScoreRecord>; pointEntries: PointEntry[]; pointConfigs: PointConfig[]
  scoreOverrides?: Record<string, ScoreOverride>
  workLogs: WorkLog[]
  adminRequests: AdminRequest[]; timesheets: Record<string, TimesheetDay>; timesheetConfigs: TimesheetConfig[]; monthCloses: MonthClose[]
  /** private to each person; never read by projects, plans, calendars or reports */
  personalTasks: Record<string, PersonalTask>; personalBoards: Record<string, PersonalBoard>
  profileTab: 'profile' | 'points'
  /** Last refused action — shown as a toast; the refusal itself is also in the AuditLog */
  denial: { id: number; text: string; title?: string } | null
}

export type NewFile = { name: string; mime: string; size: number; dataUrl: string }
export type FlowOp = 'assign' | 'assignTeam' | 'start' | 'submit' | 'complete' | 'approve' | 'rework' | 'reopen'

export type ThemeChoice = 'system' | 'light' | 'dark'

export const WRITEBACK_DELAY_SEC = 120

export type Action = RoleAction | WhiteboardAction | OfficeAction | WorkspaceAction
  | { type: 'classifyTasks'; ids: string[]; projectStage: ProjectStage; workScope?: WorkScope }
  | { type: 'teamAdd'; team: Team }
  | { type: 'teamUpdate'; id: string; patch: Pick<Team, 'name' | 'kind' | 'icon'> }
  | { type: 'teamArchive'; id: string; archived: boolean }
  | { type: 'teamMember'; userId: string; teamId: string }
  | { type: 'login'; id: string }
  | { type: 'logout' }
  | { type: 'register'; user: User }
  | { type: 'approveUser'; id: string; teamId: string; role: Role }
  | { type: 'rejectUser'; id: string }
  | { type: 'addUser'; user: User }
  | { type: 'updateUser'; id: string; patch: Partial<User> }
  | { type: 'openProfile'; id: string | null; tab?: 'profile' | 'points' }
  | { type: 'setTheme'; theme: ThemeChoice }
  | { type: 'nav'; nav: Nav; fromHistory?: boolean }
  | { type: 'openTask'; id: string | null }
  | { type: 'setStatus'; taskId: string; statusId: string }
  | { type: 'savePlan'; taskId: string; assignee: Resource | null; estimation?: number; start?: string; due?: string; allocations: Allocation[] }
  | { type: 'addTask'; task: Task }
  | { type: 'addComment'; taskId: string; text: string }
  | { type: 'sendMessage'; channelId: string; text: string }
  | { type: 'readNotifs'; ids?: string[] }
  | { type: 'readChannel'; channelId: string }
  | { type: 'review'; ids: string[]; approve: boolean }
  | { type: 'addRun'; run: SyncRun }
  | { type: 'updateRun'; id: string; patch: Partial<SyncRun> }
  | { type: 'flushWriteBack' }
  // ---------- jobs of the server itself (session = null); a browser can never send these ----------
  | { type: 'sysRunStart'; run: SyncRun }
  | { type: 'sysSyncResult'; projectId: string; runId: string; run: Partial<SyncRun>; items: SyncItem[]; refresh: MdrRefresh[]; at: string; replacePending: boolean; by?: string }
  | { type: 'sysWriteBack'; runs: SyncRun[]; settled: { taskId: string; queuedAt: number }[]; rows: { taskId: string; mdrRow: number }[] }
  | { type: 'addHoliday'; holiday: Holiday } | { type: 'removeHoliday'; id: string }
  | { type: 'addLeave'; leave: Leave } | { type: 'removeLeave'; id: string }
  | { type: 'statusAdd'; scope: string; status: Status }
  | { type: 'statusUpdate'; scope: string; id: string; patch: Partial<Status> }
  | { type: 'statusDelete'; scope: string; id: string; moveTo?: string }
  | { type: 'statusOverride'; scope: string }
  | { type: 'statusInherit'; scope: string }
  | { type: 'projectAdd'; project: Project }
  | { type: 'projectUpdate'; id: string; patch: Partial<Project> }
  | { type: 'projectCategory'; op: 'create'|'rename'|'remove'; name: string; replacement?: string }
  | { type: 'projectLifecycle'; id: string; op: 'archive'|'unarchive'|'delete'|'restore'; confirmation?: string }
  | { type: 'createFlowTask'; task: Task; files?: NewFile[] }
  | { type: 'flow'; taskId: string; op: FlowOp; assigneeId?: string; note?: string; files?: NewFile[] }
  | { type: 'updateTask'; taskId: string; patch: Partial<Task> }
  | { type: 'finTaskArchive'; taskId: string; archived: boolean }
  | { type: 'addAttachments'; taskId: string; files: NewFile[] }
  | { type: 'setActual'; taskId: string; actualStart?: string; actualFinish?: string; reason: string }
  | { type: 'internalProjectAdd'; project: InternalProject }
  | { type: 'internalProjectUpdate'; id: string; patch: Partial<InternalProject> }
  | { type: 'logWork'; log: { taskId: string; minutes: number; workDate: string; description: string } }
  | { type: 'editWorkLog'; id: string; patch: { minutes: number; workDate: string; description: string }; reason?: string }
  | { type: 'deleteWorkLog'; id: string; reason?: string }
  | { type: 'pointRecalc'; taskId: string }
  | { type: 'taskScoreOverride'; taskId: string; value: number | null; reason: string }
  | { type: 'pointAdjust'; userId: string; points: number; reason: string; taskId?: string }
  | { type: 'pointConfig'; config: Pick<PointConfig, 'multiplier' | 'hoursPerDay' | 'earlyFactor' | 'lateFactor' | 'cap'>; reason: string }
  | { type: 'reqCreate'; req: NewRequest; files?: NewFile[] }
  | { type: 'reqItUpdate'; id: string; status: 'it_in_progress' | 'it_resolved'; note?: string }
  | { type: 'reqDecide'; id: string; decision: 'approve' | 'reject'; note?: string; minutes?: number }
  | { type: 'reqWithdraw'; id: string }
  | { type: 'reqCancel'; id: string; note: string }
  | { type: 'tsSave'; userId: string; date: string; checkIn?: string; checkOut?: string; breakMinutes: number; note?: string; reason?: string }
  | { type: 'tsPunch'; kind: 'in' | 'out' }
  | { type: 'tsUnpaid'; date: string }
  | { type: 'monthClose'; month: string }
  | { type: 'tsConfig'; config: Pick<TimesheetConfig, 'dutyNetMinutes' | 'minBreakMinutes' | 'editDays' | 'from'>; reason: string }
  | { type: 'ptCreate'; task: { title: string; description?: string; parentId?: string | null; statusId?: string; priority?: Priority; start?: string; due?: string } }
  | { type: 'ptUpdate'; id: string; patch: Partial<Pick<PersonalTask, 'title' | 'description' | 'statusId' | 'priority' | 'start' | 'due'>> }
  | { type: 'ptDelete'; id: string }
  | { type: 'ptMove'; id: string; parentId: string | null; index: number }
  | { type: 'psSave'; statuses: PersonalStatus[]; defaultStatusId: string; remap?: Record<string, string> }

export type NewRequest =
  | { kind: 'leave'; description: string; leave: LeaveDetails }
  | { kind: 'overtime'; description: string; overtime: { date: string; minutes: number; taskIds: string[] } }
  | { kind: 'other'; description: string; other: OtherDetails }
  | { kind: 'it'; description: string; it: { title: string } }

let seq = 100
/** Prefix of ids made by this process. The server sets a fresh one at every start, so ids never repeat across restarts. */
let idBase = ''
export function setIdBase(base: string) { idBase = base }
const nowIso = () => new Date().toISOString()

// ---------- pure selectors (lib/domain.ts) and permissions (lib/policy.ts) ----------
export { ancestors, effectiveScope, parentScopeOf, statusesFor, statusOf, isWorkItem, isFlowTask, isFinTask, finSpaceOf, finProjectId, FIN_SPACES, FIN_SPACE_FA, activeOf, projectTeams, channelMembers, parseMentions, teamOfTask, flowOf, flowProgress, taskProgress, isClosed, FLOW_FA, FLOW_ORDER, FLOW_PROGRESS } from './domain'

export function rollupMap(state: Pick<State, 'tasks' | 'statusSets'>) {
  const kids: Record<string, Task[]> = {}
  for (const t of Object.values(state.tasks)) {
    const key = t.parentId ?? `root:${t.projectId}`
    ;(kids[key] ??= []).push(t)
  }
  for (const k of Object.keys(kids)) kids[k].sort((a, b) => a.order - b.order)
  type R = { progress: number; est: number; start?: string; due?: string; items: number; done: number; unassigned: number }
  const memo: Record<string, R> = {}
  const calc = (t: Task): R => {
    if (memo[t.id]) return memo[t.id]
    if (isWorkItem(t)) {
      const s = statusOf(state, t)
      const r: R = { progress: s?.progress ?? 0, est: t.estimation ?? 0, start: t.start, due: t.due, items: 1, done: s?.category === 'done' ? 1 : 0, unassigned: !t.assigneeUserId && !t.assigneeTeamId ? 1 : 0 }
      return (memo[t.id] = r)
    }
    const ch = (kids[t.id] ?? []).filter((c) => !c.removedFromMdr)
    let wsum = 0, psum = 0, plain = 0
    const r: R = { progress: 0, est: 0, items: 0, done: 0, unassigned: 0 }
    for (const c of ch) {
      const cr = calc(c)
      const w = c.weight ?? 1
      wsum += w; psum += w * cr.progress; plain += cr.progress
      r.est += cr.est; r.items += cr.items; r.done += cr.done; r.unassigned += cr.unassigned
      if (cr.start && (!r.start || cr.start < r.start)) r.start = cr.start
      if (cr.due && (!r.due || cr.due > r.due)) r.due = cr.due
    }
    // MDR weights are shares of the whole project; when every child of a row weighs 0 the row still shows its children's mean
    r.progress = wsum ? psum / wsum : ch.length ? plain / ch.length : 0
    return (memo[t.id] = r)
  }
  for (const t of Object.values(state.tasks)) calc(t)
  return { kids, roll: memo }
}

// ---------- reducer helpers ----------
const actor = (state: State) => state.session ?? 'system'
const nameOf = (state: State, id?: string | null) => state.users.find((u) => u.id === id)?.name ?? "Category: Systems"
function auditOf(state: State, kind: AuditEntry['kind'], text: string, taskId?: string): AuditEntry {
  return { id: `a-${idBase}${seq++}`, at: nowIso(), userId: actor(state), taskId, kind, text }
}
/** One notification per recipient; the person who acted is never notified of their own action */
function notify(state: State, recipients: (string | undefined)[], n: Omit<Notification, 'id' | 'userId' | 'read' | 'at'>): Notification[] {
  const active = new Set(activeOf(state.users).map((u) => u.id))
  return [...new Set(recipients)].filter((id): id is string => !!id && id !== state.session && active.has(id))
    .map((userId) => ({ id: `n-${idBase}${seq++}`, userId, at: nowIso(), read: false, actorId: state.session ?? undefined, ...n }))
}
const teamMembers = (state: State, teamId?: string) => activeOf(state.users).filter((u) => u.teamId === teamId).map((u) => u.id)
/** Project Control desk: receives Sync, account and issue notifications */
const controlIds = (state: State) => activeOf(state.users).filter((u) => u.role === 'control' || u.role === 'ceo').map((u) => u.id)
const recipientsOfTask = (state: State, t: Task) => (t.assigneeUserId ? [t.assigneeUserId] : t.assigneeTeamId ? teamMembers(state, t.assigneeTeamId) : [])
function sysMsg(channelId: string, text: string, link?: NotifLink): ChatMessage {
  return { id: `m-${idBase}${seq++}`, channelId, userId: null, system: true, at: nowIso(), text, mentions: [], link }
}

/** 150 → «2:30» (h:mm) for AuditLog lines */
export const fmtMinutes = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`

const FIELD_FA = AUDIT_FIELD
/** What a flow task is called in notifications and AuditLog lines */
const flowLabel = (t: Task) => (t.kind === 'supervision' ? "Surveillance Case" : t.kind === 'internal' ? "Task Team" : t.kind === 'finadmin' ? (finSpaceOf(t) === 'office' ? "Office Task" : "Financial Task") : "Task")
/** The CEO coordinates the Finance & Administration space */
const ceoIds = (state: State) => activeOf(state.users).filter((u) => u.role === 'ceo').map((u) => u.id)
function mkAttachment(state: State, taskId: string, f: NewFile, roundId?: string): Attachment {
  return { id: `f-${idBase}${seq++}`, taskId, roundId, name: f.name, mime: f.mime, size: f.size, dataUrl: f.dataUrl, uploadedBy: actor(state), uploadedAt: nowIso() }
}

/** Create → Assign → Execution → Submit for Review → Approve / Rework → Close; for project work items the review overlays the Status Set */
function applyFlow(state: State, a: Extract<Action, { type: 'flow' }>): State {
  const t = state.tasks[a.taskId]
  const me = actor(state)
  const note = (a.note ?? '').trim()
  const link: NotifLink = { type: 'task', id: t.id }
  const label = flowLabel(t)
  const prevRounds = state.reviewRounds.filter((r) => r.taskId === t.id)
  const openRound = [...prevRounds].reverse().find((r) => !r.decision)
  const audit: AuditEntry[] = []
  let nt: Task = { ...t }
  let next: State = state
  let rounds = state.reviewRounds
  let files: Attachment[] = []
  let n: Notification[] = []
  const setFlow = (f: FlowState | undefined) => { if (f && isFlowTask(t)) audit.push(auditOf(state, 'review', `${FLOW_FA[flowOf(t)]} ← ${FLOW_FA[f]}${note ? `: ${note}` : ''}`, t.id)); nt.flow = f }
  const decide = (decision: 'approve' | 'rework') => {
    if (openRound) rounds = rounds.map((r) => (r.id === openRound.id ? { ...r, decision, decidedBy: me, decidedAt: nowIso(), decisionNote: note || undefined } : r))
  }
  switch (a.op) {
    case 'assignTeam': {
      nt.assigneeTeamId=a.assigneeId;nt.assigneeUserId=undefined
      setFlow(flowOf(t)==='in_progress'?'in_progress':flowOf(t)==='rework'?'rework':'assigned')
      audit.push(auditOf(state,'allocation',`Responsible Team: ${state.teams.find(tm=>tm.id===a.assigneeId)?.name??''}`,t.id))
      break
    }
    case 'assign': {
      nt.assigneeUserId = a.assigneeId
      if(t.kind==='supervision')nt.assigneeTeamId=state.users.find(u=>u.id===a.assigneeId)?.teamId
      setFlow(flowOf(t) === 'rework' ? 'rework' : flowOf(t) === 'in_progress' ? 'in_progress' : 'assigned')
      audit.push(auditOf(state, 'allocation', `Reference to ${nameOf(state, a.assigneeId)}`, t.id))
      n = notify(state, [a.assigneeId], { kind: 'assign', title: `${label} «${t.name}» was assigned to you`, body: note || undefined, link })
      break
    }
    case 'start': {
      setFlow('in_progress')
      if (!t.actualStart) { nt.actualStart = TODAY; audit.push(auditOf(state, 'actual', `Indeed Start was registered: ${jalaliFa(TODAY)}`, t.id)) }
      n = notify(state, [t.reviewerId ?? t.reporterId], { kind: 'status', title: `${nameOf(state, me)} started working " ${t.name} " ${flowOf(t) === 'rework' ? "for correction" : ''}`, link })
      break
    }
    case 'submit': {
      const round: ReviewRound = { id: `r-${idBase}${seq++}`, taskId: t.id, round: prevRounds.length + 1, submittedBy: me, submittedAt: nowIso(), note }
      rounds = [...rounds, round]
      files = (a.files ?? []).map((f) => mkAttachment(state, t.id, f, round.id))
      setFlow('in_review')
      if (!isFlowTask(t)) audit.push(auditOf(state, 'review', `Send for review ${round.round}: ${note}`, t.id))
      const deciders = t.reviewerId ? [t.reviewerId] : activeOf(state.users).filter((u) => u.teamId === t.teamSpaceId && u.role === 'lead').map((u) => u.id)
      n = notify(state, deciders, { kind: 'review', title: `«${t.name}» was submitted for review (round ${round.round})`, body: note, link })
      break
    }
    case 'complete': {
      setFlow('closed')
      nt.actualFinish = t.actualFinish ?? TODAY
      audit.push(auditOf(state, 'actual', `Truly Final was registered: ${jalaliFa(TODAY)}`, t.id))
      n = notify(state, [t.reporterId, t.createdBy, ...(isFinTask(t) ? ceoIds(state) : [])], { kind: 'status', title: `${label} «${t.name}» was closed`, body: note || undefined, link })
      break
    }
    case 'approve': {
      decide('approve')
      if (isWorkItem(t)) {
        const done = statusesFor(state, t).find((x) => x.category === 'done')
        nt.flow = undefined
        next = apply({ ...state, tasks: { ...state.tasks, [t.id]: nt } }, { type: 'setStatus', taskId: t.id, statusId: done?.id ?? t.statusId ?? '' })
        nt = next.tasks[t.id]
        audit.push(auditOf(state, 'review', `Reviewer approval (round ${openRound?.round ?? 1})${note ? `: ${note}` : ''}`, t.id))
      } else {
        setFlow('closed')
        nt.actualFinish = t.actualFinish ?? TODAY
        audit.push(auditOf(state, 'actual', `Truly Final was registered: ${jalaliFa(TODAY)}`, t.id))
      }
      n = notify(state, [t.assigneeUserId, t.reporterId], { kind: 'review', title: `«${t.name}» was approved and closed`, body: note || undefined, link })
      break
    }
    case 'rework': {
      decide('rework')
      if (isWorkItem(t)) {
        const fix = statusesFor(state, t).find((x) => x.category === 'doing' && x.name.includes('اصلاح'))
        nt.flow = 'rework'
        if (fix && fix.id !== t.statusId) { next = apply({ ...state, tasks: { ...state.tasks, [t.id]: nt } }, { type: 'setStatus', taskId: t.id, statusId: fix.id }); nt = next.tasks[t.id] }
        audit.push(auditOf(state, 'review', `Return to Modification ${openRound?.round ?? 1}: ${note}`, t.id))
      } else setFlow('rework')
      n = notify(state, t.assigneeUserId ? [t.assigneeUserId] : recipientsOfTask(state, t), { kind: 'review', title: `«${t.name}» was returned for revisions`, body: note, link })
      break
    }
    case 'reopen': {
      setFlow('rework')
      nt.actualFinish = undefined
      audit.push(auditOf(state, 'actual', "The task was reopened and the actual finish date was cleared.", t.id))
      n = notify(state, [t.assigneeUserId], { kind: 'review', title: `«${t.name}» was reopened`, body: note, link })
      break
    }
  }
  const msgs = t.kind === 'supervision' && (a.op === 'approve' || a.op === 'rework') ? [sysMsg(`project:${t.projectId}`, `Site supervision task “${t.name}” ${a.op === 'approve' ? 'was approved and closed' : 'was returned for revisions'}.`, link)] : []
  return {
    ...next, tasks: { ...next.tasks, [t.id]: nt }, reviewRounds: rounds, attachments: [...next.attachments, ...files],
    notifications: [...n, ...next.notifications], messages: [...next.messages, ...msgs], audit: [...audit, ...next.audit],
  }
}

const ACTION_FA: Record<string, string> = {
  setStatus: "Change Status", savePlan: "Planning", addTask: "Create Task", createFlowTask: "Create Task", flow: "Workflow", updateTask: "Edit Task",
  addAttachments: "Add Attachment", setActual: "Modification of Real History", approveUser: "Membership confirmation", updateUser: "Edit User", openTask: "View Task",
  logWork: "Work Log", editWorkLog: "Edit Work Log", deleteWorkLog: "Delete Work Log",
  reqCreate: "Registration of office application", reqDecide: "decision on the request", reqWithdraw: "Get back the request", reqCancel: "Cancel leave", tsSave: "Timesheet", tsPunch: "Log in/Out",
  ptCreate: "Personal work", ptUpdate: "Personal work", ptDelete: "Personal work", ptMove: "Personal work", psSave: "Personal Status",
  tsUnpaid: "Overtime without payment", monthClose: "Close the Moon", tsConfig: "Timesheet rules", addLeave: "Record Leave", removeLeave: "Removal of leave", addHoliday: "Closed Registration", pointRecalc: "Recalculation of points", pointAdjust: "Modification of points", pointConfig: "Rating parameters", review: 'Sync Review', addRun: "Run Sync",
}

/** Every write passes the permission guard first (the browser stand-in for server-side checks). Refusals change nothing but the AuditLog. */
export function reducer(state: State, a: Action): State {
  const denied = guard(state, a as unknown as { type: string })
  if (denied) {
    const t = 'taskId' in a ? (a as { taskId: string }).taskId : a.type === 'openTask' && a.id ? a.id : a.type === 'logWork' ? a.log.taskId
      : a.type === 'editWorkLog' || a.type === 'deleteWorkLog' ? state.workLogs.find((l) => l.id === a.id)?.taskId : undefined
    return { ...state, denial: { id: seq++, text: denied }, audit: [auditOf(state, 'security', `Rejection Access: ${ACTION_FA[a.type] ?? a.type} — ${denied}`, t && state.tasks[t] ? t : undefined), ...state.audit] }
  }
  const next = OFFICE_ACTIONS.has(a.type) ? applyOffice(state, a as OfficeAction) : WORKSPACE_ACTIONS.has(a.type) ? applyWorkspace(state, a as WorkspaceAction) : apply(state, a as Exclude<Action, WorkspaceAction | OfficeAction>)
  if (TIMESHEET_TRIGGERS.has(a.type)) return settleTimesheets(next)
  return next
}

export const currentPointConfig = (s: Pick<State, 'pointConfigs'>) => s.pointConfigs[s.pointConfigs.length - 1]

// ---------- administrative module: requests and timesheets ----------
export const EMPTY_CALC: TimesheetCalc = { presence: 0, breakMinutes: 0, worked: 0, duty: 0, leave: 0, offDay: false, excess: 0, requested: 0, approved: 0, pending: 0, unpaid: 0, undecided: 0, deficit: 0, configVersion: 0 }
const roleIds = (state: State, role: Role) => activeOf(state.users).filter((u) => u.role === role).map((u) => u.id)
export function requestSummary(r: AdminRequest, holidays: Set<string>) {
  if (r.it) return r.it.title
  if (r.kind === 'leave' && r.leave) {
    const l = r.leave
    return l.mode === 'hour'
      ? `${LEAVE_CAT_FA[l.category]}, Hour ${jalaliFa(l.from)} From ${l.startTime ?? ''} To ${l.endTime ?? ''}`
      : `${LEAVE_CAT_FA[l.category]}, ${String(leaveDates(l, holidays).length)} Working day from ${jalaliFa(l.from)} to ${jalaliFa(l.to)}`
  }
  if (r.kind === 'overtime' && r.overtime) return `${hm(r.overtime.minutes)} on ${jalaliFa(r.overtime.date)}${r.overtime.source === 'advance' ? " (Before)" : ''}`
  return r.other?.title ?? ''
}
/** Leave rows for the planner, one per working day; full days take the person's daily capacity */
function leaveRowsOf(state: State, r: AdminRequest): Leave[] {
  const u = state.users.find((x) => x.id === r.userId)
  const holidays = new Set(state.holidays.map((h) => h.date))
  const l = r.leave!
  const hours = l.mode === 'hour' ? Math.round((hourLeaveMinutes(l) / 60) * 100) / 100 : u?.capacity ?? 8
  return leaveDates(l, holidays).map((date, i) => ({ id: `l-r${r.no}-${i + 1}`, userId: r.userId, date, hours, note: l.mode === 'hour' ? "Hour leave" : "Leave", requestId: r.id, at: nowIso() }))
}
function applyRequestCreate(state: State, a: Extract<Action, { type: 'reqCreate' }>): State {
  const me = state.users.find((u) => u.id === state.session)!
  const at = nowIso()
  const no = Math.max(0, ...state.adminRequests.map((r) => r.no)) + 1
  const steps: RequestStep[] = [{ stage: 'submit', by: me.id, at }]
  let status: AdminRequest['status'] = 'pending_office'
  const office = roleIds(state, 'office').filter((id) => id !== me.id)
  if (a.req.kind === 'it') status = 'pending_it'
  else if (me.role === 'ceo') { status = 'approved'; steps.push({ stage: 'system', by: me.id, at, decision: 'approve', note: "The CEO’s request was filed without approval." }) }
  else if (me.role === 'office' || !office.length) { status = 'pending_ceo'; steps.push({ stage: 'system', by: 'system', at, note: me.role === 'office' ? "The manager’s request went directly to the CEO’s cartel." : "The manager is not active; the request went directly to the manager." }) }
  const q = a.req
  const r: AdminRequest = {
    id: `rq-${idBase}${seq++}`, no, userId: me.id, kind: q.kind, status, createdAt: at, stageSince: at, description: q.description.trim(), steps,
    files: (a.files ?? []).map((f) => ({ id: `rf-${idBase}${seq++}`, name: f.name, mime: f.mime, size: f.size, dataUrl: f.dataUrl, uploadedAt: at })),
  }
  if (q.kind === 'leave') r.leave = { ...q.leave, category: 'unified', to: q.leave.mode === 'hour' ? q.leave.from : q.leave.to }
  if (q.kind === 'it') r.it = { title: q.it.title.trim() }
  if (q.kind === 'other') r.other = { ...q.other, title: q.other.title.trim() }
  if (q.kind === 'overtime') {
    const day = state.timesheets[dayKey(me.id, q.overtime.date)]
    r.overtime = { date: q.overtime.date, minutes: q.overtime.minutes, taskIds: [...new Set(q.overtime.taskIds)], source: day?.checkOut ? 'timesheet' : 'advance' }
    if (status === 'approved') r.overtime.approvedMinutes = q.overtime.minutes
  }
  let leaves = state.leaves
  if (status === 'approved' && r.kind === 'leave') { const rows = leaveRowsOf(state, r); r.leaveIds = rows.map((x) => x.id); leaves = [...leaves, ...rows] }
  const holidays = new Set(state.holidays.map((h) => h.date))
  const sum = requestSummary(r, holidays)
  const deciders = status === 'pending_it' ? state.users.filter(user => has(user, 'requests.it')).map(user => user.id) : status === 'pending_office' ? office : status === 'pending_ceo' ? roleIds(state, 'ceo') : []
  const n = notify(state, deciders, { kind: 'request', title: `Request ${KIND_FA[r.kind]} from ${me.name}`, body: sum, link: { type: 'page', page: 'inbox', requestId: r.id } })
  return {
    ...state, adminRequests: [...state.adminRequests, r], leaves, notifications: [...n, ...state.notifications],
    audit: q.kind === 'it' ? state.audit : [auditOf(state, 'request', `Request ${KIND_FA[r.kind]} # ${no} Registered ${STATUS_FA[status]} — ${sum}`), ...state.audit],
  }
}
function applyRequestDecide(state: State, a: Extract<Action, { type: 'reqDecide' }>): State {
  const r = state.adminRequests.find((x) => x.id === a.id)!
  const me = actor(state)
  const at = nowIso()
  const stage = r.status === 'pending_office' ? 'office' : 'ceo'
  const note = a.note?.trim() || undefined
  const prevMinutes = r.overtime ? [...r.steps].reverse().find((s) => s.stage === 'office' && s.minutes != null)?.minutes ?? r.overtime.minutes : undefined
  const minutes = r.kind === 'overtime' && a.decision === 'approve' ? a.minutes ?? prevMinutes : undefined
  const step: RequestStep = { stage, by: me, at, decision: a.decision, note, minutes }
  const holidays = new Set(state.holidays.map((h) => h.date))
  const sum = requestSummary(r, holidays)
  const label = `${KIND_FA[r.kind]} #${r.no}`
  let next: AdminRequest = { ...r, steps: [...r.steps, step], stageSince: at }
  let leaves = state.leaves
  let n: Notification[]
  if (a.decision === 'reject') {
    next.status = 'rejected'
    n = notify(state, [r.userId], { kind: 'request', title: `Your request ${label} has been rejected`, body: `${stage === 'office' ? "Administrative Director" : "CEOs"}: ${note}`, link: { type: 'page', page: 'requests' } })
  } else if (stage === 'office') {
    next.status = 'pending_ceo'
    n = [
      ...notify(state, [r.userId], { kind: 'request', title: `Request ${label} You received approval from the administrative director`, body: "For the final decision in Carable is the CEO.", link: { type: 'page', page: 'requests' } }),
      ...notify(state, roleIds(state, 'ceo').filter((id) => id !== r.userId), { kind: 'request', title: `Request ${KIND_FA[r.kind]} from ${nameOf(state, r.userId)}`, body: `${sum} — approval of the administrative director`, link: { type: 'page', page: 'inbox' } }),
    ]
  } else {
    next.status = 'approved'
    if (next.overtime) next.overtime = { ...next.overtime, approvedMinutes: minutes }
    if (r.kind === 'leave') { const rows = leaveRowsOf(state, next); next.leaveIds = rows.map((x) => x.id); leaves = [...leaves, ...rows] }
    const part = r.kind === 'overtime' && minutes != null && minutes < r.overtime!.minutes ? ` (${hm(minutes)} of ${hm(r.overtime!.minutes)})` : ''
    n = notify(state, [r.userId], { kind: 'request', title: `Your ${label} request was approved${part}`, body: sum, link: { type: 'page', page: 'requests' } })
  }
  const what = a.decision === 'approve' ? `Approve ${stage === 'office' ? "Administrative Director" : "Final Director"}${minutes != null ? ` (${hm(minutes)})` : ''}` : `Red ${stage === 'office' ? "Administrative Director" : "CEOs"}`
  return {
    ...state, adminRequests: state.adminRequests.map((x) => (x.id === r.id ? next : x)), leaves, notifications: [...n, ...state.notifications],
    audit: [auditOf(state, 'request', `${what} Request ${label} ${nameOf(state, r.userId)} — ${sum} ${note ? ` — ${note}` : ''}`), ...state.audit],
  }
}
/** Recalculate open-month timesheet days after any change that can move them; a day that newly shows undecided overtime prompts its owner */
const TIMESHEET_TRIGGERS = new Set(['tsSave', 'tsPunch', 'tsUnpaid', 'reqCreate', 'reqDecide', 'reqWithdraw', 'reqCancel', 'addLeave', 'removeLeave', 'addHoliday', 'removeHoliday', 'tsConfig', 'monthClose'])
function settleTimesheets(state: State): State {
  const r = settleDays({ days: state.timesheets, requests: state.adminRequests, leaves: state.leaves, holidays: state.holidays.map((h) => h.date), configs: state.timesheetConfigs, closes: state.monthCloses })
  if (!r.changed.length) return state
  const n: Notification[] = r.changed.filter((c) => c.prev.calc.undecided === 0 && c.next.calc.undecided > 0).map((c) => ({
    id: `n-${idBase}${seq++}`, userId: c.next.userId, at: nowIso(), read: false, kind: 'timesheet' as const,
    title: `Overwork ${hm(c.next.calc.undecided)} at ${jalaliFa(c.next.date)}`,
    body: "The net work of this day increased from the duty hour. Register an overtime request or leave it without payment.",
    link: { type: 'page', page: 'timesheet' },
  }))
  return { ...state, timesheets: r.days, notifications: n.length ? [...n, ...state.notifications] : state.notifications }
}


// ---------- personal tasks (owner only; checked in lib/policy.ts) ----------
type PersonalAction = Extract<Action, { type: 'ptCreate' | 'ptUpdate' | 'ptDelete' | 'ptMove' | 'psSave' }>
function applyPersonal(state: State, a: PersonalAction): State {
  const me = actor(state)
  const at = nowIso()
  const board = boardOf(state.personalBoards, me)
  const doneIds = (b: PersonalBoard) => new Set(b.statuses.filter((x) => x.done).map((x) => x.id))
  const boards = state.personalBoards[me] ? state.personalBoards : { ...state.personalBoards, [me]: board }
  const all = state.personalTasks
  switch (a.type) {
    case 'ptCreate': {
      const f = a.task
      const statusId = f.statusId ?? board.defaultStatusId
      const t: PersonalTask = {
        id: `pt-${idBase}${seq++}`, ownerId: me, parentId: f.parentId ?? null, title: f.title.trim(), description: f.description?.trim() || undefined,
        statusId, priority: f.priority ?? 'normal', start: f.start || undefined, due: f.due || undefined,
        order: nextOrder(Object.values(all), me, f.parentId ?? null), createdAt: at, updatedAt: at, completedAt: doneIds(board).has(statusId) ? at : undefined,
      }
      return { ...state, personalBoards: boards, personalTasks: { ...all, [t.id]: t } }
    }
    case 'ptUpdate': {
      const t = all[a.id]
      const p = { ...a.patch }
      if (p.title !== undefined) p.title = p.title.trim()
      if (p.description !== undefined) p.description = p.description.trim() || undefined
      if (p.start === '') p.start = undefined
      if (p.due === '') p.due = undefined
      const next: PersonalTask = { ...t, ...p, updatedAt: at }
      if (p.statusId !== undefined && p.statusId !== t.statusId) {
        const done = doneIds(board).has(p.statusId), was = doneIds(board).has(t.statusId)
        if (done && !was) next.completedAt = at
        if (!done) next.completedAt = undefined
      }
      return { ...state, personalBoards: boards, personalTasks: { ...all, [t.id]: next } }
    }
    case 'ptDelete': {
      const gone = new Set([a.id, ...descendants(tasksOf(all, me), a.id).map((x) => x.id)])
      return { ...state, personalTasks: Object.fromEntries(Object.entries(all).filter(([id]) => !gone.has(id))) }
    }
    case 'ptMove': {
      const t = all[a.id]
      const siblings = tasksOf(all, me).filter((x) => x.parentId === a.parentId && x.id !== t.id).sort((x, y) => x.order - y.order)
      siblings.splice(Math.min(a.index, siblings.length), 0, { ...t, parentId: a.parentId })
      const next = { ...all }
      siblings.forEach((x, i) => { next[x.id] = { ...next[x.id], parentId: a.parentId, order: i + 1, ...(x.id === t.id ? { updatedAt: at } : {}) } })
      return { ...state, personalTasks: next }
    }
    case 'psSave': {
      const nb: PersonalBoard = { userId: me, statuses: a.statuses.map((x) => ({ id: x.id, name: x.name.trim(), color: x.color, done: !!x.done })), defaultStatusId: a.defaultStatusId }
      const keep = new Set(nb.statuses.map((x) => x.id))
      const done = doneIds(nb)
      const next = { ...all }
      for (const t of tasksOf(all, me)) {
        const statusId = keep.has(t.statusId) ? t.statusId : a.remap?.[t.statusId] ?? nb.defaultStatusId
        const isDoneNow = done.has(statusId)
        if (statusId !== t.statusId || isDoneNow !== !!t.completedAt) next[t.id] = { ...t, statusId, completedAt: isDoneNow ? t.completedAt ?? at : undefined, updatedAt: at }
      }
      return { ...state, personalBoards: { ...state.personalBoards, [me]: nb }, personalTasks: next }
    }
  }
}

function apply(state: State, a: Exclude<Action, WorkspaceAction | OfficeAction>): State {
  switch (a.type) {
    case 'login': return { ...state, session: a.id, nav: state.nav.page ? state.nav : { page: 'home' } }
    case 'logout': return { ...state, session: null, openTaskId: null, profileUserId: null, nav: { page: 'home' } }
    case 'register': {
      const n = notify({ ...state, session: null }, controlIds(state), { kind: 'account', title: `Membership request: ${a.user.name} (${a.user.username})`, body: 'Assign a team and role to approve the account.', link: { type: 'page', page: 'admin' } })
      return { ...state, users: [...state.users, a.user], notifications: [...n, ...state.notifications] }
    }
    case 'approveUser': {
      const u = state.users.find((x) => x.id === a.id)!
      const users = state.users.map((x) => x.id === a.id ? resolveRole(state.roleDefinitions, { ...x, status: 'active', teamId: a.teamId, role: a.role, customRoleId: undefined }) : x)
      const next = { ...state, users }
      const n: Notification = { id: `n-${idBase}${seq++}`, userId: u.id, at: nowIso(), read: false, kind: 'account', actorId: state.session ?? undefined, title: 'Your account was approved', body: `Team member ${state.teams.find((t) => t.id === a.teamId)?.name} Extreme. Welcome.`, link: { type: 'page', page: 'home' } }
      return { ...next, notifications: [n, ...state.notifications], messages: [...state.messages, sysMsg('general', `${u.name} (@${u.username}) joined the workspace.`)], audit: [auditOf(state, 'admin', `Account ${u.username} Confirmed`), ...state.audit] }
    }
    case 'rejectUser': return { ...state, users: state.users.map((x) => (x.id === a.id ? { ...x, status: 'rejected' as const } : x)), audit: [auditOf(state, 'admin', `Request for membership ${state.users.find((x) => x.id === a.id)?.username} has been rejected`), ...state.audit] }
    case 'roleSave': case 'roleDelete': case 'roleAssign': {
      const next = applyRoleAction(state, a)
      const id = a.type === 'roleSave' ? a.role.id : a.type === 'roleDelete' ? a.id : a.roleId
      return { ...next, audit: [auditOf(state, 'admin', `Role management: ${a.type} · ${id}${a.type === 'roleAssign' ? ` · ${a.userId}` : ''}`), ...state.audit] }
    }
    case 'whiteboardSave': case 'whiteboardDelete': return applyWhiteboard(state, a)
    case 'addUser': return { ...state, users: [...state.users, resolveRole(state.roleDefinitions, a.user)], audit: [auditOf(state, 'admin', `User ${a.user.username} Defined`), ...state.audit] }
    case 'updateUser': {
      const before = state.users.find((x) => x.id === a.id)
      const changes = before ? (['role', 'teamId', 'status'] as const).filter((k) => k in a.patch && a.patch[k] !== before[k]) : []
      const audit = changes.length && before ? [auditOf(state, 'admin', `Account ${before.username}: ${changes.map((k) => `${k} «${String(before[k])}» ← «${String(a.patch[k])}»`).join('، ')}`), ...state.audit] : state.audit
      return { ...state, users: state.users.map((x) => (x.id === a.id ? resolveRole(state.roleDefinitions, { ...x, ...a.patch, customRoleId: a.patch.role && a.patch.role !== x.role ? undefined : x.customRoleId }) : x)), audit }
    }
    case 'openProfile': return { ...state, profileUserId: a.id, profileTab: a.tab ?? 'profile' }
    case 'setTheme': return { ...state, theme: a.theme }
    case 'nav': return { ...state, nav: a.nav, ...(a.fromHistory ? { openTaskId: null, profileUserId: null } : {}) }
    case 'openTask': return { ...state, openTaskId: a.id }
    case 'setStatus': {
      const t = state.tasks[a.taskId]
      const set = statusesFor(state, t)
      const from = set.find((s) => s.id === t.statusId)
      const to = set.find((s) => s.id === a.statusId)
      if (!to || from?.id === to.id) return state
      const nt: Task = { ...t, statusId: to.id }
      const extra: AuditEntry[] = []
      // Actual Start = first move into work; Actual Finish = reaching a done status (cleared if the task is reopened)
      if (to.category === 'doing' && !t.actualStart) { nt.actualStart = TODAY; extra.push(auditOf(state, 'actual', `Indeed Start was registered: ${jalaliFa(TODAY)}`, t.id)) }
      if (to.category === 'done') { nt.actualFinish = t.actualFinish??TODAY; nt.flow = undefined; extra.push(auditOf(state, 'actual', `Truly Final was registered: ${jalaliFa(nt.actualFinish)}`, t.id)) }
      else if (from?.category === 'done' && t.actualFinish) { nt.actualFinish = undefined; extra.push(auditOf(state, 'actual', "The task was reopened and the actual finish date was cleared.", t.id)) }
      const tasks = { ...state.tasks, [t.id]: nt }
      let writeQueue = state.writeQueue
      if (t.source === 'mdr' && t.docNumber && !t.removedFromMdr) {
        writeQueue = [...state.writeQueue.filter((w) => w.taskId !== t.id), { taskId: t.id, statusName: to.name, progress: to.progress, date: TODAY, queuedAt: Date.now() }]
      }
      const recips = [...recipientsOfTask(state, t), ...(to.category === 'done' ? controlIds(state) : [])]
      const n = notify(state, recips, { kind: 'status', title: `Status «${t.name}»: ${to.name}`, body: `${from?.name ?? '—'} → ${to.name}, by ${nameOf(state, state.session)}`, link: { type: 'task', id: t.id } })
      const msgs = to.category === 'done' ? [sysMsg(`project:${t.projectId}`, `“${t.name}” ${t.docNumber ? `#${t.docNumber} ` : ''} reached “${to.name}”.`, { type: 'task', id: t.id })] : []
      return { ...state, tasks, writeQueue, notifications: [...n, ...state.notifications], messages: [...state.messages, ...msgs], audit: [...extra, auditOf(state, 'status', `Status: «${from?.name ?? '—'}» ← «${to.name}»`, t.id), ...state.audit] }
    }
    case 'savePlan': {
      const t = state.tasks[a.taskId]
      const assigneeUserId = a.assignee?.kind === 'user' ? a.assignee.id : undefined
      const assigneeTeamId = a.assignee?.kind === 'team' ? a.assignee.id : undefined
      // baselineDue keeps the first Due Date ever planned; later changes never overwrite it
      const nt: Task = { ...t, assigneeUserId, assigneeTeamId, estimation: a.estimation, start: a.start, due: a.due, baselineDue: t.baselineDue ?? a.due, baselineEstimation: t.baselineEstimation ?? a.estimation }
      const who = assigneeUserId ? nameOf(state, assigneeUserId) : assigneeTeamId ? `Team ${state.teams.find((x) => x.id === assigneeTeamId)?.name}` : 'Unassigned'
      const entries: AuditEntry[] = []
      let n: Notification[] = []
      const changedAssignee = t.assigneeUserId !== assigneeUserId || t.assigneeTeamId !== assigneeTeamId
      if (changedAssignee || t.estimation !== a.estimation) entries.push(auditOf(state, 'allocation', `Assigned to: ${who}${a.estimation ? `Estimation ${a.estimation} Person-hour` : ''}`, t.id))
      if (t.start !== a.start || t.due !== a.due) entries.push(auditOf(state, 'dates', "Start/Due has changed", t.id))
      if (changedAssignee && a.assignee) n = notify(state, recipientsOfTask(state, nt), { kind: 'assign', title: `Task “${t.name}” was assigned to ${assigneeTeamId ? "Your team" : "You"}`, body: [t.docNumber, a.estimation ? `${a.estimation} person-hours` : ''].filter(Boolean).join('، '), link: { type: 'task', id: t.id } })
      else if (!changedAssignee && (t.start !== a.start || t.due !== a.due)) n = notify(state, recipientsOfTask(state, nt), { kind: 'plan', title: `Schedule updated for “${t.name}”`, body: 'The start or due date was updated.', link: { type: 'task', id: t.id } })
      return { ...state, tasks: { ...state.tasks, [t.id]: nt }, allocations: [...state.allocations.filter((x) => x.taskId !== t.id), ...a.allocations], notifications: [...n, ...state.notifications], audit: [...entries, ...state.audit] }
    }
    case 'addTask':
      return { ...state, tasks: { ...state.tasks, [a.task.id]: { ...a.task,source:'manual', createdBy: actor(state),reporterId:actor(state), createdAt: nowIso(), ...(isWorkItem(a.task)?{statusId:a.task.statusId??statusesFor(state,a.task)[0]?.id}:{}) } }, messages: [...state.messages, sysMsg(`project:${a.task.projectId}`, `${nameOf(state, state.session)} Hand-made Task " ${a.task.name} "`, { type: 'task', id: a.task.id })], audit: [auditOf(state, 'admin', `Manual task “${a.task.name}” created`, a.task.id), ...state.audit] }
    case 'addComment': {
      const t = state.tasks[a.taskId]
      // only people who can open the task are notified, so a mention never carries its text to anyone outside it
      const mentions = parseMentions(a.text, state.users).filter((id) => canViewTask(state, state.users.find((u) => u.id === id), t))
      const c: Comment = { id: `c-${idBase}${seq++}`, taskId: a.taskId, userId: actor(state), at: nowIso(), text: a.text, mentions }
      const n = [
        ...notify(state, mentions, { kind: 'mention', title: `${nameOf(state, state.session)} mentioned you in a comment on “${t.name}”`, body: a.text, link: { type: 'task', id: t.id } }),
        ...notify(state, recipientsOfTask(state, t).filter((x) => !mentions.includes(x)), { kind: 'comment', title: `New comment on «${t.name}»`, body: a.text, link: { type: 'task', id: t.id } }),
      ]
      return { ...state, comments: [...state.comments, c], notifications: [...n, ...state.notifications] }
    }
    case 'sendMessage': {
      const members = channelMembers(state, a.channelId)
      const mentions = parseMentions(a.text, state.users).filter((id) => members.includes(id))
      const m: ChatMessage = { id: `m-${idBase}${seq++}`, channelId: a.channelId, userId: actor(state), at: nowIso(), text: a.text, mentions }
      const where = a.channelId === 'general' ? "Public Chat" : a.channelId === 'announce' ? "News" : `Chat ${state.projects.find((p) => `project:${p.id}` === a.channelId)?.name}`
      let n = notify(state, mentions, { kind: 'mention', title: `${nameOf(state, state.session)} He tagged you in ${where}`, body: a.text, link: { type: 'chat', channelId: a.channelId } })
      if (a.channelId === 'announce') n = [...n, ...notify(state, members.filter((x) => !mentions.includes(x)), { kind: 'announce', title: `New announcement from ${nameOf(state, state.session)}`, body: a.text, link: { type: 'chat', channelId: 'announce' } })]
      const lastRead = { ...state.lastRead, [`${actor(state)}|${a.channelId}`]: m.at }
      return { ...state, messages: [...state.messages, m], notifications: [...n, ...state.notifications], lastRead }
    }
    case 'readNotifs': {
      const ids = a.ids ? new Set(a.ids) : null
      return { ...state, notifications: state.notifications.map((n) => (n.userId === state.session && (!ids || ids.has(n.id)) && !n.read ? { ...n, read: true } : n)) }
    }
    case 'readChannel': {
      const key = `${actor(state)}|${a.channelId}`
      const last = state.messages.filter((m) => m.channelId === a.channelId).reduce((x, m) => (m.at > x ? m.at : x), '')
      if (!last || state.lastRead[key] >= last) return state
      return { ...state, lastRead: { ...state.lastRead, [key]: last } }
    }
    case 'review': {
      const ids = new Set(a.ids)
      if (a.approve) {
        let grew = true
        while (grew) {
          grew = false
          for (const it of state.syncItems) {
            // a new row needs its new parent; a row moved under a new parent needs that parent too
            const pid = it.task?.parentId ?? it.changes?.find((c) => c.field === 'parent')?.toParentId
            if (!ids.has(it.id) || !pid) continue
            const parentItem = state.syncItems.find((x) => x.kind === 'new' && x.task?.id === pid && x.state === 'pending')
            if (parentItem && !ids.has(parentItem.id)) { ids.add(parentItem.id); grew = true }
          }
        }
      } else {
        let grew = true
        while (grew) {
          grew = false
          for (const it of state.syncItems) {
            if (ids.has(it.id) || it.state !== 'pending' || !it.task?.parentId) continue
            const parentItem = state.syncItems.find((x) => x.task?.id === it.task!.parentId)
            if (parentItem && ids.has(parentItem.id)) { ids.add(it.id); grew = true }
          }
        }
      }
      const tasks = { ...state.tasks }
      let created = 0, changed = 0, removed = 0
      const projectsTouched = new Set<string>()
      const items = state.syncItems.map((it) => {
        if (!ids.has(it.id) || it.state !== 'pending') return it
        projectsTouched.add(it.projectId)
        if (a.approve) {
          if (it.kind === 'new' && it.task) {
            const prev = tasks[it.task.id]
            if (!prev) { tasks[it.task.id] = { ...it.task }; created++ }
            else if (prev.removedFromMdr) {
              // the row is back in the MDR: the same task returns with its history, plan and status
              const m = it.task
              tasks[prev.id] = { ...prev, name: prev.mdrSourceName!==undefined?prev.name:m.name, ...(prev.mdrSourceName!==undefined?{mdrSourceName:m.name}:{}), parentId: m.parentId, weight: m.weight, weightDerived: m.weightDerived, floor: m.floor, pkg: m.pkg, docNumber: m.docNumber, mdrRow: m.mdrRow, mdrKey: m.mdrKey, planIssue: m.planIssue ?? prev.planIssue, order: m.order, removedFromMdr: false }
              created++
            }
          } else if (it.kind === 'changed' && it.taskId && tasks[it.taskId]) {
            const t = { ...tasks[it.taskId] }
            for (const c of it.changes ?? []) {
              if (c.field === 'name') {if(t.mdrSourceName!==undefined)t.mdrSourceName=c.to;else t.name=c.to}
              if (c.field === 'weight') { t.weight = c.to === '' ? null : Number(c.to); t.weightDerived = !!c.derived }
              if (c.field === 'floor') t.floor = c.to
              if (c.field === 'package') t.pkg = c.to
              if (c.field === 'parent' && c.toParentId) t.parentId = c.toParentId
            }
            tasks[t.id] = t; changed++
          } else if (it.kind === 'removed' && it.taskId && tasks[it.taskId]) {
            tasks[it.taskId] = { ...tasks[it.taskId], removedFromMdr: true }; removed++
          }
        }
        return { ...it, state: a.approve ? 'approved' as const : 'rejected' as const }
      })
      const text = a.approve
        ? `Sync Review Verification: ${created} New Task, ${changed} Change, ${removed} Mark "Removed from MDR"`
        : `Rejected ${ids.size} rows in Sync Review`
      const n = a.approve ? notify(state, controlIds(state), { kind: 'sync', title: `${nameOf(state, state.session)} approved the MDR rows`, body: `${created} New Task in Unassigned Pool, ${changed} Change, ${removed} Remove`, link: { type: 'page', page: 'review' } }) : []
      const msgs = a.approve ? [...projectsTouched].map((pid) => sysMsg(`project:${pid}`, `Sync Review was confirmed: ${created} The new Task was made of MDR and ${changed} the change was applied.`, { type: 'project', id: pid })) : []
      return { ...state, tasks, syncItems: items, notifications: [...n, ...state.notifications], messages: [...state.messages, ...msgs], audit: [auditOf(state, 'sync', text), ...state.audit] }
    }
    case 'addRun': return { ...state, syncRuns: [a.run, ...state.syncRuns] }
    case 'updateRun': return { ...state, syncRuns: state.syncRuns.map((r) => (r.id === a.id ? { ...r, ...a.patch } : r)) }
    case 'flushWriteBack': {
      if (!state.writeQueue.length) return state
      const byProject: Record<string, WriteBackItem[]> = {}
      for (const w of state.writeQueue) (byProject[state.tasks[w.taskId].projectId] ??= []).push(w)
      const runs: SyncRun[] = Object.entries(byProject).map(([pid, list], i) => ({
        id: `run-wb-${Date.now()}-${i}`, projectId: pid, trigger: 'writeback', at: nowIso(), durationSec: 2 + list.length,
        state: 'success', rowsRead: list.length, diffs: { new: 0, changed: 0, removed: 0 }, cellsWritten: list.length * 3,
        log: [
          { level: 'info', text: `${list.length} Document: The target line was reread before writing with Document Number.` },
          ...list.map((w) => {
            const t = state.tasks[w.taskId]
            return { level: 'info' as const, text: `${t.docNumber} ← Row ${t.mdrRow}: Last Status « ${w.statusName} », Progress ${w.progress}%, Last Status Date ${w.date}` }
          }),
          { level: 'info', text: `batchupdate: only 3 internal columns — ${list.length * 3} cells. No other cells changed.` },
        ],
      }))
      const msgs = Object.entries(byProject).map(([pid, list]) => sysMsg(`project:${pid}`, `Writing-back to MDR: Status ${list.length} The document was written in internal columns.`, { type: 'page', page: 'runs' }))
      const n = notify({ ...state, session: null }, controlIds(state), { kind: 'sync', title: 'MDR write-back completed', body: `${state.writeQueue.length} documents, ${state.writeQueue.length * 3} cells`, link: { type: 'page', page: 'runs' } })
      return { ...state, writeQueue: [], syncRuns: [...runs, ...state.syncRuns], messages: [...state.messages, ...msgs], notifications: [...n, ...state.notifications] }
    }
    case 'sysRunStart': return { ...state, syncRuns: [a.run, ...state.syncRuns] }
    case 'sysSyncResult': {
      const p = state.projects.find((x) => x.id === a.projectId)
      const syncRuns = state.syncRuns.map((r) => (r.id === a.runId ? { ...r, ...a.run } : r))
      if (!p) return { ...state, syncRuns }
      const tasks = { ...state.tasks }
      let moved = 0
      for (const f of a.refresh) {
        const t = tasks[f.taskId]
        if (!t || t.projectId !== p.id) continue
        const next = { ...t, mdrRow: f.mdrRow, order: f.mdrRow, planIssue: f.planIssue ?? t.planIssue, mdrSubtasks: f.mdrSubtasks?.length ? f.mdrSubtasks : t.mdrSubtasks }
        if (next.mdrRow !== t.mdrRow || next.order !== t.order || next.planIssue !== t.planIssue || JSON.stringify(next.mdrSubtasks) !== JSON.stringify(t.mdrSubtasks)) { tasks[t.id] = next; moved++ }
      }
      const syncItems = a.replacePending ? [...state.syncItems.filter((x) => !(x.projectId === p.id && x.state === 'pending')), ...a.items] : state.syncItems
      const d = { new: a.items.filter((x) => x.kind === 'new').length, changed: a.items.filter((x) => x.kind === 'changed').length, removed: a.items.filter((x) => x.kind === 'removed').length }
      const ok = a.run.state === 'success' || a.run.state === 'partial'
      const text = ok
        ? `Sync ${p.code}: ${a.run.rowsRead ?? 0} The MDR line was read; ${d.new} New, ${d.changed} Change, ${d.removed} Delete in the Sync Review queue ${moved ? `${moved} Task Row or Plan Issue New` : ''}`
        : `Sync ${p.code} was unsuccessful: ${a.run.log?.find((l) => l.level === 'error')?.text ?? ''}`
      const items = a.items.length
      const n = !ok || items ? notify({ ...state, session: null }, controlIds(state), {
        kind: 'sync', title: ok ? `${items} MDR Row ${p.name} in Sync Review queue` : `Sync ${p.name} failed`,
        body: ok ? `${d.new} New, ${d.changed} Change, ${d.removed} Remove from MDR` : a.run.log?.find((l) => l.level === 'error')?.text, link: { type: 'page', page: ok ? 'review' : 'runs' },
      }) : []
      const msgs = ok && items ? [sysMsg(`project:${p.id}`, `Sync was prepared with MDR: ${d.new} new row, ${d.changed} change and ${d.removed} delete to check project control.`, { type: 'page', page: 'review' })] : []
      return {
        ...state, tasks, syncRuns, syncItems, projects: ok ? state.projects.map((x) => (x.id === p.id ? { ...x, lastSync: a.at } : x)) : state.projects,
        notifications: [...n, ...state.notifications], messages: [...state.messages, ...msgs], audit: [{ ...auditOf(state, 'sync', text), userId: a.by ?? 'system' }, ...state.audit],
      }
    }
    case 'sysWriteBack': {
      const done = new Set(a.settled.map((x) => `${x.taskId}@${x.queuedAt}`))
      const writeQueue = state.writeQueue.filter((w) => !done.has(`${w.taskId}@${w.queuedAt}`))
      const tasks = { ...state.tasks }
      for (const r of a.rows) if (tasks[r.taskId] && tasks[r.taskId].mdrRow !== r.mdrRow) tasks[r.taskId] = { ...tasks[r.taskId], mdrRow: r.mdrRow }
      const msgs = a.runs.filter((r) => r.state !== 'failed' && r.cellsWritten && r.projectId !== 'all').map((r) => sysMsg(`project:${r.projectId}`, `Writing-back to MDR: Status ${r.cellsWritten / 3} The document was written in internal columns.`, { type: 'page', page: 'runs' }))
      const failed = a.runs.filter((r) => r.state === 'failed' || r.state === 'partial')
      const cells = a.runs.reduce((x, r) => x + r.cellsWritten, 0)
      const n = notify({ ...state, session: null }, controlIds(state), failed.length
        ? { kind: 'sync', title: 'MDR write-back was incomplete', body: failed.flatMap((r) => r.log.filter((l) => l.level !== 'info').map((l) => l.text)).slice(0, 2).join(' — '), link: { type: 'page', page: 'runs' } }
        : { kind: 'sync', title: 'MDR write-back completed', body: `${cells / 3} documents, ${cells} cells`, link: { type: 'page', page: 'runs' } })
      return { ...state, tasks, writeQueue, syncRuns: [...a.runs, ...state.syncRuns], messages: [...state.messages, ...msgs], notifications: [...n, ...state.notifications] }
    }
    case 'addHoliday': return { ...state, holidays: [...state.holidays, a.holiday].sort((x, y) => x.date.localeCompare(y.date)), audit: [auditOf(state, 'admin', `Holiday “${a.holiday.title}” added`), ...state.audit] }
    case 'removeHoliday': return { ...state, holidays: state.holidays.filter((h) => h.id !== a.id) }
    case 'addLeave': {
      // direct entry by the Administrative Manager (exceptions); the reason stays on the row and in the AuditLog
      const leave: Leave = { ...a.leave, note: a.leave.note?.trim(), by: actor(state), at: nowIso() }
      const n = notify(state, [leave.userId], { kind: 'request', title: 'Your leave was recorded', body: `${leave.hours >= 8 ? "Full Day" : `${leave.hours} Hours`}، ${jalaliFa(leave.date)}`, link: { type: 'page', page: 'timesheet' } })
      return { ...state, leaves: [...state.leaves, leave], notifications: [...n, ...state.notifications], audit: [auditOf(state, 'request', `Direct Registration ${nameOf(state, leave.userId)}: ${leave.hours} Hour at ${jalaliFa(leave.date)} — ${leave.note}`), ...state.audit] }
    }
    case 'removeLeave': {
      const l = state.leaves.find((x) => x.id === a.id)!
      return { ...state, leaves: state.leaves.filter((x) => x.id !== a.id), audit: [auditOf(state, 'request', `Leave ${nameOf(state, l.userId)} was removed at ${jalaliFa(l.date)}`), ...state.audit] }
    }
    case 'statusAdd': return { ...state, statusSets: { ...state.statusSets, [a.scope]: [...state.statusSets[a.scope], a.status] } }
    case 'statusUpdate': return { ...state, statusSets: { ...state.statusSets, [a.scope]: state.statusSets[a.scope].map((s) => (s.id === a.id ? { ...s, ...a.patch } : s)) } }
    case 'statusDelete': {
      const tasks = { ...state.tasks }
      if (a.moveTo) for (const t of Object.values(tasks)) if (isWorkItem(t) && t.statusId === a.id && effectiveScope(state, t) === a.scope) tasks[t.id] = { ...t, statusId: a.moveTo }
      return { ...state, tasks, statusSets: { ...state.statusSets, [a.scope]: state.statusSets[a.scope].filter((s) => s.id !== a.id) } }
    }
    case 'statusOverride': {
      const parent = parentScopeOf(state, a.scope) ?? 'office'
      return { ...state, statusSets: { ...state.statusSets, [a.scope]: state.statusSets[parent].map((s) => ({ ...s })) } }
    }
    case 'statusInherit': {
      const sets = { ...state.statusSets }
      delete sets[a.scope]
      const next = { ...state, statusSets: sets }
      const tasks = { ...state.tasks }
      for (const t of Object.values(tasks)) {
        if (!isWorkItem(t)) continue
        const set = statusesFor(next, t)
        if (!set.find((s) => s.id === t.statusId)) {
          const old = state.statusSets[effectiveScope(state, t)]?.find((s) => s.id === t.statusId)
          const target = set.find((s) => s.category === old?.category) ?? set[0]
          tasks[t.id] = { ...t, statusId: target.id }
        }
      }
      return { ...next, tasks }
    }
    case 'classifyTasks': {
      const ids = new Set(a.ids)
      const tasks = Object.fromEntries(Object.entries(state.tasks).map(([id, t]) => [id, ids.has(id) ? { ...t, projectStage: a.projectStage, ...(a.workScope ? { workScope: a.workScope } : {}) } : t]))
      return { ...state, tasks, audit: [auditOf(state, 'admin', "Classified " + ids.size + " Stiffness in stage " + a.projectStage), ...state.audit] }
    }
    case 'teamAdd': return { ...state, teams: [...state.teams, { ...a.team, name: a.team.name.trim() }], audit: [auditOf(state, 'admin', "Team Definition: " + a.team.name.trim()), ...state.audit] }
    case 'teamUpdate': return { ...state, teams: state.teams.map((t) => t.id === a.id ? { ...t, name: a.patch.name.trim(), kind: a.patch.kind, icon: a.patch.icon ?? t.icon } : t), audit: [auditOf(state, 'admin', "Team Edit: " + a.id), ...state.audit] }
    case 'teamArchive': return { ...state, teams: state.teams.map((t) => t.id === a.id ? { ...t, archived: a.archived } : t), audit: [auditOf(state, 'admin', "Team Status " + a.id + ': ' + (a.archived ? "Category: Archives" : "Actively")), ...state.audit] }
    case 'teamMember': return { ...state, users: state.users.map((u) => u.id === a.userId ? { ...u, teamId: a.teamId } : u), audit: [auditOf(state, 'admin', "Change of organizational membership " + a.userId + " from " + (state.users.find((u) => u.id === a.userId)?.teamId || "No team") + " the New York Times " + (a.teamId || "No team")), ...state.audit] }
    case 'projectAdd': return { ...state, tasks: ensureProjectPhases(state.tasks, a.project), projects: [...state.projects, { ...a.project, sdTeamId: a.project.sdTeamId ?? a.project.phase1TeamId, staffing: { ...emptyStaffing(), ...a.project.staffing } }], audit: [auditOf(state, 'admin', `Project ${a.project.code} is defined`), ...state.audit] }
    case 'projectUpdate': return { ...state, projects: state.projects.map((p) => (p.id === a.id ? { ...p, ...a.patch } : p)) }
    case 'projectCategory': {
      const replacement=a.op==='remove'?(a.replacement||'Other'):a.replacement
      const names=projectCategories(state).filter(n=>a.op==='create'||n!==a.name)
      if(a.op==='create')names.push(a.name)
      if(a.op==='rename')names.push(replacement!)
      return {...state,projectCategories:{office:{names:[...new Set(names)]}},projects:a.op==='create'?state.projects:state.projects.map(p=>categoryOfProject(p)===a.name?{...p,type:replacement!}:p),audit:[auditOf(state,'admin',`Project category ${a.op}: ${a.name}`),...state.audit]}
    }
    case 'projectLifecycle': return {...state,projects:state.projects.map(p=>p.id!==a.id?p:a.op==='archive'?{...p,archivedAt:nowIso()}:a.op==='unarchive'?{...p,archivedAt:undefined}:a.op==='delete'?{...p,deletedAt:nowIso()}: {...p,deletedAt:undefined}),audit:[auditOf(state,'admin',`Project ${a.op}: ${a.id}`),...state.audit]}

    // ---------- Phase 1: supervision, team spaces, review, attachments, actual dates ----------
    case 'createFlowTask': {
      const me = actor(state)
      const t0 = a.task
      const sup = t0.kind === 'supervision'
      const task: Task = {
        ...t0, source: 'manual', createdBy: me, createdAt: nowIso(), creatorTeamId: state.users.find(u=>u.id===me)?.teamId,
        reporterId: t0.reporterId ?? me,
        reviewerId: sup ? (t0.reviewerId ?? me) : t0.reviewerId,
        flow: t0.assigneeUserId || t0.assigneeTeamId ? 'assigned' : 'open',
        baselineDue: t0.due, baselineEstimation: t0.estimation, priority: t0.priority ?? 'normal', type: t0.type ?? (sup ? 'supervision' : isFinTask(t0) ? 'admin' : 'other'),
      }
      const files = (a.files ?? []).map((f) => mkAttachment(state, task.id, f))
      const label = flowLabel(task)
      const n = [
        ...notify(state, [task.assigneeUserId], { kind: 'assign', title: `${label} «${task.name}» was assigned to you`, body: [task.location, task.due ? `Due: ${jalaliFa(task.due)}` : ''].filter(Boolean).join('، ') || undefined, link: { type: 'task', id: task.id } }),
        // CEO-centred coordination: the CEO hears of every new task of the space
        ...(isFinTask(task) ? notify(state, ceoIds(state).filter((id) => id !== task.assigneeUserId), { kind: 'plan', title: `New task in ${FIN_SPACE_FA[finSpaceOf(task) ?? 'finance']}: “${task.name}”`, body: task.assigneeUserId ? `Responsible: ${nameOf(state, task.assigneeUserId)}` : "Unassigned", link: { type: 'task', id: task.id } }) : []),
      ]
      const msgs = sup ? [sysMsg(`project:${task.projectId}`, `${nameOf(state, me)} The monitor recorded the " ${task.name} " ${task.assigneeUserId ? ` and referred to ${nameOf(state, task.assigneeUserId)}` : ''}.`, { type: 'task', id: task.id })] : []
      return {
        ...state, tasks: { ...state.tasks, [task.id]: task }, attachments: [...state.attachments, ...files],
        notifications: [...n, ...state.notifications], messages: [...state.messages, ...msgs],
        audit: [auditOf(state, 'task', `${label} created${task.assigneeUserId ? `Reference to ${nameOf(state, task.assigneeUserId)}` : ''}${files.length ? `${files.length} Join` : ''}`, task.id), ...state.audit],
      }
    }
    case 'finTaskArchive': {const t=state.tasks[a.taskId];return {...state,tasks:{...state.tasks,[t.id]:{...t,archivedAt:a.archived?nowIso():undefined,archivedBy:a.archived?actor(state):undefined}},audit:[auditOf(state,'admin',a.archived?'Financial/administrative task archived.':'Financial/administrative task restored.',t.id),...state.audit]}}
    case 'flow': return applyFlow(state, a)
    case 'updateTask': {
      const t = state.tasks[a.taskId]
      const keys = (Object.keys(a.patch) as (keyof Task)[]).filter((k) => JSON.stringify(a.patch[k]) !== JSON.stringify(t[k]))
      if (!keys.length) return state
      const nt: Task = { ...t, ...a.patch }
      if(t.kind==='document'&&t.source==='mdr'&&typeof a.patch.name==='string'&&a.patch.name!==t.name){const original=t.mdrSourceName??t.name;nt.mdrSourceName=a.patch.name===original?undefined:original}
      if (nt.reviewerId && nt.reviewerId === nt.assigneeUserId) nt.reviewerId = t.reviewerId
      if (nt.baselineEstimation == null && nt.estimation) nt.baselineEstimation = nt.estimation
      if (nt.baselineDue == null && nt.due) nt.baselineDue = nt.due
      const added = (nt.participantIds ?? []).filter((x) => !(t.participantIds ?? []).includes(x))
      const n = [
        ...(nt.reviewerId !== t.reviewerId ? notify(state, [nt.reviewerId], { kind: 'review', title: `You are the reviewer for “${t.name}”`, body: "After sending to check, confirm or return with you.", link: { type: 'task', id: t.id } }) : []),
        ...notify(state, added, { kind: 'assign', title: `${t.name} as an additional participant.`, link: { type: 'task', id: t.id } }),
      ]
      const text = keys.length === 1 && keys[0] === 'progressPct' ? `Progress: ${t.progressPct ?? 0}% → ${nt.progressPct ?? 0}%` : `Edit: ${keys.map((k) => FIELD_FA[k] ?? k).join('، ')}`
      return { ...state, tasks: { ...state.tasks, [t.id]: nt }, notifications: [...n, ...state.notifications], audit: [auditOf(state, keys.some((k) => k === 'due' || k === 'start') ? 'dates' : 'task', text, t.id), ...state.audit] }
    }
    case 'addAttachments': {
      const files = a.files.map((f) => mkAttachment(state, a.taskId, f))
      return { ...state, attachments: [...state.attachments, ...files], audit: [auditOf(state, 'task', `Added ${files.length} attachments: ${files.map((f) => f.name).join('، ')}`, a.taskId), ...state.audit] }
    }
    case 'setActual': {
      const t = state.tasks[a.taskId]
      const nt: Task = { ...t, actualStart: a.actualStart, actualFinish: a.actualFinish }
      const txt = `Real date manual modification: Start ${t.actualStart ? jalaliFa(t.actualStart) : '—'} → ${a.actualStart ? jalaliFa(a.actualStart) : '—'}, Finish ${t.actualFinish ? jalaliFa(t.actualFinish) : '—'} ⟐ ${a.actualFinish ? jalaliFa(a.actualFinish) : '—'}. Reason: ${a.reason}`
      return { ...state, tasks: { ...state.tasks, [t.id]: nt }, audit: [auditOf(state, 'actual', txt, t.id), ...state.audit] }
    }
    case 'internalProjectAdd': {
      const ip = { ...a.project, createdBy: actor(state), createdAt: nowIso() }
      const n = notify(state, teamMembers(state, ip.teamId), { kind: 'plan', title: `The new internal project in the team: ${ip.name}`, body: ip.description, link: { type: 'page', page: 'team' } })
      return { ...state, internalProjects: [...state.internalProjects, ip], notifications: [...n, ...state.notifications], audit: [auditOf(state, 'task', `The internal project ${ip.name} was built on the team ${state.teams.find((x) => x.id === ip.teamId)?.name}`), ...state.audit] }
    }
    case 'logWork': {
      const t = state.tasks[a.log.taskId]
      const me = actor(state)
      const u = state.users.find((x) => x.id === me)
      const log: WorkLog = {
        id: `w-${idBase}${seq++}`, taskId: t.id, userId: me, minutes: a.log.minutes, workDate: a.log.workDate, description: a.log.description.trim(),
        createdAt: nowIso(), projectId: t.projectId, teamId: u?.teamId ?? '', source: 'manual',
      }
      const audit = [auditOf(state, 'worklog', `Work Log: ${fmtMinutes(log.minutes)} on ${jalaliFa(log.workDate)} — ${log.description}`, t.id)]
      let tasks = state.tasks
      // Actual Start = the earliest of: first Work Log, first move into work
      if (!t.actualStart || log.workDate < t.actualStart) {
        tasks = { ...tasks, [t.id]: { ...t, actualStart: log.workDate } }
        audit.unshift(auditOf(state, 'actual', `Really Start from the First Work Log: ${jalaliFa(log.workDate)}`, t.id))
      }
      return { ...state, tasks, workLogs: [...state.workLogs, log], audit: [...audit, ...state.audit] }
    }
    case 'editWorkLog': {
      const log = state.workLogs.find((l) => l.id === a.id)!
      const me = actor(state)
      const next: WorkLog = {
        ...log, minutes: a.patch.minutes, workDate: a.patch.workDate, description: a.patch.description.trim(), updatedAt: nowIso(), updatedBy: me,
        revisions: [...(log.revisions ?? []), { at: nowIso(), by: me, minutes: log.minutes, workDate: log.workDate, description: log.description, reason: a.reason?.trim() || undefined }],
      }
      const n = log.userId !== me ? notify(state, [log.userId], { kind: 'worklog', title: `Your work log was edited`, body: `${fmtMinutes(log.minutes)} ← ${fmtMinutes(next.minutes)}؛ ${a.reason ?? ''}`, link: { type: 'task', id: log.taskId } }) : []
      return {
        ...state, workLogs: state.workLogs.map((l) => (l.id === a.id ? next : l)), notifications: [...n, ...state.notifications],
        audit: [auditOf(state, 'worklog', `Edit Work Log ${nameOf(state, log.userId)}: ${fmtMinutes(log.minutes)} in ${jalaliFa(log.workDate)} → ${fmtMinutes(next.minutes)} in ${jalaliFa(next.workDate)} ${a.reason ? ` — Reason: ${a.reason}` : ''}`, log.taskId), ...state.audit],
      }
    }
    case 'deleteWorkLog': {
      const log = state.workLogs.find((l) => l.id === a.id)!
      const me = actor(state)
      const n = log.userId !== me ? notify(state, [log.userId], { kind: 'worklog', title: 'Your work log was deleted', body: `${fmtMinutes(log.minutes)} on ${jalaliFa(log.workDate)} · ${a.reason ?? ''}`, link: { type: 'task', id: log.taskId } }) : []
      return {
        ...state, workLogs: state.workLogs.map((l) => (l.id === a.id ? { ...l, deletedAt: nowIso(), deletedBy: me, deleteReason: a.reason?.trim() || undefined } : l)), notifications: [...n, ...state.notifications],
        audit: [auditOf(state, 'worklog', `Deleted Work Log ${nameOf(state, log.userId)}: ${fmtMinutes(log.minutes)} in ${jalaliFa(log.workDate)} (record kept) ${a.reason ? ` — Reason: ${a.reason}` : ''}`, log.taskId), ...state.audit],
      }
    }
    case 'pointRecalc': return state
    case 'taskScoreOverride': {
      const previous=state.scoreOverrides?.[a.taskId],next={...state.scoreOverrides}
      if(a.value===null)delete next[a.taskId]
      else next[a.taskId]={value:a.value,reason:a.reason.trim(),by:actor(state),at:nowIso()}
      const formula=state.scores?.[`task:${a.taskId}`]?.calculatedScore??state.scores?.[`task:${a.taskId}`]?.score
      return {...state,scoreOverrides:next,audit:[auditOf(state,'points',`Manual task score: ${previous?.value??formula??'N/A'} → ${a.value??'Automatic'}; Reason: ${a.reason.trim()}`,a.taskId),...state.audit]}
    }
    case 'pointAdjust': case 'pointConfig': return state
    // personal tasks: private, so no AuditLog lines and no notifications
    case 'ptCreate': case 'ptUpdate': case 'ptDelete': case 'ptMove': case 'psSave': return applyPersonal(state, a)
    case 'reqCreate': return applyRequestCreate(state, a)
    case 'reqItUpdate': {
      const r = state.adminRequests.find((request) => request.id === a.id)!
      const at = nowIso()
      const step: RequestStep = { stage: 'it', by: actor(state), at, itStatus: a.status, note: a.note?.trim() || undefined }
      const next = { ...r, status: a.status, stageSince: at, steps: [...r.steps, step] }
      const notifications = notify(state, [r.userId], { kind: 'request', title: `Request IT # ${r.no}: ${STATUS_FA[a.status]}`, body: step.note, link: { type: 'page', page: 'requests', requestId: r.id } })
      return { ...state, adminRequests: state.adminRequests.map((request) => request.id === r.id ? next : request), notifications: [...notifications, ...state.notifications] }
    }
    case 'reqDecide': return applyRequestDecide(state, a)
    case 'reqWithdraw': {
      const r = state.adminRequests.find((x) => x.id === a.id)!
      const step: RequestStep = { stage: 'withdraw', by: actor(state), at: nowIso() }
      return { ...state, adminRequests: state.adminRequests.map((x) => (x.id === r.id ? { ...x, status: 'withdrawn', steps: [...x.steps, step] } : x)), audit: r.kind === 'it' ? state.audit : [auditOf(state, 'request', `Request ${KIND_FA[r.kind]} # ${r.no} was withdrawn`), ...state.audit] }
    }
    case 'reqCancel': {
      const r = state.adminRequests.find((x) => x.id === a.id)!
      const step: RequestStep = { stage: 'cancel', by: actor(state), at: nowIso(), note: a.note.trim() }
      const n = notify(state, [r.userId], { kind: 'request', title: `Leave # ${r.no} You Canceled`, body: a.note.trim(), link: { type: 'page', page: 'requests' } })
      return {
        ...state, leaves: state.leaves.filter((l) => l.requestId !== r.id),
        adminRequests: state.adminRequests.map((x) => (x.id === r.id ? { ...x, status: 'cancelled', steps: [...x.steps, step] } : x)), notifications: [...n, ...state.notifications],
        audit: [auditOf(state, 'request', `Approved leave # ${r.no} ${nameOf(state, r.userId)} Cancelled — ${a.note.trim()}`), ...state.audit],
      }
    }
    case 'tsSave': {
      const k = dayKey(a.userId, a.date)
      const prev = state.timesheets[k]
      const me = actor(state)
      const at = nowIso()
      const day: TimesheetDay = {
        id: k, userId: a.userId, date: a.date, checkIn: a.checkIn || undefined, checkOut: a.checkOut || undefined, breakMinutes: a.breakMinutes, note: a.note?.trim() || undefined,
        otChoice: prev?.otChoice, calc: prev?.calc ?? EMPTY_CALC, updatedAt: at, updatedBy: me,
        revisions: prev ? [...prev.revisions, { at: prev.updatedAt, by: prev.updatedBy, checkIn: prev.checkIn, checkOut: prev.checkOut, breakMinutes: prev.breakMinutes, note: prev.note, reason: a.reason?.trim() || undefined }] : [],
      }
      const other = a.userId !== me
      const n = other ? notify(state, [a.userId], { kind: 'timesheet', title: `Your time sheet ${jalaliFa(a.date)} has been modified`, body: `${nameOf(state, me)}: ${a.reason?.trim() ?? ''}`, link: { type: 'page', page: 'timesheet' } }) : []
      const what = `${a.checkIn ?? '—'} Up ${a.checkOut ?? '—'}, Rest ${a.breakMinutes} Minutes`
      return {
        ...state, timesheets: { ...state.timesheets, [k]: day }, notifications: [...n, ...state.notifications],
        audit: [auditOf(state, 'timesheet', `${prev ? "Modifications" : "Log in"} Time Sheet ${other ? nameOf(state, a.userId) + ' ' : ''} ${jalaliFa(a.date)}: ${what} ${other ? ` — Reason: ${a.reason?.trim()}` : ''}`), ...state.audit],
      }
    }
    case 'tsPunch': {
      const me = actor(state)
      const k = dayKey(me, TODAY)
      const prev = state.timesheets[k]
      const now = tehranTime()
      const at = nowIso()
      const cfg = configFor(state.timesheetConfigs, TODAY)
      const day: TimesheetDay = a.kind === 'in'
        ? { id: k, userId: me, date: TODAY, checkIn: now, breakMinutes: isOffDay(TODAY, new Set(state.holidays.map((h) => h.date))) ? 0 : cfg.minBreakMinutes, calc: EMPTY_CALC, updatedAt: at, updatedBy: me, revisions: [] }
        : { ...prev!, checkOut: now, updatedAt: at, updatedBy: me }
      return { ...state, timesheets: { ...state.timesheets, [k]: day }, audit: [auditOf(state, 'timesheet', `${a.kind === 'in' ? "Log in" : "Exit"} ${now} Registered ${jalaliFa(TODAY)}`), ...state.audit] }
    }
    case 'tsUnpaid': {
      const k = dayKey(actor(state), a.date)
      const d = state.timesheets[k]
      return { ...state, timesheets: { ...state.timesheets, [k]: { ...d, otChoice: 'unpaid' } }, audit: [auditOf(state, 'timesheet', `Overtime ${hm(d.calc.undecided)} in ${jalaliFa(a.date)} remained unsolicited (no payment)`), ...state.audit] }
    }
    case 'monthClose': {
      const { from, to } = monthRange(a.month)
      const r = settleDays({ days: state.timesheets, requests: state.adminRequests, leaves: state.leaves, holidays: state.holidays.map((h) => h.date), configs: state.timesheetConfigs, closes: state.monthCloses, closing: a.month })
      const converted = r.changed.filter((c) => c.prev.calc.undecided > 0)
      const unpaidMinutes = converted.reduce((s, c) => s + c.prev.calc.undecided, 0)
      const byUser = new Map<string, number>()
      for (const c of converted) byUser.set(c.next.userId, (byUser.get(c.next.userId) ?? 0) + c.prev.calc.undecided)
      const label = `${J_MONTHS[toJalali(from).jm - 1]} ${toJalali(from).jy}`
      const n = [...byUser].flatMap(([uid, m]) => notify(state, [uid], { kind: 'timesheet', title: `${label} was closed`, body: `${hm(m)} Overtime without assignment was recorded without payment.`, link: { type: 'page', page: 'timesheet' } }))
      const close: MonthClose = { month: a.month, from, to, by: actor(state), at: nowIso(), unpaidMinutes }
      return {
        ...state, timesheets: r.days, monthCloses: [...state.monthCloses, close], notifications: [...n, ...state.notifications],
        audit: [auditOf(state, 'timesheet', `The moon ${label} was closed; ${converted.length} the day was recorded with ${hm(unpaidMinutes)} overtime without assignment, without payment`), ...state.audit],
      }
    }
    case 'tsConfig': {
      const prev = state.timesheetConfigs[state.timesheetConfigs.length - 1]
      const cfg: TimesheetConfig = { ...a.config, version: prev.version + 1, reason: a.reason.trim(), by: actor(state), at: nowIso() }
      return { ...state, timesheetConfigs: [...state.timesheetConfigs, cfg], audit: [auditOf(state, 'timesheet', `Rules of Time Sheet Version ${cfg.version} ${jalaliFa(cfg.from)}: Pure Work ${hm(cfg.dutyNetMinutes)}, Rest ${cfg.minBreakMinutes} Minutes, Reform Deadline ${cfg.editDays} Day — ${cfg.reason}`), ...state.audit] }
    }
    case 'internalProjectUpdate': {
      const ip = state.internalProjects.find((p) => p.id === a.id)!
      return { ...state, internalProjects: state.internalProjects.map((p) => (p.id === a.id ? { ...p, ...a.patch } : p)), audit: [auditOf(state, 'task', `Internal project “${ip.name}” updated`), ...state.audit] }
    }
  }
}

/** Fresh state for tests (no URL or storage) */
export function initialState(): State {
  return { ...buildSeed(), ...emptyWorkspace(), ...emptyOffice(), roleDefinitions: {}, whiteboards: {}, writeQueue: [], lastRead: {}, session: null, nav: { page: 'home' }, openTaskId: null, profileUserId: null, profileTab: 'profile', theme: 'system', denial: null }
}
