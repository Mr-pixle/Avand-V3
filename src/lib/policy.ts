import { roleGuard, type RoleDefinition } from './accessRoles'
import { whiteboardGuard } from './whiteboards'
import { validIcon } from './itemIcons'
import {projectNodeProblem} from './projectNodes'
import { OFFICE_ACTIONS, officeGuard } from './office'
import { WORKSPACE_ACTIONS, workspaceGuard } from './workspace'
// Permission policy. The reducer calls guard() before every write, so a hidden button is never the only protection:
// a forbidden action dispatched directly (the browser equivalent of calling the API) is refused and logged.
// In the server version this module runs in the service layer unchanged.
import type { State } from './state'
import type { AdminRequest, AuditEntry, Project, Role, Task, TaskKind, Team, User } from './types'
import { FIN_SPACES, finSpaceOf, flowOf, isClosed, isFinTask, isFlowTask, isWorkItem, isSupervisionMember, projectTeams, statusesFor, teamOfTask, type FinSpace } from './domain'
import { PROJECT_STAGES } from './projectProgress'
import { staffingProblem, managedScopes, phasePeople, taskScope, WORK_SCOPES, projectPeople } from './organization'
import { dayTotal, MAX_DAY_MINUTES } from './worklog'
import { TODAY } from './seed'
import { diffDays, tehranTime } from './jalali'
import {
  checkLeave, checkOvertime, configFor, dayKey, isHM, isMonthClosed, isPending, leaveDates, MAX_PRESENCE, monthRange, OTHER_CAT_FA, overtimeIndex, presenceOf,
} from './admin'
import { boardOf, checkBoard, checkFields, depthOf, descendants, heightOf, MAX_DEPTH, tasksOf } from './personal'
import { isMdrUrl } from './mdr'
import { projectDetailProblem, projectCategories, categoryNameValid, activeProject, isActiveProjectId } from './projectDetails'

/** System administration belongs to Project Control: the legacy 'sysadmin' role is treated as Control everywhere */
export const ROLE_ORDER: Role[] = ['ceo', 'management', 'office', 'finance', 'control', 'pm', 'lead', 'member', 'inspector']
export const ROLE_FA: Record<Role, string> = {
  sysadmin: 'Project Controls', ceo: 'CEO', management: 'Management', control: 'Project Controls',
  pm: 'Project Manager', lead: 'Team Lead', member: 'Team Member', inspector: 'Site Inspector', office: 'Office Manager', finance: 'Finance Manager',
}

export type Perm =
  | 'users.manage' | 'users.approve' | 'project.define' | 'sync.run' | 'plan.all' | 'status.all'
  | 'statuses.manage' | 'calendar.manage' | 'announce.post' | 'supervision.create' | 'supervision.review.all'
  | 'teamspace.all' | 'actual.edit' | 'audit.view' | 'workload.view' | 'admin.view'
  | 'control.section' | 'points.manage' | 'worklog.manage' | 'worklog.view.all'
  | 'requests.office' | 'requests.ceo' | 'admin.reports' | 'timesheet.view.all' | 'timesheet.edit.all' | 'timesheet.close' | 'leave.direct'
  | 'fin.finance' | 'fin.office' | 'fin.shared'
  | 'project.view' | 'project.create' | 'project.edit' | 'staffing.edit'
  | 'team.create' | 'team.edit' | 'task.view' | 'task.create' | 'task.edit' | 'task.delete'
  | 'library.view' | 'library.create' | 'library.edit' | 'library.delete'
  | 'whiteboard.view' | 'whiteboard.create' | 'whiteboard.edit' | 'whiteboard.delete'
  | 'requests.create' | 'requests.it' | 'roles.manage'

/** Role × permission matrix (section 6 of the technical report). Scoped rules (PM → own projects, lead → own team) are below. */
// The Project Control section (Workload, Sync, Admin, points report) and everything done there: CEO and Project Control only.
const CONTROL: Role[] = ['ceo', 'control']
const MATRIX: Record<Perm, Role[]> = {
  'roles.manage': ['ceo'],
  'project.view': ROLE_ORDER, 'project.create': CONTROL, 'project.edit': CONTROL, 'staffing.edit': CONTROL,
  'team.create': CONTROL, 'team.edit': CONTROL,
  'task.view': ROLE_ORDER, 'task.create': ROLE_ORDER, 'task.edit': ROLE_ORDER, 'task.delete': ROLE_ORDER,
  'library.view': ROLE_ORDER, 'library.create': CONTROL, 'library.edit': CONTROL, 'library.delete': CONTROL,
  'whiteboard.view': ROLE_ORDER, 'whiteboard.create': ROLE_ORDER, 'whiteboard.edit': ROLE_ORDER, 'whiteboard.delete': CONTROL,
  'requests.create': ROLE_ORDER, 'requests.it': ['control'],
  'control.section': CONTROL,
  'users.manage': CONTROL,
  'users.approve': CONTROL,
  'project.define': CONTROL,
  'sync.run': CONTROL,
  'statuses.manage': CONTROL,
  'calendar.manage': CONTROL,
  'audit.view': CONTROL,
  'workload.view': CONTROL,
  'admin.view': CONTROL,
  'actual.edit': CONTROL,
  'points.manage': CONTROL,
  'worklog.manage': CONTROL,
  'worklog.view.all': ['ceo', 'management', 'control'],
  'plan.all': ['ceo', 'management', 'control'],
  'status.all': ['ceo', 'management', 'control'],
  'announce.post': ['ceo', 'management', 'control'],
  'supervision.create': ['ceo', 'inspector'],
  'supervision.review.all': ['ceo'],
  // CEO and Project Control see, enter and work in every team space; tasks they create still belong to that team
  'teamspace.all': ['ceo', 'control'],
  // Administrative module: requests go Administrative Manager → CEO; reports for CEO, Project Control and the Administrative Manager
  'requests.office': ['office'],
  'requests.ceo': ['ceo'],
  'admin.reports': ['ceo', 'control', 'office'],
  'timesheet.view.all': ['ceo', 'control', 'office'],
  'timesheet.edit.all': ['office'],
  'timesheet.close': ['office'],
  'leave.direct': ['office'],
  // Finance & Administration section, two separate spaces. Nobody else — Project Control and management included — sees them or anything in them.
  'fin.finance': ['ceo', 'finance'],
  'fin.office': ['ceo', 'office'],
  'fin.shared': ['ceo'],
}

export const PERMISSION_MATRIX: Readonly<Record<Perm, readonly Role[]>> = MATRIX
export const PERM_FA: Record<Perm, string> = {
  'roles.manage': "Management of roles and permissions",
  'project.view': "View Projects", 'project.create': "Creating a Project", 'project.edit': "Project Editing", 'staffing.edit': "Edit Executive Structure",
  'team.create': "Create team", 'team.edit': "Edit and archive team",
  'task.view': "View Tasks", 'task.create': "Create Tasks", 'task.edit': "Edit Task", 'task.delete': "Delete Personal Tasks",
  'library.view': "Visit the library", 'library.create': "Create document and link", 'library.edit': "Edit Document and Link", 'library.delete': "Remove Document and Link",
  'whiteboard.view': "View Project Board", 'whiteboard.create': "Create or duplicate the board", 'whiteboard.edit': "Edit Board", 'whiteboard.delete': "Remove Board",
  'requests.create': "Registration of office application", 'requests.it': "Request for IT",
  'control.section': "See Project Control (Workload, Sync, Management, Report Points)", 'points.manage': "Report and details of points and correction of effective dates",
  'users.manage': "Users, roles and system settings", 'users.approve': "Confirmation of membership application", 'project.define': "Defining and editing the project",
  'sync.run': "Sync and Sync Review Verification", 'plan.all': "Appropriation, Estimation and Due (Project Manager: Your Project; Supervisor: Your Team)",
  'status.all': "Change Status of all Tasks (Members: Self-Tack and Team)", 'statuses.manage': "Management Status Settings", 'calendar.manage': "Official Holiday",
  'announce.post': "Send Message", 'supervision.create': "Registration, referral and review of monitoring case", 'supervision.review.all': "Decide on all reviews",
  'teamspace.all': "The space of all teams: seeing, building and referring to members of the same team (the rest: their own team)", 'actual.edit': "Real Start/Finish Manual Modification", 'audit.view': "View AuditLog",
  'workload.view': 'Workload', 'admin.view': "Management Page",
  'worklog.manage': "Edit and remove work log of others (for a reason)", 'worklog.view.all': "See All Work Log (Project Manager: Your Project; Supervisor: Your Team)",
  'requests.office': "Review of administrative applications (first stage) and cancellation of approved leave", 'requests.ceo': "Final decision of office requests",
  'admin.reports': "Office Reports", 'timesheet.view.all': "See all time sheets", 'timesheet.edit.all': "Timesheet correction of others (for a reason)",
  'timesheet.close': "Close the Moon and Time Sheet Rules", 'leave.direct': "Direct registration of leave (exceptions, for a reason)",
  'fin.shared': "Joint Administrative-Financial Sector: View and Manage",
  'fin.finance': "Financial Space: Seeing, Building and Tracking Tasks", 'fin.office': "Office Space (Management): Seeing, Building and Tracking Tasks",
}

type S = Pick<State, 'users' | 'projects' | 'tasks' | 'statusSets' | 'internalProjects' | 'teams'>

