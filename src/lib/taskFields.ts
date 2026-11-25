// One place that says which section every task field belongs to and what it is called.
// The task page (sections A–F), list columns, filters, cards, the Gantt tip and AuditLog lines all read from here,
// so a field never shows up under a different name or in a different group on another screen.
import type { Task, TaskKind } from './types'
import { isDocumentTask } from './domain'

export type FieldGroupId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
export interface FieldGroup { id: FieldGroupId; letter: string; title: string; short: string; about: string }

/** Order = order on the task page and order of columns in every task table */
export const FIELD_GROUPS: readonly FieldGroup[] = [
  { id: 'a', letter: 'A', title: "ID and Classification", short: "ID (disambiguation)", about: "What is it and where does it work?" },
  { id: 'b', letter: 'B', title: "People", short: "People", about: "Who does it, checks it out, and is accompanying it." },
  { id: 'c', letter: 'C', title: "Timing and Estimation", short: "Schedule", about: "When to start and when to finish, how much work it is and what it depends on." },
  { id: 'd', letter: 'D', title: "Status and Progress", short: "State of affairs", about: "Where it works: Status, progress, real-time and result" },
  { id: 'e', letter: 'E', title: "Check and Attachment", short: "Checkout", about: "Review periods and files" },
  { id: 'f', letter: 'F', title: "Dialogue and History", short: "Conversations", about: "Comments, follow-up actions and AuditLog" },
]

export type FieldKey =
  | 'name' | 'docNumber' | 'source' | 'project' | 'space' | 'type' | 'priority' | 'pkg' | 'floor' | 'location' | 'internalProjectId' | 'description' | 'subtasks'
  | 'assignee' | 'team' | 'reporter' | 'reviewer' | 'participants'
  | 'estimation' | 'baselineEstimation' | 'start' | 'due' | 'baselineDue' | 'planIssue' | 'dependsOn' | 'allocation'
  | 'status' | 'progress' | 'weight' | 'actualStart' | 'actualFinish' | 'worklog' | 'wf' | 'point'

export interface FieldDef { label: string; group: FieldGroupId; unit?: string }

export const TASK_FIELDS: Record<FieldKey, FieldDef> = {
  // A — identity and classification
  name: { label: "Title", group: 'a' },
  docNumber: { label: 'Doc Number', group: 'a' },
  source: { label: "Source", group: 'a' },
  project: { label: "Project", group: 'a' },
  space: { label: "Category: Space", group: 'a' },
  type: { label: "Type of work", group: 'a' },
  priority: { label: "Priority", group: 'a' },
  pkg: { label: 'Package', group: 'a' },
  floor: { label: 'Floor', group: 'a' },
  location: { label: "Location in the workshop", group: 'a' },
  internalProjectId: { label: "The Interior Project", group: 'a' },
  description: { label: "Description", group: 'a' },
  subtasks: { label: "Zirtsk", group: 'a' },
  // B — people
  assignee: { label: "Responsible", group: 'b' },
  team: { label: "Team", group: 'b' },
  reporter: { label: "Reporter / Manufacturer", group: 'b' },
  reviewer: { label: 'Reviewer', group: 'b' },
  participants: { label: "Participants", group: 'b' },
  // C — schedule and effort
  estimation: { label: 'Estimation', group: 'c', unit: "Person-hours" },
  baselineEstimation: { label: 'Original Estimation', group: 'c', unit: "Person-hours" },
  start: { label: 'Start', group: 'c' },
  due: { label: 'Due Date', group: 'c' },
  baselineDue: { label: "Primary Due (Baseline)", group: 'c' },
  planIssue: { label: 'Plan Issue Date', group: 'c' },
  dependsOn: { label: "Prerequisites", group: 'c' },
  allocation: { label: 'Allocation', group: 'c' },
  // D — status and progress
  status: { label: 'Status', group: 'd' },
  progress: { label: "Progression", group: 'd' },
  weight: { label: 'Weight', group: 'd' },
  actualStart: { label: 'Actual Start', group: 'd' },
  actualFinish: { label: 'Actual Finish', group: 'd' },
  worklog: { label: 'Work Log', group: 'd' },
  wf: { label: "W.F. (weight factor)", group: 'd' },
  point: { label: 'Point', group: 'd' },
}

/** Short label of a field (W.F without its gloss) */
export const L = (k: FieldKey) => (k === 'wf' ? 'W.F' : TASK_FIELDS[k].label)
/** Label with its unit, for form fields: «Estimation (نفر-ساعت)» */
export const LU = (k: FieldKey) => (TASK_FIELDS[k].unit ? `${TASK_FIELDS[k].label} (${TASK_FIELDS[k].unit})` : TASK_FIELDS[k].label)

/** Fields that apply to a kind of task — a field that means nothing for it is not shown at all, rather than shown empty */
export function fieldsOf(kind: TaskKind): Set<FieldKey> {
  const common: FieldKey[] = ['name', 'source', 'priority', 'description', 'assignee', 'reporter', 'reviewer', 'participants', 'start', 'due', 'baselineDue', 'status', 'progress', 'actualStart', 'actualFinish']
  const scored: FieldKey[] = ['estimation', 'baselineEstimation', 'type', 'worklog', 'wf', 'point']
  switch (kind) {
    case 'document': return new Set([...common, ...scored, 'docNumber', 'project', 'pkg', 'floor', 'planIssue', 'weight', 'dependsOn', 'allocation', 'subtasks', 'team'])
    case 'manual': return new Set([...common, ...scored, 'docNumber', 'project', 'pkg', 'floor', 'dependsOn', 'allocation', 'subtasks', 'team'])
    case 'supervision': return new Set([...common, ...scored, 'project', 'location'])
    case 'internal': return new Set([...common, ...scored, 'space', 'internalProjectId', 'subtasks'])
    case 'finadmin': return new Set([...common, 'space'])
    default: return new Set(['name', 'description'])
  }
}
export const hasField = (t: Pick<Task, 'kind'|'source'>, k: FieldKey) => fieldsOf(isDocumentTask(t)?'document':t.kind).has(k)

/** AuditLog wording of edited Task properties («ویرایش: اولویت، Due Date») */
export const AUDIT_FIELD: Partial<Record<keyof Task, string>> = {
  name: L('name'), description: L('description'), type: L('type'), priority: L('priority'), location: L('location'), internalProjectId: L('internalProjectId'),
  reporterId: L('reporter'), reviewerId: L('reviewer'), participantIds: L('participants'),
  estimation: L('estimation'), start: L('start'), due: L('due'), dependsOn: L('dependsOn'),
  wf: L('wf'), progressPct: L('progress'), parentId: "Parent Task", kind: 'Item Type',
}
