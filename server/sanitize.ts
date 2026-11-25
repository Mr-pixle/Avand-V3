// Actions a browser may send, and the fields of them the server decides itself. The reducer's guard then checks the
// permission of the signed-in user exactly as before; this layer only stops forged or system-only input.
import type { Action } from '../src/lib/state'
import type { Task, User } from '../src/lib/types'
import { PROJECT_DETAIL_KEYS } from '../src/lib/projectDetails'

/** Every action a signed-in person can trigger from the app. Sign-in/up, passwords, UI-only state and the system's own
 * Sync and Write-back jobs are not in this list: they have their own endpoints or never come from a browser. */
export const CLIENT_ACTIONS = new Set([
  'supervisionWorkflow', 'supervisionStatus', 'deadlineSettings', 'visitSave', 'visitDelete',
  'folderIconSave', 'docSave', 'docDelete', 'linkSave', 'linkDelete', 'mapSave', 'noteSave', 'noteDelete', 'reminderSave', 'reminderDelete',
  'roleSave', 'roleDelete', 'roleAssign', 'whiteboardSave', 'whiteboardDelete',
  'classifyTasks', 'teamAdd', 'teamUpdate', 'teamArchive', 'teamMember',
  'approveUser', 'rejectUser', 'addUser', 'updateUser',
  'setStatus', 'savePlan', 'addTask', 'addComment', 'sendMessage', 'readNotifs', 'readChannel', 'review',
  'addHoliday', 'removeHoliday', 'addLeave', 'removeLeave',
  'statusAdd', 'statusUpdate', 'statusDelete', 'statusOverride', 'statusInherit',
  'projectAdd', 'projectUpdate', 'projectCategory', 'projectLifecycle', 'createFlowTask', 'flow', 'updateTask', 'finTaskArchive', 'addAttachments', 'setActual',
  'internalProjectAdd', 'internalProjectUpdate', 'logWork', 'editWorkLog', 'deleteWorkLog',
  'pointRecalc', 'pointAdjust', 'pointConfig', 'taskScoreOverride',
  'reqCreate', 'reqItUpdate', 'reqDecide', 'reqWithdraw', 'reqCancel', 'tsSave', 'tsPunch', 'tsUnpaid', 'monthClose', 'tsConfig',
  'ptCreate', 'ptUpdate', 'ptDelete', 'ptMove', 'psSave',
])

export class Rejected extends Error {}

type O = Record<string, unknown>
const isObj = (x: unknown): x is O => !!x && typeof x === 'object' && !Array.isArray(x)
const pick = (o: O, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]))
const omit = (o: O, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))

// Task fields the server owns: provenance, MDR identity and creation stamps
const TASK_SERVER = ['source', 'docNumber', 'mdrKey', 'mdrSourceName', 'mdrRow', 'mdrSubtasks', 'removedFromMdr', 'createdBy', 'createdAt', 'creatorTeamId', 'reviewSourceTaskId', 'issuedDate', 'disciplineTeamId','archivedAt','archivedBy', 'baselineDue', 'baselineEstimation', 'actualStart', 'actualFinish', 'flow', 'supervisionStatusId']
// …and for a task that comes from the MDR, everything the MDR decides
const TASK_FROM_MDR = ['name', 'parentId', 'weight', 'weightDerived', 'floor', 'pkg', 'planIssue', 'order']
const TASK_NEW_FLOW = ['id', 'projectId', 'parentId', 'kind', 'name', 'order', 'description', 'type', 'priority', 'reviewerId', 'participantIds', 'assigneeUserId', 'assigneeTeamId', 'start', 'due', 'estimation', 'teamSpaceId', 'internalProjectId', 'location', 'progressPct', 'dependsOn']
const TASK_NEW_MANUAL = ['projectStage', 'workScope', 'assigneeUserId', 'id', 'projectId', 'parentId', 'kind', 'name', 'order', 'statusId', 'description', 'type', 'priority', 'floor', 'pkg']
const USER_PATCH = ['name', 'username', 'title', 'phone', 'bio', 'avatar', 'email', 'nationalId', 'birthday', 'telegramId', 'workScope', 'capacity', 'role', 'teamId', 'status']
function validateProfile(patch:O) {
  for(const key of ['nationalId','birthday','telegramId','workScope','phone'])if(patch[key]!=null&&(typeof patch[key]!=='string'||(patch[key] as string).length>200))throw new Rejected(`Invalid ${key}.`)
  if(patch.email!=null&&(typeof patch.email!=='string'||patch.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)))throw new Rejected('Enter a valid email address.')
}
const PROJECT_FIELDS = ['id', 'code', 'name', 'type', 'phase1TeamId', 'sdTeamId', 'phase2TeamId', 'revitTeamId', 'teamIds', 'staffing', 'managerId', 'mdrUrl', 'mdrTab', 'coverImage', ...PROJECT_DETAIL_KEYS]

function validateProjectCover(value: unknown) {
  if (value == null) return
  if (typeof value !== 'string' || value.length > 450_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Rejected('The project cover must be a valid JPEG, PNG or WebP image.')
  }
}