/** Effective role: the legacy System Administrator role acts as Project Control */
export const roleOf = (u: User): Role => (u.role === 'sysadmin' ? 'control' : u.role)
export const has = (u: User | undefined, p: Perm) => !!u && u.status === 'active' && (p === 'roles.manage' ? u.role === 'ceo' : u.role !== 'ceo' && Array.isArray(u.rolePermissions) ? u.rolePermissions.includes(p) : MATRIX[p].includes(roleOf(u)))
export const canOverrideTaskScore=(state:Pick<State,'teams'>,u:User|undefined)=>!!u&&has(u,'points.manage')&&(u.role==='ceo'||u.role==='sysadmin'||state.teams.some(t=>t.id===u.teamId&&!t.archived&&(t.id==='ctl'||t.brandCode==='PM')))
const ACTION_PERMISSIONS: Partial<Record<string, Perm>> = {
  projectAdd: 'project.create', projectUpdate: 'project.edit',
  teamAdd: 'team.create', teamUpdate: 'team.edit', teamArchive: 'team.edit', teamMember: 'team.edit',
  addTask: 'task.create', createFlowTask: 'task.create', ptCreate: 'task.create', ptDelete: 'task.delete',
  updateTask: 'task.edit', setStatus: 'task.edit', savePlan: 'task.edit', flow: 'task.edit', classifyTasks: 'task.edit',
  addAttachments: 'task.edit', setActual: 'task.edit', ptUpdate: 'task.edit', ptMove: 'task.edit',
  reqCreate: 'requests.create',
}

export const canAssignBuiltIn = (state: State, actor: User, role: Role) => {
  if (!assignableRoles(actor).includes(role)) return false
  if (actor.role === 'ceo') return true
  const override: RoleDefinition | undefined = state.roleDefinitions[role]
  // Control can assign default accounts; granting an edited role may not expand the actor's authority.
  return (!override && !actor.customRoleId) || (override?.permissions ?? (Object.keys(MATRIX) as Perm[]).filter(permission => MATRIX[permission].includes(role))).every(permission => has(actor, permission))
}

export function canAdministerAccount(actor: User, target: User) {
  if (actor.id === target.id || actor.role === 'ceo') return true
  if (target.role === 'ceo') return false
  return (!target.rolePermissions && !actor.customRoleId) || (Object.keys(MATRIX) as Perm[]).every(permission => !has(target, permission) || has(actor, permission))
}

export const userOf = (state: Pick<State, 'users'>, id: string | null | undefined) => state.users.find((u) => u.id === id && u.status === 'active')
const projectOf = (state: S, id: string): Project | undefined => state.projects.find((p) => p.id === id)
export const isPMOf = (state: S, u: User | undefined, projectId: string) => {
  const p = projectOf(state, projectId)
  return !!u && u.status === 'active' && !!p && (isProjectWideManager(state,u,projectId)||managedScopes(p,u.id).length>0)
}
/** A named project manager/chief architect has authority across this project only. Phase leads retain their own scope. */
export function isProjectWideManager(state:S,u:User|undefined,projectId:string){
  const p=projectOf(state,projectId)
  return !!u&&u.status==='active'&&!!p&&(p.managerId===u.id||p.staffing?.chiefArchitectId===u.id||(u.role==='pm'&&managedScopes(p,u.id).length>0))
}
const isTaskCreator=(u:User,t:Task)=>t.source==='manual'&&t.createdBy===u.id
export function managesTaskScope(state: S, u: User | undefined, t: Task) {
  const scope = taskScope(state.tasks, t)
  return !!u && u.status === 'active' && !!scope && managedScopes(projectOf(state, t.projectId), u.id).includes(scope)
}

/** Roles a user may give when approving or editing accounts */
/** Roles that open the Finance & Administration space: only the CEO gives them, so nobody can grant themselves that access */
export const FIN_ROLES: readonly Role[] = ['office', 'finance']
export function assignableRoles(me: User | undefined): Role[] {
  if (!me) return []
  if (me.role === 'ceo') return ROLE_ORDER
  if (has(me, 'users.manage')) return ROLE_ORDER.filter((r) => r !== 'ceo' && !FIN_ROLES.includes(r))
  return []
}

// ---------- scoped checks ----------
/** Sync is part of the Project Control section: CEO and Project Control only (projectId kept for a future per-project rule) */
export function canSyncProject(state: S, u: User | undefined, projectId: string) { return has(u, 'sync.run')&&isActiveProjectId(state.projects,projectId) }
export function canCreateProjectTask(state: S, u: User | undefined, projectId: string) { return isActiveProjectId(state.projects,projectId)&&has(u, 'task.create') && (has(u, 'plan.all') || isPMOf(state, u, projectId)) }

export function canViewSupervisionOf(state: S, u: User | undefined, projectId: string) {
  if (!u) return false
  if (has(u, 'plan.all') || isSupervisionMember(state,u) || u.role === 'inspector' || isPMOf(state, u, projectId)) return true
  const p = projectOf(state, projectId)
  return !!p && projectTeams(p).includes(u.teamId)
}
export function canSeeTeamSpace(u: User | undefined, teamId: string) { return !!u && (u.teamId === teamId || has(u, 'teamspace.all')) }
/** Internal projects shape a team's own space: its lead (or Control / inspector inside their own team) and the CEO */
export function canCreateInternalProject(u: User | undefined, teamId: string) {
  return !!u && u.status === 'active' && (roleOf(u) === 'ceo' || (u.teamId === teamId && ['lead', 'control', 'inspector'].includes(roleOf(u))))
}
const FIN_PERM: Record<FinSpace, Perm> = { finance: 'fin.finance', office: 'fin.office', shared: 'fin.shared' }
/** One space of the Finance & Administration section (finance: CEO + Financial Manager, office: CEO + Administrative Manager); without a space: any of them */
export const canSeeFinSpace = (u: User | undefined, space?: FinSpace):boolean => {
  if(!u||u.status!=='active')return false
  if(u.role==='ceo')return true
  if(u.teamId==='ctl')return false
  if(!space)return FIN_SPACES.some(s=>canSeeFinSpace(u,s))
  if(u.role==='finance')return space==='finance'
  if(u.role==='office')return space==='office'
  if(u.teamId!=='mgt')return false
  return space==='shared' ? canSeeFinSpace(u,'finance')&&canSeeFinSpace(u,'office')&&has(u,FIN_PERM.shared) : has(u,FIN_PERM[space])
}
/** Spaces of the section a user may open, in display order */
export const finSpacesOf = (u: User | undefined) => FIN_SPACES.filter((s) => canSeeFinSpace(u, s))

export function canViewTask(state: S, u: User | undefined, t: Task) {
  if (!has(u, 'task.view') && !(!isFinTask(t)&&t.kind!=='internal'&&isSupervisionMember(state,u)) && !(isFinTask(t)&&canSeeFinSpace(u,finSpaceOf(t)))) return false
  if (!u) return false
  if(state.projects.some(p=>p.id===t.projectId&&p.deletedAt)&&!(has(u,'project.define')&&has(u,'project.edit')&&has(u,'admin.view')))return false
  if (t.kind !== 'internal' && !isFinTask(t) && !has(u, 'project.view')&&!isSupervisionMember(state,u)) return false
  if (t.kind === 'internal') return canSeeTeamSpace(u, t.teamSpaceId ?? '') || t.assigneeUserId === u.id || t.reviewerId === u.id
  if (t.kind === 'supervision') return canViewSupervisionOf(state, u, t.projectId) || [t.assigneeUserId, t.reporterId, t.reviewerId, ...(t.participantIds ?? [])].includes(u.id)
  // no exception for people named on the task: losing the role closes the space
  if (t.kind === 'finadmin') { const sp = finSpaceOf(t); return !!sp && canSeeFinSpace(u, sp) }
  return true
}

/** Edit A/B/C of a supervision or internal task and (re)assign it */
export function canManageFlowTask(state: S, u: User | undefined, t: Task) {
  if (!u||t.archivedAt) return false
  if (t.kind === 'supervision') return u.role === 'ceo' || isSupervisionMember(state,u) || (u.role === 'inspector' && !t.reviewSourceTaskId) || t.reporterId === u.id
  if (t.kind === 'internal') return has(u, 'teamspace.all') || (u.teamId === t.teamSpaceId && (['lead', 'control', 'inspector'].includes(roleOf(u)) || t.createdBy === u.id))
  // coordinated by the CEO: the CEO manages every task of the space, the others the tasks they created
  if (t.kind === 'finadmin') { const sp = finSpaceOf(t); return !!sp && canSeeFinSpace(u, sp) }
  return false
}

/** Assignment, Estimation, Start/Due of a project work item */
export function canPlanTask(state: S, u: User | undefined, t: Task) {
  if (!has(u, 'task.edit') || !u || !t || !isActiveProjectId(state.projects,t.projectId)||t.archivedAt||t.removedFromMdr) return false
  if (isFlowTask(t)) return canManageFlowTask(state, u, t)
  if (!isWorkItem(t)) return false
  if (has(u, 'plan.all')||isProjectWideManager(state,u,t.projectId)||isTaskCreator(u,t)) return true
  if (projectOf(state, t.projectId)?.staffing) return managesTaskScope(state, u, t)
  if (isPMOf(state, u, t.projectId)) return true
  return u.role === 'lead' && teamOfTask(state, t) === u.teamId
}
/** Lead may only hand a task to their own team or its members */
export function canAssignTo(state: S, u: User | undefined, t: Task, res: { kind: 'user' | 'team'; id: string } | null) {
  if (!u) return false
  if (!canPlanTask(state, u, t)) return false
  if (res && res.kind !== 'user' && res.kind !== 'team') return false
  if (res?.kind === 'user' && !userOf(state, res.id)) return false
  const project = projectOf(state, t.projectId)
  if(res?.kind==='team'&&!state.teams.some(tm=>tm.id===res.id&&!tm.archived))return false
  if(isWorkItem(t)&&project&&!has(u,'plan.all')&&(isProjectWideManager(state,u,t.projectId)||isTaskCreator(u,t))) {
    if(!res)return true
    if(res.kind==='team')return projectTeams(project).includes(res.id)
    const person=userOf(state,res.id)
    return !!person&&(projectTeams(project).includes(person.teamId)||projectPeople(project).includes(person.id)||person.id===project.managerId)
  }
  if (!has(u, 'plan.all') && project?.staffing && isWorkItem(t)) {
    const scope = taskScope(state.tasks, t)
    // Project teams are organizational pools; scoped managers assign explicit project people, not an entire pool.
    return !!scope && managesTaskScope(state, u, t) && (!res || (res.kind === 'user' && phasePeople(project.staffing[scope]).includes(res.id)))
  }
  if (has(u, 'plan.all') || isPMOf(state, u, t.projectId) || isFlowTask(t)) return true
  if (u.role !== 'lead') return false
  if (!res) return false
  return res.kind === 'team' ? res.id === u.teamId : state.users.find((x) => x.id === res.id)?.teamId === u.teamId
}

export function canEditStatus(state: S, u: User | undefined, t: Task) {
  if (!u || !has(u, 'task.edit') || !isWorkItem(t)||!isActiveProjectId(state.projects,t.projectId)) return false
  if(t.archivedAt||t.removedFromMdr)return false
  if (has(u, 'status.all')||isProjectWideManager(state,u,t.projectId)||isTaskCreator(u,t)) return true
  const project = projectOf(state, t.projectId)
  if (project?.staffing) {
    const scope = taskScope(state.tasks, t)
    return managesTaskScope(state, u, t) || t.assigneeUserId === u.id || (!!t.assigneeTeamId && t.assigneeTeamId === u.teamId && !!scope && phasePeople(project.staffing[scope]).includes(u.id))
  }
  if (isPMOf(state, u, t.projectId)) return true
  if (u.role === 'inspector') return false
  return t.assigneeUserId === u.id || teamOfTask(state, t) === u.teamId
}

// ---------- time tracking ----------
/** People who did or reviewed the work log their own time: assignee, participants, reviewer, reporter, and the responsible team */
export function canLogTime(state: S, u: User | undefined, t: Task) {
  // Work Log reports are read by management and Project Control, so the finance & admin space keeps no Work Log
  if (!u || isFinTask(t) || !(isWorkItem(t) || isFlowTask(t)) || !canViewTask(state, u, t)) return false
  if ([t.assigneeUserId, t.reviewerId, t.reporterId, t.createdBy, ...(t.participantIds ?? [])].includes(u.id)) return true
  if (t.assigneeTeamId && t.assigneeTeamId === u.teamId) return true
  return t.kind === 'internal' && t.teamSpaceId === u.teamId
}
/** See everyone's records on a task (others see only their own; the totals are visible to all who see the task) */
export function canSeeAllLogs(state: S, u: User | undefined, t: Task) {
  if (!u) return false
  if (has(u, 'worklog.view.all') || (!isFinTask(t)&&isProjectWideManager(state,u,t.projectId)) || managesTaskScope(state, u, t) || (!projectOf(state, t.projectId)?.staffing && isPMOf(state, u, t.projectId))) return true
  if (roleOf(u) === 'lead' && (teamOfTask(state, t) === u.teamId || t.teamSpaceId === u.teamId)) return true
  return isFlowTask(t) && canManageFlowTask(state, u, t)
}
/** Own records while the task is open; CEO and Project Control on any record, with a reason when it is not theirs */
export function canEditLog(state: S, u: User | undefined, log: { userId: string }, t: Task) {
  if (!u) return false
  if (has(u, 'worklog.manage')) return true
  return log.userId === u.id && !isClosed(state, t)
}

/** Who decides a submitted review: the named Reviewer, or the CEO; never the person who did the work */
export function canDecideReview(state: S, u: User | undefined, t: Task) {
  if (!u || t.archivedAt || t.assigneeUserId === u.id) return false
  if (t.reviewerId === u.id || has(u, 'supervision.review.all')) return true
  if ((t.kind === 'internal' || t.kind === 'finadmin') && !t.reviewerId) return canManageFlowTask(state, u, t)
  return false
}
/** The person (or team) doing the work, as opposed to planners and reviewers */
export function isExecutor(state: S, u: User | undefined, t: Task) {
  if (!u||t.archivedAt) return false
  if (isFinTask(t)) return canManageFlowTask(state, u, t)
  if (isFlowTask(t)) return t.assigneeUserId ? t.assigneeUserId === u.id : !!t.assigneeTeamId&&t.assigneeTeamId===u.teamId
  return t.assigneeUserId === u.id || (!!t.assigneeTeamId && teamOfTask(state, t) === u.teamId)
}

export function canCreateTaskOfKind(state: S, u: User | undefined, kind: TaskKind, t: Task) {
  if (!u) return false
  if (kind === 'supervision') return isSupervisionMember(state,u)
  if (kind === 'internal') return canSeeTeamSpace(u, t.teamSpaceId ?? '') && (!t.internalProjectId || state.internalProjects.some((p) => p.id === t.internalProjectId && p.teamId === t.teamSpaceId))
  if (kind === 'manual') return canCreateProjectTask(state, u, t.projectId)
  if (kind === 'finadmin') { const sp = finSpaceOf(t); return !!sp && canSeeFinSpace(u, sp) && !t.teamSpaceId }
  return false
}

/** Assignee, Reviewer and participants of a finance & admin task must be people of its own space */
const finPerson = (state: S, t: Pick<Task, 'kind' | 'projectId'>, id: string | undefined) => { const sp = finSpaceOf(t); return !id || (!!sp && canSeeFinSpace(userOf(state, id), sp)) }

// ---------- read side ----------
// In the server version these are the list endpoints; here every page reads through them, so a user without access
// gets an empty answer — not just a hidden tab.
/** Tasks of the Finance & Administration section: only the spaces the user may open (one space when asked for) */
export function listFinTasks(state: S, u: User | undefined, space?: FinSpace, includeArchived=false): Task[] {
  const mine = finSpacesOf(u).filter((s) => !space || s === space)
  if (!mine.length) return []
  return Object.values(state.tasks).filter((t) => isFinTask(t) && mine.includes(finSpaceOf(t)!)&&(includeArchived||!t.archivedAt))
}
/** AuditLog lines a user may read: lines about a task they cannot see are left out (Admin › AuditLog included) */
export function canSeeAuditEntry(state: S, u: User | undefined, a: AuditEntry) {
  const t = a.taskId ? state.tasks[a.taskId] : undefined
  return !t || !isFinTask(t) || canViewTask(state, u, t)
}

// ---------- the guard ----------
type AnyAction = { type: string; [k: string]: unknown }
const MAX_FILE = 3 * 1024 * 1024
const MAX_FILES = 8

const ID = /^[A-Za-z0-9][\w:.|~@-]{0,95}$/
/** A new record must bring a well-formed id that is not taken yet (two people creating at the same moment never overwrite each other) */
function newIdError(state: State, a: AnyAction): string | null {
  const taken = (list: { id: string }[], id: string) => list.some((x) => x.id === id)
  const check = (id: unknown, exists: (id: string) => boolean) => (typeof id !== 'string' || !ID.test(id) ? "The record ID is invalid." : exists(id) ? "There is a record with the same ID, try again." : null)
  switch (a.type) {
    case 'addTask': case 'createFlowTask': return check((a.task as Task)?.id, (id) => !!state.tasks[id])
    case 'internalProjectAdd': return check((a.project as { id: string })?.id, (id) => taken(state.internalProjects, id))
    case 'addHoliday': return check((a.holiday as { id: string })?.id, (id) => taken(state.holidays, id))
    case 'addLeave': return check((a.leave as { id: string })?.id, (id) => taken(state.leaves, id))
    case 'addUser': return check((a.user as User)?.id, (id) => taken(state.users, id)) ?? (state.users.some((u) => u.username === (a.user as User).username) ? "This username has already been taken." : null)
    case 'statusAdd': return check((a.status as { id: string })?.id, (id) => (state.statusSets[String(a.scope)] ?? []).some((x) => x.id === id))
    case 'teamAdd': return check((a.team as Team)?.id, (id) => taken(state.teams, id))
    case 'projectAdd': return check((a.project as Project)?.id, (id) => taken(state.projects, id))
  }
  return null
}