export interface Prepared {
  action: Action
  /** a new account's first password, set once the action is accepted */
  newPassword?: { userId: string; password: string }
}

/**
 * Validates the shape of a browser action and replaces the fields only the server may set.
 * `tasks` is the current task table (for "is this an MDR task" checks).
 */
export function prepare(raw: unknown, me: User, tasks: Record<string, Task>): Prepared {
  if (!isObj(raw) || typeof raw.type !== 'string') throw new Rejected("Invalid request.")
  if (!CLIENT_ACTIONS.has(raw.type)) throw new Rejected("This operation is not accepted from the browser.")
  const a = { ...raw } as O
  switch (a.type) {
    case 'finTaskArchive': return {action:pick(a,['type','taskId','archived']) as unknown as Action}
    case 'taskScoreOverride': return {action:pick(a,['type','taskId','value','reason']) as unknown as Action}
    case 'supervisionStatus': return {action:pick(a,['type','taskId','statusId']) as unknown as Action}
    case 'supervisionWorkflow': return {action:pick(a,['type','statuses','revision']) as unknown as Action}
    case 'deadlineSettings': return {action: pick(a, ['type','rules']) as unknown as Action}
    case 'visitDelete': return {action: pick(a, ['type','id']) as unknown as Action}
    case 'visitSave': if(!isObj(a.visit)) throw new Rejected("The visit is invalid."); return {action:{type:a.type, visit:pick(a.visit,['id','projectId','title','description','at','assigneeId','participantIds','priority','status'])} as unknown as Action}

    case 'roleSave': return { action: pick(a, ['type', 'role']) as unknown as Action }
    case 'roleDelete': return { action: pick(a, ['type', 'id']) as unknown as Action }
    case 'roleAssign': return { action: pick(a, ['type', 'userId', 'roleId']) as unknown as Action }
    case 'whiteboardSave': return { action: pick(a, ['type', 'board']) as unknown as Action }
    case 'whiteboardDelete': return { action: pick(a, ['type', 'id', 'revision']) as unknown as Action }
    case 'reqItUpdate': return { action: pick(a, ['type', 'id', 'status', 'note']) as unknown as Action }
    case 'folderIconSave': return { action: pick(a, ['type', 'category', 'icon']) as unknown as Action }
    case 'docSave': return { action: pick(a, ['type', 'id', 'title', 'category', 'icon', 'files']) as unknown as Action }
    case 'docDelete': case 'linkDelete': case 'noteDelete': case 'reminderDelete': return { action: pick(a, ['type', 'id']) as unknown as Action }
    case 'linkSave': if (!isObj(a.link)) throw new Rejected("The link is invalid."); return { action: { type: a.type, link: pick(a.link, ['id', 'title', 'kind', 'address', 'description', 'icon']) } as unknown as Action }
    case 'noteSave': if (!isObj(a.note)) throw new Rejected("Notes are invalid."); return { action: { type: a.type, note: pick(a.note, ['id', 'title', 'text', 'color', 'priority', 'status', 'reminderAt', 'pinned']) } as unknown as Action }
    case 'reminderSave': if (!isObj(a.reminder)) throw new Rejected("Reminder is invalid."); return { action: { type: a.type, reminder: pick(a.reminder, ['id', 'title', 'description', 'dueAt', 'status']) } as unknown as Action }
    case 'mapSave': {
      if (!Array.isArray(a.nodes) || !Array.isArray(a.edges) || a.nodes.some(n => !isObj(n)) || a.edges.some(e => !isObj(e))) throw new Rejected("The structure of the map is invalid.")
      return { action: { ...pick(a, ['type', 'projectId', 'revision']), nodes: a.nodes.map(n => pick(n as O, ['id', 'parentId', 'title', 'description', 'x', 'y', 'color', 'shape', 'fontSize', 'bold', 'collapsed'])), edges: a.edges.map(e => pick(e as O, ['from', 'to'])) } as unknown as Action }
    }

    case 'classifyTasks': return { action: pick(a, ['type', 'ids', 'projectStage', 'workScope']) as unknown as Action }
    case 'teamAdd': {
      if (!isObj(a.team)) throw new Rejected("The team is invalid.")
      return { action: { type: 'teamAdd', team: pick(a.team, ['id', 'name', 'kind', 'icon']) } as unknown as Action }
    }
    case 'teamUpdate': {
      if (!isObj(a.patch)) throw new Rejected("The team is invalid.")
      return { action: { type: 'teamUpdate', id: a.id, patch: pick(a.patch, ['name', 'kind', 'icon']) } as unknown as Action }
    }
    case 'teamArchive': return { action: { type: 'teamArchive', id: a.id, archived: a.archived } as unknown as Action }
    case 'teamMember': return { action: { type: 'teamMember', userId: a.userId, teamId: a.teamId } as unknown as Action }
    case 'addUser': {
      if (!isObj(a.user)) throw new Rejected("User profile is invalid.")
      const u = a.user
      validateProfile(u)
      const password = typeof u.password === 'string' ? u.password : ''
      if (password.length < 6 || password.length > 200) throw new Rejected("The initial code must be at least 6 characters.")
      const user = {
        ...pick(u,['email','phone','nationalId','birthday','telegramId','workScope']),
        id: String(u.id ?? ''), name: String(u.name ?? '').trim(), username: String(u.username ?? '').trim().toLowerCase(),
        teamId: String(u.teamId ?? ''), role: u.role, capacity: typeof u.capacity === 'number' && u.capacity > 0 && u.capacity <= 24 ? u.capacity : 8,
        status: 'active', createdAt: new Date().toISOString(), ...(typeof u.title === 'string' ? { title: u.title } : {}),
      }
      if (!user.name || !/^[a-z0-9._-]{3,24}$/.test(user.username)) throw new Rejected("A valid username is required.")
      return { action: { ...a, user } as Action, newPassword: { userId: user.id, password } }
    }
    case 'updateUser': {
      if (!isObj(a.patch)) throw new Rejected("Invalid request.")
      if ('password' in a.patch) throw new Rejected("The password will change from the “Password Change” path.")
      const patch = pick(a.patch, USER_PATCH)
      validateProfile(patch)
      if (patch.email != null && (typeof patch.email !== 'string' || patch.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email))) throw new Rejected('Enter a valid email address.')
      if (typeof patch.avatar === 'string' && (patch.avatar.length > 400_000 || !/^data:image\/(png|jpeg|webp);base64,/.test(patch.avatar))) throw new Rejected("The profile picture is invalid.")
      return { action: { ...a, patch } as unknown as Action }
    }
    case 'addTask': {
      if (!isObj(a.task)) throw new Rejected("Invalid task.")
      return { action: { ...a, task: { ...pick(a.task, TASK_NEW_MANUAL), source: 'manual' } } as unknown as Action }
    }
    case 'createFlowTask': {
      if (!isObj(a.task)) throw new Rejected("Invalid task.")
      // the person who creates the task is its reporter; nobody files a task in someone else's name
      return { action: { ...a, task: { ...pick(a.task, TASK_NEW_FLOW), source: 'manual', reporterId: me.id }, files: a.files } as unknown as Action }
    }
    case 'updateTask': {
      if (!isObj(a.patch)) throw new Rejected("Invalid request.")
      const t = tasks[String(a.taskId)]
      const banned = [...TASK_SERVER, 'id', 'reporterId', ...(t?.source === 'mdr' ? TASK_FROM_MDR : [])]
      const forged = Object.keys(a.patch).filter((k) => banned.includes(k) && !['flow', 'actualStart', 'actualFinish', 'baselineDue', 'baselineEstimation', 'name'].includes(k))
      if (forged.length) throw new Rejected(`These fields are determined only by the system: ${forged.join('، ')}`)
      // flow / actual dates / baselines / MDR name stay in the patch so the guard refuses them with its own reason
      return { action: { ...a, patch: omit(a.patch, ['id']) } as unknown as Action }
    }
    case 'projectAdd': {
      if (!isObj(a.project)) throw new Rejected("Invalid project.")
      const p = pick(a.project, PROJECT_FIELDS)
      validateProjectCover(p.coverImage)
      return { action: { ...a, project: p } as unknown as Action }
    }
    case 'projectCategory': return {action:pick(a,['type','op','name','replacement']) as unknown as Action}
    case 'projectLifecycle': return {action:pick(a,['type','id','op','confirmation']) as unknown as Action}
    case 'projectUpdate': {
      if (!isObj(a.patch)) throw new Rejected("Invalid request.")
      // lastSync is the time of the last real Sync: only the Sync job writes it
      const patch = pick(a.patch, PROJECT_FIELDS)
      validateProjectCover(patch.coverImage)
      return { action: { ...a, patch } as unknown as Action }
    }
    case 'internalProjectAdd': {
      if (!isObj(a.project)) throw new Rejected("The internal project is invalid.")
      return { action: { ...a, project: { ...pick(a.project, ['id', 'teamId', 'name', 'description', 'status', 'start', 'due']), createdBy: me.id, createdAt: new Date().toISOString() } } as unknown as Action }
    }
    case 'internalProjectUpdate': {
      if (!isObj(a.patch)) throw new Rejected("Invalid request.")
      return { action: { ...a, patch: pick(a.patch, ['name', 'description', 'status', 'start', 'due']) } as unknown as Action }
    }
    case 'addLeave': {
      if (!isObj(a.leave)) throw new Rejected("Leave is invalid.")
      return { action: { ...a, leave: pick(a.leave, ['id', 'userId', 'date', 'hours', 'note']) } as unknown as Action }
    }
    case 'addHoliday': {
      if (!isObj(a.holiday)) throw new Rejected("The shutdown is invalid.")
      return { action: { ...a, holiday: pick(a.holiday, ['id', 'date', 'title']) } as unknown as Action }
    }
  }
  return { action: a as unknown as Action }
}

/** Files carried by an action (attachments, review rounds, request documents) */
export function filesOf(a: Action): { name: string; mime: string; size: number; dataUrl: string }[] | undefined {
  const x = a as { files?: unknown }
  return Array.isArray(x.files) ? (x.files as { name: string; mime: string; size: number; dataUrl: string }[]) : undefined
}