/** Returns a reason when the signed-in user may not perform the action, or null when it is allowed */
export function guard(state: State, a: AnyAction): string | null {
  if (a.type === 'roleSave' || a.type === 'roleDelete' || a.type === 'roleAssign') return roleGuard(state, a)
  if (a.type === 'whiteboardSave' || a.type === 'whiteboardDelete') return whiteboardGuard(state, a)
  if (OFFICE_ACTIONS.has(a.type)) return officeGuard(state, a)
  if (WORKSPACE_ACTIONS.has(a.type)) return workspaceGuard(state, a)
  const viewer = state.users.find(u => u.id === state.session)
  if (viewer?.role === 'ceo' && ['reqCreate', 'tsSave', 'tsPunch', 'tsUnpaid'].includes(a.type)) return "Timesheets and personal requests are unavailable to the CEO."
  const me = userOf(state, state.session)
  const tOf = (id: unknown) => state.tasks[String(id)]
  switch (a.type) {
    // public / session / per-viewer UI state
    case 'login': {
      const u = state.users.find((x) => x.id === a.id)
      return u && u.status === 'active' ? null : "This account is inactive."
    }
    case 'register': {
      if (state.session) return "Sign out before requesting another account."
      const u = a.user as User
      if (!u || typeof u.id !== 'string' || !ID.test(u.id) || state.users.some((x) => x.id === u.id)) return "The account ID is invalid."
      if (state.users.some((x) => x.username === u.username)) return "This username has already been taken."
      return u.status === 'pending' && u.role === 'member' ? null : "The new account will only be created with the “waiting confirmation” status."
    }
    case 'logout': case 'setTheme': case 'nav': case 'readNotifs': case 'readChannel': case 'openProfile':
      return null
    // jobs that the system runs on its own (write-back timer, run bookkeeping)
    case 'updateRun': case 'flushWriteBack': return null
    // the server's own Sync and Write-back jobs: only the system (no signed-in user) may record their results
    case 'sysRunStart': case 'sysSyncResult': case 'sysWriteBack': return state.session ? "It only works with Sync and Write-back." : null
  }
  if (!me) return "Sign in to continue."
  const required = ACTION_PERMISSIONS[a.type]
  const targetTask=a.type==='createFlowTask'?a.task as Task:a.taskId?tOf(a.taskId):undefined
  if(targetTask&&!isActiveProjectId(state.projects,targetTask.projectId))return 'Restore or unarchive this project before modifying its tasks.'
  if(targetTask?.archivedAt&&a.type!=='finTaskArchive')return 'Restore this archived task before editing it.'
  const financeAction=!!targetTask&&isFinTask(targetTask)&&['createFlowTask','updateTask','flow','addAttachments','setActual'].includes(a.type)&&canSeeFinSpace(me,finSpaceOf(targetTask))
  const caAction=!!targetTask&&targetTask.kind==='supervision'&&['createFlowTask','updateTask','flow','addAttachments'].includes(a.type)&&isSupervisionMember(state,me)
  if (required && !has(me, required) && !financeAction&&!caAction) return "Your role does not allow this action."
  const idErr = newIdError(state, a)
  if (idErr) return idErr
  switch (a.type) {
    case 'openTask': {
      if (a.id == null) return null
      const t = tOf(a.id)
      return !t ? "This task does not exist." : canViewTask(state, me, t) ? null : "You do not have access to this task."
    }
    case 'classifyTasks': {
      if (!Array.isArray(a.ids) || !a.ids.length || a.ids.length > Object.keys(state.tasks).length || new Set(a.ids).size !== a.ids.length) return "The task list is invalid."
      if (!PROJECT_STAGES.includes(a.projectStage as never)) return "The project stage is invalid."
      if (a.workScope != null && (!has(me, 'plan.all') || !WORK_SCOPES.includes(a.workScope as never))) return "Changing the responsible phase is not allowed for you."
      const list = a.ids.map((id: unknown) => tOf(id))
      if (list.some((t: Task | undefined) => !t || !isWorkItem(t) || !canPlanTask(state, me, t))) return "The classification is only allowed for the tasks under your authority."
      if (new Set(list.map((t: Task | undefined) => t?.projectId)).size !== 1) return "The tasks must belong to the same project."
      return null
    }
    case 'teamAdd': case 'teamUpdate': {
      if (!has(me, 'users.manage')) return "Managing teams is only for the manager and project control."
      const t = (a.type === 'teamAdd' ? a.team : a.patch) as Team
      if (t?.icon !== undefined && !validIcon(t.icon)) return "Team icon is not valid."
      if (a.type === 'teamUpdate' && !state.teams.some((x) => x.id === a.id)) return "The team was not found."
      if (!t || typeof t.name !== 'string' || !t.name.trim() || t.name.trim().length > 100) return "The team name should be between 1 and 100 characters."
      if (state.teams.some((x) => x.id !== (a.type === 'teamAdd' ? t.id : a.id) && x.name.trim().normalize('NFC') === t.name.trim().normalize('NFC'))) return "The name of the team is repeat."
      if (!['fixed', 'phase1', 'phase2', 'revit', 'other', 'supervision', 'management'].includes(t.kind)) return "The type of team is invalid."
      return null
    }
    case 'teamArchive': {
      if (!has(me, 'users.manage')) return "Managing teams is only for the manager and project control."
      if (!state.teams.some((t) => t.id === a.id) || typeof a.archived !== 'boolean') return "The team or situation is invalid."
      if (a.archived && state.users.some((u) => u.teamId === a.id)) return "Move or exit team members before archiving."
      return null
    }
    case 'teamMember': {
      if (!has(me, 'users.manage')) return "Changing team members is only for the manager and control of the project."
      const target = state.users.find((u) => u.id === a.userId)
      if (!target) return "The user was not found."
      if (target.role === 'ceo' && me.role !== 'ceo') return "The CEO’s membership only changes the CEO."
      if (typeof a.teamId !== 'string' || (a.teamId && !state.teams.some((t) => t.id === a.teamId && !t.archived))) return "Select an active team."
      return null
    }
    case 'approveUser': return state.users.some(user => user.id === a.id && user.status === 'pending') && has(me, 'users.approve') && state.teams.some((t) => t.id === a.teamId && !t.archived) && canAssignBuiltIn(state, me, a.role as Role) ? null : "Membership with this role is not allowed for you."
    case 'rejectUser': return state.users.some(user => user.id === a.id && user.status === 'pending') && has(me, 'users.approve') ? null : "Rejection is only for the system administrator, manager and project control."
    case 'addUser': {
      const u = a.user as User
      if(me.role!=='ceo'&&[u.nationalId,u.birthday,u.email,u.phone,u.telegramId].some(v=>v!=null&&v!==''))return 'Only the CEO can enter private profile fields for another user.'
      if (u.teamId && !state.teams.some((t) => t.id === u.teamId && !t.archived)) return "Select an active team."
      return has(me, 'users.manage') && canAssignBuiltIn(state, me, u.role) ? null : "User definition with this role is not allowed for you."
    }
    case 'updateUser': {
      const patch = a.patch as Partial<User>
      if ('teamId' in patch && patch.teamId && !state.teams.some((t) => t.id === patch.teamId && !t.archived)) return "Select an active team."
      const self = a.id === me.id
      const sensitive = (['role', 'teamId', 'status', 'capacity'] as const).filter((k) => k in patch)
      if(!self&&me.role!=='ceo'&&['nationalId','birthday','email','phone','telegramId'].some(k=>k in patch))return 'Private profile fields can only be edited by the account owner or CEO.'
      if ('username' in patch && (typeof patch.username !== 'string' || !/^[a-z0-9._-]{3,24}$/.test(patch.username))) return "The user name must be 3 to 24 small English letters, numbers, dots, dark lines or subline."
      if ('username' in patch && state.users.some((x) => x.id !== a.id && x.username === patch.username)) return `User name ${patch.username} has already been taken.`
      if ('name' in patch && !String(patch.name ?? '').trim()) return "Enter the full name."
      if (!self && !has(me, 'users.manage')) return "Editing the profiles of others is only for the system administrator and the manager."
      if (self && sensitive.length && !has(me, 'users.manage')) return "You can’t change your role, team and account status."
      const target = state.users.find((x) => x.id === a.id)
      if (target && !canAdministerAccount(me, target)) return "You do not have access to this level."
      if (patch.role !== undefined && !(ROLE_ORDER as readonly unknown[]).includes(patch.role)) return "Invalid role."
      if (target?.role === 'ceo' && (patch.role && patch.role !== 'ceo' || patch.status && patch.status !== 'active') && !state.users.some(u => u.id !== target.id && u.role === 'ceo' && u.status === 'active')) return "At least one active manager is required."
      if (patch.role && patch.role !== target?.role && !canAssignBuiltIn(state, me, patch.role)) return FIN_ROLES.includes(patch.role) ? "The role of the administrative manager and financial manager (access to financial and administrative space) only gives the manager." : "Giving this role is not allowed for you."
      if (target?.role === 'ceo' && me.role !== 'ceo' && !self) return "The CEO’s account only edits the CEO himself."
      return null
    }
    case 'setStatus': {
      const t = tOf(a.taskId)
      if (!t || !canEditStatus(state, me, t)) return "Changing the status of this task is not allowed for you."
      const to = statusesFor(state, t).find((s) => s.id === a.statusId)
      if(!to)return 'Select a valid task status.'
      if (to?.category === 'done' && t.reviewerId) return "This task has a reviewer; to close it, “Send for review” to confirm the reviewer."
      if (t.flow === 'in_review') return "This task is waiting to be checked; until the reviewer’s decision, Status does not change."
      return null
    }
    case 'savePlan': {
      const t = tOf(a.taskId)
      if (!t || !isWorkItem(t) || !canPlanTask(state, me, t)) return "Planning this task is not allowed for you."
      const res = a.assignee as { kind: 'user' | 'team'; id: string } | null
      if (!canAssignTo(state, me, t, res)) return "It is only possible to assign to authorized persons the scope of this task."
      if (res?.kind === 'team' && !state.teams.some((tm) => tm.id === res.id && !tm.archived)) return "Select an active team."
      if (!Array.isArray(a.allocations)) return "The allocation program is invalid."
      if (a.allocations.some((row: unknown) => {
        const x = row as { taskId?: string; userId?: string; teamId?: string; hours?: number }
        return !x || x.taskId !== t.id || !Number.isFinite(x.hours) || Number(x.hours) < 0 || !res || (res.kind === 'user' ? x.userId !== res.id || x.teamId !== userOf(state, res.id)?.teamId : !!x.userId || x.teamId !== res.id)
      })) return "The allocations should only be chosen for this purpose."
      // after completion, Due / Estimation / assignee feed the point already recorded: CEO and Project Control only
      const resUser = res?.kind === 'user' ? res.id : undefined
      const resTeam = res?.kind === 'team' ? res.id : undefined
      const changed = a.due !== t.due || a.estimation !== t.estimation || resUser !== t.assigneeUserId || resTeam !== t.assigneeTeamId
      if (isClosed(state, t) && changed && !has(me, 'points.manage')) return "The completed task plan only changes with the manager or project control (the score is registered)."
      return null
    }
    case 'addTask': {
      const t = a.task as Task
      if (!t || t.source!=='manual' || !['manual','phase','stage','doctype'].includes(t.kind) || !projectOf(state, t.projectId)||!isActiveProjectId(state.projects,t.projectId)) return "The project or type of work is invalid."
      if (!String(t.name ?? '').trim()) return "The name of the task is necessary."
      const nodeError=projectNodeProblem(state.tasks,t);if(nodeError)return nodeError
      if (t.parentId && (!state.tasks[t.parentId] || state.tasks[t.parentId].projectId !== t.projectId || isFlowTask(state.tasks[t.parentId]))) return "Parents should belong to this project."
      if (t.projectStage != null && !PROJECT_STAGES.includes(t.projectStage)) return "The project stage is invalid."
      if (t.workScope != null && !WORK_SCOPES.some(s => s === t.workScope)) return "The liability limit is invalid."
      const ownParent=!!t.parentId&&isWorkItem(state.tasks[t.parentId])&&canPlanTask(state,me,state.tasks[t.parentId])
      if (projectOf(state, t.projectId)?.staffing) {
        if (!taskScope(state.tasks, t)) return "Choose the phase responsible for the task."
        if (!has(me, 'plan.all') && !isProjectWideManager(state,me,t.projectId)&&!managesTaskScope(state, me, t)&&!ownParent) return "Task building is only allowed in the phase under your management."
      } else if (!canCreateProjectTask(state, me, t.projectId) && !(t.parentId && canPlanTask(state, me, state.tasks[t.parentId]))) return "The construction of this project is not allowed for you."
      if (t.assigneeTeamId || (t.assigneeUserId && !canAssignTo(state, me, ownParent?{...t,createdBy:me.id}:t, { kind: 'user', id: t.assigneeUserId }))) return "The person responsible should be the authorized person of this phase."
      if(isWorkItem(t)&&t.statusId&&!statusesFor(state,t).some(s=>s.id===t.statusId))return 'Invalid task status.'
      return null
    }
    case 'createFlowTask': {
      const t = a.task as Task
      if (t.kind !== 'supervision' && t.kind !== 'internal' && t.kind !== 'finadmin') return "The type of relief is invalid."
      if(t.kind!=='supervision'&&t.assigneeTeamId)return 'Team allocation is only available for site issues.'
      if (t.kind === 'finadmin') {
        const sp = finSpaceOf(t)
        if (!sp || t.teamSpaceId) return "Financial and administrative tasks are recorded only in the financial space or office space."
        if (!canSeeFinSpace(me, sp)) return sp === 'finance' ? "The financial space is only for the manager and the financial manager." : "The office space is only for the manager and director."
        if (!finPerson(state, t, t.assigneeUserId) || !finPerson(state, t, t.reviewerId) || (t.participantIds ?? []).some((id) => !finPerson(state, t, id))) return "Responsible, reviewer and participants should be people in this space."
        if (t.progressPct != null && !(Number.isInteger(t.progressPct) && t.progressPct >= 0 && t.progressPct <= 100)) return "The percentage of progress must be between 0 and 100."
      }
      if (t.progressPct != null && t.kind !== 'finadmin') return "The percentage of progress of this task comes from the workflow phase."
      if (!String(t.name ?? '').trim()) return "Enter the title."
      if (t.start && t.due && t.due < t.start) return "Due date cannot be before the start."
      if (t.parentId) {
        const parent = state.tasks[t.parentId]
        if (!parent || parent.kind !== t.kind || parent.projectId !== t.projectId || !canViewTask(state, me, parent)) return "Parenting is not valid."
      }
      const proj = state.projects.find((p) => p.id === t.projectId)
      if (t.kind === 'supervision' && !proj) return "The project was not found."
      if(t.kind==='supervision'&&t.assigneeTeamId&&(!state.teams.some(tm=>tm.id===t.assigneeTeamId&&!tm.archived)||!projectTeams(proj!).includes(t.assigneeTeamId)))return 'Choose an active project team.'
      if (t.assigneeUserId) {
        const target = userOf(state, t.assigneeUserId)
        if (!target) return "The selected host is not active."
        if(t.assigneeTeamId&&target.teamId!==t.assigneeTeamId)return 'Assignee must belong to the selected responsible team.'
        if (t.kind === 'internal' && target.teamId !== t.teamSpaceId) return "Internal stress is only referred to members of the same team."
        if (t.kind === 'supervision' && proj && !projectTeams(proj).includes(target.teamId)) return "He should be a member of the team of this project."
      }
      if (t.reviewerId && t.reviewerId === t.assigneeUserId) return "The reviewer can’t be the same as the coach."
      return canCreateTaskOfKind(state, me, t.kind, t) ? null : t.kind === 'supervision' ? "The registration is only for the supervisor and the director." : t.kind === 'finadmin' ? "The financial and administrative task is recorded only in its own space and by the people of the same space." : "Only members of the same team (and the CEO and project control) make it easy in the team space."
    }
    case 'finTaskArchive': {
      const t=tOf(a.taskId);return t&&isFinTask(t)&&canViewTask(state,me,t)&&typeof a.archived==='boolean'?null:'You do not have access to archive or restore this task.'
    }
    case 'updateTask': {
      const t = tOf(a.taskId)
      if (!t || !canViewTask(state, me, t)) return "You do not have access to this task."
      const patch = a.patch as Partial<Task>
      const keys = Object.keys(patch)
      if(keys.some(k=>['source','createdBy','createdAt','reporterId','mdrSourceName','mdrKey','mdrRow','docNumber','creatorTeamId','reviewSourceTaskId','issuedDate','disciplineTeamId','archivedAt','archivedBy'].includes(k)))return 'Task provenance is server-owned.'
      if('assigneeTeamId' in patch)return 'Assign a responsible team through the workflow.'
      if ('projectStage' in patch && (!isWorkItem(t) || !patch.projectStage || !PROJECT_STAGES.includes(patch.projectStage))) return "The project stage is invalid."
      if ('workScope' in patch) {
        if (!isWorkItem(t) || !patch.workScope || !WORK_SCOPES.some(s => s === patch.workScope)) return "The scope of responsibility is invalid."
        if (patch.workScope !== taskScope(state.tasks, t) && !has(me, 'plan.all')) return "The transition between phases is only for the functions of the total planning authority."
      }
      if ('parentId' in patch && patch.parentId !== t.parentId) return "Parents are not allowed to move in this direction."
      if ('name' in patch && !String(patch.name ?? '').trim()) return "The title is empty."
      if(t.reviewSourceTaskId&&'name' in patch&&patch.name!==t.name)return 'The document title is synchronized from the source task.'
      if ('progressPct' in patch) {
        if (!isFinTask(t)) return "The percentage of progress of this task comes from Status or the workflow stage."
        if (patch.progressPct == null || !(Number.isInteger(patch.progressPct) && patch.progressPct >= 0 && patch.progressPct <= 100)) return "The percentage of progress must be between 0 and 100."
        if (flowOf(t) === 'closed' || flowOf(t) === 'in_review') return "The progress of the task will not change or wait for the review."
        // the person doing the work reports progress; the rest of the task stays with its managers
        if (keys.length === 1 && (t.assigneeUserId === me.id || canManageFlowTask(state, me, t))) return null
      }
      if ('wf' in patch) {
        if (isFinTask(t)) return "Financial and administrative space tasks are not rated."
        if (!has(me, 'points.manage')) return "W.F. is a score parameter and only the manager and control of the project determine it."
        if (patch.wf != null && !(patch.wf >= 0.1 && patch.wf <= 5)) return "W.F. should be between 0.1 and 5."
      }
      if (!isFinTask(t) && isClosed(state, t) && keys.some((k) => ['due', 'estimation'].includes(k)) && !has(me, 'points.manage')) return "Due and Estimation of the completed task will only change with the manager or project control."
      if ('reviewerId' in patch && t.flow === 'in_review') return "Until the decision about the current round, the reviewer will not change."
      if ('reviewerId' in patch && patch.reviewerId && patch.reviewerId === t.assigneeUserId) return "The reviewer can’t be the same as the coach."
      if (isWorkItem(t)) {
        if('kind' in patch&&(t.source!=='manual'||!['manual','doctype'].includes(patch.kind??'')||!['manual','doctype','document'].includes(t.kind)))return 'Only manual work items can be converted between Task and Doc Type.'
        if (keys.some((k) => ['due', 'start', 'estimation', 'assigneeUserId', 'assigneeTeamId', 'baselineDue', 'baselineEstimation', 'actualStart', 'actualFinish', 'statusId', 'flow', 'projectId'].includes(k)))
          return "These fields only change from the planning path, status, or real date correction."
        return canPlanTask(state, me, t) ? null : "Editing the specifications of this task is not allowed for you."
      }
      if (keys.some((k) => ['supervisionStatusId', 'flow', 'baselineDue', 'baselineEstimation', 'actualStart', 'actualFinish', 'projectId', 'kind', 'teamSpaceId', 'assigneeUserId'].includes(k)))
        return "The situation, the reference and the actual date only change through the workflow."
      if ('internalProjectId' in patch && patch.internalProjectId && !state.internalProjects.some((p) => p.id === patch.internalProjectId && p.teamId === t.teamSpaceId)) return "The internal project does not belong to this team."
      if (isFinTask(t) && (!finPerson(state, t, patch.reviewerId) || (patch.participantIds ?? []).some((id) => !finPerson(state, t, id)))) return "The reviewer and the participants should be from people in this space."
      if ('name' in patch && !String(patch.name ?? '').trim()) return "The title is empty."
      return canManageFlowTask(state, me, t) ? null : "Editing this task is not allowed for you."
    }
    case 'flow': {
      const t = tOf(a.taskId)
      if (!t || !canViewTask(state, me, t)) return "You do not have access to this task."
      const op = a.op as string
      const f = flowOf(t)
      const note = String(a.note ?? '').trim()
      if (isWorkItem(t)) {
        // review overlay of project work items
        if (op === 'submit') {
          if (!t.reviewerId) return "No reviewer has been set for this task."
          if (t.flow === 'in_review') return "This post is currently awaiting review."
          return canEditStatus(state, me, t) && !(t.reviewerId === me.id) ? (note ? null : "The description of the work is required.") : "Sending to check is only responsible for the officer or team."
        }
        if (op === 'approve' || op === 'rework') {
          if (t.flow !== 'in_review') return "The staff is not waiting for a review."
          if (op === 'rework' && !note) return "The reason for the return is necessary for correction."
          return canDecideReview(state, me, t) ? null : "Only the reviewer decides this task or the CEO."
        }
        return "This operation is not valid for project relief."
      }
      switch (op) {
        case 'assignTeam': {
          if(t.kind!=='supervision'||f==='closed'||f==='in_review'||!canManageFlowTask(state,me,t))return 'Team assignment is not allowed.'
          const team=state.teams.find(tm=>tm.id===a.assigneeId&&!tm.archived),project=projectOf(state,t.projectId)
          return team&&project&&(t.reviewSourceTaskId?team.kind==='supervision':projectTeams(project).includes(team.id))?null:'Choose an authorized project team.'
        }
        case 'assign': {
          if (f === 'closed' || f === 'in_review') return "At this point, you can't change the reference."
          const target = userOf(state, a.assigneeId as string)
          if (!target) return "The selected user is not active."
          if (t.kind === 'internal' && target.teamId !== t.teamSpaceId) return "Internal stress is only referred to members of the same team."
          if (isFinTask(t) && !finPerson(state, t, target.id)) return finSpaceOf(t) === 'finance' ? "The financial space task is referred only to the manager or financial manager." : "The task of the office space is referred only to the manager or director."
          const proj = state.projects.find((p) => p.id === t.projectId)
          if (t.kind === 'supervision' && proj && !projectTeams(proj).includes(target.teamId)) return "He should be a member of the team of this project."
          if(t.reviewSourceTaskId&&!isSupervisionMember(state,target))return 'Document review is assigned to Site Supervision.'
          if (target.id === t.reviewerId) return "The reviewer can’t be the same as the coach."
          return canManageFlowTask(state, me, t) ? null : "Referring to this task is not allowed for you."
        }
        case 'start':
          if (f !== 'assigned' && f !== 'rework') return "It's not at the starting point."
          return isExecutor(state, me, t) ? null : "It just starts working."
        case 'submit':
          if (f !== 'in_progress' && f !== 'rework') return "To send, the task must be running or returning."
          if (!isExecutor(state, me, t)) return "Only the owner sends it to check."
          if (!t.reviewerId && t.kind === 'supervision') return "There is no reviewer monitoring."
          return note ? null : "The description of the work is required."
        case 'complete':
          if ((t.kind !== 'internal' && t.kind !== 'finadmin'&&!t.reviewSourceTaskId) || t.reviewerId) return "This task must be sent to check."
          if (f !== 'in_progress' && f !== 'rework') return "It's not running."
          return isExecutor(state,me,t) || canManageFlowTask(state, me, t) ? null : "Closing this task is not allowed for you."
        case 'approve': case 'rework':
          if (f !== 'in_review') return "The staff is not waiting for a review."
          if (op === 'rework' && !note) return "The reason for the return is necessary for correction."
          return canDecideReview(state, me, t) ? null : "Only the reviewer decides this task or the CEO."
        case 'reopen':
          if (f !== 'closed') return "It just opens up again."
          if (!note) return "The reason for the reopening is necessary."
          return canDecideReview(state, me, t) || canManageFlowTask(state, me, t) ? null : "Opening up this task is not allowed for you."
      }
      return "Operation is invalid."
    }
    case 'addAttachments': {
      const t = tOf(a.taskId)
      if (!t || !canViewTask(state, me, t)) return "You do not have access to this task."
      const files = (a.files as { size: number }[]) ?? []
      if (!files.length) return "File is not selected."
      if (files.length > MAX_FILES) return `Maximum ${MAX_FILES} files per time.`
      if (files.some((f) => f.size > MAX_FILE)) return "The maximum file size is 3 MB."
      const involved = [t.assigneeUserId, t.reporterId, t.reviewerId, ...(t.participantIds ?? [])].includes(me.id)
      return involved || canPlanTask(state, me, t) || canEditStatus(state, me, t) ? null : "Adding attachment is just that for people."
    }
    case 'setActual': {
      const t = tOf(a.taskId)
      if (!t) return "Task not found."
      if (!canViewTask(state, me, t)) return "You do not have access to this task."
      if (!String(a.reason ?? '').trim()) return "The reason for correcting real history is needed."
      if (a.actualStart && a.actualFinish && String(a.actualFinish) < String(a.actualStart)) return "The actual final cannot be before the actual start."
      return has(me, 'actual.edit') ? null : "The manual modification of real history is only for project control and the manager."
    }
    // ---------- work log ----------
    case 'logWork': case 'editWorkLog': case 'deleteWorkLog': {
      const log = a.type === 'logWork' ? undefined : state.workLogs.find((l) => l.id === a.id)
      if (a.type !== 'logWork' && (!log || log.deletedAt)) return "There is no working log record."
      const t = tOf(a.type === 'logWork' ? (a.log as { taskId: string }).taskId : log!.taskId)
      if (!t) return "Task not found."
      if (!canViewTask(state, me, t)) return "You do not have access to this task."
      if (isFinTask(t)) return "There are no financial and administrative work log tasks."
      if (a.type === 'logWork') { if (!canLogTime(state, me, t)) return "Record time on this task is only responsible for participants, reviewers and the team." }
      else {
        if (!canEditLog(state, me, log!, t)) return log!.userId === me.id ? "The task is closed; its work log correction is controlled by the project." : "Editing or deleting the work log of others is only for the manager and control of the project."
        if (log!.userId !== me.id && !String(a.reason ?? '').trim()) return "There is a reason to change the work log of others."
      }
      if (a.type === 'deleteWorkLog') return null
      const v = (a.type === 'logWork' ? a.log : { ...log, ...(a.patch as object) }) as { minutes: number; workDate: string; description: string }
      if (!Number.isInteger(v.minutes) || v.minutes < 1 || v.minutes > MAX_DAY_MINUTES) return "The duration should be between 1 minute and 24 hours."
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.workDate)) || v.workDate > TODAY) return "The date of work cannot be in the future."
      if (String(v.description ?? '').trim().length < 2) return "It is necessary to explain the activity."
      const owner = a.type === 'logWork' ? me.id : log!.userId
      if (dayTotal(state.workLogs, owner, v.workDate, log?.id) + v.minutes > MAX_DAY_MINUTES) return "The amount of time recorded on this day is more than 24 hours."
      return null
    }
    // ---------- points ----------
    case 'pointRecalc': {
      const t = tOf(a.taskId)
      if (!t) return "Task not found."
      if (!canViewTask(state, me, t)) return "You do not have access to this task."
      if (isFinTask(t)) return "Financial and administrative space tasks are not rated."
      return has(me, 'points.manage') ? null : "Recalculating points is only for the manager and control of the project."
    }
    case 'taskScoreOverride': {
      const t=tOf(a.taskId),score=t&&state.scores?.[`task:${t.id}`]
      if(!canOverrideTaskScore(state,me))return 'Only authorized PM / Project Control team members and administrators can edit task scores.'
      if(!t||!canViewTask(state,me,t)||isFinTask(t)||t.removedFromMdr||!isClosed(state,t)||!(isWorkItem(t)||isFlowTask(t)))return 'Only completed, eligible tasks can be scored.'
      if(typeof a.reason!=='string'||!a.reason.trim()||a.reason.length>500)return 'Enter a reason of up to 500 characters.'
      if(a.value===null)return state.scoreOverrides?.[t.id]?null:'There is no manual score to reset.'
      if(typeof a.value!=='number'||!Number.isFinite(a.value)||a.value<20||a.value>100)return 'Enter a score between 20 and 100.'
      if(!score||score.score===null||(score.calculatedScore===null))return 'Correct missing or invalid actual dates before changing the score.'
      return null
    }
    case 'pointAdjust': case 'pointConfig': return "Scores are calculated only by constant formula and relief dates; manual corrections and previous coefficients are inactive."
    case 'internalProjectAdd': {
      const ip = a.project as { teamId: string }
      return canCreateInternalProject(me, ip.teamId) ? null : "The construction of the internal project is only for the head of the same team (or CEO)."
    }
    case 'internalProjectUpdate': {
      const ip = state.internalProjects.find((p) => p.id === a.id)
      return ip && canCreateInternalProject(me, ip.teamId) ? null : "This internal project is not allowed for you."
    }
    case 'addComment': {
      const t = tOf(a.taskId)
      return t && canViewTask(state, me, t) ? null : "You do not have access to this task."
    }
    case 'sendMessage': {
      const ch = String(a.channelId)
      if (ch === 'announce' && !has(me, 'announce.post')) return "Send notifications only for management, project control and system manager."
      if (ch.startsWith('project:')) {
        const p = state.projects.find((x) => `project:${x.id}` === ch)
        if (!p) return "The channel was not found."
        const member = projectTeams(p).includes(me.teamId) || isSupervisionMember(state,me) || ['ceo', 'management'].includes(me.role) || projectPeople(p).includes(me.id)
        return member ? null : "You are not a member of this project."
      }
      return null
    }
    case 'review': {
      const ids = new Set(a.ids as string[])
      const projects = new Set(state.syncItems.filter((x) => ids.has(x.id)).map((x) => x.projectId))
      return [...projects].every((pid) => canSyncProject(state, me, pid)) ? null : "Sync Review approval is not allowed for this project."
    }
    case 'addRun': {
      const run = a.run as { projectId: string }
      return run.projectId === 'all' ? (has(me, 'sync.run') ? null : "Sync is not allowed for all projects.") : canSyncProject(state, me, run.projectId) ? null : "Sync this project is not allowed for you."
    }
    case 'addHoliday': case 'removeHoliday':
      return has(me, 'calendar.manage') ? null : "The official holiday registration is only for project control and the manager."
    case 'addLeave': case 'removeLeave': case 'reqCreate': case 'reqItUpdate': case 'reqDecide': case 'reqWithdraw': case 'reqCancel':
    case 'tsSave': case 'tsPunch': case 'tsUnpaid': case 'monthClose': case 'tsConfig':
      return guardAdmin(state, me, a)
    case 'ptCreate': case 'ptUpdate': case 'ptDelete': case 'ptMove': case 'psSave':
      return guardPersonal(state, me, a)
    case 'statusAdd': case 'statusUpdate': case 'statusDelete': case 'statusOverride': case 'statusInherit':
      return has(me, 'statuses.manage') ? null : "Statistics management is only for project control and management."
    case 'projectCategory': {
      if(!has(me,'project.define')||!has(me,'project.edit'))return 'Project management permission is required.'
      const names=projectCategories(state)
      const name=a.name, replacement=a.replacement,op=a.op
      if(!categoryNameValid(name)||typeof op!=='string'||!['create','rename','remove'].includes(op))return 'Invalid category.'
      if(op==='create')return names.some(n=>n.toLowerCase()===name.toLowerCase())?'Category already exists.':null
      if(!names.includes(name)||name==='Other')return 'Other cannot be changed or removed.'
      if(op==='rename')return !categoryNameValid(replacement)||names.some(n=>n.toLowerCase()===replacement.toLowerCase())?'Enter a unique category name.':null
      const target=replacement||'Other'
      return !categoryNameValid(target)||target===name||!names.includes(target)?'Choose a different replacement category.':null
    }
    case 'projectLifecycle': {
      if(!has(me,'project.define')||!has(me,'project.edit'))return 'Project management permission is required.'
      const p=state.projects.find(x=>x.id===a.id)
      if(!p)return 'Project not found.'
      if(a.op==='archive'&&activeProject(p)||a.op==='unarchive'&&p.archivedAt&&!p.deletedAt||a.op==='restore'&&p.deletedAt&&has(me,'admin.view'))return null
      if(a.op==='delete'&&!p.deletedAt&&has(me,'admin.view')&&a.confirmation===p.name)return null
      return 'Invalid project lifecycle operation or confirmation.'
    }
    case 'projectAdd': case 'projectUpdate': {
      if (!has(me, 'project.define')) return "A project management license is required."
      if (a.type === 'projectUpdate' && ['staffing', 'phase1TeamId', 'sdTeamId', 'phase2TeamId', 'teamIds', 'managerId'].some(key => Object.hasOwn(a.patch as object, key)) && !has(me, 'staffing.edit')) return "An executive structure editing license is required."
      const p = (a.type === 'projectAdd' ? a.project : a.patch) as Partial<Project>
      const previous = a.type === 'projectUpdate' ? state.projects.find(x => x.id === a.id) : undefined
      if (a.type === 'projectAdd') {
        const code = String(p.code ?? '')
        // the office codes projects by number (458, 386, 320) or by Latin letters (BBT)
        if (!/^[A-Z0-9]{2,8}$/.test(code) || p.id !== code) return "The project code is 2 to 8 characters of large Latin letters or numbers (such as 458 or BBT)."
        if (state.projects.some((x) => x.id === code)) return `Code ${code} has already been used.`
        if (!String(p.name ?? '').trim()) return "Enter the project name."
        // every project is defined with its own MDR: the tasks come from it
        if (!isMdrUrl(p.mdrUrl)) return "The MDR (Google Sheet) link is required for this project."
      } else {
        if (!previous) return "The project was not found."
        if ('id' in p || 'code' in p) return "The project code will not change after the definition."
        if ('mdrUrl' in p && !isMdrUrl(p.mdrUrl)) return "The MDR link should be the Google Sheet link of the MDR itself."
        if ('name' in p && !String(p.name ?? '').trim()) return "The project name is empty."
      }
      if('archivedAt' in p||'deletedAt' in p)return 'Use project lifecycle actions.'
      const detailError = projectDetailProblem(p, previous, state.users, state.teams, projectCategories(state))
      if (detailError) return detailError
      if (('phase1TeamId' in p || a.type === 'projectAdd') && !state.teams.some((t) => t.id === p.phase1TeamId && !t.archived)) return "Choose the Phase 1 team."
      if ('sdTeamId' in p && !state.teams.some(t => t.id === p.sdTeamId && t.kind === 'phase1' && !t.archived)) return 'Choose an active CD team for SD.'
      if (('phase2TeamId' in p || a.type === 'projectAdd') && !state.teams.some((t) => t.id === p.phase2TeamId && !t.archived && (t.kind === 'phase2' || t.kind === 'revit'))) return "Choose the Team Phase 2."
      if ('mdrTab' in p && !String(p.mdrTab ?? '').trim()) return "The MDR tab name is required."
      if ('staffing' in p) { const error = staffingProblem(p.staffing, state.users); if (error) return error }
      if ('revitTeamId' in p) return "Set the vision team in the selection of Phase 2 team."
      if ('teamIds' in p && (!Array.isArray(p.teamIds) || new Set(p.teamIds).size !== p.teamIds.length || p.teamIds.some((id) => !state.teams.some((t) => t.id === id && !t.archived && t.kind !== 'revit')))) return "Related teams are invalid."
      if (p.managerId && userOf(state, p.managerId)?.role !== 'pm') return "The project manager must be an active user with the role of the project manager."
      return null
    }
  }
  return "Operation Unknown."
}

// ---------- administrative module ----------
/** Own timesheet always; everybody's for the CEO, Project Control and the Administrative Manager */
export const canSeeTimesheetOf = (u: User | undefined, userId: string) => !!u && (u.id === userId || has(u, 'timesheet.view.all'))
/** Own requests; the approvers and the report roles see all of them */
export const managesItRequests = (u: User | undefined) => has(u, 'requests.it')
export const canHandleItRequest = (u: User | undefined, r: AdminRequest) => managesItRequests(u) && r.kind === 'it' && (r.status === 'pending_it' || r.status === 'it_in_progress')

export const canSeeRequest = (u: User | undefined, r: AdminRequest) => !!u && (r.userId === u.id || (r.kind === 'it' ? managesItRequests(u) : has(u, 'requests.office') || has(u, 'requests.ceo') || has(u, 'admin.reports')))
/** The approver step a pending request is waiting for */
export const canDecideRequest = (u: User | undefined, r: AdminRequest) =>
  !!u && r.kind !== 'it' && r.userId !== u.id && ((r.status === 'pending_office' && has(u, 'requests.office')) || (r.status === 'pending_ceo' && has(u, 'requests.ceo')))
const ISO = /^\d{4}-\d{2}-\d{2}$/

function guardAdmin(state: State, me: User, a: AnyAction): string | null {
  const closes = state.monthCloses
  const holidays = new Set(state.holidays.map((h) => h.date))
  const reqOf = (id: unknown) => state.adminRequests.find((r) => r.id === id)
  switch (a.type) {
    case 'addLeave': {
      if (!has(me, 'leave.direct')) return "Direct leave registration is only with the administrative manager; others take leave of “office requests.”"
      const l = a.leave as { userId?: string; date?: string; hours?: number; note?: string }
      const u = userOf(state, l?.userId)
      if (!u) return "The user was not found."
      if (!l.date || !ISO.test(l.date)) return "Choose the date of vacation."
      if (isMonthClosed(closes, l.date)) return "The month of this date is closed."
      if (!(Number(l.hours) > 0 && Number(l.hours) <= u.capacity)) return `The amount of leave must be between zero and ${u.capacity} hours.`
      if (!String(l.note ?? '').trim()) return "Write down the reason for the direct registration."
      return null
    }
    case 'removeLeave': {
      if (!has(me, 'leave.direct')) return "Removal of leave is only with the manager."
      const l = state.leaves.find((x) => x.id === a.id)
      if (!l) return "This vacation was not found."
      if (l.requestId) return "The leave comes from an approved application; cancel it from yourself."
      return isMonthClosed(closes, l.date) ? "The month of this date is closed." : null
    }
    case 'reqCreate': {
      const r = a.req as { kind?: string; description?: string; leave?: never; it?: { title?: unknown }; overtime?: { date?: string; minutes?: number; taskIds?: string[] }; other?: { title?: string; category?: string; date?: string } }
      const files = (a.files ?? []) as { size: number }[]
      if (files.length > MAX_FILES) return `Maximum ${MAX_FILES} files per time.`
      if (files.some((f) => f.size > MAX_FILE)) return "The maximum file size is 3 MB."
      if (typeof r?.description !== 'string' || r.description.length > 2000) return "The explanation is long."
      if (r?.kind === 'leave') {
        return checkLeave(r.leave, { holidays, today: TODAY, cfg: configFor(state.timesheetConfigs, TODAY), closes, existing: state.leaves, pending: state.adminRequests, userId: me.id })
      }
      if (r?.kind === 'overtime') {
        const o = r.overtime
        const date = String(o?.date ?? '')
        if (!ISO.test(date)) return "Choose an overtime date."
        const err = checkOvertime(o, { today: TODAY, closes, day: state.timesheets[dayKey(me.id, date)], requests: overtimeIndex(state.adminRequests).get(dayKey(me.id, date)) ?? [] })
        if (err) return err
        const ids = Array.isArray(o?.taskIds) ? o!.taskIds : []
        if (ids.length > 20) return "Up to 20 ts."
        if (ids.some((id) => !state.tasks[id] || !canViewTask(state, me, state.tasks[id]))) return "One of the selected tasks is not available to you."
        // the request is read by the approvers and the report roles (Project Control included): no finance & admin task in it
        if (ids.some((id) => isFinTask(state.tasks[id]))) return "Financial and administrative space tasks are not listed on the overtime application."
        return null
      }
      if (r?.kind === 'it') {
        if (typeof r.it?.title !== 'string' || !r.it.title.trim() || r.it.title.trim().length > 120) return "The title of the application must be between 1 and 120 EUR."
        return null
      }
      if (r?.kind === 'other') {
        const o = r.other
        if (!String(o?.title ?? '').trim()) return "Write the request title."
        if (String(o?.title).length > 120) return "The title is long."
        if (!o?.category || !(o.category in OTHER_CAT_FA)) return "Select the request category."
        if (o.date && !ISO.test(o.date)) return "History is invalid."
        return null
      }
      return "Choose the type of request."
    }
    case 'reqItUpdate': {
      const r = reqOf(a.id)
      if (!r || !canHandleItRequest(me, r)) return "This request is only possible for project control."
      if ((a.status !== 'it_in_progress' && a.status !== 'it_resolved') || r.status === a.status) return "The selected status is not valid."
      if (a.note !== undefined && (typeof a.note !== 'string' || a.note.length > 2000)) return "Note is not valid."
      return null
    }
    case 'reqDecide': {
      const r = reqOf(a.id)
      if (!r) return "The request was not found."
      if (!isPending(r)) return "This request is no longer on the cartel."
      if (r.userId === me.id) return "You cannot confirm or reject your request."
      if (!canDecideRequest(me, r)) return r.status === 'pending_office' ? "This step is with the manager." : "The final decision is with the CEO."
      if (a.decision !== 'approve' && a.decision !== 'reject') return "The decision is invalid."
      if (a.decision === 'reject' && !String(a.note ?? '').trim()) return "Write down the reason for rejection."
      if (a.decision === 'approve' && r.kind === 'overtime' && a.minutes != null) {
        const cap = [...r.steps].reverse().find((s) => s.stage === 'office' && s.minutes != null)?.minutes ?? r.overtime!.minutes
        if (!Number.isInteger(a.minutes) || Number(a.minutes) <= 0) return "Enter the confirmation value."
        if (Number(a.minutes) > cap) return "The confirmation value cannot exceed the request value or confirmation of the previous step."
      }
      if (a.decision === 'approve' && r.kind === 'leave' && r.leave) {
        const dates = leaveDates(r.leave, holidays)
        if (dates.some((d) => isMonthClosed(closes, d))) return "The month of this holiday is closed."
      }
      return null
    }
    case 'reqWithdraw': {
      const r = reqOf(a.id)
      if (!r) return "The request was not found."
      if (r.userId !== me.id) return "Only the applicant can withdraw the request."
      if (!isPending(r) || r.steps.some((s) => s.stage === 'office' || s.stage === 'ceo' || s.stage === 'it')) return "After the first decision, the request cannot be withdrawn."
      return null
    }
    case 'reqCancel': {
      const r = reqOf(a.id)
      if (!r) return "The request was not found."
      if (!has(me, 'requests.office')) return "Only the Office Manager can cancel approved leave."
      if (r.kind !== 'leave' || r.status !== 'approved') return "Only approved leave can be cancelled."
      if (!String(a.note ?? '').trim()) return "Write down the reason for cancellation."
      const dates = state.leaves.filter((l) => l.requestId === r.id).map((l) => l.date)
      return dates.some((d) => isMonthClosed(closes, d)) ? "The month of this holiday is closed." : null
    }
    case 'tsSave': {
      const uid = String(a.userId), date = String(a.date)
      const self = uid === me.id
      if (!userOf(state, uid)) return "The user was not found."
      if (!self && !has(me, 'timesheet.edit.all')) return "Timesheet registration and correction of others is only with the administrative manager."
      if (!self && !String(a.reason ?? '').trim()) return "Write down the reason for the correction."
      if (!ISO.test(date)) return "History is invalid."
      if (date > TODAY) return "Timesheets cannot be recorded in the coming days."
      if (isMonthClosed(closes, date)) return "This month is closed."
      const cfg = configFor(state.timesheetConfigs, date)
      if (self && diffDays(TODAY, date) > cfg.editDays) return `Only ${cfg.editDays} you can register or modify the previous day; tell the administrative manager for older days.`
      const reqs = overtimeIndex(state.adminRequests).get(dayKey(uid, date)) ?? []
      if (self && reqs.some((r) => isPending(r) || r.status === 'approved')) return "Overwork this day is in progress or confirmed; it is a lock day."
      const ci = a.checkIn as string | undefined, co = a.checkOut as string | undefined
      if (ci != null && ci !== '' && !isHM(ci)) return "Entry time is invalid."
      if (co != null && co !== '' && !isHM(co)) return "The hour of departure is invalid."
      if (!ci && co) return "Enter the entry hour first."
      const presence = presenceOf(ci, co)
      if (presence > MAX_PRESENCE) return "Entry distance to departure is more than 20 hours; check the hours."
      const br = a.breakMinutes
      if (!Number.isInteger(br) || Number(br) < 0 || Number(br) > Math.max(presence, 0) + (co ? 0 : 1440)) return "The rest period is invalid."
      if (co && Number(br) >= presence) return "The rest is longer than the whole presence."
      if (date === TODAY) {
        const now = tehranTime()
        if (ci && ci > now) return "The hour of arrival has not yet arrived."
        if (co && ci && co > ci && co > now) return "The hour of departure has not yet arrived."
        if (co && ci && co <= ci) return "The exit after midnight has not yet arrived."
      }
      if (String(a.note ?? '').length > 500) return "The explanation is long."
      return null
    }
    case 'tsPunch': {
      const d = state.timesheets[dayKey(me.id, TODAY)]
      if (a.kind === 'in') return d?.checkIn ? "Entry is registered today." : null
      if (a.kind === 'out') return !d?.checkIn ? "Register first entry." : d.checkOut ? "Today's clock-out has been recorded." : tehranTime() <= d.checkIn ? "It’s not too late since your arrival." : null
      return "Operation is invalid."
    }
    case 'tsUnpaid': {
      const d = state.timesheets[dayKey(me.id, String(a.date))]
      if (!d) return "This day is not recorded in your time sheet."
      if (isMonthClosed(closes, d.date)) return "This month is closed."
      return d.calc.undecided > 0 ? null : "This extra day has nothing to do with the task."
    }
    case 'monthClose': {
      if (!has(me, 'timesheet.close')) return "The closing of the month is only with the director."
      const key = String(a.month)
      if (!/^\d{4}-\d{2}$/.test(key)) return "The moon is invalid."
      if (closes.some((c) => c.month === key)) return "It was closed last month."
      const { from, to } = monthRange(key)
      if (to >= TODAY) return "The moon can be closed after its end."
      const touching = state.adminRequests.filter((r) => isPending(r) && (
        (r.kind === 'overtime' && r.overtime && r.overtime.date >= from && r.overtime.date <= to)
        || (r.kind === 'leave' && r.leave && leaveDates(r.leave, holidays).some((d) => d >= from && d <= to))))
      return touching.length ? `${touching.length} This month’s vacation or overtime application is still in the cartel; first determine their assignment.` : null
    }
    case 'tsConfig': {
      if (!has(me, 'timesheet.close')) return "Timesheet rules are only with the administrator."
      const c = a.config as { dutyNetMinutes?: number; minBreakMinutes?: number; editDays?: number; from?: string }
      if (!Number.isInteger(c?.dutyNetMinutes) || c.dutyNetMinutes! < 60 || c.dutyNetMinutes! > 720) return "The daily net work should be between 1 and 12 hours."
      if (!Number.isInteger(c.minBreakMinutes) || c.minBreakMinutes! < 0 || c.minBreakMinutes! > 180) return "Rest should be between 0 and 180 minutes."
      if (!Number.isInteger(c.editDays) || c.editDays! < 0 || c.editDays! > 31) return "The correction period should be between 0 and 31 days."
      if (!c.from || !ISO.test(c.from) || c.from < TODAY) return "The new rules apply from today or after; the previous days will not be moved."
      return String(a.reason ?? '').trim() ? null : "Write down the reason for the change."
    }
  }
  return "Operation Unknown."
}

// ---------- personal tasks ----------
// Owner only, for every role: nobody — the CEO and Project Control included — reads or changes another person's personal tasks.
// An id that is not yours gets the same answer as an id that does not exist, so nothing about other people's lists leaks.
const NOT_YOURS = "This personal work is not available to you."
function guardPersonal(state: State, me: User, a: AnyAction): string | null {
  const own = (id: unknown) => { const t = state.personalTasks[String(id)]; return t && t.ownerId === me.id ? t : undefined }
  const board = boardOf(state.personalBoards, me.id)
  switch (a.type) {
    case 'ptCreate': {
      const f = (a.task ?? {}) as { title?: string; description?: string; priority?: string; start?: string; due?: string; parentId?: string | null; statusId?: string }
      const err = checkFields({ ...f, priority: f.priority ?? 'normal' })
      if (err) return err
      if (f.statusId && !board.statuses.some((x) => x.id === f.statusId)) return "Status is invalid."
      if (f.parentId) {
        const p = own(f.parentId)
        if (!p) return NOT_YOURS
        if (depthOf(state.personalTasks, p) + 1 >= MAX_DEPTH) return `Tasks and subtasks can be nested up to ${MAX_DEPTH} levels.`
      }
      return tasksOf(state.personalTasks, me.id).length >= 2000 ? "The number of personal tasks has reached the ceiling." : null
    }
    case 'ptUpdate': {
      const t = own(a.id)
      if (!t) return NOT_YOURS
      const patch = (a.patch ?? {}) as Record<string, unknown>
      const allowed = ['title', 'description', 'statusId', 'priority', 'start', 'due']
      if (Object.keys(patch).some((k) => !allowed.includes(k))) return "This field cannot be changed."
      if (patch.statusId !== undefined && !board.statuses.some((x) => x.id === patch.statusId)) return "Status is invalid."
      const merged = { ...t, ...patch } as { title: string; description?: string; priority: string; start?: string; due?: string }
      return checkFields(merged)
    }
    case 'ptDelete': return own(a.id) ? null : NOT_YOURS
    case 'ptMove': {
      const t = own(a.id)
      if (!t) return NOT_YOURS
      const pid = (a.parentId ?? null) as string | null
      if (pid) {
        const p = own(pid)
        if (!p) return NOT_YOURS
        if (pid === t.id || descendants(tasksOf(state.personalTasks, me.id), t.id).some((d) => d.id === pid)) return "A task cannot be taken under its own subtasks."
        if (depthOf(state.personalTasks, p) + 1 + heightOf(tasksOf(state.personalTasks, me.id), t.id) >= MAX_DEPTH) return `Tasks and subtasks can be nested up to ${MAX_DEPTH} levels.`
      }
      return Number.isInteger(a.index) && Number(a.index) >= 0 ? null : "The new place is invalid."
    }
    case 'psSave': {
      const statuses = a.statuses as Parameters<typeof checkBoard>[0]
      const err = checkBoard(statuses, String(a.defaultStatusId))
      if (err) return err
      const keep = new Set(statuses.map((x) => x.id))
      const remap = (a.remap ?? {}) as Record<string, string>
      const mine = tasksOf(state.personalTasks, me.id)
      for (const old of board.statuses) if (!keep.has(old.id) && mine.some((t) => t.statusId === old.id) && !keep.has(remap[old.id])) return `Select a new status for Status ${old.name}.`
      return null
    }
  }
  return "Operation Unknown."
}
